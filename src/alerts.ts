import type { Env } from './types.ts';
export interface Health {lastRun:number;overdue:number;attention:number;unavailable:number;}
/** Optional operator-configured delivery; aggregate counts only, no account, path or file content. */
export async function notifyHealth(env:Env,health:Health,previous:{fingerprint:string;sentAt:number}|undefined,fetcher:typeof fetch=globalThis.fetch.bind(globalThis)){
  if(!env.ALERT_WEBHOOK_URL)return previous;
  const u=new URL(env.ALERT_WEBHOOK_URL);
  if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search)throw new Error('Alarmziel ist nicht gültig.');
  const fingerprint=JSON.stringify([health.overdue,health.attention,health.unavailable]);
  if(!health.overdue&&!health.attention&&!health.unavailable)return undefined;
  if(previous?.fingerprint===fingerprint&&health.lastRun-previous.sentAt<3600000)return previous;
  const r=await fetcher(u,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',...(env.ALERT_WEBHOOK_TOKEN?{Authorization:'Bearer '+env.ALERT_WEBHOOK_TOKEN}:{})},
    body:JSON.stringify({event:'iserv-zeitplaner-needs-attention',at:health.lastRun,overdue:health.overdue,attention:health.attention,unavailable:health.unavailable})});
  await r.body?.cancel();if(!r.ok)throw new Error('Alarm konnte nicht zugestellt werden.');
  return {fingerprint,sentAt:health.lastRun};
}
