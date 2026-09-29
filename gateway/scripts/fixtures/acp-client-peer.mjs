/** Synthetic ACP peer. Every path is a disposable owner-created fixture path. */
import {createInterface} from 'node:readline';
const [canary,sentinel,cwd]=process.argv.slice(2);
if(!canary||!sentinel||!cwd)throw Error('Fixture arguments required');
const pending=new Map();let next=100,capabilities;
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const call=(method,params)=>new Promise(resolve=>{
  const id=next++;pending.set(id,resolve);send({jsonrpc:'2.0',id,method,params});
});
createInterface({input:process.stdin}).on('line',async line=>{
  const message=JSON.parse(line);
  if(!message.method){const resolve=pending.get(message.id);if(resolve){pending.delete(message.id);resolve(message);}return;}
  const answer=result=>send({jsonrpc:'2.0',id:message.id,result});
  if(message.method==='initialize'){
    capabilities=message.params.clientCapabilities;
    answer({protocolVersion:1,agentCapabilities:{loadSession:true},authMethods:[]});
  }else if(message.method==='session/new'||message.method==='session/load')answer({sessionId:'fixture-session'});
  else if(message.method==='session/prompt'){
    const read=await call('fs/read_text_file',{sessionId:'fixture-session',path:canary});
    const terminal=await call('terminal/create',{sessionId:'fixture-session',command:'/bin/sh',args:['-c','printf fixture > "$1"','fixture',sentinel],cwd});
    if(terminal.result?.terminalId){
      await call('terminal/wait_for_exit',{sessionId:'fixture-session',terminalId:terminal.result.terminalId});
      await call('terminal/release',{sessionId:'fixture-session',terminalId:terminal.result.terminalId});
    }
    const report={advertisedFs:capabilities?.fs?.readTextFile===true,advertisedTerminal:capabilities?.terminal===true,
      canaryRead:read.result?.content==='synthetic-canary',terminalAccepted:!!terminal.result?.terminalId,
      readError:read.error?.code??null,terminalError:terminal.error?.code??null};
    send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fixture-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:JSON.stringify(report)}}}});
    answer({stopReason:'end_turn'});
  }else if(message.id!==undefined)send({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Fixture method absent'}});
});
