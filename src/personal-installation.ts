import {DurableObject} from 'cloudflare:workers';
import {AppError,readLimited,sha256,seal,unseal} from './security.ts';
import {accountToken} from './account-security.ts';
import {personalEnvironment,personalOrigin,publicHttps,PERSONAL_VERSION} from './personal-config.ts';
import type {PersonalSettings} from './personal-config.ts';
import type {Env} from './types.ts';
type Monitor={url:string;testAt:number|null;confirmedAt:number|null;lastSent:number|null;lastOK:boolean|null;deliveryFailed:boolean};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function input(r:Request){if(!r.headers.get('content-type')?.startsWith('application/json'))throw new AppError('invalid_request',415);try{const d=JSON.parse(new TextDecoder().decode(await readLimited(r,4096)));if(!d||typeof d!=='object'||Array.isArray(d))throw 0;return d;}catch{throw new AppError('invalid_request');}}
function equal(a:string,b:string){const x=sha256(a),y=sha256(b);let n=0;for(let i=0;i<x.length;i++)n|=x.charCodeAt(i)^y.charCodeAt(i);return n===0;}
export function heartbeatURL(value:unknown){if(typeof value!=='string'||!/^https:\/\/hc-ping\.com\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw new AppError('invalid_monitor');return value;}
async function ping(url:string,fail=false){
 try{const r=await fetch(heartbeatURL(url)+(fail?'/fail':''),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'text/plain'},body:''});const b=new TextDecoder().decode(await readLimited(r,128));return r.status===200&&b.trim()==='OK';}catch{return false;}
}
/** Contains keys only inside the owner's account; no public route exposes config. */
export class PersonalInstallation extends DurableObject<Env>{
 private settings(){return this.ctx.storage.get<PersonalSettings>('settings');}
 private async monitor(s:PersonalSettings){const raw=await this.ctx.storage.get<string>('monitor');return raw?unseal<Monitor>(personalEnvironment(this.env,s),'personal-monitor',raw):null;}
 private async saveMonitor(s:PersonalSettings,m:Monitor){await this.ctx.storage.put('monitor',await seal(personalEnvironment(this.env,s),'personal-monitor',m));}
 async fetch(r:Request){
  try{
   const path=new URL(r.url).pathname;
   if(path==='/config'){const s=await this.settings();return s?json({...personalEnvironment({}as Env,s),PASSKEY_BOOTSTRAP_HASH:sha256(s.invite)}):json({error:'setup_required'},503);}
   if(path==='/public')return json({configured:Boolean(await this.settings()),setupReady:typeof this.env.SETUP_CODE==='string'&&this.env.SETUP_CODE.length>=24,version:PERSONAL_VERSION});
   if(path==='/initialize')return await this.ctx.blockConcurrencyWhile(async()=>{
    try{
    const d=await input(r);if(typeof this.env.SETUP_CODE!=='string'||this.env.SETUP_CODE.length<24)throw new AppError('setup_code_missing',503);
    if(typeof d.setupCode!=='string'||d.setupCode.length>256||!equal(d.setupCode,this.env.SETUP_CODE))throw new AppError('setup_code_invalid',403);
    const origin=personalOrigin(d.origin),existing=await this.settings();
    if(existing){if(existing.origin!==origin)throw new AppError('canonical_address_required',421);return json({invitation:existing.origin+'/#einladung='+existing.invite,resumed:true});}
    if(d.consent!=='own-account-and-encrypted-iserv-storage')throw new AppError('setup_consent_required');
    const school=publicHttps(d.school),dav=publicHttps(d.dav);
    // Signing keys are generated here, never on the public installation website.
    const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const pub=await crypto.subtle.exportKey('raw',key.publicKey),priv=await crypto.subtle.exportKey('jwk',key.privateKey);
    const s:PersonalSettings={origin,school,dav,id:accountToken(),vault:accountToken(),monitor:accountToken(),invite:accountToken(),createdAt:Date.now(),vapidPublic:Buffer.from(pub).toString('base64url'),vapidPrivate:priv.d!};
    await this.ctx.storage.put('settings',s);
    return json({invitation:origin+'/#einladung='+s.invite,resumed:false});
    }catch(e){return json({error:e instanceof AppError?e.code:'unexpected_error'},e instanceof AppError?e.status:500);}
   });
   const s=await this.settings();if(!s)throw new AppError('setup_required',503);
   if(path==='/status'){const m=await this.monitor(s);return json({version:PERSONAL_VERSION,origin:s.origin,school:s.school,createdAt:s.createdAt,verifiedAt:await this.ctx.storage.get('verifiedAt')||null,reserveAt:await this.ctx.storage.get('reserveAt')||null,monitor:m?{configured:true,testAt:m.testAt,confirmedAt:m.confirmedAt,lastSent:m.lastSent,deliveryFailed:m.deliveryFailed}:null});}
   if(path==='/verified'){if(!await this.ctx.storage.get('verifiedAt'))await this.ctx.storage.put('verifiedAt',Date.now());return json({ok:true});}
   if(path==='/reserve-saved'){await this.ctx.storage.put('reserveAt',Date.now());return json({ok:true});}
   if(path==='/school'){
    const d=await input(r);s.school=publicHttps(d.school);s.dav=publicHttps(d.dav);await this.ctx.storage.put('settings',s);return json({ok:true});
   }
   if(path==='/monitor/configure'){
    const d=await input(r),url=heartbeatURL(d.url),old=await this.monitor(s);
    if(old&&old.url===url)return json({configured:true});
    if(d.consent!=='send-empty-heartbeats')throw new AppError('monitor_consent_required');
    if(!await ping(url))throw new AppError('monitor_unavailable',502);
    await this.saveMonitor(s,{url,testAt:null,confirmedAt:null,lastSent:Date.now(),lastOK:true,deliveryFailed:false});return json({configured:true});
   }
   if(path==='/monitor/test'){
    const m=await this.monitor(s);if(!m)throw new AppError('invalid_monitor');
    if(m.testAt&&Date.now()-m.testAt<60000)throw new AppError('too_many_requests',429);
    const d=await input(r);if(d.consent!=='send-test-alert')throw new AppError('monitor_consent_required');
    if(!await ping(m.url,true))throw new AppError('monitor_unavailable',502);
    m.testAt=Date.now();m.confirmedAt=null;m.lastOK=false;m.lastSent=Date.now();await this.saveMonitor(s,m);return json({testSent:true});
   }
   if(path==='/monitor/confirm'){
    const m=await this.monitor(s),d=await input(r);if(!m?.testAt||Date.now()-m.testAt>86400000||d.consent!=='email-received')throw new AppError('monitor_test_required');
    if(!await ping(m.url))throw new AppError('monitor_unavailable',502);
    m.confirmedAt=Date.now();m.lastOK=true;m.lastSent=Date.now();m.deliveryFailed=false;await this.saveMonitor(s,m);return json({confirmed:true});
   }
   if(path==='/heartbeat'){
    const d=await input(r),m=await this.monitor(s);if(!m)return json({configured:false});
    const now=Date.now();if(m.lastSent&&now-m.lastSent<55000)return json({throttled:true});
    const ok=d.healthy===true;
    // Reserve the send slot before awaiting a provider, so concurrent cron/alarm calls coalesce.
    m.lastSent=now;await this.saveMonitor(s,m);
    const delivered=await ping(m.url,!ok);m.deliveryFailed=!delivered;if(delivered)m.lastOK=ok;await this.saveMonitor(s,m);return json({delivered});
   }
   throw new AppError('not_found',404);
  }catch(e){return json({error:e instanceof AppError?e.code:'unexpected_error'},e instanceof AppError?e.status:500);}
 }
}
