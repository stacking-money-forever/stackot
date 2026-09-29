import {ApprovalRepository,type ApprovalInput,type ApprovalContext} from './approval.ts';
import {createHash} from 'node:crypto';
import type {Json,State,StateStore} from './state/flow-store.ts';

export type StartTarget={agentId:'codex';task:string;cwd:string;runTimeoutSeconds:number};
export type StartReceipt={runId:string;childSessionKey:string};
type Intent={schemaVersion:1;request:ApprovalInput;target:StartTarget;
  phase:'prepared'|'inflight'|'started'|'uncertain'|'superseded';operationId?:string;receipt?:StartReceipt};
/** Owner-code contract, not a claimed OpenClaw plugin API. ready is read-only;
 * spawn must call authorize immediately before its real backing side effect. */
export type OwnerStartExecutor={allows(target:StartTarget):boolean;ready(target:StartTarget):Promise<boolean>;
  spawn(target:StartTarget,operationId:string,authorize:()=>Promise<boolean>):Promise<StartReceipt>};
export type StartResult={kind:'started';receipt:StartReceipt}|{kind:'uncertain'};
export class StartUnavailableError extends Error {
  constructor(message='START_BACKEND_UNAVAILABLE'){super(message);this.name='StartUnavailableError';}
}
function object(value:Json|undefined):State{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('START_STATE_INVALID');return value;
}
function target(value:StartTarget){
  if(value.agentId!=='codex'||typeof value.task!=='string'||!value.task.trim()||
    typeof value.cwd!=='string'||!value.cwd.startsWith('/')||value.cwd.includes('\0')||
    !Number.isSafeInteger(value.runTimeoutSeconds)||value.runTimeoutSeconds<1||value.runTimeoutSeconds>3600)
    throw new Error('START_TARGET_INVALID');
}
function intent(value:Json|undefined):Intent{
  const item=object(value) as unknown as Intent;
  if(item.schemaVersion!==1||!['prepared','inflight','started','uncertain','superseded'].includes(item.phase)||
    !item.request||item.request.action!=='start'||!item.target)throw new Error('START_STATE_INVALID');
  target(item.target);return item;
}
function equal(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
function planMatches(task:State,hash:string,instructions:string){
  return task.planText===instructions&&createHash('sha256').update(instructions).digest('hex')===hash;
}
function receipt(value:StartReceipt){
  if(!value||typeof value.runId!=='string'||!value.runId.trim()||value.runId.length>200||
    typeof value.childSessionKey!=='string'||!value.childSessionKey.trim()||value.childSessionKey.length>500)
    throw new Error('START_RECEIPT_UNCONFIRMED');
  return {runId:value.runId,childSessionKey:value.childSessionKey};
}

/** Explicit positive coding eligibility prevents legacy/no-op approvals gaining
 * execution authority when an owner factory is later installed. Not an RPC. */
export class StartAuthority {
  private readonly guarded:StateStore;
  constructor(private readonly store:StateStore,private readonly executor:OwnerStartExecutor,
    private readonly now=Date.now){
    const read=async()=>{
      const snapshot=await store.read(),task=object(snapshot.state.task);
      if(snapshot.state.schemaVersion!==1||snapshot.cancelRequestedAt!==undefined||
        snapshot.state.executionPolicy!=='coding'||snapshot.state.synthetic===true||
        snapshot.state.qaFingerprint!==undefined||typeof task.id!=='string'||task.id.startsWith('stackot-qa:'))
        throw new Error('START_TASK_DENIED');
      return snapshot;
    };
    this.guarded={read,compareAndSwap:async(revision,state)=>{
      const current=await read();return current.revision===revision&&store.compareAndSwap(revision,state);
    }};
  }
  async prepare(request:ApprovalInput,destination:StartTarget):Promise<void>{
    request={...request};destination={...destination};
    if(request.action!=='start')throw new Error('START_ACTION_REQUIRED');target(destination);
    const frozenRequest={...request},frozenTarget={...destination};
    if(!this.executor.allows({...frozenTarget}))throw new Error('START_TARGET_DENIED');
    const expected:Intent={schemaVersion:1,request:frozenRequest,target:frozenTarget,phase:'prepared'};
    const check=(snapshot:Awaited<ReturnType<StateStore['read']>>)=>{
      const task=object(snapshot.state.task);
      if(task.id!==request.taskId||task.requesterId!==request.requesterId||task.planHash!==request.planHash||
        task.planVersion!==request.planVersion||!planMatches(task,request.planHash,frozenTarget.task)||
        !['planned','waiting'].includes(task.status as string))
        throw new Error('START_TASK_DENIED');
      const entries=snapshot.state.startIntents===undefined?{}:object(snapshot.state.startIntents);
      if(Object.hasOwn(entries,request.requestId)){
        if(!equal(intent(entries[request.requestId]),expected))throw new Error('START_INTENT_CHANGED');
        if(Object.values(entries).filter(raw=>intent(raw).phase!=='superseded').length!==1)
          throw new Error('START_ALREADY_PREPARED');
      }else{
        const active=Object.entries(entries).filter(([,raw])=>intent(raw).phase!=='superseded');
        if(active.length){
          if(active.length!==1)throw new Error('START_ALREADY_PREPARED');
          const [oldId,raw]=active[0]!,old=intent(raw),grant=object(object(snapshot.state.approvals)[oldId]),clock=this.now();
          const unadmittedApproval=grant.status==='pending'||(grant.status==='approved'&&
            grant.decidedBy===request.requesterId&&Number.isSafeInteger(grant.decidedAt)&&
            (grant.decidedAt as number)>=(grant.requestedAt as number)&&(grant.decidedAt as number)<(grant.expiresAt as number)&&
            grant.operationId===undefined&&grant.consumedAt===undefined);
          if(old.phase!=='prepared'||old.operationId!==undefined||old.receipt!==undefined||!unadmittedApproval||
            grant.requestId!==oldId||grant.taskId!==request.taskId||grant.requesterId!==request.requesterId||
            old.request.requestId!==oldId||old.request.taskId!==grant.taskId||old.request.requesterId!==grant.requesterId||
            grant.action!=='start'||grant.planHash!==old.request.planHash||grant.planVersion!==old.request.planVersion||
            !Number.isSafeInteger(grant.requestedAt)||!Number.isSafeInteger(grant.expiresAt)||
            (grant.expiresAt as number)-(grant.requestedAt as number)!==old.request.ttlMs||
            !Number.isSafeInteger(clock)||clock<(grant.expiresAt as number))
            throw new Error('START_ALREADY_PREPARED');
          const renewalKey=createHash('sha256').update(oldId).digest('hex');
          const renewal=object(object(snapshot.state.approvalRenewals)[renewalKey]);
          if(renewal.schemaVersion!==1||!equal(renewal.input,frozenRequest))throw new Error('START_RENEWAL_REQUIRED');
          return {...entries,[oldId]:{...old,phase:'superseded'} as unknown as Json};
        }
      }
      return entries;
    };
    // request validates first; when creating a grant, append its intent to the
    // same CAS so invalid/conflicting input cannot poison task admission.
    const preparation:StateStore={read:async()=>{const snapshot=await this.guarded.read();check(snapshot);return snapshot;},
      compareAndSwap:async(revision,next)=>{
        const snapshot=await this.guarded.read();if(snapshot.revision!==revision)return false;
        const entries=check(snapshot);
        return this.guarded.compareAndSwap(revision,{...next,
          startIntents:{...entries,[request.requestId]:expected as unknown as Json}});
      }};
    const result=await new ApprovalRepository(preparation,this.now).request(frozenRequest);
    if(result.created)return;
    // An existing pending grant may predate owner preparation. Attach only if
    // that exact validated grant is still unchanged in the CAS snapshot.
    for(let attempt=0;attempt<4;attempt++){
      const snapshot=await this.guarded.read(),entries=check(snapshot);
      if(Object.hasOwn(entries,request.requestId))return;
      if(!equal(object(snapshot.state.approvals)[request.requestId],result.approval)){
        throw new Error('START_APPROVAL_CHANGED');
      }
      if(await this.guarded.compareAndSwap(snapshot.revision,{...snapshot.state,
        startIntents:{...entries,[request.requestId]:expected as unknown as Json}}))return;
    }
    throw new Error('START_WRITE_CONFLICT');
  }
  async execute(context:ApprovalContext,operationId:string):Promise<StartResult>{
    context={...context};
    if(context.action!=='start'||!/^[a-zA-Z0-9_-]{1,80}$/.test(operationId))throw new Error('START_CONTEXT_INVALID');
    const initial=await this.guarded.read(),item=intent(object(initial.state.startIntents)[context.requestId]);
    const task=object(initial.state.task);
    if(item.request.requestId!==context.requestId||item.request.taskId!==context.taskId||
      item.request.requesterId!==context.actorId||item.request.planHash!==context.planHash||
      item.request.planVersion!==context.planVersion||task.id!==context.taskId||task.requesterId!==context.actorId||
      task.planHash!==context.planHash||task.planVersion!==context.planVersion||
      !planMatches(task,context.planHash,item.target.task))throw new Error('START_BINDING_DENIED');
    if(item.phase!=='prepared'){
      if(item.operationId!==operationId)throw new Error('START_ALREADY_ADMITTED');
      return item.phase==='started'?{kind:'started',receipt:receipt(item.receipt!)}:{kind:'uncertain'};
    }
    if(!this.executor.allows({...item.target}))throw new Error('START_TARGET_DENIED');
    // No backend lookup before an actual approved grant. Full S27 predicates
    // are checked again in consume after the potentially slow readiness probe.
    const approvals=new ApprovalRepository(this.guarded,this.now),grant=await approvals.get(context.requestId),clock=this.now();
    if(!grant||grant.status!=='approved'||grant.decidedBy!==context.actorId||
      grant.action!=='start'||!Number.isSafeInteger(clock)||clock<grant.decidedAt||clock>=grant.expiresAt)
      throw new Error('START_APPROVAL_REQUIRED');
    let ready=false;try{ready=await this.executor.ready({...item.target});}catch{}
    if(!ready)throw new StartUnavailableError();
    // The grant consumption and inflight marker are ONE native CAS write. Lost
    // persistence acknowledgement cannot become permission to dispatch/retry.
    const atomic:StateStore={read:()=>this.guarded.read(),compareAndSwap:async(revision,next)=>{
      const current=await this.guarded.read(),old=intent(object(current.state.startIntents)[context.requestId]);
      if(current.revision!==revision)return false;
      const consumed=object(object(next.approvals)[context.requestId]);
      if(!equal(old,item)||old.phase!=='prepared'||consumed.status!=='consumed'||
        consumed.operationId!==operationId)throw new Error('START_ADMISSION_CHANGED');
      return this.guarded.compareAndSwap(revision,{...next,startIntents:{...object(current.state.startIntents),
        [context.requestId]:{...item,phase:'inflight',operationId} as unknown as Json}});
    }};
    try{await new ApprovalRepository(atomic,this.now).consume(context,operationId);}catch{return {kind:'uncertain'};}
    const authorize=async()=>{
      try{
        const fresh=await this.guarded.read(),current=intent(object(fresh.state.startIntents)[context.requestId]);
        const active=object(fresh.state.task),used=await approvals.get(context.requestId),at=this.now();
        return current.phase==='inflight'&&current.operationId===operationId&&equal(current.target,item.target)&&
          equal(current.request,item.request)&&active.id===context.taskId&&active.requesterId===context.actorId&&
          active.planHash===context.planHash&&active.planVersion===context.planVersion&&
          planMatches(active,context.planHash,item.target.task)&&
          ['planned','waiting'].includes(active.status as string)&&used?.status==='consumed'&&
          used.operationId===operationId&&used.decidedBy===context.actorId&&Number.isSafeInteger(at)&&
          at>=used.consumedAt&&at<used.expiresAt&&this.executor.allows({...item.target});
      }catch{return false;}
    };
    try{
      if(!await authorize())throw new Error('START_DISPATCH_DENIED');
      const observed=receipt(await this.executor.spawn({...item.target},operationId,authorize));
      await this.record(context.requestId,item,operationId,'started',observed);
      return {kind:'started',receipt:observed};
    }catch{
      try{await this.record(context.requestId,item,operationId,'uncertain');}catch{}
      return {kind:'uncertain'};
    }
  }
  private async record(id:string,expected:Intent,operationId:string,phase:'started'|'uncertain',observed?:StartReceipt){
    for(let attempt=0;attempt<4;attempt++){
      const snapshot=await this.guarded.read(),entries=object(snapshot.state.startIntents),current=intent(entries[id]);
      if(current.phase!=='inflight'||current.operationId!==operationId||!equal(current.request,expected.request)||
        !equal(current.target,expected.target))throw new Error('START_ADMISSION_CHANGED');
      const task=object(snapshot.state.task);
      if(task.id!==expected.request.taskId||task.requesterId!==expected.request.requesterId||
        task.planHash!==expected.request.planHash||task.planVersion!==expected.request.planVersion||
        !planMatches(task,expected.request.planHash,expected.target.task))
        throw new Error('START_TASK_CHANGED');
      const next={...snapshot.state,startIntents:{...entries,[id]:{...current,phase,...observed?{receipt:observed}:{}} as unknown as Json}};
      if(await this.guarded.compareAndSwap(snapshot.revision,next))return;
    }
    throw new Error('START_WRITE_CONFLICT');
  }
}
