import type {Env,Principal,Runtime} from './types.ts';
import {AppError,demoAllowed,filename,maxFile,path,seal,unseal,within} from './security.ts';
import {DEMO_GROUP} from './demo.ts';
import {authorizeUntil} from './runtime.ts';
import {berlinInstant} from './time.ts';
import {publicationName,publicationNonce} from './publication-name.ts';

import {validateNumberedName} from './numbered-policy.ts';
export type Naming='unique-v1'|'replace-v1'|'numbered-v1';
export const quoteContext=(env:Env,p:Principal,version=1)=>`naming-quote:v${version}:${p.school}:${p.owner}:${env.APP_ORIGIN}`;
export function planningInput(env:Env,input:any){
 const name=filename(input.filename),folder=path(input.folder),due=berlinInstant(input.localTime);
 const root=demoAllowed(env)?DEMO_GROUP:env.GROUP_ROOT!;
 if(!folder.endsWith('/')||!within(folder,root)&&!(env.PUBLICATION_MODE==='vault-put'&&env.ADDITIONAL_GROUP_ROOT&&within(folder,env.ADDITIONAL_GROUP_ROOT)))throw new AppError('invalid_path');
 if(!Number.isSafeInteger(input.size)||input.size<=0||input.size>maxFile(env))throw new AppError('file_too_large',413);
 if(typeof input.sha256!=='string'||!/^[a-f0-9]{64}$/.test(input.sha256)||typeof input.key!=='string'||!/^[a-zA-Z0-9-]{20,80}$/.test(input.key))throw new AppError('invalid_request');
 if(input.expectedNaming!=='unique-v1'&&input.expectedNaming!=='replace-v1'&&input.expectedNaming!=='numbered-v1')throw new AppError('invalid_request');
 if(input.expectedNaming==='numbered-v1'&&(input.planningVersion!==3||env.NUMBERED_NAMING_ENABLED!=='true'))throw new AppError('numbering_unavailable',409);
 if(input.expectedNaming==='replace-v1'&&env.CONFIRMED_REPLACE_ENABLED!=='true')throw new AppError('replacement_unavailable',409);
 return {filename:name,folder,size:input.size as number,sha256:input.sha256 as string,localTime:input.localTime as string,key:input.key as string,naming:input.expectedNaming as Naming,due};
}
type Plan=ReturnType<typeof planningInput>;
export interface NamingQuote {v:1|2;plan:Plan;accountIdentity:string|null;target:string;nonce:string;issuedAt:number;expiresAt:number;}
function nameFor(plan:Plan,nonce:string){
 if(plan.naming==='numbered-v1'){validateNumberedName(plan.filename);return plan.filename;}
 if(plan.naming==='replace-v1'){
  if(new TextEncoder().encode(plan.filename).length>240)throw new AppError('filename_too_long');
  return plan.filename;
 }
 let result:string;try{result=publicationName(plan.filename,nonce);}catch{throw new AppError('filename_too_long');}
 const dot=plan.filename.lastIndexOf('.'),stem=dot>0?plan.filename.slice(0,dot):plan.filename,extension=dot>0?plan.filename.slice(dot):'';
 if(result!==stem+' ['+nonce+']'+extension)throw new AppError('filename_too_long');
 return result;
}
export async function createNamingQuote(env:Env,p:Principal,input:any,rt:Runtime){
 const plan=planningInput(env,input),now=rt.now();
 if(plan.due<=now+30000||plan.due>now+366*86400000)throw new AppError('time_out_of_range');
 await authorizeUntil(env,p.school,p.owner,plan.due);
 // Only load the existing connection identity. No IServ file request or login is made here.
 const accountIdentity=(await rt.storage(p.school,p.owner)).accountIdentity||null,nonce=publicationNonce();
 const publishedFilename=nameFor(plan,nonce);
 const version=input.planningVersion===3?2:1;
 const quote:NamingQuote={v:version,plan,accountIdentity,target:plan.naming==='numbered-v1'?'':plan.folder+publishedFilename,nonce,issuedAt:now,expiresAt:now+15*60000};
 const namingQuote=await seal(env,quoteContext(env,p,version),quote);
 if(new TextEncoder().encode(namingQuote).length>8192)throw new AppError('invalid_request');
 return {publishedFilename,finalNameAtPublication:plan.naming==='numbered-v1',targetNaming:plan.naming,expiresAt:quote.expiresAt,namingQuote};
}
export async function readNamingQuote(env:Env,p:Principal,input:any,accountIdentity:string|null,now:number,allowExpired=false){
 const token=input.namingQuote;
 if(typeof token!=='string'||new TextEncoder().encode(token).length>8192)throw new AppError('naming_quote_invalid',409);
 const version=input.planningVersion===3?2:1;
 let q:NamingQuote;try{q=await unseal<NamingQuote>(env,quoteContext(env,p,version),token);}catch{throw new AppError('naming_quote_invalid',409);}
 const plan=planningInput(env,input);if(plan.naming==='numbered-v1')validateNumberedName(plan.filename);
 if(!q||q.v!==version||JSON.stringify(q.plan)!==JSON.stringify(plan)||q.accountIdentity!==accountIdentity||typeof q.nonce!=='string'||!/^[a-f0-9]{32}$/.test(q.nonce)||q.target!==(plan.naming==='numbered-v1'?'':plan.folder+nameFor(plan,q.nonce))||!Number.isSafeInteger(q.issuedAt)||!Number.isSafeInteger(q.expiresAt)||q.expiresAt-q.issuedAt!==15*60000||q.issuedAt>now)throw new AppError('naming_quote_invalid',409);
 if(!allowExpired&&q.expiresAt<=now)throw new AppError('naming_quote_expired',409);
 return q;
}
