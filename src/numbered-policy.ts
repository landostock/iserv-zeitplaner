import {AppError,filename} from './security.ts';
import {temporaryPublicationName} from './publication-name.ts';
import type {Payload} from './types.ts';
export const NUMBERING_POLICY='number-if-occupied-allow-concurrent-change-risk';
export const MAX_NUMBER=1001;
/** Preserve the user's complete stem, including any user-entered existing number. */
export function numberedName(name:string,n:number|null){
 const normalized=filename(name);if(n===null)return normalized;
 if(!Number.isSafeInteger(n)||n<2||n>MAX_NUMBER)throw new AppError('invalid_filename');
 const dot=normalized.lastIndexOf('.');return filename((dot>0?normalized.slice(0,dot):normalized)+' ('+n+')'+(dot>0?normalized.slice(dot):''));
}
export function validateNumberedName(name:string){
 for(const n of [null,MAX_NUMBER])if(new TextEncoder().encode(numberedName(name,n)).length>240)throw new AppError('filename_too_long');
}
export function numberedTargetMatches(d:Pick<Payload,'folder'|'filename'>,target:string){
 if(target===d.folder+d.filename)return true;
 if(!target.startsWith(d.folder))return false;
 const name=target.slice(d.folder.length),match=/ \((\d+)\)(?:\.[^.]*)?$/.exec(name);
 // Derive the exact candidate rather than accepting a path based on a loose regexp.
 if(!match)return false;
 try{return target===d.folder+numberedName(d.filename,Number(match[1]));}catch{return false;}
}
export function requireNumberedPayload(d:Payload){
 if(d.numberingPolicy!==NUMBERING_POLICY||!Number.isSafeInteger(d.numberingAcceptedAt)||(d.numberingAcceptedAt||0)<=0||!d.targetNonce||!/^[a-f0-9]{32}$/.test(d.targetNonce)||d.temporaryTarget!==d.folder+temporaryPublicationName(d.targetNonce)||d.target!==''&&!numberedTargetMatches(d,d.target))throw new AppError('numbering_consent_required',409);
 validateNumberedName(d.filename);
}
