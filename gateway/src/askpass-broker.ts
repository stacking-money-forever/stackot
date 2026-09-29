import {createServer} from 'node:http';
import {mkdtemp,chmod,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';

/** No credential file or TCP listener. Directory/socket permissions are not
 * same-UID confinement; worker must be unable to reach this host namespace. */
export async function askpassBroker(credential:string){
  if(!['darwin','linux'].includes(process.platform)||!credential.trim())throw new Error('OWNER_ASKPASS_INPUT_INVALID');
  // macOS sockaddr_un is short; owner deployment paths can exceed its bound.
  const root=await realpath(await mkdtemp('/tmp/stackot-askpass-'));
  await chmod(root,0o700);const socketPath=join(root,'broker.sock');
  let token=credential;
  const server=createServer({maxHeaderSize:2048,requestTimeout:5000,headersTimeout:5000},(request,response)=>{
    if(request.method!=='GET'||request.url!=='/credential'){
      response.writeHead(404);response.end();return;
    }
    response.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});response.end(token);
  });
  try{
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.removeListener('error',reject);resolve();});});
    await chmod(socketPath,0o600);
  }catch{
    token='';server.close();await rm(root,{recursive:true,force:true});throw new Error('OWNER_ASKPASS_START_FAILED');
  }
  return {socketPath,root,close:async()=>{
    token='';server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(error=>error&&
      (error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(new Error('OWNER_ASKPASS_CLOSE_FAILED')):resolve()));
    await rm(root,{recursive:true,force:true});
  }};
}
