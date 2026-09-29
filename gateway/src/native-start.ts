import {StartAuthority,StartUnavailableError,type OwnerStartExecutor,type StartResult} from './start.ts';
import type {CallbackBinding} from './callback.ts';
import type {StateStore} from './state/flow-store.ts';
import type {ApprovalInput} from './approval.ts';
export type NativeStartPreparation=(store:StateStore,input:ApprovalInput)=>Promise<void>;

/** Installed by owner bootstrap code only. Missing factory means no execution. */
export type NativeStartOwnerFactory=(store:StateStore,binding:Readonly<CallbackBinding>)=>Promise<{
  executor:OwnerStartExecutor;operationId:string;
}|undefined>;
export function attachNativeStart(binding:CallbackBinding,store:StateStore,factory:NativeStartOwnerFactory):void{
  if(binding.decision!=='approve'||binding.request.action!=='start')return;
  binding.dispatchStart=async context=>{
    const snapshot=await store.read(),task=snapshot.state.task;
    if(snapshot.cancelRequestedAt!==undefined||snapshot.state.executionPolicy!=='coding'||
      snapshot.state.synthetic===true||snapshot.state.qaFingerprint!==undefined||
      !task||typeof task!=='object'||Array.isArray(task)||typeof task.id!=='string'||task.id.startsWith('stackot-qa:'))
      throw new Error('OWNER_START_TASK_DENIED');
    const entry=await factory(store,binding);
    if(!entry)throw new StartUnavailableError('OWNER_START_NOT_PREPARED');
    return new StartAuthority(store,entry.executor).execute(context,entry.operationId);
  };
}
export type {StartResult};
