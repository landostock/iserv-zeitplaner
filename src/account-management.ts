import {AppError,sha256,readLimited} from './security.ts';
import {csrf,currentSessionHash,session} from './auth.ts';
import {activeAccount,consumeStepUp,accountLabel,accountToken} from './account-security.ts';
import type {Env,Principal} from './types.ts';
import {legacyRelyingPartyId,relyingPartyId} from './public-origin.ts';
import {domainMigration,personalDomainMigration} from './domain-migration.ts';
const json=(v:unknown)=>Response.json(v,{headers:{'Cache-Control':'no-store'}});
async function state(env:Env,p:Principal,request:Request){
 const currentPrincipal=await session(env,request);if(!currentPrincipal||currentPrincipal.owner!==p.owner||currentPrincipal.csrf!==p.csrf)throw new AppError('login_required',401);
 const a=await activeAccount(env,p),now=Date.now(),current=currentSessionHash(env,request);
 const keys=await env.DB.prepare('SELECT id,label,created_at,last_used_at,COALESCE(rp_id,?) AS domain,last_login_at FROM passkey_credentials WHERE school_id=? AND owner_id=? ORDER BY created_at').bind(legacyRelyingPartyId(env),p.school,p.owner).all();
 const sessions=await env.DB.prepare('SELECT s.token_hash AS id,s.created_at,s.expires_at,c.label FROM sessions s LEFT JOIN passkey_credentials c ON c.id=s.credential_id WHERE s.school_id=? AND s.owner_id=? AND s.expires_at>? ORDER BY s.created_at DESC LIMIT 20').bind(p.school,p.owner,now).all<{id:string;created_at:number|null;expires_at:number;label:string|null}>();
 const recovery=await env.DB.prepare('SELECT created_at FROM account_recovery WHERE school_id=? AND owner_id=?').bind(p.school,p.owner).first();
 let accounts:unknown[]=[],invitations:unknown[]=[];
 if(a.role==='admin'){
  accounts=(await env.DB.prepare('SELECT owner_id AS id,name,role,active,created_at FROM passkey_accounts WHERE school_id=? AND deleted_at IS NULL ORDER BY created_at').bind(p.school).all()).results;
  invitations=(await env.DB.prepare('SELECT token_hash AS id,label,created_at,expires_at FROM account_invitations WHERE school_id=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 5').bind(p.school,now).all()).results;
 }
 return {available:true,name:a.name,owner:p.owner,admin:a.role==='admin',keys:keys.results,sessions:sessions.results.map(s=>({...s,current:s.id===current})),recoveryReady:Boolean(recovery),recoveryCreatedAt:recovery?(recovery as any).created_at:null,accounts,invitations,domainMigration:await personalDomainMigration(env,p.owner),migrationSummary:a.role==='admin'?await domainMigration(env):null};
}
export async function accountRoute(env:Env,p:Principal,request:Request){
 if(env.AUTH_MODE!=='passkey'||env.MODE!=='production')throw new AppError('not_found',404);
 const url=new URL(request.url);
 if(url.pathname==='/api/account'&&request.method==='GET')return state(env,p,request).then(json);
 if(url.pathname!=='/api/account/manage'||request.method!=='POST')throw new AppError('not_found',404);
 csrf(env,request,p);if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new AppError('invalid_request',415);
 let input:any;try{input=JSON.parse(new TextDecoder().decode(await readLimited(request,4096)));}catch{throw new AppError('invalid_request');}
 if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('invalid_request');
 const currentPrincipal=await session(env,request);if(!currentPrincipal||currentPrincipal.owner!==p.owner||currentPrincipal.csrf!==p.csrf)throw new AppError('login_required',401);
 const a=await activeAccount(env,p),action=input.action,adminActions=['create-invite','revoke-invite','set-account-active','set-role'];
 if(!['rename-key','remove-key','revoke-session','logout-others','logout-all','rename-account','create-recovery','revoke-recovery','delete-account',...adminActions].includes(action))throw new AppError('invalid_request');
 if(adminActions.includes(action)&&a.role!=='admin')throw new AppError('forbidden',403);
 // Cosmetic owner-scoped metadata requires the live session and CSRF, not another ceremony.
 // Still consume proofs sent by older clients, preserving their single-use semantics.
 const cosmetic=action==='rename-key'||action==='rename-account';
 const proof=cosmetic&&input.stepUp===undefined?undefined:await consumeStepUp(env,p,input.stepUp,'manage-account'),now=Date.now();
 if(action==='rename-key'||action==='remove-key'){
  if(typeof input.id!=='string'||input.id.length>1400)throw new AppError('invalid_request');
  const key=await env.DB.prepare('SELECT id FROM passkey_credentials WHERE school_id=? AND owner_id=? AND id=?').bind(p.school,p.owner,input.id).first();if(!key)throw new AppError('not_found',404);
  if(action==='rename-key'){
   const label=accountLabel(input.label);if(!label)throw new AppError('invalid_request');
   await env.DB.prepare('UPDATE passkey_credentials SET label=? WHERE school_id=? AND owner_id=? AND id=?').bind(label,p.school,p.owner,input.id).run();
  }else{
   if(input.confirm!=='remove-passkey')throw new AppError('account_confirmation_required',409);
   if(proof?.credentialId===input.id)throw new AppError('passkey_current',409);
   const target=await env.DB.prepare('SELECT COALESCE(rp_id,?) AS domain FROM passkey_credentials WHERE id=? AND school_id=? AND owner_id=?').bind(legacyRelyingPartyId(env),input.id,p.school,p.owner).first<{domain:string}>();
   if(target?.domain===relyingPartyId(env)&&!await env.DB.prepare('SELECT id FROM passkey_credentials WHERE school_id=? AND owner_id=? AND id<>? AND COALESCE(rp_id,?)=?').bind(p.school,p.owner,input.id,legacyRelyingPartyId(env),relyingPartyId(env)).first())throw new AppError('passkey_last_for_domain',409);
   const removed=await env.DB.prepare('DELETE FROM passkey_credentials WHERE school_id=? AND owner_id=? AND id=? AND (SELECT COUNT(*) FROM passkey_credentials WHERE school_id=? AND owner_id=?)>1').bind(p.school,p.owner,input.id,p.school,p.owner).run();
   if(!removed.meta.changes)throw new AppError('passkey_last',409);
   await env.DB.prepare('DELETE FROM sessions WHERE school_id=? AND owner_id=? AND (credential_id=? OR credential_id IS NULL) AND token_hash<>?').bind(p.school,p.owner,input.id,currentSessionHash(env,request)).run();
  }
 }
 if(action==='rename-account'){
  const name=accountLabel(input.name);if(!name)throw new AppError('invalid_request');
  await env.DB.batch([env.DB.prepare('UPDATE passkey_accounts SET name=? WHERE school_id=? AND owner_id=?').bind(name,p.school,p.owner),env.DB.prepare('UPDATE users SET name=? WHERE school_id=? AND id=?').bind(name,p.school,p.owner)]);
 }
 if(['revoke-session','logout-others','logout-all'].includes(action)){
  const current=currentSessionHash(env,request);
  if(action==='revoke-session'){
   if(typeof input.id!=='string'||!/^[a-f0-9]{64}$/.test(input.id))throw new AppError('invalid_request');
   await env.DB.prepare('DELETE FROM sessions WHERE school_id=? AND owner_id=? AND token_hash=?').bind(p.school,p.owner,input.id).run();
   return json({ok:true,signedOut:input.id===current});
  }
  if(action==='logout-all'&&input.confirm!=='logout-all')throw new AppError('account_confirmation_required',409);
  await env.DB.prepare('DELETE FROM sessions WHERE school_id=? AND owner_id=?'+(action==='logout-others'?' AND token_hash<>?':'')).bind(p.school,p.owner,...(action==='logout-others'?[current]:[])).run();
  return json({ok:true,signedOut:action==='logout-all'});
 }
 if(action==='create-recovery'){
  if(input.confirm!=='replace-recovery-code')throw new AppError('account_confirmation_required',409);
  const code=accountToken();await env.DB.prepare('INSERT INTO account_recovery(school_id,owner_id,token_hash,created_at) VALUES(?,?,?,?) ON CONFLICT(school_id,owner_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at').bind(p.school,p.owner,sha256(code),now).run();
  return json({ok:true,recoveryCode:code.match(/.{8}/g)!.join('-')});
 }
 if(action==='revoke-recovery')await env.DB.prepare('DELETE FROM account_recovery WHERE school_id=? AND owner_id=?').bind(p.school,p.owner).run();
 if(action==='create-invite'){
  // Reserve one of five slots for every still-valid invitation; no unbounded personal signup.
  const label=accountLabel(input.label,'Neue Person'),token=accountToken(),hash=sha256(token),expires=now+86400000;
  const guard="(SELECT COUNT(*) FROM passkey_accounts WHERE school_id=? AND deleted_at IS NULL)+(SELECT COUNT(*) FROM account_invitations i JOIN passkey_accounts a ON a.school_id=i.school_id AND a.owner_id=i.created_by WHERE i.school_id=? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? AND a.active=1 AND a.deleted_at IS NULL AND a.role='admin')<5";
  const made=await env.DB.prepare('INSERT INTO account_invitations(token_hash,school_id,created_by,label,created_at,expires_at) SELECT ?,?,?,?,?,? WHERE '+guard).bind(hash,p.school,p.owner,label,now,expires,p.school,p.school,now).run();
  if(!made.meta.changes)throw new AppError('account_limit',409);
  return json({ok:true,invitation:env.APP_ORIGIN+'/#einladung='+token,expiresAt:expires});
 }
 if(action==='revoke-invite'){
  if(typeof input.id!=='string'||!/^[a-f0-9]{64}$/.test(input.id))throw new AppError('invalid_request');
  await env.DB.prepare('UPDATE account_invitations SET revoked_at=? WHERE school_id=? AND token_hash=? AND used_at IS NULL').bind(now,p.school,input.id).run();
 }
 if(['set-account-active','set-role','delete-account'].includes(action)){
  const owner=input.owner||p.owner;if(typeof owner!=='string'||!/^[a-f0-9]{64}$/.test(owner))throw new AppError('invalid_request');
  if(owner!==p.owner&&a.role!=='admin')throw new AppError('forbidden',403);
  const target=await env.DB.prepare('SELECT role,active FROM passkey_accounts WHERE school_id=? AND owner_id=? AND deleted_at IS NULL').bind(p.school,owner).first<{role:string;active:number}>();if(!target)throw new AppError('not_found',404);
  if(action==='set-account-active'&&typeof input.active!=='boolean'||action==='set-role'&&!['admin','member'].includes(input.role))throw new AppError('invalid_request');
  const removesAdmin=target.role==='admin'&&(action==='delete-account'||action==='set-role'&&input.role!=='admin'||action==='set-account-active'&&!input.active);
  if(removesAdmin&&!await env.DB.prepare("SELECT owner_id FROM passkey_accounts WHERE school_id=? AND owner_id<>? AND active=1 AND deleted_at IS NULL AND role='admin'").bind(p.school,owner).first())throw new AppError('last_administrator',409);
  if(action==='delete-account'){
   if(input.confirm!=='delete-account-and-private-sources')throw new AppError('account_confirmation_required',409);
   await env.DB.batch([
    env.DB.prepare("UPDATE passkey_accounts SET active=0,deleted_at=?,name='Gelöschtes Konto',role='member' WHERE school_id=? AND owner_id=?").bind(now,p.school,owner),
    env.DB.prepare("UPDATE users SET name='Gelöschtes Konto' WHERE school_id=? AND id=?").bind(p.school,owner),
    env.DB.prepare('DELETE FROM passkey_credentials WHERE school_id=? AND owner_id=?').bind(p.school,owner),
    env.DB.prepare('DELETE FROM account_recovery WHERE school_id=? AND owner_id=?').bind(p.school,owner),
    env.DB.prepare('INSERT OR IGNORE INTO account_erasure(school_id,owner_id,requested_at) VALUES(?,?,?)').bind(p.school,owner,now)
   ]);
  }else if(action==='set-role')await env.DB.prepare('UPDATE passkey_accounts SET role=? WHERE school_id=? AND owner_id=?').bind(input.role,p.school,owner).run();
  else await env.DB.prepare('UPDATE passkey_accounts SET active=? WHERE school_id=? AND owner_id=?').bind(input.active?1:0,p.school,owner).run();
  if(action==='delete-account'||action==='set-account-active'&&!input.active){
   await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE school_id=? AND owner_id=?').bind(p.school,owner),
    env.DB.prepare("DELETE FROM passkey_flows WHERE json_extract(payload,'$.owner')=?").bind(owner),
    env.DB.prepare("DELETE FROM system_state WHERE key LIKE 'passkey-stepup:%' AND json_extract(value,'$.owner')=?").bind(owner),
    env.DB.prepare('UPDATE account_invitations SET revoked_at=? WHERE school_id=? AND created_by=? AND used_at IS NULL').bind(now,p.school,owner)
   ]);
  }
  return json({ok:true,signedOut:owner===p.owner&&(action==='delete-account'||action==='set-account-active'&&!input.active),affectedOwner:owner,erasureRequested:action==='delete-account'});
 }
 return json({ok:true});
}
