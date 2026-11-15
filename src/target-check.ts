import {selectNumberedTarget} from './numbered-target.ts';
import {AppError,path,filename,maxFile,within,demoAllowed} from './security.ts';
import {DEMO_GROUP} from './demo.ts';
import type {Env,Principal,Runtime,Storage} from './types.ts';
export {numberedFilename} from './numbered-filename.ts';
async function info(storage:Storage,file:string){return storage.targetInfo?storage.targetInfo(file):storage.stat(file);}
/** Snapshot only. No reservation and no authorization to overwrite, regardless of size. */
export async function checkTarget(env:Env,p:Principal,input:any,rt:Runtime){
 const folder=path(input.folder),name=filename(input.filename),root=demoAllowed(env)?DEMO_GROUP:env.GROUP_ROOT!;
 if(!folder.endsWith('/')||!(within(folder,root)||env.ADDITIONAL_GROUP_ROOT&&within(folder,env.ADDITIONAL_GROUP_ROOT)))throw new AppError('invalid_path');
 if(!Number.isSafeInteger(input.size)||input.size<=0||input.size>maxFile(env))throw new AppError('invalid_request');
 const storage=await rt.storage(p.school,p.owner),found=await info(storage,folder+name);
 let suggestion:string|null=null;
 if(found&&input.planningVersion!==2){try{const chosen=await selectNumberedTarget(folder,name,input.size,{sameSize:false,otherSize:false},target=>target===folder+name?Promise.resolve(found):info(storage,target),32);suggestion=chosen.target.slice(folder.length);}catch(error){if(!(error instanceof AppError)||!['invalid_filename','numbered_names_exhausted'].includes(error.code))throw error;}}
 return {filename:name,exists:found!==null,size:found?.size??null,sameSize:found?.size===input.size,suggestion,checkedAt:Date.now(),reserved:false};
}
