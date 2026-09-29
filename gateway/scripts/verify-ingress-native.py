#!/usr/bin/env python3
"""Actual isolated Gateway HTTP/native persistence; synthetic Discord transport."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request
import urllib.error


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--openclaw',default='openclaw')
    ap.add_argument('--output',required=True)
    args=ap.parse_args()
    gateway=Path(__file__).resolve().parents[1]
    output=Path(args.output).resolve();output.parent.mkdir(parents=True,exist_ok=True)
    root=Path(tempfile.mkdtemp(prefix='stackot-ingress-native-',dir=output.parent))
    state=root/'state';state.mkdir();config=state/'openclaw.json';config.write_text('{}\n')
    token='synthetic-ingress-probe-token'
    token_file=root/'token.json';token_file.write_text(json.dumps({'version':1,'token':token}));token_file.chmod(0o600)
    package=root/'plugin';package.mkdir()
    shutil.copytree(gateway/'dist',package/'dist')
    shutil.copy2(gateway/'openclaw.plugin.json',package/'openclaw.plugin.json')
    manifest=json.loads((gateway/'package.json').read_text());manifest.pop('devDependencies',None);manifest.pop('scripts',None);manifest['openclaw']['extensions']=['./entry.mjs']
    (package/'package.json').write_text(json.dumps(manifest))
    (package/'entry.mjs').write_text('''import plugin from "./dist/plugin.js";
export default {...plugin,register(api){let sends=0;
 const wrapped={...api,runtime:{...api.runtime,channel:{...api.runtime.channel,outbound:{...api.runtime.channel.outbound,
  loadAdapter:async()=>({sendPayload:async(ctx)=>{await ctx.onPlatformSendDispatch();sends++;const r={channel:"discord",messageId:String(500+sends),target:{kind:"channel",id:"222"}};await ctx.onDeliveryResult?.(r);return r;}})}}}};
 plugin.register(wrapped);
 api.registerGatewayMethod("ingressprobe.state",async({respond})=>{
  const flows=await api.runtime.tasks.async.managedFlows.bindSession({sessionKey:"agent:stackot:discord:channel:222"}).list();
  const runs=await api.runtime.tasks.async.runs.bindSession({sessionKey:"agent:stackot:discord:channel:222"}).list();
  respond(true,{sends,runs:runs.length,flows:flows.filter(f=>f.controllerId==="stackot").map(f=>({flowId:f.flowId,revision:f.revision,phase:f.stateJson?.ingress?.phase,approvalCount:Object.keys(f.stateJson?.approvals??{}).length}))});
 },{scope:"operator.admin"});
}};
''')
    env=dict(os.environ)
    for key in list(env):
        if key.startswith(('OPENCLAW_','DISCORD_')):del env[key]
    env.update(OPENCLAW_STATE_DIR=str(state),OPENCLAW_CONFIG_PATH=str(config),NO_COLOR='1')
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    ws='ws://127.0.0.1:%d'%port;process=None;pids=[];logs=[]

    def cli(command,timeout=30):
        p=subprocess.run([args.openclaw]+command,env=env,text=True,capture_output=True,timeout=timeout)
        if p.returncode:raise RuntimeError('probe CLI failed: '+(p.stderr or p.stdout)[-1800:])
        return p.stdout
    def call(method,params=None):
        return json.loads(cli(['gateway','call',method,'--url',ws,'--token',token,'--json','--params',json.dumps(params or {}),'--timeout','5000'],timeout=10))
    def start():
        nonlocal process
        log=(root/('gateway-%d.log'%(len(pids)+1))).open('w');logs.append(log)
        process=subprocess.Popen([args.openclaw,'gateway','run','--bind','loopback','--port',str(port),'--auth','token','--token',token],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);pids.append(process.pid)
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            if process.poll() is not None:raise RuntimeError('owned Gateway stopped before health; '+str(root))
            try:
                if call('health').get('ok'):return
            except (RuntimeError,subprocess.TimeoutExpired,json.JSONDecodeError):time.sleep(.2)
        raise RuntimeError('owned Gateway health deadline; '+str(root))
    def stop():
        nonlocal process
        if process is None:return
        if process.poll() is None:
            os.killpg(process.pid,signal.SIGTERM)
            try:process.wait(timeout=20)
            except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=5)
        process=None
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            with socket.socket() as sock:
                if sock.connect_ex(('127.0.0.1',port))!=0:return
            time.sleep(.1)
        raise RuntimeError('owned listener survived stop')
    body={'schemaVersion':1,'deliveryId':'native-ingress-probe','agentId':'stackot','event':{'repo':'owner/repo','item':'issue #2','summary':'Synthetic probe input; no coding or remote change','url':'https://github.com/owner/repo/issues/2','target':'444','targetKind':'channel'}}
    def post(value=body,credential=token):
        req=urllib.request.Request('http://127.0.0.1:%d/stackot/hooks/agent'%port,data=json.dumps(value).encode(),headers={'Authorization':'Bearer '+credential,'Content-Type':'application/json','Idempotency-Key':'stackot-native-ingress-probe'},method='POST')
        try:
            with urllib.request.urlopen(req,timeout=10) as res:return res.status,json.load(res)
        except urllib.error.HTTPError as error:return error.code,json.loads(error.read())
    try:
        assert '2026.9.6' in cli(['--version'])
        cli(['plugins','install',str(package),'--accept-capabilities','--force'],timeout=120)
        cfg=json.loads(config.read_text());cfg['gateway']={'mode':'local'};cfg['plugins']['allow']=['stackot-gateway'];cfg['plugins'].setdefault('slots',{})['memory']='none'
        cfg['plugins']['entries']['stackot-gateway']={'enabled':True,'config':{'agentId':'stackot','ingress':{'enabled':True,'tokenFile':str(token_file),'accountId':'default','guildId':'111','threadId':'222','parentChannelId':'333','requesterId':'123456789012345678','allowedRepos':['owner/repo']}}}
        cfg['agents']={'defaults':{'workspace':str(root/'workspace'),'heartbeat':{'every':'0m'}},'list':[{'id':'stackot','workspace':str(root/'workspace')}]};cfg['bindings']=[{'agentId':'stackot','match':{'channel':'discord','guildId':'111'}}];cfg['discovery']={'mdns':{'mode':'off'}}
        config.write_text(json.dumps(cfg));cli(['config','validate']);start()
        assert call('sessions.create',{'key':'agent:stackot:discord:channel:222','agentId':'stackot'})['runStarted'] is False
        assert post(credential='wrong')[0]==401
        code,first=post();assert code==200 and first['approvalStatus']=='pending' and first['workerDispatched'] is False,(code,first)
        before=call('ingressprobe.state');assert len(before['flows'])==1 and before['sends']==2 and before['runs']==0,before
        assert post()[1]['flowId']==first['flowId'];stop();start()
        assert post()[1]['flowId']==first['flowId'];after=call('ingressprobe.state')
        assert after['flows']==before['flows'] and after['sends']==0 and after['runs']==0,(before,after)
        changed={**body,'event':{**body['event'],'summary':'changed'}};assert post(changed)[0]==409
        assert post({**body,'actorId':'attacker'})[0]==400
        stop();receipt={'runtime':'2026.9.6','root':str(root),'gatewayPids':pids,'flowId':first['flowId'],'before':before,'after':after,'wrongTokenStatus':401,'changedPayloadStatus':409,'injectedActorStatus':400,'nativeFlowRestartReused':True,'modelWorkerRunCount':0,'discordTransport':'synthetic','evidence':'real isolated Gateway/native state, synthetic input/provider; not deployed Discord or H'}
        output.write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
    finally:
        stop()
        for log in logs:log.close()


if __name__=='__main__':main()
