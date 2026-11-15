import {AppError,within} from './security.ts';
import {DavError} from './dav.ts';
import {finish} from './jobs.ts';
import type {Env,Job,Payload,Runtime,Storage,SourceVault} from './types.ts';

function vaultFor(rt:Runtime,j:Job){const vault=rt.vault?.(j.school_id,j.owner_id);if(!vault?.claim||!vault.reject||!vault.pendingClaim)throw new AppError('setup_required',503);return vault;}
const matches=(info:{size:number;sha256:string}|null,data:Payload)=>info?.size===data.size&&info.sha256===data.sha256;
async function releaseTurn(j:Job,d:Payload,rt:Runtime,token?:string){if(!rt.numberingLock)return;if(d.target)await rt.numberingLock(j.school_id,j.owner_id,d.folder,j.id,'unreserve',undefined,d.target);const own=token||await rt.numberingLock(j.school_id,j.owner_id,d.folder,j.id,'acquire');if(own)await rt.numberingLock(j.school_id,j.owner_id,d.folder,j.id,'release',own);}
async function checkedFinal(env:Env,j:Job,d:Payload,s:Storage,rt:Runtime){
  const target=await s.inspect(d.target),temporary=await s.stat(d.temporaryTarget!);
  if(matches(target,d)&&temporary===null){await releaseTurn(j,d,rt);await finish(env,j,'published','reconciled',rt.now());}
  else await finish(env,j,'needs_review','result_uncertain',rt.now());
}
async function failedOperation(env:Env,j:Job,d:Payload,rt:Runtime,vault:SourceVault,claim:string|null,error:unknown,phase?:'rename'){
  const code=error instanceof AppError?error.code:'connection_failed',now=rt.now();
  if(error instanceof DavError&&!error.uncertain&&claim!==null){
    await vault.reject!(d.source,claim,error.httpStatus,phase);
    if([423,429].includes(error.httpStatus)){
      if(now-j.due_at>=86400000){await finish(env,j,'needs_review','retry_expired',now);return;}
      // An explicitly rejected rename can be resumed without repeating its PUT.
      await finish(env,j,phase?'reconciling':'retry_wait',code,now,now+Math.min(3600000,60000*2**Math.min(j.attempts,6)),!phase);return;
    }
    await finish(env,j,error.httpStatus===401?'needs_auth':error.httpStatus===412?'conflict':'failed',code,now,now,!phase);return;
  }
  await finish(env,j,'reconciling',code==='needs_auth'?code:'result_uncertain',now,now+60000);
}
/** Resume only from a fully verified temporary file. Pending rename intent always means read-only. */
async function promote(env:Env,j:Job,d:Payload,s:Storage,rt:Runtime,vault:SourceVault){
  if(await vault.pendingClaim!(d.source,'rename')){await checkedFinal(env,j,d,s,rt);return;}
  if(d.targetNaming==='replace-v1'&&env.CONFIRMED_REPLACE_ENABLED!=='true'){await finish(env,j,'needs_review','replacement_unavailable',rt.now());return;}
  if(d.targetNaming!=='replace-v1'&&env.GROUP_MOVE_REJECTED==='true'){await finish(env,j,'needs_review',within(d.folder,'/Groups/')?'original_group_move_rejected':'original_move_suspended',rt.now());return;}
  if(d.targetNaming!=='replace-v1'&&env.ORIGINAL_MOVE_APPROVED!=='true'){await finish(env,j,'needs_review','target_policy_changed',rt.now());return;}
  if(d.targetNaming!=='replace-v1'&&await s.stat(d.target)){await finish(env,j,'conflict','conflict',rt.now());return;}
  if(rt.now()-j.due_at>=86400000){await finish(env,j,'needs_review','retry_expired',rt.now());return;}
  const access=s.folderAccess?await s.folderAccess(d.folder):null;
  const eligible=access?access.writable||access.permission==='unknown'&&d.writeVerifiedAtPlan===true:await s.canWrite(d.folder);
  if(!eligible){await finish(env,j,'failed','folder_read_only',rt.now());return;}
  if(!matches(await s.inspect(d.temporaryTarget!),d)){await finish(env,j,'needs_review','temporary_unverified',rt.now());return;}
  const token=env.NUMBERED_NAMING_ENABLED==='true'&&rt.numberingLock?await rt.numberingLock(j.school_id,j.owner_id,d.folder,j.id,'acquire'):undefined;
  if(token===null){await finish(env,j,'reconciling','numbering_folder_busy',rt.now(),rt.now()+5000);return;}
  if(token&&!await rt.numberingLock!(j.school_id,j.owner_id,d.folder,j.id,'reserve',token,d.target)){await releaseTurn(j,d,rt,token);await finish(env,j,'reconciling','numbering_folder_busy',rt.now(),rt.now()+5000);return;}
  const marked=await env.DB.prepare("UPDATE jobs SET operation_phase='rename',updated_at=? WHERE school_id=? AND owner_id=? AND id=? AND lease_token=? AND lease_until>? AND status IN ('publishing','reconciling') AND operation_started_at IS NOT NULL").bind(rt.now(),j.school_id,j.owner_id,j.id,j.lease_token,rt.now()).run();
  if(!marked.meta.changes){if(token)await releaseTurn(j,d,rt,token);return;}
  const claim=await vault.claim!(d.source,'rename');
  if(claim===null){await finish(env,j,'reconciling','result_uncertain',rt.now(),rt.now()+60000);return;}
  try{
    if(d.targetNaming==='replace-v1'){if(!s.renameReplacing)throw new AppError('replacement_unavailable',409);await s.renameReplacing(d.temporaryTarget!,d.target);}
    else {if(!s.renameNew)throw new AppError('setup_required',503);await s.renameNew(d.temporaryTarget!,d.target);}
    const target=await s.inspect(d.target),remaining=await s.stat(d.temporaryTarget!);
    if(matches(target,d)&&remaining===null){await releaseTurn(j,d,rt,token||undefined);await finish(env,j,'published',null,rt.now());}
    else {if(token)await rt.numberingLock!(j.school_id,j.owner_id,d.folder,j.id,'release',token);await finish(env,j,'needs_review','target_unverified',rt.now());}
  }catch(error){await failedOperation(env,j,d,rt,vault,claim,error,'rename');if(token){if(!await vault.pendingClaim!(d.source,'rename'))await releaseTurn(j,d,rt,token);else await rt.numberingLock!(j.school_id,j.owner_id,d.folder,j.id,'release',token);}}
}
export async function executeOriginal(env:Env,j:Job,d:Payload,s:Storage,rt:Runtime,body:Uint8Array){
  const vault=vaultFor(rt,j);
  if(d.targetNaming!=='replace-v1'&&await s.stat(d.target)){await finish(env,j,'conflict','conflict',rt.now());return;}
  if(await s.stat(d.temporaryTarget!)){await finish(env,j,'needs_review','temporary_conflict',rt.now());return;}
  const now=rt.now();
  const marked=await env.DB.prepare("UPDATE jobs SET operation_started_at=?,operation_phase='upload',updated_at=? WHERE school_id=? AND owner_id=? AND id=? AND status='publishing' AND lease_token=? AND lease_until>? AND due_at<=? AND operation_started_at IS NULL").bind(now,now,j.school_id,j.owner_id,j.id,j.lease_token,now,now).run();
  if(!marked.meta.changes)return;
  try{
    const claim=await vault.claim!(d.source);
    if(claim===null){await finish(env,j,'reconciling','result_uncertain',rt.now(),rt.now()+60000);return;}
    try{await s.publish!(d.temporaryTarget!,body);}catch(error){await failedOperation(env,j,d,rt,vault,claim,error);return;}
    await promote(env,j,d,s,rt,vault);
  }catch{
    // After durable intent, even a read/receipt failure must not clear intent or
    // escape to the scheduler's pre-upload retry path.
    await finish(env,j,'reconciling','result_uncertain',rt.now(),rt.now()+60000);
  }
}
export async function reconcileOriginal(env:Env,j:Job,d:Payload,s:Storage,rt:Runtime){
  const vault=vaultFor(rt,j);
  // The independent rename receipt also handles a rollback of operation_phase in SQL.
  if(await vault.pendingClaim!(d.source,'rename')){await checkedFinal(env,j,d,s,rt);return;}
  if(j.manual_read_only===1){await finish(env,j,'needs_review','result_uncertain',rt.now());return;}
  await promote(env,j,d,s,rt,vault);
}
