import {test,expect} from 'bun:test';
import {verifiedPushCatalog,verifiedPushOwner,type OwnerTaskLease} from '../src/verified-push-catalog.ts';
import type {CallbackBinding} from '../src/callback.ts';
import type {StateStore} from '../src/state/flow-store.ts';

function fixture(){
  const request={requestId:'push-1',taskId:'owner/repo#7',requesterId:'1112741808162734110',planHash:'a'.repeat(64),planVersion:1,action:'push' as const,ttlMs:1000};
  const binding={request,decision:'approve'} as CallbackBinding;
  const target={repo:'owner/repo',branch:'stackot/task-7',commitSha:'b'.repeat(40)};
  const state:any={task:{id:request.taskId,requesterId:request.requesterId,planHash:request.planHash,planVersion:1,status:'waiting'},
    pushIntents:{'push-1':{phase:'prepared',request,target}}};
  let cancelled=false,credentials=0,verifiers=0,received:any;
  const store:StateStore={read:async()=>({revision:1,state:structuredClone(state),cancelRequestedAt:cancelled?1:undefined}),compareAndSwap:async()=>false};
  const lease:OwnerTaskLease={taskId:request.taskId,requesterId:request.requesterId,planHash:request.planHash,planVersion:1,
    workspace:'/approved/task',commonGitDir:'/approved/repo/.git',baseSha:'c'.repeat(40),executionId:'actual-execution-reference',
    receipt:{executionId:'actual-execution-reference',kind:'exited',exitCode:0,cleanupConfirmed:true},
    claim:{filesChanged:['code.ts'],testsPassed:true,testCommand:'owner-tests'}};
  const policy={repo:target.repo,snapshotRoot:'/approved/snapshots',gitExecutable:'/usr/bin/git',testCommand:'owner-tests',
    executor:{dockerExecutable:'/usr/bin/docker',endpoint:'unix:///var/run/docker.sock',imageId:'sha256:'+'d'.repeat(64),program:'/bin/sh',
      workspaceRoot:'/approved',ownerRoot:'/owner',authorize:async()=>true},resolveLease:async()=>lease,
    credentialForRepo:async()=>{credentials++;return 'synthetic-only';}};
  const verifier=async(owner:any)=>{verifiers++;received=owner;return {verifyTarget:async()=>true};};
  return {binding,target,state,store,lease,policy,verifier,cancel:()=>{cancelled=true;},counts:()=>({credentials,verifiers}),received:()=>received};
}
test('catalog binds owner lease and durable intent without credentials or worker-selected tests',async()=>{
  const f=fixture(),entry=await verifiedPushCatalog(f.policy,f.verifier)(f.store,f.binding);
  expect(entry?.target).toEqual(f.target);expect(entry?.source).toBe(f.lease.workspace);
  expect(f.received().testCommand).toBe('owner-tests');expect(f.counts()).toEqual({credentials:0,verifiers:1});
  f.lease.workspace='/changed-after-resolution';expect(entry?.source).toBe('/approved/task');
  await expect(entry!.credentialForRepo('foreign/repo')).rejects.toThrow('OWNER_PUSH_REPO_DENIED');expect(f.counts().credentials).toBe(0);
});
test('missing lease returns no candidate and does not invent runtime lineage',async()=>{
  const f=fixture();
  expect(await verifiedPushCatalog({...f.policy,resolveLease:async()=>undefined},f.verifier)(f.store,f.binding)).toBeUndefined();
  expect(f.counts()).toEqual({credentials:0,verifiers:0});
});
test('wrong plan/requester/execution, nonzero exit or unknown cleanup cannot prepare a push',async()=>{
  for(const mutation of ['plan','requester','execution','exit','cleanup','cancel','repo'] as const){
    const f=fixture();
    if(mutation==='plan')f.lease.planVersion=2;if(mutation==='requester')f.lease.requesterId='534692447561842698';
    if(mutation==='execution')f.lease.receipt.executionId='foreign';if(mutation==='exit')f.lease.receipt.exitCode=1;
    if(mutation==='cleanup')f.lease.receipt.cleanupConfirmed=false;if(mutation==='cancel')f.cancel();if(mutation==='repo')f.state.pushIntents['push-1'].target.repo='foreign/repo';
    await expect(verifiedPushCatalog(f.policy,f.verifier)(f.store,f.binding)).rejects.toThrow();
    expect(f.counts()).toEqual({credentials:0,verifiers:0});
  }
});
test('start or deny callback never consults owner task resolution',async()=>{
  const f=fixture();let resolutions=0;
  const catalog=verifiedPushCatalog({...f.policy,resolveLease:async()=>{resolutions++;return f.lease;}},f.verifier);
  expect(await catalog(f.store,{...f.binding,decision:'deny'})).toBeUndefined();
  expect(await catalog(f.store,{...f.binding,request:{...f.binding.request,action:'start'}})).toBeUndefined();expect(resolutions).toBe(0);
});
test('code-only native owner factory composes catalog while preserving missing-lease denial',async()=>{
  const f=fixture();
  const prepared=await verifiedPushOwner(f.policy,f.verifier)(f.store,f.binding);
  expect(prepared?.operationId).toBe(f.lease.executionId+':push:push-1');expect(f.counts().credentials).toBe(0);
  expect(await verifiedPushOwner({...f.policy,resolveLease:async()=>undefined},f.verifier)(f.store,f.binding)).toBeUndefined();
});
