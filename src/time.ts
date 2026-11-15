import { AppError } from './security.ts';
const formatter = new Intl.DateTimeFormat('sv-SE',{
  timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
});
export function berlinLocal(instant:number):string {
  const p=Object.fromEntries(formatter.formatToParts(new Date(instant)).map(v=>[v.type,v.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function berlinInstant(value:unknown):number {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new AppError('invalid_time');
  const base=Date.parse(value+'Z'); if(!Number.isFinite(base))throw new AppError('invalid_time');
  const matches=[base-3600000,base-7200000].filter(n=>berlinLocal(n)===value);
  if(matches.length===0)throw new AppError('time_missing');
  if(matches.length>1)throw new AppError('time_ambiguous');
  return matches[0];
}
