import {createHash} from "node:crypto";
import type {GatewayApi} from "./plugin.ts";
import {STACKOT_CONTROLLER_ID} from "./controller.ts";
import {FlowStateStore,type NativeFlow} from "./state/flow-store.ts";
import {ApprovalRepository,type ApprovalInput} from "./approval.ts";
import {ApprovalPromptPublisher,type PromptRoute} from "./prompt.ts";
import {discordPromptTransport,type NativePromptApi} from "./discord-prompt.ts";
type QaConfig={enabled:true;fixtureId:string;accountId:string;guildId:string;threadId:string;forumId:string;
  requesterId:string;secondUserId:string;approvalTtlMs?:number};
export const QA_SCHEMA={type:"object",additionalProperties:false,required:["enabled"],properties:{
  enabled:{type:"boolean"},fixtureId:{type:"string",pattern:"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},
  accountId:{type:"string",minLength:1},guildId:{type:"string",pattern:"^[1-9][0-9]{0,19}$"},
  threadId:{type:"string",pattern:"^[1-9][0-9]{0,19}$"},forumId:{type:"string",pattern:"^[1-9][0-9]{0,19}$"},
  requesterId:{type:"string",pattern:"^[1-9][0-9]{0,19}$"},secondUserId:{type:"string",pattern:"^[1-9][0-9]{0,19}$"},
  approvalTtlMs:{type:"integer",minimum:1000,maximum:900000}}};
const snowflake=(v:unknown):v is string=>typeof v==="string"&&/^[1-9][0-9]{0,19}$/.test(v)&&BigInt(v)<=18_446_744_073_709_551_615n;
export function registerActorQa(api:GatewayApi,agentId:string):void{
  const raw=api.pluginConfig?.qa;
  if(!raw||typeof raw!=="object"||(raw as Record<string,unknown>).enabled!==true)return;
  const cfg=raw as QaConfig;
  if(typeof cfg.fixtureId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cfg.fixtureId)||
    typeof cfg.accountId!=="string"||!cfg.accountId.trim()||![cfg.guildId,cfg.threadId,cfg.forumId,cfg.requesterId,cfg.secondUserId].every(snowflake)||
    cfg.requesterId===cfg.secondUserId||cfg.threadId===cfg.forumId)throw new Error("QA_CONFIG_INVALID");
  if(cfg.approvalTtlMs!==undefined&&(!Number.isSafeInteger(cfg.approvalTtlMs)||
    cfg.approvalTtlMs<1000||cfg.approvalTtlMs>900000))throw new Error("QA_TTL_INVALID");
  const route:PromptRoute={accountId:cfg.accountId,guildId:cfg.guildId,
    conversationId:`channel:${cfg.threadId}`,parentConversationId:cfg.forumId};
  const resolved=api.runtime.channel.routing.resolveAgentRoute({cfg:api.config,channel:"discord",accountId:cfg.accountId,
    guildId:cfg.guildId,peer:{kind:"channel",id:cfg.threadId},parentPeer:{kind:"channel",id:cfg.forumId}});
  if(resolved.agentId!==agentId||resolved.accountId!==cfg.accountId||!resolved.sessionKey)throw new Error("QA_ROUTE_INVALID");
  const native=api.runtime.tasks.async.managedFlows.bindSession({sessionKey:resolved.sessionKey});
  const taskId=`stackot-qa:${cfg.fixtureId}`;
  // Preserve old S28 fingerprints when no override exists. Changing an explicit
  // TTL cannot silently reuse a fixture/grant created with different semantics.
  const fingerprintFields:unknown[]=[route,cfg.fixtureId,cfg.requesterId,cfg.secondUserId];
  if(cfg.approvalTtlMs!==undefined)fingerprintFields.push(cfg.approvalTtlMs);
  const fixtureFingerprint=createHash("sha256").update(JSON.stringify(fingerprintFields)).digest("hex");
  const plan="이 요청은 두 사용자 승인 검증용입니다. 실제 코딩, push, PR 또는 배포를 실행하지 않습니다.";
  const input:ApprovalInput={requestId:`qa-${cfg.fixtureId}`,taskId,requesterId:cfg.requesterId,
    planHash:createHash("sha256").update(plan).digest("hex"),planVersion:1,action:"start",ttlMs:cfg.approvalTtlMs??900000};
  const find=async()=>{
    const matches=(await native.list()).filter(f=>f.ownerKey===resolved.sessionKey&&f.controllerId===STACKOT_CONTROLLER_ID&&
      (f.stateJson as {task?:{id?:string}})?.task?.id===taskId);
    if(matches.length>1)throw new Error("QA_FLOW_AMBIGUOUS");
    const flow=matches[0];
    if(flow&&(flow.stateJson as {qaFingerprint?:string})?.qaFingerprint!==fixtureFingerprint)throw new Error("QA_FIXTURE_CHANGED");
    return flow;
  };
  const install=(name:string,run:()=>Promise<object>)=>api.registerGatewayMethod(name,async({params,respond})=>{
    if(Object.keys(params).length){respond(false,undefined,{code:"INVALID_REQUEST",message:"No parameters accepted"});return;}
    try{respond(true,await run());}catch{respond(false,undefined,{code:"QA_FAILED",message:"Inspect private server evidence"});}
  },{scope:"operator.admin"});
  install("stackotgateway.qa.info",async()=>({agentId,sessionKey:resolved.sessionKey,route,
    requesterId:cfg.requesterId,secondUserId:cfg.secondUserId,fixtureId:cfg.fixtureId,
    approvalTtlMs:input.ttlMs,syntheticPlan:true}));
  install("stackotgateway.qa.publish",async()=>{
    let flow=await find();
    if(!flow){
      if(!native.createManaged)throw new Error("NATIVE_CREATE_UNAVAILABLE");
      flow=await native.createManaged({controllerId:STACKOT_CONTROLLER_ID,goal:"Stackot native actor QA",
        notifyPolicy:"silent",stateJson:{schemaVersion:1,synthetic:true,qaFingerprint:fixtureFingerprint,task:{id:taskId,requesterId:cfg.requesterId,
          planHash:input.planHash,planVersion:1,status:"planned",planText:plan}}});
    }
    const store=new FlowStateStore(native,flow.flowId,resolved.sessionKey,STACKOT_CONTROLLER_ID);
    const approvals=new ApprovalRepository(store);
    if(!await approvals.get(input.requestId))await approvals.request(input);
    const publisher=new ApprovalPromptPublisher(store,discordPromptTransport(api as unknown as NativePromptApi,route));
    return {flowId:flow.flowId,...await publisher.publish(route,input.requestId,[cfg.requesterId,cfg.secondUserId]),
      syntheticPlan:true,workerDispatched:false};
  });
  install("stackotgateway.qa.status",async()=>{
    const flow=await find();if(!flow)return {found:false};
    const store=new FlowStateStore(native,flow.flowId,resolved.sessionKey,STACKOT_CONTROLLER_ID);
    const approval=await new ApprovalRepository(store).get(input.requestId);
    return {found:true,flowId:flow.flowId,revision:flow.revision,status:approval?.status,
      requestedAt:approval?.requestedAt,expiresAt:approval?.expiresAt,
      decidedBy:approval&&approval.status!=="pending"?approval.decidedBy:undefined,
      syntheticPlan:true,workerDispatched:false};
  });
}
