import {test,expect} from "bun:test";
import {registerActorQa} from "../src/qa.ts";
import type {GatewayApi} from "../src/plugin.ts";
import {STACKOT_CONTROLLER_ID} from "../src/plugin.ts";
import {createHash} from "node:crypto";
test("live actor QA is opt-in and rejects forged-context parameters",async()=>{
  const methods=new Map<string,Parameters<GatewayApi["registerGatewayMethod"]>[1]>();let listed=0;
  const api:GatewayApi={config:{},pluginConfig:{agentId:"stackot"},registerInteractiveHandler:()=>{},
    registerGatewayMethod:(name,handler,options)=>{expect(options.scope).toBe("operator.admin");methods.set(name,handler);},
    runtime:{channel:{routing:{resolveAgentRoute:()=>({agentId:"stackot",sessionKey:"native-route",accountId:"default"})}},
      tasks:{async:{managedFlows:{bindSession:()=>({list:async()=>{listed++;return [];},get:async()=>undefined,
        setWaiting:async()=>({applied:false,code:"NO_WRITE"})})}}}}};
  registerActorQa(api,"stackot");expect(methods.size).toBe(0);
  api.pluginConfig!.qa={enabled:true,fixtureId:"6f028276-12ad-4d80-9418-614ecf8b9e50",accountId:"default",guildId:"111",
    threadId:"345678901234567890",forumId:"123456789012345678",requesterId:"123456789012345678",secondUserId:"234567890123456789"};
  registerActorQa(api,"stackot");expect(methods.size).toBe(3);
  for(const handler of methods.values()){
    let ok:unknown;await handler({params:{actorId:"forged",auth:true},respond:result=>{ok=result;}});
    expect(ok).toBe(false);
  }
  expect(listed).toBe(0);
  let info:unknown;await methods.get("stackotgateway.qa.info")!({params:{},respond:(_ok,value)=>{info=value;}});
  expect(info).toMatchObject({sessionKey:"native-route",syntheticPlan:true});
  expect(info).toMatchObject({approvalTtlMs:900000});
  for(const invalid of [0,999,900001,1.5,"10000",NaN]){
    (api.pluginConfig!.qa as Record<string,unknown>).approvalTtlMs=invalid;
    expect(()=>registerActorQa(api,"stackot")).toThrow("QA_TTL_INVALID");
  }
  (api.pluginConfig!.qa as Record<string,unknown>).approvalTtlMs=10000;
  registerActorQa(api,"stackot");
  await methods.get("stackotgateway.qa.info")!({params:{},respond:(_ok,value)=>{info=value;}});
  expect(info).toMatchObject({approvalTtlMs:10000});
});

test("default QA preserves old fixture identity; explicit TTL change cannot reuse it",async()=>{
  const qa={enabled:true,fixtureId:"6f028276-12ad-4d80-9418-614ecf8b9e50",accountId:"default",guildId:"111",
    threadId:"345678901234567890",forumId:"123456789012345678",requesterId:"123456789012345678",secondUserId:"234567890123456789"};
  const route={accountId:qa.accountId,guildId:qa.guildId,conversationId:`channel:${qa.threadId}`,parentConversationId:qa.forumId};
  const fingerprint=createHash("sha256").update(JSON.stringify([route,qa.fixtureId,qa.requesterId,qa.secondUserId])).digest("hex");
  const flow={flowId:"flow-old",ownerKey:"native-route",controllerId:STACKOT_CONTROLLER_ID,syncMode:"managed",status:"waiting",revision:10,
    stateJson:{schemaVersion:1,qaFingerprint:fingerprint,task:{id:`stackot-qa:${qa.fixtureId}`}}};
  const methods=new Map<string,Parameters<GatewayApi["registerGatewayMethod"]>[1]>();let writes=0;
  const api:GatewayApi={config:{},pluginConfig:{agentId:"stackot",qa},registerInteractiveHandler:()=>{},
    registerGatewayMethod:(name,handler)=>{methods.set(name,handler);},
    runtime:{channel:{routing:{resolveAgentRoute:()=>({agentId:"stackot",sessionKey:"native-route",accountId:"default"})}},
      tasks:{async:{managedFlows:{bindSession:()=>({list:async()=>[flow],get:async()=>flow,
        setWaiting:async()=>{writes++;return {applied:false,code:"NO_WRITE"};}})}}}}};
  registerActorQa(api,"stackot");let ok:unknown;let response:unknown;
  await methods.get("stackotgateway.qa.status")!({params:{},respond:(success,value)=>{ok=success;response=value;}});
  expect(ok).toBe(true);expect(response).toMatchObject({found:true,flowId:"flow-old",revision:10});
  (api.pluginConfig!.qa as Record<string,unknown>).approvalTtlMs=10000;registerActorQa(api,"stackot");
  await methods.get("stackotgateway.qa.status")!({params:{},respond:success=>{ok=success;}});
  expect(ok).toBe(false);expect(writes).toBe(0);
});
