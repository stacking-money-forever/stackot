import {test,expect} from "bun:test";
import {registerApprovalCallbacks,type CallbackBinding,type InteractiveApi} from "../src/callback.ts";
import {ApprovalRepository,type ApprovalInput} from "../src/approval.ts";
import type {StateStore,State} from "../src/state/flow-store.ts";
const token="6f028276-12ad-4d80-9418-614ecf8b9e50";
const input:ApprovalInput={requestId:"request-1",taskId:"owner/repo#7",requesterId:"123456789012345678",
  planHash:"a".repeat(64),planVersion:1,action:"start",ttlMs:1000};
class Store implements StateStore{
  revision=0;state:State={schemaVersion:1,task:{id:input.taskId,requesterId:input.requesterId,
    planHash:input.planHash,planVersion:1,status:"planned"}};
  async read(){return {revision:this.revision,state:structuredClone(this.state)};}
  async compareAndSwap(revision:number,state:State){
    if(revision!==this.revision)return false;this.state=structuredClone(state);this.revision++;return true;
  }
}
// Synthetic captured registration/context only: NOT native ingress/auth proof.
async function fixture(){
  const store=new Store();let now=100,lookups=0;
  const repo=new ApprovalRepository(store,()=>now);await repo.request(input);
  const binding:CallbackBinding={token,accountId:"default",guildId:"111",conversationId:"channel:345678901234567890",
    parentConversationId:"123456789012345678",messageId:"456789012345678901",request:input,decision:"approve",repository:repo};
  let registration!:Parameters<InteractiveApi["registerInteractiveHandler"]>[0];
  registerApprovalCallbacks({registerInteractiveHandler:value=>{registration=value;}},
    {resolve:async value=>{lookups++;return value===token?binding:undefined;}});
  const replies:{text:string;ephemeral:boolean}[]=[];
  const ctx={channel:"discord",accountId:binding.accountId,guildId:binding.guildId,
    conversationId:binding.conversationId,parentConversationId:binding.parentConversationId,
    senderId:input.requesterId,senderUsername:"a-display-name",auth:{isAuthorizedSender:true},
    interaction:{kind:"button",messageId:binding.messageId,data:`stackot-approval:${token}`,
      namespace:"stackot-approval",payload:token},respond:{reply:async(message:{text:string;ephemeral:boolean})=>{replies.push(message);}}};
  return {store,repo,binding,ctx,replies,registration,lookups:()=>lookups,setClock:(value:number)=>{now=value;}};
}
test("native registration shape connects supplied valid sender/binding to S27 only",async()=>{
  const f=await fixture();expect(f.registration.channel).toBe("discord");
  expect(f.registration.namespace).toBe("stackot-approval");
  await f.registration.handler(f.ctx);expect((await f.repo.get(input.requestId))?.status).toBe("approved");
  expect(f.replies).toEqual([{text:"승인했습니다.",ephemeral:true}]);expect(f.store.revision).toBe(2);
  // Callback decides only; it does not consume eligibility or dispatch a worker.
});
test("auth=false or malformed native sender is denied before registry lookup",async()=>{
  for(const delta of [{auth:{isAuthorizedSender:false}},{senderId:"00123"},{senderId:123},{channel:"telegram"}]){
    const f=await fixture();await f.registration.handler({...f.ctx,...delta});
    expect(f.lookups()).toBe(0);expect(f.store.revision).toBe(1);
    expect(f.replies[0]?.text).not.toContain(input.requestId);
  }
});
test("same registry token and displayed requester name cannot authorize another sender",async()=>{
  const f=await fixture();await f.registration.handler({...f.ctx,senderId:"234567890123456789",
    senderUsername:input.requesterId,interaction:{...f.ctx.interaction,data:JSON.stringify({actorId:input.requesterId})}});
  expect(f.lookups()).toBe(1);expect(f.store.revision).toBe(1);
  expect((await f.repo.get(input.requestId))?.status).toBe("pending");
});
test("foreign native account/guild/channel/parent/message denies even matching requester",async()=>{
  for(const delta of [{accountId:"foreign"},{guildId:"222"},{conversationId:"channel:999"},
    {parentConversationId:"999"},{interaction:{messageId:"999"}}]){
    const f=await fixture();const altered={...f.ctx,...delta,
      interaction:{...f.ctx.interaction,...delta.interaction}};
    await f.registration.handler(altered);expect(f.store.revision).toBe(1);
    expect((await f.repo.get(input.requestId))?.status).toBe("pending");
  }
});
test("unknown token, wrong namespace and payload object never select another flow",async()=>{
  for(const delta of [{payload:"d14258c7-0c26-4a41-808a-c0f45b76f2c4"},{namespace:"other"},
    {payload:{flowId:"forged",actorId:input.requesterId}}]){
    const f=await fixture();await f.registration.handler({...f.ctx,interaction:{...f.ctx.interaction,...delta}});
    expect(f.store.revision).toBe(1);
  }
});
test("S27 expiry, changed plan and replay remain authoritative behind callback binding",async()=>{
  for(const reason of ["expired","plan"]){
    const f=await fixture();if(reason==="expired")f.setClock(1100);
    else (f.store.state.task as State).planHash="b".repeat(64);
    await f.registration.handler(f.ctx);expect(f.store.revision).toBe(1);
  }
  const f=await fixture();await f.registration.handler(f.ctx);await f.registration.handler(f.ctx);
  expect(f.store.revision).toBe(2);expect(f.replies[1]?.text).not.toBe("승인했습니다.");
});
