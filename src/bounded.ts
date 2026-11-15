import { AppError } from './security.ts';
// The 128 MB budget is shared by objects in an isolate. Admit only one file-buffering operation.
let queue:Promise<unknown>=Promise.resolve(),waiting=0;
export async function bounded<T>(run:()=>Promise<T>):Promise<T>{
  if(waiting>=32)throw new AppError('too_many_requests',429);waiting++;
  const result=queue.then(run,run);queue=result.catch(()=>{});
  try{return await result;}finally{waiting--;}
}
