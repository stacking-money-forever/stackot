/** B08 Linux regression: real receiver/SQLite; explicit fake Gateway (S only). */
import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtemp,writeFile,rename,unlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

async function wait(check:()=>boolean|Promise<boolean>) {
  const end=Date.now()+10000;
  while(Date.now()<end){if(await check())return;await Bun.sleep(50);}
  throw new Error('B08 observable condition timed out');
}

test('current credential reloads per retry; missing source never falls back; credential-echoing responses stay out of errors',async()=>{
  const old='b08-synthetic-old-value',current='b08-synthetic-new-value',secret='b08-synthetic-hmac';
  let accepted=old,reject=false;
  const calls:{key:string;auth:string}[]=[];
  const gateway=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
    await req.text();const auth=req.headers.get('Authorization')??'';
    calls.push({key:req.headers.get('Idempotency-Key')??'',auth});
    if(auth!==`Bearer ${accepted}`||reject)return new Response(`${old} ${current} ${auth}`,{status:401});
    return new Response('accepted');
  }});
  const dir=await mkdtemp(join(tmpdir(),'stackot-b08-process-'));
  const config=join(dir,'receiver.json'),credential=join(dir,'hook.json'),dbPath=join(dir,'outbox.sqlite');
  const reserve=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('reserved')});
  const port=reserve.port;reserve.stop(true);
  let proc:Bun.Subprocess|undefined,db:Database|undefined;let output='';
  const readers:Promise<void>[]=[];
  const replace=async(token:string)=>{
    await writeFile(credential+'.next',JSON.stringify({version:1,token}),{mode:0o600});
    await rename(credential+'.next',credential);
  };
  const row=(id:string)=>db!.query('SELECT state,attempts,last_error FROM outbox WHERE id=?').get(id) as {state:string;attempts:number;last_error:string|null}|null;
  const post=async(id:string)=>{
    const body=JSON.stringify({action:'opened',repository:{full_name:'owner/repo'},issue:{number:1,title:'controlled',html_url:'https://example.test/1'}});
    const mac=new Bun.CryptoHasher('sha256',secret);mac.update(body);
    const response=await fetch(`http://127.0.0.1:${port}/webhook`,{method:'POST',body,headers:{'X-Hub-Signature-256':`sha256=${mac.digest('hex')}`,'X-GitHub-Delivery':id,'X-GitHub-Event':'issues'}});
    expect(response.status).toBe(200);expect(await response.text()).toBe('accepted');expect(row(id)).toBeTruthy();
  };
  try{
    await replace(old);
    await writeFile(config,JSON.stringify({host:'127.0.0.1',port,githubWebhookSecret:secret,openclawHooksUrl:`http://127.0.0.1:${gateway.port}/hooks`,openclawHookToken:old,openclawHookTokenFile:credential,githubToken:'synthetic-gh',repos:{'owner/repo':{issuesForumChannelId:'1',prsForumChannelId:'2'}},ciAlertsChannelId:'3',adminChannelId:'4',agentId:'stackot',discordGuildId:'111',githubBacklinkLogin:'stackot-bot'}));
    proc=Bun.spawn([process.execPath,'src/server.ts'],{cwd:join(import.meta.dir,'..'),env:{...process.env,STACKOT_CONFIG:config,STACKOT_OUTBOX_PATH:dbPath},stdout:'pipe',stderr:'pipe'});
    for(const stream of [proc.stdout,proc.stderr])readers.push((async()=>{const decoder=new TextDecoder();for await(const chunk of stream as ReadableStream<Uint8Array>)output+=decoder.decode(chunk,{stream:true});})());
    await wait(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/readyz`)).ok;}catch{return false;}});
    db=new Database(dbPath);db.run('PRAGMA busy_timeout=5000');const pid=proc.pid;
    accepted=current;
    await post('rotation');await wait(()=>!!row('rotation')?.attempts);
    expect(row('rotation')?.state).toBe('pending');
    expect(calls.find(x=>x.key==='stackot-rotation')?.auth).toBe(`Bearer ${old}`);
    await replace(current);await wait(()=>row('rotation')?.state==='delivered');
    expect(calls.filter(x=>x.key==='stackot-rotation').at(-1)?.auth).toBe(`Bearer ${current}`);
    await unlink(credential);
    const count=calls.length;await post('missing');await wait(()=>!!row('missing')?.attempts);
    expect(row('missing')?.state).toBe('pending');expect(calls.length).toBe(count);
    await replace(current);await wait(()=>row('missing')?.state==='delivered');
    reject=true;await post('mask');await wait(()=>!!row('mask')?.attempts);
    db.run("UPDATE outbox SET attempts=4,next_attempt_at=0 WHERE id='mask' AND state='pending'");
    await wait(()=>row('mask')?.state==='dead_letter');
    const error=row('mask')?.last_error;expect(error).toContain('status 401');
    expect(error).not.toContain(old);expect(error).not.toContain(current);
    expect(proc.pid).toBe(pid);expect(proc.exitCode).toBeNull();
    proc.kill();await proc.exited;await Promise.all(readers);
    expect(output).toContain('status 401');expect(output).not.toContain(old);expect(output).not.toContain(current);
  }finally{
    if(proc&&proc.exitCode===null){proc.kill();await proc.exited;}
    await Promise.all(readers);db?.close();gateway.stop(true);await rm(dir,{recursive:true,force:true});
  }
},35000);
