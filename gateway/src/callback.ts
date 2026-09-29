import type {ApprovalInput,ApprovalRepository,ApprovalContext} from "./approval.ts";
import {ApprovalExpiredError} from "./approval.ts";

export type CallbackBinding={token:string;accountId:string;guildId:string;conversationId:string;
  parentConversationId:string;messageId:string;request:ApprovalInput;decision:"approve"|"deny"|"retry";
  repository:ApprovalRepository;retryAvailable?:boolean;
  renew?:(actorId:string)=>Promise<{kind:string}>;
  dispatchPush?:(context:ApprovalContext)=>Promise<{kind:"sent"|"uncertain"}>};
// Resolver is server-owned and must recover bindings/native ownership durably.
// This interface alone is not production registry or actor-authentication proof.
export type CallbackRoute={accountId:string;guildId:string;conversationId:string;parentConversationId:string};
export interface CallbackRegistry {resolve(token:string,route?:CallbackRoute):Promise<CallbackBinding|undefined>}
export interface InteractiveApi {registerInteractiveHandler(input:{channel:"discord";namespace:string;
  handler:(context:unknown)=>Promise<{handled:true}>}):void}
type Context={channel:string;accountId:string;guildId:string;conversationId:string;
  parentConversationId:string;senderId:string;auth:{isAuthorizedSender:boolean};
  interaction:{kind:string;messageId:string;data:string;namespace:string;payload:string};
  respond:{reply(input:{text:string;ephemeral:boolean}):Promise<void>}};
const namespace="stackot-approval";
const snowflake=(v:unknown):v is string=>typeof v==="string"&&/^[1-9][0-9]{0,19}$/.test(v)&&
  BigInt(v)<=18_446_744_073_709_551_615n;
const token=(v:unknown):v is string=>typeof v==="string"&&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

// Register a private handler only through the trusted native bootstrap API.
// Never expose an HTTP/RPC endpoint accepting an alleged native context object.
export type CallbackAudit={event:"stackot.approval";senderId?:string;authorized:boolean;
  guildId?:string;conversationId?:string;messageId?:string;outcome:"denied"|"approved"|"rejected"|"requested"|"push_sent"|"push_uncertain"};
