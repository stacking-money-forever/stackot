import {test,expect} from "bun:test";
import {createHash} from "node:crypto";
import {ApprovalRenewal} from "../src/renewal.ts";
import {ApprovalRepository,type ApprovalInput} from "../src/approval.ts";
import type {State,StateStore} from "../src/state/flow-store.ts";
import type {PromptRoute,PromptTransport} from "../src/prompt.ts";

class Store implements StateStore{
  revision=0;state:State={};cancelRequestedAt:number|undefined;onRead?:()=>void;
  async read(){this.onRead?.();return {revision:this.revision,state:structuredClone(this.state),cancelRequestedAt:this.cancelRequestedAt};}
  async compareAndSwap(revision:number,state:State){if(this.revision!==revision)return false;this.state=structuredClone(state);this.revision++;return true;}
}
async function fixture(){
  const store=new Store();let now=100;const plan="새 승인도 코딩을 자동 실행하지 않는다.";
  const original:ApprovalInput={requestId:"original",taskId:"owner/repo#7",requesterId:"123456789012345678",
    planHash:createHash("sha256").update(plan).digest("hex"),planVersion:1,action:"start",ttlMs:1000};
  store.state={schemaVersion:1,task:{id:original.taskId,requesterId:original.requesterId,planHash:original.planHash,
    planVersion:1,planText:plan,status:"planned"}};
  const repo=new ApprovalRepository(store,()=>now);await repo.request(original);
  const route:PromptRoute={accountId:"default",guildId:"111",conversationId:"channel:222",parentConversationId:"333"};
  let plans=0,cards=0;
  const receipt={channel:"discord" as const,messageId:"555",target:{kind:"channel" as const,id:"222"}};
  const transport:PromptTransport={sendPlan:async(_text,check)=>{await check();plans++;return {...receipt,messageId:"444"};},
    sendCard:async(_spec,check,record)=>{await check();cards++;await record(receipt);return receipt;},editCard:async()=>receipt};
  return {store,repo,original,route,transport,setClock:(v:number)=>{now=v;},counts:()=>({plans,cards}),
    service:()=>new ApprovalRenewal(store,transport,()=>now,60000)};
}
test("expired request produces a distinct immutable pending approval and replay reuses its card",async()=>{
  const f=await fixture();f.setClock(1100);const old=await f.repo.get(f.original.requestId);
  expect((await f.service().reissue(f.original,f.route,f.original.requesterId)).kind).toBe("published");
  const table=f.store.state.approvals as State;const ids=Object.keys(table);expect(ids).toHaveLength(2);
  const id=ids.find(x=>x!==f.original.requestId)!;const next=await f.repo.get(id);
  expect(next?.status).toBe("pending");expect(next?.requestedAt).toBe(1100);expect(next?.expiresAt).toBe(61100);
  expect(await f.repo.get(f.original.requestId)).toEqual(old);
  f.setClock(1200);await f.service().reissue(f.original,f.route,f.original.requesterId);
  expect(await f.repo.get(id)).toEqual(next);expect(f.counts()).toEqual({plans:1,cards:1});
});
test("unexpired, wrong actor, decided, canceled and running requests create no new approval/card",async()=>{
  for(const scenario of ["unexpired","actor","decided","cancel","running"]){
    const f=await fixture();if(scenario!=="unexpired")f.setClock(1100);
    if(scenario==="decided"){f.setClock(200);await f.repo.decide({...f.original,actorId:f.original.requesterId},"deny");f.setClock(1100);}
    if(scenario==="cancel")f.store.cancelRequestedAt=1;
    if(scenario==="running")(f.store.state.task as State).status="running";
    await expect(f.service().reissue(f.original,f.route,scenario==="actor"?"234567890123456789":f.original.requesterId)).rejects.toThrow();
    expect(Object.keys(f.store.state.approvals as State)).toHaveLength(1);expect(f.counts()).toEqual({plans:0,cards:0});
  }
});
test("concurrent re-request calls share a durable identity and physical publication",async()=>{
  const f=await fixture();f.setClock(1100);
  await Promise.all([f.service().reissue(f.original,f.route,f.original.requesterId),f.service().reissue(f.original,f.route,f.original.requesterId)]);
  expect(Object.keys(f.store.state.approvals as State)).toHaveLength(2);expect(f.counts()).toEqual({plans:1,cards:1});
});
test("current changed plan is displayed with a fresh binding; subsequent intent drift is rejected",async()=>{
  const f=await fixture();f.setClock(1100);const task=f.store.state.task as State;
  task.planText="다시 검토할 현재 계획";task.planHash=createHash("sha256").update(task.planText as string).digest("hex");task.planVersion=2;
  await f.service().reissue(f.original,f.route,f.original.requesterId);
  const id=Object.keys(f.store.state.approvals as State).find(x=>x!=="original")!;
  expect(await f.repo.get(id)).toMatchObject({planHash:task.planHash,planVersion:2,status:"pending"});
  (f.store.state.task as State).planVersion=3;
  await expect(f.service().reissue(f.original,f.route,f.original.requesterId)).rejects.toThrow("RENEWAL_INTENT_CHANGED");
  expect(f.counts().cards).toBe(1);
});
test("task state change before issuance is rechecked at every guarded read/write",async()=>{
  const f=await fixture();f.setClock(1100);
  f.store.onRead=()=>{if(f.store.state.approvalRenewals){(f.store.state.task as State).status="running";f.store.revision++;}};
  await expect(f.service().reissue(f.original,f.route,f.original.requesterId)).rejects.toThrow("RENEWAL_TASK_DENIED");
  expect(Object.keys(f.store.state.approvals as State)).toHaveLength(1);expect(f.counts().cards).toBe(0);
});
test("unknown physical send acknowledgement does not create another fresh request or resend",async()=>{
  const f=await fixture();f.setClock(1100);let sends=0;
  f.transport.sendPlan=async()=>{sends++;throw new Error("ACK_UNKNOWN");};
  expect((await f.service().reissue(f.original,f.route,f.original.requesterId)).kind).toBe("uncertain");
  expect((await f.service().reissue(f.original,f.route,f.original.requesterId)).kind).toBe("uncertain");
  expect(sends).toBe(1);expect(Object.keys(f.store.state.approvals as State)).toHaveLength(2);expect(f.counts().cards).toBe(0);
});

test("an old retry control follows expired renewal lineage to one fresh pending request",async()=>{
  const f=await fixture();f.setClock(1100);await f.service().reissue(f.original,f.route,f.original.requesterId);
  const first=Object.keys(f.store.state.approvals as State).find(x=>x!=="original")!;
  const old=await f.repo.get(first);f.setClock(61100);
  expect((await f.service().reissue(f.original,f.route,f.original.requesterId)).kind).toBe("published");
  const ids=Object.keys(f.store.state.approvals as State);expect(ids).toHaveLength(3);
  const newest=ids.find(x=>!["original",first].includes(x))!;
  expect(await f.repo.get(newest)).toMatchObject({status:"pending",requestedAt:61100,expiresAt:121100});
  expect(await f.repo.get(first)).toEqual(old);
  f.setClock(61200);await f.service().reissue(f.original,f.route,f.original.requesterId);
  expect(Object.keys(f.store.state.approvals as State)).toHaveLength(3);expect(f.counts()).toEqual({plans:2,cards:2});
});
