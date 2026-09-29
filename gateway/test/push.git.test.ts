/** Real local Git/remote fixture; synthetic approval/context/credential: S only. */
import {test,expect} from "bun:test";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PushAuthority} from "../src/push.ts";
import type {State,StateStore} from "../src/state/flow-store.ts";

test("pending push authority leaves a real bare Git remote unchanged with zero credential/transport calls",async()=>{
  const root=await mkdtemp(join(tmpdir(),"stackot-unapproved-push-"));const local=join(root,"local"),remote=join(root,"remote.git");
  const env={...process.env,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:"/dev/null",GIT_TERMINAL_PROMPT:"0"};
  const git=(args:string[])=>Bun.spawnSync(["git",...args],{env,stdout:"pipe",stderr:"pipe"});
  try{
    expect(git(["init",local]).exitCode).toBe(0);expect(git(["init","--bare",remote]).exitCode).toBe(0);
    expect(git(["-C",local,"config","user.name","Synthetic Fixture"]).exitCode).toBe(0);
    expect(git(["-C",local,"config","user.email","fixture@example.test"]).exitCode).toBe(0);
    await writeFile(join(local,"verified.txt"),"bounded fixture\n");
    expect(git(["-C",local,"add","verified.txt"]).exitCode).toBe(0);expect(git(["-C",local,"commit","-m","fixture"]).exitCode).toBe(0);
    const sha=git(["-C",local,"rev-parse","HEAD"]).stdout.toString().trim();const before=git(["--git-dir",remote,"show-ref"]).stdout.toString();
    const request={requestId:"push",taskId:"owner/repo#7",requesterId:"123456789012345678",planHash:"a".repeat(64),planVersion:1,action:"push" as const,ttlMs:1000};
    let state:State={schemaVersion:1,task:{id:request.taskId,requesterId:request.requesterId,planHash:request.planHash,planVersion:1,status:"waiting"}},revision=0;
    const store:StateStore={read:async()=>({revision,state:structuredClone(state)}),compareAndSwap:async(r,next)=>{if(r!==revision)return false;state=structuredClone(next);revision++;return true;}};
    let credentials=0,transports=0;
    const authority=new PushAuthority(store,{allows:()=>true,verifyRevision:async target=>git(["-C",local,"rev-parse","HEAD"]).stdout.toString().trim()===target.commitSha,
      credentialForRepo:async()=>{credentials++;return "synthetic-secret";},push:async target=>{transports++;const p=git(["-C",local,"push",remote,`${target.commitSha}:refs/heads/${target.branch}`]);if(p.exitCode!==0)throw new Error("Git push failed");return {remoteSha:target.commitSha};}},()=>100);
    await authority.prepare(request,{repo:"owner/repo",branch:"stackot/task-7",commitSha:sha});
    await expect(authority.execute({...request,actorId:request.requesterId},"operation-1")).rejects.toThrow("PUSH_APPROVAL_REQUIRED");
    expect(credentials).toBe(0);expect(transports).toBe(0);expect(git(["--git-dir",remote,"show-ref"]).stdout.toString()).toBe(before);
  }finally{await rm(root,{recursive:true,force:true});}
},20000);
