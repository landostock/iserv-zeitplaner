import { checkConnectionPolicy,connectionIdentity } from './connection-policy.ts';
import { AppError, demoAllowed, readLimited, seal, unseal } from './security.ts';
import { WebDav } from './dav.ts';
import type { ConnectionSecret, Env, Principal, Job } from './types.ts';
import {payload} from './jobs.ts';

export async function connectionStatus(env:Env,p:Principal){
  const r=await env.DB.prepare('SELECT active,credential_kind,discard_after,secret FROM connections WHERE school_id=? AND owner_id=?').bind(p.school,p.owner).first<{active:number;credential_kind:string;discard_after:number|null;secret:string}>();
  let username:string|null=null;
  if(r?.active&&(!r.discard_after||r.discard_after>Date.now())){const secret=await unseal<ConnectionSecret>(env,`connection:${p.school}:${p.owner}`,r.secret);if(secret.authorization.startsWith('Basic '))username=Buffer.from(secret.authorization.slice(6),'base64').toString('utf8').split(':',1)[0];}
  return {username,connected:demoAllowed(env)||Boolean(r?.active&&(!r.discard_after||r.discard_after>Date.now())),kind:demoAllowed(env)?'simulation':r?.credential_kind||null,expiresAt:r?.discard_after||null,storageAllowed:env.ALLOW_ACCOUNT_PASSWORD_STORAGE==='true',reviewId:env.ACCOUNT_PASSWORD_REVIEW_ID||null};
}
export async function connectAccount(env:Env,p:Principal,request:Request){
  if(demoAllowed(env)||env.ALLOW_ACCOUNT_PASSWORD_STORAGE!=='true'||!env.ACCOUNT_PASSWORD_REVIEW_ID)throw new AppError('credential_policy_required',409);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new AppError('invalid_request',415);
  let d:any;try{d=JSON.parse(new TextDecoder().decode(await readLimited(request,16000)));}catch{throw new AppError('invalid_request');}
  if(!d||d.consent!=='store-encrypted-account-password'||typeof d.username!=='string'||!d.username||d.username.length>200||/[:\x00-\x1f\x7f]/.test(d.username)||typeof d.password!=='string'||!d.password||d.password.length>2000)throw new AppError('invalid_request');
  const expiresAt=Date.now()+30*86400000;
  const secret:ConnectionSecret={kind:'account-password',authorization:'Basic '+Buffer.from(d.username+':'+d.password).toString('base64'),reviewId:env.ACCOUNT_PASSWORD_REVIEW_ID,expiresAt};
  d.password='';checkConnectionPolicy(env,secret);
  const dav=new WebDav(env.DAV_ORIGIN!,secret.authorization,env.GROUP_ROOT!,env.PRIVATE_ROOT!,1024);
  // Read-only verification of this account. No test file, no inferred write permission.
  await dav.readFolder(env.GROUP_ROOT!);
  const encrypted=await seal(env,`connection:${p.school}:${p.owner}`,secret);
  const identity=connectionIdentity(env,secret);
  const {results}=await env.DB.prepare("SELECT * FROM jobs WHERE school_id=? AND owner_id=? AND status IN ('preparing','scheduled','retry_wait') AND operation_started_at IS NULL").bind(p.school,p.owner).all<Job>();
  const changed:Job[]=[];for(const job of results){const d=await payload(env,job);if(d.accountIdentity&&d.accountIdentity!==identity)changed.push(job);}
  await env.DB.batch([
    env.DB.prepare("INSERT INTO connections(school_id,owner_id,secret,active,credential_kind,discard_after) VALUES(?,?,?,1,?,?) ON CONFLICT(school_id,owner_id) DO UPDATE SET secret=excluded.secret,active=1,credential_kind=excluded.credential_kind,discard_after=excluded.discard_after").bind(p.school,p.owner,encrypted,secret.kind,expiresAt),
    env.DB.prepare('DELETE FROM folder_proofs WHERE school_id=? AND owner_id=? AND connection_binding<>?').bind(p.school,p.owner,identity),
    env.DB.prepare('DELETE FROM original_name_proofs WHERE school_id=? AND owner_id=? AND connection_binding<>?').bind(p.school,p.owner,identity),
    ...changed.map(job=>env.DB.prepare("UPDATE jobs SET status='needs_auth',error_code='account_changed',revision=revision+1,updated_at=? WHERE school_id=? AND owner_id=? AND id=? AND operation_started_at IS NULL AND status IN ('preparing','scheduled','retry_wait')").bind(Date.now(),p.school,p.owner,job.id))
  ]);
  return connectionStatus(env,p);
}
export async function disconnectAccount(env:Env,p:Principal){
  await env.DB.prepare('DELETE FROM connections WHERE school_id=? AND owner_id=?').bind(p.school,p.owner).run();
  await env.DB.prepare('DELETE FROM folder_proofs WHERE school_id=? AND owner_id=?').bind(p.school,p.owner).run();
  await env.DB.prepare('DELETE FROM original_name_proofs WHERE school_id=? AND owner_id=?').bind(p.school,p.owner).run();
  await env.DB.prepare("UPDATE jobs SET status='needs_auth',error_code='needs_auth',revision=revision+1,updated_at=? WHERE school_id=? AND owner_id=? AND status IN ('scheduled','retry_wait') AND operation_started_at IS NULL").bind(Date.now(),p.school,p.owner).run();
}
