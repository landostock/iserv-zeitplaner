import {PUBLIC_ORIGIN_HEADER,frontendEnvironment} from './public-origin.ts';
import {WorkerEntrypoint} from 'cloudflare:workers';
import { DurableObject } from 'cloudflare:workers';
import { durableDatabase } from './durable-db.ts';
import { handle, secureResponse } from './worker.ts';
import { runtime } from './runtime.ts';
import { tick } from './scheduler.ts';
import { session, loginSession, csrf } from './auth.ts';
import { accessIdentity } from './access-auth.ts';
import { AppError, demoAllowed, productionReady, rateKey, sha256, readLimited } from './security.ts';
import { connectAccount, connectionStatus, disconnectAccount } from './connection-api.ts';
import type { Env, Principal } from './types.ts';
import { notifyHealth } from './alerts.ts';
import { bounded } from './bounded.ts';
import { cleanupVaultSources } from './jobs.ts';
import {numberingLock,numberingReservations} from './numbering-lock.ts';
import {accountRoute} from './account-management.ts';
import {passkeyRoute} from './passkey-auth.ts';
import {notifyPush,pushReady} from './push.ts';
import {domainMigration} from './domain-migration.ts';
import {installation} from './personal-binding.ts';
import {activeAccount,consumeStepUp} from './account-security.ts';
export { SqliteObjects } from './sqlite-object-store.ts';

export interface DurableEnv extends Env { GATE:DurableObjectNamespace; PUBLISHERS:DurableObjectNamespace; }
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
function failure(error:unknown){return json({error:error instanceof AppError?error.code:'unexpected_error'},error instanceof AppError?error.status:500);}
const objectName=(school:string,owner:string)=>sha256(JSON.stringify([school,owner]));
const namespace=(n:DurableObjectNamespace,env:Env)=>demoAllowed(env)?n:n.jurisdiction('eu');
const gate=(env:DurableEnv)=>namespace(env.GATE,env).get(namespace(env.GATE,env).idFromName('gate:'+env.SCHOOL_ID));
const publisher=(env:DurableEnv,owner:string)=>namespace(env.PUBLISHERS,env).get(namespace(env.PUBLISHERS,env).idFromName(objectName(env.SCHOOL_ID,owner)));

