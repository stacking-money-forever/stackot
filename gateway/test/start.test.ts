/** Fake backing executor/native contexts: S only, not actual ACP or auth. */
import {test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {ApprovalRenewal} from '../src/renewal.ts';
import {StartAuthority,type OwnerStartExecutor,type StartTarget} from '../src/start.ts';
import {ApprovalRepository,type ApprovalInput} from '../src/approval.ts';
import {attachNativeStart} from '../src/native-start.ts';
import {registerApprovalCallbacks,type CallbackBinding,type InteractiveApi} from '../src/callback.ts';
import type {State,StateStore} from '../src/state/flow-store.ts';

class Store implements StateStore{
  revision=0;state:State={};cancelRequestedAt:number|undefined;
  afterCommit?: (state:State)=>void;
  async read(){return {revision:this.revision,state:structuredClone(this.state),cancelRequestedAt:this.cancelRequestedAt};}
  async compareAndSwap(revision:number,state:State){
    if(revision!==this.revision)return false;
    this.state=structuredClone(state);this.revision++;this.afterCommit?.(this.state);return true;
  }
}
async function fixture(){
  const store=new Store();let now=Date.now(),ready=true,readiness=0,spawns=0;
  const request:ApprovalInput={requestId:'start-task',taskId:'owner/repo#7',requesterId:'111',
    planHash:createHash('sha256').update('Owner fixed task').digest('hex'),planVersion:1,action:'start',ttlMs:60000};
  const context={requestId:request.requestId,taskId:request.taskId,planHash:request.planHash,
    planVersion:request.planVersion,action:'start' as const,actorId:request.requesterId};
  const destination:StartTarget={agentId:'codex',task:'Owner fixed task',cwd:'/approved/worktree',runTimeoutSeconds:60};
  store.state={schemaVersion:1,executionPolicy:'coding',task:{id:request.taskId,requesterId:request.requesterId,
    planHash:request.planHash,planVersion:1,status:'waiting',planText:'Owner fixed task'}};
  const executor:OwnerStartExecutor={allows:value=>JSON.stringify(value)===JSON.stringify(destination),
    ready:async()=>{readiness++;return ready;},spawn:async(value,operationId,authorize)=>{
      expect(await authorize()).toBe(true);expect(value).toEqual(destination);expect(operationId).toBe('operation');
      spawns++;return {runId:'native-run',childSessionKey:'agent:codex:child'};
    }};
  const authority=new StartAuthority(store,executor,()=>now),approvals=new ApprovalRepository(store,()=>now);
  await authority.prepare(request,destination);
  return {store,request,context,destination,executor,authority,approvals,
    approve:()=>approvals.decide(context,'approve'),counts:()=>({readiness,spawns}),
    clock:(value:number)=>{now=value;},now:()=>now,unready:()=>{ready=false;},available:()=>{ready=true;},spawned:()=>{spawns++;}};
}
test('pending, denied, wrong actor/plan/action and expired grants have zero spawn',async()=>{
  const pending=await fixture();await expect(pending.authority.execute(pending.context,'operation')).rejects.toThrow();
  expect(pending.counts()).toEqual({readiness:0,spawns:0});
  const denied=await fixture();await denied.approvals.decide(denied.context,'deny');
  await expect(denied.authority.execute(denied.context,'operation')).rejects.toThrow();expect(denied.counts().spawns).toBe(0);
  for(const delta of [{actorId:'222'},{planVersion:2},{action:'push' as const}]){
    const f=await fixture();await f.approve();await expect(f.authority.execute({...f.context,...delta},'operation')).rejects.toThrow();
    expect(f.counts()).toEqual({readiness:0,spawns:0});
  }
  const expired=await fixture();const a=await expired.approve();expired.clock(a.expiresAt);
  await expect(expired.authority.execute(expired.context,'operation')).rejects.toThrow();expect(expired.counts().spawns).toBe(0);
});
test('only explicitly eligible coding tasks prepare; QA/no-op/cancel never execute',async()=>{
  for(const change of ['absent-policy','synthetic','fingerprint','qa-id','cancel']){
    const f=await fixture();await f.approve();
    if(change==='absent-policy')delete f.store.state.executionPolicy;
    if(change==='synthetic')f.store.state.synthetic=true;
    if(change==='fingerprint')f.store.state.qaFingerprint='fixture';
    if(change==='qa-id')(f.store.state.task as State).id='stackot-qa:fixture';
    if(change==='cancel')f.store.cancelRequestedAt=Date.now();
    await expect(f.authority.execute(f.context,'operation')).rejects.toThrow();expect(f.counts().spawns).toBe(0);
  }
});
test('unavailable backend does not consume approval or spawn',async()=>{
  const f=await fixture();await f.approve();f.unready();
  await expect(f.authority.execute(f.context,'operation')).rejects.toThrow('START_BACKEND_UNAVAILABLE');
  expect((await f.approvals.get(f.request.requestId))?.status).toBe('approved');expect(f.counts().spawns).toBe(0);
});
test('consumption and inflight intent commit together; concurrent/replayed calls spawn once',async()=>{
  const f=await fixture();await f.approve();let admissions=0;
  f.store.afterCommit=state=>{
    const grant=(state.approvals as State)[f.request.requestId] as State;
    if(grant.status==='consumed'){
      const intent=(state.startIntents as State)[f.request.requestId] as State;
      expect(intent.operationId).toBe(grant.operationId);expect(intent.phase).not.toBe('prepared');
      if(intent.phase==='inflight')admissions++;
    }
  };
  const results=await Promise.all([f.authority.execute(f.context,'operation'),f.authority.execute(f.context,'operation')]);
  expect(results.some(x=>x.kind==='started')).toBe(true);expect(admissions).toBe(1);expect(f.counts().spawns).toBe(1);
  expect(await new StartAuthority(f.store,f.executor).execute(f.context,'operation')).toEqual({kind:'started',receipt:{runId:'native-run',childSessionKey:'agent:codex:child'}});
  expect(f.counts().spawns).toBe(1);
  await expect(f.authority.execute(f.context,'new-operation')).rejects.toThrow('START_ALREADY_ADMITTED');
});
test('lost durable admission acknowledgement never spawns or retries',async()=>{
  const f=await fixture();await f.approve();
  f.store.afterCommit=state=>{
    if(((state.approvals as State)[f.request.requestId] as State).status==='consumed'){
      f.store.afterCommit=undefined;throw new Error('lost persistence ack');
    }
  };
  expect(await f.authority.execute(f.context,'operation')).toEqual({kind:'uncertain'});
  expect((await f.approvals.get(f.request.requestId))?.status).toBe('consumed');
  expect(((f.store.state.startIntents as State)[f.request.requestId] as State).phase).toBe('inflight');
  expect(await new StartAuthority(f.store,f.executor).execute(f.context,'operation')).toEqual({kind:'uncertain'});
  expect(f.counts().spawns).toBe(0);
});
test('lost spawn acknowledgement remains durable uncertain, without automatic retry',async()=>{
  const f=await fixture();await f.approve();f.executor.spawn=async(_target,_id,authorize)=>{
    expect(await authorize()).toBe(true);f.spawned();throw new Error('private backing error');
  };
  expect(await f.authority.execute(f.context,'operation')).toEqual({kind:'uncertain'});
  expect(((f.store.state.startIntents as State)[f.request.requestId] as State).phase).toBe('uncertain');
  expect(await new StartAuthority(f.store,f.executor).execute(f.context,'operation')).toEqual({kind:'uncertain'});
  expect(f.counts().spawns).toBe(1);
});
test('readiness-time plan/expiry and transport-time cancellation changes prevent spawn',async()=>{
  for(const change of ['plan','expiry','cancel']){
    const f=await fixture();const approved=await f.approve();
    if(change==='plan')f.executor.ready=async()=>{(f.store.state.task as State).planVersion=2;return true;};
    if(change==='expiry')f.executor.ready=async()=>{f.clock(approved.expiresAt);return true;};
    if(change==='cancel')f.executor.spawn=async(_target,_id,authorize)=>{
      f.store.cancelRequestedAt=Date.now();expect(await authorize()).toBe(false);throw new Error('cancelled');
    };
    expect(await f.authority.execute(f.context,'operation')).toEqual({kind:'uncertain'});expect(f.counts().spawns).toBe(0);
  }
});
test('a second start intent or changed pinned target is refused',async()=>{
  const f=await fixture();
  await expect(f.authority.prepare({...f.request,requestId:'second'},f.destination)).rejects.toThrow('START_ALREADY_PREPARED');
  await expect(f.authority.prepare(f.request,{...f.destination,task:'different'})).rejects.toThrow('START_TARGET_DENIED');
});
test('allowed target instructions must equal the approved full plan and hash',async()=>{
  const f=await fixture();delete f.store.state.startIntents;delete f.store.state.approvals;
  f.executor.allows=()=>true;
  await expect(f.authority.prepare(f.request,{...f.destination,task:'Unapproved instructions'})).rejects.toThrow('START_TASK_DENIED');
  expect(f.store.state.startIntents).toBeUndefined();expect(f.store.state.approvals).toBeUndefined();
  await f.authority.prepare(f.request,f.destination);await f.approve();
  (f.store.state.task as State).planText='Changed text with stale hash';
  await expect(f.authority.execute(f.context,'operation')).rejects.toThrow('START_BINDING_DENIED');
  expect(f.counts().spawns).toBe(0);
});
test('invalid or conflicting grant preparation cannot leave an orphan intent',async()=>{
  for(const change of ['invalid','conflict']){
    const f=await fixture();delete f.store.state.startIntents;
    if(change==='invalid')delete f.store.state.approvals;
    const before=structuredClone(f.store.state),revision=f.store.revision;
    await expect(f.authority.prepare({...f.request,ttlMs:change==='invalid'?0:1000},f.destination)).rejects.toThrow();
    expect(f.store.state).toEqual(before);expect(f.store.revision).toBe(revision);
    await f.authority.prepare(f.request,f.destination);
    expect(((f.store.state.startIntents as State)[f.request.requestId] as State).phase).toBe('prepared');
    expect((await f.approvals.get(f.request.requestId))?.status).toBe('pending');
  }
});
async function callbackFixture(){
  const f=await fixture();let factories=0;
  const binding:CallbackBinding={token:'6f028276-12ad-4d80-9418-614ecf8b9e50',accountId:'default',guildId:'111',
    conversationId:'channel:222',parentConversationId:'333',messageId:'444',request:f.request,decision:'approve',repository:f.approvals};
  attachNativeStart(binding,f.store,async()=>{
    factories++;expect((await f.approvals.get(f.request.requestId))?.status).toBe('approved');
    return {executor:f.executor,operationId:'operation'};
  });
  let registration!:Parameters<InteractiveApi['registerInteractiveHandler']>[0];const replies:string[]=[],audits:string[]=[];
  registerApprovalCallbacks({registerInteractiveHandler:value=>{registration=value;}},{resolve:async()=>binding},event=>{audits.push(event.outcome);});
  const context={channel:'discord',accountId:'default',guildId:'111',conversationId:'channel:222',parentConversationId:'333',
    senderId:'111',auth:{isAuthorizedSender:true},interaction:{kind:'button',messageId:'444',data:'stackot-approval:'+binding.token,
      payload:binding.token,namespace:'stackot-approval'},respond:{reply:async(value:{text:string})=>{replies.push(value.text);}}};
  return {...f,binding,registration,context,replies,audits,factories:()=>factories};
}
test('genuine renewal supersedes only an expired unadmitted intent and preserves its history',async()=>{
  const f=await fixture();const old=await f.approvals.get(f.request.requestId);f.clock(old!.expiresAt+1);
  const route={accountId:'default',guildId:'111',conversationId:'channel:222',parentConversationId:'333'};
  const sent={channel:'discord' as const,messageId:'444',target:{kind:'channel' as const,id:'222'}};
  const transport={sendPlan:async()=>sent,sendCard:async(_spec:unknown,_check:unknown,record:(r:typeof sent)=>Promise<void>)=>{await record(sent);return sent;},editCard:async()=>sent};
  expect((await new ApprovalRenewal(f.store,transport,f.now,86400000,
    (bound,input)=>new StartAuthority(bound,f.executor,f.now).prepare(input,f.destination)).reissue(f.request,route,'111')).kind).toBe('published');
  const key=createHash('sha256').update(f.request.requestId).digest('hex');
  const next=((f.store.state.approvalRenewals as State)[key] as State).input as unknown as ApprovalInput;
  await f.authority.prepare(next,f.destination);
  expect(((f.store.state.startIntents as State)[f.request.requestId] as State).phase).toBe('superseded');
  expect(await f.approvals.get(f.request.requestId)).toEqual(old);
  const ctx={...f.context,requestId:next.requestId};await f.approvals.decide(ctx,'approve');
  expect((await f.authority.execute(ctx,'operation')).kind).toBe('started');expect(f.counts().spawns).toBe(1);
  await expect(f.authority.execute(f.context,'operation')).rejects.toThrow('START_ALREADY_ADMITTED');
});
test('expired but unlinked or already admitted intents cannot be replaced by a fresh grant',async()=>{
  for(const change of ['unlinked','inflight','uncertain','started']){
    const f=await fixture();const old=await f.approvals.get(f.request.requestId);f.clock(old!.expiresAt+1);
    const item=(f.store.state.startIntents as State)[f.request.requestId] as State;
    if(change!=='unlinked'){item.phase=change;item.operationId='old-operation';}
    await expect(f.authority.prepare({...f.request,requestId:'fresh'},f.destination)).rejects.toThrow();
    expect(f.counts().spawns).toBe(0);expect(Object.keys(f.store.state.startIntents as State)).toHaveLength(1);
  }
});
test('coding renewal prepares before its card is actionable and missing preparation publishes no card',async()=>{
  for(const configured of [true,false]){
    const f=await fixture();f.clock((await f.approvals.get(f.request.requestId))!.expiresAt+1);let cards=0;
    const route={accountId:'default',guildId:'111',conversationId:'channel:222',parentConversationId:'333'};
    const sent={channel:'discord' as const,messageId:'444',target:{kind:'channel' as const,id:'222'}};
    const transport={sendPlan:async()=>sent,sendCard:async(_spec:unknown,_check:unknown,record:(r:typeof sent)=>Promise<void>)=>{
      cards++;const id=Object.keys(f.store.state.approvals as State).find(x=>x!==f.request.requestId)!;
      expect(((f.store.state.startIntents as State)[id] as State).phase).toBe('prepared');
      await record(sent);return sent;
    },editCard:async()=>sent};
    const service=new ApprovalRenewal(f.store,transport,f.now,86400000,configured?
      (bound,input)=>new StartAuthority(bound,f.executor,f.now).prepare(input,f.destination):undefined);
    if(configured){
      expect((await service.reissue(f.request,route,'111')).kind).toBe('published');
      const id=Object.keys(f.store.state.approvals as State).find(x=>x!==f.request.requestId)!;
      await f.approvals.decide({...f.context,requestId:id},'approve');
      expect((await f.authority.execute({...f.context,requestId:id},'operation')).kind).toBe('started');expect(f.counts().spawns).toBe(1);
    }else{await expect(service.reissue(f.request,route,'111')).rejects.toThrow('START_PREPARATION_UNAVAILABLE');expect(f.counts().spawns).toBe(0);}
    expect(cards).toBe(configured?1:0);
  }
});
test('approved start expiring during a pre-admission outage can renew, but admitted starts cannot',async()=>{
  for(const phase of ['prepared','inflight','started','uncertain']){
    const f=await fixture();const approved=await f.approve();f.clock(approved.expiresAt+1);let cards=0;
    if(phase!=='prepared'){
      const entry=(f.store.state.startIntents as State)[f.request.requestId] as State;entry.phase=phase;entry.operationId='admitted';
    }
    const route={accountId:'default',guildId:'111',conversationId:'channel:222',parentConversationId:'333'};
    const sent={channel:'discord' as const,messageId:'444',target:{kind:'channel' as const,id:'222'}};
    const transport={sendPlan:async()=>sent,sendCard:async(_spec:unknown,_check:unknown,record:(r:typeof sent)=>Promise<void>)=>{cards++;await record(sent);return sent;},editCard:async()=>sent};
    const service=new ApprovalRenewal(f.store,transport,f.now,86400000,
      (bound,input)=>new StartAuthority(bound,f.executor,f.now).prepare(input,f.destination));
    if(phase==='prepared'){
      expect((await service.reissue(f.request,route,'111')).kind).toBe('published');
      expect(await f.approvals.get(f.request.requestId)).toEqual(approved);
      const id=Object.keys(f.store.state.approvals as State).find(x=>x!==f.request.requestId)!;
      await f.approvals.decide({...f.context,requestId:id},'approve');
      expect((await f.authority.execute({...f.context,requestId:id},'operation')).kind).toBe('started');expect(f.counts().spawns).toBe(1);
    }else{await expect(service.reissue(f.request,route,'111')).rejects.toThrow('RENEWAL_ORIGINAL_DENIED');expect(f.counts().spawns).toBe(0);}
    expect(cards).toBe(phase==='prepared'?1:0);
  }
});
test('native callback auth/actor/message guards precede start factory lookup',async()=>{
  for(const delta of [{auth:{isAuthorizedSender:false}},{senderId:'222'},{interaction:{kind:'button',messageId:'555'}}]){
    const f=await callbackFixture();await f.registration.handler({...f.context,...delta});
    expect(f.factories()).toBe(0);expect(f.counts().spawns).toBe(0);expect((await f.approvals.get(f.request.requestId))?.status).toBe('pending');
  }
});
test('native approval commits before start dispatch; old QA and denial do not gain execution',async()=>{
  const f=await callbackFixture();await f.registration.handler(f.context);
  expect(f.factories()).toBe(1);expect(f.counts().spawns).toBe(1);expect(f.audits[0]).toBe('start_started');
  expect(f.replies[0]).toContain('worker 시작을 확인했습니다');
  await f.registration.handler(f.context);expect(f.counts().spawns).toBe(1);
  const qa=await callbackFixture();qa.store.state.synthetic=true;await qa.registration.handler(qa.context);
  expect(qa.factories()).toBe(0);expect(qa.counts().spawns).toBe(0);expect(qa.audits[0]).toBe('start_uncertain');
  const denied=await callbackFixture();denied.binding.dispatchStart=undefined;denied.binding.decision='deny';
  attachNativeStart(denied.binding,denied.store,async()=>{throw new Error('must not run');});
  expect(denied.binding.dispatchStart).toBeUndefined();
});
test('known pre-admission outage recovers through the same authenticated callback without changing its approval',async()=>{
  const f=await callbackFixture();f.unready();await f.registration.handler(f.context);
  const approved=await f.approvals.get(f.request.requestId);
  expect(approved?.status).toBe('approved');expect(f.audits[0]).toBe('start_waiting');expect(f.counts().spawns).toBe(0);
  expect(f.replies[0]).toContain('다시 누르면');f.available();await f.registration.handler(f.context);
  expect(f.counts().spawns).toBe(1);expect(f.factories()).toBe(2);expect(f.audits[1]).toBe('start_started');
  const consumed=await f.approvals.get(f.request.requestId);
  expect(consumed!.status==='consumed'&&consumed!.decidedAt).toBe(approved!.status==='approved'&&approved!.decidedAt);
  await f.registration.handler(f.context);expect(f.counts().spawns).toBe(1);expect(f.factories()).toBe(2);
});
test('missing factory can recover, while uncertain spawn and wrong/expired retry cannot dispatch again',async()=>{
  const missing=await callbackFixture();let available=false;
  attachNativeStart(missing.binding,missing.store,async()=>available?{executor:missing.executor,operationId:'operation'}:undefined);
  await missing.registration.handler(missing.context);expect(missing.audits[0]).toBe('start_waiting');expect(missing.counts().spawns).toBe(0);
  available=true;await missing.registration.handler(missing.context);expect(missing.counts().spawns).toBe(1);
  const uncertain=await callbackFixture();uncertain.executor.spawn=async()=>{uncertain.spawned();throw new Error('lost ack');};
  await uncertain.registration.handler(uncertain.context);await uncertain.registration.handler(uncertain.context);
  expect(uncertain.counts().spawns).toBe(1);expect(uncertain.factories()).toBe(1);expect(uncertain.audits[0]).toBe('start_uncertain');
  const denied=await callbackFixture();denied.unready();await denied.registration.handler(denied.context);denied.available();
  await denied.registration.handler({...denied.context,senderId:'222'});expect(denied.counts().spawns).toBe(0);expect(denied.factories()).toBe(1);
  denied.clock((await denied.approvals.get(denied.request.requestId))!.expiresAt);
  await denied.registration.handler(denied.context);expect(denied.counts().spawns).toBe(0);expect(denied.factories()).toBe(1);
});
test('a provider error sharing already-decided text cannot authorize recovery',async()=>{
  const f=await callbackFixture();await f.approve();
  f.binding.repository.decide=async()=>{throw new Error('APPROVAL_ALREADY_DECIDED');};
  await f.registration.handler(f.context);expect(f.factories()).toBe(0);expect(f.counts().spawns).toBe(0);
});
