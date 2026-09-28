// Installed-library contract oracle only; no messages, actor contexts or model calls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {ApprovalPromptPublisher} from '../dist/prompt.js';
import {ApprovalRepository} from '../dist/approval.js';

const [componentsFile,registryFile]=process.argv.slice(2);
if(!componentsFile||!registryFile)throw new Error('Expected pinned component and interactive-registry module paths');
const components=await import(pathToFileURL(componentsFile).href);
const registry=await import(pathToFileURL(registryFile).href);
const findFunction=(module,name)=>{
  const fn=Object.values(module).find(value=>typeof value==='function'&&value.name===name);
  assert.equal(typeof fn,'function',name);return fn;
};
const parse=findFunction(components,'readDiscordComponentSpec');
const build=findFunction(components,'buildDiscordComponentMessage');
const match=findFunction(registry,'resolvePluginInteractiveRegistrationsMatch');
const plan='Native SDK schema check; no actual actor or outbound delivery.';
const input={requestId:'sdk-contract',taskId:'owner/repo#7',requesterId:'123456789012345678',
  planHash:createHash('sha256').update(plan).digest('hex'),planVersion:1,action:'start',ttlMs:1000};
let state={schemaVersion:1,task:{id:input.taskId,requesterId:input.requesterId,
  planHash:input.planHash,planVersion:1,status:'planned',planText:plan}},revision=0;
const store={read:async()=>({revision,state:structuredClone(state)}),compareAndSwap:async(r,next)=>{
  if(r!==revision)return false;state=structuredClone(next);revision++;return true;
}};
await new ApprovalRepository(store,()=>100).request(input);
const route={accountId:'default',guildId:'111',conversationId:'channel:345678901234567890',parentConversationId:'123456789012345678'};
const receipt=id=>({channel:'discord',messageId:id,target:{kind:'channel',id:route.conversationId.slice(8)}});
let verified=false;
const producer=new ApprovalPromptPublisher(store,{sendPlan:async()=>receipt('500'),editCard:async()=>{throw new Error('No edit expected');},
  sendCard:async(spec,check,record)=>{
    await check();const rendered=build({spec:parse(spec),accountId:'default'});
    assert.equal(rendered.entries.length,2);assert.ok(rendered.components.length);
    for(const entry of rendered.entries){
      assert.equal(entry.kind,'button');assert.equal(entry.reusable,true);assert.equal(entry.callbackDataKind,'callback');
      assert.deepEqual(entry.allowedUsers,[input.requesterId]);
      const resolved=match([{channel:'discord',namespace:'stackot-approval',handler:()=>{}}],'discord',entry.callbackData);
      assert.equal(resolved.namespace,'stackot-approval');assert.match(resolved.payload,/^[0-9a-f-]{36}$/);
      assert.equal(match([{channel:'discord',namespace:'stackot-approval',handler:()=>{}}],'discord','plugin:'+entry.callbackData),null);
    }
    await record(receipt('600'));verified=true;return receipt('600');
  }},()=>100);
assert.equal((await producer.publish(route,input.requestId)).kind,'published');assert.equal(verified,true);
console.log(JSON.stringify({installedSdkContract:true,buttons:2,reusable:true,callbackKind:'callback',
  namespaceMatched:true,wrongPrefixDenied:true,actualMessageSent:false,actualActorCallback:false}));