export class Publisher extends DurableObject<DurableEnv> {
  private db:D1Database;
  constructor(ctx:DurableObjectState,env:DurableEnv){super(ctx,env);this.db=durableDatabase(ctx.storage);}
  private environment(forwarded?:string|null):Env{return {...frontendEnvironment(this.env,forwarded),DB:this.db,ENFORCE_STORAGE_BUDGET:'true'};}
  private async rearm(){
    const env=this.environment(),now=Date.now();
    const row=await this.db.prepare("SELECT MIN(CASE WHEN status='publishing' THEN lease_until WHEN status='preparing' THEN created_at+86400000 ELSE next_attempt_at END) AS next FROM jobs WHERE status IN ('scheduled','retry_wait','publishing','reconciling','preparing')").first<{next:number|null}>();
    const credential=await this.db.prepare("SELECT MIN(discard_after) AS next FROM connections WHERE credential_kind='account-password'").first<{next:number|null}>();
    const cleanup=await this.db.prepare("SELECT MIN(CASE WHEN status IN ('published','cancelled') THEN ? ELSE updated_at+604800000 END) AS next FROM jobs WHERE source_cleaned_at IS NULL AND status IN ('published','cancelled','failed','conflict','needs_auth','needs_review')").bind(now+60000).first<{next:number|null}>();
    const next=[row?.next,credential?.next,cleanup?.next].filter((x):x is number=>typeof x==='number');
    if(next.length){
      const desired=Math.max(now+1000,Math.min(...next)),current=await this.ctx.storage.getAlarm();
      // Status polling must never push an already imminent publication alarm into the future.
      if(current===null||desired<current)await this.ctx.storage.setAlarm(desired);
    }
    else await this.ctx.storage.deleteAlarm();
  }
  private async run(){
    const env=this.environment();
    if(env.MODE==='production'&&env.AUTH_MODE==='passkey'){
      const owner=await this.ctx.storage.get<string>('owner');
      const status=owner?await gate(this.env).fetch(env.APP_ORIGIN+'/_internal/account-status?owner='+owner):null;
      if(!status?.ok||!(await status.json()as {active:boolean}).active){
        await this.db.prepare('DELETE FROM connections').run();await this.db.prepare('DELETE FROM folder_proofs').run();
        await this.db.prepare('DELETE FROM push_subscriptions').run();
        await this.db.prepare('DELETE FROM original_name_proofs').run();
        await this.db.prepare("UPDATE jobs SET status=CASE WHEN operation_started_at IS NULL THEN 'needs_auth' ELSE 'needs_review' END,error_code='account_not_allowed',updated_at=?,revision=revision+1,lease_token=NULL,lease_until=NULL WHERE status IN ('scheduled','retry_wait','publishing','reconciling')").bind(Date.now()).run();
        await cleanupVaultSources(env,runtime(env));await this.rearm();return;
      }
    }
    if(env.MODE==='production'&&env.AUTH_MODE==='access'){
      const email=await this.ctx.storage.get<string>('email');
      if(!email||!env.ACCESS_EMAILS?.split(',').map(x=>x.trim().toLowerCase()).includes(email.toLowerCase())){
        await this.db.prepare('DELETE FROM connections').run();
        await this.db.prepare('DELETE FROM push_subscriptions').run();
        await this.db.prepare('DELETE FROM original_name_proofs').run();
        await this.db.prepare('DELETE FROM folder_proofs').run();
        await this.db.prepare("UPDATE jobs SET status=CASE WHEN operation_started_at IS NULL THEN 'needs_auth' ELSE 'needs_review' END,error_code='account_not_allowed',updated_at=?,revision=revision+1,lease_token=NULL,lease_until=NULL WHERE status IN ('scheduled','retry_wait','publishing','reconciling')").bind(Date.now()).run();
        await cleanupVaultSources(env,runtime(env));
        await this.rearm();return;
      }
    }
    try{await tick(env,runtime(env));}finally{
      await this.rearm();
      // A slow browser push provider must never hold the publication semaphore or
      // delay the control loop's next publisher. Delivery has its own persisted retry.
      if(pushReady(env))this.ctx.waitUntil(notifyPush(env).then(()=>this.ctx.storage.delete('push_loop_failed')).catch(()=>this.ctx.storage.put('push_loop_failed',Date.now())));
    }
  }
  async alarm(){await bounded(()=>this.run());}
  async fetch(request:Request){
    return bounded(async()=>{
      const env=this.environment(request.headers.get(PUBLIC_ORIGIN_HEADER)),url=new URL(request.url);
      try{
        if(url.pathname==='/_internal/erase-account'){
          const owner=await this.ctx.storage.get<string>('owner');if(!owner)return json({done:true});
          const status=await gate(this.env).fetch(env.APP_ORIGIN+'/_internal/account-status?owner='+owner);
          if(!status.ok||!(await status.json()as {deleted:boolean}).deleted)throw new AppError('forbidden',403);
          await this.db.batch([this.db.prepare("UPDATE users SET name='Gelöschtes Konto'"),this.db.prepare('DELETE FROM connections'),this.db.prepare('DELETE FROM folder_proofs'),this.db.prepare('DELETE FROM original_name_proofs'),this.db.prepare('DELETE FROM push_subscriptions')]);
          const {results}=await this.db.prepare('SELECT id,school_id,owner_id FROM jobs LIMIT 10').all<{id:string;school_id:string;owner_id:string}>();
          for(const row of results){const vault=runtime(env).vault?.(row.school_id,row.owner_id);if(!vault)throw new AppError('setup_required',503);await vault.remove(vault.key(row.id));await this.db.batch([this.db.prepare('DELETE FROM attempts WHERE job_id=?').bind(row.id),this.db.prepare('DELETE FROM notifications WHERE job_id=?').bind(row.id),this.db.prepare('DELETE FROM jobs WHERE id=?').bind(row.id)]);}
          const remaining=await this.db.prepare('SELECT COUNT(*) AS n FROM jobs').first<{n:number}>();await this.rearm();return json({done:remaining?.n===0});
        }
        if(url.pathname==='/_internal/tick'){
          await this.run();
          const overdue=await this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('scheduled','retry_wait','publishing','reconciling') AND due_at<?").bind(Date.now()-180000).first<{n:number}>();
          const attention=await this.db.prepare("SELECT (SELECT COUNT(*) FROM notifications WHERE read_at IS NULL AND kind IN ('failed','needs_auth','needs_review','conflict'))+(SELECT COUNT(*) FROM jobs WHERE status IN ('published','cancelled') AND error_code='cleanup_pending') AS n").first<{n:number}>();
          const delivery=await this.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE delivery_failed=1').first<{n:number}>();
          const pushLoopFailed=await this.ctx.storage.get<number>('push_loop_failed');
          return json({overdue:overdue?.n||0,attention:(attention?.n||0)+(delivery?.n||0)+(pushLoopFailed?1:0)});
        }
        if(env.SELF_HOSTED==='true'&&url.pathname==='/_internal/setup-proof'){
          const row=await this.db.prepare("SELECT confirmed_at FROM jobs WHERE status='published' AND confirmed_at IS NOT NULL ORDER BY confirmed_at DESC LIMIT 1").first<{confirmed_at:number}>();
          return json({verifiedAt:row?.confirmed_at||null});
        }
        if(env.SELF_HOSTED==='true'&&url.pathname==='/_internal/setup-can-reconfigure'){
          const r=await this.db.prepare('SELECT (SELECT COUNT(*) FROM jobs)+(SELECT COUNT(*) FROM connections) AS n').first<{n:number}>();return json({allowed:r?.n===0});
        }
        const raw=request.headers.get('X-Zeitplaner-Principal');
        if(!raw||raw.length>2000)throw new AppError('forbidden',403);
        const p=JSON.parse(raw)as Principal;
        if(p.school!==env.SCHOOL_ID||!/^[a-f0-9]{64}$/.test(p.owner)||typeof p.name!=='string'||typeof p.csrf!=='string'||p.csrf.length>100)throw new AppError('forbidden',403);
        const bound=await this.ctx.storage.get<string>('owner');
        if(bound&&bound!==p.owner)throw new AppError('forbidden',403);
        if(!bound){await this.ctx.storage.put('owner',p.owner);await this.db.prepare('INSERT OR IGNORE INTO users(school_id,id,subject,name) VALUES(?,?,?,?)').bind(p.school,p.owner,p.owner,p.name.slice(0,100)).run();}
        if(env.AUTH_MODE==='access'&&env.MODE==='production')await this.ctx.storage.put('email',p.name);
        let response:Response;
        if(url.pathname==='/api/connection'){
          if(request.method!=='GET')csrf(env,request,p);
          if(request.method==='GET')response=json(await connectionStatus(env,p));
          else if(request.method==='PUT')response=json(await connectAccount(env,p,request));
          else if(request.method==='DELETE'){await disconnectAccount(env,p);response=new Response(null,{status:204});}
          else throw new AppError('not_found',404);
        }else response=await handle(request,env,runtime(env),undefined,p);
        await this.rearm();return secureResponse(response,env);
      }catch(error){await this.rearm();return secureResponse(failure(error),env);}
    });
  }
}

