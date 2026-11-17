import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {personalOrigin,publicHttps,PERSONAL_VERSION} from '../src/personal-config.ts';
import {syntheticAuthenticator} from './passkey-fixture.ts';
import {sha256} from '../src/security.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('personal addresses reject previews, phishing, credentials, insecure and private endpoints',()=>{
 assert.equal(personalOrigin('https://mein-planer.owner.workers.dev'),'https://mein-planer.owner.workers.dev');
 for(const url of ['https://version.worker.owner.workers.dev','http://mein.owner.workers.dev','https://mein.owner.workers.dev.evil.org','https://mein.owner.workers.dev:8443'])assert.throws(()=>personalOrigin(url));
 for(const url of ['http://school.org','https://a:b@school.org','https://school.org/Files/','https://school.local','https://127.0.0.1','https://1.2.3.4','https://school.org:8443','https://school.org?x=1'])assert.throws(()=>publicHttps(url));
 assert.equal(publicHttps('schule.de'),'https://schule.de');
});

test('native personal installation is inert, private, resumable, origin pinned and passkey protected; heartbeat never leaks content',async()=>{
 const beforeVersion=PERSONAL_VERSION,afterVersion=beforeVersion.replace(/rc(\d+)$/,(_,n)=>'rc'+(Number(n)+1));
 const origin='https://personal.synthetic.workers.dev',code='synthetic-install-code-24-characters-only';
 const bundle=await build({stdin:{contents:`import app,{PersonalInstallation,PersonalAccessGate,PersonalPublisher,SqliteObjects} from './src/personal-worker.ts';import {durableDatabase} from './src/durable-db.ts';export {PersonalInstallation,PersonalAccessGate,SqliteObjects};export class FixturePersonalPublisher extends PersonalPublisher{async fetch(r){if(new URL(r.url).pathname==='/_fixture/due'){const db=durableDatabase(this.ctx.storage);await db.prepare("UPDATE jobs SET due_at=?,next_attempt_at=? WHERE status='scheduled'").bind(Date.now()-1000,Date.now()-1000).run();await this.ctx.storage.setAlarm(Date.now()+30);return new Response(null,{status:204});}return super.fetch(r);}}export default app;`,resolveDir:process.cwd(),sourcefile:'personal-fixture.ts',loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2023',external:['node:crypto','cloudflare:workers'],loader:{'.sql':'text'}});
 const outgoing:{url:string;body:string;auth:string|null}[]=[];let pingResponse='OK';const files=new Map<string,Uint8Array>();let puts=0,moves=0;
 const persist=await mkdtemp(join(tmpdir(),'iserv-personal-'));
 const options=convertV4MiniflareOptions({resourcePersistencePath:persist,isolatedResourcePersistencePath:persist,name:'personal-fixture',modules:true,script:bundle.outputFiles[0].text.replaceAll('.jurisdiction("eu")',''),compatibilityDate:'2026-10-28',compatibilityFlags:['nodejs_compat'],bindings:{SETUP_CODE:code},ratelimits:{API_LIMIT:{namespace_id:'personal-api',simple:{limit:1000,period:60}},AUTH_LIMIT:{namespace_id:'personal-auth',simple:{limit:1000,period:60}}},durableObjects:{INSTALLATION:{className:'PersonalInstallation',useSQLite:true},GATE:{className:'PersonalAccessGate',useSQLite:true},PUBLISHERS:{className:'FixturePersonalPublisher',useSQLite:true},VAULT_OBJECTS:{className:'SqliteObjects',useSQLite:true}},outboundService:async r=>{
  if(r.url==='https://raw.githubusercontent.com/landostock/iserv-zeitplaner/main/release-channel.json'){assert.equal(r.headers.get('Authorization'),null);return Response.json({version:afterVersion,commit:'a'.repeat(40),updaterProtocol:2,notes:['Synthetic future release']});}
  if(r.url.startsWith('https://hc-ping.com/')){outgoing.push({url:r.url,body:await r.text(),auth:r.headers.get('Authorization')});return new Response(pingResponse);}
  const u=new URL(r.url);assert.equal(u.origin,'https://webdav.school.de');assert.match(r.headers.get('Authorization')||'',/^Basic /);
  if(r.method==='PROPFIND')return new Response('<d:multistatus xmlns:d="DAV:"><d:response><d:href>'+u.pathname+'</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:current-user-privilege-set><d:privilege><d:bind/></d:privilege></d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',{status:207});
  if(r.method==='PUT'){puts++;files.set(u.pathname,new Uint8Array(await r.arrayBuffer()));return new Response(null,{status:201});}
  if(r.method==='MOVE'){const data=files.get(u.pathname);assert(data);const target=new URL(r.headers.get('Destination')!);assert.equal(target.origin,u.origin);files.set(target.pathname,data);files.delete(u.pathname);moves++;return new Response(null,{status:204});}
  const data=files.get(u.pathname);return new Response(r.method==='HEAD'?null:data?data.slice().buffer as ArrayBuffer:null,{status:data?200:404,headers:data?{'Content-Length':String(data.length)}:{}});
 }});let mf=new Miniflare(options);
 let cookie='',csrf='';
 async function call(path:string,body?:unknown,method=body===undefined?'GET':'POST',extra:Record<string,string>={}){
  const r=await mf.dispatchFetch(origin+path,{method,redirect:'manual',headers:{Origin:origin,'Content-Type':body instanceof Uint8Array?'application/octet-stream':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,...extra},...(body===undefined?{}:{body:body instanceof Uint8Array?body:JSON.stringify(body)})});
  const set=r.headers.get('Set-Cookie');if(set){const v=set.split(';')[0],name=v.split('=')[0];cookie=cookie.split('; ').filter(x=>x&&!x.startsWith(name+'=')).concat(v).join('; ');}return {status:r.status,data:await r.json()as any};
 }
 try{
  assert.equal((await call('/setup/status')).data.configured,false);
  const firstVisit=await mf.dispatchFetch(origin+'/',{redirect:'manual'});assert.equal(firstVisit.status,303);assert.equal(firstVisit.headers.get('Location'),'/einrichten');
  assert.equal((await call('/api/session')).status,503);
  assert.equal((await call('/config')).status,404);
  assert.equal((await call('/_internal/config')).status,404);
  const payload={setupCode:code,school:'https://school.de',dav:'https://webdav.school.de',consent:'own-account-and-encrypted-iserv-storage'};
  assert.equal((await call('/setup/initialize',{...payload,setupCode:'wrong'})).status,403);
  assert.equal((await call('/setup/initialize',payload,'POST',{Origin:'https://evil.org'})).status,403);
  assert.equal((await call('/setup/initialize',{...payload,consent:''})).status,400);
  const first=await call('/setup/initialize',payload);assert.equal(first.status,200,JSON.stringify(first.data));
  assert.equal(first.data.resumed,false);assert.match(first.data.invitation,/#einladung=[a-f0-9]{64}$/);
  const again=await call('/setup/initialize',{...payload,school:'https://different.de'});assert.equal(again.data.invitation,first.data.invitation);assert.equal(again.data.resumed,true);
  const anonymous=await call('/api/session');assert.equal(anonymous.status,200,JSON.stringify(anonymous.data));assert.equal(anonymous.data.selfHosted,true);assert.equal(anonymous.data.authReady,true);assert.equal(anonymous.data.user,null);
  for(const secret of ['VAULT_KEY','SETUP_CODE','PASSKEY_BOOTSTRAP_HASH',code])assert.ok(!JSON.stringify(anonymous.data).includes(secret));
  assert.equal((await call('/api/installation')).status,401);assert.equal((await call('/api/updates')).status,401);
  const auth=syntheticAuthenticator(),invite=new URL(first.data.invitation).hash.split('=')[1];
  const opts=await call('/auth/passkey/register/options',{invite,name:'Owner'});assert.equal(opts.status,200,JSON.stringify(opts.data));assert.equal(opts.data.options.rp.id,new URL(origin).hostname);
  const registered=await call('/auth/passkey/register/verify',{response:auth.registration(opts.data.options,origin)});assert.equal(registered.status,200,JSON.stringify(registered.data));
  const session=await call('/api/session');csrf=session.data.user.csrf;assert.ok(csrf);
  const updates=await call('/api/updates');assert.equal(updates.status,200);assert.equal(updates.data.available,true,JSON.stringify(updates.data));assert.equal(updates.data.repository,null);
  assert.equal((await call('/api/updates',{repository:'fixture/private-copy'},'POST',{'X-CSRF-Token':''})).status,403);
  assert.equal((await call('/api/updates',{repository:'https://evil.org/fake/repo'})).status,400);
  assert.equal((await call('/api/updates',{repository:'https://github.com/fixture/private-copy'})).status,200);
  const state=await call('/api/installation');assert.equal(state.status,200,JSON.stringify(state.data));assert.equal(state.data.verifiedAt,null);assert.equal(state.data.school,payload.school);assert.equal(state.data.origin,origin);
  const serialized=JSON.stringify(state.data);for(const secret of ['vault','invite','monitorKey',code,invite])assert.ok(!serialized.includes(secret));
  assert.equal((await call('/api/installation',{action:'school',school:'https://correct-school.de',dav:'https://webdav.school.de'})).status,401);
  let counter=0;async function proof(){const o=await call('/auth/passkey/login/options',{purpose:'manage-account'});const v=await call('/auth/passkey/login/verify',{response:auth.authentication(o.data.options,origin,++counter)});assert.equal(v.status,200,JSON.stringify(v.data));return v.data.stepUp;}
  const corrected=await call('/api/installation',{action:'school',school:'https://correct-school.de',dav:'https://webdav.school.de',stepUp:await proof()});assert.equal(corrected.status,200,JSON.stringify(corrected.data));
  assert.equal((await call('/api/installation')).data.school,'https://correct-school.de');
  assert.equal((await call('/api/installation',{action:'configure',url:'https://evil.org',consent:'send-empty-heartbeats'})).status,400);
  assert.equal((await call('/api/installation',{action:'configure',url:'https://hc-ping.com/12a45678-1234-1234-1234-123456789abc',consent:'send-empty-heartbeats'},'POST',{'X-CSRF-Token':''})).status,403);
  const url='https://hc-ping.com/12a45678-1234-1234-1234-123456789abc';
  pingResponse='OK (not found)';assert.equal((await call('/api/installation',{action:'configure',url,consent:'send-empty-heartbeats'})).status,502);
  pingResponse='OK';assert.equal((await call('/api/installation',{action:'configure',url,consent:'send-empty-heartbeats'})).status,200);
  assert.equal((await call('/api/installation',{action:'confirm',consent:'email-received'})).status,400);
  assert.equal((await call('/api/installation',{action:'test',consent:'send-test-alert'})).status,200);
  assert.equal((await call('/api/installation',{action:'confirm',consent:'email-received'})).status,200);
  const monitored=await call('/api/installation');assert.ok(monitored.data.monitor.confirmedAt);assert.ok(!JSON.stringify(monitored.data).includes(url));
  assert.ok(outgoing.length>=4);assert.ok(outgoing.every(r=>r.url.startsWith('https://hc-ping.com/')&&r.body===''&&r.auth===null));
  const savedCookie=cookie;cookie='';assert.equal((await call('/auth/passkey/register/options',{invite,name:'Intruder'})).status,403);cookie=savedCookie;
  assert.equal((await call('/api/installation',{action:'reserve-saved',consent:'recovery-code-saved'})).status,400);
  assert.equal((await call('/api/connection',{username:'fixture',password:'synthetic-password',consent:'store-encrypted-account-password'},'PUT')).status,200);
  assert.equal((await call('/api/installation',{action:'school',school:'https://different.de',dav:'https://different.de',stepUp:await proof()})).status,409);
  const due=new Date(Date.now()+600000),parts=Object.fromEntries(new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(due).map(x=>[x.type,x.value]));
  const bytes=new TextEncoder().encode('Harmless synthetic personal-installation test.'),plan:any={key:crypto.randomUUID(),filename:'Test.txt',folder:'/Files/Fixture/',size:bytes.length,sha256:sha256(bytes),localTime:`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`,expectedNaming:'numbered-v1',planningVersion:3,numberingConsent:{folder:'/Files/Fixture/',filename:'Test.txt',policy:'number-if-occupied-allow-concurrent-change-risk'}};
  const quote=await call('/api/naming-quote',plan);assert.equal(quote.status,200,JSON.stringify(quote.data));plan.namingQuote=quote.data.namingQuote;
  const planned=await call('/api/jobs',plan);assert.equal(planned.status,201,JSON.stringify(planned.data));
  const uploaded=await call('/api/jobs/'+planned.data.id+'/file',bytes,'PUT');assert.equal(uploaded.status,200,JSON.stringify(uploaded.data));assert.equal(puts,0);
  const root=await mf.getDurableObjectNamespace('INSTALLATION'),config=await(await root.get(root.idFromName('personal-installation-v1')).fetch('https://installation.internal/config')).json()as any;
  assert.equal(config.MODE,'production');assert.equal(config.SELF_HOSTED,'true');
  const ns=await mf.getDurableObjectNamespace('PUBLISHERS'),actor=ns.get(ns.idFromName(sha256(JSON.stringify([config.SCHOOL_ID,session.data.user.id]))));
  await actor.fetch(origin+'/_fixture/due');
  let job:any;for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,30));job=await call('/api/jobs/'+planned.data.id);if(job.data.status==='published'||job.data.status==='failed'||job.data.status==='needs_review')break;}
  assert.equal(job.data.status,'published',JSON.stringify(job.data));assert.equal(moves,1);assert.equal(puts,1);assert.deepEqual(files.get('/Files/Fixture/Test.txt'),bytes);
  assert.ok((await call('/api/installation')).data.verifiedAt);
  const pendingPlan={...plan,key:crypto.randomUUID(),filename:'After-update.txt',numberingConsent:{...plan.numberingConsent,filename:'After-update.txt'}};
  pendingPlan.namingQuote=(await call('/api/naming-quote',pendingPlan)).data.namingQuote;
  const pendingJob=await call('/api/jobs',pendingPlan);assert.equal(pendingJob.status,201);
  assert.equal((await call('/api/jobs/'+pendingJob.data.id+'/file',bytes,'PUT')).data.status,'scheduled');
  await mf.dispose();
  for(const w of (options as any).workers)for(const m of Object.values(w.config.manifest.modules)as any[])m.contents=m.contents.replaceAll(beforeVersion,afterVersion);
  mf=new Miniflare(options);
  const updated=await call('/api/updates');assert.equal(updated.data.installed,afterVersion);assert.equal(updated.data.available,false);assert.equal(updated.data.repository,'fixture/private-copy');
  assert.equal((await call('/api/jobs/'+planned.data.id)).data.status,'published');
  const restarted=await call('/api/session');assert.equal(restarted.status,200);assert.equal(restarted.data.user.id,session.data.user.id);
  assert.equal((await call('/api/connection')).data.connected,true);
  assert.ok((await call('/api/installation')).data.verifiedAt);
  assert.equal((await call('/api/jobs/'+pendingJob.data.id)).data.status,'scheduled');
  assert.ok((await call('/api/installation')).data.monitor.confirmedAt);
  const ns2=await mf.getDurableObjectNamespace('PUBLISHERS');await ns2.get(ns2.idFromName(sha256(JSON.stringify([config.SCHOOL_ID,session.data.user.id])))).fetch(origin+'/_fixture/due');
  let after:any;for(let i=0;i<100;i++){after=await call('/api/jobs/'+pendingJob.data.id);if(after.data.status==='published')break;await new Promise(r=>setTimeout(r,30));}
  assert.equal(after.data.status,'published',JSON.stringify(after.data));assert.deepEqual(files.get('/Files/Fixture/After-update.txt'),bytes);
  const resumed=await call('/setup/initialize',payload);assert.equal(resumed.data.invitation,first.data.invitation);
 }finally{await mf.dispose();await rm(persist,{recursive:true,force:true});}
});
