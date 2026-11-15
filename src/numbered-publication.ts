import {AppError,seal,replacementKey} from './security.ts';
import {DavError} from './dav.ts';
import {finish,jobContext} from './jobs.ts';
import {MAX_NUMBER,numberedName,numberedTargetMatches,requireNumberedPayload} from './numbered-policy.ts';
import type {Env,Job,Payload,Runtime,Storage,SourceVault} from './types.ts';

const matches=(v:{size:number;sha256:string}|null,d:Payload)=>v?.size===d.size&&v.sha256===d.sha256;
function vaultFor(rt:Runtime,j:Job){
 const v=rt.vault?.(j.school_id,j.owner_id);
 if(!v?.claim||!v.reject||!v.numberedState||!v.claimNumbered||!v.rejectNumbered||!rt.numberingLock)throw new AppError('numbering_unavailable',409);
 return v as SourceVault & Required<Pick<SourceVault,'claim'|'reject'|'numberedState'|'claimNumbered'|'rejectNumbered'>>;
}
async function saveTarget(env:Env,j:Job,d:Payload,target:string,rt:Runtime){
 if(!numberedTargetMatches(d,target))throw new AppError('target_policy_changed',409);
 d.target=target;requireNumberedPayload(d);
 const changed=await env.DB.prepare("UPDATE jobs SET payload=?,operation_phase='rename',operation_started_at=COALESCE(operation_started_at,?),updated_at=? WHERE school_id=? AND owner_id=? AND id=? AND lease_token=? AND lease_until>? AND status IN ('publishing','reconciling')")
  .bind(await seal(env,jobContext(j),d),rt.now(),rt.now(),j.school_id,j.owner_id,j.id,j.lease_token,rt.now()).run();
 if(!changed.meta.changes)throw new AppError('job_changed',409);
}
async function release(j:Job,d:Payload,rt:Runtime,token?:string,clearTarget=false){
 if(clearTarget&&d.target)await rt.numberingLock!(j.school_id,j.owner_id,d.folder,j.id,'unreserve',undefined,d.target);
 const own=token||await rt.numberingLock!(j.school_id,j.owner_id,d.folder,j.id,'acquire');
 if(own)await rt.numberingLock!(j.school_id,j.owner_id,d.folder,j.id,'release',own);
}
async function checkedFinal(env:Env,j:Job,d:Payload,s:Storage,rt:Runtime,target:string){
 // The independent receipt is authoritative even if the job SQL was rolled back.
 await saveTarget(env,j,d,target,rt);
 if(matches(await s.inspect(target),d)&&await s.stat(d.temporaryTarget!)===null){await release(j,d,rt,undefined,true);await finish(env,j,'published','reconciled',rt.now());}
 else {await release(j,d,rt);await finish(env,j,'needs_review','result_uncertain',rt.now());}
}
async function waiting(env:Env,j:Job,rt:Runtime,error:unknown){
 const code=error instanceof AppError?error.code:'connection_failed';
 if(rt.now()-j.due_at>=86400000)await finish(env,j,'needs_review','retry_expired',rt.now());
 else if(code==='needs_auth'||code==='account_changed')await finish(env,j,'needs_auth',code,rt.now());
 else if(error instanceof DavError&&![0,423,429,500,502,503,504].includes(error.httpStatus))await finish(env,j,'needs_review',code,rt.now());
 else await finish(env,j,'reconciling',code,rt.now(),rt.now()+60000);
}
export async function promoteNumbered(env:Env,j:Job,d:Payload,s:Storage,rt:Runtime){
 const v=vaultFor(rt,j);let token:string|null=null;
 try{
  const state=await v.numberedState(d.source);
  if(state&&!state.rejected){await checkedFinal(env,j,d,s,rt,state.target);return;}
  if(j.manual_read_only===1){await release(j,d,rt);await finish(env,j,'needs_review','result_uncertain',rt.now());return;}
  if(env.NUMBERED_NAMING_ENABLED!=='true'){await release(j,d,rt);await finish(env,j,'needs_review','numbering_unavailable',rt.now());return;}
  if(rt.now()-j.due_at>=86400000){await release(j,d,rt);await finish(env,j,'needs_review','retry_expired',rt.now());return;}
  const access=s.folderAccess?await s.folderAccess(d.folder):null;
  if(!(access?access.writable||access.permission==='unknown'&&d.writeVerifiedAtPlan===true:await s.canWrite(d.folder)))throw new AppError('folder_read_only',403);
  if(!matches(await s.inspect(d.temporaryTarget!),d)){await finish(env,j,'needs_review','temporary_unverified',rt.now());await release(j,d,rt);return;}
  token=await rt.numberingLock!(j.school_id,j.owner_id,d.folder,j.id,'acquire');
  if(!token){await finish(env,j,'reconciling','numbering_folder_busy',rt.now(),rt.now()+5000);return;}
  const reserved=new Set(await rt.numberingReservations?.(j.school_id,d.folder)||[]);
  const occupied=s.namesInFolder?new Set((await s.namesInFolder(d.folder)).map(n=>n.normalize('NFC'))):null;
  // Bounded final attempts. A rejected/no-send receipt permits the next candidate.
  for(let attempt=0;attempt<5;attempt++){
   let target='';let reads=0;
   for(let number=1;number<=MAX_NUMBER;number++){
    const name=numberedName(d.filename,number===1?null:number);
    if(reserved.has(replacementKey(env,j.school_id,d.folder+name)))continue;
    if(occupied?occupied.has(name):await s.stat(d.folder+name)!==null){if(!occupied&&++reads>=32)throw new AppError('numbering_scan_limit',409);continue;}
    target=d.folder+name;break;
   }
   if(!target)throw new AppError('numbered_names_exhausted',409);
   d.target=target;
   const reservation=await rt.numberingLock!(j.school_id,j.owner_id,d.folder,j.id,'reserve',token,target);
   if(!reservation){reserved.add(replacementKey(env,j.school_id,target));continue;}
   await saveTarget(env,j,d,target,rt);
   const sequence=await v.claimNumbered(d.source,target);
   if(sequence===null){const state=await v.numberedState(d.source);if(state&&state.target!==target)await rt.numberingLock!(j.school_id,j.owner_id,d.folder,j.id,'unreserve',undefined,target);await release(j,d,rt,token);await finish(env,j,'reconciling','result_uncertain',rt.now(),rt.now()+60000);return;}
   // Last HEAD is after the durable receipt and all expensive file verification.
   let exists:boolean;
   try{exists=await s.stat(target)!==null;}catch(error){await v.rejectNumbered(d.source,sequence,0);throw error;}
   if(exists){await v.rejectNumbered(d.source,sequence,0);await rt.numberingLock!(j.school_id,j.owner_id,d.folder,j.id,'unreserve',undefined,target);occupied?.add(target.slice(d.folder.length));continue;}
   const live=await env.DB.prepare("UPDATE jobs SET updated_at=? WHERE school_id=? AND owner_id=? AND id=? AND lease_token=? AND lease_until>? AND status IN ('publishing','reconciling')")
    .bind(rt.now(),j.school_id,j.owner_id,j.id,j.lease_token,rt.now()).run();
   if(!live.meta.changes){await v.rejectNumbered(d.source,sequence,0);throw new AppError('job_changed',409);}
   try{
    if(!s.renameNumbered)throw new AppError('numbering_unavailable',409);
    await s.renameNumbered(d.temporaryTarget!,target);
   }catch(error){
    if(error instanceof DavError&&!error.uncertain&&[401,403,404,412,423,429,507].includes(error.httpStatus)){
     await v.rejectNumbered(d.source,sequence,error.httpStatus);
     await rt.numberingLock!(j.school_id,j.owner_id,d.folder,j.id,'unreserve',undefined,target);
     if(error.httpStatus===412){occupied?.add(target.slice(d.folder.length));continue;}
    }
    throw error;
   }
   if(matches(await s.inspect(target),d)&&await s.stat(d.temporaryTarget!)===null){await release(j,d,rt,token,true);await finish(env,j,'published',null,rt.now());}
   else {await release(j,d,rt,token);await finish(env,j,'needs_review','target_unverified',rt.now());}
   return;
  }
  await release(j,d,rt,token);await finish(env,j,'reconciling','numbering_contended',rt.now(),rt.now()+5000);
 }catch(error){
  // A receipt write can itself lose its answer. Retain its target reservation; the short folder turn may be released.
  let clearTarget=false;try{const state=await v.numberedState(d.source);clearTarget=!state||state.rejected;}catch{/* Keep the candidate reservation when its receipt is unavailable. */}
  await release(j,d,rt,token||undefined,clearTarget).catch(()=>{});
  await waiting(env,j,rt,error);
 }
}
export async function executeNumbered(env:Env,j:Job,d:Payload,s:Storage,rt:Runtime,body:Uint8Array){
 const v=vaultFor(rt,j);
 try{
  const state=await v.numberedState(d.source);
  if(state&&!state.rejected){await checkedFinal(env,j,d,s,rt,state.target);return;}
  const existing=await s.stat(d.temporaryTarget!);
  const marked=await env.DB.prepare("UPDATE jobs SET operation_started_at=?,operation_phase='upload',updated_at=? WHERE school_id=? AND owner_id=? AND id=? AND lease_token=? AND lease_until>? AND status='publishing' AND operation_started_at IS NULL")
   .bind(rt.now(),rt.now(),j.school_id,j.owner_id,j.id,j.lease_token,rt.now()).run();
  if(!marked.meta.changes)return;
  if(existing){await promoteNumbered(env,j,d,s,rt);return;}
  const claim=await v.claim(d.source);
  if(claim===null){await finish(env,j,'reconciling','result_uncertain',rt.now(),rt.now()+60000);return;}
  try{await s.publish!(d.temporaryTarget!,body);}catch(error){
   if(error instanceof DavError&&!error.uncertain&&[401,403,404,412,423,429,507].includes(error.httpStatus)){
    await v.reject(d.source,claim,error.httpStatus);
    await finish(env,j,[423,429].includes(error.httpStatus)?'retry_wait':error.httpStatus===401?'needs_auth':'failed',error.code,rt.now(),rt.now()+60000,true);
   }else await finish(env,j,'reconciling','result_uncertain',rt.now(),rt.now()+60000);
   return;
  }
  await promoteNumbered(env,j,d,s,rt);
 }catch(error){await waiting(env,j,rt,error);}
}
