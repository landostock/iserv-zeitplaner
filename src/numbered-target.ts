import {AppError,filename,path} from './security.ts';
import {numberedFilename} from './numbered-filename.ts';
export interface CollisionRules {sameSize:boolean;otherSize:boolean;}
type Info={size:number|null}|null;
/** Read-only decision at execution time. A protected create is still required afterwards. */
export async function selectNumberedTarget(folder:string,name:string,size:number,rules:CollisionRules,stat:(target:string)=>Promise<Info>,limit=1000){
 path(folder);filename(name);if(!folder.endsWith('/')||!Number.isSafeInteger(size)||size<=0||!Number.isInteger(limit)||limit<1||limit>1000||typeof rules.sameSize!=='boolean'||typeof rules.otherSize!=='boolean')throw new AppError('invalid_request');
 const target=folder+name,existing=await stat(target);
 if(existing===null)return {target,replace:false,number:null};
 if(existing.size!==null&&(existing.size===size?rules.sameSize:rules.otherSize))return {target,replace:true,number:null};
 for(let n=2;n<limit+2;n++){
  const candidate=folder+numberedFilename(name,n);
  if(await stat(candidate)===null)return {target:candidate,replace:false,number:n};
 }
 throw new AppError('numbered_names_exhausted',409);
}
