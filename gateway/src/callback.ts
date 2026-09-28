import type {ApprovalInput,ApprovalRepository} from "./approval.ts";

export type CallbackBinding={token:string;accountId:string;guildId:string;conversationId:string;
  parentConversationId:string;messageId:string;request:ApprovalInput;decision:"approve"|"deny";
  repository:ApprovalRepository};
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
export function registerApprovalCallbacks(api:InteractiveApi,registry:CallbackRegistry):void {
  api.registerInteractiveHandler({channel:"discord",namespace,handler:async raw=>{
    const ctx=raw as Partial<Context>|null;
    let text="이 승인 요청을 처리할 수 없습니다. 최신 요청을 확인해 주세요.";
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
      await binding.repository.decide({requestId:request.requestId,taskId:request.taskId,
        planHash:request.planHash,planVersion:request.planVersion,action:request.action,
        actorId:ctx.senderId},binding.decision);
      text=binding.decision==="approve"?"승인했습니다.":"거부했습니다.";
    }catch{
      // No grant metadata or provider/storage exception is exposed in the reply.
    }
    if(ctx?.respond&&typeof ctx.respond.reply==="function")await ctx.respond.reply({text,ephemeral:true});
    return {handled:true};
  }});
}
