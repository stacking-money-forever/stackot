import {test,expect} from "bun:test";
import {PushAuthority,workerEnvironment,type OwnerPushBroker,type PushTarget} from "../src/push.ts";
import {ApprovalRepository,type ApprovalInput} from "../src/approval.ts";
import type {State,StateStore} from "../src/state/flow-store.ts";

class Store implements StateStore{
  revision=0;state:State={};cancelRequestedAt:number|undefined;
  async read(){return {revision:this.revision,state:structuredClone(this.state),cancelRequestedAt:this.cancelRequestedAt};}
  async compareAndSwap(revision:number,state:State){if(revision!==this.revision)return false;this.state=structuredClone(state);this.revision++;return true;}
}
async function fixture(){
  const store=new Store();let now=100,checks=0,credentials=0,pushes=0,verified=true;
  const request:ApprovalInput={requestId:"push-request",taskId:"owner/repo#7",requesterId:"123456789012345678",planHash:"a".repeat(64),planVersion:1,action:"push",ttlMs:1000};
  const destination:PushTarget={repo:"owner/repo",branch:"stackot/task-7",commitSha:"b".repeat(40)};
  store.state={schemaVersion:1,task:{id:request.taskId,requesterId:request.requesterId,planHash:request.planHash,planVersion:1,status:"waiting"}};
  const broker:OwnerPushBroker={allows:value=>value.repo===destination.repo&&value.branch===destination.branch,
    verifyRevision:async()=>{checks++;return verified;},credentialForRepo:async repo=>{expect(repo).toBe(destination.repo);credentials++;return "synthetic-owner-only-secret";},
    push:async(value,credential)=>{expect(credential).toBe("synthetic-owner-only-secret");pushes++;return {remoteSha:value.commitSha};}};
  const authority=new PushAuthority(store,broker,()=>now);await authority.prepare(request,destination);
  const repo=new ApprovalRepository(store,()=>now);const context={...request,actorId:request.requesterId};
  return {store,request,destination,context,authority,repo,broker,setClock:(value:number)=>{now=value;},setVerified:(value:boolean)=>{verified=value;},counts:()=>({checks,credentials,pushes})};
}
test("pending, expired, wrong actor and stale plan cannot resolve credentials or call push",async()=>{
  for(const reason of ["pending","expired","actor","plan","cancel"]){
    const f=await fixture();if(reason!=="pending")await f.repo.decide(f.context,"approve");
    if(reason==="expired")f.setClock(1100);if(reason==="plan")(f.store.state.task as State).planVersion=2;
    if(reason==="cancel")f.store.cancelRequestedAt=1;
    await expect(f.authority.execute({...f.context,actorId:reason==="actor"?"234567890123456789":f.context.actorId},"operation-1")).rejects.toThrow();
    expect(f.counts().credentials).toBe(0);expect(f.counts().pushes).toBe(0);
  }
});
test("valid push approval dispatches once; token never enters durable state or replay",async()=>{
  const f=await fixture();await f.repo.decide(f.context,"approve");
  expect(await f.authority.execute(f.context,"operation-1")).toEqual({kind:"sent",commitSha:f.destination.commitSha});
  expect(f.counts().pushes).toBe(1);expect(f.counts().credentials).toBe(1);
  expect(JSON.stringify(f.store.state)).not.toContain("synthetic-owner-only-secret");
  await expect(f.authority.execute(f.context,"operation-2")).rejects.toThrow();expect(f.counts().pushes).toBe(1);
});
test("owner verification and immutable target are authoritative, not worker claims",async()=>{
  const f=await fixture();await f.repo.decide(f.context,"approve");f.setVerified(false);
  await expect(f.authority.execute(f.context,"operation-1")).rejects.toThrow("PUSH_REVISION_UNVERIFIED");
  expect(f.counts().credentials).toBe(0);
  f.setVerified(true);await expect(f.authority.prepare(f.request,{...f.destination,commitSha:"c".repeat(40)})).rejects.toThrow("PUSH_INTENT_CHANGED");
});
test("ambiguous remote outcome stays consumed and cannot cause a second push",async()=>{
  const f=await fixture();await f.repo.decide(f.context,"approve");let calls=0;
  f.broker.push=async()=>{calls++;throw new Error("ACK_UNKNOWN synthetic-owner-only-secret");};
  expect(await f.authority.execute(f.context,"operation-1")).toMatchObject({kind:"uncertain"});
  expect((await f.repo.get(f.request.requestId))?.status).toBe("consumed");
  expect(JSON.stringify(f.store.state)).not.toContain("synthetic-owner-only-secret");
  await expect(f.authority.execute(f.context,"operation-2")).rejects.toThrow();expect(calls).toBe(1);
});
test("cancellation, plan changes or expiry during credential lookup stop transport",async()=>{
  for(const reason of ["cancel","plan","expiry"]){
    const f=await fixture();await f.repo.decide(f.context,"approve");
    f.broker.credentialForRepo=async()=>{if(reason==="cancel")f.store.cancelRequestedAt=1;
      if(reason==="plan")(f.store.state.task as State).planVersion=2;if(reason==="expiry")f.setClock(1100);return "synthetic-owner-only-secret";};
    expect(await f.authority.execute(f.context,"operation-1")).toMatchObject({kind:"uncertain"});expect(f.counts().pushes).toBe(0);
  }
});
test("concurrent dispatch consumes one eligibility only",async()=>{
  const f=await fixture();await f.repo.decide(f.context,"approve");
  const result=await Promise.allSettled([f.authority.execute(f.context,"operation-1"),f.authority.execute(f.context,"operation-2")]);
  expect(result.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(f.counts().pushes).toBe(1);
});
test("worker environment omits owner/network secrets and helper inheritance",()=>{
  const env=workerEnvironment({PATH:"/bin",HOME:"/synthetic/home",GITHUB_TOKEN:"owner-secret",GH_TOKEN:"owner-secret",GIT_ASKPASS:"/owner/helper",AWS_SECRET_ACCESS_KEY:"owner-secret",OPENCLAW_GATEWAY_TOKEN:"owner-secret"});
  expect(env.PATH).toBe("/bin");expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
  expect(JSON.stringify(env)).not.toContain("owner-secret");expect(env.GIT_ASKPASS).toBeUndefined();
});
