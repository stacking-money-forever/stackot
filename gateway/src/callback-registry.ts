import {randomUUID} from "node:crypto";
import {ApprovalRepository} from "./approval.ts";
import type {CallbackBinding,CallbackRegistry} from "./callback.ts";
import type {Json,State,StateStore} from "./state/flow-store.ts";
type BindingData=Omit<CallbackBinding,"repository">;
type BindingInput=Omit<BindingData,"token">;
const snowflake=(v:unknown):v is string=>typeof v==="string"&&/^[1-9][0-9]{0,19}$/.test(v)&&
  BigInt(v)<=18_446_744_073_709_551_615n;
const uuid=(v:unknown):v is string=>typeof v==="string"&&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
function object(value:Json|undefined):State {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("CALLBACK_REGISTRY_INVALID");
  return value;
}
function valid(data:BindingData){
  if(!uuid(data.token)||typeof data.accountId!=="string"||!data.accountId||
    !snowflake(data.guildId)||!snowflake(data.parentConversationId)||!snowflake(data.messageId)||
    typeof data.conversationId!=="string"||!data.conversationId.startsWith("channel:")||
    !snowflake(data.conversationId.slice(8))||!["approve","deny"].includes(data.decision)||
    !data.request||typeof data.request!=="object")throw new Error("CALLBACK_BINDING_INVALID");
}
function stored(raw:Json|undefined):BindingData {
  const entry=object(raw);if(entry.schemaVersion!==1)throw new Error("CALLBACK_REGISTRY_INVALID");
  const data=object(entry.binding) as unknown as BindingData;valid(data);return data;
}
// One registry is attached to one server-resolved native flow. Callback text
// never chooses this store/owner. Cross-conversation bootstrap remains separate.
export class FlowCallbackRegistry implements CallbackRegistry {
  private readonly repository:ApprovalRepository;
  constructor(private readonly store:StateStore,repository?:ApprovalRepository){
    this.repository=repository??new ApprovalRepository(store);
  }
  async bind(input:BindingInput,token:string=randomUUID()):Promise<string>{
    const data:BindingData={token,accountId:input.accountId,guildId:input.guildId,
      conversationId:input.conversationId,parentConversationId:input.parentConversationId,
      messageId:input.messageId,decision:input.decision,request:{requestId:input.request.requestId,
        taskId:input.request.taskId,requesterId:input.request.requesterId,planHash:input.request.planHash,
        planVersion:input.request.planVersion,action:input.request.action,ttlMs:input.request.ttlMs}};
    valid(data);
    for(let attempt=0;attempt<4;attempt++){
      const snapshot=await this.store.read();if(snapshot.state.schemaVersion!==1)throw new Error("STATE_VERSION_UNSUPPORTED");
      const entries=snapshot.state.approvalCallbacks===undefined?{}:object(snapshot.state.approvalCallbacks);
      if(Object.hasOwn(entries,token)){
        if(JSON.stringify(stored(entries[token]))!==JSON.stringify(data))throw new Error("CALLBACK_TOKEN_CONFLICT");
        return token;
      }
      const grant=await this.repository.get(data.request.requestId);
      if(!grant||grant.status!=="pending"||grant.taskId!==data.request.taskId||
        grant.requesterId!==data.request.requesterId||grant.planHash!==data.request.planHash||
        grant.planVersion!==data.request.planVersion||grant.action!==data.request.action||
        grant.expiresAt-grant.requestedAt!==data.request.ttlMs)throw new Error("CALLBACK_GRANT_MISMATCH");
      if(await this.store.compareAndSwap(snapshot.revision,{...snapshot.state,
        approvalCallbacks:{...entries,[token]:{schemaVersion:1,binding:data as unknown as Json}}}))return token;
    }
    throw new Error("CALLBACK_WRITE_CONFLICT");
  }
  async resolve(token:string):Promise<CallbackBinding|undefined>{
    if(!uuid(token))return undefined;
    const snapshot=await this.store.read();if(snapshot.state.schemaVersion!==1)throw new Error("STATE_VERSION_UNSUPPORTED");
    if(snapshot.state.approvalCallbacks===undefined)return undefined;
    const entries=object(snapshot.state.approvalCallbacks);if(!Object.hasOwn(entries,token))return undefined;
    const data=stored(entries[token]);if(data.token!==token)throw new Error("CALLBACK_REGISTRY_INVALID");
    return {...structuredClone(data),repository:this.repository};
  }
}
