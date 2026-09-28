import {test,expect} from "bun:test";
import {registerActorQa} from "../src/qa.ts";
import type {GatewayApi} from "../src/plugin.ts";
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
});
