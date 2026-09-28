import {test,expect} from "bun:test";
import {BacklinkRepository,type BacklinkScope,type BacklinkBackend,type Marker} from "../src/backlink.ts";
import {ThreadReceiptRepository,type ThreadBackend} from "../src/thread-receipt.ts";
import type {StateStore,State} from "../src/state/flow-store.ts";
import {findThreadId} from "../../receiver/src/mapping.ts";
const scope:BacklinkScope={taskId:"owner/repo#7",repo:"owner/repo",itemNumber:7,authorLogin:"stackot-bot",
  guildId:"111",forumId:"123456789012345678",botId:"234567890123456789"};
class Store implements StateStore{
  revision=0;state:State={schemaVersion:1,keep:true};failReceipt=false;
  async read(){return {revision:this.revision,state:structuredClone(this.state)};}
  async compareAndSwap(revision:number,state:State){
    if(revision!==this.revision)return false;
    if(this.failReceipt&&JSON.stringify(state.backlinkReceipts).includes('"phase":"created"')){
      this.failReceipt=false;throw new Error("POST_WRITE_RECEIPT_CRASH");
    }
    this.state=structuredClone(state);this.revision++;return true;
  }
}
class Backend implements BacklinkBackend{
  durableIdempotency=false;calls=0;markers:Marker[]=[];
  mode:"ok"|"not_sent"|"ambiguous"|"throw"="ok";lookupFail=false;
  async find(){if(this.lookupFail)throw new Error("LOOKUP_DOWN");return structuredClone(this.markers);}
  async write(s:BacklinkScope,body:string,_operation:string):Promise<Awaited<ReturnType<BacklinkBackend["write"]>>>{
    this.calls++;
    if(this.mode==="not_sent")return {kind:"not_sent"};
    const marker={id:String(this.calls),repo:s.repo,itemNumber:s.itemNumber,authorLogin:s.authorLogin,body};
    this.markers.push(marker);
    if(this.mode==="throw")throw new Error("ACK_LOST");
    if(this.mode==="ambiguous")return {kind:"ambiguous"};
    return {kind:"created",marker};
  }
}
async function fixture(){
  const store=new Store(),backend=new Backend();let threadCalls=0;
  const threadBackend:ThreadBackend={durableIdempotency:false,findByOperation:async()=>undefined,
    create:async(s,operationId)=>{threadCalls++;return {...s,operationId,threadId:"345678901234567890"};}};
  await new ThreadReceiptRepository(store,threadBackend).ensure({taskId:scope.taskId,forumId:scope.forumId,botId:scope.botId});
  return {store,backend,threadCalls:()=>threadCalls,repo:new BacklinkRepository(store,backend)};
}
test("backlink replay reuses thread and marker compatible with Receiver trust mapping",async()=>{
  const f=await fixture();const first=await f.repo.ensure(scope);
  expect(first.kind).toBe("backlink");const again=await new BacklinkRepository(f.store,f.backend).ensure(scope);
  expect(again).toMatchObject({kind:"backlink",reused:true});
  expect(f.backend.calls).toBe(1);expect(f.threadCalls()).toBe(1);expect(f.store.state.keep).toBe(true);
  if(first.kind==="backlink")expect(findThreadId({body:null,comments:[{body:first.marker.body,author:first.marker.authorLogin}]},
    {discordGuildId:scope.guildId,githubBacklinkLogin:scope.authorLogin})).toBe(first.thread.threadId);
});
test("definite no-send failure retries only backlink, with one effective marker",async()=>{
  const f=await fixture();f.backend.mode="not_sent";
  expect(await f.repo.ensure(scope)).toMatchObject({kind:"uncertain",reason:"DEFINITELY_NOT_SENT"});
  f.backend.mode="ok";expect((await f.repo.ensure(scope)).kind).toBe("backlink");
  expect(f.threadCalls()).toBe(1);expect(f.backend.calls).toBe(2);expect(f.backend.markers).toHaveLength(1);
});
test("post-write receipt crash reconciles original marker without another write",async()=>{
  const f=await fixture();f.store.failReceipt=true;
  await expect(f.repo.ensure(scope)).rejects.toThrow("POST_WRITE_RECEIPT_CRASH");
  const recovered=await new BacklinkRepository(f.store,f.backend).ensure(scope);
  expect(recovered).toMatchObject({kind:"backlink",reused:true});
  expect(f.threadCalls()).toBe(1);expect(f.backend.calls).toBe(1);expect(f.backend.markers).toHaveLength(1);
});
test("ambiguous ack reconciles; generic thrown error is never classified not-sent",async()=>{
  for(const mode of ["ambiguous","throw"] as const){
    const f=await fixture();f.backend.mode=mode;
    expect(await f.repo.ensure(scope)).toMatchObject({kind:"uncertain",reason:"WRITE_AMBIGUOUS"});
    expect((await f.repo.ensure(scope)).kind).toBe("backlink");expect(f.backend.calls).toBe(1);
  }
});
test("empty inflight lookup and lookup outage cannot authorize another write",async()=>{
  const f=await fixture();f.backend.lookupFail=true;
  expect(await f.repo.ensure(scope)).toMatchObject({kind:"uncertain",reason:"LOOKUP_UNAVAILABLE"});
  expect(f.backend.calls).toBe(0);f.backend.lookupFail=false;f.backend.mode="ambiguous";
  await f.repo.ensure(scope);const original=f.backend.markers[0]!;f.backend.markers=[];
  expect(await f.repo.ensure(scope)).toMatchObject({kind:"uncertain",reason:"WRITE_NOT_PROVED_ABSENT"});
  expect(f.backend.calls).toBe(1);f.backend.markers=[original];
  expect((await f.repo.ensure(scope)).kind).toBe("backlink");expect(f.threadCalls()).toBe(1);
});
test("concurrent prepared callers share exactly one initial backlink send",async()=>{
  const f=await fixture();await Promise.all(Array.from({length:10},()=>f.repo.ensure(scope)));
  expect(f.backend.calls).toBe(1);expect(f.backend.markers).toHaveLength(1);expect(f.threadCalls()).toBe(1);
});
test("foreign author/item/body markers cannot reconcile an ambiguous write",async()=>{
  for(const delta of [{authorLogin:"mallory"},{itemNumber:8},{repo:"other/repo"},{body:"forged"}]){
    const f=await fixture();f.backend.mode="ambiguous";await f.repo.ensure(scope);
    f.backend.markers=[{...f.backend.markers[0]!,...delta}];
    expect(await f.repo.ensure(scope)).toMatchObject({kind:"uncertain",reason:"WRITE_NOT_PROVED_ABSENT"});
    expect(f.backend.calls).toBe(1);
  }
});
test("duplicate owned markers are reported rather than collapsed to one guarantee",async()=>{
  const f=await fixture();f.backend.mode="ambiguous";await f.repo.ensure(scope);
  f.backend.markers.push({...f.backend.markers[0]!,id:"999"});
  await expect(f.repo.ensure(scope)).rejects.toThrow("BACKLINK_DUPLICATE_DETECTED");expect(f.backend.calls).toBe(1);
});
test("changed guild or missing accepted thread never performs a backlink write",async()=>{
  const f=await fixture();await f.repo.ensure(scope);
  await expect(f.repo.ensure({...scope,guildId:"222"})).rejects.toThrow("BACKLINK_SCOPE_CONFLICT");
  await expect(new BacklinkRepository(new Store(),f.backend).ensure(scope)).rejects.toThrow();
  expect(f.backend.calls).toBe(1);
});
