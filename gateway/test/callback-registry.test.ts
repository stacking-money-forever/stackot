import {test,expect} from "bun:test";
import {FlowCallbackRegistry} from "../src/callback-registry.ts";
import {ApprovalRepository,type ApprovalInput} from "../src/approval.ts";
import type {StateStore,State} from "../src/state/flow-store.ts";
const token="6f028276-12ad-4d80-9418-614ecf8b9e50";
const request:ApprovalInput={requestId:"request-1",taskId:"owner/repo#7",requesterId:"123456789012345678",
  planHash:"a".repeat(64),planVersion:1,action:"start",ttlMs:1000};
const input={accountId:"default",guildId:"111",conversationId:"channel:345678901234567890",
  parentConversationId:"123456789012345678",messageId:"456789012345678901",request,decision:"approve" as const};
class Store implements StateStore{
  revision=0;state:State={schemaVersion:1,unrelated:{keep:true},task:{id:request.taskId,
    requesterId:request.requesterId,planHash:request.planHash,planVersion:1,status:"planned"}};
  async read(){return {revision:this.revision,state:structuredClone(this.state)};}
  async compareAndSwap(revision:number,state:State){
    if(revision!==this.revision)return false;this.state=structuredClone(state);this.revision++;return true;
  }
}
async function fixture(){const store=new Store(),repo=new ApprovalRepository(store,()=>100);
  await repo.request(request);return {store,repo,registry:new FlowCallbackRegistry(store,repo)};}
test("callback binding persists through a fresh registry instance, preserving exact grant and metadata",async()=>{
  const f=await fixture();expect(await f.registry.bind(input,token)).toBe(token);
  const recovered=await new FlowCallbackRegistry(f.store,f.repo).resolve(token);
  expect(recovered).toMatchObject({...input,token});expect(recovered?.repository).toBe(f.repo);
  expect(await f.registry.bind({...input,request:{action:request.action,ttlMs:request.ttlMs,
    planVersion:request.planVersion,planHash:request.planHash,requesterId:request.requesterId,
    taskId:request.taskId,requestId:request.requestId}},token)).toBe(token);
  expect(f.store.revision).toBe(2);expect(f.store.state.unrelated).toEqual({keep:true});
});
test("existing token cannot silently move to another message, action or decision",async()=>{
  const f=await fixture();await f.registry.bind(input,token);
  for(const delta of [{messageId:"999"},{decision:"deny" as const},{request:{...request,action:"push" as const}}])
    await expect(f.registry.bind({...input,...delta},token)).rejects.toThrow("CALLBACK_TOKEN_CONFLICT");
  expect(f.store.revision).toBe(2);
});
test("new binding must match real stored pending request and valid native route fields",async()=>{
  const f=await fixture();
  await expect(f.registry.bind({...input,request:{...request,planHash:"b".repeat(64)}})).rejects.toThrow("CALLBACK_GRANT_MISMATCH");
  await expect(f.registry.bind({...input,messageId:"00123"})).rejects.toThrow("CALLBACK_BINDING_INVALID");
  expect(f.store.revision).toBe(1);
});
test("concurrent approve/deny bindings retain both records via CAS",async()=>{
  const f=await fixture();const tokens=await Promise.all([f.registry.bind(input),f.registry.bind({...input,decision:"deny"})]);
  expect(tokens[0]).not.toBe(tokens[1]);expect(Object.keys(f.store.state.approvalCallbacks as State)).toHaveLength(2);
  expect((await f.registry.resolve(tokens[1]!))?.decision).toBe("deny");expect(f.store.revision).toBe(3);
});
test("corrupt binding and unknown token fail closed without memory-only successful state",async()=>{
  const f=await fixture();expect(await f.registry.resolve(token)).toBeUndefined();await f.registry.bind(input,token);
  const entry=(f.store.state.approvalCallbacks as State)[token] as State;
  (entry.binding as State).guildId=null;
  await expect(f.registry.resolve(token)).rejects.toThrow("CALLBACK_BINDING_INVALID");
  const next=await fixture();next.store.compareAndSwap=async()=>false;
  await expect(next.registry.bind(input)).rejects.toThrow("CALLBACK_WRITE_CONFLICT");
  expect(next.store.state.approvalCallbacks).toBeUndefined();
});
