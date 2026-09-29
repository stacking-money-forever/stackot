import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,realpath,rm,readFile,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DockerWorker,type DockerCall,type DockerWorkerOwner} from '../src/docker-worker.ts';

const imageId='sha256:'+'a'.repeat(64),id='b'.repeat(64);
async function fixture(){
  const root=await realpath(await mkdtemp(join(tmpdir(),'stackot-docker-worker-'))),owner=join(root,'owner'),workspaces=join(root,'workspaces'),workspace=join(workspaces,'task');
  for(const path of [owner,workspaces,workspace])await mkdir(path,{mode:0o700});
  const calls:string[][]=[];let running=false,started=false,execution='',profileBad=false,ownershipBad=false,loseCreate=false,killUncertain=false,start:'exit'|'timeout'|'cancel'='exit',securityOpt='no-new-privileges';
  let config:any={},mounts:any[]=[];
  const call:DockerCall=async(args,options)=>{
    calls.push([...args]);
    if(args[0]==='image')return {code:0,stdout:JSON.stringify([{Id:imageId,Config:{Env:['PATH=/usr/bin:/bin']}}])};
    if(args[1]==='create'){
      execution=args[args.indexOf('--label')+1].split('=')[1];
      config={User:`${process.getuid!()}:${process.getgid!()}`,Entrypoint:['/bin/sh'],Labels:{'me.justn.stackot.execution':execution}};
      const source=args[args.indexOf('--mount')+1].split('src=')[1].split(',')[0];
      mounts=[{Type:'bind',Source:source,Destination:'/work',RW:true}];
      if(loseCreate)throw new Error('WORKER_DOCKER_TIMEOUT');
      return {code:0,stdout:id+'\n'};
    }
    if(args[1]==='inspect')return {code:0,stdout:JSON.stringify([{Id:id,Image:imageId,
      Config:{...config,Labels:{'me.justn.stackot.execution':ownershipBad?'foreign':execution}},
      HostConfig:{Privileged:false,ReadonlyRootfs:!profileBad,PidMode:'',IpcMode:'private',NetworkMode:'none',
        PidsLimit:256,CapDrop:['ALL'],SecurityOpt:[securityOpt]},Mounts:mounts,
      State:{Running:running,ExitCode:0,Status:running?'running':started?'exited':'created',StartedAt:started?'2026-09-29T00:00:01Z':'0001-01-01T00:00:00Z'}}])};
    if(args[1]==='start'){
      running=true;started=true;
      if(start==='timeout')throw new Error('WORKER_DOCKER_TIMEOUT');
      if(start==='cancel'){options.signal!.throwIfAborted();throw new Error('cancel fixture');}
      running=false;return {code:0,stdout:'fixture worker output\n'};
    }
    if(args[1]==='ls')return {code:0,stdout:id+'\n'};
    if(args[1]==='kill'){if(killUncertain)throw new Error('daemon unavailable');running=false;return {code:0,stdout:id};}
    if(args[1]==='rm')return {code:0,stdout:id};
    throw new Error('Unexpected Docker operation');
  };
  const configOwner:DockerWorkerOwner={dockerExecutable:'/usr/bin/docker',endpoint:'unix:///var/run/docker.sock',imageId,program:'/bin/sh',ownerRoot:owner,workspaceRoot:workspaces,authorize:async()=>true};
  return {root,owner,workspace,workspaces,calls,call,configOwner,set:(values:Record<string,unknown>)=>{
    if('profileBad' in values)profileBad=!!values.profileBad;if('ownershipBad' in values)ownershipBad=!!values.ownershipBad;
    if('loseCreate' in values)loseCreate=!!values.loseCreate;if('killUncertain' in values)killUncertain=!!values.killUncertain;
    if('start' in values)start=values.start as typeof start;
    if('securityOpt' in values)securityOpt=String(values.securityOpt);
  },request:{taskId:'owner/repo#7',workspace,arguments:['/work/fixture.sh'],timeoutMs:5000}};
}

