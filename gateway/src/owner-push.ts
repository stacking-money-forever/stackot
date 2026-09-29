import {OwnerGitPush} from "./git-push.ts";
import type {CallbackBinding} from "./callback.ts";
import type {StateStore} from "./state/flow-store.ts";
import type {PushTarget,OwnerPushBroker} from "./push.ts";
import type {NativePushOwnerFactory} from "./native-push.ts";

export type PreparedOwnerPush={
  operationId:string;target:PushTarget;source:string;ownerRoot:string;gitExecutable:string;
  verify:(target:PushTarget)=>Promise<boolean>;
  credentialForRepo:(repo:string)=>Promise<string>;
};
/** A private owner catalog, not worker state/config or a caller-supplied verdict. */
export type OwnerPushCatalog=(store:StateStore,binding:Readonly<CallbackBinding>)=>Promise<PreparedOwnerPush|undefined>;

// Creation is lazy through attachNativePush, after native actor guards and
// approval storage. Worker/RPC cannot inject catalog or credential functions.
export function ownerPushFactory(catalog:OwnerPushCatalog):NativePushOwnerFactory{
  return async(store,binding)=>{
    const entry=await catalog(store,binding);if(!entry)return undefined;
    const prepared={...entry,target:{...entry.target}};
    const snapshot=await store.read();
    const intents=snapshot.state.pushIntents;
    if(!intents||typeof intents!=="object"||Array.isArray(intents))throw new Error("OWNER_PUSH_INTENT_MISSING");
    const raw=intents[binding.request.requestId];
    if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("OWNER_PUSH_INTENT_MISSING");
    const expected=raw as unknown as {request:CallbackBinding['request'];target:PushTarget;phase:string};
    if(expected.phase!=="prepared"||expected.request?.requestId!==binding.request.requestId||
      expected.request.taskId!==binding.request.taskId||expected.request.requesterId!==binding.request.requesterId||
      expected.request.planHash!==binding.request.planHash||expected.request.planVersion!==binding.request.planVersion||
      expected.request.action!=="push"||expected.target?.repo!==prepared.target.repo||
      expected.target.branch!==prepared.target.branch||expected.target.commitSha!==prepared.target.commitSha)
      throw new Error("OWNER_PUSH_INTENT_CHANGED");
    let transport:Promise<OwnerGitPush>|undefined,disposed=false;
    const get=async()=>{
      if(disposed)throw new Error("OWNER_PUSH_DISPOSED");
      if(!transport)transport=OwnerGitPush.seal({source:prepared.source,ownerRoot:prepared.ownerRoot,
        target:prepared.target,gitExecutable:prepared.gitExecutable,verify:prepared.verify});
      return transport;
    };
    const broker:OwnerPushBroker={
      allows:target=>!disposed&&target.repo===prepared.target.repo&&target.branch===prepared.target.branch&&target.commitSha===prepared.target.commitSha,
      verifyRevision:async target=>{if(!broker.allows(target))return false;return (await get()).verifyRevision(target);},
      credentialForRepo:async repo=>{if(disposed||repo!==prepared.target.repo)throw new Error("OWNER_PUSH_REPO_DENIED");return prepared.credentialForRepo(repo);},
      push:async(target,credential)=>{const sealed=await get();return sealed.push(target,credential);}
    };
    return {broker,operationId:prepared.operationId,dispose:async()=>{
      disposed=true;
      if(transport){const sealed=await transport.catch(()=>undefined);await sealed?.dispose();}
    }};
  };
}
