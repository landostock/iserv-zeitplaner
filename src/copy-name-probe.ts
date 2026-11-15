import {AppError,path,within,sha256} from './security.ts';
import {publicationNonce} from './publication-name.ts';
import type {Env} from './types.ts';
import type {NameProbeResult,NameProbeDav} from './original-name-probe.ts';
export interface CopyProbeDav extends Omit<NameProbeDav,'rename'>{copy(source:string,target:string):Promise<number>;}
/** Only four fresh harmless paths. Never grants a publication capability or deletes a file. */
export async function copyNameProbe(env:Env,school:string,owner:string,folder:string,consent:string,dav:CopyProbeDav):Promise<NameProbeResult>{
 if(env.COPY_CREATE_REJECTED==='true')throw new AppError('copy_probe_rejected',409);
 path(folder);if(!folder.endsWith('/')||!((within(folder,'/Files/')&&folder!=='/Files/')||(within(folder,'/Groups/')&&folder!=='/Groups/')))throw new AppError('invalid_path');
 if(consent!=='create-and-copy-four-harmless-test-files')throw new AppError('copy_probe_consent_required',409);
 const budget='copy-probe:'+sha256(JSON.stringify([school,owner,Math.floor(Date.now()/86400000)]));
 await env.DB.prepare("INSERT OR IGNORE INTO system_state(key,value) VALUES(?,'0')").bind(budget).run();
 if(!await env.DB.prepare('UPDATE system_state SET value=CAST(value AS INTEGER)+1 WHERE key=? AND CAST(value AS INTEGER)<3 RETURNING value').bind(budget).first())throw new AppError('name_probe_limit',429);
 const prefix=folder+'zeitplaner-kopiertest-'+publicationNonce()+'-',files=['quelle-a','quelle-b','ziel-einzeln','ziel-parallel'].map(n=>prefix+n+'.txt');
 const bodies=['A','B'].map(n=>new TextEncoder().encode('IServ Zeitplaner: eigene harmlose Kopierpruefung '+n+'.\n'));
 const result:NameProbeResult={passed:false,files,steps:[]};
 const check=async(file:string,body:Uint8Array)=>{const f=await dav.inspect(file);return f?.size===body.length&&f.sha256===sha256(body);};
 const record=(name:string,statuses:number[],verified:boolean)=>{result.steps.push({name,statuses,verified});if(!verified)result.error='copy_probe_unconfirmed';return verified;};
 try{
  for(const file of files)if(await dav.stat(file)){result.error='name_probe_existing';return result;}
  for(let i=0;i<2;i++){await dav.publish(files[i],bodies[i]);if(!record('Testquelle '+['A','B'][i]+' anlegen und zurücklesen',[201],await check(files[i],bodies[i])))return result;}
  const first=await dav.copy(files[0],files[2]);if(!record('Auf freien Namen kopieren',[first],first===201&&await check(files[2],bodies[0])&&await check(files[0],bodies[0])))return result;
  const blocked=await dav.copy(files[1],files[2]);if(!record('Vorhandenen Zielinhalt schützen',[blocked],blocked===412&&await check(files[2],bodies[0])&&await check(files[1],bodies[1])))return result;
  const concurrent=await Promise.allSettled([dav.copy(files[0],files[3]),dav.copy(files[1],files[3])]);const statuses=concurrent.map(r=>r.status==='fulfilled'?r.value:0);
  if(!record('Gleichzeitige Kopien auf denselben Namen',statuses,statuses.filter(s=>s===201).length===1&&statuses.filter(s=>s===412).length===1))return result;
  if(!record('Gewinner und unveränderte Quellen prüfen',[],await check(files[3],bodies[statuses.indexOf(201)])&&await check(files[0],bodies[0])&&await check(files[1],bodies[1])))return result;
  result.passed=true;
 }catch{result.error='copy_probe_interrupted';}
 return result;
}
