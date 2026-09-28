import {test, expect} from "bun:test";
import {ThreadReceiptRepository, type Scope, type ThreadRef, type ThreadBackend} from "../src/thread-receipt.ts";
import type {StateStore, State} from "../src/state/flow-store.ts";
const scope: Scope = {taskId:"owner/repo#7",forumId:"123456789012345678",botId:"234567890123456789"};
class MemoryStore implements StateStore {
  revision=0; state:State={schemaVersion:1,keep:{value:true}}; failReceipt=false;
  async read(){return {revision:this.revision,state:structuredClone(this.state)};}
  async compareAndSwap(revision:number,state:State){
    if(revision!==this.revision)return false;
    if(this.failReceipt && JSON.stringify(state).includes('"phase":"created"')){
      this.failReceipt=false;throw new Error("SIMULATED_RECEIPT_CRASH");
    }
    this.state=structuredClone(state);this.revision++;return true;
  }
}
class Backend implements ThreadBackend {
  durableIdempotency=false; calls=0; receipts=new Map<string,ThreadRef>();
  ambiguous=false; lookupUnavailable=false;
  async create(s:Scope,op:string){
    this.calls++;
    const ref=this.receipts.get(op)??{...s,operationId:op,threadId:"345678901234567890"};
    this.receipts.set(op,ref);
    if(this.ambiguous)throw new Error("ACK_LOST");
    return ref;
  }
  async findByOperation(_s:Scope,op:string){
    if(this.lookupUnavailable)throw new Error("LOOKUP_DOWN");
    return this.receipts.get(op);
  }
}
test("receipt reuses one thread and preserves unrelated state",async()=>{
  const store=new MemoryStore(),back=new Backend();
  const first=await new ThreadReceiptRepository(store,back).ensure(scope);
  expect(first.kind).toBe("thread");
  const second=await new ThreadReceiptRepository(store,back).ensure(scope);
  expect(second.kind).toBe("thread");
  if(second.kind==="thread")expect(second.reused).toBe(true);
  expect(back.calls).toBe(1);expect(store.state.keep).toEqual({value:true});
});
test("crash after provider success recovers by owned operation marker without another create",async()=>{
  const store=new MemoryStore(),back=new Backend();store.failReceipt=true;
  await expect(new ThreadReceiptRepository(store,back).ensure(scope)).rejects.toThrow("SIMULATED_RECEIPT_CRASH");
  const recovered=await new ThreadReceiptRepository(store,back).ensure(scope);
  expect(recovered.kind).toBe("thread");expect(back.calls).toBe(1);
});
test("ambiguous create never becomes blind retry, but can reconcile a receipt",async()=>{
  const store=new MemoryStore(),back=new Backend();back.ambiguous=true;
  const first=await new ThreadReceiptRepository(store,back).ensure(scope);
  expect(first.kind).toBe("uncertain");
  const next=await new ThreadReceiptRepository(store,back).ensure(scope);
  expect(next.kind).toBe("thread");expect(back.calls).toBe(1);
});
test("empty lookup cannot authorize recreate while old in-flight call may land later",async()=>{
  const store=new MemoryStore(),back=new Backend();back.ambiguous=true;
  await new ThreadReceiptRepository(store,back).ensure(scope);back.receipts.clear();
  const next=await new ThreadReceiptRepository(store,back).ensure(scope);
  expect(next).toMatchObject({kind:"uncertain",reason:"CREATION_NOT_PROVED_ABSENT"});
  expect(back.calls).toBe(1);
});
test("concurrent callers emit at most one unproven-idempotency provider create",async()=>{
  const store=new MemoryStore(),back=new Backend();
  await Promise.all(Array.from({length:10},()=>new ThreadReceiptRepository(store,back).ensure(scope)));
  expect(back.calls).toBe(1);
  expect((await new ThreadReceiptRepository(store,back).ensure(scope)).kind).toBe("thread");
});
test("forged bot/forum/operation receipt is not trusted or recreated",async()=>{
  const store=new MemoryStore(),back=new Backend();
  back.create=async(s,op)=>{back.calls++;return {...s,botId:"999",operationId:op,threadId:"345678901234567890"};};
  await expect(new ThreadReceiptRepository(store,back).ensure(scope)).rejects.toThrow("THREAD_RECEIPT_UNTRUSTED");
  expect((await new ThreadReceiptRepository(store,back).ensure(scope)).kind).toBe("uncertain");
  expect(back.calls).toBe(1);
});
test("changed scope conflicts instead of silently reusing or creating another thread",async()=>{
  const store=new MemoryStore(),back=new Backend();await new ThreadReceiptRepository(store,back).ensure(scope);
  await expect(new ThreadReceiptRepository(store,back).ensure({...scope,forumId:"999"})).rejects.toThrow("THREAD_SCOPE_CONFLICT");
  expect(back.calls).toBe(1);
});

test("lost inflight-write ack before create cannot authorize a second caller",async()=>{
  const store=new MemoryStore(),back=new Backend();const cas=store.compareAndSwap.bind(store);
  store.compareAndSwap=async(revision,state)=>{
    const result=await cas(revision,state);
    if(result&&JSON.stringify(state).includes('"phase":"inflight"'))throw new Error("ACK_LOST_BEFORE_CREATE");
    return result;
  };
  await expect(new ThreadReceiptRepository(store,back).ensure(scope)).rejects.toThrow("ACK_LOST_BEFORE_CREATE");
  expect(back.calls).toBe(0);
  expect(await new ThreadReceiptRepository(store,back).ensure(scope))
    .toMatchObject({kind:"uncertain",reason:"CREATION_NOT_PROVED_ABSENT"});
  expect(back.calls).toBe(0);
});

test("lookup failure stays uncertain without recreating",async()=>{
  const store=new MemoryStore(),back=new Backend();back.ambiguous=true;
  await new ThreadReceiptRepository(store,back).ensure(scope);back.lookupUnavailable=true;
  expect(await new ThreadReceiptRepository(store,back).ensure(scope))
    .toMatchObject({kind:"uncertain",reason:"LOOKUP_UNAVAILABLE"});
  expect(back.calls).toBe(1);
});

test("late provider landing after empty lookup converges without a duplicate call",async()=>{
  const store=new MemoryStore(),back=new Backend();let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const create=back.create.bind(back);let entered!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;});
  back.create=async(s,op)=>{entered();await gate;return create(s,op);};
  const first=new ThreadReceiptRepository(store,back).ensure(scope);await started;
  expect(await new ThreadReceiptRepository(store,back).ensure(scope))
    .toMatchObject({kind:"uncertain",reason:"CREATION_NOT_PROVED_ABSENT"});
  release();const landed=await first;const next=await new ThreadReceiptRepository(store,back).ensure(scope);
  expect(next.kind).toBe("thread");
  if(landed.kind==="thread"&&next.kind==="thread")expect(next.receipt).toEqual(landed.receipt);
  expect(back.calls).toBe(1);
});

test("only proven provider capability reuses the same operation ID after absent lookup",async()=>{
  const store=new MemoryStore(),back=new Backend();back.ambiguous=true;
  const first=await new ThreadReceiptRepository(store,back).ensure(scope);
  expect(first.kind).toBe("uncertain");back.receipts.clear();
  // Synthetic capability models a proven provider; it proves no real adapter.
  back.durableIdempotency=true;back.ambiguous=false;
  const next=await new ThreadReceiptRepository(store,back).ensure(scope);
  expect(next.kind).toBe("thread");
  if(first.kind==="uncertain"&&next.kind==="thread")expect(next.receipt.operationId).toBe(first.operationId);
  expect(back.calls).toBe(2);
});
