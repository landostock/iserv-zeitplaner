import {AppError,path,within,sha256} from './security.ts';
import {publicationNonce} from './publication-name.ts';
import type {Env} from './types.ts';
export interface NameProbeResult {passed:boolean;files:string[];steps:{name:string;statuses:number[];verified:boolean}[];error?:string;}
export interface NameProbeDav {
  stat(file:string):Promise<unknown>;
  inspect(file:string):Promise<{size:number;sha256:string}|null>;
  publish(file:string,body:Uint8Array):Promise<void>;
  rename(source:string,target:string):Promise<number>;
}
/** Never enables a publication mode. Only new, random, harmless private probe files can be moved. */
export async function originalNameProbe(env:Env,school:string,owner:string,folder:string,consent:string,dav:NameProbeDav):Promise<NameProbeResult>{
  path(folder);if(!folder.endsWith('/')||!(within(folder,'/Files/')||env.ORIGINAL_MOVE_APPROVED==='true'&&within(folder,'/Groups/')&&folder!=='/Groups/'))throw new AppError('write_probe_private_only',403);
  if(consent!=='create-and-move-harmless-private-test-files')throw new AppError('name_probe_consent_required',409);
  const day=Math.floor(Date.now()/86400000),budget='name-probe:'+sha256(JSON.stringify([school,owner,day]));
  await env.DB.prepare("INSERT OR IGNORE INTO system_state(key,value) VALUES(?,'0')").bind(budget).run();
  if(!await env.DB.prepare('UPDATE system_state SET value=CAST(value AS INTEGER)+1 WHERE key=? AND CAST(value AS INTEGER)<3 RETURNING value').bind(budget).first())throw new AppError('name_probe_limit',429);
  const prefix=folder+'zeitplaner-namenstest-'+publicationNonce()+'-',names=['quelle-a','quelle-b','quelle-c','quelle-d','ziel-einzeln','ziel-parallel'],files=names.map(name=>prefix+name+'.txt');
  const result:NameProbeResult={passed:false,files,steps:[]};
  const bodies=[0,1,2,3].map(i=>new TextEncoder().encode('IServ Zeitplaner: eigene harmlose Verschiebepruefung '+String.fromCharCode(65+i)+'.\n'));
  async function check(file:string,body:Uint8Array){const got=await dav.inspect(file);return got?.size===body.length&&got.sha256===sha256(body);}
  function record(name:string,statuses:number[],verified:boolean){result.steps.push({name,statuses,verified});if(!verified)result.error='name_probe_unconfirmed';return verified;}
  try{
    for(const file of files)if(await dav.stat(file)){result.error='name_probe_existing';return result;}
    for(let i=0;i<4;i++){await dav.publish(files[i],bodies[i]);if(!record('Testquelle '+String.fromCharCode(65+i)+' anlegen und zurücklesen',[201],await check(files[i],bodies[i])))return result;}
    const first=await dav.rename(files[0],files[4]);
    if(!record('Auf freien Namen verschieben',[first],first===201&&await check(files[4],bodies[0])&&await dav.stat(files[0])===null))return result;
    const collision=await dav.rename(files[1],files[4]);
    if(!record('Vorhandenen Zielnamen schützen',[collision],collision===412&&await check(files[4],bodies[0])&&await check(files[1],bodies[1])))return result;
    const concurrent=await Promise.allSettled([dav.rename(files[2],files[5]),dav.rename(files[3],files[5])]);
    const statuses=concurrent.map(r=>r.status==='fulfilled'?r.value:0),winner=statuses.indexOf(201);
    const safe=statuses.filter(s=>s===201).length===1&&statuses.filter(s=>s===412).length===1;
    if(!record('Gleichzeitige Verschiebungen auf denselben neuen Namen',statuses,safe))return result;
    const loser=winner===0?1:0;
    if(!record('Gewinnerinhalt und unveränderte abgewiesene Quelle prüfen',[],await check(files[5],bodies[winner+2])&&await dav.stat(files[winner+2])===null&&await check(files[loser+2],bodies[loser+2])))return result;
    result.passed=true;
  }catch{result.error='name_probe_interrupted';}
  return result;
}