/** This private DO is the only caller allowed to supply a publisher principal. */
export class AccessGate extends DurableObject<DurableEnv> {
  private db:D1Database;
  private accountQueue:Promise<unknown>=Promise.resolve();
  private accountWaiting=0;
  private async serialAccount<T>(run:()=>Promise<T>):Promise<T>{if(this.accountWaiting>=32)throw new AppError('too_many_requests',429);this.accountWaiting++;const result=this.accountQueue.then(run,run);this.accountQueue=result.catch(()=>{});try{return await result;}finally{this.accountWaiting--;}}
  constructor(ctx:DurableObjectState,env:DurableEnv){super(ctx,env);this.db=durableDatabase(ctx.storage);}
  private environment(forwarded?:string|null):Env{return {...frontendEnvironment(this.env,forwarded),DB:this.db,...(this.env.AUTH_MODE==='access'?{OIDC_ISSUER:this.env.ACCESS_ISSUER}:this.env.AUTH_MODE==='passkey'?{OIDC_ISSUER:this.env.APP_ORIGIN}:{})};}
  private async watchdog(){
    const env=this.environment();
    const now=Date.now();
    const claimed=this.ctx.storage.transactionSync(()=>{
      const row=this.ctx.storage.sql.exec<{value:string}>("SELECT value FROM system_state WHERE key='watchdog_started'").toArray()[0];
      if(row&&now-Number(row.value)<45000)return false;
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO system_state(key,value) VALUES('watchdog_started',?)",String(now));return true;
    });
    if(!claimed){await this.ctx.storage.setAlarm(Date.now()+60000);return await this.ctx.storage.get('health')||{lastRun:0,overdue:0,attention:0,unavailable:1};}
    const {results}=await this.db.prepare(env.AUTH_MODE==='passkey'?'SELECT u.id,u.name FROM users u JOIN passkey_accounts a ON a.school_id=u.school_id AND a.owner_id=u.id WHERE u.school_id=? AND a.deleted_at IS NULL LIMIT 50':'SELECT id,name FROM users WHERE school_id=? LIMIT 50').bind(env.SCHOOL_ID).all<{id:string;name:string}>();
    let overdue=0,attention=0,unavailable=0;
    if(env.AUTH_MODE==='passkey'){
      const pending=await this.db.prepare('SELECT owner_id FROM account_erasure WHERE school_id=? AND finished_at IS NULL LIMIT 5').bind(env.SCHOOL_ID).all<{owner_id:string}>();
      for(const entry of pending.results){try{const response=await publisher(this.env,entry.owner_id).fetch(env.APP_ORIGIN+'/_internal/erase-account');if(!response.ok){unavailable++;continue;}if((await response.json()as {done:boolean}).done)await this.db.prepare('UPDATE account_erasure SET finished_at=? WHERE school_id=? AND owner_id=?').bind(Date.now(),env.SCHOOL_ID,entry.owner_id).run();}catch{unavailable++;}}
    }
    for(const user of results){if(env.MODE==='production'&&env.AUTH_MODE==='access'&&!env.ACCESS_EMAILS?.split(',').map(x=>x.trim().toLowerCase()).includes(user.name.toLowerCase()))continue;try{
      const r=await publisher(this.env,user.id).fetch(env.APP_ORIGIN+'/_internal/tick');
      if(!r.ok){unavailable++;continue;}
      const report=await r.json()as {overdue:number;attention:number};overdue+=report.overdue;attention+=report.attention;
    }catch{unavailable++;}}
    const health={lastRun:Date.now(),overdue,attention,unavailable};
    await this.ctx.storage.put('health',health);
    if(env.SELF_HOSTED==='true')this.ctx.waitUntil(installation(env).fetch('https://installation.internal/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({healthy:!overdue&&!attention&&!unavailable})}).then(r=>r.body?.cancel()).catch(()=>{}));
    await this.ctx.storage.setAlarm(Date.now()+60000);
    try{
      const previous=await this.ctx.storage.get<{fingerprint:string;sentAt:number}>('last_alert');
      const sent=await notifyHealth(env,health,previous);
      if(sent)await this.ctx.storage.put('last_alert',sent);else await this.ctx.storage.delete('last_alert');
      await this.ctx.storage.delete('alert_delivery_failed');
    }catch{await this.ctx.storage.put('alert_delivery_failed',Date.now());}
    // Also delete expired app sessions when no user opens the app.
    await this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Date.now()).run();
    await this.db.prepare('DELETE FROM passkey_flows WHERE expires_at<=?').bind(Date.now()).run();
    await this.db.prepare('DELETE FROM account_invitations WHERE expires_at<=?').bind(Date.now()-90*86400000).run();
    await this.db.prepare("DELETE FROM system_state WHERE key LIKE 'passkey-stepup:%' AND json_extract(value,'$.expiresAt')<=?").bind(Date.now()).run();
    return health;
  }
  async alarm(){await this.watchdog();}
  async fetch(request:Request){
    const env=this.environment(request.headers.get(PUBLIC_ORIGIN_HEADER)),url=new URL(request.url);
    try{
      if(url.pathname==='/_internal/numbering-reservations'&&request.method==='POST'){const raw=await request.text();if(raw.length>256)throw new AppError('invalid_request');return json({targets:await numberingReservations(this.ctx.storage,JSON.parse(raw).scope)});}
      if(url.pathname==='/_internal/numbering-lock'&&request.method==='POST'){
        if(Number(request.headers.get('Content-Length')||0)>2048)throw new AppError('invalid_request');
        const raw=await request.text();if(raw.length>2048)throw new AppError('invalid_request');
        return json({token:await numberingLock(this.ctx.storage,JSON.parse(raw))});
      }
      if(url.pathname==='/_internal/watchdog')return json(await this.watchdog());
      if(url.pathname==='/_internal/account-status'){
        const owner=url.searchParams.get('owner')||'';if(!/^[a-f0-9]{64}$/.test(owner))throw new AppError('forbidden',403);
        const account=await this.db.prepare('SELECT active,deleted_at FROM passkey_accounts WHERE school_id=? AND owner_id=?').bind(env.SCHOOL_ID,owner).first<{active:number;deleted_at:number|null}>();return json({active:account?.active===1&&account.deleted_at===null,deleted:Boolean(account?.deleted_at)});
      }
      if(url.origin!==env.APP_ORIGIN)throw new AppError('origin_mismatch',421);
      if(env.MODE==='demo'&&!demoAllowed(env))throw new AppError('setup_required',503);
      if(env.MODE==='production'&&(url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/'))){
        const limiter=url.pathname.startsWith('/auth/')?env.AUTH_LIMIT:env.API_LIMIT;
        if(!limiter||!env.VAULT_KEY)throw new AppError('setup_required',503);
        if(!(await limiter.limit({key:rateKey(env,request)})).success)throw new AppError('too_many_requests',429);
      }
      // Start the independent control loop on first use, even before the first account exists.
      // Cron propagation can take time after deployment and must not be our startup dependency.
      if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+1000);
      if(url.pathname==='/health'){
        if(!env.MONITOR_KEY||request.headers.get('Authorization')!=='Bearer '+env.MONITOR_KEY)throw new AppError('not_found',404);
        const h=await this.ctx.storage.get<{lastRun:number;overdue:number;attention:number;unavailable:number}>('health');
        const alertFailure=await this.ctx.storage.get<number>('alert_delivery_failed');
        const healthy=Boolean(h&&Date.now()-h.lastRun<180000&&!h.overdue&&!h.attention&&!h.unavailable&&!alertFailure);
        return json({healthy,...h,alertDeliveryFailed:Boolean(alertFailure),...(env.AUTH_MODE==='passkey'?{domainMigration:await domainMigration(env)}:{})},healthy?200:503);
      }
      if(url.pathname==='/auth/login'&&env.AUTH_MODE==='access'&&request.method==='GET'){
        if(!productionReady(env))throw new AppError('setup_required',503);
        const identity=await accessIdentity(env,request);
        return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':await loginSession(env,identity.subject,identity.name)}});
      }
      if(url.pathname.startsWith('/auth/passkey/'))return secureResponse(await this.serialAccount(()=>passkeyRoute(env,request)),env);
      let p=await session(env,request);
      if(p&&env.MODE==='production'&&env.AUTH_MODE==='access'){
        const identity=await accessIdentity(env,request);if(identity.owner!==p.owner)throw new AppError('login_required',401);
      }
      if(p&&env.MODE==='production'&&env.AUTH_MODE==='passkey'){
        const account=await this.db.prepare('SELECT active FROM passkey_accounts WHERE school_id=? AND owner_id=?').bind(p.school,p.owner).first<{active:number}>();
        if(account?.active!==1){await this.db.prepare('DELETE FROM sessions WHERE school_id=? AND owner_id=?').bind(p.school,p.owner).run();p=null;}
      }
      if(env.SELF_HOSTED==='true'&&url.pathname==='/api/installation'){
        if(!p)throw new AppError('login_required',401);
        if((await activeAccount(env,p)).role!=='admin')throw new AppError('forbidden',403);
        if(request.method==='GET'){
          const response=await installation(env).fetch('https://installation.internal/status');
          const data=await response.json()as {verifiedAt:number|null;createdAt:number};
          if(!data.verifiedAt){const proof=await publisher(this.env,p.owner).fetch(env.APP_ORIGIN+'/_internal/setup-proof');const v=await proof.json()as {verifiedAt:number|null};if(v.verifiedAt&&v.verifiedAt>=data.createdAt){await installation(env).fetch('https://installation.internal/verified');data.verifiedAt=v.verifiedAt;}}
          const h=await this.ctx.storage.get<{lastRun:number;overdue:number;attention:number;unavailable:number}>('health');
          return json({...data,schedulerHealthy:Boolean(h&&Date.now()-h.lastRun<180000&&!h.unavailable),lastRun:h?.lastRun||null});
        }
        if(request.method!=='POST')throw new AppError('not_found',404);
        csrf(env,request,p);let d;try{d=JSON.parse(new TextDecoder().decode(await readLimited(request,4096)));}catch{throw new AppError('invalid_request');}
        if(d.action==='school'){
          await consumeStepUp(env,p,d.stepUp,'manage-account');
          const count=await this.db.prepare('SELECT COUNT(*) AS n FROM passkey_accounts WHERE school_id=? AND deleted_at IS NULL').bind(p.school).first<{n:number}>();
          const check=await publisher(this.env,p.owner).fetch(env.APP_ORIGIN+'/_internal/setup-can-reconfigure');
          if(count?.n!==1||!(await check.json()as {allowed:boolean}).allowed)throw new AppError('school_already_in_use',409);
          return installation(env).fetch('https://installation.internal/school',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
        }
        if(d.action==='reserve-saved'){
          if(d.consent!=='recovery-code-saved'||!await env.DB.prepare('SELECT created_at FROM account_recovery WHERE school_id=? AND owner_id=?').bind(p.school,p.owner).first())throw new AppError('invalid_request');
          return installation(env).fetch('https://installation.internal/reserve-saved');
        }
        if(!['configure','test','confirm'].includes(d.action))throw new AppError('invalid_request');
        return secureResponse(await installation(env).fetch('https://installation.internal/monitor/'+d.action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}),env);
      }
      if(p&&env.AUTH_MODE==='passkey'&&(url.pathname==='/api/account'||url.pathname==='/api/account/manage')){
        const response=await this.serialAccount(()=>accountRoute(env,p!,request));
        const result=request.method==='POST'?await response.clone().json()as {affectedOwner?:string;erasureRequested?:boolean}:null;
        if(result?.affectedOwner)this.ctx.waitUntil(publisher(this.env,result.affectedOwner).fetch(env.APP_ORIGIN+(result.erasureRequested?'/_internal/erase-account':'/_internal/tick')).then(()=>{}).catch(()=>{}));
        return secureResponse(response,env);
      }
      if(!p||url.pathname==='/api/logout'||url.pathname.startsWith('/api/local-'))return handle(request,env,runtime(env));
      const headers=new Headers(request.headers);headers.delete('X-Zeitplaner-Principal');headers.set('X-Zeitplaner-Principal',JSON.stringify(p));
      const response=await publisher(this.env,p.owner).fetch(new Request(request,{headers}));
      // A persistent control alarm is independent of the per-owner publication alarm.
      if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+60000);
      return response;
    }catch(error){return secureResponse(failure(error),env);}
  }
}

