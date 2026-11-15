import { DavError } from './dav.ts';
import { finish, payload, cleanupVaultSources, requireTargetPolicy, requireAccountIdentity } from './jobs.ts';
import { AppError, random, requireExecution } from './security.ts';
import type { Env, Job, Runtime } from './types.ts';
import { purgeExpiredAccountPasswords } from './connection-policy.ts';
import {purgeFolderProofs} from './folder-proof.ts';
import {purgeHistory} from './maintenance.ts';
import {executeNumbered,promoteNumbered} from './numbered-publication.ts';
import {executeOriginal,reconcileOriginal} from './original-publication.ts';

const BACKOFF=[60000,120000,300000,900000,1800000,3600000];
async function retry(env:Env,j:Job,code:string,rt:Runtime){
  const now=rt.now();if(now-j.due_at>=86400000){await finish(env,j,'failed','retry_expired',now);return;}
  await finish(env,j,'retry_wait',code,now,now+BACKOFF[Math.min(j.attempts-1,BACKOFF.length-1)]+Math.floor(Math.random()*5000),true);
}
async function execute(env:Env,j:Job,rt:Runtime){
  let intent=false,publicationClaim:string|null=null,sourceKey:string|undefined;
  try{
    const data=await payload(env,j);
    // Switching naming policy never silently authorizes an older job with a fixed target.
    requireTargetPolicy(env,data,data.targetNaming==='numbered-v1');
    const storage=await rt.storage(j.school_id,j.owner_id);
    requireAccountIdentity(data,storage);
    if(data.targetNaming==='numbered-v1'&&rt.vault){const receipt=await rt.vault(j.school_id,j.owner_id).numberedState?.(data.source);if(receipt&&!receipt.rejected){await promoteNumbered(env,j,data,storage,rt);return;}requireTargetPolicy(env,data);}
    sourceKey=data.source;
    const access=storage.folderAccess?await storage.folderAccess(data.folder):null;
    // Expiry of a planning-time proof is not evidence of a revocation. For an already
    // admitted job, the authenticated PUT enforces the current server permission.
    // An explicit read-only response still stops before sending the file.
    const eligible=access?access.writable||access.permission==='unknown'&&data.writeVerifiedAtPlan===true:await storage.canWrite(data.folder);
    if(!eligible){await finish(env,j,'failed','folder_read_only',rt.now());return;}
    let sourceBody:Uint8Array|undefined,sourceEtag:string;
    if(rt.vault){
      if(!j.staging_etag||!storage.publish)throw new AppError('setup_required',503);
      const source=await rt.vault(j.school_id,j.owner_id).read(data.source,data,j.staging_etag);sourceBody=source.body;sourceEtag=source.etag;
    }else{
      const source=await storage.inspect(data.source);
      if(!source){await finish(env,j,'failed','source_missing',rt.now());return;}
      if(source.sha256!==data.sha256||source.size!==data.size||source.etag!==j.staging_etag){await finish(env,j,'needs_review','source_changed',rt.now());return;}
      sourceEtag=source.etag;
    }
    if(data.targetNaming==='numbered-v1'){if(!sourceBody)throw new AppError('setup_required',503);await executeNumbered(env,j,data,storage,rt,sourceBody);return;}
    if(data.targetNaming==='original-move-v1'||data.targetNaming==='replace-v1'){
      if(!sourceBody)throw new AppError('setup_required',503);
      await executeOriginal(env,j,data,storage,rt,sourceBody);return;
    }
    if(await storage.stat(data.target)){await finish(env,j,'conflict','conflict',rt.now());return;}
    const now=rt.now();
    const marked=await env.DB.prepare("UPDATE jobs SET operation_started_at=?,updated_at=? WHERE school_id=? AND owner_id=? AND id=? AND status='publishing' AND lease_token=? AND lease_until>? AND due_at<=? AND operation_started_at IS NULL")
      .bind(now,now,j.school_id,j.owner_id,j.id,j.lease_token,now,now).run();
    if(!marked.meta.changes)return;
    intent=true;
    if(rt.vault){
      const vault=rt.vault(j.school_id,j.owner_id);if(!vault.claim)throw new AppError('setup_required',503);
      publicationClaim=await vault.claim(data.source);
      if(publicationClaim===null){await finish(env,j,'reconciling','result_uncertain',rt.now(),rt.now());return;}
    }
    if(sourceBody)await storage.publish!(data.target,sourceBody);else await storage.move(data.source,data.target,sourceEtag);
    const target=await storage.inspect(data.target);const remaining=rt.vault?null:await storage.stat(data.source);
    if(!target||target.sha256!==data.sha256||target.size!==data.size||remaining){await finish(env,j,'needs_review','target_unverified',rt.now());return;}
    await finish(env,j,'published',null,rt.now());
  }catch(error){
    const now=rt.now();const code=error instanceof AppError?error.code:'connection_failed';
    if(intent){
      if(error instanceof DavError&&!error.uncertain){
        if(rt.vault&&publicationClaim!==null&&sourceKey){const vault=rt.vault(j.school_id,j.owner_id);if(!vault.reject)throw new AppError('result_uncertain',409);await vault.reject(sourceKey,publicationClaim,error.httpStatus);}
        if([423,429].includes(error.httpStatus))await retry(env,j,code,rt);
        else await finish(env,j,error.httpStatus===401?'needs_auth':error.httpStatus===412?(rt.vault?'conflict':'needs_review'):'failed',error.httpStatus===412?(rt.vault?'conflict':'condition_failed'):code,now,now,true);
      }else await finish(env,j,'reconciling','result_uncertain',now,now+60000);
    }else if(code==='source_changed')await finish(env,j,'needs_review',code,now);
    else if(code==='needs_auth'||code==='account_changed')await finish(env,j,'needs_auth',code,now);
    else if(error instanceof DavError&&[0,423,429,500,502,503,504].includes(error.httpStatus))await retry(env,j,code,rt);
    else await finish(env,j,'failed',code,now);
  }
}
async function reconcile(env:Env,j:Job,rt:Runtime){
  try{
    const d=await payload(env,j),storage=await rt.storage(j.school_id,j.owner_id);
    requireAccountIdentity(d,storage);
    if(d.targetNaming==='numbered-v1'){requireTargetPolicy(env,d,true);await promoteNumbered(env,j,d,storage,rt);return;}
    if(d.targetNaming==='original-move-v1'||d.targetNaming==='replace-v1'){requireTargetPolicy(env,d,true);await reconcileOriginal(env,j,d,storage,rt);return;}
    const target=await storage.inspect(d.target),source=rt.vault?null:await storage.stat(d.source);
    if(target&&target.sha256===d.sha256&&target.size===d.size&&!source)await finish(env,j,'published','reconciled',rt.now());
    else await finish(env,j,'needs_review','result_uncertain',rt.now());
  }catch(error){
    if(error instanceof AppError&&error.code==='account_changed'){await finish(env,j,'needs_auth',error.code,rt.now());return;}
    if(rt.now()-j.due_at>=86400000)await finish(env,j,'needs_review','result_uncertain',rt.now());
    else await finish(env,j,'reconciling',error instanceof AppError?error.code:'connection_failed',rt.now(),rt.now()+300000);
  }
}
export async function tick(env:Env,rt:Runtime){
  // Retention continues even while publication itself is disabled.
  await purgeExpiredAccountPasswords(env,rt.now());
  await purgeFolderProofs(env,rt.now());
  await purgeHistory(env,rt.now());
  requireExecution(env);const now=rt.now();
  await env.DB.prepare('INSERT OR REPLACE INTO system_state(key,value) VALUES(?,?)').bind('cron_started',String(now)).run();
  // Expired leases are not proof that an HTTP operation failed to execute.
  await env.DB.prepare("UPDATE jobs SET status=CASE WHEN operation_started_at IS NULL THEN 'retry_wait' ELSE 'reconciling' END,lease_token=NULL,lease_until=NULL,next_attempt_at=?,revision=revision+1,error_code='interrupted',updated_at=? WHERE school_id=? AND status='publishing' AND lease_until<?")
    .bind(now,now,env.SCHOOL_ID,now).run();
  await env.DB.prepare("UPDATE jobs SET status='failed',error_code='preparation_expired',updated_at=?,revision=revision+1 WHERE school_id=? AND status='preparing' AND created_at<? AND (lease_until IS NULL OR lease_until<?)").bind(now,env.SCHOOL_ID,now-86400000,now).run();
  const {results}=await env.DB.prepare("SELECT * FROM jobs WHERE school_id=? AND status IN ('scheduled','retry_wait','reconciling') AND next_attempt_at<=? AND due_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY next_attempt_at LIMIT 4").bind(env.SCHOOL_ID,now,now,now).all<Job>();
  // Two bounded runners; never an unbounded Promise.all over all pending jobs.
  async function run(candidate:Job){
    const lease=random(),time=rt.now();
    const job=await env.DB.prepare("UPDATE jobs SET status=CASE WHEN status='reconciling' THEN 'reconciling' ELSE 'publishing' END,lease_token=?,lease_until=?,attempts=attempts+1,revision=revision+1,updated_at=? WHERE school_id=? AND owner_id=? AND id=? AND revision=? AND status IN ('scheduled','retry_wait','reconciling') AND next_attempt_at<=? AND due_at<=? AND (lease_until IS NULL OR lease_until<?) RETURNING *")
      .bind(lease,time+180000,time,candidate.school_id,candidate.owner_id,candidate.id,candidate.revision,time,time,time).first<Job>();
    if(!job)return;
    if(job.status!=='reconciling'&&time-job.due_at>=86400000){await finish(env,job,'failed','retry_expired',time);return;}
    if(job.status==='reconciling')await reconcile(env,job,rt);else await execute(env,job,rt);
  }
  for(let i=0;i<results.length;i+=2)await Promise.all(results.slice(i,i+2).map(run));
  await env.DB.prepare('INSERT OR REPLACE INTO system_state(key,value) VALUES(?,?)').bind('cron_finished',String(rt.now())).run();
  await env.DB.prepare('DELETE FROM sessions WHERE school_id=? AND expires_at<?').bind(env.SCHOOL_ID,rt.now()).run();
  await env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<?').bind(rt.now()).run();
  await cleanupVaultSources(env,rt);
}
