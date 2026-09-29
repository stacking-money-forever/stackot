import {ApprovalRepository,type ApprovalInput,type ApprovalContext} from "./approval.ts";
import type {Json,State,StateStore} from "./state/flow-store.ts";

export type PushTarget={repo:string;branch:string;commitSha:string};
type Intent={schemaVersion:1;request:ApprovalInput;target:PushTarget;operationId?:string;
  phase:"prepared"|"inflight"|"sent"|"uncertain"};
/** Trusted owner dependencies only, never supplied by a worker/model/RPC. */
export type OwnerPushBroker={
  allows(target:PushTarget):boolean;
  verifyRevision(target:PushTarget):Promise<boolean>;
  credentialForRepo(repo:string):Promise<string>;
  push(target:PushTarget,credential:string):Promise<{remoteSha:string}>;
};
function object(value:Json|undefined):State{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("PUSH_STATE_INVALID");return value;
}
function target(value:PushTarget){
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repo)||!/^[0-9a-f]{40}$/.test(value.commitSha)||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value.branch)||value.branch.includes('..')||
    value.branch.endsWith('/')||value.branch.endsWith('.lock')||['main','master'].includes(value.branch))
    throw new Error("PUSH_TARGET_INVALID");
}
function intent(value:Json|undefined):Intent{
  const item=object(value) as unknown as Intent;
  if(item.schemaVersion!==1||!['prepared','inflight','sent','uncertain'].includes(item.phase)||
    !item.request||item.request.action!=="push"||!item.target)throw new Error("PUSH_STATE_INVALID");
  target(item.target);return item;
}

