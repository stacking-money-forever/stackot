import {createHash,randomUUID} from "node:crypto";
import {ApprovalRepository,type ApprovalInput} from "./approval.ts";
import {ApprovalPromptPublisher,type PromptRoute,type PromptTransport,type PromptResult} from "./prompt.ts";
import type {Json,State,StateStore} from "./state/flow-store.ts";

function object(value:Json|undefined):State{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("RENEWAL_STATE_INVALID");
  return value;
}
type Renewal={schemaVersion:1;routeFingerprint:string;input:ApprovalInput};

/** Server-only issuer. Caller identity comes from the private native callback. */
export class ApprovalRenewal {
  constructor(private readonly store:StateStore,private readonly transport:PromptTransport,
    private readonly now=Date.now,private readonly ttlMs=86_400_000,
    private readonly beforePublish?:(store:StateStore,input:ApprovalInput)=>Promise<void>){}
  async reissue(original:ApprovalInput,route:PromptRoute,actorId:string):Promise<PromptResult>{
    return this.issue(original,route,actorId,new Set());
  }
  private async issue(original:ApprovalInput,route:PromptRoute,actorId:string,ancestry:Set<string>):Promise<PromptResult>{
    if(ancestry.has(original.requestId)||ancestry.size>=16)throw new Error("RENEWAL_CHAIN_INVALID");
    ancestry.add(original.requestId);
    if(actorId!==original.requesterId)throw new Error("RENEWAL_ACTOR_DENIED");
    const id=(value:string)=>/^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<=18_446_744_073_709_551_615n;
    if(!route.accountId?.trim()||!id(route.guildId)||!id(route.parentConversationId)||
      !route.conversationId.startsWith("channel:")||!id(route.conversationId.slice(8)))throw new Error("RENEWAL_ROUTE_INVALID");
    if(!Number.isSafeInteger(this.ttlMs)||this.ttlMs<1||this.ttlMs>86_400_000)throw new Error("RENEWAL_TTL_INVALID");
    const read=async()=>{
      const snapshot=await this.store.read();
      if(snapshot.state.schemaVersion!==1)throw new Error("STATE_VERSION_UNSUPPORTED");
      if(snapshot.cancelRequestedAt!==undefined)throw new Error("FLOW_CANCEL_REQUESTED");
      const old=object(object(snapshot.state.approvals)[original.requestId]),clock=this.now();
      let approvedUnadmitted=false;
      if(old.status==='approved'&&original.action==='start'&&snapshot.state.executionPolicy==='coding'&&this.beforePublish){
        const intents=snapshot.state.startIntents;
        const raw=intents&&typeof intents==='object'&&!Array.isArray(intents)?intents[original.requestId]:undefined;
        if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
          const intent=object(raw),request=object(intent.request);
          let unadmitted=intent.phase==='prepared';
          if(intent.phase==='superseded'){
            const key=createHash('sha256').update(original.requestId).digest('hex');
            const renewals=snapshot.state.approvalRenewals;
            const linked=renewals&&typeof renewals==='object'&&!Array.isArray(renewals)?renewals[key]:undefined;
            if(linked&&typeof linked==='object'&&!Array.isArray(linked)){
              const record=object(linked),next=object(record.input);
              const nextRaw=typeof next.requestId==='string'&&intents&&typeof intents==='object'&&!Array.isArray(intents)?intents[next.requestId]:undefined;
              unadmitted=record.schemaVersion===1&&!!nextRaw&&typeof nextRaw==='object'&&!Array.isArray(nextRaw)&&
                JSON.stringify(object(nextRaw).request)===JSON.stringify(next);
            }
          }
          approvedUnadmitted=intent.schemaVersion===1&&unadmitted&&intent.operationId===undefined&&
            intent.receipt===undefined&&old.operationId===undefined&&old.consumedAt===undefined&&
            old.decidedBy===actorId&&Number.isSafeInteger(old.decidedAt)&&
            (old.decidedAt as number)>=(old.requestedAt as number)&&(old.decidedAt as number)<(old.expiresAt as number)&&
            request.requestId===original.requestId&&request.taskId===original.taskId&&request.requesterId===actorId&&
            request.planHash===original.planHash&&request.planVersion===original.planVersion&&
            request.action==='start'&&request.ttlMs===original.ttlMs;
        }
      }
      if(old.schemaVersion!==1||old.requestId!==original.requestId||old.requesterId!==actorId||
        old.taskId!==original.taskId||old.action!==original.action||old.planHash!==original.planHash||
        old.planVersion!==original.planVersion||(old.status!=="pending"&&!approvedUnadmitted)||
        typeof old.requestedAt!=="number"||typeof old.expiresAt!=="number"||
        !Number.isSafeInteger(old.requestedAt)||!Number.isSafeInteger(old.expiresAt)||old.requestedAt<0||
        old.expiresAt-old.requestedAt!==original.ttlMs)throw new Error("RENEWAL_ORIGINAL_DENIED");
      if(!Number.isSafeInteger(clock)||clock<old.expiresAt)throw new Error("RENEWAL_NOT_EXPIRED");
      const task=object(snapshot.state.task);
      const active=["planned","waiting"].includes(task.status as string)||
        (task.status==="running"&&["push","pr"].includes(original.action));
      if(task.id!==original.taskId||task.requesterId!==actorId||!active||
        typeof task.planText!=="string"||!task.planText||typeof task.planHash!=="string"||
        createHash("sha256").update(task.planText).digest("hex")!==task.planHash||
        typeof task.planVersion!=="number"||!Number.isSafeInteger(task.planVersion)||task.planVersion<1)
        throw new Error("RENEWAL_TASK_DENIED");
      return snapshot;
    };
    const store:StateStore={read,compareAndSwap:async(revision,state)=>{
      const fresh=await read();if(fresh.revision!==revision)return false;
      return this.store.compareAndSwap(revision,state);
    }};
    const repo=new ApprovalRepository(store,this.now);
    const key=createHash("sha256").update(original.requestId).digest("hex");
    const routeFingerprint=createHash("sha256").update(JSON.stringify(route)).digest("hex");
    const proposedId=`renew-${randomUUID()}`;
    for(let attempt=0;attempt<8;attempt++){
      const snapshot=await store.read();
      const task=object(snapshot.state.task);
      const table=snapshot.state.approvalRenewals===undefined?{}:object(snapshot.state.approvalRenewals);
      let record:Renewal;
      if(Object.hasOwn(table,key)){
        record=object(table[key]) as unknown as Renewal;
        const input=record.input;
        if(record.schemaVersion!==1||record.routeFingerprint!==routeFingerprint||!input||
          !/^renew-[0-9a-f-]{36}$/.test(input.requestId)||input.taskId!==task.id||input.requesterId!==actorId||
          input.planHash!==task.planHash||input.planVersion!==task.planVersion||input.action!==original.action||input.ttlMs!==this.ttlMs)
          throw new Error("RENEWAL_INTENT_CHANGED");
      }else{
        record={schemaVersion:1,routeFingerprint,input:{requestId:proposedId,taskId:original.taskId,requesterId:actorId,
          planHash:task.planHash as string,planVersion:task.planVersion as number,action:original.action,ttlMs:this.ttlMs}};
        if(!await store.compareAndSwap(snapshot.revision,{...snapshot.state,
          approvalRenewals:{...table,[key]:record as unknown as Json}}))continue;
      }
      // request() preserves original issuance/expiry on retry; publish() owns
      // durable admission/receipt recovery and never blind-resends unknown sends.
      const issued=await repo.request(record.input);
      if(this.now()>=issued.approval.expiresAt){
        // An old retry button must not report a stale bound card as usable.
        // Follow the durable lineage; each expired generation remains intact.
        return this.issue(record.input,route,actorId,ancestry);
      }
      const currentState=await store.read();
      if(record.input.action==='start'&&currentState.state.executionPolicy==='coding'){
        if(!this.beforePublish)throw new Error('START_PREPARATION_UNAVAILABLE');
        await this.beforePublish(store,{...record.input});
      }
      const published=await new ApprovalPromptPublisher(store,this.transport,this.now).publish(route,record.input.requestId);
      if(published.kind==="published"){
        const current=await repo.get(record.input.requestId);
        if(!current)throw new Error("RENEWAL_APPROVAL_MISSING");
        if(this.now()>=current.expiresAt)return this.issue(record.input,route,actorId,ancestry);
      }
      return published;
    }
    throw new Error("RENEWAL_WRITE_CONFLICT");
  }
}
