import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
import {identityOrigin} from './public-origin.ts';
import { AppError, demoAllowed, origin, productionReady, random, sha256 } from './security.ts';
import type { Env, Principal } from './types.ts';

function cookies(request:Request){return Object.fromEntries((request.headers.get('cookie')||'').split(';').map(x=>x.trim().split('=',2)));}
const sessionName=(env:Env)=>demoAllowed(env)?'zeitplaner_session':'__Host-zeitplaner_session';
const flowName=(env:Env)=>demoAllowed(env)?'zeitplaner_flow':'__Host-zeitplaner_flow';
function cookie(env:Env,name:string,value:string,maxAge:number){return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${demoAllowed(env)?'':'; Secure'}`;}
export async function session(env:Env,request:Request):Promise<Principal|null>{
  const token=cookies(request)[sessionName(env)];if(!token||!/^[a-f0-9-]{36}$/.test(token))return null;
  const row=await env.DB.prepare('SELECT s.school_id,s.owner_id,s.csrf,u.name FROM sessions s JOIN users u ON s.school_id=u.school_id AND s.owner_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND s.school_id=?')
    .bind(sha256(token),Date.now(),env.SCHOOL_ID).first<{school_id:string;owner_id:string;csrf:string;name:string}>();
  return row?{school:row.school_id,owner:row.owner_id,name:row.name,csrf:row.csrf}:null;
}
export function currentSessionHash(env:Env,request:Request){const token=cookies(request)[sessionName(env)];return token?sha256(token):'';}
export function sameOrigin(env:Env,request:Request){
  if(request.headers.get('origin')!==env.APP_ORIGIN)throw new AppError('forbidden',403);
  const site=request.headers.get('sec-fetch-site');if(site&&site!=='same-origin'&&site!=='none')throw new AppError('forbidden',403);
}
export function csrf(env:Env,request:Request,p:Principal){sameOrigin(env,request);if(request.headers.get('x-csrf-token')!==p.csrf)throw new AppError('forbidden',403);}
export async function loginSession(env:Env,subject:string,name:string,credentialId?:string){
  const owner=sha256(`${env.AUTH_MODE==='passkey'?identityOrigin(env):env.OIDC_ISSUER||'local-demo'}:${subject}`);
  await env.DB.prepare('INSERT INTO users(school_id,id,subject,name) VALUES(?,?,?,?) ON CONFLICT(school_id,id) DO UPDATE SET name=excluded.name').bind(env.SCHOOL_ID,owner,subject,name.slice(0,100)).run();
  const token=random(),csrfToken=random();
  await env.DB.prepare('INSERT INTO sessions(token_hash,school_id,owner_id,csrf,expires_at,created_at,credential_id) VALUES(?,?,?,?,?,?,?)').bind(sha256(token),env.SCHOOL_ID,owner,csrfToken,Date.now()+8*3600000,Date.now(),credentialId||null).run();
  await env.DB.prepare('DELETE FROM sessions WHERE school_id=? AND owner_id=? AND (expires_at<=? OR token_hash NOT IN (SELECT token_hash FROM sessions WHERE school_id=? AND owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20))').bind(env.SCHOOL_ID,owner,Date.now(),env.SCHOOL_ID,owner).run();
  return cookie(env,sessionName(env),token,8*3600);
}
export async function demoLogin(env:Env,request:Request){
  if(!demoAllowed(env)||new URL(request.url).origin!==env.APP_ORIGIN)throw new AppError('not_found',404);
  sameOrigin(env,request);return loginSession(env,'teacher-demo','Alex · Testlehrkraft');
}
export async function logout(env:Env,request:Request){
  const token=cookies(request)[sessionName(env)];if(token)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(sha256(token)).run();
  return cookie(env,sessionName(env),'',0);
}
interface Discovery {issuer:string;authorization_endpoint:string;token_endpoint:string;jwks_uri:string;}
async function discovery(env:Env):Promise<Discovery>{
  if(!productionReady(env))throw new AppError('setup_required',503);
  const issuer=origin(env.OIDC_ISSUER!);const url=new URL(env.OIDC_DISCOVERY_URL!);
  if(url.origin!==issuer||url.username||url.password)throw new AppError('setup_required',503);
  const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!r.ok||r.status>=300)throw new AppError('login_unavailable',503);
  const text=await r.text();if(text.length>64000)throw new AppError('login_unavailable',503);
  const d=JSON.parse(text) as Discovery;
  if(d.issuer!==env.OIDC_ISSUER)throw new AppError('login_unavailable',503);
  for(const field of ['authorization_endpoint','token_endpoint','jwks_uri']as const){const e=new URL(d[field]);if(e.origin!==issuer||e.username||e.password||e.hash)throw new AppError('login_unavailable',503);}
  return d;
}
export async function beginLogin(env:Env){
  const d=await discovery(env),state=random(),browser=random(),verifier=random()+random(),nonce=random();
  await env.DB.prepare('INSERT INTO oauth_states(state_hash,browser_hash,verifier,nonce,expires_at) VALUES(?,?,?,?,?)').bind(sha256(state),sha256(browser),verifier,nonce,Date.now()+600000).run();
  const url=new URL(d.authorization_endpoint);url.search=new URLSearchParams({response_type:'code',client_id:env.OIDC_CLIENT_ID!,redirect_uri:env.APP_ORIGIN+'/auth/callback',scope:'openid profile',state,nonce,code_challenge:Buffer.from(sha256(verifier),'hex').toString('base64url'),code_challenge_method:'S256'}).toString();
  return {location:url.toString(),cookie:cookie(env,flowName(env),browser,600)};
}
export async function callback(env:Env,request:Request){
  const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code'),browser=cookies(request)[flowName(env)];
  if(!state||!code||code.length>4096||!browser)throw new AppError('login_failed',401);
  const saved=await env.DB.prepare('DELETE FROM oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *')
    .bind(sha256(state),sha256(browser),Date.now()).first<{verifier:string;nonce:string}>();
  if(!saved)throw new AppError('login_failed',401);
  const d=await discovery(env);
  const r=await fetch(d.token_endpoint,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(encodeURIComponent(env.OIDC_CLIENT_ID!)+':'+encodeURIComponent(env.OIDC_CLIENT_SECRET!)).toString('base64')},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:env.APP_ORIGIN+'/auth/callback',code_verifier:saved.verifier})});
  if(!r.ok||r.status>=300)throw new AppError('login_failed',401);
  const token=await r.json()as {id_token?:string};if(!token.id_token||token.id_token.length>20000)throw new AppError('login_failed',401);
  const jwks=createRemoteJWKSet(new URL(d.jwks_uri),{[customFetch]:(input,init)=>fetch(input,{...init,redirect:'manual',signal:AbortSignal.timeout(10000)})});
  try{
    const {payload}=await jwtVerify(token.id_token,jwks,{issuer:env.OIDC_ISSUER!,audience:env.OIDC_CLIENT_ID!,algorithms:['RS256','ES256'],clockTolerance:30,maxTokenAge:'10m'});
    if(payload.nonce!==saved.nonce||typeof payload.sub!=='string'||!payload.exp||(payload.azp&&payload.azp!==env.OIDC_CLIENT_ID)||Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==env.OIDC_CLIENT_ID)throw new Error();
    if(!env.OIDC_ALLOWED_SUBJECTS!.split(',').map(x=>x.trim()).includes(payload.sub))throw new AppError('account_not_allowed',403);
    return {cookie:await loginSession(env,payload.sub,typeof payload.name==='string'?payload.name:'Lehrkraft'),flowCookie:cookie(env,flowName(env),'',0)};
  }catch(error){if(error instanceof AppError)throw error;throw new AppError('login_failed',401);}
}
