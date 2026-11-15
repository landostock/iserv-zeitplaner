import { AppError } from './security.ts';
import type { Env } from './types.ts';
/** Conservative per-owner daily ceiling; five owners stay below R2 free operation allowances. */
export async function chargeR2(env:Env,kind:'A'|'B'){
  if(env.ENFORCE_STORAGE_BUDGET!=='true')return;
  if(!env.DB)throw new AppError('setup_required',503);
  const day=new Date().toISOString().slice(0,10),key='r2:'+day+':'+kind,limit=kind==='A'?1500:7000;
  await env.DB.prepare("INSERT OR IGNORE INTO system_state(key,value) VALUES(?,'0')").bind(key).run();
  const accepted=await env.DB.prepare('UPDATE system_state SET value=CAST(value AS INTEGER)+1 WHERE key=? AND CAST(value AS INTEGER)<? RETURNING value').bind(key,limit).first();
  if(!accepted)throw new AppError('storage_budget_exceeded',429);
}
