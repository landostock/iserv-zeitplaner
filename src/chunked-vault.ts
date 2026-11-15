import {createHash} from 'node:crypto';
import {AppError,readLimited,seal,unseal,sha256} from './security.ts';
import type {Env} from './types.ts';
export const CHUNK_BYTES=1024*1024;
export const LEGACY_BYTES=10*1024*1024;
type Expected={size:number;sha256:string};
const partKey=(key:string,i:number)=>'parts/'+key+'/'+String(i).padStart(6,'0');
const context=(key:string,e:Expected,i:number)=>new TextEncoder().encode(JSON.stringify(['file-part-v2',key,e.size,e.sha256,i]));
export async function chunkManifest(bucket:R2Bucket,env:Env,key:string,e:Expected,etag?:string){
 const object=await bucket.get(key,etag?{onlyIf:{etagMatches:etag}}:undefined);
 if(!object)throw new AppError('source_missing',409);
 if(!('body'in object)||!object.body||object.size>4096)throw new AppError('source_changed',409);
 const bytes=await readLimited({body:object.body,headers:new Headers()},4096);
 let m:{format:number;size:number;sha256:string;count:number};
 try{m=await unseal(env,'file-manifest-v2:'+key,new TextDecoder().decode(bytes));}catch{throw new AppError('source_changed',409);}
 if(m.format!==2||m.size!==e.size||m.sha256!==e.sha256||m.count!==Math.ceil(e.size/CHUNK_BYTES))throw new AppError('source_changed',409);
 return {etag:object.etag,count:m.count};
}
async function readPart(bucket:R2Bucket,key:string,e:Expected,i:number,cryptoKey:CryptoKey){
 const size=Math.min(CHUNK_BYTES,e.size-i*CHUNK_BYTES),object=await bucket.get(partKey(key,i));
 if(!object||!('body'in object)||!object.body||object.size!==size+29)throw new AppError('source_changed',409);
 const encrypted=await readLimited({body:object.body,headers:new Headers()},size+29);
 if(encrypted.length!==size+29||encrypted[0]!==2)throw new AppError('source_changed',409);
 try{return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:encrypted.slice(1,13) as Uint8Array<ArrayBuffer>,additionalData:context(key,e,i)},cryptoKey,encrypted.subarray(13) as Uint8Array<ArrayBuffer>));}
 catch{throw new AppError('source_changed',409);}
}
/** Small independently authenticated objects avoid whole-file encryption and RPC copies. */
export async function putChunked(bucket:R2Bucket,env:Env,key:string,body:Uint8Array,e:Expected,cryptoKey:CryptoKey){
 const count=Math.ceil(e.size/CHUNK_BYTES);
 for(let i=0;i<count;i++){
  const plain=body.subarray(i*CHUNK_BYTES,Math.min(body.length,(i+1)*CHUNK_BYTES)),iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context(key,e,i)},cryptoKey,plain as Uint8Array<ArrayBuffer>);
  const envelope=new Uint8Array(ciphertext.byteLength+13);envelope[0]=2;envelope.set(iv,1);envelope.set(new Uint8Array(ciphertext),13);
  await bucket.put(partKey(key,i),envelope,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream',cacheControl:'no-store'}});
  if(sha256(await readPart(bucket,key,e,i,cryptoKey))!==sha256(plain))throw new AppError('source_changed',409);
 }
 // Only a complete, reread source receives a durable manifest and can be planned.
 await bucket.put(key,await seal(env,'file-manifest-v2:'+key,{format:2,size:e.size,sha256:e.sha256,count}),{onlyIf:{etagDoesNotMatch:'*'}});
 return {etag:(await chunkManifest(bucket,env,key,e)).etag};
}
export async function readChunked(bucket:R2Bucket,env:Env,key:string,e:Expected,cryptoKey:CryptoKey,etag?:string){
 const manifest=await chunkManifest(bucket,env,key,e,etag),body=new Uint8Array(e.size),hash=createHash('sha256');
 for(let i=0;i<manifest.count;i++){const part=await readPart(bucket,key,e,i,cryptoKey);body.set(part,i*CHUNK_BYTES);hash.update(part);}
 if(hash.digest('hex')!==e.sha256)throw new AppError('source_changed',409);
 return {body,etag:manifest.etag};
}
export async function removeChunks(bucket:R2Bucket,key:string){
 const prefix='parts/'+key+'/';const objects=await bucket.list({prefix,limit:100});
 if(objects.truncated)throw new AppError('source_changed',409);
 for(const part of objects.objects)await bucket.delete(part.key);
}