test('approval denial performs no Docker action or workspace modification',async()=>{
  const f=await fixture();try{
    const executor=await DockerWorker.prepare({...f.configOwner,authorize:async()=>false},f.call);
    await expect(executor.run(f.request)).rejects.toThrow('WORKER_APPROVAL_REQUIRED');
    expect(f.calls).toHaveLength(0);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('fixed image, namespace, mount and auth boundaries precede start; private output and cleanup survive exit',async()=>{
  const f=await fixture();try{
    const executor=await DockerWorker.prepare(f.configOwner,f.call),receipt=await executor.run(f.request);
    expect(receipt.kind).toBe('exited');expect(receipt.cleanupConfirmed).toBe(true);expect(receipt.exitCode).toBe(0);
    expect(await readFile(receipt.outputPath!,'utf8')).toBe('fixture worker output\n');
    const create=f.calls.find(args=>args[1]==='create')!;
    for(const value of ['--pull=never','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--ipc=private','--cgroupns=private'])expect(create).toContain(value);
    expect(create[create.indexOf('--network')+1]).toBe('none');expect(create[create.indexOf('--entrypoint')+1]).toBe('/bin/sh');
    expect(create).toContain(imageId);expect(create.join(' ')).not.toContain('--privileged');expect(create.join(' ')).not.toContain('docker.sock');
    expect(f.calls.findIndex(x=>x[1]==='inspect')).toBeLessThan(f.calls.findIndex(x=>x[1]==='start'));
    expect(f.calls.find(x=>x[1]==='start')!.at(-1)).toBe(id);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('revoked grant before start leaves workspace dirty data and never executes the container',async()=>{
  const f=await fixture();try{
    await writeFile(join(f.workspace,'dirty'),'preserve');let checks=0;
    const executor=await DockerWorker.prepare({...f.configOwner,authorize:async()=>++checks<3},f.call);
    const receipt=await executor.run(f.request);
    expect(receipt.kind).toBe('failed');expect(receipt.cleanupConfirmed).toBe(true);
    expect(f.calls.some(x=>x[1]==='start')).toBe(false);expect(f.calls.some(x=>x[1]==='rm')).toBe(true);
    expect(await readFile(join(f.workspace,'dirty'),'utf8')).toBe('preserve');
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('runtime timeout stops the actual container and preserves task work',async()=>{
  const f=await fixture();try{
    f.set({start:'timeout'});await writeFile(join(f.workspace,'dirty'),'preserve');
    const receipt=await (await DockerWorker.prepare(f.configOwner,f.call)).run(f.request);
    expect(receipt.kind).toBe('timed-out');expect(receipt.cleanupConfirmed).toBe(true);
    expect(f.calls.some(x=>x[1]==='kill')).toBe(true);expect(f.calls.filter(x=>x[1]==='create')).toHaveLength(1);
    expect(await readFile(join(f.workspace,'dirty'),'utf8')).toBe('preserve');
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('ambiguous create acknowledgment discovers its exact owned ID without create/start retry',async()=>{
  const f=await fixture();try{
    f.set({loseCreate:true});
    const receipt=await (await DockerWorker.prepare(f.configOwner,f.call)).run(f.request);
    expect(receipt.cleanupConfirmed).toBe(true);expect(f.calls.filter(x=>x[1]==='create')).toHaveLength(1);
    expect(f.calls.some(x=>x[1]==='ls')).toBe(true);expect(f.calls.some(x=>x[1]==='start')).toBe(false);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('cancellation during execution kills the owned container and preserves existing data',async()=>{
  const f=await fixture();try{
    const controller=new AbortController();f.set({start:'timeout'});
    await writeFile(join(f.workspace,'dirty'),'preserve');
    const call:DockerCall=async(args,options)=>{
      try{return await f.call(args,options);}catch(error){if(args[1]==='start')controller.abort();throw error;}
    };
    const receipt=await (await DockerWorker.prepare(f.configOwner,call)).run({...f.request,signal:controller.signal});
    expect(receipt.kind).toBe('cancelled');expect(receipt.cleanupConfirmed).toBe(true);
    expect(f.calls.some(x=>x[1]==='kill')).toBe(true);expect(await readFile(join(f.workspace,'dirty'),'utf8')).toBe('preserve');
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('unconfirmed kill or foreign ownership remains uncertain and cannot remove a foreign container',async()=>{
  for(const mismatch of [false,true]){
    const f=await fixture();try{
      f.set({start:'timeout',killUncertain:!mismatch,ownershipBad:mismatch});
      const receipt=await (await DockerWorker.prepare(f.configOwner,f.call)).run(f.request);
      expect(receipt.kind).toBe('uncertain');expect(receipt.cleanupConfirmed).toBe(false);
      expect(f.calls.some(x=>x[1]==='rm')).toBe(false);
      if(mismatch)expect(f.calls.some(x=>x[1]==='kill')).toBe(false);
    }finally{await rm(f.root,{recursive:true,force:true});}
  }
});
test('writable rootfs inspection or owner-root/symlink mounts are denied before execution',async()=>{
  const f=await fixture();try{
    f.set({profileBad:true});const executor=await DockerWorker.prepare(f.configOwner,f.call);
    const receipt=await executor.run(f.request);expect(receipt.kind).toBe('failed');expect(f.calls.some(x=>x[1]==='start')).toBe(false);
    await expect(executor.run({...f.request,workspace:f.owner})).rejects.toThrow('WORKER_WORKSPACE_DENIED');
    const link=join(f.workspaces,'link');await symlink(f.owner,link);
    await expect(executor.run({...f.request,workspace:link})).rejects.toThrow('WORKER_PATH_INVALID');
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('created-state zero exit does not invent execution after a failed start RPC',async()=>{
  const f=await fixture();try{
    const call:DockerCall=async(args,options)=>args[1]==='start'?{code:1,stdout:''}:f.call(args,options);
    const receipt=await (await DockerWorker.prepare(f.configOwner,call)).run(f.request);
    expect(receipt.kind).toBe('failed');expect(receipt.cleanupConfirmed).toBe(true);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test('engine colon-form no-new-privileges is accepted and coding-home cannot cover owner credentials',async()=>{
  const f=await fixture();try{
    f.set({securityOpt:'no-new-privileges:true'});
    expect((await (await DockerWorker.prepare(f.configOwner,f.call)).run(f.request)).kind).toBe('exited');
    await expect(DockerWorker.prepare({...f.configOwner,codingHomeRoot:f.owner},f.call)).rejects.toThrow('WORKER_ROOTS_OVERLAP');
  }finally{await rm(f.root,{recursive:true,force:true});}
});
