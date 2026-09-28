import {createHash,randomUUID} from "node:crypto";
import type {State,StateStore,Json} from "./state/flow-store.ts";
import type {ThreadRef} from "./thread-receipt.ts";

export type BacklinkScope={taskId:string;repo:string;itemNumber:number;authorLogin:string;
  guildId:string;forumId:string;botId:string};
export type Marker={id:string;repo:string;itemNumber:number;authorLogin:string;body:string};
export interface BacklinkBackend {
  // Adapter-owned capabilities/metadata must come from real provider evidence.
  durableIdempotency:boolean;
  find(scope:BacklinkScope):Promise<Marker[]>;
  write(scope:BacklinkScope,body:string,operationId:string):Promise<
    {kind:"created";marker:Marker}|{kind:"not_sent"}|{kind:"ambiguous"}>;
}
type Entry={version:1;fingerprint:string;operationId:string;body:string;
  phase:"prepared"|"inflight"|"created";marker?:Marker};
export type BacklinkResult={kind:"backlink";marker:Marker;thread:ThreadRef;reused:boolean}|
  {kind:"uncertain";reason:string;operationId:string};
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const snowflake=(v:unknown):v is string=>typeof v==="string"&&/^[1-9][0-9]{0,19}$/.test(v)&&
  BigInt(v)<=18_446_744_073_709_551_615n;
const uuid=(v:unknown):v is string=>typeof v==="string"&&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
function object(value:Json|undefined):State {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("BACKLINK_STATE_INVALID");
  return value;
}
function validate(scope:BacklinkScope){
  if(typeof scope.repo!=="string"||!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(scope.repo)||
      [".",".."].includes(scope.repo.split("/")[1]!)||!Number.isSafeInteger(scope.itemNumber)||scope.itemNumber<1||
      scope.taskId!==`${scope.repo}#${scope.itemNumber}`||typeof scope.authorLogin!=="string"||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,38}(\[bot\])?$/.test(scope.authorLogin)||
      !snowflake(scope.guildId)||!snowflake(scope.forumId)||!snowflake(scope.botId))
    throw new Error("BACKLINK_SCOPE_INVALID");
}
function thread(state:State,scope:BacklinkScope):ThreadRef {
  if(state.schemaVersion!==1)throw new Error("STATE_VERSION_UNSUPPORTED");
  const raw=object(object(state.threadReceipts)[hash(scope.taskId)]);
  const bound=object(raw.scope);
  const ref=object(raw.receipt) as unknown as ThreadRef;
  if(raw.version!==1||raw.phase!=="created"||raw.operationId!==ref.operationId||!uuid(ref.operationId)||
      bound.taskId!==scope.taskId||bound.forumId!==scope.forumId||bound.botId!==scope.botId||
      raw.fingerprint!==hash(JSON.stringify([scope.taskId,scope.forumId,scope.botId]))||
      ref.taskId!==scope.taskId||ref.forumId!==scope.forumId||ref.botId!==scope.botId||!snowflake(ref.threadId))
    throw new Error("THREAD_RECEIPT_REQUIRED");
  return structuredClone(ref);
}
function body(scope:BacklinkScope,ref:ThreadRef,operationId:string){
  return `<!-- stackot-backlink:v1 task=${encodeURIComponent(scope.taskId)} operation=${operationId} forum=${scope.forumId} -->\n스레드: https://discord.com/channels/${scope.guildId}/${ref.threadId}`;
}
function trusted(marker:Marker,scope:BacklinkScope,text:string){
  return marker&&typeof marker.id==="string"&&/^[1-9][0-9]*$/.test(marker.id)&&
    typeof marker.repo==="string"&&marker.repo.toLowerCase()===scope.repo.toLowerCase()&&
    marker.itemNumber===scope.itemNumber&&typeof marker.authorLogin==="string"&&
    marker.authorLogin.toLowerCase()===scope.authorLogin.toLowerCase()&&marker.body===text;
}

