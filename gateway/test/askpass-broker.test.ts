import {test,expect} from 'bun:test';
import {stat,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {askpassBroker} from '../src/askpass-broker.ts';

async function request(socket:string,path='/credential'){
  const child=Bun.spawn(['/usr/bin/curl','--disable','--silent','--fail','--max-time','2','--noproxy','*','--unix-socket',socket,'http://localhost'+path],
    {env:{PATH:'/usr/bin:/bin'},stdout:'pipe',stderr:'pipe'});
  const [code,text]=await Promise.all([child.exited,new Response(child.stdout).text()]);return {code,text};
}
test('approved token lives only in broker memory; private Unix endpoint closes and returns no other route',async()=>{
  const token='synthetic-memory-only-token',broker=await askpassBroker(token);
  try{
    expect((await stat(broker.root)).mode&0o777).toBe(0o700);expect((await stat(broker.socketPath)).mode&0o777).toBe(0o600);
    expect((await stat(broker.socketPath)).isSocket()).toBe(true);
    expect(await readdir(broker.root)).toEqual(['broker.sock']);
    expect(await request(broker.socketPath)).toEqual({code:0,text:token});
    expect((await request(broker.socketPath,'/foreign')).code).not.toBe(0);
  }finally{await broker.close();}
  expect((await request(broker.socketPath)).code).not.toBe(0);
});
test('SIGKILL of broker owner leaves no regular credential file and a dead endpoint fails boundedly',async()=>{
  const module=new URL('../src/askpass-broker.ts',import.meta.url).href;
  const code=`import {askpassBroker} from ${JSON.stringify(module)}; const broker=await askpassBroker(await Bun.stdin.text()); console.log(JSON.stringify({root:broker.root,socketPath:broker.socketPath}));`;
  const child=Bun.spawn([Bun.which('bun')!,'--eval',code],{env:{PATH:'/usr/bin:/bin'},stdin:new TextEncoder().encode('synthetic-crash-token'),stdout:'pipe',stderr:'pipe'});
  const reader=child.stdout.getReader();let text='',metadata:{root:string;socketPath:string}|undefined;
  try{
    while(!text.includes('\n')){const chunk=await reader.read();if(chunk.done)throw new Error('Broker fixture did not start');text+=new TextDecoder().decode(chunk.value);}
    metadata=JSON.parse(text.split('\n')[0]);
    expect((await request(metadata!.socketPath)).text).toBe('synthetic-crash-token');
    child.kill('SIGKILL');await child.exited;
    const names=await readdir(metadata!.root);
    for(const name of names)expect((await stat(join(metadata!.root,name))).isFile()).toBe(false);
    const start=performance.now(),result=await request(metadata!.socketPath);
    expect(result.code).not.toBe(0);expect(performance.now()-start).toBeLessThan(3000);
  }finally{try{child.kill('SIGKILL');}catch{}await child.exited;reader.releaseLock();if(metadata)await rm(metadata.root,{recursive:true,force:true});}
},10000);
