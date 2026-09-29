import {test,expect} from "bun:test";
import {createHash} from 'node:crypto';
import plugin,{stackotGatewayPlugin,nativeCallbackRegistry,type GatewayApi} from "../src/plugin.ts";
import {StartAuthority,type OwnerStartExecutor} from '../src/start.ts';
import {FlowStateStore,type NativeFlow,type State} from "../src/state/flow-store.ts";
import {FlowCallbackRegistry} from "../src/callback-registry.ts";
import {ApprovalRepository,type ApprovalInput} from "../src/approval.ts";
const token="6f028276-12ad-4d80-9418-614ecf8b9e50";
const context={accountId:"default",guildId:"111",conversationId:"channel:345678901234567890",parentConversationId:"123456789012345678"};
const request:ApprovalInput={requestId:"request-1",taskId:"owner/repo#7",requesterId:"123456789012345678",
  planHash:createHash('sha256').update('Fixed owner plan').digest('hex'),planVersion:1,action:"start",ttlMs:86400000};
async function fixture(){
  let flows:NativeFlow[]=[{flowId:"flow-1",ownerKey:"native-owner",controllerId:"stackot",syncMode:"managed",
    status:"waiting",revision:0,stateJson:{schemaVersion:1,task:{id:request.taskId,requesterId:request.requesterId,
      planHash:request.planHash,planVersion:1,status:"planned",planText:'Fixed owner plan'}}}];
  let agentId="stackot",listCalls=0;const routes:unknown[]=[];
  const native={get:async(id:string)=>structuredClone(flows.find(f=>f.flowId===id)),
    list:async()=>{listCalls++;return structuredClone(flows);},
    setWaiting:async(input:{flowId:string;expectedRevision:number;stateJson:State})=>{
      const flow=flows.find(f=>f.flowId===input.flowId)!;
      if(flow.revision!==input.expectedRevision)return {applied:false as const,code:"revision_conflict"};
      flow.stateJson=structuredClone(input.stateJson);flow.revision++;return {applied:true as const,flow:structuredClone(flow)};
    }};
  const store=new FlowStateStore(native,"flow-1","native-owner","stackot"),repo=new ApprovalRepository(store);
  await repo.request(request);await new FlowCallbackRegistry(store,repo).bind({...context,
    messageId:"456789012345678901",request,decision:"approve"},token);
  let registration:Parameters<GatewayApi["registerInteractiveHandler"]>[0]|undefined;
  const methods=new Map<string,Parameters<GatewayApi["registerGatewayMethod"]>[1]>();
  const api:GatewayApi={config:{bindings:[]},pluginConfig:{agentId:"stackot"},
    registerInteractiveHandler:r=>{registration=r;},registerGatewayMethod:(name,handler)=>{methods.set(name,handler);},
    runtime:{channel:{routing:{resolveAgentRoute:input=>{routes.push(input);return {agentId,sessionKey:"native-owner",accountId:"default"};}}},
      tasks:{async:{managedFlows:{bindSession:({sessionKey})=>{expect(sessionKey).toBe("native-owner");return native;}}}}}};
  return {api,flows,methods,registration:()=>registration,listCalls:()=>listCalls,routes,setAgent:(value:string)=>{agentId=value;}};
}
test("new bootstrap registry rediscovers callback from native route/list each time",async()=>{
  const f=await fixture();
  const first=await nativeCallbackRegistry(f.api,"stackot").resolve(token,context);
  const next=await nativeCallbackRegistry(f.api,"stackot").resolve(token,context);
  expect(first?.request).toEqual(request);expect(next?.messageId).toBe(first?.messageId);expect(f.listCalls()).toBe(2);
  expect(f.routes[0]).toMatchObject({channel:"discord",peer:{kind:"channel",id:"345678901234567890"},
    parentPeer:{kind:"channel",id:context.parentConversationId}});
  expect((await next!.repository.decide({requestId:request.requestId,taskId:request.taskId,
    actorId:request.requesterId,planHash:request.planHash,planVersion:1,action:"start"},"approve")).status).toBe("approved");
});