// This gate assumes a native-authenticated controller supplies actorId. Neither
// this context shape nor an injected verifier is an authentication boundary.
export class PushAuthority {
  private readonly approvals:ApprovalRepository;
  private readonly guarded:StateStore;
  constructor(private readonly store:StateStore,private readonly broker:OwnerPushBroker,
    private readonly now=Date.now){
    const read=async()=>{const snapshot=await store.read();if(snapshot.cancelRequestedAt!==undefined)throw new Error("FLOW_CANCEL_REQUESTED");return snapshot;};
    this.guarded={read,compareAndSwap:async(revision,state)=>{const current=await read();if(current.revision!==revision)return false;return store.compareAndSwap(revision,state);}};
    this.approvals=new ApprovalRepository(this.guarded,now);
  }
  async prepare(request:ApprovalInput,destination:PushTarget):Promise<void>{
    if(request.action!=="push")throw new Error("PUSH_ACTION_REQUIRED");target(destination);
    if(!this.broker.allows(destination))throw new Error("PUSH_TARGET_DENIED");
    let verified=false;try{verified=await this.broker.verifyRevision(destination);}catch{}
    if(!verified)throw new Error("PUSH_REVISION_UNVERIFIED");
    const expected:Intent={schemaVersion:1,request:{requestId:request.requestId,taskId:request.taskId,requesterId:request.requesterId,
      planHash:request.planHash,planVersion:request.planVersion,action:request.action,ttlMs:request.ttlMs},
      target:{repo:destination.repo,branch:destination.branch,commitSha:destination.commitSha},phase:"prepared"};
    for(let attempt=0;attempt<4;attempt++){
      const snapshot=await this.guarded.read(),task=object(snapshot.state.task);
      if(snapshot.state.schemaVersion!==1||snapshot.cancelRequestedAt!==undefined||
        task.id!==request.taskId||task.requesterId!==request.requesterId||task.planHash!==request.planHash||
        task.planVersion!==request.planVersion||!['planned','waiting','running'].includes(task.status as string))
        throw new Error("PUSH_TASK_DENIED");
      const table=snapshot.state.pushIntents===undefined?{}:object(snapshot.state.pushIntents);
      if(Object.hasOwn(table,request.requestId)){
        const old=intent(table[request.requestId]);
        if(JSON.stringify(old.request)!==JSON.stringify(expected.request)||JSON.stringify(old.target)!==JSON.stringify(expected.target))
          throw new Error("PUSH_INTENT_CHANGED");
        break;
      }
      if(await this.guarded.compareAndSwap(snapshot.revision,{...snapshot.state,
        pushIntents:{...table,[request.requestId]:expected as unknown as Json}}))break;
      if(attempt===3)throw new Error("PUSH_WRITE_CONFLICT");
    }
    await this.approvals.request(request);
  }
  async execute(context:ApprovalContext,operationId:string):Promise<{kind:"sent"|"uncertain";commitSha:string}>{
    if(context.action!=="push")throw new Error("PUSH_ACTION_REQUIRED");
    const snapshot=await this.guarded.read();
    const item=intent(object(snapshot.state.pushIntents)[context.requestId]);
    if(item.phase!=="prepared"||item.request.requestId!==context.requestId||item.request.taskId!==context.taskId||
      item.request.planHash!==context.planHash||item.request.planVersion!==context.planVersion||
      item.request.requesterId!==context.actorId)throw new Error("PUSH_AUTHORITY_DENIED");
    const grant=await this.approvals.get(context.requestId),clock=this.now();
    if(!grant||grant.status!=="approved"||grant.requesterId!==context.actorId||
      !Number.isSafeInteger(clock)||clock<grant.requestedAt||clock>=grant.expiresAt)throw new Error("PUSH_APPROVAL_REQUIRED");
    if(!this.broker.allows(item.target))throw new Error("PUSH_TARGET_DENIED");
    let verified=false;try{verified=await this.broker.verifyRevision(item.target);}catch{}
    if(!verified)throw new Error("PUSH_REVISION_UNVERIFIED");
    // Revalidate all S27 predicates after owner verification. This consumed
    // decision is not exactly-once external execution; lost acknowledgements
    // require owner reconciliation, never a fresh dispatch from this method.
    await this.approvals.consume(context,operationId);
    await this.record(context.requestId,item,"prepared","inflight",operationId);
    try{
      const credential=await this.broker.credentialForRepo(item.target.repo);
      if(!credential.trim()||/^<[^<>]*>$/.test(credential))throw new Error("CREDENTIAL_INVALID");
      const fresh=await this.guarded.read(),task=object(fresh.state.task);
      const current=intent(object(fresh.state.pushIntents)[context.requestId]);
      const consumed=await this.approvals.get(context.requestId);
      if(current.phase!=="inflight"||current.operationId!==operationId||JSON.stringify(current.target)!==JSON.stringify(item.target)||
        task.id!==context.taskId||task.requesterId!==context.actorId||task.planHash!==context.planHash||
        task.planVersion!==context.planVersion||!['planned','waiting','running'].includes(task.status as string)||
        !consumed||consumed.status!=="consumed"||consumed.operationId!==operationId||this.now()>=consumed.expiresAt||
        !this.broker.allows(item.target))throw new Error("PUSH_DISPATCH_DENIED");
      const result=await this.broker.push({...item.target},credential);
      if(result.remoteSha!==item.target.commitSha)throw new Error("REMOTE_REVISION_MISMATCH");
      await this.record(context.requestId,item,"inflight","sent",operationId);
      return {kind:"sent",commitSha:item.target.commitSha};
    }catch{
      try{await this.record(context.requestId,item,"inflight","uncertain",operationId);}catch{}
      return {kind:"uncertain",commitSha:item.target.commitSha};
    }
  }
  private async record(id:string,expected:Intent,from:Intent['phase'],to:Intent['phase'],operationId:string){
    for(let attempt=0;attempt<4;attempt++){
      const snapshot=await this.guarded.read(),table=object(snapshot.state.pushIntents),current=intent(table[id]);
      if(JSON.stringify(current.request)!==JSON.stringify(expected.request)||JSON.stringify(current.target)!==JSON.stringify(expected.target)||
        current.phase!==from||(current.operationId!==undefined&&current.operationId!==operationId))throw new Error("PUSH_INTENT_CHANGED");
      if(await this.guarded.compareAndSwap(snapshot.revision,{...snapshot.state,
        pushIntents:{...table,[id]:{...current,phase:to,operationId} as unknown as Json}}))return;
    }
    throw new Error("PUSH_WRITE_CONFLICT");
  }
}

/** Environmental minimization only; same-UID filesystem/keychain access needs
 * the real worker sandbox/identity boundary and cannot be proven by this map. */
export function workerEnvironment(base:Record<string,string|undefined>):Record<string,string>{
  const result:Record<string,string>={};
  for(const key of ['PATH','HOME','TMPDIR','SHELL','LANG','LC_ALL'])if(base[key]!==undefined)result[key]=base[key]!;
  return {...result,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
}
