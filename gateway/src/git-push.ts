import {spawn} from "node:child_process";
import {mkdtemp,mkdir,writeFile,realpath,stat,rm} from "node:fs/promises";
import {join,isAbsolute} from "node:path";
import type {PushTarget} from "./push.ts";

const MAX_OUTPUT=128*1024*1024;
async function command(executable:string,args:string[],cwd:string,env:Record<string,string>,input?:Buffer):Promise<Buffer>{
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd,env,stdio:['pipe','pipe','pipe'],detached:true});
    const chunks:Buffer[]=[];let size=0,failed=false;
    const terminate=()=>{failed=true;try{process.kill(-child.pid!,'SIGKILL');}catch{child.kill('SIGKILL');}};
    const timer=setTimeout(terminate,30000);
    child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>MAX_OUTPUT)terminate();else chunks.push(chunk);});
    // Drain but never expose transport/provider output, which may contain auth.
    child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('OWNER_GIT_OPERATION_FAILED'));});
    child.on('close',code=>{clearTimeout(timer);if(failed||code!==0)reject(new Error('OWNER_GIT_OPERATION_FAILED'));else resolve(Buffer.concat(chunks));});
    child.stdin.end(input);
  });
}
function environment(home:string,credential?:string,askpass?:string):Record<string,string>{
  return {PATH:'/usr/bin:/bin',HOME:home,LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:'/dev/null',
    GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0',
    ...credential===undefined?{}:{GIT_ASKPASS:askpass!,STACKOT_OWNER_PUSH_TOKEN:credential}};
}
async function transferPack(git:string,proxy:string,destination:string,cwd:string,env:Record<string,string>,sha:string):Promise<void>{
  await new Promise<void>((resolve,reject)=>{
    const source=spawn(git,['--git-dir',proxy,'pack-objects','--stdout','--revs'],{cwd,env,stdio:['pipe','pipe','pipe'],detached:true});
    const sink=spawn(git,['--git-dir',destination,'index-pack','--stdin','--strict'],{cwd,env,stdio:['pipe','pipe','pipe'],detached:true});
    let closed=0,failed=false;
    const kill=()=>{failed=true;for(const child of [source,sink]){try{process.kill(-child.pid!,'SIGKILL');}catch{child.kill('SIGKILL');}}};
    const timer=setTimeout(kill,30000);
    const finish=(code:number|null)=>{if(code!==0)kill();if(++closed===2){clearTimeout(timer);if(failed)reject(new Error('OWNER_GIT_PACK_FAILED'));else resolve();}};
    for(const child of [source,sink]){child.stderr.on('data',()=>{});child.on('error',kill);child.on('close',finish);child.stdin.on('error',kill);}
    sink.stdout.on('data',()=>{});source.stdout.pipe(sink.stdin);source.stdin.end(sha+'\n');
  });
}
type Options={source:string;ownerRoot:string;target:PushTarget;gitExecutable:string;
  verify:(target:PushTarget)=>Promise<boolean>;fixtureRemote?:string};

