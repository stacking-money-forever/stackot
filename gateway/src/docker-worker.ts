import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {realpath,stat,mkdtemp,mkdir,writeFile} from "node:fs/promises";
import {isAbsolute,join} from "node:path";

type CallResult={code:number;stdout:string};
export type DockerCall=(args:readonly string[],options:{timeoutMs:number;signal?:AbortSignal})=>Promise<CallResult>;
export type WorkerRequest={taskId:string;workspace:string;arguments:readonly string[];timeoutMs:number;signal?:AbortSignal;codingHome?:string};
export type WorkerReceipt={executionId:string;containerId?:string;kind:"exited"|"cancelled"|"timed-out"|"failed"|"uncertain";
  exitCode?:number;cleanupConfirmed:boolean;outputPath?:string};
export type DockerWorkerOwner={dockerExecutable:string;endpoint:string;imageId:string;program:string;
  workspaceRoot:string;ownerRoot:string;codingHomeRoot?:string;egressNetworkId?:string;
  authorize:(request:Readonly<WorkerRequest>)=>Promise<boolean>};

const CID=/^[a-f0-9]{64}$/;
const EXECUTION_LABEL="me.justn.stackot.execution";
const inside=(path:string,root:string)=>path===root||path.startsWith(root+"/");
const failure=(code:string)=>new Error(code);

/** Owner-only transport: no RPC, arbitrary Docker options, host auth copies,
 * implicit image pulls or plugin activation. The S29 controller owns approval. */
