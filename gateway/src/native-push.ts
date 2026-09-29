import {PushAuthority,type OwnerPushBroker} from "./push.ts";
import type {CallbackBinding} from "./callback.ts";
import type {StateStore} from "./state/flow-store.ts";

/** Owner code creates this factory. Worker verdicts/config/RPC parameters never
 * choose broker, credentials, actor, operation or repository. No JSON functions. */
export type NativePushOwnerFactory=(store:StateStore,binding:Readonly<CallbackBinding>)=>Promise<{
  broker:OwnerPushBroker;operationId:string;
}|undefined>;

export function attachNativePush(binding:CallbackBinding,store:StateStore,factory:NativePushOwnerFactory):void{
  if(binding.decision!=="approve"||binding.request.action!=="push")return;
  // Delay factory lookup/verification/credentials until callback validates the
  // native principal and the approval decision commits. No actor injection RPC.
  binding.dispatchPush=async context=>{
    const prepared=await factory(store,binding);
    if(!prepared)throw new Error("OWNER_PUSH_NOT_PREPARED");
    return new PushAuthority(store,prepared.broker).execute(context,prepared.operationId);
  };
}
