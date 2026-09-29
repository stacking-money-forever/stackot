import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname} from 'node:path';
import {verifyWorkerClaim,type WorkerClaim,type VerifierReport,type CommandRunner} from '../../receiver/src/verifier.ts';
import {DockerWorker,type DockerWorkerOwner,type WorkerRequest,type WorkerReceipt} from './docker-worker.ts';
import type {PushTarget} from './push.ts';
import {verificationSnapshot,type VerificationSnapshot} from './verification-snapshot.ts';

export type IsolatedVerifierOwner={executor:DockerWorkerOwner;workspace:string;taskId:string;baseSha:string;
  snapshotRoot:string;commonGitDir:string;gitExecutable:string;
  target:PushTarget;testCommand:string;claim:WorkerClaim;timeoutMs?:number;signal?:AbortSignal};
/** Test seam is owner code only, never an RPC/worker-supplied transport. */
export type VerificationExecutor={run:(request:WorkerRequest)=>Promise<WorkerReceipt>};
const same=(a:PushTarget,b:PushTarget)=>a.repo===b.repo&&a.branch===b.branch&&a.commitSha===b.commitSha;
const CHECKOUT_TEST=`set -eu
g() { /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c status.showUntrackedFiles=all "$@"; }
g clone --local --no-hardlinks --no-checkout --template= /work /tmp/stackot-owner-checkout >/dev/null 2>&1
g -C /tmp/stackot-owner-checkout checkout -B "$2" "$1" >/dev/null 2>&1
cd /tmp/stackot-owner-checkout
set +e
/bin/sh -c "$3"
result=$?
set -e
test "$(g rev-parse HEAD)" = "$1" || exit 125
test -z "$(g status --porcelain)" || exit 125
exit "$result"`;

