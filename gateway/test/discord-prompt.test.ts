import {test,expect} from "bun:test";
import {discordPromptTransport,type NativePromptApi} from "../src/discord-prompt.ts";
import {PromptNotSentError,type ComponentSpec} from "../src/prompt.ts";
const route={accountId:"default",guildId:"111",conversationId:"channel:345678901234567890",parentConversationId:"123456789012345678"};
test("native adapter receives full plan, fixed route, silent send and first-part plan link",async()=>{
  let observed:unknown;
  const api:NativePromptApi={config:{},runtime:{channel:{outbound:{loadAdapter:async()=>({sendPayload:async ctx=>{
    observed=ctx;await ctx.onPlatformSendDispatch();return {channel:"discord",messageId:"501",
      target:{kind:"channel",id:route.conversationId.slice(8)},receipt:{primaryPlatformMessageId:"500"}};}})}}}};
  let checks=0;const full="完整한 계획\n".repeat(5000);
  const r=await discordPromptTransport(api,route).sendPlan(full,async()=>{checks++;});
  expect(r.messageId).toBe("500");expect(checks).toBe(1);
  expect(observed).toMatchObject({to:route.conversationId,accountId:"default",silent:true,text:full,payload:{text:full}});
});
test("native component hook must persist binding before adapter returns success",async()=>{
  const order:string[]=[];
  const api:NativePromptApi={config:{},runtime:{channel:{outbound:{loadAdapter:async()=>({sendPayload:async ctx=>{
    expect(ctx.payload.channelData?.discord.components).toBe(spec);
    await ctx.onPlatformSendDispatch();order.push("physical-send");
    const r={channel:"discord",messageId:"600",target:{kind:"channel",id:route.conversationId.slice(8)}};
    await ctx.onDeliveryResult?.(r);order.push("native-register");return r;
  }})}}}};
  const spec:ComponentSpec={text:"승인",reusable:true,blocks:[]};
  await discordPromptTransport(api,route).sendCard(spec,async()=>{order.push("validate");},async()=>{order.push("persist-binding");});
  expect(order).toEqual(["validate","physical-send","persist-binding","native-register"]);
});
test("unavailable adapter and explicit not-sent are distinct from generic ambiguous transport errors",async()=>{
  const api:NativePromptApi={config:{},runtime:{channel:{outbound:{loadAdapter:async()=>undefined}}}};
  await expect(discordPromptTransport(api,route).sendPlan("计划",async()=>{})).rejects.toBeInstanceOf(PromptNotSentError);
  api.runtime.channel.outbound.loadAdapter=async()=>({sendPayload:async()=>({outcome:"not_sent"})});
  await expect(discordPromptTransport(api,route).sendPlan("计划",async()=>{})).rejects.toBeInstanceOf(PromptNotSentError);
  api.runtime.channel.outbound.loadAdapter=async()=>({sendPayload:async()=>{throw new Error("ACK_LOST");}});
  await expect(discordPromptTransport(api,route).sendPlan("计划",async()=>{})).rejects.toThrow("ACK_LOST");
});