export class DockerWorker {
  private constructor(private readonly owner:Readonly<DockerWorkerOwner>,private readonly call:DockerCall,
    private readonly uid:number,private readonly gid:number){}
  static async prepare(config:DockerWorkerOwner,testCall?:DockerCall):Promise<DockerWorker>{
    if(!['darwin','linux'].includes(process.platform))throw failure('WORKER_PLATFORM_UNSUPPORTED');
    const uid=process.getuid?.(),gid=process.getgid?.();
    if(!uid||gid===undefined||!isAbsolute(config.dockerExecutable)||
      !/^unix:\/\/\//.test(config.endpoint)||/[\r\n\0]/.test(config.endpoint)||
      !/^sha256:[a-f0-9]{64}$/.test(config.imageId)||
      !/^\/(usr|bin|opt)\//.test(config.program)||/[\r\n\0]/.test(config.program)||
      (config.egressNetworkId!==undefined&&!CID.test(config.egressNetworkId)))throw failure('WORKER_OWNER_CONFIG_INVALID');
    const owner={...config};
    await privateRoot(owner.ownerRoot,uid);
    await directory(owner.workspaceRoot,uid);
    if(inside(owner.workspaceRoot,owner.ownerRoot)||inside(owner.ownerRoot,owner.workspaceRoot))throw failure('WORKER_ROOTS_OVERLAP');
    if(owner.codingHomeRoot){await privateRoot(owner.codingHomeRoot,uid);
      if(inside(owner.codingHomeRoot,owner.workspaceRoot)||inside(owner.workspaceRoot,owner.codingHomeRoot)||
        inside(owner.codingHomeRoot,owner.ownerRoot)||inside(owner.ownerRoot,owner.codingHomeRoot))throw failure('WORKER_ROOTS_OVERLAP');}
    const cliConfig=join(await mkdtemp(join(owner.ownerRoot,'docker-client-')),'config');
    await mkdir(cliConfig,{mode:0o700});await writeFile(join(cliConfig,'config.json'),'{}\n',{mode:0o600,flag:'wx'});
    const call=testCall??nativeCall(owner.dockerExecutable,owner.endpoint,cliConfig);
    return new DockerWorker(Object.freeze(owner),call,uid,gid);
  }
  async run(input:WorkerRequest):Promise<WorkerReceipt>{
    const request=Object.freeze({...input,arguments:Object.freeze([...input.arguments])});
    if(!request.taskId||request.taskId.length>200||/[\r\n\0]/.test(request.taskId)||
      !Number.isSafeInteger(request.timeoutMs)||request.timeoutMs<1||request.timeoutMs>3600000||
      request.arguments.some(x=>typeof x!=='string'||x.includes('\0')))throw failure('WORKER_REQUEST_INVALID');
    const workspace=await directory(request.workspace,this.uid);
    if(workspace===this.owner.workspaceRoot||!inside(workspace,this.owner.workspaceRoot)||
      inside(workspace,this.owner.ownerRoot)||inside(this.owner.ownerRoot,workspace))throw failure('WORKER_WORKSPACE_DENIED');
    let codingHome:string|undefined;
    if(request.codingHome){
      if(!this.owner.codingHomeRoot)throw failure('WORKER_CODING_HOME_DENIED');
      codingHome=await privateRoot(request.codingHome,this.uid);
      if(codingHome===this.owner.codingHomeRoot||!inside(codingHome,this.owner.codingHomeRoot)||
        inside(codingHome,workspace)||inside(workspace,codingHome))throw failure('WORKER_CODING_HOME_DENIED');
    }
    const executionId=randomUUID();let containerId:string|undefined,createAttempted=false;
    let reason:WorkerReceipt['kind']='failed',outputPath:string|undefined;
    const authorized=async()=>{try{return !request.signal?.aborted&&(await this.owner.authorize(request))===true;}
      catch{throw failure('WORKER_AUTHORITY_UNAVAILABLE');}};
    if(!await authorized())throw failure('WORKER_APPROVAL_REQUIRED');
    try{
      const image=single(await this.call(['image','inspect',this.owner.imageId],{timeoutMs:10000}));
      if(image.Id!==this.owner.imageId||Object.keys(image.Config?.Volumes??{}).length||
        (image.Config?.Env??[]).some((x:string)=>!/^PATH=/.test(x)))throw failure('WORKER_IMAGE_DENIED');
      if(this.owner.egressNetworkId){
        const network=single(await this.call(['network','inspect',this.owner.egressNetworkId],{timeoutMs:10000}));
        if(network.Id!==this.owner.egressNetworkId||network.Driver!=='bridge'||network.Scope!=='local'||
          network.Labels?.['me.justn.stackot.role']!=='worker-egress')throw failure('WORKER_NETWORK_DENIED');
      }
      if(!await authorized())throw failure('WORKER_APPROVAL_REQUIRED');
      // Re-resolve immediately before bind creation; a changed symlink is denied.
      if(await directory(request.workspace,this.uid)!==workspace||
        (codingHome&&await privateRoot(request.codingHome!,this.uid)!==codingHome))throw failure('WORKER_PATH_CHANGED');
      const args=['container','create','--pull=never','--name','stackot-worker-'+executionId,
        '--label',EXECUTION_LABEL+'='+executionId,'--label','me.justn.stackot.task='+request.taskId,
        '--user',`${this.uid}:${this.gid}`,'--read-only','--cap-drop=ALL',
        '--security-opt=no-new-privileges','--ipc=private','--cgroupns=private',
        '--pids-limit=256','--memory=2g','--cpus=1','--no-healthcheck',
        '--network',this.owner.egressNetworkId??'none','--workdir=/work',
        '--env=HOME=/home/worker','--env=CODEX_HOME=/home/worker/.codex','--env=LANG=C',
        '--tmpfs',`/home/worker:rw,nosuid,nodev,mode=0700,uid=${this.uid},gid=${this.gid}`,
        '--tmpfs','/tmp:rw,nosuid,nodev,size=64m',
        '--mount',`type=bind,src=${workspace},dst=/work,bind-propagation=rprivate`];
      if(codingHome)args.push('--mount',`type=bind,src=${codingHome},dst=/home/worker/.codex,bind-propagation=rprivate`);
      args.push('--entrypoint',this.owner.program,this.owner.imageId,...request.arguments);
      createAttempted=true;
      const created=await this.call(args,{timeoutMs:10000});
      if(created.code!==0||!CID.test(created.stdout.trim()))throw failure('WORKER_CREATE_UNCONFIRMED');
      containerId=created.stdout.trim();
      const prepared=await this.owned(containerId,executionId);
      const mounts=prepared.Mounts??[],host=prepared.HostConfig??{};
      const expectedMounts=[{source:workspace,destination:'/work'},
        ...codingHome?[{source:codingHome,destination:'/home/worker/.codex'}]:[]];
      if(prepared.Config?.User!==`${this.uid}:${this.gid}`||prepared.Config?.Entrypoint?.[0]!==this.owner.program||
        host.Privileged!==false||host.ReadonlyRootfs!==true||host.PidMode||host.IpcMode!=='private'||
        host.NetworkMode!==(this.owner.egressNetworkId??'none')||host.PidsLimit!==256||
        !(host.CapDrop??[]).includes('ALL')||(host.CapAdd??[]).length||
        !(host.SecurityOpt??[]).some((x:string)=>['no-new-privileges','no-new-privileges=true','no-new-privileges:true'].includes(x))||
        mounts.length!==expectedMounts.length||expectedMounts.some(expected=>!mounts.some((m:any)=>m.Type==='bind'&&m.RW===true&&
          m.Destination===expected.destination&&(m.Source===expected.source||
            process.platform==='darwin'&&m.Source==='/host_mnt'+expected.source))))
        throw failure('WORKER_CONTAINER_PROFILE_UNCONFIRMED');
      if(!await authorized())throw failure('WORKER_APPROVAL_REQUIRED');
      const result=await this.call(['container','start','--attach',containerId],{timeoutMs:request.timeoutMs,signal:request.signal});
      const outputRoot=await mkdtemp(join(this.owner.ownerRoot,'worker-output-'));
      outputPath=join(outputRoot,'stdout');await writeFile(outputPath,result.stdout,{mode:0o600,flag:'wx'});
      const observed=await this.owned(containerId,executionId);
      if(observed.State?.Running!==false||observed.State?.Status!=='exited'||
        !Number.isInteger(observed.State?.ExitCode)||!(Date.parse(observed.State?.StartedAt)>0)||
        result.code!==0&&result.code!==observed.State.ExitCode)throw failure('WORKER_EXIT_UNCONFIRMED');
      const exitCode=observed.State.ExitCode;
      const cleanupConfirmed=await this.remove(containerId,executionId);
      return {executionId,containerId,kind:'exited',exitCode,cleanupConfirmed,outputPath};
    }catch(error){
      reason=request.signal?.aborted?'cancelled':error instanceof Error&&error.message==='WORKER_DOCKER_TIMEOUT'?'timed-out':'failed';
      // A lost create ACK is never another create/start attempt. Only exact
      // execution-label lookup can recover its ID; absence remains uncertain.
      if(!containerId&&createAttempted){try{
        const result=await this.call(['container','ls','--all','--quiet','--no-trunc','--filter',`label=${EXECUTION_LABEL}=${executionId}`],{timeoutMs:10000});
        const ids=result.stdout.trim().split('\n').filter(Boolean);
        if(result.code===0&&ids.length===1&&CID.test(ids[0]))containerId=ids[0];
      }catch{}}
      if(!containerId)return {executionId,kind:createAttempted?'uncertain':reason,cleanupConfirmed:!createAttempted};
      try{
        let state=await this.owned(containerId,executionId);
        if(state.State?.Running){await this.call(['container','kill',containerId],{timeoutMs:10000});state=await this.owned(containerId,executionId);}
        if(state.State?.Running!==false)return {executionId,containerId,kind:'uncertain',cleanupConfirmed:false,outputPath};
        const cleanupConfirmed=await this.remove(containerId,executionId);
        return {executionId,containerId,kind:reason,exitCode:state.State.ExitCode,cleanupConfirmed,outputPath};
      }catch{return {executionId,containerId,kind:'uncertain',cleanupConfirmed:false,outputPath};}
    }
  }
  private async owned(id:string,executionId:string):Promise<any>{
    const value=single(await this.call(['container','inspect',id],{timeoutMs:10000}));
    if(value.Id!==id||value.Config?.Labels?.[EXECUTION_LABEL]!==executionId||value.Image!==this.owner.imageId)
      throw failure('WORKER_CONTAINER_OWNERSHIP_UNCONFIRMED');
    return value;
  }
  private async remove(id:string,executionId:string):Promise<boolean>{
    try{
      if((await this.owned(id,executionId)).State?.Running!==false)return false;
      return (await this.call(['container','rm',id],{timeoutMs:10000})).code===0;
    }catch{return false;}
  }
}