/** Exposed only through a Cloudflare service binding; never an HTTP path. */
export class PagesGateway extends WorkerEntrypoint<DurableEnv>{
 async fetch(request:Request){
  try{
   const env=frontendEnvironment(this.env,this.env.PUBLIC_APP_ORIGIN||'');
   if(!this.env.PUBLIC_APP_ORIGIN||new URL(request.url).origin!==this.env.PUBLIC_APP_ORIGIN)throw new AppError('origin_mismatch',421);
   const headers=new Headers(request.headers);headers.delete('X-Zeitplaner-Principal');headers.delete(PUBLIC_ORIGIN_HEADER);headers.set(PUBLIC_ORIGIN_HEADER,this.env.PUBLIC_APP_ORIGIN);
   if(new URL(request.url).pathname.startsWith('/_internal/'))return secureResponse(json({error:'not_found'},404),env);
   const path=new URL(request.url).pathname;
   if(!path.startsWith('/api/')&&!path.startsWith('/auth/')&&path!=='/health'){
    if(!['GET','HEAD'].includes(request.method))return secureResponse(json({error:'not_found'},404),env);
    return secureResponse(await env.ASSETS.fetch(new Request(request,{headers})),env);
   }
   return secureResponse(await gate(this.env).fetch(new Request(request,{headers})),env);
  }catch(error){return secureResponse(failure(error),this.env);}
 }
}

