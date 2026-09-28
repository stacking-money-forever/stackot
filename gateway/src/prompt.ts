import {createHash,randomUUID} from "node:crypto";
import {ApprovalRepository,type Approval,type ApprovalInput} from "./approval.ts";
import {FlowCallbackRegistry} from "./callback-registry.ts";
import type {CallbackRoute} from "./callback.ts";
import type {Json,State,StateStore} from "./state/flow-store.ts";
export type PromptRoute=CallbackRoute;
export type PromptReceipt={channel:"discord";messageId:string;target:{kind:"channel";id:string}};
export type ComponentSpec={text:string;reusable:true;blocks:{type:"actions";buttons:{label:string;
  style:"success"|"danger";callbackData:string;callbackDataKind:"callback";reusable:true;allowedUsers:string[]}[]}[]};
export interface PromptTransport {
  sendPlan(text:string,beforeSend:()=>Promise<void>):Promise<PromptReceipt>;
  sendCard(spec:ComponentSpec,beforeSend:()=>Promise<void>,onReceipt:(r:PromptReceipt)=>Promise<void>):Promise<PromptReceipt>;
  editCard(messageId:string,spec:ComponentSpec):Promise<PromptReceipt>;
}
// Only trusted transport code may assert this before any visible send.
export class PromptNotSentError extends Error {}
type Intent={schemaVersion:1;fingerprint:string;approveToken:string;denyToken:string;retryToken?:string;
  phase:"prepared"|"plan_inflight"|"plan_sent"|"card_inflight"|"card_sent"|"bound";
  planMessageId?:string;messageId?:string};
export type PromptResult={kind:"published";messageId:string;reused:boolean}|
  {kind:"uncertain";reason:string;messageId?:string};
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const snowflake=(v:unknown):v is string=>typeof v==="string"&&/^[1-9][0-9]{0,19}$/.test(v)&&
  BigInt(v)<=18_446_744_073_709_551_615n;
const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
function object(v:Json|undefined):State{
  if(!v||typeof v!=="object"||Array.isArray(v))throw new Error("PROMPT_STATE_INVALID");return v;
}
function intent(v:Json|undefined):Intent{
  const e=object(v) as unknown as Intent;
  if(e.schemaVersion!==1||!uuid(e.approveToken)||!uuid(e.denyToken)||e.approveToken===e.denyToken||
    (e.retryToken!==undefined&&(!uuid(e.retryToken)||[e.approveToken,e.denyToken].includes(e.retryToken)))||
    !["prepared","plan_inflight","plan_sent","card_inflight","card_sent","bound"].includes(e.phase))
    throw new Error("PROMPT_STATE_INVALID");return e;
}
function receipt(r:PromptReceipt,route:PromptRoute){
  if(r.channel!=="discord"||!snowflake(r.messageId)||r.target?.kind!=="channel"||
    r.target.id!==route.conversationId.slice(8))throw new Error("PROMPT_RECEIPT_DENIED");
}
function request(a:Approval):ApprovalInput{return {requestId:a.requestId,taskId:a.taskId,requesterId:a.requesterId,
  planHash:a.planHash,planVersion:a.planVersion,action:a.action,ttlMs:a.expiresAt-a.requestedAt};}