// Consumes an already durable S35 receipt. There is intentionally no thread creator.
export class BacklinkRepository {
  constructor(private readonly store:StateStore,private readonly backend:BacklinkBackend){}
  async ensure(scope:BacklinkScope):Promise<BacklinkResult>{
    validate(scope);const key=hash(scope.taskId),proposed=randomUUID();
    for(let attempt=0;attempt<8;attempt++){
      const snapshot=await this.store.read(),ref=thread(snapshot.state,scope);
      const fingerprint=hash(JSON.stringify([scope,ref]));
      const entries=snapshot.state.backlinkReceipts===undefined?{}:object(snapshot.state.backlinkReceipts);
      if(!Object.hasOwn(entries,key)){
        const entry:Entry={version:1,fingerprint,operationId:proposed,body:body(scope,ref,proposed),phase:"prepared"};
        await this.store.compareAndSwap(snapshot.revision,{...snapshot.state,
          backlinkReceipts:{...entries,[key]:entry as unknown as Json}});continue;
      }
      const entry=object(entries[key]) as unknown as Entry;
      if(entry.version!==1||!uuid(entry.operationId)||!["prepared","inflight","created"].includes(entry.phase))
        throw new Error("BACKLINK_STATE_INVALID");
      if(entry.fingerprint!==fingerprint||entry.body!==body(scope,ref,entry.operationId))
        throw new Error("BACKLINK_SCOPE_CONFLICT");
      if(entry.phase==="created"){
        if(!entry.marker||!trusted(entry.marker,scope,entry.body))throw new Error("BACKLINK_MARKER_UNTRUSTED");
        return {kind:"backlink",marker:structuredClone(entry.marker),thread:ref,reused:true};
      }
      let markers:Marker[];
      try{markers=await this.backend.find(scope);}
      catch{return {kind:"uncertain",operationId:entry.operationId,reason:"LOOKUP_UNAVAILABLE"};}
      const matches=markers.filter(marker=>trusted(marker,scope,entry.body));
      if(matches.length>1)throw new Error("BACKLINK_DUPLICATE_DETECTED");
      if(matches.length===1)return this.commit(scope,key,entry,matches[0]!,true);
      if(entry.phase==="inflight"){
        if(this.backend.durableIdempotency!==true)
          return {kind:"uncertain",operationId:entry.operationId,reason:"WRITE_NOT_PROVED_ABSENT"};
        return this.write(scope,key,entry);
      }
      // Only the prepared->inflight CAS winner sends the initial request.
      const inflight:Entry={...entry,phase:"inflight"};
      if(await this.store.compareAndSwap(snapshot.revision,{...snapshot.state,
          backlinkReceipts:{...entries,[key]:inflight as unknown as Json}}))
        return this.write(scope,key,inflight);
    }
    throw new Error("BACKLINK_STATE_CONTENTION");
  }
  private async write(scope:BacklinkScope,key:string,entry:Entry):Promise<BacklinkResult>{
    let result:Awaited<ReturnType<BacklinkBackend["write"]>>;
    try{result=await this.backend.write(scope,entry.body,entry.operationId);}
    catch{return {kind:"uncertain",operationId:entry.operationId,reason:"WRITE_AMBIGUOUS"};}
    if(result.kind==="created")return this.commit(scope,key,entry,result.marker,false);
    if(result.kind==="not_sent"){
      // Only a trusted adapter's proven no-send outcome permits this reset.
      for(let attempt=0;attempt<8;attempt++){
        const snapshot=await this.store.read();thread(snapshot.state,scope);
        const entries=object(snapshot.state.backlinkReceipts),current=object(entries[key]) as unknown as Entry;
        if(current.operationId!==entry.operationId||current.fingerprint!==entry.fingerprint)
          throw new Error("BACKLINK_OPERATION_CHANGED");
        if(current.phase!=="inflight")break;
        if(await this.store.compareAndSwap(snapshot.revision,{...snapshot.state,
          backlinkReceipts:{...entries,[key]:{...current,phase:"prepared"} as unknown as Json}}))break;
      }
      return {kind:"uncertain",operationId:entry.operationId,reason:"DEFINITELY_NOT_SENT"};
    }
    return {kind:"uncertain",operationId:entry.operationId,reason:"WRITE_AMBIGUOUS"};
  }
  private async commit(scope:BacklinkScope,key:string,entry:Entry,marker:Marker,reused:boolean):Promise<BacklinkResult>{
    if(!trusted(marker,scope,entry.body))throw new Error("BACKLINK_MARKER_UNTRUSTED");
    for(let attempt=0;attempt<8;attempt++){
      const snapshot=await this.store.read(),ref=thread(snapshot.state,scope);
      if(entry.fingerprint!==hash(JSON.stringify([scope,ref])))throw new Error("BACKLINK_SCOPE_CONFLICT");
      const entries=object(snapshot.state.backlinkReceipts),current=object(entries[key]) as unknown as Entry;
      if(current.version!==1||current.operationId!==entry.operationId||current.fingerprint!==entry.fingerprint||
          current.body!==entry.body||!["prepared","inflight","created"].includes(current.phase))
        throw new Error("BACKLINK_OPERATION_CHANGED");
      if(current.phase==="created"){
        if(!current.marker||!trusted(current.marker,scope,entry.body)||current.marker.id!==marker.id)
          throw new Error("BACKLINK_DUPLICATE_DETECTED");
        return {kind:"backlink",marker:structuredClone(current.marker),thread:ref,reused:true};
      }
      if(await this.store.compareAndSwap(snapshot.revision,{...snapshot.state,
        backlinkReceipts:{...entries,[key]:{...current,phase:"created",marker:structuredClone(marker)} as unknown as Json}}))
        return {kind:"backlink",marker:structuredClone(marker),thread:ref,reused};
    }
    return {kind:"uncertain",operationId:entry.operationId,reason:"RECEIPT_NOT_COMMITTED"};
  }
}
