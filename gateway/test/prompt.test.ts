import {test,expect} from "bun:test";
import {createHash} from "node:crypto";
import {ApprovalPromptPublisher,PromptNotSentError,type PromptTransport,type PromptReceipt,type ComponentSpec} from "../src/prompt.ts";
import {ApprovalRepository,type ApprovalInput} from "../src/approval.ts";
import type {StateStore,State} from "../src/state/flow-store.ts";
const route={accountId:"default",guildId:"111",conversationId:"channel:345678901234567890",parentConversationId:"123456789012345678"};
class Store implements StateStore{
  revision=0;state:State={};cancelRequestedAt:number|undefined;
  async read(){return {revision:this.revision,state:structuredClone(this.state),cancelRequestedAt:this.cancelRequestedAt};}
  async compareAndSwap(revision:number,state:State){if(revision!==this.revision)return false;
    this.state=structuredClone(state);this.revision++;return true;}
}
async function fixture(plan="실제 코딩 없이 승인 경계를 확인한다."){
  const store=new Store();const input:ApprovalInput={requestId:"request-1",taskId:"owner/repo#7",requesterId:"123456789012345678",
    planHash:createHash("sha256").update(plan).digest("hex"),planVersion:1,action:"start",ttlMs:1000};
  store.state={schemaVersion:1,keep:{unchanged:true},task:{id:input.taskId,requesterId:input.requesterId,
    planHash:input.planHash,planVersion:1,status:"planned",planText:plan}};
  await new ApprovalRepository(store,()=>100).request(input);
  let now=200,planCalls=0,cardCalls=0,editCalls=0;const specs:ComponentSpec[]=[];const plans:string[]=[];
  const result=(id:string):PromptReceipt=>({channel:"discord",messageId:id,target:{kind:"channel",id:route.conversationId.slice(8)}});
  const transport:PromptTransport={sendPlan:async(text,check)=>{await check();planCalls++;plans.push(text);return result("500");},
    sendCard:async(spec,check,record)=>{await check();cardCalls++;specs.push(spec);await record(result("600"));
      expect(Object.keys(store.state.approvalCallbacks as State)).toHaveLength(2);return result("600");},
    editCard:async(id,spec)=>{editCalls++;specs.push(spec);return result(id);}};
  const publisher=new ApprovalPromptPublisher(store,transport,()=>now);
  return {store,input,publisher,transport,specs,plans,result,setClock:(v:number)=>{now=v;},
    counts:()=>({plan:planCalls,card:cardCalls,edit:editCalls})};
}
test("full plan precedes reusable, requester-bound buttons and stable replay",async()=>{
  const full="계획 전체 내용\n"+"긴 내용은 자르지 않는다.\n".repeat(2000);const f=await fixture(full);
  const published=await f.publisher.publish(route,f.input.requestId);
  expect(published).toEqual({kind:"published",messageId:"600",reused:false});expect(f.plans[0]).toContain(full);
  expect(f.counts()).toEqual({plan:1,card:1,edit:0});expect(f.specs[0]?.text).toContain("/111/345678901234567890/500");
  const buttons=f.specs[0]!.blocks[0]!.buttons;
  expect(buttons.map(b=>b.allowedUsers)).toEqual([[f.input.requesterId],[f.input.requesterId]]);
  expect(buttons.every(b=>b.reusable&&b.callbackDataKind==="callback")).toBe(true);
  expect(buttons.every(b=>/^stackot-approval:[0-9a-f-]{36}$/.test(b.callbackData))).toBe(true);
  expect(await f.publisher.publish(route,f.input.requestId)).toEqual({kind:"published",messageId:"600",reused:true});
  expect(f.counts().card).toBe(1);expect(f.store.state.keep).toEqual({unchanged:true});
});
test("partial or ambiguous full-plan delivery never exposes an approval card or blindly resends",async()=>{
  const f=await fixture();let sends=0;f.transport.sendPlan=async()=>{sends++;throw new Error("PARTIAL_PLAN_ACK_LOST");};
  expect(await f.publisher.publish(route,f.input.requestId)).toMatchObject({kind:"uncertain",reason:"PLAN_SEND_AMBIGUOUS"});
  expect(await f.publisher.publish(route,f.input.requestId)).toMatchObject({kind:"uncertain",reason:"SEND_NOT_PROVED_ABSENT"});
  expect(sends).toBe(1);expect(f.counts().card).toBe(0);expect(f.store.state.approvalCallbacks).toBeUndefined();
});
test("known delivered card after native registration failure is repaired with edit, never a second send",async()=>{
  const f=await fixture();const original=f.transport.sendCard;
  f.transport.sendCard=async(...args)=>{await original(...args);throw new Error("NATIVE_COMPONENT_REGISTER_FAILED");};
  expect((await f.publisher.publish(route,f.input.requestId)).kind).toBe("uncertain");
  expect(await f.publisher.publish(route,f.input.requestId)).toEqual({kind:"published",messageId:"600",reused:true});
  expect(f.counts()).toEqual({plan:1,card:1,edit:1});
  expect(f.specs[0]?.blocks[0]?.buttons).toEqual(f.specs[1]?.blocks[0]?.buttons);
});
test("unreported card send never becomes a new visible create",async()=>{
  const f=await fixture();let creates=0;f.transport.sendCard=async()=>{creates++;throw new Error("CARD_ACK_LOST");};
  await f.publisher.publish(route,f.input.requestId);
  expect(await f.publisher.publish(route,f.input.requestId)).toMatchObject({kind:"uncertain",reason:"SEND_NOT_PROVED_ABSENT"});
  expect(creates).toBe(1);expect(f.store.state.approvalCallbacks).toBeUndefined();
});
test("proven adapter-not-ready permits retry of the same intent after setup",async()=>{
  const f=await fixture();const original=f.transport.sendPlan;
  f.transport.sendPlan=async()=>{throw new PromptNotSentError("ADAPTER_NOT_READY");};
  expect(await f.publisher.publish(route,f.input.requestId)).toMatchObject({kind:"uncertain",reason:"PLAN_NOT_SENT"});
  f.transport.sendPlan=original;expect((await f.publisher.publish(route,f.input.requestId)).kind).toBe("published");
  expect(f.counts()).toEqual({plan:1,card:1,edit:0});
});
test("concurrent publishers give one plan/card sender, not CAS losers send permission",async()=>{
  const f=await fixture();await Promise.all(Array.from({length:8},()=>f.publisher.publish(route,f.input.requestId)));
  expect(f.counts()).toEqual({plan:1,card:1,edit:0});
});
test("plan mutation, expiry or native cancellation denies physical dispatch",async()=>{
  for(const cause of ["plan","expired","cancel"]){
    const f=await fixture();f.transport.sendPlan=async(_text,check)=>{
      if(cause==="plan")(f.store.state.task as State).planText="변경한 계획";
      if(cause==="expired")f.setClock(1100);if(cause==="cancel")f.store.cancelRequestedAt=0;
      await check();throw new Error("SHOULD_NOT_DISPATCH");
    };
    expect((await f.publisher.publish(route,f.input.requestId)).kind).toBe("uncertain");
    expect(f.counts().card).toBe(0);expect(f.store.state.approvalCallbacks).toBeUndefined();
  }
});
test("foreign actual receipt and changed route cannot bind grants",async()=>{
  const f=await fixture();f.transport.sendCard=async(_spec,_check,record)=>{
    await record({...f.result("600"),target:{kind:"channel",id:"999"}});return f.result("600");};
  expect((await f.publisher.publish(route,f.input.requestId)).kind).toBe("uncertain");
  expect(f.store.state.approvalCallbacks).toBeUndefined();
  await expect(f.publisher.publish({...route,guildId:"222"},f.input.requestId)).rejects.toThrow("PROMPT_ROUTE_CONFLICT");
});
