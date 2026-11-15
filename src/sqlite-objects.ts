import { AppError, demoAllowed, sha256 } from './security.ts';
import type { Env } from './types.ts';
import type { ObjectData } from './sqlite-object-store.ts';
interface ObjectRpc {getObject(key:string,etag?:string):Promise<{meta:ObjectData;data:Uint8Array|null}|null>;putObject(key:string,data:Uint8Array,createOnly:boolean):Promise<ObjectData|null>;deleteObject(key:string):Promise<void>;listObjects(prefix:string,limit:number):Promise<ObjectData[]>;}
/** The narrow R2-shaped contract keeps encryption and the independent intent chain shared. */
export function sqliteBucket(env:Env,school:string,owner:string):R2Bucket{
  if(!env.VAULT_OBJECTS)throw new AppError('setup_required',503);
  const n=demoAllowed(env)?env.VAULT_OBJECTS:env.VAULT_OBJECTS.jurisdiction('eu');
  const stub=n.get(n.idFromName(sha256(JSON.stringify([school,owner]))))as unknown as ObjectRpc;
  const metadata=(meta:ObjectData)=>({key:meta.key,etag:meta.etag,httpEtag:'"'+meta.etag+'"',size:meta.size,uploaded:new Date(meta.created_at)});
  return {
    async put(key:string,value:Uint8Array|string,options?:R2PutOptions){
      const condition=options?.onlyIf;
      if(!condition||condition instanceof Headers||condition.etagDoesNotMatch!=='*')throw new AppError('invalid_request');
      const result=await stub.putObject(key,typeof value==='string'?new TextEncoder().encode(value):value,true);return result?metadata(result):null;
    },
    async get(key:string,options?:R2GetOptions){
      const condition=options?.onlyIf;if(condition instanceof Headers)throw new AppError('invalid_request');
      const r=await stub.getObject(key,condition?.etagMatches);if(!r)return null;
      const meta=metadata(r.meta);if(r.data===null)return meta;
      const data=r.data;
      return {...meta,body:new ReadableStream({start(controller){controller.enqueue(data);controller.close();}}),arrayBuffer:async()=>data.slice().buffer,text:async()=>new TextDecoder().decode(data)};
    },
    async delete(key:string){await stub.deleteObject(key);},
    async list(options?:R2ListOptions){const limit=Math.min(options?.limit||100,100),all=await stub.listObjects(options?.prefix||'',limit+1);return {objects:all.slice(0,limit).map(metadata),truncated:all.length>limit};}
  }as unknown as R2Bucket;
}
