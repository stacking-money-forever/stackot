import {test,expect} from "bun:test";
import {ApprovalRepository,type ApprovalInput,type ApprovalContext} from "../src/approval.ts";
import type {State,StateStore} from "../src/state/flow-store.ts";
const input:ApprovalInput={requestId:"request-1",taskId:"owner/repo#7",requesterId:"123456789012345678",
  planHash:"a".repeat(64),planVersion:1,action:"start",ttlMs:1000};
const context:ApprovalContext={requestId:input.requestId,taskId:input.taskId,actorId:input.requesterId,
  planHash:input.planHash,planVersion:1,action:"start"};
class MemoryStore implements StateStore {
  revision=0;state:State={schemaVersion:1,unrelated:{keep:true},task:{id:input.taskId,
    requesterId:input.requesterId,planHash:input.planHash,planVersion:1,status:"planned"}};
  async read(){return {revision:this.revision,state:structuredClone(this.state)};}
  async compareAndSwap(revision:number,state:State){
    if(revision!==this.revision)return false;this.state=structuredClone(state);this.revision++;return true;
  }
}
async function fixture(){
  const store=new MemoryStore();let clock=100;
  const repo=new ApprovalRepository(store,()=>clock);await repo.request(input);
  return {store,repo,setClock:(now:number)=>{clock=now;}};
}

test("approval and one-use consumption are separate durable transitions",async()=>{
  const {store,repo,setClock}=await fixture();
  await expect(repo.consume(context,"operation-1")).rejects.toThrow("APPROVAL_NOT_APPROVED");
  setClock(200);const approved=await repo.decide(context,"approve");
  expect(approved).toMatchObject({status:"approved",decidedBy:context.actorId,decidedAt:200});
  setClock(300);const consumed=await repo.consume(context,"operation-1");
  expect(consumed).toMatchObject({status:"consumed",operationId:"operation-1",consumedAt:300});
  expect(await new ApprovalRepository(store,()=>400).get(input.requestId)).toEqual(consumed);
  await expect(repo.consume(context,"operation-2")).rejects.toThrow("APPROVAL_NOT_APPROVED");
  await expect(repo.decide(context,"approve")).rejects.toThrow("APPROVAL_ALREADY_DECIDED");
  expect(store.revision).toBe(3);expect(store.state.unrelated).toEqual({keep:true});
});

test("wrong actor/action/task/plan/version and inactive task matrix never mutates grant",async()=>{
  const cases:{delta?:Partial<ApprovalContext>;task?:State;error:string}[]=[
    {delta:{actorId:"234567890123456789"},error:"APPROVAL_ACTOR_DENIED"},
    {delta:{actorId:"00123"},error:"REQUESTER_ID_INVALID"},
    {delta:{action:"push"},error:"APPROVAL_BINDING_MISMATCH"},
    {delta:{taskId:"other/repo#8"},error:"APPROVAL_BINDING_MISMATCH"},
    {delta:{planHash:"b".repeat(64)},error:"TASK_PLAN_BINDING_MISMATCH"},
    {delta:{planVersion:2},error:"TASK_PLAN_BINDING_MISMATCH"},
    {task:{planHash:"b".repeat(64)},error:"TASK_PLAN_BINDING_MISMATCH"},
    {task:{planVersion:2},error:"TASK_PLAN_BINDING_MISMATCH"},
    {task:{requesterId:"234567890123456789"},error:"TASK_PLAN_BINDING_MISMATCH"},
    ...["cancelled","completed","failed",null].map(status=>({task:{status},error:"TASK_NOT_ACTIVE"}))
  ];
  for(const item of cases)for(const stage of ["decide","consume"]){
    const {store,repo}=await fixture();
    if(stage==="consume")await repo.decide(context,"approve");
    Object.assign(store.state.task as State,item.task);
    const before=structuredClone(store.state),revision=store.revision;
    const result=stage==="decide"?repo.decide({...context,...item.delta},"approve"):
      repo.consume({...context,...item.delta},"operation-1");
    await expect(result).rejects.toThrow(item.error);
    expect(store.revision).toBe(revision);expect(store.state).toEqual(before);
  }
});

test("inclusive expiry boundary and invalid/regressing clocks deny both stages",async()=>{
  for(const now of [1100,1101]){
    const {store,repo,setClock}=await fixture();setClock(now);
    await expect(repo.decide(context,"approve")).rejects.toThrow("APPROVAL_EXPIRED");
    expect(store.revision).toBe(1);
  }
  for(const now of [99,NaN,Infinity,100.5]){
    const {repo,setClock}=await fixture();setClock(now);
    await expect(repo.decide(context,"approve")).rejects.toThrow("CLOCK_INVALID");
  }
  const {store,repo,setClock}=await fixture();setClock(200);await repo.decide(context,"approve");
  setClock(199);await expect(repo.consume(context,"operation-1")).rejects.toThrow("CLOCK_INVALID");
  setClock(1100);await expect(repo.consume(context,"operation-1")).rejects.toThrow("APPROVAL_EXPIRED");
  expect(store.revision).toBe(2);
});

