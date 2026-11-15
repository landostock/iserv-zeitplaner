import {identityOrigin,relyingPartyId,legacyRelyingPartyId,legacyPasskeysAvailable} from './public-origin.ts';
import {generateAuthenticationOptions,generateRegistrationOptions,verifyAuthenticationResponse,verifyRegistrationResponse} from '@simplewebauthn/server';
import type {AuthenticatorTransport} from '@simplewebauthn/server';
import {AppError,sha256,random,readLimited} from './security.ts';
import {sameOrigin,session,csrf,loginSession} from './auth.ts';
import {accountLabel,activeAccount,consumeStepUp,validInvitation} from './account-security.ts';
import type {Account} from './account-security.ts';
import type {Env} from './types.ts';

interface Flow {kind:'register'|'login';challenge:string;rpID?:string;subject?:string;owner?:string;handle?:string;name?:string;label?:string;sessionBinding?:string;bootstrap?:string;inviteHash?:string;recoveryHash?:string;stepUp?:boolean;scope?:'add-key'|'manage-account'|'verify-domain';}
const cookieName='__Host-zeitplaner_passkey_flow';
const cookie=(value:string,seconds:number)=>cookieName+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+seconds;
export function passkeyReady(env:Env){
 try{return env.AUTH_MODE==='passkey'&&env.MODE==='production'&&new URL(env.APP_ORIGIN).protocol==='https:'&&/^[a-f0-9]{64}$/.test(env.PASSKEY_BOOTSTRAP_HASH||'')&&Boolean(env.VAULT_KEY);}catch{return false;}
}
async function data(request:Request){
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new AppError('invalid_request',415);
 try{return JSON.parse(new TextDecoder().decode(await readLimited(request,24000)));}catch(error){if(error instanceof AppError)throw error;throw new AppError('invalid_request');}
}
async function saveFlow(env:Env,flow:Flow,options:unknown){
 const browser=random();await env.DB.prepare('DELETE FROM passkey_flows WHERE expires_at<=?').bind(Date.now()).run();
 await env.DB.prepare('INSERT INTO passkey_flows(browser_hash,payload,expires_at) VALUES(?,?,?)').bind(sha256(browser),JSON.stringify(flow),Date.now()+300000).run();
 return Response.json({options},{headers:{'Set-Cookie':cookie(browser,300),'Cache-Control':'no-store'}});
}
async function takeFlow(env:Env,request:Request,kind:Flow['kind']){
 const token=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 if(!token||!/^[a-f0-9-]{36}$/.test(token))throw new AppError('passkey_expired',401);
 const row=await env.DB.prepare('DELETE FROM passkey_flows WHERE browser_hash=? AND expires_at>? RETURNING payload').bind(sha256(token),Date.now()).first<{payload:string}>();
 if(!row)throw new AppError('passkey_expired',401);const flow=JSON.parse(row.payload)as Flow;
 if(flow.kind!==kind)throw new AppError('passkey_expired',401);return flow;
}
async function bootstrapAvailable(env:Env,invite:unknown){
 if(typeof invite!=='string'||!(/^[a-f0-9]{64}$/).test(invite)||sha256(invite)!==env.PASSKEY_BOOTSTRAP_HASH)throw new AppError('invitation_invalid',403);
 if(await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('passkey-bootstrap:'+env.PASSKEY_BOOTSTRAP_HASH).first())throw new AppError('invitation_invalid',403);
 return env.PASSKEY_BOOTSTRAP_HASH!;
}
function admission(env:Env,f:Flow){
 if(f.inviteHash)return {sql:"EXISTS(SELECT 1 FROM account_invitations i JOIN passkey_accounts a ON a.school_id=i.school_id AND a.owner_id=i.created_by WHERE i.token_hash=? AND i.school_id=? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? AND a.active=1 AND a.deleted_at IS NULL AND a.role='admin') AND (SELECT COUNT(*) FROM passkey_accounts WHERE school_id=? AND deleted_at IS NULL)<5",args:[f.inviteHash,env.SCHOOL_ID,Date.now(),env.SCHOOL_ID]};
 return {sql:'NOT EXISTS(SELECT 1 FROM system_state WHERE key=?) AND (SELECT COUNT(*) FROM passkey_accounts WHERE school_id=? AND deleted_at IS NULL)<5',args:['passkey-bootstrap:'+f.bootstrap,env.SCHOOL_ID]};
}
function flowDomain(env:Env,flow:Flow){
 const id=flow.rpID||legacyRelyingPartyId(env);
 if(id!==relyingPartyId(env)&&!(legacyPasskeysAvailable(env)&&id===legacyRelyingPartyId(env)))throw new AppError('passkey_expired',401);
 return id;
}
/** App identities only. No IServ password or biometric data is received by these routes. */
export async function passkeyRoute(env:Env,request:Request):Promise<Response>{
 if(!passkeyReady(env))throw new AppError('setup_required',503);
 sameOrigin(env,request);if(request.method!=='POST')throw new AppError('not_found',404);
 const input=await data(request);if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('invalid_request');
 const path=new URL(request.url).pathname,rpID=relyingPartyId(env),legacyRP=legacyRelyingPartyId(env);
 if(path==='/auth/passkey/register/options'||path==='/auth/passkey/recover/options'){
  const p=await session(env,request);let account:Account|null=null,bootstrap:string|undefined,inviteHash:string|undefined,recoveryHash:string|undefined;
  if(path.endsWith('/recover/options')){
   const code=typeof input.recoveryCode==='string'?input.recoveryCode.replace(/[-\s]/g,'').toLowerCase():'';
   if(!/^[a-f0-9]{64}$/.test(code))throw new AppError('recovery_invalid',403);
   account=await env.DB.prepare('SELECT a.* FROM account_recovery r JOIN passkey_accounts a ON a.school_id=r.school_id AND a.owner_id=r.owner_id WHERE r.school_id=? AND r.token_hash=? AND a.active=1 AND a.deleted_at IS NULL').bind(env.SCHOOL_ID,sha256(code)).first<Account>();
   if(!account)throw new AppError('recovery_invalid',403);recoveryHash=sha256(code);
  }else if(p){
   csrf(env,request,p);if(input.invite)throw new AppError('invitation_requires_logout',409);
   account=await activeAccount(env,p);await consumeStepUp(env,p,input.stepUp,'add-key');
  }else{
   inviteHash=await validInvitation(env,input.invite)||undefined;
   if(!inviteHash)bootstrap=await bootstrapAvailable(env,input.invite);
  }
  const subject=account?.subject||random(),owner=account?.owner_id||sha256(identityOrigin(env)+':'+subject),handle=account?.handle||Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const name=account?.name||accountLabel(input.name);if(!name)throw new AppError('invalid_request');
  const keys=await env.DB.prepare('SELECT id,transports FROM passkey_credentials WHERE school_id=? AND owner_id=? AND COALESCE(rp_id,?)=?').bind(env.SCHOOL_ID,owner,legacyRP,rpID).all<{id:string;transports:string}>();
  if(!recoveryHash&&keys.results.length>=5)throw new AppError('passkey_limit',409);
  const options=await generateRegistrationOptions({rpName:'IServ Zeitplaner',rpID,userID:Uint8Array.from(Buffer.from(handle,'base64url')),userName:name,userDisplayName:name,attestationType:'none',supportedAlgorithmIDs:[-7,-257],authenticatorSelection:{residentKey:'required',userVerification:'required'},excludeCredentials:recoveryHash?[]:keys.results.map(k=>({id:k.id,transports:JSON.parse(k.transports)}))});
  return saveFlow(env,{kind:'register',challenge:options.challenge,rpID,subject,owner,handle,name,label:accountLabel(input.label,'Passkey'),sessionBinding:p&&!recoveryHash?sha256(p.csrf):undefined,bootstrap,inviteHash,recoveryHash},options);
 }
 if(path==='/auth/passkey/register/verify'||path==='/auth/passkey/recover/verify'){
  const flow=await takeFlow(env,request,'register'),registrationRP=flowDomain(env,flow);
  if(Boolean(flow.recoveryHash)!==path.endsWith('/recover/verify'))throw new AppError('passkey_expired',401);
  if(flow.bootstrap){if(flow.bootstrap!==env.PASSKEY_BOOTSTRAP_HASH)throw new AppError('invitation_invalid',403);}
  else if(!flow.inviteHash&&!flow.recoveryHash){const p=await session(env,request);if(!p||p.owner!==flow.owner||flow.sessionBinding!==sha256(p.csrf))throw new AppError('login_required',401);csrf(env,request,p);await activeAccount(env,p);}
  let checked;try{checked=await verifyRegistrationResponse({response:input.response,expectedChallenge:flow.challenge,expectedOrigin:env.APP_ORIGIN,expectedRPID:registrationRP,supportedAlgorithmIDs:[-7,-257],requireUserVerification:true});}catch{throw new AppError('passkey_failed',401);}
  if(!checked.verified||!checked.registrationInfo)throw new AppError('passkey_failed',401);
  const credential=checked.registrationInfo.credential,at=Date.now(),batch=[];
  if(flow.bootstrap||flow.inviteHash){
   const guard=admission(env,flow);
   batch.push(env.DB.prepare('INSERT INTO users(school_id,id,subject,name) SELECT ?,?,?,? WHERE '+guard.sql).bind(env.SCHOOL_ID,flow.owner!,flow.subject!,flow.name!,...guard.args));
   batch.push(env.DB.prepare('INSERT INTO passkey_accounts(school_id,owner_id,subject,handle,name,created_at,role) SELECT school_id,id,subject,?,?,?,? FROM users WHERE school_id=? AND id=? AND subject=? AND '+guard.sql).bind(flow.handle!,flow.name!,at,flow.bootstrap?'admin':'member',env.SCHOOL_ID,flow.owner!,flow.subject!,...guard.args));
  }
  if(flow.recoveryHash){
   const guard='EXISTS(SELECT 1 FROM account_recovery r JOIN passkey_accounts a ON a.school_id=r.school_id AND a.owner_id=r.owner_id WHERE r.school_id=? AND r.owner_id=? AND r.token_hash=? AND a.active=1 AND a.deleted_at IS NULL)';
   const args=[env.SCHOOL_ID,flow.owner!,flow.recoveryHash];
   batch.push(env.DB.prepare("DELETE FROM passkey_flows WHERE json_extract(payload,'$.owner')=? AND "+guard).bind(flow.owner!,...args));
   batch.push(env.DB.prepare("DELETE FROM system_state WHERE key LIKE 'passkey-stepup:%' AND json_extract(value,'$.owner')=? AND "+guard).bind(flow.owner!,...args));
   batch.push(env.DB.prepare('DELETE FROM sessions WHERE school_id=? AND owner_id=? AND '+guard).bind(env.SCHOOL_ID,flow.owner!,...args));
   batch.push(env.DB.prepare('DELETE FROM passkey_credentials WHERE school_id=? AND owner_id=? AND '+guard).bind(env.SCHOOL_ID,flow.owner!,...args));
  }
  const recoveryGuard=flow.recoveryHash?' AND EXISTS(SELECT 1 FROM account_recovery WHERE school_id=? AND owner_id=? AND token_hash=?)':'';
  batch.push(env.DB.prepare('INSERT INTO passkey_credentials(id,school_id,owner_id,public_key,counter,transports,created_at,label,rp_id,last_login_at) SELECT ?,school_id,owner_id,?,?,?,?,?,?,? FROM passkey_accounts WHERE school_id=? AND owner_id=? AND active=1 AND deleted_at IS NULL AND (SELECT COUNT(*) FROM passkey_credentials WHERE school_id=? AND owner_id=? AND COALESCE(rp_id,?)=?)<5'+recoveryGuard).bind(credential.id,Buffer.from(credential.publicKey).toString('base64url'),credential.counter,JSON.stringify(credential.transports||[]),at,flow.label||'Passkey',registrationRP,flow.bootstrap||flow.inviteHash||flow.recoveryHash?at:null,env.SCHOOL_ID,flow.owner!,env.SCHOOL_ID,flow.owner!,legacyRP,registrationRP,...(flow.recoveryHash?[env.SCHOOL_ID,flow.owner!,flow.recoveryHash]:[])));
  if(flow.bootstrap)batch.push(env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) SELECT ?,? FROM passkey_credentials WHERE id=? AND owner_id=?').bind('passkey-bootstrap:'+flow.bootstrap,String(at),credential.id,flow.owner!));
  if(flow.inviteHash)batch.push(env.DB.prepare('UPDATE account_invitations SET used_at=? WHERE token_hash=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM passkey_credentials WHERE id=? AND owner_id=?)').bind(at,flow.inviteHash,credential.id,flow.owner!));
  if(flow.recoveryHash)batch.push(env.DB.prepare('DELETE FROM account_recovery WHERE school_id=? AND owner_id=? AND token_hash=? AND EXISTS(SELECT 1 FROM passkey_credentials WHERE id=? AND owner_id=?)').bind(env.SCHOOL_ID,flow.owner!,flow.recoveryHash,credential.id,flow.owner!));
  await env.DB.batch(batch);
  const stored=await env.DB.prepare('SELECT id FROM passkey_credentials WHERE id=? AND school_id=? AND owner_id=?').bind(credential.id,env.SCHOOL_ID,flow.owner!).first();if(!stored)throw new AppError(flow.recoveryHash?'recovery_invalid':'invitation_invalid',403);
  return Response.json({ok:true,recovered:Boolean(flow.recoveryHash)},{headers:{'Set-Cookie':await loginSession(env,flow.subject!,flow.name!,credential.id),'Cache-Control':'no-store'}});
 }
 if(path==='/auth/passkey/login/options'){
  if(input.purpose!==undefined&&!['add-key','manage-account','verify-domain'].includes(input.purpose))throw new AppError('invalid_request');
  if(input.legacy!==undefined&&typeof input.legacy!=='boolean')throw new AppError('invalid_request');
  if(input.legacy&&!legacyPasskeysAvailable(env))throw new AppError('legacy_passkey_unavailable',409);
  let loginRP=input.legacy?legacyRP:rpID;
  let owner:string|undefined,sessionBinding:string|undefined,allowCredentials:{id:string}[]|undefined;
  if(input.purpose){
   const p=await session(env,request);if(!p)throw new AppError('login_required',401);csrf(env,request,p);await activeAccount(env,p);owner=p.owner;sessionBinding=sha256(p.csrf);
   const keys=(await env.DB.prepare('SELECT id,COALESCE(rp_id,?) AS rp_id,last_login_at FROM passkey_credentials WHERE school_id=? AND owner_id=?').bind(legacyRP,p.school,p.owner).all<{id:string;rp_id:string;last_login_at:number|null}>()).results;
   // A newly saved but untested key must not displace the working legacy key needed to repair it.
   if(input.purpose!=='verify-domain'&&input.legacy===undefined&&legacyPasskeysAvailable(env)&&keys.some(k=>k.rp_id===legacyRP)&&!keys.some(k=>k.rp_id===rpID&&k.last_login_at!==null))loginRP=legacyRP;
   if(input.purpose!=='verify-domain'&&!keys.some(k=>k.rp_id===loginRP)&&legacyPasskeysAvailable(env))loginRP=legacyRP;
   if(input.purpose==='verify-domain'&&loginRP!==rpID)throw new AppError('invalid_request');
   allowCredentials=keys.filter(k=>k.rp_id===loginRP).map(k=>({id:k.id}));
   if(!allowCredentials.length)throw new AppError('passkey_reauthenticate',401);
  }
  const options=await generateAuthenticationOptions({rpID:loginRP,userVerification:'required',allowCredentials});return saveFlow(env,{kind:'login',challenge:options.challenge,rpID:loginRP,owner,sessionBinding,stepUp:Boolean(input.purpose),scope:input.purpose},options);
 }
 if(path==='/auth/passkey/login/verify'){
  const flow=await takeFlow(env,request,'login'),loginRP=flowDomain(env,flow);
  if(flow.stepUp){const p=await session(env,request);if(!p||p.owner!==flow.owner||sha256(p.csrf)!==flow.sessionBinding)throw new AppError('login_required',401);csrf(env,request,p);await activeAccount(env,p);}
  const id=input.response?.id;if(typeof id!=='string'||id.length>1400)throw new AppError('passkey_failed',401);
  const row=await env.DB.prepare('SELECT c.*,a.subject,a.name,a.handle FROM passkey_credentials c JOIN passkey_accounts a ON a.school_id=c.school_id AND a.owner_id=c.owner_id WHERE c.id=? AND c.school_id=? AND a.active=1 AND a.deleted_at IS NULL').bind(id,env.SCHOOL_ID).first<{owner_id:string;public_key:string;counter:number;transports:string;subject:string;name:string;handle:string;rp_id:string|null}>();
  if(!row||(row.rp_id||legacyRP)!==loginRP||flow.stepUp&&row.owner_id!==flow.owner||input.response?.response?.userHandle&&input.response.response.userHandle!==row.handle)throw new AppError('passkey_failed',401);
  let checked;try{checked=await verifyAuthenticationResponse({response:input.response,expectedChallenge:flow.challenge,expectedOrigin:env.APP_ORIGIN,expectedRPID:loginRP,credential:{id,publicKey:Uint8Array.from(Buffer.from(row.public_key,'base64url')),counter:row.counter,transports:JSON.parse(row.transports)as AuthenticatorTransport[]},requireUserVerification:true});}catch{throw new AppError('passkey_failed',401);}
  if(!checked.verified)throw new AppError('passkey_failed',401);
  const at=Date.now();const updated=await env.DB.prepare('UPDATE passkey_credentials SET counter=?,last_used_at=?,last_login_at=CASE WHEN ? THEN ? ELSE last_login_at END WHERE id=? AND counter=? AND EXISTS(SELECT 1 FROM passkey_accounts WHERE school_id=? AND owner_id=? AND active=1 AND deleted_at IS NULL)').bind(checked.authenticationInfo.newCounter,at,flow.stepUp&&flow.scope!=='verify-domain'?0:1,at,id,row.counter,env.SCHOOL_ID,row.owner_id).run();if(!updated.meta.changes)throw new AppError('passkey_failed',401);
  if(flow.stepUp&&flow.scope!=='verify-domain'){const stepUp=random();await env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?)').bind('passkey-stepup:'+sha256(stepUp),JSON.stringify({owner:row.owner_id,credentialId:id,sessionBinding:flow.sessionBinding,scope:flow.scope||'add-key',expiresAt:Date.now()+120000})).run();return Response.json({ok:true,stepUp});}
  return Response.json({ok:true},{headers:{'Set-Cookie':await loginSession(env,row.subject,row.name,id)}});
 }
 throw new AppError('not_found',404);
}
