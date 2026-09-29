/** Runtime package/version probe only: no ACP session, login or model turn. */
import {mkdtemp,mkdir,realpath,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DockerWorker} from '../src/docker-worker.ts';
const imageId=process.argv[2],docker=Bun.which('docker');
if(!docker||!/^sha256:[0-9a-f]{64}$/.test(imageId??''))throw Error('Inspected local image ID required');
const root=await realpath(await mkdtemp(join(tmpdir(),'stackot-codex-image-')));
const owner=join(root,'owner'),workspaces=join(root,'workspaces'),workspace=join(workspaces,'task');
const homes=join(root,'coding-homes'),codingHome=join(homes,'task');
for(const p of [owner,workspaces,workspace,homes,codingHome])await mkdir(p,{mode:0o700});
try{
  const executor=await DockerWorker.prepare({dockerExecutable:docker,endpoint:'unix:///var/run/docker.sock',imageId,
    program:'/usr/local/bin/node',ownerRoot:owner,workspaceRoot:workspaces,codingHomeRoot:homes,authorize:async()=>true});
  const program=`const {spawnSync}=require('node:child_process');
const pkg=n=>require('/opt/stackot/node_modules/'+n+'/package.json').version;
const version=spawnSync('/opt/stackot/node_modules/.bin/codex',['--version'],{encoding:'utf8'});
const auth=spawnSync('/opt/stackot/node_modules/.bin/codex',['login','status'],{encoding:'utf8'});
if(version.status!==0||!version.stdout.includes('0.153.4')||auth.status!==1)process.exit(2);
console.log(JSON.stringify({node:process.version,codex:pkg('@openai/codex'),codexAcp:pkg('@agentclientprotocol/codex-acp'),acpx:pkg('acpx'),nativeBinaryAvailable:true,loginPresent:false}));`;
  const result=await executor.run({taskId:'image/metadata',workspace,codingHome,arguments:['-e',program],timeoutMs:20000});
  if(result.kind!=='exited'||result.exitCode!==0||!result.cleanupConfirmed||!result.outputPath)throw Error('Native image metadata probe failed');
  const metadata=JSON.parse((await readFile(result.outputPath,'utf8')).trim());
  if(metadata.node!=='v24.21.0'||metadata.codex!=='0.153.4'||metadata.codexAcp!=='1.11.0'||metadata.acpx!=='0.19.0')throw Error('Pinned version mismatch');
  const entries=await readdir(codingHome);
  // Native CLI creates temporary arg0 shims even for version/login-status.
  // No auth/config/session store may be introduced by this metadata probe.
  if(entries.some(name=>name!=='tmp'))throw Error('Metadata probe created coding auth/session state');
  if((await readdir(workspace)).length)throw Error('Metadata probe changed task workspace');
  console.log(JSON.stringify({imageId,...metadata,scopedHomeOnlyTmp:true,workspaceUnchanged:true,realDockerEngine:true,
    ownedContainerRemoved:true,actualAcpSession:false,modelTurn:false,realCredentials:false,fullS29Acceptance:false}));
}finally{await rm(root,{recursive:true,force:true});}
