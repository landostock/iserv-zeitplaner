import {test,expect} from '@playwright/test';
const now=Date.now();
async function fixture(page:any,phase='reserve'){
 let configured=phase!=='initialize',reserveAt=phase==='reserve'?null:now,connected=!['reserve','connect','initialize'].includes(phase),verifiedAt=['monitor','finished'].includes(phase)?now:null,monitor:any=phase==='finished'?{configured:true,confirmedAt:now}:null;
 const writes:any[]=[];
 await page.route('**/setup/**',async(route:any)=>{const p=new URL(route.request().url()).pathname;let body:any={configured,setupReady:true,version:'1.0.0-rc1'};if(p==='/setup/initialize'){writes.push(route.request().postDataJSON());configured=true;body={invitation:new URL('/#einladung='+'ab'.repeat(32),route.request().url()).href,resumed:false};}await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
 await page.route('**/api/**',async(route:any)=>{const p=new URL(route.request().url()).pathname,method=route.request().method();let body:any={};
  if(p==='/api/session')body={selfHosted:true,user:{id:'owner',name:'Synthetic',csrf:'fixture'}};
  if(p==='/api/account')body={admin:true,recoveryReady:true,recoveryCreatedAt:now-1000};
  if(p==='/api/connection'){if(method==='PUT'){writes.push(route.request().postDataJSON());connected=true;}body={connected};}
  if(p==='/api/installation'){
   if(method==='POST'){const d=route.request().postDataJSON();writes.push(d);if(d.action==='reserve-saved')reserveAt=now;if(d.action==='configure')monitor={configured:true,confirmedAt:null};if(d.action==='confirm')monitor={configured:true,confirmedAt:now};}
   body={version:'1.0.0-rc1',school:'https://school.de',createdAt:now-10000,reserveAt,verifiedAt,schedulerHealthy:true,monitor};
  }
  if(p==='/api/jobs')body={jobs:[{filename:'synthetic.txt',status:'scheduled',dueAt:now+60000}]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });return {writes};
}
test('public installer needs no secret and opens only a canonical own address',async({page})=>{
 const requests:string[]=[];page.on('request',r=>requests.push(r.url()));await page.goto('/installieren.html');
 await expect(page.locator('#prepare-next')).toBeDisabled();await page.locator('#accounts-ready').check();await page.locator('#prepare-next').click();
 await expect(page.locator('#deploy-link')).toHaveAttribute('href',/^https:\/\/deploy\.workers\.cloudflare\.com\//);
 await page.locator('#deploy-next').click();
 for(const bad of ['https://worker.owner.workers.dev.evil.org','http://worker.owner.workers.dev','https://v1.worker.owner.workers.dev','https://user:pass@worker.owner.workers.dev']){await page.locator('#own-address').fill(bad);await expect(page.locator('#open-own')).toBeHidden();}
 await page.locator('#own-address').fill('https://worker.owner.workers.dev');await expect(page.locator('#open-own')).toHaveAttribute('href','https://worker.owner.workers.dev/einrichten');
 expect(requests.every(url=>new URL(url).hostname==='localhost')).toBe(true);expect(await page.locator('input[type=password]').count()).toBe(0);
 await page.screenshot({path:'test-results/installer-public.png',fullPage:true});
});
test('initialization clears the code, preserves the correct host and asks explicit owner consent',async({page})=>{
 const f=await fixture(page,'initialize');await page.goto('/einrichten.html');await expect(page.locator('#initialize')).toBeVisible();
 await page.locator('#setup-code').fill('synthetic-setup-code-at-least-24');await page.locator('#school').fill('https://schule.de/iserv/login');await page.locator('#own-consent').check();await page.getByRole('button',{name:'Eigene Installation vorbereiten',exact:true}).click();
 await expect(page.locator('#claim')).toBeVisible();expect(f.writes[0].school).toBe('https://schule.de');expect(f.writes[0].dav).toBe('https://webdav.schule.de');await expect(page.locator('#setup-code')).toHaveValue('');await expect(page.locator('#claim-link')).toHaveAttribute('href',/^http:\/\/localhost:8790\/#einladung=/);
 expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
});
test('resuming an initialized installation needs only its code and never replaces settings',async({page})=>{
 await fixture(page,'initialize');await page.route('**/setup/status',r=>r.fulfill({contentType:'application/json',body:'{"configured":true,"setupReady":true}'}));await page.route('**/api/session',r=>r.fulfill({contentType:'application/json',body:'{"user":null}'}));
 await page.goto('/einrichten.html');await expect(page.locator('#signin')).toBeVisible();await page.locator('#signin details summary').click();await page.locator('#resume-claim').click();await expect(page.locator('#school-fields')).toBeHidden();await page.locator('#setup-code').fill('synthetic-setup-code-at-least-24');await page.getByRole('button',{name:'Eigene Installation vorbereiten',exact:true}).click();await expect(page.locator('#claim')).toBeVisible();
});
test('a successful connection is not mistaken for a successful publication',async({page})=>{
 const f=await fixture(page,'connect');await page.goto('/einrichten.html');await expect(page.locator('#connect')).toBeVisible();await page.locator('#username').fill('synthetic-owner');await page.locator('#password').fill('synthetic-password');await page.locator('#password-consent').check();await page.getByRole('button',{name:'IServ-Verbindung prüfen',exact:true}).click();await expect(page.locator('#test')).toBeVisible();await expect(page.locator('#password')).toHaveValue('');expect(f.writes[0].consent).toBe('store-encrypted-account-password');await expect(page.locator('#finished')).toBeHidden();await page.locator('#check-test').click();await expect(page.locator('#test-results')).toContainText('Wartet auf den Termin');
});
test('monitoring requires a received test mail and does not store its URL in browser storage',async({page})=>{
 const f=await fixture(page,'monitor');await page.goto('/einrichten.html');await expect(page.locator('#monitor')).toBeVisible();await page.locator('#monitor-url').fill('https://hc-ping.com/12a45678-1234-1234-1234-123456789abc');await page.getByRole('button',{name:'Überwachung verbinden',exact:true}).click();await expect(page.locator('#monitor-test')).toBeVisible();await expect(page.locator('#confirm-alert')).toBeDisabled();await expect(page.locator('#monitor-url')).toHaveValue('');await page.locator('#send-alert').click();await page.locator('#email-received').check();await page.locator('#confirm-alert').click();await expect(page.locator('#finished')).toBeVisible();expect(f.writes.map(w=>w.action)).toEqual(['configure','test','confirm']);expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});await page.screenshot({path:'test-results/installer-finished.png',fullPage:true});
});
test('wizard remains readable on iPad, narrow screens and enlarged text',async({page})=>{
 await fixture(page,'reserve');await page.goto('/einrichten.html');await expect(page.locator('#reserve')).toBeVisible();
 for(const size of [{width:1024,height:768},{width:820,height:1180},{width:375,height:812}]){await page.setViewportSize(size);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);await expect(page.locator('#make-recovery')).toBeInViewport();}
 await page.setViewportSize({width:375,height:812});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);await page.screenshot({path:'test-results/installer-zoom.png',fullPage:true});
});
test('an expired setup session clears a displayed recovery code before another person can act',async({page})=>{
 await page.clock.install();await fixture(page,'reserve');await page.goto('/einrichten.html');await expect(page.locator('#reserve')).toBeVisible();
 await page.evaluate(()=>{(document.getElementById('recovery')as HTMLTextAreaElement).value='synthetic-recovery-code';document.getElementById('recovery-box')!.hidden=false;});
 await page.route('**/api/session',r=>r.fulfill({contentType:'application/json',body:'{"user":null}'}));await page.clock.fastForward(16000);
 await expect(page.locator('#signin')).toBeVisible();await expect(page.locator('#recovery')).toHaveValue('');await expect(page.locator('#recovery-box')).toBeHidden();
});
