import {legacyRelyingPartyId,relyingPartyId,legacyPasskeysAvailable} from './public-origin.ts';
import type {Env} from './types.ts';
/** Only aggregate readiness is exposed to administrators/the authenticated monitor. */
export async function domainMigration(env:Env){
 const target=new URL(env.PUBLIC_APP_ORIGIN||env.APP_ORIGIN).hostname;
 const row=await env.DB.prepare(`SELECT COUNT(*) AS active,
 COALESCE(SUM(EXISTS(SELECT 1 FROM passkey_credentials c WHERE c.school_id=a.school_id AND c.owner_id=a.owner_id AND COALESCE(c.rp_id,?)=? AND c.last_login_at IS NOT NULL)),0) AS verified
 FROM passkey_accounts a WHERE a.school_id=? AND a.active=1 AND a.deleted_at IS NULL`).bind(legacyRelyingPartyId(env),target,env.SCHOOL_ID).first<{active:number;verified:number}>();
 const active=row?.active||0,verified=row?.verified||0;
 return {target,enabled:target!==legacyRelyingPartyId(env),active,verified,ready:active>0&&active===verified};
}
export async function personalDomainMigration(env:Env,owner:string){
 const target=relyingPartyId(env),keys=await env.DB.prepare('SELECT COUNT(*) AS registered,MAX(last_login_at) AS verifiedAt FROM passkey_credentials WHERE school_id=? AND owner_id=? AND COALESCE(rp_id,?)=?').bind(env.SCHOOL_ID,owner,legacyRelyingPartyId(env),target).first<{registered:number;verifiedAt:number|null}>();
 return {enabled:legacyPasskeysAvailable(env),target,registered:(keys?.registered||0)>0,verifiedAt:keys?.verifiedAt||null};
}
