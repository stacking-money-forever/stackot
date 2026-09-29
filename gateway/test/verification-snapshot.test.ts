import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,realpath,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verificationSnapshot} from '../src/verification-snapshot.ts';

test('owner snapshot supports linked worktree and exports only strict pinned objects without source hooks/config/files',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'stackot-verification-snapshot-')));
  const repository=join(root,'repository'),linked=join(root,'linked'),owner=join(root,'owner'),snapshots=join(root,'snapshots');
  const git=Bun.which('git')!,env={PATH:process.env.PATH!,HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
  const run=(args:string[])=>{const p=Bun.spawnSync([git,...args],{env,stdout:'pipe',stderr:'pipe'});expect(p.exitCode).toBe(0);return p.stdout.toString().trim();};
  await mkdir(owner,{mode:0o700});await mkdir(snapshots,{mode:0o700});
  try{
    run(['init',repository]);run(['-C',repository,'config','user.name','Fixture']);run(['-C',repository,'config','user.email','fixture@example.test']);
    await writeFile(join(repository,'.gitignore'),'ignored\n');await writeFile(join(repository,'code.ts'),'base\n');
    run(['-C',repository,'add','.']);run(['-C',repository,'commit','-m','base']);const baseSha=run(['-C',repository,'rev-parse','HEAD']);
    run(['-C',repository,'worktree','add','-b','stackot/test',linked]);
    await writeFile(join(linked,'code.ts'),'verified change\n');run(['-C',linked,'add','code.ts']);run(['-C',linked,'commit','-m','change']);
    await writeFile(join(linked,'ignored'),'must not be exported');
    const marker=join(root,'hook-ran');run(['-C',repository,'config','core.hooksPath',join(root,'evil-hooks')]);
    await mkdir(join(root,'evil-hooks'));await writeFile(join(root,'evil-hooks/post-checkout'),'#!/bin/sh\necho bad > "'+marker+'"\n',{mode:0o700});
    const target={repo:'owner/repo',branch:'stackot/test',commitSha:run(['-C',linked,'rev-parse','HEAD'])};
    const before=run(['-C',repository,'show-ref']);
    const snapshot=await verificationSnapshot({gitExecutable:git,commonGitDir:join(repository,'.git'),snapshotRoot:snapshots,ownerRoot:owner,baseSha,target});
    expect(await readFile(join(snapshot.workspace,'code.ts'),'utf8')).toBe('verified change\n');
    expect(await Bun.file(join(snapshot.workspace,'ignored')).exists()).toBe(false);
    expect(run(['-C',snapshot.workspace,'rev-parse','HEAD'])).toBe(target.commitSha);
    expect(run(['-C',snapshot.workspace,'status','--porcelain'])).toBe('');
    expect(run(['-C',snapshot.workspace,'diff','--name-only',baseSha])).toBe('code.ts');
    expect(await Bun.file(marker).exists()).toBe(false);expect(await snapshot.currentTarget()).toBe(true);
    expect(run(['-C',repository,'show-ref'])).toBe(before);
    await snapshot.dispose();expect(await readdir(snapshots)).toHaveLength(0);
    expect(await readFile(join(linked,'ignored'),'utf8')).toBe('must not be exported');
  }finally{await rm(root,{recursive:true,force:true});}
});
