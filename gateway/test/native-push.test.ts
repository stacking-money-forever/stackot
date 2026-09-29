/** Captured handler/context, fake broker: S, not native origin/auth proof. */
import {test,expect} from "bun:test";
import {registerApprovalCallbacks,type CallbackBinding,type InteractiveApi} from "../src/callback.ts";
import {attachNativePush} from "../src/native-push.ts";
import {ApprovalRepository} from "../src/approval.ts";
import {PushAuthority,type OwnerPushBroker} from "../src/push.ts";
import type {State,StateStore} from "../src/state/flow-store.ts";

async function fixture(){
  const request={requestId:"push",taskId:"owner/repo#7",requesterId:"123456789012345678",planHash:"a".repeat(64),planVersion:1,action:"push" as const,ttlMs:60000};
  let state:State={schemaVersion:1,task:{id:request.taskId,requesterId:request.requesterId,planHash:request.planHash,planVersion:1,status:"waiting"}},revision=0;
  const store:StateStore={read:async()=>({revision,state:structuredClone(state)}),compareAndSwap:async(r,next)=>{if(r!==revision)return false;state=structuredClone(next);revision++;return true;}};
  const repo=new ApprovalRepository(store);let factories=0,credentials=0,pushes=0;
  const target={repo:"owner/repo",branch:"stackot/task-7",commitSha:"b".repeat(40)};
  const broker:OwnerPushBroker={allows:()=>true,verifyRevision:async()=>true,credentialForRepo:async()=>{credentials++;return "synthetic-secret";},push:async()=>{pushes++;return {remoteSha:target.commitSha};}};
  await new PushAuthority(store,broker).prepare(request,target);
  const binding:CallbackBinding={token:"6f028276-12ad-4d80-9418-614ecf8b9e50",accountId:"default",guildId:"111",conversationId:"channel:222",parentConversationId:"333",messageId:"444",request,decision:"approve",repository:repo};
  attachNativePush(binding,store,async()=>{factories++;expect((await repo.get(request.requestId))?.status).toBe("approved");return {broker,operationId:"owner-operation"};});
  let registration!:Parameters<InteractiveApi["registerInteractiveHandler"]>[0];const replies:string[]=[],audits:string[]=[];
  registerApprovalCallbacks({registerInteractiveHandler:value=>{registration=value;}},{resolve:async()=>binding},event=>{audits.push(event.outcome);});
  const context={channel:"discord",accountId:"default",guildId:"111",conversationId:"channel:222",parentConversationId:"333",senderId:request.requesterId,auth:{isAuthorizedSender:true},
    interaction:{kind:"button",messageId:"444",data:"stackot-approval:"+binding.token,payload:binding.token,namespace:"stackot-approval"},respond:{reply:async(value:{text:string})=>{replies.push(value.text);}}};
  return {request,repo,store,binding,registration,context,replies,audits,counts:()=>({factories,credentials,pushes}),mutatePlan:()=>{(state.task as State).planVersion=2;revision++;}};
}
test("native handler guards precede owner factory/credential/transport lookup",async()=>{
  for(const delta of [{auth:{isAuthorizedSender:false}},{senderId:"234567890123456789"},{guildId:"999"}]){
    const f=await fixture();await f.registration.handler({...f.context,...delta});
    expect(f.counts()).toEqual({factories:0,credentials:0,pushes:0});expect((await f.repo.get(f.request.requestId))?.status).toBe("pending");
  }
  const f=await fixture();f.mutatePlan();await f.registration.handler(f.context);expect(f.counts().factories).toBe(0);
});
test("push approval is committed before lazy owner dispatch and cannot replay",async()=>{
  const f=await fixture();await f.registration.handler(f.context);
  expect(f.counts()).toEqual({factories:1,credentials:1,pushes:1});expect((await f.repo.get(f.request.requestId))?.status).toBe("consumed");
  expect(f.replies[0]).toContain("원격 push를 확인했습니다");
  await f.registration.handler(f.context);expect(f.counts().pushes).toBe(1);
});
test("start/deny callbacks never gain the push dispatch closure",async()=>{
  const f=await fixture();f.binding.dispatchPush=undefined;f.binding.request={...f.request,action:"start"};
  attachNativePush(f.binding,f.store,async()=>{throw new Error("must not execute");});expect(f.binding.dispatchPush).toBeUndefined();
  f.binding.request=f.request;f.binding.decision="deny";attachNativePush(f.binding,f.store,async()=>{throw new Error("must not execute");});expect(f.binding.dispatchPush).toBeUndefined();
});

test("owner dispatch rejection reports committed approval without claiming remote completion",async()=>{
  const f=await fixture();f.binding.dispatchPush=async()=>{throw new Error("private-owner-secret failed");};
  await f.registration.handler(f.context);
  expect((await f.repo.get(f.request.requestId))?.status).toBe("approved");
  expect(f.counts().pushes).toBe(0);expect(f.replies[0]).toContain("승인은 저장됐지만");
  expect(f.replies[0]).toContain("push 완료를 확인하지 못했습니다");
  expect(f.replies[0]).not.toContain("private-owner-secret");expect(f.replies[0]).not.toBe("승인했습니다.");
  expect(f.audits[0]).toBe("push_uncertain");
  await f.registration.handler(f.context);expect(f.counts().pushes).toBe(0);
});
