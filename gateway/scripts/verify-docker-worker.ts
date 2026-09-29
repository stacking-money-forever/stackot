/** Real Docker engine, synthetic worker/credentials. Not full S33 or Codex R. */
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DockerWorker} from '../src/docker-worker.ts';

const imageId=process.argv[2];
if(!/^sha256:[0-9a-f]{64}$/.test(imageId??''))throw new Error('Fixture requires the exact inspected local image ID');
const docker=Bun.which('docker');if(!docker)throw new Error('Real Docker CLI required');
const root=await realpath(await mkdtemp(join(tmpdir(),'stackot-docker-runtime-')));
const owner=join(root,'owner'),workspaces=join(root,'workspaces'),workspace=join(workspaces,'task');
const codingHomeRoot=join(root,'coding-homes'),codingHome=join(codingHomeRoot,'task');
for(const path of [owner,workspaces,workspace,codingHomeRoot,codingHome])await mkdir(path,{mode:0o700});
await writeFile(join(owner,'owner-token'),'synthetic-only');
await writeFile(join(workspace,'input'),'fixture');
await writeFile(join(codingHome,'account-fixture'),'synthetic-coding-account');
const quote=(value:string)=>"'"+value.replaceAll("'","'\"'\"'")+"'";
await writeFile(join(workspace,'fixture.sh'),`#!/bin/sh
set -eu
test "$(cat /work/input)" = fixture
test ! -e ${quote(join(owner,'owner-token'))}
test ! -e /work/owner-token
test ! -S /var/run/docker.sock
test ! -e /root/.git-credentials
test -z "\${GITHUB_TOKEN-}"
test -z "\${SSH_AUTH_SOCK-}"
test "$(id -u)" != 0
test ! -w /usr
test "$(cat "$CODEX_HOME/account-fixture")" = synthetic-coding-account
echo session-preserved > "$CODEX_HOME/session-fixture"
echo preserved > /work/output
echo isolation-fixture-ok
`);
const config={dockerExecutable:docker,endpoint:'unix:///var/run/docker.sock',imageId,program:'/bin/sh',ownerRoot:owner,
  workspaceRoot:workspaces,codingHomeRoot,authorize:async()=>true};
try{
  const executor=await DockerWorker.prepare(config);
  const result=await executor.run({taskId:'fixture/task',workspace,codingHome,arguments:['/work/fixture.sh'],timeoutMs:15000});
  if(result.kind!=='exited'||result.exitCode!==0||!result.cleanupConfirmed)throw new Error('Real Docker isolation fixture failed: '+JSON.stringify(result));
  if((await readFile(join(workspace,'output'),'utf8')).trim()!=='preserved')throw new Error('Worker output not preserved');
  if((await readFile(join(codingHome,'session-fixture'),'utf8')).trim()!=='session-preserved')throw new Error('Scoped coding session not preserved');
  await writeFile(join(workspace,'timeout.sh'),'echo started > /work/timeout-output\nwhile :; do sleep 1; done\n');
  const timeout=await executor.run({taskId:'fixture/timeout',workspace,codingHome,arguments:['/work/timeout.sh'],timeoutMs:3000});
  if(timeout.kind!=='timed-out'||!timeout.cleanupConfirmed)throw new Error('Real Docker timeout cleanup unconfirmed');
  if((await readFile(join(workspace,'timeout-output'),'utf8')).trim()!=='started')throw new Error('Timeout erased work');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),5000);
  let cancel;
  try{cancel=await executor.run({taskId:'fixture/cancel',workspace,codingHome,arguments:['/work/timeout.sh'],timeoutMs:15000,signal:controller.signal});}
  finally{clearTimeout(timer);}
  if(cancel.kind!=='cancelled'||!cancel.cleanupConfirmed)throw new Error('Real Docker cancel cleanup unconfirmed');
  console.log(JSON.stringify({imageId,realDockerEngine:true,fixtureSecrets:true,isolatedExitCode:result.exitCode,
    timeout:timeout.kind,cancel:cancel.kind,ownedContainersRemoved:true,workspacePreserved:true,codingSessionPreserved:true,fullS33Acceptance:false,actualCodexWorker:false}));
}finally{await rm(root,{recursive:true,force:true});}