/** Owner-held sealed Git objects, not a sandbox or native identity boundary. */
export class OwnerGitPush {
  private disposed=false;
  private constructor(private readonly git:string,private readonly root:string,private readonly repository:string,
    private readonly home:string,private readonly askpass:string,private readonly endpoint:string,private readonly pinned:PushTarget){}
  static async seal(options:Options):Promise<OwnerGitPush>{
    if(!isAbsolute(options.gitExecutable)||!isAbsolute(options.source)||!isAbsolute(options.ownerRoot)||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(options.target.repo)||! /^[0-9a-f]{40}$/.test(options.target.commitSha)||
      ['main','master'].includes(options.target.branch))
      throw new Error('OWNER_GIT_INPUT_INVALID');
    const owner=await realpath(options.ownerRoot),info=await stat(owner);
    if(owner!==options.ownerRoot||!info.isDirectory()||(info.mode&0o077)!==0||info.uid!==process.getuid?.())
      throw new Error('OWNER_GIT_ROOT_INVALID');
    let verified=false;try{verified=await options.verify({...options.target});}catch{}
    if(!verified)throw new Error('OWNER_REVISION_UNVERIFIED');
    const root=await mkdtemp(join(owner,'push-'));
    try{
    const home=join(root,'home');await mkdir(home,{mode:0o700});
    const env=environment(home);const git=options.gitExecutable;
    await command(git,['check-ref-format','--branch',options.target.branch],root,env);
    // Only this initial path query touches worker Git config, before any token.
    const common=(await command(git,['-C',options.source,'rev-parse','--path-format=absolute','--git-common-dir'],root,env)).toString().trim();
    if(!isAbsolute(common)||common.includes('\n'))throw new Error('OWNER_OBJECT_PATH_INVALID');
    const objectPath=await realpath(join(common,'objects'));
    const proxy=join(root,'reader.git'),repository=join(root,'sealed.git');
    await command(git,['init','--bare','--template=',proxy],root,env);
    await writeFile(join(proxy,'objects/info/alternates'),objectPath+'\n',{mode:0o600});
    await command(git,['init','--bare','--template=',repository],root,env);
    await transferPack(git,proxy,repository,root,env,options.target.commitSha);
    const resolved=(await command(git,['--git-dir',repository,'rev-parse',options.target.commitSha+'^{commit}'],root,env)).toString().trim();
    if(resolved!==options.target.commitSha)throw new Error('OWNER_SEALED_REVISION_MISMATCH');
    const askpass=join(root,'askpass');
    await writeFile(askpass,'#!/bin/sh\ncase "$1" in\n*Username*|*username*) printf "%s\\n" "x-access-token" ;;\n*) printf "%s\\n" "$STACKOT_OWNER_PUSH_TOKEN" ;;\nesac\n',{mode:0o700});
    let endpoint='https://github.com/'+options.target.repo+'.git';
    if(options.fixtureRemote!==undefined){
      // Explicit local test fixture only; callers cannot use arbitrary HTTPS,
      // SSH, ext helpers or URL rewriting to route production credentials.
      const fixture=await realpath(options.fixtureRemote);
      if(!isAbsolute(fixture)||!fixture.startsWith(owner+'/'))throw new Error('OWNER_FIXTURE_REMOTE_INVALID');
      endpoint=fixture;
    }
    return new OwnerGitPush(git,root,repository,home,askpass,endpoint,{...options.target});
    }catch(error){await rm(root,{recursive:true,force:true});throw error;}
  }
  /** Caller persists receipts first; only this instance's generated files are removed. */
  async dispose():Promise<void>{this.disposed=true;await rm(this.root,{recursive:true,force:true});}
  allows(value:PushTarget):boolean{
    return !this.disposed&&value.repo===this.pinned.repo&&value.branch===this.pinned.branch&&value.commitSha===this.pinned.commitSha;
  }
  async verifyRevision(value:PushTarget):Promise<boolean>{
    if(!this.allows(value))return false;
    const result=await command(this.git,['--git-dir',this.repository,'rev-parse',value.commitSha+'^{commit}'],this.root,environment(this.home));
    return result.toString().trim()===value.commitSha;
  }
  async push(value:PushTarget,credential:string):Promise<{remoteSha:string}>{
    if(!this.allows(value)||!credential.trim()||/^<[^<>]*>$/.test(credential))throw new Error('OWNER_GIT_AUTHORITY_DENIED');
    const env=environment(this.home,credential,this.askpass);
    const config=['--git-dir',this.repository,'-c','core.hooksPath=/dev/null','-c','credential.helper=',
      '-c','http.followRedirects=false','-c','protocol.ext.allow=never','-c','protocol.ssh.allow=never'];
    await command(this.git,[...config,'push','--porcelain','--no-verify','--',this.endpoint,
      value.commitSha+':refs/heads/'+value.branch],this.root,env);
    const readback=await command(this.git,[...config,'ls-remote','--refs','--',this.endpoint,'refs/heads/'+value.branch],this.root,env);
    const lines=readback.toString().trim().split('\n');
    if(lines.length!==1||lines[0]!==value.commitSha+'\trefs/heads/'+value.branch)throw new Error('OWNER_REMOTE_RECEIPT_MISMATCH');
    return {remoteSha:value.commitSha};
  }
}
