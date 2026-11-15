import { callback, beginLogin, csrf, demoLogin, logout, session } from './auth.ts';
import {legacyPasskeysAvailable} from './public-origin.ts';
import { changeJob, createJob, ownJob, publicJob, upload } from './jobs.ts';
import { runtime } from './runtime.ts';
import { tick } from './scheduler.ts';
import { AppError, demoAllowed, maxFile, path, productionReady, rateKey, readLimited, requireExecution } from './security.ts';
import { DEMO_GROUP } from './demo.ts';
import { localProbe, LocalProbeError } from './local-probe.ts';
import { localWriteProbe, localTestFileProbe, LocalWriteProbeError } from './local-write-probe.ts';
import { localLockProbe } from './local-lock-probe.ts';
import { startUiLockProbe, decideUiLockProbe } from './local-ui-lock-probe.ts';
import type { Env, Job, Runtime, Principal } from './types.ts';
import { localTargetProbe } from './local-target-probe.ts';
import {passkeyReady} from './passkey-auth.ts';
import {pushStatus,savePush,removePush,notifyPush} from './push.ts';
import {createNamingQuote} from './naming-quote.ts';
import {checkTarget} from './target-check.ts';

function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
async function input(request:Request){if(!request.headers.get('content-type')?.startsWith('application/json'))throw new AppError('invalid_request',415);try{const data=JSON.parse(new TextDecoder().decode(await readLimited(request,16000)));if(!data||typeof data!=='object'||Array.isArray(data))throw new AppError('invalid_request');return data;}catch(e){if(e instanceof AppError)throw e;throw new AppError('invalid_request');}}
async function route(request:Request,env:Env,rt:Runtime,ctx?:ExecutionContext,principal?:Principal):Promise<Response>{
  const url=new URL(request.url);
  if(url.origin!==env.APP_ORIGIN)return json({error:'origin_mismatch'},421);
  if(env.MODE==='demo'&&!demoAllowed(env))return json({error:'setup_required'},503);
  if(env.MODE==='production'&&(url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/'))){
    const limiter=url.pathname.startsWith('/auth/')?env.AUTH_LIMIT:env.API_LIMIT;
    if(!limiter||!env.VAULT_KEY)throw new AppError('setup_required',503);
    if(!(await limiter.limit({key:rateKey(env,request)})).success)throw new AppError('too_many_requests',429);
  }
  if(url.pathname==='/auth/login'&&request.method==='GET'){
    const login=await beginLogin(env);return new Response(null,{status:302,headers:{Location:login.location,'Set-Cookie':login.cookie}});
  }
  if(url.pathname==='/auth/callback'&&request.method==='GET'){
    const result=await callback(env,request);const headers=new Headers({Location:'/'});headers.append('Set-Cookie',result.cookie);headers.append('Set-Cookie',result.flowCookie);return new Response(null,{status:303,headers});
  }
  if(url.pathname==='/api/demo/login'&&request.method==='POST')return new Response(null,{status:204,headers:{'Set-Cookie':await demoLogin(env,request)}});
  if(url.pathname==='/api/session'&&request.method==='GET'){
    const p=principal||await session(env,request);const heartbeat=await env.DB.prepare("SELECT value FROM system_state WHERE key='cron_finished'").first<{value:string}>();
    return json({mode:env.MODE,selfHosted:env.SELF_HOSTED==='true',ready:demoAllowed(env)||productionReady(env),school:env.SCHOOL_NAME,user:p?{id:p.owner,name:p.name,csrf:p.csrf}:null,
      integrationBlock:env.NUMBERED_NAMING_ENABLED==='true'?'Automatische Nummerierung wählt den Wunschname oder die kleinste freie Nummer erst bei Veröffentlichung. Bei gleichzeitigen Änderungen durch andere IServ-Programme bleibt unbeabsichtigtes Ersetzen möglich. Der frühere Nichtüberschreibschutz ist weiterhin nicht bestätigt.':env.GROUP_MOVE_REJECTED==='true'?'Der bisherige Schutz vor Ersetzen ist hier nicht verlässlich bestätigt. '+(env.CONFIRMED_REPLACE_ENABLED==='true'?'Unveränderte Dateinamen sind mit einer ausdrücklichen Ersetzungserlaubnis pro Auftrag möglich. Ohne diese Erlaubnis erhält jede Veröffentlichung einen eindeutigen Zusatz.':'Das bisherige Originalnamen-Verfahren ist angehalten. Neue Veröffentlichungen verwenden eindeutige Namenszusätze.'):env.ORIGINAL_MOVE_APPROVED==='true'?'Originalnamen sind im geprüften privaten Pilotbereich möglich. Gruppenordner benötigen ihre eigene Namensprüfung. Vorhandene Dateien werden nicht ersetzt; bestehende Aufträge behalten ihr Verfahren.':env.TARGET_NAMING==='unique-v1'?'Variante mit eigenem Dateinamen je Veröffentlichung: Gleichnamige Dateien erhalten einen eindeutigen Zusatz. Der bekannte IServ-Kollisionsfehler ist dadurch nicht behoben.'+(demoAllowed(env)?' Diese Planung verwendet ausschließlich lokale Beispieldaten.':'')+(!productionReady(env)?' Echte Veröffentlichungen sind noch nicht freigegeben.':''):env.TARGET_PUT_REJECTED==='true'?'Echte IServ-Veröffentlichung gesperrt: Zwei gleichzeitige Anlegeversuche meldeten beide Erfolg; der notwendige Überschreibschutz ist nicht bestätigt.'+(demoAllowed(env)?' Die Planung hier verwendet ausschließlich lokale Beispieldaten.':' Echte Planung und Ausführung bleiben gesperrt.'):env.PUBLICATION_MODE==='vault-put'&&demoAllowed(env)?'Lokaler Probelauf des neuen Zeitplaners: verschlüsselte Dateiablage und gespeicherte Alarme. Die Veröffentlichung erfolgt ausschließlich in simulierte Beispielordner, niemals an IServ.':env.STAGING_SOURCE_REJECTED==='true'?'Der bisherige Veröffentlichungsweg ist für euren IServ nicht freigegeben: Im Vergleichstest konnte eine Datei trotz Sperre verändert werden. Die Planung in dieser Testumgebung verwendet weiterhin nur lokale Beispieldaten.':null,
      numberedNamingEnabled:env.NUMBERED_NAMING_ENABLED==='true',copyProbeBlocked:env.COPY_CREATE_REJECTED==='true',targetNaming:env.TARGET_NAMING||'original',confirmedReplaceEnabled:env.CONFIRMED_REPLACE_ENABLED==='true',targetCheckAvailable:true,originalMoveEnabled:env.ORIGINAL_MOVE_APPROVED==='true'&&env.GROUP_MOVE_REJECTED!=='true',originalGroupsBlocked:env.GROUP_MOVE_REJECTED==='true',stage:env.APP_STAGE||'production',rootLabel:env.ADDITIONAL_GROUP_ROOT?'IServ-Dateien':env.APP_STAGE==='personal-pilot'?'Eigene Testdateien':'Gruppen',historyRetentionDays:env.PUBLICATION_MODE==='vault-put'?90:null,
      legacyPasskeyAvailable:legacyPasskeysAvailable(env),legacyLoginOrigin:legacyPasskeysAvailable(env)?env.IDENTITY_ORIGIN:null,accountManagementAvailable:env.MODE==='production'&&env.AUTH_MODE==='passkey',authMode:env.AUTH_MODE||'oidc',authReady:env.AUTH_MODE==='passkey'?passkeyReady(env):demoAllowed(env)||productionReady(env),
      groupRoot:demoAllowed(env)?DEMO_GROUP:env.ADDITIONAL_GROUP_ROOT?'/':env.GROUP_ROOT,maxFileBytes:maxFile(env),lastSchedulerRun:heartbeat?Number(heartbeat.value):null});
  }
  if(url.pathname==='/health'&&request.method==='GET'){
    if(!env.MONITOR_KEY||request.headers.get('authorization')!==`Bearer ${env.MONITOR_KEY}`)throw new AppError('not_found',404);
    const row=await env.DB.prepare("SELECT value FROM system_state WHERE key='cron_finished'").first<{value:string}>();
    const overdue=await env.DB.prepare("SELECT count(*) AS n FROM jobs WHERE school_id=? AND status IN ('scheduled','retry_wait','publishing','reconciling') AND due_at<?").bind(env.SCHOOL_ID,rt.now()-15*60000).first<{n:number}>();
    const alerts=await env.DB.prepare("SELECT count(*) AS n FROM notifications WHERE school_id=? AND read_at IS NULL AND kind IN ('failed','needs_auth','needs_review','conflict')").bind(env.SCHOOL_ID).first<{n:number}>();
    const healthy=Boolean(row&&rt.now()-Number(row.value)<180000&&!overdue?.n&&!alerts?.n);
    return json({healthy,lastRun:row?Number(row.value):null,overdue:overdue?.n||0,unreadAlerts:alerts?.n||0},healthy?200:503);
  }
  if(url.pathname.startsWith('/api/')){
    const p=principal||await session(env,request);if(!p)throw new AppError('login_required',401);
    if(request.method!=='GET')csrf(env,request,p);
    if(url.pathname==='/api/logout'&&request.method==='POST')return new Response(null,{status:204,headers:{'Set-Cookie':await logout(env,request)}});
    if(url.pathname==='/api/push'){
      if(request.method==='GET')return json(await pushStatus(env,p));
      if(request.method==='POST')return json(await savePush(env,p,await input(request)));
      if(request.method==='DELETE'){await removePush(env,p,await input(request));return new Response(null,{status:204});}
    }
    if(url.pathname==='/api/push/test'&&request.method==='POST'){
      const previous=await env.DB.prepare("SELECT value FROM system_state WHERE key='push-test-last'").first<{value:string}>();
      if(previous&&Date.now()-Number(previous.value)<60000)throw new AppError('too_many_requests',429);
      await env.DB.prepare("INSERT OR REPLACE INTO system_state(key,value) VALUES('push-test-last',?)").bind(String(Date.now())).run();
      const delivery=await notifyPush(env,undefined,p.owner);return json({...await pushStatus(env,p),delivery});
    }
    if(url.pathname==='/api/local-probe'&&request.method==='POST')return json(await localProbe(env,await input(request)));
    if(url.pathname==='/api/local-write-probe'&&request.method==='POST')return json(await localWriteProbe(env,await input(request)));
    if(url.pathname==='/api/local-test-file-probe'&&request.method==='POST')return json(await localTestFileProbe(env,await input(request)));
    if(url.pathname==='/api/local-lock-probe'&&request.method==='POST')return json(await localLockProbe(env,await input(request)));
    if(url.pathname==='/api/local-target-probe'&&request.method==='POST')return json(await localTargetProbe(env,await input(request)));
    if(url.pathname==='/api/local-ui-lock-probe'&&request.method==='POST')return startUiLockProbe(env,p,await input(request),ctx);
    const decision=/^\/api\/local-ui-lock-probe\/([a-f0-9-]{36})\/decision$/.exec(url.pathname);
    if(decision&&request.method==='POST')return json(decideUiLockProbe(env,p,decision[1],await input(request)));
    if(url.pathname==='/api/notifications/read'&&request.method==='POST'){
      await env.DB.prepare("UPDATE notifications SET read_at=? WHERE school_id=? AND owner_id=? AND read_at IS NULL AND kind IN ('failed','needs_auth','needs_review','conflict')").bind(rt.now(),p.school,p.owner).run();return new Response(null,{status:204});
    }
    if(url.pathname==='/api/folders'&&request.method==='GET'){
      requireExecution(env);
      const folder=path(url.searchParams.get('path')||(demoAllowed(env)?DEMO_GROUP:env.ADDITIONAL_GROUP_ROOT?'/':env.GROUP_ROOT!));const storage=await rt.storage(p.school,p.owner);
      const access=storage.folderAccess?await storage.folderAccess(folder):null;
      return json({folders:await storage.list(folder),currentWritable:access?access.writable:await storage.canWrite(folder),currentPermission:access?.permission,canProbe:access?.canProbe||false,proofAt:access?.proofAt||null,originalNameReady:env.ORIGINAL_MOVE_APPROVED==='true'&&Boolean(await storage.originalNameReady?.(folder))});
    }
    if(url.pathname==='/api/naming-quote'&&request.method==='POST'){requireExecution(env);return json(await createNamingQuote(env,p,await input(request),rt));}
    if(url.pathname==='/api/target-check'&&request.method==='POST'){
      requireExecution(env);return json(await checkTarget(env,p,await input(request),rt));
    }
    if(url.pathname==='/api/folders/verify'&&request.method==='POST'){
      requireExecution(env);const d=await input(request),storage=await rt.storage(p.school,p.owner);
      if(!storage.verifyFolder)throw new AppError('folder_probe_unavailable',409);
      return json(await storage.verifyFolder(path(d.path),d.consent));
    }
    if(url.pathname==='/api/folders/numbering-probe'&&request.method==='POST'){
      requireExecution(env);if(env.COPY_CREATE_REJECTED==='true')throw new AppError('copy_probe_rejected',409);const d=await input(request),storage=await rt.storage(p.school,p.owner);
      if(!storage.testNumberedNames)throw new AppError('name_probe_unavailable',409);
      return json(await storage.testNumberedNames(path(d.path),d.consent));
    }
    if(url.pathname==='/api/folders/name-probe'&&request.method==='POST'){
      requireExecution(env);const d=await input(request),storage=await rt.storage(p.school,p.owner);
      if(!storage.testOriginalNames)throw new AppError('name_probe_unavailable',409);
      return json(await storage.testOriginalNames(path(d.path),d.consent));
    }
    if(url.pathname==='/api/jobs'&&request.method==='GET'){
      const {results}=await env.DB.prepare('SELECT * FROM jobs WHERE school_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 200').bind(p.school,p.owner).all<Job>();
      return json({jobs:await Promise.all(results.map(j=>publicJob(env,j)))});
    }
    if(url.pathname==='/api/jobs'&&request.method==='POST'){requireExecution(env);return json(await publicJob(env,await createJob(env,p,await input(request),rt)),201);}
    const match=/^\/api\/jobs\/([a-f0-9-]{36})(\/file)?$/.exec(url.pathname);
    if(match){
      if(request.method==='GET'&&!match[2])return json(await publicJob(env,await ownJob(env,p,match[1])));
      if(request.method==='PATCH'&&!match[2]){const data=await input(request);if(data.action!=='cancel')requireExecution(env);return json(await publicJob(env,await changeJob(env,p,match[1],data,rt)));}
      if(request.method==='PUT'&&match[2]){requireExecution(env);return json(await publicJob(env,await upload(env,p,match[1],await readLimited(request,maxFile(env)),rt)));}
    }
    throw new AppError('not_found',404);
  }
  if(!['GET','HEAD'].includes(request.method))throw new AppError('not_found',404);
  return env.ASSETS.fetch(request);
}
export async function handle(request:Request,env:Env,rt=runtime(env),ctx?:ExecutionContext,principal?:Principal):Promise<Response>{
  let response:Response;
  try{response=await route(request,env,rt,ctx,principal);}catch(error){
    const code=error instanceof AppError?error.code:'unexpected_error';
    response=new URL(request.url).pathname.startsWith('/auth/')?new Response(null,{status:303,headers:{Location:'/?login_error='+encodeURIComponent(code)}}):json({error:code,...(error instanceof LocalProbeError||error instanceof LocalWriteProbeError?{diagnostic:error.diagnostic}:{})},error instanceof AppError?error.status:500);
  }
  return secureResponse(response,env);
}
export function secureResponse(response:Response,env:Env){
  const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
  headers.set('X-Frame-Options','DENY');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if(new URL(env.APP_ORIGIN).protocol==='https:')headers.set('Strict-Transport-Security','max-age=31536000');
  headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export default {
  fetch:(request,env,ctx)=>handle(request,env,runtime(env),ctx),
  async scheduled(_event:ScheduledController,env:Env,_ctx:ExecutionContext){
    try{await tick(env,runtime(env));}
    catch{await env.DB.prepare('INSERT OR REPLACE INTO system_state(key,value) VALUES(?,?)').bind('cron_error',String(Date.now())).run();throw new Error('Scheduler konnte nicht vollständig ausgeführt werden.');}
  }
} satisfies ExportedHandler<Env>;
