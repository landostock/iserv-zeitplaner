import { createHash, createHmac } from 'node:crypto';
import type { Env } from './types.ts';

export class AppError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export const sha256 = (value: Uint8Array|string): string => createHash('sha256').update(value).digest('hex');
export const random = (): string => crypto.randomUUID();
export function replacementKey(env:Env,school:string,target:string){return createHmac('sha256',vaultKey(env)).update(JSON.stringify(['replacement-target',school,env.DAV_ORIGIN||'demo',target])).digest('hex');}
export function isLocal(origin: string): boolean {
  const url = new URL(origin);
  return url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
}
export function demoAllowed(env: Env): boolean { return env.MODE === 'demo' && isLocal(env.APP_ORIGIN); }
export function targetPolicyReady(env:Env){
  if(env.TARGET_NAMING==='unique-v1')return env.UNIQUE_TARGET_APPROVED==='true';
  return env.TARGET_PUT_REJECTED!=='true';
}
export function productionReady(env: Env): boolean {
  return env.MODE === 'production' && env.PRODUCTION_APPROVED === 'true' && env.DAV_CAPABILITIES_APPROVED === 'true'
    && (env.PUBLICATION_MODE==='vault-put'?targetPolicyReady(env)&&env.TARGET_UPLOAD_APPROVED==='true'&&Boolean(env.FILES||env.VAULT_OBJECTS):env.STAGING_SOURCE_REJECTED !== 'true')
    && Boolean(env.VAULT_KEY && env.DAV_ORIGIN && env.GROUP_ROOT && env.PRIVATE_ROOT
      && (env.AUTH_MODE==='passkey'?/^[a-f0-9]{64}$/.test(env.PASSKEY_BOOTSTRAP_HASH||''):env.AUTH_MODE==='access'?env.ACCESS_ISSUER&&env.ACCESS_AUD&&env.ACCESS_EMAILS&&env.ACCESS_EMAILS.split(',').filter(x=>x.trim()).length<=5:env.OIDC_ISSUER && env.OIDC_DISCOVERY_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET && env.OIDC_ALLOWED_SUBJECTS) && env.API_LIMIT && env.AUTH_LIMIT)
    && new URL(env.APP_ORIGIN).protocol === 'https:';
}
export function requireExecution(env: Env): void {
  if (!demoAllowed(env) && !productionReady(env)) throw new AppError('setup_required',503);
}
export function path(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1500 || !value.startsWith('/') || value.includes('//')
      || /[\\\x00-\x1f\x7f]/.test(value) || value.split('/').some(x=>x==='.'||x==='..')
      || /%(?:2f|5c|2e|25)/i.test(value)) throw new AppError('invalid_path');
  return value;
}
export const encodedPath = (value:string): string => path(value).split('/').map(encodeURIComponent).join('/');
export function within(value:string,root:string): boolean {
  const r = path(root).replace(/\/$/,'');
  return value === r || value.startsWith(r+'/');
}
export function filename(value:unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 180 || value !== value.trim()
      || /[\/\\\x00-\x1f\x7f]/.test(value) || value === '.' || value === '..' || value.endsWith('.')) throw new AppError('invalid_filename');
  return value.normalize('NFC');
}
export function origin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
    || !/^[a-z0-9.-]+$/i.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)
    || /^\d+(?:\.\d+){3}$/.test(url.hostname)) throw new AppError('invalid_origin');
  return url.origin;
}
export function vaultKey(env:Env): Uint8Array<ArrayBuffer> {
  // Demo key is deliberately public and usable ONLY on the local mock environment.
  const text = demoAllowed(env) ? '11'.repeat(32) : env.VAULT_KEY;
  if (!text || !/^[0-9a-f]{64}$/i.test(text)) throw new AppError('setup_required',503);
  return Uint8Array.from(text.match(/../g)!,x=>parseInt(x,16));
}
export function rateKey(env:Env,request:Request):string {
  return createHmac('sha256',vaultKey(env)).update(env.SCHOOL_ID+':'+(request.headers.get('CF-Connecting-IP')||'unknown')).digest('hex');
}
export async function seal(env:Env, context:string, value:unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw',vaultKey(env), 'AES-GCM',false,['encrypt']);
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)},key,new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({v:1,iv:Buffer.from(iv).toString('base64'),data:Buffer.from(encrypted).toString('base64')});
}
export async function unseal<T>(env:Env, context:string, text:string): Promise<T> {
  try {
    const value = JSON.parse(text);
    if(value.v!==1) throw new Error();
    const key = await crypto.subtle.importKey('raw',vaultKey(env),'AES-GCM',false,['decrypt']);
    const decoded = await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(value.iv,'base64'),additionalData:new TextEncoder().encode(context)},key,Buffer.from(value.data,'base64'));
    return JSON.parse(new TextDecoder().decode(decoded)) as T;
  } catch { throw new AppError('vault_error',503); }
}
export async function readLimited(request:Pick<Request,'headers'|'body'>,max:number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length') || 0)>max) throw new AppError('file_too_large',413);
  if(!request.body) return new Uint8Array();
  const raw=request.headers.get('content-length'),declared=raw!==null&&/^\d+$/.test(raw)?Number(raw):null;
  const reader=request.body.getReader();let result=new Uint8Array(declared!==null?declared:Math.min(max,65536)),length=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;const next=length+value.length;
      if(next>max){await reader.cancel();throw new AppError('file_too_large',413);}
      if(next>result.length){const grown=new Uint8Array(Math.min(max,Math.max(next,result.length*2)));grown.set(result);result=grown;}
      result.set(value,length);length=next;
    }
  }finally{reader.releaseLock();}
  return length===result.length?result:result.slice(0,length);
}
export function maxFile(env:Env):number { const n=Number(env.MAX_FILE_BYTES||10485760); return Math.min(Number.isFinite(n)&&n>0?n:10485760,50*1024*1024); }
