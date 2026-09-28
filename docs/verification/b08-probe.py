#!/usr/bin/env python3
"""Actual native hook rotation, controlled HMAC traffic, no fake provider.
Private configs/logs remain outside Git; production Gateway is unchanged.
"""
import argparse,hashlib,hmac,json,os,secrets,signal,socket,sqlite3,subprocess,threading,time,urllib.request,urllib.error
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-root',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();os.umask(0o077);base=Path(args.runtime_root).resolve()
    root=base/'state'/('b08-'+secrets.token_hex(6));root.mkdir(mode=0o700)
    for name in ['gateway-state','workspace','receiver']:(root/name).mkdir()
    def port():
        with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
    gp,rp=port(),port();assert gp!=rp
    old,new=secrets.token_hex(32),secrets.token_hex(32)
    gateway=root/'gateway.json';file=root/'hook.json';receiver=root/'receiver.json'
    cfg=json.loads((base/'config/receiver.json').read_text())
    cfg.update(host='127.0.0.1',port=rp,openclawHooksUrl='http://127.0.0.1:%d/hooks'%gp,
               openclawHookToken=old,openclawHookTokenFile=str(file))
    config={'gateway':{'mode':'local','bind':'loopback','port':gp,'auth':{'mode':'token','token':secrets.token_hex(32)}},
        'agents':{'defaults':{'workspace':str(root/'workspace'),'heartbeat':{'every':'0m'},'model':{'primary':'openai/gpt-5.6-sol'}},
                  'entries':{'stackot':{'workspace':str(root/'workspace'),'sandbox':{'mode':'off'}}}},
        'plugins':{'allow':['openai'],'entries':{'openai':{'enabled':True}},'slots':{'memory':'none'}},
        'tools':{'deny':['*']},'discovery':{'mdns':{'mode':'off'}},
        'hooks':{'enabled':True,'token':old,'allowedAgentIds':['stackot'],'allowRequestSessionKey':False}}
    def atomic(path,value):
        temporary=path.with_name(path.name+'.next');temporary.write_text(json.dumps(value));temporary.chmod(0o600);os.replace(temporary,path)
    atomic(gateway,config);atomic(file,{'version':1,'token':old});atomic(receiver,cfg)
    env=dict(os.environ)
    for key in list(env):
        if key.startswith(('OPENCLAW_','DISCORD_')):del env[key]
    env.update(OPENCLAW_STATE_DIR=str(root/'gateway-state'),OPENCLAW_CONFIG_PATH=str(gateway),
               NO_COLOR='1',PATH=str(base/'runtime/node/bin')+':'+env['PATH'])
    cli=[str(base/'runtime/node/bin/node'),str(base/'runtime/packages/node_modules/openclaw/openclaw.mjs')]
    children=[];logs=[];stop=threading.Event();samples=[];thread=None;sample_gate=threading.Lock()
    result={'privateRoot':str(root),'fakeProvider':False,'trafficSource':'owner-controlled signed probes, not genuine GitHub-origin event',
            'productionGatewayChanged':False,'workerDispatched':False,'outboundDelivery':False}
    repo=Path(__file__).resolve().parents[2]
    source_files=sorted((repo/'receiver/src').glob('*.ts'))+[repo/'receiver/package.json',repo/'receiver/bun.lock']
    result['receiverSourceSha256']={str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in source_files}
    result['sourceRevision']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
    build=subprocess.run([shutil_bun(),'run','build'],cwd=repo/'receiver',capture_output=True,text=True)
    if build.returncode:raise RuntimeError('Receiver build failed before native drill')
    result['receiverBuiltFromRecordedSource']=True
    def start(argv,name,e):
        log=(root/(name+'.log')).open('w');logs.append(log)
        child=subprocess.Popen(argv,env=e,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);children.append(child);return child
    def hook(token,marker):
        data=json.dumps({'message':'B08 controlled token-auth probe; no coding or publishing','name':'b08-'+marker,'agentId':'stackot','deliver':False}).encode()
        req=urllib.request.Request('http://127.0.0.1:%d/hooks/agent'%gp,data=data,method='POST',
            headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':'b08-'+marker})
        try:
            with urllib.request.urlopen(req,timeout=35) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as error:return error.code,{}
    def intake(event,ident):
        data=json.dumps({'repository':{'full_name':'stacking-money-forever/stackot'},'action':'opened',
                         'issue':{'number':2,'title':'B08 controlled input','html_url':'https://github.com/stacking-money-forever/stackot/issues/2','body':'No coding, push, PR or outbound delivery'}}).encode()
        signature='sha256='+hmac.new(cfg['githubWebhookSecret'].encode(),data,hashlib.sha256).hexdigest()
        req=urllib.request.Request('http://127.0.0.1:%d/webhook'%rp,data=data,method='POST',
            headers={'X-Hub-Signature-256':signature,'X-GitHub-Delivery':ident,'X-GitHub-Event':event})
        with urllib.request.urlopen(req,timeout=3) as response:return response.status
    def poll():
        while not stop.is_set():
            ident='b08-intake-'+secrets.token_hex(12)
            try:
                code=intake('issues',ident)
                db=sqlite3.connect('file:'+str(root/'receiver/outbox.sqlite')+'?mode=ro',uri=True)
                exists=db.execute('SELECT COUNT(*) FROM outbox WHERE id=?',(ident,)).fetchone()[0]==1;db.close()
            except Exception:code=0;exists=False
            with sample_gate:samples.append({'atMs':int(time.time()*1000),'status':code,'deliveryId':ident,'persistedAtAck':exists})
            stop.wait(2)
    def listener_pid(number):
        text=subprocess.check_output(['lsof','-nP','-iTCP:'+str(number),'-sTCP:LISTEN','-F','p'],text=True)
        ids={int(line[1:]) for line in text.splitlines() if line.startswith('p')};assert len(ids)==1
        return ids.pop()
    try:
        g=start(cli+['gateway','run','--bind','loopback','--port',str(gp)],'gateway',env)
        deadline=time.monotonic()+45
        while time.monotonic()<deadline:
            p=subprocess.run(cli+['gateway','call','health','--json','--timeout','2000'],env=env,text=True,capture_output=True,timeout=6)
            if p.returncode==0 and json.loads(p.stdout).get('ok'):break
            if g.poll() is not None:raise RuntimeError('Native Gateway exited')
            time.sleep(0.2)
        else:raise RuntimeError('Native health timeout')
        p=subprocess.run(cli+['gateway','call','models.list','--json'],env=env,text=True,capture_output=True,timeout=35);assert p.returncode==0
        pid=json.loads(subprocess.check_output(cli+['gateway','call','health','--json'],env=env,text=True))
        # Popen lifecycle PID and listener must remain unchanged throughout hot reload.
        result['gatewayProcessPid']=g.pid
        r_env=dict(os.environ,STACKOT_CONFIG=str(receiver),STACKOT_OUTBOX_PATH=str(root/'receiver/outbox.sqlite'))
        bundle=repo/'receiver/dist/server.js';result['receiverBundleSha256']=hashlib.sha256(bundle.read_bytes()).hexdigest()
        r=start([shutil_bun(),str(bundle)],'receiver',r_env);result['receiverProcessPid']=r.pid
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/readyz'%rp,timeout=1) as response:
                    if response.status==200:break
            except OSError:time.sleep(0.05)
        else:raise RuntimeError('Receiver readiness timeout')
        initial,_=hook(old,'old-initial');assert initial==200
        actual_gp,actual_rp=listener_pid(gp),listener_pid(rp)
        thread=threading.Thread(target=poll);thread.start()
        time.sleep(0.5)
        config['hooks']['token']=new;atomic(gateway,config)
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            old_status,_=hook(old,'old-after-reload')
            if old_status==401:break
            time.sleep(0.2)
        else:raise RuntimeError('Old token not rejected after native reload')
        accepted,ack=hook(new,'new-after-reload');assert accepted==200 and ack.get('runId')
        assert listener_pid(gp)==actual_gp and listener_pid(rp)==actual_rp
        assert all(hashlib.sha256((repo/name).read_bytes()).hexdigest()==value for name,value in result['receiverSourceSha256'].items())
        # Receiver still uses old file token while intake continues; persist a real row.
        delivery='b08-control-'+secrets.token_hex(12);assert intake('issues',delivery)==200
        dbpath=root/'receiver/outbox.sqlite';deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            db=sqlite3.connect('file:'+str(dbpath)+'?mode=ro',uri=True)
            failed=db.execute('SELECT state,attempts,last_error FROM outbox WHERE id=?',(delivery,)).fetchone();db.close()
            rejected=False
            for line in (root/'receiver.log').read_text().splitlines():
                if line.startswith('{'):
                    try:entry=json.loads(line)
                    except json.JSONDecodeError:continue
                    if entry.get('event')=='delivery.failed' and entry.get('deliveryId')==delivery and '401' in str(entry.get('error')):rejected=True
            # Pending retries persist attempts; last_error is stored only on
            # dead letter. Correlate the post-write telemetry for HTTP401.
            if failed and failed[0]=='pending' and failed[1]>=1 and rejected:break
            if failed and failed[0]=='dead_letter':raise RuntimeError('Old credential failure exhausted before swap')
            time.sleep(0.1)
        else:raise RuntimeError('No persisted retired-token401 attempt before credential swap')
        result['bufferedOldTokenFailure']={'state':failed[0],'attempts':failed[1],'status':401}
        atomic(file,{'version':1,'token':new});deadline=time.monotonic()+45
        while time.monotonic()<deadline:
            db=sqlite3.connect('file:'+str(dbpath)+'?mode=ro',uri=True);row=db.execute('SELECT state,last_error FROM outbox WHERE id=?',(delivery,)).fetchone();db.close()
            if row and row[0]=='delivered':break
            if row and row[0]=='dead_letter':raise RuntimeError('Buffered row dead-lettered during rotation')
            time.sleep(0.2)
        else:raise RuntimeError('Buffered drain timeout')
        stop.set();thread.join(timeout=5);assert samples and all(item['status']==200 and item['persistedAtAck'] for item in samples)
        deadline=time.monotonic()+45
        while time.monotonic()<deadline:
            db=sqlite3.connect('file:'+str(dbpath)+'?mode=ro',uri=True)
            sample_rows={x[0]:x[1] for x in db.execute('SELECT id,state FROM outbox').fetchall()};db.close()
            if all(sample_rows.get(item['deliveryId'])=='delivered' for item in samples):break
            if any(sample_rows.get(item['deliveryId'])=='dead_letter' for item in samples):raise RuntimeError('A continuous-intake row dead-lettered')
            time.sleep(0.2)
        else:raise RuntimeError('Continuous-intake rows did not all drain')
        result['allIntakeRowsDelivered']=True
        assert g.poll() is None and r.poll() is None
        for name in ['gateway.log','receiver.log']:
            text=(root/name).read_text();assert old not in text and new not in text
        db=sqlite3.connect('file:'+str(dbpath)+'?mode=ro',uri=True)
        errors=[value[0] or '' for value in db.execute('SELECT last_error FROM outbox').fetchall()];db.close()
        assert all(old not in value and new not in value for value in errors)
        assert listener_pid(gp)==actual_gp and listener_pid(rp)==actual_rp
        result.update(passed=True,oldTokenAfterReload=401,newTokenAfterReload=accepted,newNativeRunId=ack['runId'],
                      continuousIntakeSamples=samples,receiverRestarted=False,gatewayRestarted=False,
                      actualGatewayPid=actual_gp,actualReceiverPid=actual_rp,listenerPidsUnchanged=True,
                      bufferedDeliveryId=delivery,bufferedState='delivered',oldAndNewValuesAbsentFromLogs=True,
                      oldAndNewValuesAbsentFromDatabaseErrors=True)
    except Exception as error:result.update(passed=False,errorType=type(error).__name__,error=str(error));raise
    finally:
        stop.set()
        if thread:thread.join(timeout=5)
        for child in reversed(children):
            if child.poll() is None:
                os.killpg(child.pid,signal.SIGTERM)
                try:child.wait(timeout=10)
                except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)
        for log in logs:log.close()
        closed=[]
        for p in [gp,rp]:
            with socket.socket() as s:closed.append(s.connect_ex(('127.0.0.1',p))!=0)
        result['ownedListenersClosed']=all(closed)
        if not all(closed):result['passed']=False
        Path(args.output).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':result.get('passed',False),'ownedListenersClosed':all(closed),'errorType':result.get('errorType')}))
        if not all(closed):raise RuntimeError('Owned listener survived cleanup')

def shutil_bun():
    import shutil
    value=shutil.which('bun')
    if not value:raise RuntimeError('Bun missing')
    return value

if __name__=='__main__':main()
