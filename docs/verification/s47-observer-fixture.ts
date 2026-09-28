/** S only: actual local HTTP but synthetic provider reply, never S47 D proof. */
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'stackot-observer-'));
let requests=0;
const payload={ok:true,runId:'11111111-2222-4333-8444-555555555555'};
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
  requests++;
  if(req.headers.get('Idempotency-Key')!=='stackot-synthetic-s47')throw new Error('Header changed');
  return Response.json(payload);
}});
try{
  process.env.S47_NATIVE_HOOK_URL=`http://127.0.0.1:${server.port}/hooks/agent`;
  process.env.S47_ADMISSION_RECEIPT=join(root,'observed.jsonl');
  await import('./s47-network-observer.ts');
  const response=await fetch(process.env.S47_NATIVE_HOOK_URL,{method:'POST',headers:{'Idempotency-Key':'stackot-synthetic-s47'},body:'{}'});
  if(response.status!==200||JSON.stringify(await response.json())!==JSON.stringify(payload)||requests!==1)throw new Error('Response/request changed');
  const data=JSON.parse(readFileSync(process.env.S47_ADMISSION_RECEIPT,'utf8'));
  if(data.deliveryId!=='synthetic-s47'||data.runId!==payload.runId)throw new Error('Observer correlation wrong');
  console.log('S observer fixture: unchanged request/response, exactly one network request, correlated metadata only');
}finally{server.stop(true)}