export function registerApprovalCallbacks(api:InteractiveApi,registry:CallbackRegistry,observe?:(event:CallbackAudit)=>void):void {
  api.registerInteractiveHandler({channel:"discord",namespace,handler:async raw=>{
    const ctx=raw as Partial<Context>|null;
    let text="이 승인 요청을 처리할 수 없습니다. 최신 요청을 확인해 주세요.";
    let outcome:CallbackAudit["outcome"]="denied";
    let verifiedBinding:CallbackBinding|undefined;
    try{
      if(!ctx||ctx.channel!=="discord"||ctx.auth?.isAuthorizedSender!==true||
          !snowflake(ctx.senderId)||typeof ctx.accountId!=="string"||!ctx.accountId||
          !snowflake(ctx.guildId)||!snowflake(ctx.parentConversationId)||
          typeof ctx.conversationId!=="string"||!/^channel:[1-9][0-9]{0,19}$/.test(ctx.conversationId)||
          !snowflake(ctx.conversationId.slice(8))||ctx.interaction?.kind!=="button"||
          !snowflake(ctx.interaction.messageId)||ctx.interaction.namespace!==namespace||
          typeof ctx.interaction.data!=="string"||!token(ctx.interaction.payload))
        throw new Error("CALLBACK_CONTEXT_DENIED");
      const binding=await registry.resolve(ctx.interaction.payload,{accountId:ctx.accountId,
        guildId:ctx.guildId,conversationId:ctx.conversationId,parentConversationId:ctx.parentConversationId});
      if(!binding||binding.token!==ctx.interaction.payload||binding.accountId!==ctx.accountId||
          binding.guildId!==ctx.guildId||binding.conversationId!==ctx.conversationId||
          binding.parentConversationId!==ctx.parentConversationId||binding.messageId!==ctx.interaction.messageId)
        throw new Error("CALLBACK_BINDING_DENIED");
      // Binding contains server plan/action; actor is only the real native sender.
      const request=binding.request;
      if(request.requesterId!==ctx.senderId)throw new Error("CALLBACK_ACTOR_DENIED");
      verifiedBinding=binding;
      if(binding.decision==="retry"){
        if(typeof binding.renew!=="function")throw new Error("RENEWAL_UNAVAILABLE");
        const result=await binding.renew(ctx.senderId);
        text="승인 요청의 발행 상태를 확인하고 있습니다. 기존 승인은 재사용되지 않습니다.";
        if(result.kind==="published"){text="새 승인 요청을 발행했습니다. 이 스레드의 새 계획과 승인 버튼을 확인해 주세요.";outcome="requested";}
      }else{
      await binding.repository.decide({requestId:request.requestId,taskId:request.taskId,
        planHash:request.planHash,planVersion:request.planVersion,action:request.action,
        actorId:ctx.senderId},binding.decision);
      text=binding.decision==="approve"?"승인했습니다.":"거부했습니다.";
      outcome=binding.decision==="approve"?"approved":"rejected";
      if(binding.decision==="approve"&&request.action==="push"&&typeof binding.dispatchPush==="function"){
        const result=await binding.dispatchPush({requestId:request.requestId,taskId:request.taskId,
          planHash:request.planHash,planVersion:request.planVersion,action:"push",actorId:ctx.senderId});
        text=result.kind==="sent"?"승인한 커밋의 원격 push를 확인했습니다.":"push 결과를 확인하고 있습니다. 같은 요청을 다시 보내지 않습니다.";
        outcome=result.kind==="sent"?"push_sent":"push_uncertain";
      }
      }
    }catch(error){
      // No grant metadata or provider/storage exception is exposed in the reply.
      if(verifiedBinding&&error instanceof ApprovalExpiredError){
        // decide() can commit and then report expiry at the acknowledgement
        // boundary. Reconcile instead of calling that stored decision pending.
        try{
          const request=verifiedBinding.request;
          const current=await verifiedBinding.repository.get(request.requestId);
          if(current?.status==="pending"&&current.requestId===request.requestId&&current.requesterId===ctx?.senderId&&
              current.taskId===request.taskId&&current.planHash===request.planHash&&
              current.planVersion===request.planVersion&&current.action===request.action){
            text="이 승인 요청은 만료됐습니다. 기존 버튼은 재사용할 수 없습니다. 작업을 계속하려면 새 계획에 대한 승인 요청이 필요합니다.";
            if(verifiedBinding.retryAvailable)text="이 승인 요청은 만료됐습니다. 이 카드의 ‘승인 재요청’을 눌러 현재 계획을 다시 확인하고 새 승인 버튼으로 승인해 주세요. 기존 승인은 재사용되지 않습니다.";
          }
        }catch{
          // Unknown reconciliation is a generic reply, never an invented state.
        }
      }
    }
    try{observe?.({event:"stackot.approval",senderId:snowflake(ctx?.senderId)?ctx.senderId:undefined,
      authorized:ctx?.auth?.isAuthorizedSender===true,guildId:snowflake(ctx?.guildId)?ctx.guildId:undefined,
      conversationId:typeof ctx?.conversationId==="string"&&/^channel:[1-9][0-9]{0,19}$/.test(ctx.conversationId)?ctx.conversationId:undefined,
      messageId:snowflake(ctx?.interaction?.messageId)?ctx.interaction.messageId:undefined,outcome});}catch{
      // An optional diagnostics sink cannot change committed decision/reply semantics.
    }
    if(ctx?.respond&&typeof ctx.respond.reply==="function")await ctx.respond.reply({text,ephemeral:true});
    return {handled:true};
  }});
}
