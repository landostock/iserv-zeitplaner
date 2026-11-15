import {AppError,sha256} from './security.ts';
import type {Env,Principal} from './types.ts';
export interface Account {owner_id:string;subject:string;handle:string;name:string;active:number;role:string;deleted_at:number|null;created_at:number;}
export function accountToken(){return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');}
export function accountLabel(value:unknown,fallback=''){
 if(typeof value!=='string')return fallback;const name=value.trim().normalize('NFC');
 if(name.length>80||/[\x00-\x1f\x7f]/.test(name))throw new AppError('invalid_request');return name||fallback;
}
export async function activeAccount(env:Env,p:Pick<Principal,'school'|'owner'>){
 const a=await env.DB.prepare('SELECT * FROM passkey_accounts WHERE school_id=? AND owner_id=? AND active=1 AND deleted_at IS NULL').bind(p.school,p.owner).first<Account>();
 if(!a)throw new AppError('account_not_allowed',403);return a;
}
export async function consumeStepUp(env:Env,p:Principal,input:unknown,scope:'add-key'|'manage-account'){
 if(typeof input!=='string'||!/^[a-f0-9-]{36}$/.test(input))throw new AppError('passkey_reauthenticate',401);
 const row=await env.DB.prepare('DELETE FROM system_state WHERE key=? RETURNING value').bind('passkey-stepup:'+sha256(input)).first<{value:string}>();
 const proof=row?JSON.parse(row.value):null;
 // Old add-key proofs remain scoped to adding a key; never grant new account-management rights.
 if(!proof||proof.owner!==p.owner||proof.expiresAt<=Date.now()||proof.sessionBinding!==sha256(p.csrf)||(proof.scope||'add-key')!==scope)throw new AppError('passkey_reauthenticate',401);
 await activeAccount(env,p);if(proof.credentialId&&!await env.DB.prepare('SELECT id FROM passkey_credentials WHERE school_id=? AND owner_id=? AND id=?').bind(p.school,p.owner,proof.credentialId).first())throw new AppError('passkey_reauthenticate',401);return proof as {owner:string;credentialId?:string;scope?:string;expiresAt:number};
}
export async function validInvitation(env:Env,token:unknown){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return null;
 const row=await env.DB.prepare("SELECT i.token_hash FROM account_invitations i JOIN passkey_accounts a ON a.school_id=i.school_id AND a.owner_id=i.created_by WHERE i.school_id=? AND i.token_hash=? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? AND a.active=1 AND a.deleted_at IS NULL AND a.role='admin'").bind(env.SCHOOL_ID,sha256(token),Date.now()).first<{token_hash:string}>();
 return row?.token_hash||null;
}
