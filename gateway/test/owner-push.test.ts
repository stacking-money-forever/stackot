/** Code composer with real local Git sealing, synthetic intent/verifier: S. */
import {test,expect} from "bun:test";
import {mkdtemp,mkdir,writeFile,readdir,realpath,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ownerPushFactory,type PreparedOwnerPush} from "../src/owner-push.ts";
import type {CallbackBinding} from "../src/callback.ts";
import type {State,StateStore} from "../src/state/flow-store.ts";

async function fixture(){
  const root=await realpath(await mkdtemp(join(tmpdir(),'stackot-catalog-'))),source=join(root,'worker'),ownerRoot=join(root,'owner');
  await mkdir(ownerRoot,{mode:0o700});const gitExecutable=Bun.which('git')!;
  const run=(args:string[])=>Bun.spawnSync([gitExecutable,...args],{env:{PATH:process.env.PATH!,HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},stdout:'pipe',stderr:'pipe'});
  for(const args of [['init',source],['-C',source,'config','user.name','Fixture'],['-C',source,'config','user.email','fixture@example.test']])expect(run(args).exitCode).toBe(0);
  await writeFile(join(source,'file'),'owned revision');expect(run(['-C',source,'add','file']).exitCode).toBe(0);expect(run(['-C',source,'commit','-m','fixture']).exitCode).toBe(0);
  const target={repo:'owner/repo',branch:'stackot/task-1',commitSha:run(['-C',source,'rev-parse','HEAD']).stdout.toString().trim()};
  const request={requestId:'push',taskId:'owner/repo#1',requesterId:'123456789012345678',planHash:'a'.repeat(64),planVersion:1,action:'push' as const,ttlMs:60000};
  const state:State={pushIntents:{push:{schemaVersion:1,request,target,phase:'prepared'}}};
  const store:StateStore={read:async()=>({revision:0,state:structuredClone(state)}),compareAndSwap:async()=>false};
  const binding={request} as CallbackBinding;let verifications=0,credentials=0;
  const entry:PreparedOwnerPush={operationId:'owned',target,source,ownerRoot,gitExecutable,verify:async()=>{verifications++;return true;},credentialForRepo:async()=>{credentials++;return 'synthetic';}};
  return {root,ownerRoot,entry,state,store,binding,target,counts:()=>({verifications,credentials})};
}
test('catalog target mismatch rejects before sealing or credentials',async()=>{
  const f=await fixture();try{
    await expect(ownerPushFactory(async()=>({...f.entry,target:{...f.target,branch:'other'}}))(f.store,f.binding)).rejects.toThrow('OWNER_PUSH_INTENT_CHANGED');
    expect(f.counts()).toEqual({verifications:0,credentials:0});expect(await readdir(f.ownerRoot)).toEqual([]);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('catalog pins target, shares concurrent seal, denies foreign credentials and cleans storage',async()=>{
  const f=await fixture();try{
    const prepared=(await ownerPushFactory(async()=>f.entry)(f.store,f.binding))!;
    const pinned={...f.target};f.entry.target.branch='changed-after-catalog';
    expect(await readdir(f.ownerRoot)).toEqual([]);
    expect(await Promise.all([prepared.broker.verifyRevision(pinned),prepared.broker.verifyRevision(pinned)])).toEqual([true,true]);
    expect(f.counts()).toEqual({verifications:1,credentials:0});expect((await readdir(f.ownerRoot)).filter(x=>x.startsWith('push-'))).toHaveLength(1);
    await expect(prepared.broker.credentialForRepo('foreign/repo')).rejects.toThrow('OWNER_PUSH_REPO_DENIED');
    await prepared.dispose!();await prepared.dispose!();expect(await readdir(f.ownerRoot)).toEqual([]);
    expect(prepared.broker.allows(pinned)).toBe(false);
    await expect(prepared.broker.credentialForRepo(pinned.repo)).rejects.toThrow('OWNER_PUSH_REPO_DENIED');
    expect(f.counts().credentials).toBe(0);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
