/** Actual Git sealing/push/readback with local remotes; synthetic authority, S. */
import {test,expect} from "bun:test";
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,readdir,open,chmod} from "node:fs/promises";
import {randomFillSync} from "node:crypto";
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
    await transport.dispose();expect((await readdir(f.owner)).filter(x=>x.startsWith('push-'))).toHaveLength(0);
    expect(await transport.verifyRevision(f.target)).toBe(false);
  }finally{await rm(f.root,{recursive:true,force:true});}
},30000);
test('Git auth keeps credential bytes out of child argv/env and removes private files on success or failure',async()=>{
  for(const {fail,cleanupFailure} of [{fail:false,cleanupFailure:false},{fail:true,cleanupFailure:false},{fail:false,cleanupFailure:true}]){
    const f=await fixture(),warnings:string[]=[],originalWarn=console.warn;
    console.warn=(...args)=>{warnings.push(args.map(String).join(' '));};try{
      const trace=join(f.root,'auth-trace.jsonl'),wrapper=join(f.root,'git-wrapper');
      const token='synthetic-env-hidden-owner-token';
      await writeFile(wrapper,`#!${Bun.which('bun')}\n`+`
import {appendFileSync,statSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
const args=process.argv.slice(2),token=${JSON.stringify(token)};
if(args.includes('push')||args.includes('ls-remote')){
  const file=process.env.STACKOT_OWNER_PUSH_TOKEN_FILE;
  const password=Bun.spawnSync([process.env.GIT_ASKPASS,'Password'],{env:process.env,stdout:'pipe',stderr:'pipe'});
  const username=Bun.spawnSync([process.env.GIT_ASKPASS,'Username'],{env:process.env,stdout:'pipe',stderr:'pipe'});
  appendFileSync(${JSON.stringify(trace)},JSON.stringify({
    envContainsCredential:Object.values(process.env).some(value=>value?.includes(token)),
    argvContainsCredential:args.some(value=>value.includes(token)),
    privateFile:file!==undefined&&(statSync(file).mode&0o777)===0o600,
    passwordCorrect:password.exitCode===0&&password.stdout.toString()===token,
    usernameCorrect:username.exitCode===0&&username.stdout.toString()==='x-access-token\\n',
    command:args.includes('push')?'push':'ls-remote'
  })+'\\n');
  if(${fail}&&args.includes('push'))process.exit(1);
  if(${cleanupFailure}&&args.includes('ls-remote'))chmodSync(dirname(file),0o500);
}
const input=new Uint8Array(await Bun.stdin.arrayBuffer());
const child=Bun.spawnSync([${JSON.stringify(f.git)},...args],{env:process.env,stdin:input,stdout:'pipe',stderr:'pipe'});
process.stdout.write(child.stdout);process.stderr.write(child.stderr);process.exit(child.exitCode);
`,{mode:0o700});
      const transport=await OwnerGitPush.seal({source:f.worker,ownerRoot:f.owner,target:f.target,gitExecutable:wrapper,verify:async()=>true,fixtureRemote:f.remote});
      try{
        if(fail)await expect(transport.push(f.target,token)).rejects.toThrow('OWNER_GIT_OPERATION_FAILED');
        else expect(await transport.push(f.target,token)).toEqual({remoteSha:f.target.commitSha});
        const rows=(await readFile(trace,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
        expect(rows).toHaveLength(fail?1:2);
        for(const row of rows){
          expect(row.envContainsCredential).toBe(false);expect(row.argvContainsCredential).toBe(false);
          expect(row.privateFile).toBe(true);expect(row.passwordCorrect).toBe(true);expect(row.usernameCorrect).toBe(true);
        }
        for(const dir of (await readdir(f.owner)).filter(name=>name.startsWith('push-'))){
          const roots=(await readdir(join(f.owner,dir))).filter(name=>name.startsWith('auth-'));
          if(cleanupFailure){
            expect(roots).toHaveLength(1);
            const authRoot=join(f.owner,dir,roots[0]);
            expect(await readFile(join(authRoot,'credential'),'utf8')).toBe('');
            await chmod(authRoot,0o700);
          }else expect(roots).toHaveLength(0);
        }
        if(cleanupFailure){
          expect(warnings).toEqual(['stackot.owner_push.auth_cleanup_failed']);
          expect(transport.allows(f.target)).toBe(false);
        }else expect(warnings).toHaveLength(0);
      }finally{
        // Restore fixture permissions even when a mutation oracle fails, so
        // teardown does not mask the assertion that detected retained bytes.
        for(const dir of (await readdir(f.owner)).filter(name=>name.startsWith('push-')))
          for(const auth of (await readdir(join(f.owner,dir))).filter(name=>name.startsWith('auth-')))
            await chmod(join(f.owner,dir,auth),0o700);
        await transport.dispose();
      }
    }finally{console.warn=originalWarn;await rm(f.root,{recursive:true,force:true});}
  }
},30000);

test('unverified revision, wrong target or protected branch cannot use owner transport',async()=>{
  const f=await fixture();try{
    await expect(OwnerGitPush.seal({source:f.worker,ownerRoot:f.owner,target:f.target,gitExecutable:f.git,verify:async()=>false,fixtureRemote:f.remote})).rejects.toThrow('OWNER_REVISION_UNVERIFIED');
    await expect(OwnerGitPush.seal({source:f.worker,ownerRoot:f.owner,target:{...f.target,branch:'main'},gitExecutable:f.git,verify:async()=>true,fixtureRemote:f.remote})).rejects.toThrow();
    const transport=await OwnerGitPush.seal({source:f.worker,ownerRoot:f.owner,target:f.target,gitExecutable:f.git,verify:async()=>true,fixtureRemote:f.remote});
    await expect(transport.push({...f.target,branch:'other'},'synthetic-owner-token')).rejects.toThrow('OWNER_GIT_AUTHORITY_DENIED');
    expect(f.run(['--git-dir',f.remote,'show-ref']).stdout.toString()).toBe('');
    await transport.dispose();await transport.dispose();
  }finally{await rm(f.root,{recursive:true,force:true});}
},30000);

test('failed sealing removes only generated owner storage',async()=>{
  const f=await fixture();try{
    await expect(OwnerGitPush.seal({source:f.worker,ownerRoot:f.owner,target:{...f.target,commitSha:'f'.repeat(40)},gitExecutable:f.git,verify:async()=>true,fixtureRemote:f.remote})).rejects.toThrow();
    expect((await readdir(f.owner)).filter(x=>x.startsWith('push-'))).toHaveLength(0);
    expect(await Bun.file(join(f.worker,'file.txt')).exists()).toBe(true);
    expect(f.run(['--git-dir',f.remote,'show-ref']).stdout.toString()).toBe('');
  }finally{await rm(f.root,{recursive:true,force:true});}
},30000);

test('object packs exceeding the former 128MiB limit are streamed and sealed',async()=>{
  const f=await fixture();try{
    const file=await open(join(f.worker,'large.bin'),'w');const chunk=Buffer.alloc(4*1024*1024);
    try{for(let n=0;n<33;n++){randomFillSync(chunk);await file.write(chunk);}}finally{await file.close();}
    expect(f.run(['-C',f.worker,'add','large.bin']).exitCode).toBe(0);
    expect(f.run(['-C',f.worker,'commit','-m','large streamed fixture']).exitCode).toBe(0);
    const target={...f.target,commitSha:f.run(['-C',f.worker,'rev-parse','HEAD']).stdout.toString().trim()};
    const transport=await OwnerGitPush.seal({source:f.worker,ownerRoot:f.owner,target,gitExecutable:f.git,verify:async()=>true,fixtureRemote:f.remote});
    expect(await transport.verifyRevision(target)).toBe(true);await transport.dispose();
    expect((await readdir(f.owner)).filter(x=>x.startsWith('push-'))).toHaveLength(0);
  }finally{await rm(f.root,{recursive:true,force:true});}
},60000);
