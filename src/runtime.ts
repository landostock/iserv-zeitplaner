import { DemoStorage } from './demo.ts';
import { WebDav } from './dav.ts';
import { AppError, demoAllowed, maxFile, requireExecution, unseal, replacementKey, sha256 } from './security.ts';
import type { ConnectionSecret, Env, Runtime } from './types.ts';
import { checkConnectionPolicy,connectionIdentity } from './connection-policy.ts';
import { FileVault } from './file-vault.ts';
import {ProofDav} from './folder-proof.ts';
import {FileAreas} from './file-areas.ts';
async function connection(env:Env,school:string,owner:string){
  const row=await env.DB.prepare('SELECT secret,credential_kind,discard_after FROM connections WHERE school_id=? AND owner_id=? AND active=1').bind(school,owner).first<{secret:string;credential_kind:string|null;discard_after:number|null}>();
  if(!row)throw new AppError('needs_auth',409);
  const token=await unseal<ConnectionSecret>(env,`connection:${school}:${owner}`,row.secret);
  checkConnectionPolicy(env,token);
  if(token.kind==='account-password'&&(row.credential_kind!==token.kind||row.discard_after!==token.expiresAt))throw new AppError('needs_auth',409);
  return {...token,binding:connectionIdentity(env,token)};
}
export async function authorizeUntil(env:Env,school:string,owner:string,due:number){
  if(demoAllowed(env))return;
  const token=await connection(env,school,owner);
  const margin=token.kind==='account-password'?86400000+300000:300000;
  if(token.expiresAt!==null&&token.expiresAt<due+margin)throw new AppError('authorization_too_short',409);
}
export function runtime(env:Env):Runtime {
  return {now:Date.now,...(env.GATE?{numberingLock:async(school:string,owner:string,folder:string,id:string,action:'acquire'|'release'|'reserve'|'unreserve',token?:string,target?:string)=>{
    const n=demoAllowed(env)?env.GATE!:env.GATE!.jurisdiction('eu'),stub=n.get(n.idFromName('gate:'+school));
    const response=await stub.fetch(env.APP_ORIGIN+'/_internal/numbering-lock',{method:'POST',body:JSON.stringify({scope:replacementKey(env,school,folder),holder:sha256(JSON.stringify([school,owner,id])),action,token,target:target?replacementKey(env,school,target):undefined})});
    if(!response.ok)throw new AppError('numbering_coordinator_unavailable',503);return (await response.json()as {token:string|null}).token;
  },numberingReservations:async(school:string,folder:string)=>{
    const n=demoAllowed(env)?env.GATE!:env.GATE!.jurisdiction('eu'),stub=n.get(n.idFromName('gate:'+school));
    const response=await stub.fetch(env.APP_ORIGIN+'/_internal/numbering-reservations',{method:'POST',body:JSON.stringify({scope:replacementKey(env,school,folder)})});
    if(!response.ok)throw new AppError('numbering_coordinator_unavailable',503);return (await response.json()as {targets:string[]}).targets;
  }}:{}),...(env.PUBLICATION_MODE==='vault-put'?{vault:(school:string,owner:string)=>new FileVault(env,school,owner)}:{}),storage:async(school,owner)=>{
    requireExecution(env);
    if(demoAllowed(env)){const storage=new DemoStorage(env,school,owner);await storage.seed();return storage;}
    const credential=await connection(env,school,owner);
    if(credential.expiresAt!==null&&credential.expiresAt<Date.now()+60000)throw new AppError('needs_auth',409);
    const storage=env.ADDITIONAL_GROUP_ROOT?new FileAreas(env,school,owner,credential.authorization,credential.binding,maxFile(env)):env.TARGET_NAMING==='unique-v1'?new ProofDav(env,school,owner,credential.authorization,credential.binding,maxFile(env)):new WebDav(env.DAV_ORIGIN!,credential.authorization,env.GROUP_ROOT!,env.PRIVATE_ROOT!,maxFile(env));
    return Object.assign(storage,{accountIdentity:credential.binding});
  }};
}
