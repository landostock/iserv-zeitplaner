import {AppError} from './security.ts';
import type {Env} from './types.ts';
import release from '../personal-release.json';
export const PERSONAL_VERSION=release.version;
export interface PersonalSettings {origin:string;school:string;dav:string;id:string;vault:string;monitor:string;invite:string;createdAt:number;vapidPublic:string;vapidPrivate:string;}
export function publicHttps(value:unknown){
 if(typeof value!=='string'||value.length>250)throw new AppError('invalid_school');
 let u:URL;try{u=new URL(value.includes('://')?value:'https://'+value);}catch{throw new AppError('invalid_school');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||!u.hostname.includes('.')||!/[a-z]/i.test(u.hostname)||u.hostname.endsWith('.')||/^(localhost|.*\.(localhost|local|internal|invalid|test|example))$/i.test(u.hostname)||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(u.hostname))throw new AppError('invalid_school');
 return u.origin;
}
export function personalOrigin(value:string){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.port||!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.workers\.dev$/.test(u.origin))throw new AppError('canonical_address_required',421);
 return u.origin;
}
export function personalEnvironment(raw:Env,s:PersonalSettings):Env {
 return {...raw,MODE:'production',SELF_HOSTED:'true',APP_ORIGIN:s.origin,PUBLIC_APP_ORIGIN:undefined,IDENTITY_ORIGIN:undefined,LEGACY_PASSKEYS_DISABLED:'true',SCHOOL_ID:s.id,SCHOOL_NAME:'Mein IServ Zeitplaner',ISERV_ORIGIN:s.school,DAV_ORIGIN:s.dav,VAULT_KEY:s.vault,MONITOR_KEY:s.monitor,PASSKEY_BOOTSTRAP_HASH:undefined,
  VAPID_PUBLIC_KEY:s.vapidPublic,VAPID_PRIVATE_KEY:s.vapidPrivate,AUTH_MODE:'passkey',APP_STAGE:'production',MAX_FILE_BYTES:'52428800',PUBLICATION_MODE:'vault-put',GROUP_ROOT:'/Files/',PRIVATE_ROOT:'/Files/',ADDITIONAL_GROUP_ROOT:'/Groups/',LOCAL_DAV_ORIGIN:'',PRODUCTION_APPROVED:'true',TARGET_UPLOAD_APPROVED:'true',DAV_CAPABILITIES_APPROVED:'true',STAGING_SOURCE_REJECTED:'true',TARGET_PUT_REJECTED:'true',TARGET_NAMING:'unique-v1',UNIQUE_TARGET_APPROVED:'true',ORIGINAL_MOVE_APPROVED:'false',GROUP_MOVE_REJECTED:'true',COPY_CREATE_REJECTED:'true',CONFIRMED_REPLACE_ENABLED:'true',REQUIRE_NAMING_QUOTE:'true',NUMBERED_NAMING_ENABLED:'true',ALLOW_ACCOUNT_PASSWORD_STORAGE:'true',ACCOUNT_PASSWORD_REVIEW_ID:'personal-owner-consent-v1',ENFORCE_STORAGE_BUDGET:'true'};
}
