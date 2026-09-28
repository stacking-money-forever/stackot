import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ThreadReceiptRepository, type Scope, type ThreadRef, type ThreadBackend } from "../../src/thread-receipt.ts";
import { FlowStateStore, type State, type StateStore, type ManagedFlows, type NativeFlow } from "../../src/state/flow-store.ts";

const controllerId = "stackot-s35-probe";
const scope: Scope = {taskId:"owner/repo#7",forumId:"123456789012345678",botId:"234567890123456789"};
type Api = {runtime:{tasks:{async:{managedFlows:{bindSession(input:{sessionKey:string}):
  ManagedFlows & {createManaged(input:object):Promise<NativeFlow>}
}}}},registerGatewayMethod(name:string,handler:(input:{params:Record<string,unknown>;
  respond:(ok:boolean,value?:object,error?:object)=>void})=>Promise<void>,options:object):void};

// Fixture provider only. Durable fake external marker survives the real Gateway
// restart independently of native flow state. It proves no Discord capability.
function backend(): ThreadBackend & {calls():Promise<number>} {
  if (!process.env.OPENCLAW_STATE_DIR) throw new Error("OWNED_STATE_REQUIRED");
  const file = join(process.env.OPENCLAW_STATE_DIR, "s35-synthetic-provider.json");
  const records = async ():Promise<ThreadRef[]> => {
    try {return JSON.parse(await readFile(file,"utf8"));}
    catch(error) {if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
  };
  return {durableIdempotency:false,
    async create(s,operationId) {
      const entries=await records();
      const receipt={...s,operationId,threadId:"345678901234567890"};
      await writeFile(file,JSON.stringify([...entries,receipt]));return receipt;
    },
    async findByOperation(_s,operationId){return (await records()).find(r=>r.operationId===operationId);},
    async calls(){return (await records()).length;}
  };
}

export default {
  id:"s35-probe",name:"S35 synthetic provider/native receipt restart fixture",
  configSchema:{type:"object",additionalProperties:false,properties:{}},
  register(api:Api) {
    api.registerGatewayMethod("s35probe.state",async({params,respond})=>{
      try {
        if(typeof params.sessionKey!=="string")throw new Error("SESSION_REQUIRED");
        const sessionKey=params.sessionKey;
        const native=api.runtime.tasks.async.managedFlows.bindSession({sessionKey});
        const provider=backend();
        if(params.phase==="init") {
          const flow=await native.createManaged({controllerId,goal:"S35 native receipt fixture",
            notifyPolicy:"silent",stateJson:{schemaVersion:1,synthetic:true,unrelated:{keep:true}}});
          const store=new FlowStateStore(native,flow.flowId,sessionKey,controllerId);
          const crashing:StateStore={read:()=>store.read(),compareAndSwap:async(revision,state)=>{
            const receipts=state.threadReceipts as State|undefined;
            if(receipts&&Object.values(receipts).some(r=>(r as State).phase==="created"))
              throw new Error("SIMULATED_POST_CREATE_RECEIPT_CRASH");
            return store.compareAndSwap(revision,state);
          }};
          let injected=false;
          try {await new ThreadReceiptRepository(crashing,provider).ensure(scope);}
          catch(error) {if(String(error).includes("SIMULATED_POST_CREATE_RECEIPT_CRASH"))injected=true;else throw error;}
          if(!injected)throw new Error("CRASH_NOT_INJECTED");
          const snapshot=await store.read();
          const entry=Object.values(snapshot.state.threadReceipts as State)[0] as State;
          respond(true,{gatewayPid:process.pid,flowId:flow.flowId,crashInjected:injected,
            operationId:entry.operationId,phase:entry.phase,revision:snapshot.revision,
            providerCalls:await provider.calls(),syntheticProvider:true});
        } else if(params.phase==="read"&&typeof params.flowId==="string") {
          const store=new FlowStateStore(native,params.flowId,sessionKey,controllerId);
          const repo=new ThreadReceiptRepository(store,provider);
          const recovered=await repo.ensure(scope);const repeated=await repo.ensure(scope);
          const snapshot=await store.read();
          respond(true,{gatewayPid:process.pid,flowId:params.flowId,result:recovered,repeated,
            revision:snapshot.revision,unrelated:snapshot.state.unrelated,
            providerCalls:await provider.calls(),syntheticProvider:true});
        } else throw new Error("PHASE_INVALID");
      } catch(error) {respond(false,undefined,{code:"PROBE_ERROR",message:String(error)});}
    },{scope:"operator.admin"});
  }
};
