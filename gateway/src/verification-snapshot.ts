import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,realpath,stat,symlink,rm} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import type {PushTarget} from './push.ts';

export type SnapshotOwner={gitExecutable:string;commonGitDir:string;snapshotRoot:string;ownerRoot:string;baseSha:string;target:PushTarget};
export type VerificationSnapshot={workspace:string;currentTarget:()=>Promise<boolean>;dispose:()=>Promise<void>};
function environment(home:string){return {PATH:'/usr/bin:/bin',HOME:home,LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',
  GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'};}
async function pack(git:string,reader:string,destination:string,cwd:string,home:string,refs:string[]):Promise<void>{
  await new Promise<void>((resolve,reject)=>{
    const options={cwd,env:environment(home),stdio:['pipe','pipe','pipe'] as ['pipe','pipe','pipe'],detached:true};
    const source=spawn(git,['--git-dir',reader,'pack-objects','--stdout','--revs'],options);
    const sink=spawn(git,['--git-dir',destination,'index-pack','--stdin','--strict'],options);
    let closed=0,failed=false;
    const stop=()=>{failed=true;for(const child of [source,sink]){try{process.kill(-child.pid!,'SIGKILL');}catch{child.kill('SIGKILL');}}};
    const timer=setTimeout(stop,30000);
    const finish=(code:number|null)=>{if(code!==0)stop();if(++closed===2){clearTimeout(timer);if(failed)reject(new Error('VERIFICATION_SNAPSHOT_FAILED'));else resolve();}};
    for(const child of [source,sink]){child.stderr.on('data',()=>{});child.on('error',stop);child.on('close',finish);child.stdin.on('error',stop);}
    sink.stdout.on('data',()=>{});source.stdout.pipe(sink.stdin);source.stdin.end(refs.join('\n')+'\n');
  });
}
async function command(git:string,args:string[],cwd:string,home:string):Promise<string>{
  return new Promise((resolve,reject)=>{
    const child=spawn(git,args,{cwd,env:{PATH:'/usr/bin:/bin',HOME:home,LANG:'C',LC_ALL:'C',
      GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'},
      stdio:['ignore','pipe','pipe'],detached:true});
    const chunks:Buffer[]=[];let bytes=0,failed=false;
    const stop=()=>{failed=true;try{process.kill(-child.pid!,'SIGKILL');}catch{child.kill('SIGKILL');}};
    const timer=setTimeout(stop,30000);
    child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>1024*1024)stop();else chunks.push(chunk);});
    child.stderr.on('data',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('VERIFICATION_SNAPSHOT_FAILED'));});
    child.on('close',code=>{clearTimeout(timer);if(failed||code!==0)reject(new Error('VERIFICATION_SNAPSHOT_FAILED'));else resolve(Buffer.concat(chunks).toString());});
  });
}
/** Owner-vetted common Git directory, never the worker's .git/config. Only
 * objects/refs are borrowed; hooks, config, index and worktree files are not. */
export async function verificationSnapshot(owner:SnapshotOwner):Promise<VerificationSnapshot>{
  if(!/^[0-9a-f]{40}$/.test(owner.baseSha)||!/^[0-9a-f]{40}$/.test(owner.target.commitSha))throw new Error('VERIFICATION_SNAPSHOT_INPUT_INVALID');
  const uid=process.getuid?.();
  for(const path of [owner.commonGitDir,owner.snapshotRoot,owner.ownerRoot]){
    if(!isAbsolute(path)||await realpath(path)!==path||(await stat(path)).uid!==uid)throw new Error('VERIFICATION_SNAPSHOT_ROOT_INVALID');
  }
  if(!isAbsolute(owner.gitExecutable)||(await stat(owner.snapshotRoot)).mode&0o077||(await stat(owner.ownerRoot)).mode&0o077||
    owner.snapshotRoot===owner.ownerRoot||owner.snapshotRoot.startsWith(owner.ownerRoot+'/')||owner.ownerRoot.startsWith(owner.snapshotRoot+'/'))
    throw new Error('VERIFICATION_SNAPSHOT_ROOT_INVALID');
  const privateRoot=await mkdtemp(join(owner.ownerRoot,'verification-reader-')),home=join(privateRoot,'home');
  await mkdir(home,{mode:0o700});const reader=join(privateRoot,'reader.git');
  let workspace:string|undefined;
  try{
    await command(owner.gitExecutable,['init','--bare','--template=',reader],privateRoot,home);
    const objects=await realpath(join(owner.commonGitDir,'objects'));
    await writeFile(join(reader,'objects/info/alternates'),objects+'\n',{mode:0o600});
    // The trusted allocator binds this common directory to the allowed repo.
    // Ref files contain no Git configuration or credential helper instructions.
    await rm(join(reader,'refs'),{recursive:true});await symlink(join(owner.commonGitDir,'refs'),join(reader,'refs'));
    try{await symlink(join(owner.commonGitDir,'packed-refs'),join(reader,'packed-refs'));}catch{}
    const target={...owner.target};
    const currentTarget=async()=>{
      try{return (await command(owner.gitExecutable,['--git-dir',reader,'rev-parse','refs/heads/'+target.branch],privateRoot,home)).trim()===target.commitSha;}
      catch{return false;}
    };
    if(!await currentTarget())throw new Error('VERIFICATION_SOURCE_TARGET_CHANGED');
    workspace=await mkdtemp(join(owner.snapshotRoot,'task-'));
    await command(owner.gitExecutable,['init','--template=',workspace],privateRoot,home);
    // Export into a self-contained repository with a private, clean config.
    // Local clone uses only the generated reader; source config/hooks are absent.
    await command(owner.gitExecutable,['check-ref-format','--branch',target.branch],privateRoot,home);
    const destination=join(workspace,'.git');
    await pack(owner.gitExecutable,reader,destination,privateRoot,home,[target.commitSha,owner.baseSha]);
    await command(owner.gitExecutable,['--git-dir',destination,'update-ref','refs/heads/'+target.branch,target.commitSha],privateRoot,home);
    await command(owner.gitExecutable,['--git-dir',destination,'symbolic-ref','HEAD','refs/heads/'+target.branch],privateRoot,home);
    await command(owner.gitExecutable,['--git-dir',destination,'--work-tree',workspace,'checkout','--force',target.branch],privateRoot,home);
    return {workspace,currentTarget,dispose:async()=>{await rm(workspace!,{recursive:true,force:true});await rm(privateRoot,{recursive:true,force:true});}};
  }catch(error){if(workspace)await rm(workspace,{recursive:true,force:true});await rm(privateRoot,{recursive:true,force:true});throw error;}
}
