import {LEGACY_BYTES,putChunked,readChunked,removeChunks} from './chunked-vault.ts';
import { AppError, maxFile, sha256, vaultKey, seal, unseal, readLimited } from './security.ts';
import type { Env, SourceVault } from './types.ts';
import { chargeR2 } from './storage-budget.ts';
import { sqliteBucket } from './sqlite-objects.ts';

/** The bucket has no public endpoint. Only opaque names and binary authenticated ciphertext are stored. */
export class FileVault implements SourceVault {
  private prefix:string;
  private bucket:R2Bucket;
  constructor(private env:Env,private school:string,private owner:string){
    if(!env.FILES&&!env.VAULT_OBJECTS)throw new AppError('setup_required',503);
    this.bucket=env.FILES||sqliteBucket(env,school,owner);
    this.prefix='v1/'+sha256(JSON.stringify([school,owner]))+'/';
  }
  key(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new AppError('invalid_request');return this.prefix+id;}
  private validate(key:string){if(!key.startsWith(this.prefix)||!/^v1\/[a-f0-9]{64}\/[a-f0-9-]{36}$/.test(key))throw new AppError('forbidden',403);}
  private context(key:string,expected:{size:number;sha256:string}){
    this.validate(key);
    if(!Number.isSafeInteger(expected.size)||expected.size<=0||expected.size>maxFile(this.env)||!/^[a-f0-9]{64}$/.test(expected.sha256))throw new AppError('file_changed',409);
    return new TextEncoder().encode(JSON.stringify(['zeitplaner-file-v1',this.school,this.owner,key,expected.size,expected.sha256]));
  }
  private async cryptoKey(){
    const master=await crypto.subtle.importKey('raw',vaultKey(this.env),'HKDF',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode(this.prefix),info:new TextEncoder().encode('zeitplaner-file-key-v1')},master,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async put(key:string,body:Uint8Array,expected:{size:number;sha256:string}){
    const aad=this.context(key,expected);
    if(body.length!==expected.size||sha256(body)!==expected.sha256)throw new AppError('file_changed',409);
    if(expected.size>LEGACY_BYTES){if(!this.env.VAULT_OBJECTS)throw new AppError('file_too_large',413);return putChunked(this.bucket,this.env,key,body,expected,await this.cryptoKey());}
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await this.cryptoKey(),body as Uint8Array<ArrayBuffer>);
    const envelope=new Uint8Array(13+encrypted.byteLength);envelope[0]=1;envelope.set(iv,1);envelope.set(new Uint8Array(encrypted),13);
    // A retry may find the first upload. Never replace it, even with the same plaintext.
    await chargeR2(this.env,'A');await this.bucket.put(key,envelope,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream',cacheControl:'no-store'}});
    return {etag:(await this.read(key,expected)).etag};
  }
  async read(key:string,expected:{size:number;sha256:string},etag?:string){
    const aad=this.context(key,expected);
    if(expected.size>LEGACY_BYTES){if(!this.env.VAULT_OBJECTS)throw new AppError('file_too_large',413);return readChunked(this.bucket,this.env,key,expected,await this.cryptoKey(),etag);}
    await chargeR2(this.env,'B');const object=await this.bucket.get(key,etag?{onlyIf:{etagMatches:etag}}:undefined);
    if(!object)throw new AppError('source_missing',409);
    const stream=(object as R2ObjectBody).body;
    if(!stream)throw new AppError('source_changed',409);
    if(object.size!==expected.size+29){await stream.cancel();throw new AppError('source_changed',409);}
    const envelope=await readLimited({body:stream,headers:new Headers()},expected.size+29);
    if(envelope.length!==expected.size+29||envelope[0]!==1)throw new AppError('source_changed',409);
    let body:Uint8Array;
    try{body=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:envelope.slice(1,13),additionalData:aad},await this.cryptoKey(),envelope.slice(13)));}
    catch{throw new AppError('source_changed',409);}
    if(body.length!==expected.size||sha256(body)!==expected.sha256)throw new AppError('source_changed',409);
    return {body,etag:object.etag};
  }
  async remove(key:string){this.validate(key);await this.bucket.delete(key);if(this.env.VAULT_OBJECTS)await removeChunks(this.bucket,key);}
  /** Independent create-only intent chain survives a rollback of the actor's SQLite state. */
  async claim(key:string,phase?:'rename'){
    this.validate(key);const prefix='receipts/'+key+'/'+(phase?'rename-':'')+'intent-';
    await chargeR2(this.env,'A');const records=await this.bucket.list({prefix,limit:100});
    if(records.truncated)throw new AppError('result_uncertain',409);
    const last=records.objects.map(o=>o.key.slice(prefix.length)).sort().at(-1);
    let sequence=0;
    if(last!==undefined){
      if(!/^\d{6}$/.test(last))throw new AppError('result_uncertain',409);
      await chargeR2(this.env,'B');const rejection=await this.bucket.get('receipts/'+key+'/'+(phase?'rename-':'')+'rejected-'+last);
      if(!rejection)return null;
      if(rejection.size>4096)throw new AppError('result_uncertain',409);
      const proof=await unseal<{status:number}>(this.env,'rejection:'+key+':'+(phase?'rename:':'')+last,await rejection.text());
      if(![401,403,404,412,423,429,507].includes(proof.status))throw new AppError('result_uncertain',409);
      sequence=Number(last)+1;
    }
    const claim=String(sequence).padStart(6,'0');
    await chargeR2(this.env,'A');const result=await this.bucket.put(prefix+claim,await seal(this.env,'intent:'+key+':'+(phase?'rename:':'')+claim,{at:Date.now()}),{onlyIf:{etagDoesNotMatch:'*'}});
    return result?claim:null;
  }
  async pendingClaim(key:string,phase:'rename'){
    this.validate(key);const prefix='receipts/'+key+'/rename-intent-';
    await chargeR2(this.env,'A');const records=await this.bucket.list({prefix,limit:100});if(records.truncated)throw new AppError('result_uncertain',409);
    const last=records.objects.map(o=>o.key.slice(prefix.length)).sort().at(-1);if(last===undefined)return false;if(!/^\d{6}$/.test(last))throw new AppError('result_uncertain',409);
    await chargeR2(this.env,'B');const rejection=await this.bucket.get('receipts/'+key+'/rename-rejected-'+last);
    return rejection===null;
  }
  async reject(key:string,claim:string,status:number,phase?:'rename'){
    this.validate(key);if(!/^\d{6}$/.test(claim)||![401,403,404,412,423,429,507].includes(status))throw new AppError('result_uncertain',409);
    await chargeR2(this.env,'B');const intent=await this.bucket.get('receipts/'+key+'/'+(phase?'rename-':'')+'intent-'+claim);
    if(!intent||intent.size>4096)throw new AppError('result_uncertain',409);
    await unseal(this.env,'intent:'+key+':'+(phase?'rename:':'')+claim,await intent.text());
    await chargeR2(this.env,'A');await this.bucket.put('receipts/'+key+'/'+(phase?'rename-':'')+'rejected-'+claim,await seal(this.env,'rejection:'+key+':'+(phase?'rename:':'')+claim,{status,at:Date.now()}),{onlyIf:{etagDoesNotMatch:'*'}});
  }
  /** Target-bearing, independent create-only journal for dynamic names. Never cleared by source cleanup. */
  async numberedState(key:string){
    this.validate(key);const prefix='receipts/'+key+'/numbered-intent-';
    await chargeR2(this.env,'A');const records=await this.bucket.list({prefix,limit:100});
    if(records.truncated)throw new AppError('result_uncertain',409);
    const sequence=records.objects.map(o=>o.key.slice(prefix.length)).sort().at(-1);if(sequence===undefined)return null;
    if(!/^\d{6}$/.test(sequence))throw new AppError('result_uncertain',409);
    await chargeR2(this.env,'B');const intent=await this.bucket.get(prefix+sequence);
    if(!intent||intent.size>4096)throw new AppError('result_uncertain',409);
    const record=await unseal<{target:string}>(this.env,'numbered-intent:'+key+':'+sequence,await intent.text());
    if(typeof record.target!=='string'||record.target.length>1800)throw new AppError('result_uncertain',409);
    await chargeR2(this.env,'B');const rejection=await this.bucket.get('receipts/'+key+'/numbered-rejected-'+sequence);
    if(rejection){
      if(rejection.size>4096)throw new AppError('result_uncertain',409);
      const proof=await unseal<{status:number}>(this.env,'numbered-rejection:'+key+':'+sequence,await rejection.text());
      if(![0,401,403,404,412,423,429,507].includes(proof.status))throw new AppError('result_uncertain',409);
    }
    return {sequence,target:record.target,rejected:Boolean(rejection)};
  }
  async claimNumbered(key:string,target:string){
    this.validate(key);if(typeof target!=='string'||target.length>1800)throw new AppError('invalid_request');
    const last=await this.numberedState(key);if(last&&!last.rejected)return null;
    const sequence=String(last?Number(last.sequence)+1:0).padStart(6,'0');
    if(Number(sequence)>=99)throw new AppError('numbering_attempt_limit',409);
    await chargeR2(this.env,'A');const result=await this.bucket.put('receipts/'+key+'/numbered-intent-'+sequence,await seal(this.env,'numbered-intent:'+key+':'+sequence,{target,at:Date.now()}),{onlyIf:{etagDoesNotMatch:'*'}});
    return result?sequence:null;
  }
  async rejectNumbered(key:string,sequence:string,status:number){
    // 0 records a local proof that the final HEAD prevented any MOVE from being sent.
    this.validate(key);if(!/^\d{6}$/.test(sequence)||![0,401,403,404,412,423,429,507].includes(status))throw new AppError('result_uncertain',409);
    await chargeR2(this.env,'B');const intent=await this.bucket.get('receipts/'+key+'/numbered-intent-'+sequence);
    if(!intent||intent.size>4096)throw new AppError('result_uncertain',409);
    await unseal(this.env,'numbered-intent:'+key+':'+sequence,await intent.text());
    await chargeR2(this.env,'A');await this.bucket.put('receipts/'+key+'/numbered-rejected-'+sequence,await seal(this.env,'numbered-rejection:'+key+':'+sequence,{status,at:Date.now()}),{onlyIf:{etagDoesNotMatch:'*'}});
  }

}