// Server/controller-only producer. No RPC accepts alleged native principals.
export class ApprovalPromptPublisher {
  private readonly approvals:ApprovalRepository;
  private readonly registry:FlowCallbackRegistry;
  constructor(private readonly store:StateStore,private readonly transport:PromptTransport,
              private readonly now=Date.now){
    this.approvals=new ApprovalRepository(store,now);this.registry=new FlowCallbackRegistry(store,this.approvals);
  }
  async publish(route:PromptRoute,requestId:string,audience?:readonly string[]):Promise<PromptResult>{
    if(!route.accountId||!snowflake(route.guildId)||!snowflake(route.parentConversationId)||
      !route.conversationId.startsWith("channel:")||!snowflake(route.conversationId.slice(8)))
      throw new Error("PROMPT_ROUTE_INVALID");
    const key=hash(requestId),fingerprint=hash(JSON.stringify([route,requestId]));
    const proposed:Intent={schemaVersion:1,fingerprint,approveToken:randomUUID(),denyToken:randomUUID(),retryToken:randomUUID(),phase:"prepared"};
    for(let attempt=0;attempt<8;attempt++){
      const snapshot=await this.store.read();if(snapshot.state.schemaVersion!==1)throw new Error("STATE_VERSION_UNSUPPORTED");
      const table=snapshot.state.approvalPrompts===undefined?{}:object(snapshot.state.approvalPrompts);
      const raw=table[key];
      if(raw===undefined){
        await this.pending(requestId);
        if(await this.store.compareAndSwap(snapshot.revision,{...snapshot.state,
          approvalPrompts:{...table,[key]:proposed as unknown as Json}}))continue;
        continue;
      }
      const entry=intent(raw);if(entry.fingerprint!==fingerprint)throw new Error("PROMPT_ROUTE_CONFLICT");
      if(entry.phase==="bound"){
        if(!snowflake(entry.messageId))throw new Error("PROMPT_STATE_INVALID");
        return {kind:"published",messageId:entry.messageId,reused:true};
      }
      if(entry.phase==="plan_inflight"||entry.phase==="card_inflight")
        return {kind:"uncertain",reason:"SEND_NOT_PROVED_ABSENT"};
      const {approval,plan}=await this.pending(requestId);
      const users=[...new Set(audience??[approval.requesterId])];
      if(!users.includes(approval.requesterId)||users.some(id=>!snowflake(id)))throw new Error("PROMPT_AUDIENCE_INVALID");
      const labels={start:"작업 시작",push:"원격 push",pr:"PR 생성"};
      const planLink=entry.planMessageId?`\n계획: https://discord.com/channels/${route.guildId}/${route.conversationId.slice(8)}/${entry.planMessageId}`:"";
      const spec:ComponentSpec={text:`${approval.taskId} · 계획 ${approval.planVersion}${planLink}\n이 계획에 대한 ${labels[approval.action]}을 승인할까요?`,
        reusable:true,blocks:[{type:"actions",buttons:[
          {label:"승인",style:"success",callbackData:`stackot-approval:${entry.approveToken}`,callbackDataKind:"callback",reusable:true,allowedUsers:users},
          {label:"거부",style:"danger",callbackData:`stackot-approval:${entry.denyToken}`,callbackDataKind:"callback",reusable:true,allowedUsers:users},
          ...entry.retryToken?[{label:"승인 재요청",style:"success" as const,callbackData:`stackot-approval:${entry.retryToken}`,callbackDataKind:"callback" as const,reusable:true as const,allowedUsers:[approval.requesterId]}]:[]]}]};
      const check=async()=>{await this.pending(requestId);};
      if(entry.phase==="prepared"){
        if(!await this.transition(key,entry,"prepared",{phase:"plan_inflight"}))continue;
        let sent:PromptReceipt;
        try{sent=await this.transport.sendPlan(`${approval.taskId} · 계획 ${approval.planVersion}\n\n${plan}`,check);}
        catch(error){
          if(error instanceof PromptNotSentError){await this.transition(key,entry,"plan_inflight",{phase:"prepared"});
            return {kind:"uncertain",reason:"PLAN_NOT_SENT"};}
          return {kind:"uncertain",reason:"PLAN_SEND_AMBIGUOUS"};
        }
        receipt(sent,route);
        await this.transition(key,entry,"plan_inflight",{phase:"plan_sent",planMessageId:sent.messageId});
        continue;
      }
      const bind=async(r:PromptReceipt)=>{
        receipt(r,route);
        if(!await this.transition(key,entry,"card_inflight",{phase:"card_sent",messageId:r.messageId})){
          const existing=await this.readIntent(key);
          if(existing.messageId!==r.messageId||!["card_sent","bound"].includes(existing.phase))
            throw new Error("PROMPT_RECEIPT_CONFLICT");
        }
        await check();
        const common={...route,messageId:r.messageId,request:request(approval)};
        await this.registry.bind({...common,decision:"approve"},entry.approveToken);
        await this.registry.bind({...common,decision:"deny"},entry.denyToken);
        if(entry.retryToken)await this.registry.bind({...common,decision:"retry"},entry.retryToken);
      };
      if(entry.phase==="plan_sent"){
        if(!snowflake(entry.planMessageId))throw new Error("PROMPT_STATE_INVALID");
        if(!await this.transition(key,entry,"plan_sent",{phase:"card_inflight"}))continue;
        try{
          let reported=false;
          const sent=await this.transport.sendCard(spec,check,async r=>{reported=true;await bind(r);});
          if(!reported)throw new Error("PROMPT_RECEIPT_HOOK_MISSING");
          receipt(sent,route);
          const recorded=await this.readIntent(key);if(recorded.messageId!==sent.messageId)throw new Error("PROMPT_RECEIPT_CONFLICT");
          await this.transition(key,entry,"card_sent",{phase:"bound",messageId:sent.messageId});
          return {kind:"published",messageId:sent.messageId,reused:false};
        }catch(error){
          if(error instanceof PromptNotSentError){await this.transition(key,entry,"card_inflight",{phase:"plan_sent"});
            return {kind:"uncertain",reason:"CARD_NOT_SENT"};}
          return {kind:"uncertain",reason:"CARD_SEND_OR_REGISTRATION_AMBIGUOUS"};
        }
      }
      // A known delivered message is repaired by editing that exact message;
      // it is never replaced with a second send after receipt/registration failure.
      if(!snowflake(entry.messageId))throw new Error("PROMPT_STATE_INVALID");
      const known:PromptReceipt={channel:"discord",messageId:entry.messageId,target:{kind:"channel",id:route.conversationId.slice(8)}};
      try{
        await bind(known);await check();const repaired=await this.transport.editCard(entry.messageId,spec);
        receipt(repaired,route);if(repaired.messageId!==entry.messageId)throw new Error("PROMPT_RECEIPT_CONFLICT");
        await this.transition(key,entry,"card_sent",{phase:"bound"});
        return {kind:"published",messageId:entry.messageId,reused:true};
      }catch{return {kind:"uncertain",reason:"CARD_REPAIR_PENDING",messageId:entry.messageId};}
    }
    throw new Error("PROMPT_STATE_CONTENTION");
  }
  private async pending(id:string){
    const snapshot=await this.store.read(),task=object(snapshot.state.task);
    if(snapshot.cancelRequestedAt!==undefined)throw new Error("FLOW_CANCEL_REQUESTED");
    const approval=await this.approvals.get(id),now=this.now();
    if(!approval||approval.status!=="pending")throw new Error("PROMPT_NOT_PENDING");
    if(!Number.isSafeInteger(now)||now<approval.requestedAt||now>=approval.expiresAt)throw new Error("PROMPT_EXPIRED");
    if(task.id!==approval.taskId||task.requesterId!==approval.requesterId||task.planHash!==approval.planHash||
      task.planVersion!==approval.planVersion||!["planned","waiting","running"].includes(task.status as string)||
      typeof task.planText!=="string"||!task.planText||hash(task.planText)!==approval.planHash)
      throw new Error("PROMPT_PLAN_BINDING_MISMATCH");
    return {approval,plan:task.planText};
  }
  private async readIntent(key:string){const s=await this.store.read();return intent(object(s.state.approvalPrompts)[key]);}
  private async transition(key:string,expected:Intent,from:Intent["phase"],change:Partial<Intent>):Promise<boolean>{
    for(let attempt=0;attempt<8;attempt++){
      const s=await this.store.read(),table=object(s.state.approvalPrompts),current=intent(table[key]);
      if(current.fingerprint!==expected.fingerprint||current.approveToken!==expected.approveToken||
        current.denyToken!==expected.denyToken)throw new Error("PROMPT_OPERATION_CHANGED");
      if(current.phase!==from)return false;
      if(await this.store.compareAndSwap(s.revision,{...s.state,
        approvalPrompts:{...table,[key]:{...current,...change} as unknown as Json}}))return true;
    }
    throw new Error("PROMPT_WRITE_CONFLICT");
  }
}
