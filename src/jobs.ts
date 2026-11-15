import type { Env, Job, Payload, Principal, Runtime, Status, Storage } from './types.ts';
import { AppError, filename, maxFile, path, random, seal, sha256, unseal, within, demoAllowed,replacementKey } from './security.ts';
import { berlinInstant } from './time.ts';
import { DEMO_GROUP, DEMO_PRIVATE } from './demo.ts';
import { DavError } from './dav.ts';
import { authorizeUntil } from './runtime.ts';
import { publicationName,publicationNonce,uniqueTargetMatches,originalTargetMatches,temporaryPublicationName } from './publication-name.ts';

import {NUMBERING_POLICY,requireNumberedPayload} from './numbered-policy.ts';
import {readNamingQuote} from './naming-quote.ts';

export const jobContext=(j:Pick<Job,'school_id'|'owner_id'|'id'>)=>`job:${j.school_id}:${j.owner_id}:${j.id}`;
export const payload=(env:Env,j:Job)=>unseal<Payload>(env,jobContext(j),j.payload);
export function requireAccountIdentity(data:Payload,storage:Storage){if(data.accountIdentity&&data.accountIdentity!==storage.accountIdentity)throw new AppError('account_changed',409);}
export function requireTargetPolicy(env:Env,data:Payload,readOnlyReconciliation=false){
  if(data.collisionRules&&(data.collisionRules.sameSize!==data.collisionRules.otherSize||data.collisionRules.sameSize!==(data.targetNaming==='replace-v1')))throw new AppError('conditional_replacement_unavailable',409);
  if(data.targetNaming==='numbered-v1'){
    requireNumberedPayload(data);if(!readOnlyReconciliation&&env.NUMBERED_NAMING_ENABLED!=='true')throw new AppError('numbering_unavailable',409);return;
  }
  if(data.targetNaming==='replace-v1'){
    if(!readOnlyReconciliation&&env.CONFIRMED_REPLACE_ENABLED!=='true'||data.target!==data.folder+data.filename||data.replacementConsentTarget!==data.target||!Number.isSafeInteger(data.replacementAcceptedAt)||(data.replacementAcceptedAt||0)<=0||!data.targetNonce||!/^[a-f0-9]{32}$/.test(data.targetNonce)||data.temporaryTarget!==data.folder+temporaryPublicationName(data.targetNonce))throw new AppError('replacement_consent_required',409);
    return;
  }
  if(data.targetNaming==='original-move-v1'){
    if(!originalTargetMatches(data))throw new AppError('target_policy_changed',409);
    if(!readOnlyReconciliation&&env.GROUP_MOVE_REJECTED==='true')throw new AppError(within(data.folder,'/Groups/')?'original_group_move_rejected':'original_move_suspended',409);
    if(!readOnlyReconciliation&&env.ORIGINAL_MOVE_APPROVED!=='true')throw new AppError('target_policy_changed',409);
    return;
  }
  if((env.TARGET_NAMING==='unique-v1'||data.targetNaming==='unique-v1')&&!uniqueTargetMatches(data))throw new AppError('target_policy_changed',409);
}
export async function ownJob(env:Env,p:Principal,id:string):Promise<Job>{
  const row=await env.DB.prepare('SELECT * FROM jobs WHERE school_id=? AND owner_id=? AND id=?').bind(p.school,p.owner,id).first<Job>();
  if(!row)throw new AppError('not_found',404);return row;
}
export async function publicJob(env:Env,j:Job){
  const d=await payload(env,j);
  return {id:j.id,filename:d.filename,publishedFilename:d.target?d.target.slice(d.folder.length):null,targetNaming:d.targetNaming||'original',temporaryFilename:d.temporaryTarget?.slice(d.folder.length)||null,folder:d.folder,size:d.size,dueAt:j.due_at,localTime:d.localTime,status:j.status,
    revision:j.revision,errorCode:j.error_code,confirmedAt:j.confirmed_at,attempts:j.attempts,nextAttemptAt:j.next_attempt_at,
    checkable:['needs_auth','needs_review'].includes(j.status)&&j.operation_started_at!==null,
    editable:['scheduled','retry_wait','needs_auth','failed','conflict'].includes(j.status)&&j.operation_started_at===null&&j.staging_etag!==null&&!j.source_cleaned_at,
    cancellable:['preparing','scheduled','retry_wait','needs_auth','failed','conflict','needs_review'].includes(j.status)&&j.operation_started_at===null};
}
export async function createJob(env:Env,p:Principal,input:any,rt:Runtime){
  const name=filename(input.filename), folder=path(input.folder);
  const root=demoAllowed(env)?DEMO_GROUP:env.GROUP_ROOT!;
  if(!folder.endsWith('/')||(!within(folder,root)&&!(env.PUBLICATION_MODE==='vault-put'&&env.ADDITIONAL_GROUP_ROOT&&within(folder,env.ADDITIONAL_GROUP_ROOT))))throw new AppError('invalid_path');
  let collisionRules:{sameSize:boolean;otherSize:boolean}|undefined;
  if(input.collisionRules!==undefined){
    const rules=input.collisionRules;
    if(!rules||typeof rules!=='object'||Array.isArray(rules)||Object.keys(rules).length!==2||typeof rules.sameSize!=='boolean'||typeof rules.otherSize!=='boolean')throw new AppError('invalid_request');
    if(rules.sameSize!==rules.otherSize)throw new AppError('conditional_replacement_unavailable',409);
    collisionRules={sameSize:rules.sameSize,otherSize:rules.otherSize};
    if(rules.sameSize!==(input.replacementConsent!==undefined))throw new AppError('replacement_consent_required',409);
  }
  const replacement=input.replacementConsent!==undefined;
  if(replacement&&(env.CONFIRMED_REPLACE_ENABLED!=='true'||input.replacementConsent?.target!==folder+name||input.replacementConsent?.policy!=='replace-exact-target-even-if-changed'))throw new AppError('replacement_consent_required',409);
  const due=berlinInstant(input.localTime);
  if(!Number.isSafeInteger(input.size)||input.size<=0||input.size>maxFile(env))throw new AppError('file_too_large',413);
  if(typeof input.sha256!=='string'||!/^[0-9a-f]{64}$/.test(input.sha256)||typeof input.key!=='string'||!/^[a-zA-Z0-9-]{20,80}$/.test(input.key))throw new AppError('invalid_request');
  const existing=await env.DB.prepare('SELECT * FROM jobs WHERE school_id=? AND owner_id=? AND idempotency_key=?').bind(p.school,p.owner,input.key).first<Job>();
  const version2=input.planningVersion===2||input.planningVersion===3;
  const quoteStorage=version2?await rt.storage(p.school,p.owner):null;
  const quote=version2?await readNamingQuote(env,p,input,quoteStorage?.accountIdentity||null,rt.now(),Boolean(existing)):null;
  if(version2&&(collisionRules||replacement!==(quote!.plan.naming==='replace-v1')))throw new AppError('replacement_consent_required',409);
  const numbered=quote?.plan.naming==='numbered-v1';
  if(numbered&&(input.numberingConsent?.policy!==NUMBERING_POLICY||input.numberingConsent?.folder!==folder||input.numberingConsent?.filename!==name)||!numbered&&input.numberingConsent!==undefined)throw new AppError('numbering_consent_required',409);
  const fingerprint=sha256(JSON.stringify([name,folder,due,input.size,input.sha256,...(collisionRules?[collisionRules]:[]),...(quote?[input.planningVersion,quote.plan.naming,quote.target,replacement?'replace-exact-target-even-if-changed':numbered?NUMBERING_POLICY:null,sha256(input.namingQuote)]:[])]));
  if(existing){if(existing.fingerprint!==fingerprint)throw new AppError('idempotency_conflict',409);const d=await payload(env,existing);requireTargetPolicy(env,d);if(input.expectedNaming!==undefined&&input.expectedNaming!==(d.targetNaming||'original'))throw new AppError('folder_policy_changed',409);if(d.accountIdentity)requireAccountIdentity(d,await rt.storage(p.school,p.owner));return existing;}
  if(env.REQUIRE_NAMING_QUOTE==='true'&&!version2)throw new AppError('planning_reload_required',409);
  if(version2&&quote!.expiresAt<=rt.now())throw new AppError('naming_quote_expired',409);
  if(due<=rt.now()+30000||due>rt.now()+366*86400000)throw new AppError('time_out_of_range');
  await authorizeUntil(env,p.school,p.owner,due);
  const count=await env.DB.prepare("SELECT count(*) AS n FROM jobs WHERE school_id=? AND owner_id=? AND status IN ('scheduled','preparing','publishing','retry_wait','reconciling')").bind(p.school,p.owner).first<{n:number}>();
  if(count&&count.n>=(env.VAULT_OBJECTS?40:100))throw new AppError('job_limit',429);
  if(env.VAULT_OBJECTS){
    // Accepted creations count even after cancellation: repeated upload/delete must not exhaust shared Free quotas.
    const start=Math.floor(rt.now()/86400000)*86400000;
    const daily=await env.DB.prepare('SELECT COUNT(*) AS n FROM jobs WHERE school_id=? AND owner_id=? AND created_at>=?').bind(p.school,p.owner,start).first<{n:number}>();
    if(daily&&daily.n>=20)throw new AppError('daily_job_limit',429);
  }
  const storage=quoteStorage||await rt.storage(p.school,p.owner);
  if(!await storage.canWrite(folder))throw new AppError('folder_read_only',403);
  const original=!version2&&!replacement&&env.ORIGINAL_MOVE_APPROVED==='true'&&Boolean(await storage.originalNameReady?.(folder));
  const naming=quote?quote.plan.naming:replacement?'replace-v1':original?'original-move-v1':env.TARGET_NAMING==='unique-v1'?'unique-v1':'original';
  if(input.expectedNaming!==undefined&&input.expectedNaming!==naming)throw new AppError('folder_policy_changed',409);
  if((original||replacement)&&new TextEncoder().encode(name).length>240)throw new AppError('invalid_filename');
  if(numbered&&(!storage.renameNumbered||!rt.vault||!rt.numberingLock))throw new AppError('numbering_unavailable',409);
  if(replacement&&(!storage.renameReplacing||!rt.vault))throw new AppError('replacement_unavailable',409);
  const nonce=quote?quote.nonce:env.TARGET_NAMING==='unique-v1'||original||replacement?publicationNonce():undefined;
  let target:string;try{target=quote?quote.target:folder+(!original&&!replacement&&nonce?publicationName(name,nonce):name);}catch{throw new AppError('invalid_filename');}
  if(!replacement&&!numbered&&await storage.stat(target))throw new AppError('conflict',409);
  const id=random(),now=rt.now();const source=rt.vault?rt.vault(p.school,p.owner).key(id):(demoAllowed(env)?DEMO_PRIVATE:env.PRIVATE_ROOT!.replace(/\/$/,'')+'/')+id;
  const data:Payload={filename:name,folder,source,target,size:input.size,sha256:input.sha256,localTime:input.localTime,writeVerifiedAtPlan:true,...(collisionRules?{collisionRules}:{}),...(storage.accountIdentity?{accountIdentity:storage.accountIdentity}:{}),...(nonce?{targetNaming:original?'original-move-v1' as const:'unique-v1' as const,targetNonce:nonce}:{}),...(original?{temporaryTarget:folder+temporaryPublicationName(nonce!),originalMoveVerifiedAtPlan:true}:{}),...(numbered?{targetNaming:'numbered-v1' as const,temporaryTarget:folder+temporaryPublicationName(nonce!),numberingPolicy:NUMBERING_POLICY,numberingAcceptedAt:now}:{}),...(replacement?{targetNaming:'replace-v1' as const,temporaryTarget:folder+temporaryPublicationName(nonce!),replacementConsentTarget:target,replacementAcceptedAt:now}:{})};
  const encrypted=await seal(env,jobContext({school_id:p.school,owner_id:p.owner,id}),data);
  const targetKey=replacement?replacementKey(env,p.school,target):null;
  await env.DB.prepare("INSERT OR IGNORE INTO jobs(school_id,owner_id,id,idempotency_key,fingerprint,payload,status,due_at,next_attempt_at,created_at,updated_at,replacement_key) VALUES(?,?,?,?,?,?,'preparing',?,?,?,?,?)")
    .bind(p.school,p.owner,id,input.key,fingerprint,encrypted,due,due,now,now,targetKey).run();
  const result=await env.DB.prepare('SELECT * FROM jobs WHERE school_id=? AND owner_id=? AND idempotency_key=?').bind(p.school,p.owner,input.key).first<Job>();
  if(!result&&targetKey&&await env.DB.prepare('SELECT id FROM jobs WHERE school_id=? AND owner_id=? AND replacement_key=? AND status IN (\'preparing\',\'scheduled\',\'publishing\',\'retry_wait\',\'reconciling\',\'needs_auth\',\'needs_review\')').bind(p.school,p.owner,targetKey).first())throw new AppError('replacement_already_planned',409);
  if(!result||result.fingerprint!==fingerprint)throw new AppError('idempotency_conflict',409);
  if((await payload(env,result)).targetNaming!==(data.targetNaming))throw new AppError('folder_policy_changed',409);
  return result;
}
export async function upload(env:Env,p:Principal,id:string,body:Uint8Array,rt:Runtime){
  let job=await ownJob(env,p,id);const data=await payload(env,job);
  requireTargetPolicy(env,data);
  if(data.accountIdentity)requireAccountIdentity(data,await rt.storage(p.school,p.owner));
  if(body.length!==data.size||sha256(body)!==data.sha256)throw new AppError('file_changed',409);
  if(job.status==='scheduled')return job;
  if(job.status!=='preparing')throw new AppError('job_changed',409);
  const lease=random();const result=await env.DB.prepare("UPDATE jobs SET lease_token=?,lease_until=?,revision=revision+1 WHERE school_id=? AND owner_id=? AND id=? AND status='preparing' AND (lease_until IS NULL OR lease_until<?)")
    .bind(lease,rt.now()+180000,p.school,p.owner,id,rt.now()).run();
  if(!result.meta.changes)throw new AppError('upload_running',409);
  try{
    const storage=await rt.storage(p.school,p.owner);
    if(!await storage.canWrite(data.folder))throw new AppError('folder_read_only',403);
    let sourceEtag:string;
    if(rt.vault){
      sourceEtag=(await rt.vault(p.school,p.owner).put(data.source,body,data)).etag;
    }else{
      const existing=await storage.inspect(data.source);
      if(!existing){try{await storage.put(data.source,body);}catch(error){if(!(error instanceof DavError)||error.httpStatus!==412)throw error;}}
      const check=await storage.inspect(data.source);
      if(!check||check.size!==data.size||check.sha256!==data.sha256||!/^"[^"\r\n]+"$/.test(check.etag))throw new AppError('staging_unverified',409);
      sourceEtag=check.etag;
    }
    if(job.due_at<=rt.now()+1000)throw new AppError('time_elapsed',409);
    const committed=await env.DB.prepare("UPDATE jobs SET status='scheduled',staging_etag=?,lease_token=NULL,lease_until=NULL,revision=revision+1,updated_at=?,error_code=NULL WHERE school_id=? AND owner_id=? AND id=? AND status='preparing' AND lease_token=?")
      .bind(sourceEtag,rt.now(),p.school,p.owner,id,lease).run();
    if(!committed.meta.changes)throw new AppError('job_changed',409);
    return ownJob(env,p,id);
  }catch(error){
    // Keep an interrupted preparation recoverable. Its private object is never published.
    await env.DB.prepare("UPDATE jobs SET lease_token=NULL,lease_until=NULL,error_code=?,updated_at=? WHERE school_id=? AND owner_id=? AND id=? AND status='preparing' AND lease_token=?")
      .bind(error instanceof AppError?error.code:'connection_failed',rt.now(),p.school,p.owner,id,lease).run();throw error;
  }
}
export async function changeJob(env:Env,p:Principal,id:string,input:any,rt:Runtime){
  const job=await ownJob(env,p,id);
  if(!Number.isSafeInteger(input.revision))throw new AppError('invalid_request');
  if(input.action==='cancel'){
    const update=await env.DB.prepare("UPDATE jobs SET status='cancelled',revision=revision+1,updated_at=? WHERE school_id=? AND owner_id=? AND id=? AND revision=? AND status IN ('preparing','scheduled','retry_wait','needs_auth','failed','conflict','needs_review') AND operation_started_at IS NULL AND (lease_until IS NULL OR lease_until<?)")
      .bind(rt.now(),p.school,p.owner,id,input.revision,rt.now()).run();
    if(!update.meta.changes)throw new AppError('job_changed',409);
    try{const d=await payload(env,job);
      if(rt.vault){await rt.vault(p.school,p.owner).remove(d.source);await env.DB.prepare('UPDATE jobs SET source_cleaned_at=? WHERE school_id=? AND owner_id=? AND id=?').bind(rt.now(),p.school,p.owner,id).run();}
      else{const storage=await rt.storage(p.school,p.owner);const file=await storage.inspect(d.source);
        if(file&&file.sha256===d.sha256&&file.etag===job.staging_etag)await storage.remove(d.source,file.etag);}
    }catch{await env.DB.prepare("UPDATE jobs SET error_code='cleanup_pending' WHERE school_id=? AND owner_id=? AND id=? AND status='cancelled'").bind(p.school,p.owner,id).run();}
  }else if(input.action==='reconcile'){
    const d=await payload(env,job);requireAccountIdentity(d,await rt.storage(p.school,p.owner));
    const update=await env.DB.prepare("UPDATE jobs SET status='reconciling',error_code='result_uncertain',manual_read_only=1,next_attempt_at=?,updated_at=?,revision=revision+1 WHERE school_id=? AND owner_id=? AND id=? AND revision=? AND status IN ('needs_auth','needs_review') AND operation_started_at IS NOT NULL AND (lease_until IS NULL OR lease_until<?)").bind(rt.now(),rt.now(),p.school,p.owner,id,input.revision,rt.now()).run();
    if(!update.meta.changes)throw new AppError('job_changed',409);
  }else if(input.action==='reschedule'){
    const due=berlinInstant(input.localTime);if(due<=rt.now()+30000||due>rt.now()+366*86400000)throw new AppError('time_out_of_range');
    await authorizeUntil(env,p.school,p.owner,due);
    const d=await payload(env,job);requireTargetPolicy(env,d);if(d.accountIdentity)requireAccountIdentity(d,await rt.storage(p.school,p.owner));
    if(d.targetNaming==='replace-v1'&&await env.DB.prepare("SELECT id FROM jobs WHERE school_id=? AND owner_id=? AND replacement_key=? AND id<>? AND status IN ('preparing','scheduled','publishing','retry_wait','reconciling','needs_auth','needs_review')").bind(p.school,p.owner,replacementKey(env,p.school,d.target),job.id).first())throw new AppError('replacement_already_planned',409);
    if(rt.vault){if(!job.staging_etag||job.source_cleaned_at)throw new AppError('source_missing',409);await rt.vault(p.school,p.owner).read(d.source,d,job.staging_etag);}
    d.localTime=input.localTime;const encrypted=await seal(env,jobContext(job),d);
    const update=await env.DB.prepare("UPDATE jobs SET status='scheduled',error_code=NULL,due_at=?,next_attempt_at=?,payload=?,revision=revision+1,updated_at=? WHERE school_id=? AND owner_id=? AND id=? AND revision=? AND status IN ('scheduled','retry_wait','needs_auth','failed','conflict') AND staging_etag IS NOT NULL AND source_cleaned_at IS NULL AND operation_started_at IS NULL")
      .bind(due,due,encrypted,rt.now(),p.school,p.owner,id,input.revision).run();
    if(!update.meta.changes)throw new AppError('job_changed',409);
  }else throw new AppError('invalid_request');
  return ownJob(env,p,id);
}
export async function cleanupVaultSources(env:Env,rt:Runtime){
  if(!rt.vault)return;
  const now=rt.now();
  const {results}=await env.DB.prepare("SELECT * FROM jobs WHERE school_id=? AND source_cleaned_at IS NULL AND (status IN ('published','cancelled') OR (status IN ('failed','conflict','needs_review','needs_auth') AND updated_at<?)) LIMIT 10").bind(env.SCHOOL_ID,now-7*86400000).all<Job>();
  for(const job of results){try{
    const data=await payload(env,job);await rt.vault(job.school_id,job.owner_id).remove(data.source);
    await env.DB.prepare("UPDATE jobs SET source_cleaned_at=?,error_code=CASE WHEN error_code='cleanup_pending' THEN NULL ELSE error_code END WHERE school_id=? AND owner_id=? AND id=?").bind(now,job.school_id,job.owner_id,job.id).run();
  }catch{
    // Keep verified success, but expose failed retention cleanup instead of losing it silently.
    await env.DB.prepare("UPDATE jobs SET error_code='cleanup_pending' WHERE school_id=? AND owner_id=? AND id=? AND status IN ('published','cancelled')").bind(job.school_id,job.owner_id,job.id).run();
  }}
}
export async function finish(env:Env,job:Job,status:Status,code:string|null,now:number,next=now,clearIntent=false){
  const params=[job.school_id,job.owner_id,job.id,job.lease_token];
  await env.DB.batch([
    env.DB.prepare('INSERT INTO attempts(id,school_id,owner_id,job_id,phase,at,code) SELECT ?,school_id,owner_id,id,?,?,? FROM jobs WHERE school_id=? AND owner_id=? AND id=? AND lease_token=?')
      .bind(random(),status,now,code,...params),
    env.DB.prepare('UPDATE jobs SET status=?,error_code=?,updated_at=?,next_attempt_at=?,revision=revision+1,lease_token=NULL,lease_until=NULL,confirmed_at=?,operation_started_at=CASE WHEN ? THEN NULL ELSE operation_started_at END WHERE school_id=? AND owner_id=? AND id=? AND lease_token=?')
      .bind(status,code,now,next,status==='published'?now:null,clearIntent?1:0,...params),
    env.DB.prepare("INSERT OR IGNORE INTO notifications(id,school_id,owner_id,job_id,revision,kind,created_at) SELECT ?,school_id,owner_id,id,revision,?,? FROM jobs WHERE school_id=? AND owner_id=? AND id=? AND updated_at=? AND status=? AND status NOT IN ('scheduled','preparing','publishing')")
      .bind(random(),status,now,job.school_id,job.owner_id,job.id,now,status)
  ]);
}
