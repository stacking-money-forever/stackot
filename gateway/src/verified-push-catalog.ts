import {isolatedRevisionVerifier,type IsolatedVerifierOwner} from './docker-verifier.ts';
import type {DockerWorkerOwner,WorkerReceipt} from './docker-worker.ts';
import type {WorkerClaim} from '../../receiver/src/verifier.ts';
import type {CallbackBinding} from './callback.ts';
import type {StateStore} from './state/flow-store.ts';
import {ownerPushFactory,type OwnerPushCatalog} from './owner-push.ts';
import type {NativePushOwnerFactory} from './native-push.ts';
import type {PushTarget} from './push.ts';

export type OwnerTaskLease={taskId:string;requesterId:string;planHash:string;planVersion:number;
  workspace:string;commonGitDir:string;baseSha:string;executionId:string;receipt:WorkerReceipt;claim:WorkerClaim};
export type OwnerLeaseResolver=(store:StateStore,binding:Readonly<CallbackBinding>)=>Promise<OwnerTaskLease|undefined>;
export type VerifiedCatalogPolicy={repo:string;executor:DockerWorkerOwner;snapshotRoot:string;gitExecutable:string;
  testCommand:string;resolveLease:OwnerLeaseResolver;credentialForRepo:(repo:string)=>Promise<string>};
type VerifierFactory=(owner:IsolatedVerifierOwner)=>Promise<{verifyTarget:(target:PushTarget)=>Promise<boolean>}>;
const object=(value:unknown):Record<string,any>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:undefined;

/** Construction and resolver are trusted owner code; never JSON/RPC. A real
 * S30 lease provider is required. Missing runtime data cannot mint a candidate. */
export function verifiedPushCatalog(policy:VerifiedCatalogPolicy,testVerifier?:VerifierFactory):OwnerPushCatalog{
  const fixed={...policy,executor:{...policy.executor}};
  return async(store,binding)=>{
    if(binding.request.action!=='push'||binding.decision!=='approve')return undefined;
    const raw=await fixed.resolveLease(store,binding);if(!raw)return undefined;
    const lease=structuredClone(raw),request=binding.request;
    const snapshot=await store.read(),task=object(snapshot.state.task);
    if(snapshot.cancelRequestedAt!==undefined||!task||!['waiting','running'].includes(task.status)||
      lease.taskId!==request.taskId||lease.requesterId!==request.requesterId||lease.planHash!==request.planHash||lease.planVersion!==request.planVersion||
      task.id!==lease.taskId||task.requesterId!==lease.requesterId||task.planHash!==lease.planHash||task.planVersion!==lease.planVersion||
      !lease.executionId||lease.receipt.executionId!==lease.executionId||lease.receipt.kind!=='exited'||lease.receipt.exitCode!==0||!lease.receipt.cleanupConfirmed)
      throw new Error('OWNER_TASK_LEASE_UNCONFIRMED');
    const intent=object(object(snapshot.state.pushIntents)?.[request.requestId]),value=object(intent?.target);
    if(intent?.phase!=='prepared'||!value||value.repo!==fixed.repo||typeof value.branch!=='string'||typeof value.commitSha!=='string')
      throw new Error('OWNER_PUSH_TARGET_UNCONFIRMED');
    const target:PushTarget={repo:value.repo,branch:value.branch,commitSha:value.commitSha};
    const verifier=await (testVerifier??isolatedRevisionVerifier)({executor:fixed.executor,workspace:lease.workspace,
      commonGitDir:lease.commonGitDir,snapshotRoot:fixed.snapshotRoot,gitExecutable:fixed.gitExecutable,
      taskId:lease.taskId,baseSha:lease.baseSha,target,testCommand:fixed.testCommand,claim:lease.claim});
    return {operationId:lease.executionId+':push:'+request.requestId,target,source:lease.workspace,
      ownerRoot:fixed.executor.ownerRoot,gitExecutable:fixed.gitExecutable,verify:verifier.verifyTarget,
      credentialForRepo:async repo=>{if(repo!==fixed.repo)throw new Error('OWNER_PUSH_REPO_DENIED');return fixed.credentialForRepo(repo);}};
  };
}

/** Pass explicitly to nativeCallbackRegistry from a trusted owner bootstrap.
 * Default register deliberately has no policy/lease provider or activation. */
export function verifiedPushOwner(policy:VerifiedCatalogPolicy,testVerifier?:VerifierFactory):NativePushOwnerFactory{
  return ownerPushFactory(verifiedPushCatalog(policy,testVerifier));
}