export async function isolatedRevisionVerifier(owner:IsolatedVerifierOwner,testExecutor?:VerificationExecutor,testSnapshot?:VerificationSnapshot){
  if(!/^[0-9a-f]{40}$/.test(owner.baseSha)||!/^[0-9a-f]{40}$/.test(owner.target.commitSha)||!owner.testCommand.trim())
    throw new Error('VERIFIER_OWNER_POLICY_INVALID');
  const policy={...owner,executor:{...owner.executor},target:{...owner.target},
    claim:{...owner.claim,filesChanged:owner.claim.filesChanged?[...owner.claim.filesChanged]:undefined}};
  // Repository verification receives no coding account and cannot inherit the
  // model egress bridge. Tests and Git config/hooks remain inside the container.
  const executor=testExecutor??await DockerWorker.prepare({...policy.executor,workspaceRoot:policy.snapshotRoot,program:'/bin/sh',
    codingHomeRoot:undefined,egressNetworkId:undefined,
    authorize:request=>policy.executor.authorize({...request,workspace:policy.workspace})});
  const root=await realpath(policy.executor.ownerRoot);
  const runner=(workspace:string):CommandRunner=>async(argv,options)=>{
    let command:string[];
    if(argv[0]==='git'&&argv[1]==='-C'&&argv[2]===workspace){
      command=['/usr/bin/env','GIT_CONFIG_NOSYSTEM=1','GIT_CONFIG_SYSTEM=/dev/null','GIT_CONFIG_GLOBAL=/dev/null',
        'GIT_NO_REPLACE_OBJECTS=1','GIT_TERMINAL_PROMPT=0','/usr/bin/git','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',
        '-c','status.showUntrackedFiles=all',
        '-C','/work',...argv.slice(3)];
    }else if(argv.length===3&&argv[0]==='sh'&&argv[1]==='-c'&&argv[2]===policy.testCommand&&options.cwd===workspace)
      command=['/usr/bin/env','GIT_CONFIG_NOSYSTEM=1','GIT_CONFIG_SYSTEM=/dev/null','GIT_CONFIG_GLOBAL=/dev/null',
        'GIT_NO_REPLACE_OBJECTS=1','GIT_TERMINAL_PROMPT=0','/bin/sh','-c',CHECKOUT_TEST,
        'stackot-owner-checkout',policy.target.commitSha,policy.target.branch,policy.testCommand];
    else return {code:126,stdout:'',stderr:'VERIFIER_COMMAND_DENIED'};
    try{
      const receipt=await executor.run({taskId:policy.taskId,workspace,
        arguments:['-c','exec "$@"','stackot-owner-verifier',...command],timeoutMs:options.timeoutMs,signal:policy.signal});
      if(receipt.kind==='timed-out')return {code:124,stdout:'',stderr:'VERIFIER_TIMEOUT'};
      if(receipt.kind!=='exited'||!receipt.cleanupConfirmed||receipt.exitCode===undefined||!receipt.outputPath)
        return {code:125,stdout:'',stderr:'VERIFIER_EXECUTION_UNCONFIRMED'};
      const relative=receipt.outputPath.slice(root.length+1);
      if(!receipt.outputPath.startsWith(root+'/')||!/^worker-output-[A-Za-z0-9_-]+\/stdout$/.test(relative))
        return {code:125,stdout:'',stderr:'VERIFIER_OUTPUT_DENIED'};
      if(await realpath(dirname(receipt.outputPath))!==dirname(receipt.outputPath))
        return {code:125,stdout:'',stderr:'VERIFIER_OUTPUT_DENIED'};
      const file=await open(join(root,relative),constants.O_RDONLY|constants.O_NOFOLLOW);
      try{
        const info=await file.stat();
        if(!info.isFile()||info.uid!==process.getuid?.()||(info.mode&0o077)||info.size>1024*1024)
          return {code:125,stdout:'',stderr:'VERIFIER_OUTPUT_DENIED'};
        const buffer=Buffer.alloc(1024*1024+1),read=await file.read(buffer,0,buffer.length,0);
        if(read.bytesRead>1024*1024)return {code:125,stdout:'',stderr:'VERIFIER_OUTPUT_DENIED'};
        return {code:receipt.exitCode,stdout:buffer.subarray(0,read.bytesRead).toString(),stderr:''};
      }finally{await file.close();}
    }catch{return {code:125,stdout:'',stderr:'VERIFIER_EXECUTION_UNCONFIRMED'};}
  };
  const reject=(reason:string):VerifierReport=>({verdict:'rejected',reasons:[reason],observed:{changedFiles:[],testsPassed:null,testOutputTail:null}});
  async function verify(candidate:PushTarget):Promise<VerifierReport>{
    if(!same(candidate,policy.target))return reject('VERIFIER_TARGET_CHANGED');
    if(policy.claim.testCommand!==undefined&&policy.claim.testCommand!==policy.testCommand)return reject('VERIFIER_TEST_COMMAND_CHANGED');
    let snapshot:VerificationSnapshot|undefined,report:VerifierReport;
    try{
      snapshot=testSnapshot??await verificationSnapshot({gitExecutable:policy.gitExecutable,commonGitDir:policy.commonGitDir,
        snapshotRoot:policy.snapshotRoot,ownerRoot:policy.executor.ownerRoot,baseSha:policy.baseSha,target:policy.target});
      const run=runner(snapshot.workspace);
      const git=async(args:string[])=>run(['git','-C',snapshot!.workspace,...args],{cwd:'.',timeoutMs:30000});
      const identity=async()=>{
        const [head,branch,status]=await Promise.all([git(['rev-parse','HEAD']),git(['symbolic-ref','--short','HEAD']),git(['status','--porcelain'])]);
        return head.code===0&&head.stdout.trim()===policy.target.commitSha&&branch.code===0&&branch.stdout.trim()===policy.target.branch&&status.code===0&&status.stdout.trim()===''&&await snapshot!.currentTarget();
      };
      if(!await identity())report=reject('VERIFIER_REVISION_OR_WORKTREE_CHANGED');
      else{
        report=await verifyWorkerClaim({worktreePath:snapshot.workspace,baseRef:policy.baseSha,
          claim:{...policy.claim,testCommand:policy.testCommand},run,timeoutMs:policy.timeoutMs??120000});
        if(report.verdict==='verified'&&!await identity())report={...report,verdict:'rejected',reasons:['VERIFIER_POST_TEST_REVISION_OR_WORKTREE_CHANGED']};
      }
    }catch{report=reject('VERIFIER_SNAPSHOT_OR_EXECUTION_UNCONFIRMED');}
    try{await snapshot?.dispose();}catch{return reject('VERIFIER_SNAPSHOT_CLEANUP_UNCONFIRMED');}
    return report;
  }
  return {verify,verifyTarget:async(candidate:PushTarget)=>(await verify(candidate)).verdict==='verified'};
}
