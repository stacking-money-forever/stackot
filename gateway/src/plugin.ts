import {registerApprovalCallbacks,type CallbackRoute,type InteractiveApi,type CallbackRegistry} from "./callback.ts";
import {FlowCallbackRegistry} from "./callback-registry.ts";
import {FlowStateStore,type ManagedFlows,type NativeFlow,type State} from "./state/flow-store.ts";
import {registerActorQa,QA_SCHEMA} from "./qa.ts";
import {STACKOT_CONTROLLER_ID} from "./controller.ts";
import {ApprovalRenewal} from "./renewal.ts";
import {discordPromptTransport,type NativePromptApi} from "./discord-prompt.ts";
import {attachNativePush,type NativePushOwnerFactory} from "./native-push.ts";
export {STACKOT_CONTROLLER_ID} from "./controller.ts";
export interface GatewayApi extends InteractiveApi {
  registerGatewayMethod(name:string,handler:(input:{params:Record<string,unknown>;
    respond:(ok:boolean,value?:object,error?:object)=>void})=>Promise<void>,options:{scope:"operator.admin"}):void;
  config:Record<string,unknown>;pluginConfig?:Record<string,unknown>;
  logger?:{info(message:string):void};
  runtime:{channel:{routing:{resolveAgentRoute(input:{cfg:Record<string,unknown>;channel:"discord";
    accountId:string;guildId:string;peer:{kind:"channel";id:string};parentPeer:{kind:"channel";id:string}}):
      {agentId:string;sessionKey:string;accountId:string}}};
    tasks:{async:{managedFlows:{bindSession(input:{sessionKey:string}):ManagedFlows&{
      list():Promise<NativeFlow[]>;createManaged?:(input:object)=>Promise<NativeFlow>}}}}};
}
function roleRouteAmbiguous(config:Record<string,unknown>,context:CallbackRoute){
  if(!Array.isArray(config.bindings))return false;
  return config.bindings.some((entry:{match?:Record<string,unknown>})=>{
    const match=entry?.match;
    return match?.channel==="discord"&&Array.isArray(match.roles)&&match.roles.length>0&&
      (!match.guildId||match.guildId===context.guildId)&&(!match.accountId||match.accountId===context.accountId);
  });
}
// Resolve from real native route + native flow list on every callback, not a
// process-local map or caller-supplied session/flow ID. Survives Gateway restart.
export function nativeCallbackRegistry(api:GatewayApi,agentId:string,pushOwner?:NativePushOwnerFactory):CallbackRegistry {
  return {async resolve(token,context){
    if(!context||roleRouteAmbiguous(api.config,context))return undefined;
    const route=api.runtime.channel.routing.resolveAgentRoute({cfg:api.config,channel:"discord",
      accountId:context.accountId,guildId:context.guildId,
      peer:{kind:"channel",id:context.conversationId.slice(8)},
      parentPeer:{kind:"channel",id:context.parentConversationId}});
    if(route.agentId!==agentId||route.accountId!==context.accountId||!route.sessionKey)return undefined;
    const native=api.runtime.tasks.async.managedFlows.bindSession({sessionKey:route.sessionKey});
    const candidates=(await native.list()).filter(flow=>{
      if(flow.ownerKey!==route.sessionKey||flow.controllerId!==STACKOT_CONTROLLER_ID||
        flow.syncMode!=="managed"||flow.cancelRequestedAt!==undefined||
        !["queued","running","waiting"].includes(flow.status))return false;
      const state=flow.stateJson as State|undefined;
      const table=state?.approvalCallbacks;
      return state?.schemaVersion===1&&table&&typeof table==="object"&&!Array.isArray(table)&&Object.hasOwn(table,token);
    });
    if(candidates.length>1)throw new Error("CALLBACK_TOKEN_AMBIGUOUS");
    const flow=candidates[0];if(!flow)return undefined;
    const facade=new FlowStateStore(native,flow.flowId,route.sessionKey,STACKOT_CONTROLLER_ID);
    const read=async()=>{
      const snapshot=await facade.read();
      if(snapshot.cancelRequestedAt!==undefined)throw new Error("FLOW_CANCEL_REQUESTED");
      return snapshot;
    };
    const store={read,compareAndSwap:async(revision:number,state:State)=>{
      const snapshot=await read();if(snapshot.revision!==revision)return false;
      return facade.compareAndSwap(revision,state);
    }};
    const binding=await new FlowCallbackRegistry(store).resolve(token);
    if(binding?.decision==="retry"){
      const renewal=new ApprovalRenewal(store,discordPromptTransport(api as unknown as NativePromptApi,context));
      binding.renew=actor=>renewal.reissue(binding.request,context,actor);
    }
    if(binding&&pushOwner)attachNativePush(binding,store,pushOwner);
    return binding;
  }};
}
export default {
  id:"stackot-gateway",name:"Stackot Gateway guards",
  configSchema:{type:"object",additionalProperties:false,properties:{agentId:{type:"string",minLength:1},qa:QA_SCHEMA},required:["agentId"]},
  register(api:GatewayApi){
    const agentId=api.pluginConfig?.agentId;
    if(typeof agentId!=="string"||!/^[a-zA-Z0-9_-]{1,64}$/.test(agentId))throw new Error("STACKOT_AGENT_REQUIRED");
    registerApprovalCallbacks(api,nativeCallbackRegistry(api,agentId),event=>api.logger?.info(JSON.stringify(event)));
    registerActorQa(api,agentId);
    // Read-only bootstrap diagnostics, never a context-injection/approval surface.
    api.registerGatewayMethod("stackotgateway.health",async({params,respond})=>{
      if(Object.keys(params).length){respond(false,undefined,{code:"INVALID_REQUEST",message:"No parameters accepted"});return;}
      respond(true,{gatewayPid:process.pid,pluginId:"stackot-gateway",callbackRegistered:true});
    },{scope:"operator.admin"});
  }
};
