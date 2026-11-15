export interface Env {
  DB: D1Database; ASSETS: Fetcher;
  SELF_HOSTED?:string; SETUP_CODE?:string; INSTALLATION?:DurableObjectNamespace;
  MODE: 'demo' | 'production'; APP_ORIGIN: string; SCHOOL_ID: string; SCHOOL_NAME: string;
  PUBLIC_APP_ORIGIN?:string; IDENTITY_ORIGIN?:string;
  LEGACY_PASSKEYS_DISABLED?:string;
  MAX_FILE_BYTES?: string; VAULT_KEY?: string; PRODUCTION_APPROVED?: string;
  ISERV_ORIGIN?: string; DAV_ORIGIN?: string; GROUP_ROOT?: string; PRIVATE_ROOT?: string;
  DAV_CAPABILITIES_APPROVED?: string;
  STAGING_SOURCE_REJECTED?:string;
  TARGET_PUT_REJECTED?:string;
  TARGET_NAMING?:'original'|'unique-v1'; UNIQUE_TARGET_APPROVED?:string;
  ORIGINAL_MOVE_APPROVED?:string;
  GROUP_MOVE_REJECTED?:string;
  COPY_CREATE_REJECTED?:string;
  CONFIRMED_REPLACE_ENABLED?:string;
  REQUIRE_NAMING_QUOTE?:string;
  NUMBERED_NAMING_ENABLED?:string;
  GATE?:DurableObjectNamespace;
  ALLOW_ACCOUNT_PASSWORD_STORAGE?:string; ACCOUNT_PASSWORD_REVIEW_ID?:string;
  OIDC_ISSUER?: string; OIDC_DISCOVERY_URL?: string; OIDC_CLIENT_ID?: string; OIDC_CLIENT_SECRET?: string;
  OIDC_ALLOWED_SUBJECTS?: string;
  API_LIMIT?:{limit(input:{key:string}):Promise<{success:boolean}>};
  AUTH_LIMIT?:{limit(input:{key:string}):Promise<{success:boolean}>};
  MONITOR_KEY?: string;
  LOCAL_DAV_ORIGIN?:string;
  PUBLICATION_MODE?:'legacy-move'|'vault-put'; TARGET_UPLOAD_APPROVED?:string;
  FILES?:R2Bucket; AUTH_MODE?:'oidc'|'access'|'passkey'; ACCESS_ISSUER?:string; ACCESS_AUD?:string; ACCESS_EMAILS?:string;
  PASSKEY_BOOTSTRAP_HASH?:string;
  VAPID_PUBLIC_KEY?:string; VAPID_PRIVATE_KEY?:string;
  APP_STAGE?:'personal-pilot'|'group-pilot'|'production';
  ADDITIONAL_GROUP_ROOT?:string;
  ALERT_WEBHOOK_URL?:string; ALERT_WEBHOOK_TOKEN?:string;
  ENFORCE_STORAGE_BUDGET?:string;
  VAULT_OBJECTS?:DurableObjectNamespace;
}
export interface Principal { school: string; owner: string; name: string; csrf: string; }
export type Status = 'preparing'|'scheduled'|'publishing'|'retry_wait'|'reconciling'|'published'|'cancelled'|'conflict'|'needs_auth'|'needs_review'|'failed';
export interface Payload { filename: string; folder: string; source: string; target: string; size: number; sha256: string; localTime: string; targetNaming?:'unique-v1'|'original-move-v1'|'replace-v1'|'numbered-v1'; targetNonce?:string; temporaryTarget?:string; accountIdentity?:string; writeVerifiedAtPlan?:boolean; originalMoveVerifiedAtPlan?:boolean; numberingPolicy?:string; numberingAcceptedAt?:number; replacementConsentTarget?:string; replacementAcceptedAt?:number; collisionRules?:{sameSize:boolean;otherSize:boolean}; }
export interface Job {
  school_id: string; owner_id: string; id: string; idempotency_key: string; fingerprint: string; payload: string;
  status: Status; due_at: number; next_attempt_at: number; revision: number; attempts: number;
  lease_token: string|null; lease_until: number|null; operation_started_at: number|null;
  confirmed_at: number|null; created_at: number; updated_at: number; error_code: string|null; staging_etag: string|null;
  source_cleaned_at?:number|null;
  operation_phase?:string|null;
  manual_read_only?:number;
}
export interface Folder { path: string; name: string; writable: boolean; permission: 'confirmed'|'read_only'|'unknown'; }
export interface FileInfo { size: number; sha256: string; etag: string; }
export interface Storage {
  readonly accountIdentity?:string;
  list(path: string): Promise<Folder[]>;
  canWrite(path: string): Promise<boolean>;
  namesInFolder?(folder:string):Promise<string[]>;
  stat(path: string): Promise<{size:number;etag:string}|null>;
  inspect(path: string): Promise<FileInfo|null>;
  put(path: string, body: Uint8Array): Promise<void>;
  move(source: string,target: string,etag: string): Promise<void>;
  remove(path: string,etag: string): Promise<void>;
  publish?(path:string,body:Uint8Array):Promise<void>;
  renameNew?(source:string,target:string):Promise<void>;
  originalNameReady?(path:string):Promise<boolean>;
  renameReplacing?(source:string,target:string):Promise<void>;
  renameNumbered?(source:string,target:string):Promise<void>;
  targetInfo?(path:string):Promise<{size:number|null;etag:string}|null>;
  folderAccess?(path:string):Promise<{writable:boolean;permission:Folder['permission'];canProbe:boolean;proofAt:number|null}>;
  verifyFolder?(path:string,consent:string):Promise<{verified:boolean;file:string|null;proofAt?:number|null;error?:string;httpStatus?:number;cleanup?:'removed'|'retained'|'uncertain';cleanupHttpStatus?:number}>;
  testNumberedNames?(path:string,consent:string):Promise<import('./original-name-probe.ts').NameProbeResult>;
  testOriginalNames?(path:string,consent:string):Promise<import('./original-name-probe.ts').NameProbeResult>;
}
export interface SourceVault {
  key(id:string):string;
  put(key:string,body:Uint8Array,expected:{size:number;sha256:string}):Promise<{etag:string}>;
  read(key:string,expected:{size:number;sha256:string},etag?:string):Promise<{body:Uint8Array;etag:string}>;
  remove(key:string):Promise<void>;
  claim?(key:string,phase?:'rename'):Promise<string|null>;
  reject?(key:string,claim:string,status:number,phase?:'rename'):Promise<void>;
  numberedState?(key:string):Promise<{sequence:string;target:string;rejected:boolean}|null>;
  claimNumbered?(key:string,target:string):Promise<string|null>;
  rejectNumbered?(key:string,claim:string,status:number):Promise<void>;
  pendingClaim?(key:string,phase:'rename'):Promise<boolean>;
}
export interface Runtime { numberingReservations?:(school:string,folder:string)=>Promise<string[]>; numberingLock?:(school:string,owner:string,folder:string,id:string,action:'acquire'|'release'|'reserve'|'unreserve',token?:string,target?:string)=>Promise<string|null>; now: () => number; storage: (school:string,owner:string) => Promise<Storage>; vault?:(school:string,owner:string)=>SourceVault; }
export interface ConnectionSecret {authorization:string;expiresAt:number|null;kind:'bearer'|'app-password'|'account-password';reviewId:string;}
