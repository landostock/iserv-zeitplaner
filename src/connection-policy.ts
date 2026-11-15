import { AppError,sha256 } from './security.ts';
import type { ConnectionSecret, Env } from './types.ts';
export function connectionIdentity(env:Env,secret:ConnectionSecret){
  const decoded=secret.authorization.startsWith('Basic ')?Buffer.from(secret.authorization.slice(6),'base64').toString('utf8'):'',colon=decoded.indexOf(':');
  return sha256(JSON.stringify([env.DAV_ORIGIN,colon>0?decoded.slice(0,colon):secret.authorization]));
}

/** A review record enables a credential type; it does not establish school permission or publication safety. */
export function checkConnectionPolicy(env:Env,secret:ConnectionSecret){
  if(!['bearer','app-password','account-password'].includes(secret.kind)||typeof secret.reviewId!=='string'||!secret.reviewId
    ||!(secret.expiresAt===null||Number.isSafeInteger(secret.expiresAt))||typeof secret.authorization!=='string'||secret.authorization.length>4096)throw new AppError('needs_auth',409);
  if(secret.kind==='bearer'){
    if(secret.expiresAt===null||!/^Bearer [A-Za-z0-9._~+/=-]+$/.test(secret.authorization))throw new AppError('needs_auth',409);
  }else if(!/^Basic [A-Za-z0-9+/=]+$/.test(secret.authorization))throw new AppError('needs_auth',409);
  if(secret.kind==='account-password'){
    if(env.ALLOW_ACCOUNT_PASSWORD_STORAGE!=='true'||!env.ACCOUNT_PASSWORD_REVIEW_ID||env.ACCOUNT_PASSWORD_REVIEW_ID!==secret.reviewId)throw new AppError('credential_policy_required',409);
    // For this type this is an application retention/use deadline, not a claim about IServ password expiry.
    if(secret.expiresAt===null)throw new AppError('credential_retention_required',409);
  }
}
export async function purgeExpiredAccountPasswords(env:Env,now:number){
  await env.DB.prepare("DELETE FROM connections WHERE school_id=? AND credential_kind='account-password' AND discard_after IS NOT NULL AND discard_after<=?").bind(env.SCHOOL_ID,now).run();
}
