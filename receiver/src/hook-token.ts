import {openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {isAbsolute} from 'node:path';

export function assertHookToken(value: unknown): asserts value is string {
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||/^<[^<>]*>$/.test(value))throw new Error('Invalid non-blank real hook token');
}

/** Private operator-owned credential source; no stale fallback after file error. */
export function currentHookToken(cfg:{openclawHookToken:string;openclawHookTokenFile?:string},remember?:(value:string)=>void):string {
  assertHookToken(cfg.openclawHookToken);remember?.(cfg.openclawHookToken);
  if(cfg.openclawHookTokenFile===undefined)return cfg.openclawHookToken;
  if(typeof cfg.openclawHookTokenFile!=='string'||!isAbsolute(cfg.openclawHookTokenFile))throw new Error('Hook token file must be an absolute path');
  let fd:number|undefined;
  try{
    fd=openSync(cfg.openclawHookTokenFile,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);const stat=fstatSync(fd);
    if(!stat.isFile()||typeof process.getuid!=='function'||stat.uid!==process.getuid()||(stat.mode&0o077)!==0||stat.size>4096)throw new Error('Hook credential file ownership/mode/type/size rejected');
    const buffer=Buffer.alloc(4097);let length=0;
    while(length<buffer.length){const count=readSync(fd,buffer,length,buffer.length-length,null);if(!count)break;length+=count;}
    if(length>4096)throw new Error('Hook credential file too large');
    let data:unknown;try{data=JSON.parse(buffer.subarray(0,length).toString('utf8'));}catch{throw new Error('Invalid hook credential JSON');}
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).sort().join(',')!=='token,version')throw new Error('Unexpected hook credential shape');
    const record=data as {version:unknown;token:unknown};if(record.version!==1)throw new Error('Unsupported hook credential version');
    assertHookToken(record.token);remember?.(record.token);return record.token;
  }catch{throw new Error('Runtime hook credential unavailable or invalid');}
  finally{if(fd!==undefined)closeSync(fd);}
}
