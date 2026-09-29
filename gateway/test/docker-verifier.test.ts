import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,realpath,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isolatedRevisionVerifier,type VerificationExecutor,type IsolatedVerifierOwner} from '../src/docker-verifier.ts';
import type {WorkerRequest} from '../src/docker-worker.ts';

async function fixture(){
  const root=await realpath(await mkdtemp(join(tmpdir(),'stackot-isolated-verifier-'))),owner=join(root,'owner'),workspaces=join(root,'workspaces'),workspace=join(workspaces,'task');
  for(const path of [owner,workspaces,workspace])await mkdir(path,{mode:0o700});
  const target={repo:'owner/repo',branch:'stackot/task',commitSha:'b'.repeat(40)};
  const calls:WorkerRequest[]=[];let head=target.commitSha,dirty=false,testsCode=0,changeAfterTests=false,uncertain=false;
  const executor:VerificationExecutor={run:async request=>{
    calls.push(request);const argv=request.arguments;let stdout='',code=0;
    if(argv.includes('/usr/bin/git')){
      if(argv.includes('--is-inside-work-tree'))stdout='true\n';
      else if(argv.includes('symbolic-ref'))stdout=target.branch+'\n';
      else if(argv.includes('rev-parse'))stdout=head+'\n';
      else if(argv.includes('status'))stdout=dirty?' M code.ts\n':'';
      else if(argv.includes('diff'))stdout='code.ts\n';
    }else{code=testsCode;stdout='independent test result\n';if(changeAfterTests)head='c'.repeat(40);}
    const directory=await mkdtemp(join(owner,'worker-output-')),path=join(directory,'stdout');
    await writeFile(path,stdout,{mode:0o600});
    return {executionId:'fixture',containerId:'d'.repeat(64),kind:'exited',exitCode:code,cleanupConfirmed:!uncertain,outputPath:path};
  }};
  const config:IsolatedVerifierOwner={executor:{dockerExecutable:'/usr/bin/docker',endpoint:'unix:///var/run/docker.sock',imageId:'sha256:'+'a'.repeat(64),
    program:'/bin/sh',workspaceRoot:workspaces,ownerRoot:owner,authorize:async()=>true},workspace,taskId:'owner/repo#7',baseSha:'a'.repeat(40),target,
    snapshotRoot:workspaces,commonGitDir:join(workspace,'.git'),gitExecutable:Bun.which('git')!,
    testCommand:'owner-selected-tests',claim:{filesChanged:['code.ts'],testsPassed:true,testCommand:'owner-selected-tests'}};
  return {root,config,target,calls,executor,snapshot:{workspace,currentTarget:async()=>true,dispose:async()=>{}},set:(state:{dirty?:boolean;testsCode?:number;changeAfterTests?:boolean;uncertain?:boolean})=>{
    if(state.dirty!==undefined)dirty=state.dirty;if(state.testsCode!==undefined)testsCode=state.testsCode;
    if(state.changeAfterTests!==undefined)changeAfterTests=state.changeAfterTests;if(state.uncertain!==undefined)uncertain=state.uncertain;
  }};
}
test('S32 Git observation and owner tests use only container execution with no coding account',async()=>{
  const f=await fixture();try{
    const verifier=await isolatedRevisionVerifier(f.config,f.executor,f.snapshot),report=await verifier.verify(f.target);
    expect(report.verdict).toBe('verified');expect(report.observed.changedFiles).toEqual(['code.ts']);
    expect(f.calls.length).toBeGreaterThan(6);
    for(const request of f.calls){expect(request.workspace).toBe(f.config.workspace);expect(request.codingHome).toBeUndefined();}
    const git=f.calls.find(request=>request.arguments.includes('/usr/bin/git'))!;
    expect(git.arguments).toContain('/work');expect(git.arguments).toContain('GIT_CONFIG_GLOBAL=/dev/null');
    expect(f.calls.some(request=>request.arguments.at(-1)===f.config.testCommand)).toBe(true);
    const command=f.calls.find(request=>request.arguments.at(-1)===f.config.testCommand)!;
    expect(command.arguments.some(value=>value.includes('clone --local --no-hardlinks --no-checkout'))).toBe(true);
    expect(command.arguments).toContain(f.target.commitSha);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('worker cannot select a weaker test or a different target',async()=>{
  const f=await fixture();try{
    const verifier=await isolatedRevisionVerifier({...f.config,claim:{...f.config.claim,testCommand:'exit 0'}},f.executor,f.snapshot);
    expect((await verifier.verify(f.target)).reasons).toContain('VERIFIER_TEST_COMMAND_CHANGED');expect(f.calls).toHaveLength(0);
    expect((await verifier.verify({...f.target,branch:'other'})).reasons).toContain('VERIFIER_TARGET_CHANGED');
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('failing owner tests reject a success claim; dirty or changed tested revision rejects',async()=>{
  for(const mode of ['fail','dirty','changed','uncertain'] as const){
    const f=await fixture();try{
      f.set(mode==='fail'?{testsCode:1}:mode==='dirty'?{dirty:true}:mode==='changed'?{changeAfterTests:true}:{uncertain:true});
      const verifier=await isolatedRevisionVerifier(f.config,f.executor,f.snapshot),report=await verifier.verify(f.target);
      expect(report.verdict).toBe('rejected');
      if(mode==='changed')expect(report.reasons).toContain('VERIFIER_POST_TEST_REVISION_OR_WORKTREE_CHANGED');
      if(mode==='dirty'||mode==='uncertain')expect(f.calls.some(request=>request.arguments.at(-1)===f.config.testCommand)).toBe(false);
    }finally{await rm(f.root,{recursive:true,force:true});}
  }
});