test('registered owner bootstrap connects prepared coding approval to one start',async()=>{
  const f=await fixture();(f.flows[0]!.stateJson as State).executionPolicy='coding';
  const native=f.api.runtime.tasks.async.managedFlows.bindSession({sessionKey:'native-owner'});
  const store=new FlowStateStore(native,'flow-1','native-owner','stackot');
  let spawns=0,factories=0;
  const destination={agentId:'codex' as const,task:'Fixed owner plan',cwd:'/owned/task',runTimeoutSeconds:60};
  const executor:OwnerStartExecutor={allows:value=>JSON.stringify(value)===JSON.stringify(destination),ready:async()=>true,
    spawn:async(_value,_operation,authorize)=>{expect(await authorize()).toBe(true);spawns++;return {runId:'observed-run',childSessionKey:'agent:codex:worker'};}};
  await new StartAuthority(store,executor).prepare(request,destination);
  stackotGatewayPlugin({startOwner:async()=>{factories++;return {executor,operationId:'registered-operation'};},
    prepareStart:(bound,input)=>new StartAuthority(bound,executor).prepare(input,destination)}).register(f.api);
  const cb={channel:'discord',...context,senderId:request.requesterId,auth:{isAuthorizedSender:true},
    interaction:{kind:'button',messageId:'456789012345678901',data:'stackot-approval:'+token,namespace:'stackot-approval',payload:token},
    respond:{reply:async()=>{}}};
  expect(spawns).toBe(0);expect(factories).toBe(0);
  await f.registration()!.handler(cb);expect(spawns).toBe(1);expect(factories).toBe(1);
  await f.registration()!.handler(cb);expect(spawns).toBe(1);expect(factories).toBe(1);
  expect((await new ApprovalRepository(store).get(request.requestId))?.status).toBe('consumed');
});
test("foreign agent/owner/controller and missing native route never find a grant",async()=>{
  const f=await fixture(),registry=nativeCallbackRegistry(f.api,"stackot");
  expect(await registry.resolve(token)).toBeUndefined();f.setAgent("main");
  expect(await registry.resolve(token,context)).toBeUndefined();expect(f.listCalls()).toBe(0);f.setAgent("stackot");
  f.flows[0]!.ownerKey="other";expect(await registry.resolve(token,context)).toBeUndefined();
  f.flows[0]!.ownerKey="native-owner";f.flows[0]!.controllerId="other";
  expect(await registry.resolve(token,context)).toBeUndefined();
});
test("duplicate token in separate native flows fails instead of selecting first",async()=>{
  const f=await fixture();f.flows.push({...structuredClone(f.flows[0]!),flowId:"flow-2"});
  await expect(nativeCallbackRegistry(f.api,"stackot").resolve(token,context)).rejects.toThrow("CALLBACK_TOKEN_AMBIGUOUS");
});
test("role-dependent routes fail closed because native callback omits role IDs",async()=>{
  const f=await fixture();f.api.config.bindings=[{match:{channel:"discord",guildId:"111",roles:["999"]}}];
  expect(await nativeCallbackRegistry(f.api,"stackot").resolve(token,context)).toBeUndefined();expect(f.routes).toHaveLength(0);
});
test("native cancellation before lookup or after binding discovery cannot approve",async()=>{
  const f=await fixture(),registry=nativeCallbackRegistry(f.api,"stackot");
  const binding=await registry.resolve(token,context);expect(binding).toBeDefined();
  f.flows[0]!.cancelRequestedAt=0;f.flows[0]!.revision++;
  expect(await registry.resolve(token,context)).toBeUndefined();
  await expect(binding!.repository.decide({requestId:request.requestId,taskId:request.taskId,
    actorId:request.requesterId,planHash:request.planHash,planVersion:1,action:"start"},"approve"))
    .rejects.toThrow("FLOW_CANCEL_REQUESTED");
  expect(((f.flows[0]!.stateJson as State).approvals as State)[request.requestId]).toMatchObject({status:"pending"});
});
test("bootstrap registers private callback and parameter-free readonly admin health",async()=>{
  const f=await fixture();plugin.register(f.api);expect(f.registration()?.namespace).toBe("stackot-approval");
  let result:unknown;const health=f.methods.get("stackotgateway.health")!;
  await health({params:{},respond:(ok,value)=>{result={ok,value};}});
  expect(result).toMatchObject({ok:true,value:{pluginId:"stackot-gateway",callbackRegistered:true}});
  await health({params:{actorId:request.requesterId},respond:ok=>{result=ok;}});expect(result).toBe(false);
  f.api.pluginConfig={};expect(()=>plugin.register(f.api)).toThrow("STACKOT_AGENT_REQUIRED");
});
