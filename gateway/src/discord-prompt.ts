import type {PromptRoute,PromptTransport,PromptReceipt,ComponentSpec} from "./prompt.ts";
import {PromptNotSentError} from "./prompt.ts";
type NativeResult={outcome?:"not_sent";channel?:string;messageId?:string;target?:{kind:string;id:string};channelId?:string;
  receipt?:{primaryPlatformMessageId?:string}};
type SendContext={cfg:Record<string,unknown>;to:string;accountId:string;text:string;silent:true;
  payload:{text:string;channelData?:{discord:{components:ComponentSpec}}};
  onPlatformSendDispatch:()=>Promise<void>;onDeliveryResult?:(r:NativeResult)=>Promise<void>};
export type NativePromptApi={config:Record<string,unknown>;runtime:{channel:{outbound:{
  loadAdapter(channel:"discord"):Promise<{sendPayload?:(ctx:SendContext)=>Promise<NativeResult>}|undefined>}}}};
function normalize(result:NativeResult):PromptReceipt{
  if(result.outcome==="not_sent")throw new PromptNotSentError("DISCORD_NOT_SENT");
  if(result.channel!=="discord"||!result.messageId||result.target?.kind!=="channel")throw new Error("DISCORD_RECEIPT_INVALID");
  return {channel:"discord",messageId:result.messageId,target:{kind:"channel",id:result.target.id}};
}
// Exact pinned SDK outbound hook fires before native component registration.
export function discordPromptTransport(api:NativePromptApi,route:PromptRoute):PromptTransport{
  const base={cfg:api.config,to:route.conversationId,accountId:route.accountId,silent:true as const};
  const send=async(text:string,spec:ComponentSpec|undefined,beforeSend:()=>Promise<void>,onReceipt?:(r:PromptReceipt)=>Promise<void>)=>{
    const adapter=await api.runtime.channel.outbound.loadAdapter("discord");
    if(!adapter?.sendPayload)throw new PromptNotSentError("DISCORD_ADAPTER_UNAVAILABLE");
    const result=await adapter.sendPayload({...base,text,onPlatformSendDispatch:beforeSend,
      payload:{text,...spec?{channelData:{discord:{components:spec}}}:{}},
      ...onReceipt?{onDeliveryResult:async(result:NativeResult)=>{await onReceipt(normalize(result));}}:{}});
    return normalize(!spec&&result.receipt?.primaryPlatformMessageId?
      {...result,messageId:result.receipt.primaryPlatformMessageId}:result);
  };
  return {sendPlan:(text,check)=>send(text,undefined,check),sendCard:(spec,check,record)=>send(spec.text,spec,check,record),
    async editCard(messageId,spec){
      const moduleName="openclaw/plugin-sdk/discord";
      const sdk=await import(moduleName);
      if(typeof sdk.editDiscordComponentMessage!=="function")throw new Error("DISCORD_EDIT_UNAVAILABLE");
      const result:NativeResult=await sdk.editDiscordComponentMessage(base.to,messageId,spec,{cfg:api.config,accountId:route.accountId});
      return normalize({...result,channel:"discord",target:{kind:"channel",id:result.channelId??""}});
    }};
}