async function directory(path:string,uid:number):Promise<string>{
  if(!isAbsolute(path)||/[\r\n\0,]/.test(path))throw failure('WORKER_PATH_INVALID');
  const resolved=await realpath(path),info=await stat(resolved);
  if(resolved!==path||!info.isDirectory()||info.uid!==uid)throw failure('WORKER_PATH_INVALID');
  return resolved;
}
async function privateRoot(path:string,uid:number):Promise<string>{
  const resolved=await directory(path,uid);
  if((await stat(resolved)).mode&0o077)throw failure('WORKER_PRIVATE_ROOT_INVALID');
  return resolved;
}
function single(result:CallResult):any{
  if(result.code!==0)throw failure('WORKER_DOCKER_OPERATION_FAILED');
  try{const data=JSON.parse(result.stdout);if(Array.isArray(data)&&data.length===1&&data[0]&&typeof data[0]==='object')return data[0];}catch{}
  throw failure('WORKER_DOCKER_RESPONSE_INVALID');
}
function nativeCall(executable:string,endpoint:string,config:string):DockerCall{
  return async(args,options)=>new Promise((resolve,reject)=>{
    const child=spawn(executable,['--host',endpoint,'--config',config,...args],{env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},
      stdio:['ignore','pipe','pipe'],detached:true});
    const chunks:Buffer[]=[];let bytes=0,problem:string|undefined;
    const stop=(code:string)=>{problem??=code;try{process.kill(-child.pid!,'SIGKILL');}catch{child.kill('SIGKILL');}};
    const timer=setTimeout(()=>stop('WORKER_DOCKER_TIMEOUT'),options.timeoutMs);
    const aborted=()=>stop('WORKER_DOCKER_CANCELLED');
    options.signal?.addEventListener('abort',aborted,{once:true});
    if(options.signal?.aborted)aborted();
    child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>1024*1024)stop('WORKER_DOCKER_OUTPUT_LIMIT');else chunks.push(chunk);});
    child.stderr.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>1024*1024)stop('WORKER_DOCKER_OUTPUT_LIMIT');});
    const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',aborted);};
    child.on('error',()=>{cleanup();reject(failure('WORKER_DOCKER_OPERATION_FAILED'));});
    child.on('close',code=>{cleanup();if(problem)reject(failure(problem));else resolve({code:code??-1,stdout:Buffer.concat(chunks).toString()});});
  });
}
