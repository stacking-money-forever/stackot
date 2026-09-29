/** Actual Git sealing/push/readback with local remotes; synthetic authority, S. */
import {test,expect} from "bun:test";
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {OwnerGitPush} from "../src/git-push.ts";

async function fixture(){
  const root=await realpath(await mkdtemp(join(tmpdir(),'stackot-owner-git-')));const worker=join(root,'worker'),owner=join(root,'owner');
  await mkdir(owner,{mode:0o700});const remote=join(owner,'remote.git'),evil=join(owner,'evil.git');
  const git=Bun.which('git')!;const env={PATH:process.env.PATH!,HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
  const run=(args:string[])=>Bun.spawnSync([git,...args],{env,stdout:'pipe',stderr:'pipe'});
  for(const args of [['init',worker],['init','--bare',remote],['init','--bare',evil],['-C',worker,'config','user.name','Fixture'],['-C',worker,'config','user.email','fixture@example.test']])expect(run(args).exitCode).toBe(0);
  await writeFile(join(worker,'file.txt'),'verified before approval\n');expect(run(['-C',worker,'add','file.txt']).exitCode).toBe(0);expect(run(['-C',worker,'commit','-m','verified']).exitCode).toBe(0);
  const sha=run(['-C',worker,'rev-parse','HEAD']).stdout.toString().trim();
  return {root,worker,owner,remote,evil,git,run,target:{repo:'owner/repo',branch:'stackot/task-7',commitSha:sha}};
}
test('owner push uses sealed objects and ignores worker URL rewrites, hooks and later commits',async()=>{
  const f=await fixture();try{
    const transport=await OwnerGitPush.seal({source:f.worker,ownerRoot:f.owner,target:f.target,gitExecutable:f.git,verify:async()=>true,fixtureRemote:f.remote});
    const marker=join(f.root,'hook-ran');await writeFile(join(f.worker,'.git/hooks/pre-push'),'#!/bin/sh\necho ran > "'+marker+'"\n',{mode:0o700});
    expect(f.run(['-C',f.worker,'config',`url.${f.evil}.insteadOf`,f.remote]).exitCode).toBe(0);
    await writeFile(join(f.worker,'file.txt'),'changed after verification\n');expect(f.run(['-C',f.worker,'add','file.txt']).exitCode).toBe(0);expect(f.run(['-C',f.worker,'commit','-m','later']).exitCode).toBe(0);
    expect(await transport.verifyRevision(f.target)).toBe(true);
    expect(await transport.push(f.target,'synthetic-owner-token')).toEqual({remoteSha:f.target.commitSha});
    expect(f.run(['--git-dir',f.remote,'rev-parse','refs/heads/'+f.target.branch]).stdout.toString().trim()).toBe(f.target.commitSha);
    expect(f.run(['--git-dir',f.evil,'show-ref']).stdout.toString()).toBe('');
    expect(await Bun.file(marker).exists()).toBe(false);
    for(const dir of await readdir(f.owner)){
      if(!dir.startsWith('push-'))continue;
      const helper=await readFile(join(f.owner,dir,'askpass'),'utf8');expect(helper).not.toContain('synthetic-owner-token');
    }
  }finally{await rm(f.root,{recursive:true,force:true});}
},30000);
test('unverified revision, wrong target or protected branch cannot use owner transport',async()=>{
  const f=await fixture();try{
    await expect(OwnerGitPush.seal({source:f.worker,ownerRoot:f.owner,target:f.target,gitExecutable:f.git,verify:async()=>false,fixtureRemote:f.remote})).rejects.toThrow('OWNER_REVISION_UNVERIFIED');
    await expect(OwnerGitPush.seal({source:f.worker,ownerRoot:f.owner,target:{...f.target,branch:'main'},gitExecutable:f.git,verify:async()=>true,fixtureRemote:f.remote})).rejects.toThrow();
    const transport=await OwnerGitPush.seal({source:f.worker,ownerRoot:f.owner,target:f.target,gitExecutable:f.git,verify:async()=>true,fixtureRemote:f.remote});
    await expect(transport.push({...f.target,branch:'other'},'synthetic-owner-token')).rejects.toThrow('OWNER_GIT_AUTHORITY_DENIED');
    expect(f.run(['--git-dir',f.remote,'show-ref']).stdout.toString()).toBe('');
  }finally{await rm(f.root,{recursive:true,force:true});}
},30000);