test("denied decision cannot be re-approved, consumed or renewed via creation replay",async()=>{
  const {store,repo}=await fixture();expect((await repo.decide(context,"deny")).status).toBe("denied");
  await expect(repo.decide(context,"approve")).rejects.toThrow("APPROVAL_ALREADY_DECIDED");
  await expect(repo.consume(context,"operation-1")).rejects.toThrow("APPROVAL_NOT_APPROVED");
  await expect(repo.request(input)).rejects.toThrow("REQUEST_ID_CONFLICT");expect(store.revision).toBe(2);
});

test("two concurrent consumers produce one grant, replay discloses no grant to another actor",async()=>{
  const {store,repo}=await fixture();await repo.decide(context,"approve");
  const results=await Promise.allSettled([repo.consume(context,"operation-1"),repo.consume(context,"operation-2")]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
  await expect(repo.consume({...context,actorId:"234567890123456789"},"operation-3"))
    .rejects.toThrow("APPROVAL_ACTOR_DENIED");expect(store.revision).toBe(3);
});

test("CAS retry revalidates plan, active task and current time",async()=>{
  for(const cause of ["plan","cancel","expire"]){
    const {store,repo,setClock}=await fixture();let attempts=0;
    store.compareAndSwap=async()=>{
      attempts++;
      if(cause==="plan")(store.state.task as State).planVersion=2;
      if(cause==="cancel")(store.state.task as State).status="cancelled";
      if(cause==="expire")setClock(1100);
      return false;
    };
    await expect(repo.decide(context,"approve")).rejects.toThrow(
      cause==="plan"?"TASK_PLAN_BINDING_MISMATCH":cause==="cancel"?"TASK_NOT_ACTIVE":"APPROVAL_EXPIRED");
    expect(attempts).toBe(1);expect(store.revision).toBe(1);
  }
});

test("contention and real persistence failure never return a successful grant",async()=>{
  const {store,repo}=await fixture();let attempts=0;
  store.compareAndSwap=async()=>{attempts++;return false;};
  await expect(repo.decide(context,"approve")).rejects.toThrow("APPROVAL_WRITE_CONFLICT");
  expect(attempts).toBe(4);
  store.compareAndSwap=async()=>{throw new Error("PERSIST_FAILED");};
  await expect(repo.decide(context,"approve")).rejects.toThrow("PERSIST_FAILED");
  expect((await repo.get(input.requestId))?.status).toBe("pending");
});

test("corrupt decision metadata and absent grant fail closed",async()=>{
  const {store,repo}=await fixture();await repo.decide(context,"approve");
  const entry=(store.state.approvals as State)[input.requestId] as State;entry.decidedBy="999";
  await expect(repo.consume(context,"operation-1")).rejects.toThrow("APPROVAL_STATE_INVALID");
  await expect(new ApprovalRepository(new MemoryStore()).decide(context,"approve"))
    .rejects.toThrow("APPROVAL_NOT_FOUND");
});

test("lost consumption ack leaves durable used marker and never returns another eligibility",async()=>{
  const {store,repo}=await fixture();await repo.decide(context,"approve");
  const cas=store.compareAndSwap.bind(store);
  store.compareAndSwap=async(revision,state)=>{
    const result=await cas(revision,state);if(result)throw new Error("PERSIST_ACK_LOST");return result;
  };
  await expect(repo.consume(context,"operation-1")).rejects.toThrow("PERSIST_ACK_LOST");
  expect(await repo.get(input.requestId)).toMatchObject({status:"consumed",operationId:"operation-1"});
  await expect(repo.consume(context,"operation-2")).rejects.toThrow("APPROVAL_NOT_APPROVED");
  expect(store.revision).toBe(3);
});

test("expiry during storage acknowledgement returns no eligibility despite committed marker",async()=>{
  for(const stage of ["decide","consume"]){
    const {store,repo,setClock}=await fixture();
    if(stage==="consume")await repo.decide(context,"approve");
    const cas=store.compareAndSwap.bind(store);
    store.compareAndSwap=async(revision,state)=>{const result=await cas(revision,state);setClock(1100);return result;};
    const result=stage==="decide"?repo.decide(context,"approve"):repo.consume(context,"operation-1");
    await expect(result).rejects.toThrow("APPROVAL_EXPIRED");
    expect((await repo.get(input.requestId))?.status).toBe(stage==="decide"?"approved":"consumed");
    await expect(repo.consume(context,"operation-2")).rejects.toThrow("APPROVAL_EXPIRED");
  }
});
