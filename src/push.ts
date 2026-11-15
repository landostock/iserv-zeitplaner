import {buildPushPayload,type PushSubscription} from '@block65/webcrypto-web-push';
import {AppError,seal,unseal,sha256} from './security.ts';
import type {Env,Principal} from './types.ts';

export const pushReady=(env:Env)=>env.MODE==='production'&&Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY);
/** Restrict outgoing requests to browser push providers; never fetch a client-selected arbitrary URL. */
export function pushEndpoint(endpoint:unknown):string{
  if(typeof endpoint!=='string'||endpoint.length>3000)throw new AppError('invalid_push');
  let u:URL;try{u=new URL(endpoint);}catch{throw new AppError('invalid_push');}
  const h=u.hostname;
  const allowed=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(h)||/^[a-z0-9-]+\.push\.apple\.com$/.test(h)||/^[a-z0-9-]+\.notify\.windows\.com$/.test(h);
  if(!allowed||u.protocol!=='https:'||u.port||u.username||u.password||u.hash||u.search||u.pathname==='/')throw new AppError('invalid_push');return u.href;
}
async function validated(input:any):Promise<PushSubscription>{
  const endpoint=pushEndpoint(input?.endpoint),p=input?.keys?.p256dh,a=input?.keys?.auth;
  if(typeof p!=='string'||!/^[A-Za-z0-9_-]{87}$/.test(p)||typeof a!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(a))throw new AppError('invalid_push');
  const publicKey=Uint8Array.from(Buffer.from(p,'base64url'));if(publicKey.length!==65||publicKey[0]!==4)throw new AppError('invalid_push');
  try{await crypto.subtle.importKey('raw',publicKey,{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{throw new AppError('invalid_push');}
  return {endpoint,expirationTime:null,keys:{p256dh:p,auth:a}};
}
const context=(school:string,owner:string,id:string)=>'push:'+school+':'+owner+':'+id;
export async function pushStatus(env:Env,p:Principal){
  const row=await env.DB.prepare('SELECT COUNT(*) AS n,MAX(delivery_failed) AS failed FROM push_subscriptions WHERE school_id=? AND owner_id=? AND expires_at>?').bind(p.school,p.owner,Date.now()).first<{n:number;failed:number|null}>();
  const recent=await env.DB.prepare('SELECT last_attempt_at,last_accepted_at,last_http,last_error FROM push_subscriptions WHERE school_id=? AND owner_id=? AND expires_at>? ORDER BY last_attempt_at DESC LIMIT 1').bind(p.school,p.owner,Date.now()).first();
  return {available:pushReady(env),publicKey:pushReady(env)?env.VAPID_PUBLIC_KEY:null,devices:row?.n||0,deliveryFailed:Boolean(row?.failed),lastDelivery:recent||null};
}
export async function savePush(env:Env,p:Principal,input:any){
  if(!pushReady(env))throw new AppError('push_unavailable',409);
  if(input?.consent!=='notify-this-device')throw new AppError('push_consent_required',409);
  const subscription=await validated(input.subscription),id=sha256(subscription.endpoint),now=Date.now();
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE expires_at<=?').bind(now).run();
  const row=await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE school_id=? AND owner_id=? AND id<>?').bind(p.school,p.owner,id).first<{n:number}>();if((row?.n||0)>=3)throw new AppError('push_limit',409);
  await env.DB.prepare('INSERT INTO push_subscriptions(school_id,owner_id,id,subscription,created_at,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(school_id,owner_id,id) DO UPDATE SET subscription=excluded.subscription,expires_at=excluded.expires_at,next_attempt_at=0,delivery_failed=0').bind(p.school,p.owner,id,await seal(env,context(p.school,p.owner,id),subscription),now,now+90*86400000).run();
  return {id,...await pushStatus(env,p)};
}
export async function removePush(env:Env,p:Principal,input:any){
  const id=sha256(pushEndpoint(input?.endpoint));await env.DB.prepare('DELETE FROM push_subscriptions WHERE school_id=? AND owner_id=? AND id=?').bind(p.school,p.owner,id).run();
}
export async function notifyPush(env:Env,fetcher:typeof fetch=globalThis.fetch.bind(globalThis),testOwner?:string,clock=Date.now){
  const summary={attempted:0,accepted:0,failed:0,removed:0,skipped:0};
  if(!pushReady(env))return summary;
  const now=clock();await env.DB.prepare('DELETE FROM push_subscriptions WHERE expires_at<=?').bind(now).run();
  const {results}=await env.DB.prepare('SELECT * FROM push_subscriptions WHERE school_id=? AND expires_at>? LIMIT 15').bind(env.SCHOOL_ID,now).all<{school_id:string;owner_id:string;id:string;subscription:string;last_event:string|null;next_attempt_at:number;last_attempt_at:number}>();
  for(const row of results){
    if(testOwner&&row.owner_id!==testOwner)continue;
    if(testOwner?row.last_attempt_at>now-60000:row.next_attempt_at>now){summary.skipped++;continue;}
    const notices=await env.DB.prepare("SELECT COUNT(*) AS n,MAX(created_at) AS latest FROM notifications WHERE school_id=? AND owner_id=? AND read_at IS NULL AND kind IN ('failed','needs_auth','needs_review','conflict')").bind(row.school_id,row.owner_id).first<{n:number;latest:number|null}>();
    const overdue=await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE school_id=? AND owner_id=? AND status IN ('scheduled','retry_wait','publishing','reconciling') AND due_at<?").bind(row.school_id,row.owner_id,now-180000).first<{n:number}>();
    const renewal=await env.DB.prepare("SELECT discard_after FROM connections WHERE school_id=? AND owner_id=? AND active=1 AND discard_after<? AND discard_after>? ").bind(row.school_id,row.owner_id,now+3*86400000,now).first<{discard_after:number}>();
    const event=sha256(JSON.stringify([notices?.latest||0,Boolean(overdue?.n),renewal?.discard_after||0]));
    if(!testOwner&&!(notices?.n||overdue?.n||renewal)){
      if(row.last_event)await env.DB.prepare('UPDATE push_subscriptions SET last_event=NULL WHERE school_id=? AND owner_id=? AND id=?').bind(row.school_id,row.owner_id,row.id).run();
      continue;
    }
    if(!testOwner&&event===row.last_event)continue;
    // Persist a bounded retry before network dispatch. Alarm reentry cannot cause a send storm.
    const claimed=await env.DB.prepare('UPDATE push_subscriptions SET next_attempt_at=?,last_attempt_at=?,last_http=NULL,last_error=NULL WHERE school_id=? AND owner_id=? AND id=? AND '+(testOwner?'last_attempt_at<=?':'next_attempt_at<=?')+' RETURNING id').bind(now+300000,now,row.school_id,row.owner_id,row.id,testOwner?now-60000:now).first();
    if(!claimed){summary.skipped++;continue;}summary.attempted++;
    try{
      const subscription=await unseal<PushSubscription>(env,context(row.school_id,row.owner_id,row.id),row.subscription);pushEndpoint(subscription.endpoint);
      const data={title:'IServ Zeitplaner',body:testOwner?'Testnachricht: Benachrichtigungen erreichen dieses Gerät.':notices?.n||overdue?.n?'Eine Veröffentlichung benötigt Ihre Aufmerksamkeit. Bitte öffnen Sie den Zeitplaner.':'Ihre IServ-Verbindung läuft bald ab. Bitte erneuern Sie sie im Zeitplaner.',url:'/'};
      const payload=await buildPushPayload({data,options:{ttl:86400,urgency:'normal',topic:'zeitplaner-status'}},subscription,{subject:env.APP_ORIGIN,publicKey:env.VAPID_PUBLIC_KEY!,privateKey:env.VAPID_PRIVATE_KEY!});
      const r=await fetcher(subscription.endpoint,{...payload,redirect:'manual',signal:AbortSignal.timeout(10000)});await r.body?.cancel();
      await env.DB.prepare('UPDATE push_subscriptions SET last_http=? WHERE school_id=? AND owner_id=? AND id=?').bind(r.status,row.school_id,row.owner_id,row.id).run();
      if([404,410].includes(r.status)){summary.removed++;await env.DB.prepare('DELETE FROM push_subscriptions WHERE school_id=? AND owner_id=? AND id=?').bind(row.school_id,row.owner_id,row.id).run();continue;}
      if(!r.ok){await env.DB.prepare("UPDATE push_subscriptions SET last_error='provider_rejected' WHERE school_id=? AND owner_id=? AND id=?").bind(row.school_id,row.owner_id,row.id).run();throw new Error('push_delivery_failed');}
      await env.DB.prepare('UPDATE push_subscriptions SET last_event=?,delivery_failed=0,next_attempt_at=?,last_accepted_at=? WHERE school_id=? AND owner_id=? AND id=?').bind(testOwner?row.last_event:event,now+60000,now,row.school_id,row.owner_id,row.id).run();
      summary.accepted++;
    }catch{summary.failed++;await env.DB.prepare("UPDATE push_subscriptions SET delivery_failed=1,last_error=COALESCE(last_error,'push_request_failed') WHERE school_id=? AND owner_id=? AND id=?").bind(row.school_id,row.owner_id,row.id).run();}
  }
  return summary;
}
