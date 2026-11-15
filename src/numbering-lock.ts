import {AppError,random} from './security.ts';
/** A short app-only folder turn; independent per-target reservations never expire on a timer. */
export async function numberingLock(storage:DurableObjectStorage,input:any,now=Date.now()){
 if(!/^[a-f0-9]{64}$/.test(input?.scope)||!/^[a-f0-9]{64}$/.test(input?.holder)||!['acquire','release','reserve','unreserve'].includes(input?.action))throw new AppError('invalid_request');
 if(['reserve','unreserve'].includes(input.action)&&!/^[a-f0-9]{64}$/.test(input.target))throw new AppError('invalid_request');
 const key='numbering-turn:'+input.scope;
 return storage.transaction(async tx=>{
  const current=await tx.get<{holder:string;token:string;expiresAt:number}>(key);
  if(input.action==='acquire'){
   if(current&&current.expiresAt>now)return current.holder===input.holder?current.token:null;
   const token=random();await tx.put(key,{holder:input.holder,token,expiresAt:now+60000});return token;
  }
  if(input.action==='reserve'||input.action==='unreserve'){
   const targetKey='numbering-target:'+input.scope+':'+input.target,owner=await tx.get<string>(targetKey);
   if(input.action==='unreserve'){if(owner===input.holder)await tx.delete(targetKey);return null;}
   if(!current||current.holder!==input.holder||current.token!==input.token||current.expiresAt<=now)throw new AppError('job_changed',409);
   if(owner&&owner!==input.holder)return null;await tx.put(targetKey,input.holder);return input.token;
  }
  if(current&&current.holder===input.holder&&current.token===input.token)await tx.delete(key);
  return null;
 });
}

export async function numberingReservations(storage:DurableObjectStorage,scope:string){
 if(!/^[a-f0-9]{64}$/.test(scope))throw new AppError('invalid_request');
 const prefix='numbering-target:'+scope+':',rows=await storage.list<string>({prefix,limit:257});
 if(rows.size>256)throw new AppError('numbering_attempt_limit',409);return [...rows.keys()].map(k=>k.slice(prefix.length));
}
