import {AppError,origin} from './security.ts';
import type {Env} from './types.ts';
/** Never trust this HTTP header at the public Worker. Only our private Pages entrypoint sets it. */
export const PUBLIC_ORIGIN_HEADER='X-Zeitplaner-Public-Origin';
export function frontendEnvironment(env:Env,forwarded?:string|null):Env{
 if(!forwarded)return env;
 if(!env.PUBLIC_APP_ORIGIN||forwarded!==env.PUBLIC_APP_ORIGIN||origin(forwarded)!==forwarded)throw new AppError('origin_mismatch',421);
 return {...env,APP_ORIGIN:forwarded,IDENTITY_ORIGIN:env.IDENTITY_ORIGIN||env.APP_ORIGIN};
}
export const identityOrigin=(env:Env)=>env.IDENTITY_ORIGIN||env.APP_ORIGIN;
export const legacyRelyingPartyId=(env:Env)=>new URL(identityOrigin(env)).hostname;
export const relyingPartyId=(env:Env)=>new URL(env.APP_ORIGIN).hostname;
export const legacyPasskeysAvailable=(env:Env)=>legacyRelyingPartyId(env)!==relyingPartyId(env)&&env.LEGACY_PASSKEYS_DISABLED!=='true';