export default {
  async fetch(request:Request,env:DurableEnv){
    const url=new URL(request.url);
    if(url.origin!==env.APP_ORIGIN)return secureResponse(json({error:'origin_mismatch'},421),env);
      if(url.pathname==='/.well-known/webauthn'&&request.method==='GET'){
        const origins=[env.APP_ORIGIN,...(env.PUBLIC_APP_ORIGIN?[env.PUBLIC_APP_ORIGIN]:[])];
        return secureResponse(json({origins}),env);
      }
    // Never expose service-only paths, or permit a client to supply a trusted identity.
    if(url.pathname.startsWith('/_internal/'))return secureResponse(json({error:'not_found'},404),env);
    if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/auth/')&&url.pathname!=='/health'){
      if(!['GET','HEAD'].includes(request.method))return secureResponse(json({error:'not_found'},404),env);
      return secureResponse(await env.ASSETS.fetch(request),env);
    }
    const headers=new Headers(request.headers);headers.delete('X-Zeitplaner-Principal');headers.delete(PUBLIC_ORIGIN_HEADER);
    return secureResponse(await gate(env).fetch(new Request(request,{headers})),env);
  },
  async scheduled(_event:ScheduledController,env:DurableEnv){
    const r=await gate(env).fetch(env.APP_ORIGIN+'/_internal/watchdog');
    if(!r.ok)throw new Error('Kontrolllauf fehlgeschlagen.');
  }
}satisfies ExportedHandler<DurableEnv>;
