/** Real pinned acpx library; fake peer/secrets, no coding auth/model. S evidence. */
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const packageRoot=resolve(process.argv[2]??'');
const manifest=JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8'));
if(manifest.name!=='acpx'||manifest.version!=='0.19.0')throw Error('Pinned acpx0.19.0 required');
const {AcpxRuntime,createAgentRegistry,createFileSessionStore}=await import(pathToFileURL(join(packageRoot,'dist/runtime.js')).href);
const peer=fileURLToPath(new URL('./fixtures/acp-client-peer.mjs',import.meta.url));
const results=[];
for(const enabled of [true,false]){
  const root=await mkdtemp(join(tmpdir(),'stackot-acpx-client-'));
  const workspace=join(root,'workspace'),stateDir=join(root,'state');
  await mkdir(workspace,{mode:0o700});await mkdir(stateDir,{mode:0o700});
  const canary=join(workspace,'canary'),sentinel=join(workspace,'terminal-sentinel');
  await writeFile(canary,'synthetic-canary',{mode:0o600});
  const runtime=new AcpxRuntime({cwd:workspace,sessionStore:createFileSessionStore({stateDir}),
    agentRegistry:createAgentRegistry({overrides:{fixture:[process.execPath,peer,canary,sentinel,workspace]}}),
    permissionMode:'approve-all',nonInteractivePermissions:'fail',mcpServers:[],elicitationModes:[],
    fs:enabled,terminal:enabled,timeoutMs:10000,
    agentProcessEnv:{PATH:'/usr/bin:/bin',HOME:process.env.HOME??'',LANG:'C'}});
  let handle;
  try{
    handle=await runtime.ensureSession({sessionKey:'fixture-'+enabled,agent:'fixture',mode:'oneshot',cwd:workspace});
    const turn=runtime.startTurn({handle,text:'Synthetic client capability probe',mode:'prompt',requestId:'fixture-turn',timeoutMs:10000});
    let text='';
    const drain=(async()=>{for await(const event of turn.events)
      if(typeof event.text==='string'&&event.text.startsWith('{"advertisedFs":'))text+=event.text;})();
    const [outcome]=await Promise.all([turn.result,drain]);
    if(outcome.status!=='completed')throw Error('Fixture turn did not complete');
    const report=JSON.parse(text);
    const exists=await stat(sentinel).then(()=>true,()=>false);
    if(report.advertisedFs!==enabled||report.advertisedTerminal!==enabled||report.canaryRead!==enabled||
      report.terminalAccepted!==enabled||exists!==enabled)throw Error('Client capability boundary failed');
    if(enabled?(report.readError!==null||report.terminalError!==null):
      (report.readError!==-32601||report.terminalError!==-32601))
      throw Error('Client callback rejection status unconfirmed');
    results.push({enabled,...report,hostSentinelCreated:exists});
  }finally{
    if(handle)await runtime.close({handle,reason:'fixture-complete'});
    if(typeof runtime.shutdown==='function')await runtime.shutdown();
    await rm(root,{recursive:true,force:true});
  }
}
console.log(JSON.stringify({acpxVersion:manifest.version,realAcpx:true,syntheticPeer:true,results,
  actualCodexWorker:false,realCredentials:false,fullS29Acceptance:false}));
