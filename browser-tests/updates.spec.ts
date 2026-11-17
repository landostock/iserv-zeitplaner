import {test,expect} from '@playwright/test';
async function fixture(page:any,{available=true,checked=true,compatible=true}={}){
 let installed='1.0.0-rc2',repository:string|null=null,loggedIn=true;
 await page.route('**/api/**',async(route:any)=>{
  const p=new URL(route.request().url()).pathname;let body:any={},status=200;
  if(p==='/api/session')body={selfHosted:true,mode:'production',ready:true,authMode:'passkey',school:'Synthetic school',user:loggedIn?{id:'owner',name:'Owner',csrf:'fixture'}:null,groupRoot:'/',maxFileBytes:52428800,lastSchedulerRun:Date.now()};
  else if(p==='/api/jobs')body={jobs:[]};else if(p==='/api/push')body={available:false,devices:0};else if(p==='/api/connection')body={connected:true,storageAllowed:true};
  else if(p==='/api/updates'){
   if(route.request().method()==='POST'){const d=route.request().postDataJSON();if(d.repository==='https://github.com/fixture/mein-iserv-zeitplaner')repository='fixture/mein-iserv-zeitplaner';else{status=400;body={error:'invalid_repository'};}}
   if(status===200)body=route.request().method()==='POST'?{repository}:{installed,repository,checked,compatible,available:available&&installed!=='1.0.0-rc3',latest:checked?{version:'1.0.0-rc3',commit:'a'.repeat(40),updaterProtocol:1,notes:['Synthetic release notes']}:null};
  }else if(p==='/api/logout')loggedIn=false;else{status=503;body={error:'unconfigured_fixture'};}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 return{upgrade(){installed='1.0.0-rc3';}};
}
test('update guide preserves explicit provider approval and verifies the running version',async({page},info)=>{
 const f=await fixture(page);await page.goto('/');await page.getByRole('button',{name:'Einstellungen · Update verfügbar',exact:true}).click();
 await expect(page.locator('#update-status')).toContainText('1.0.0-rc3');await expect(page.locator('#update-notes')).toContainText('Synthetic release notes');await page.locator('#update-prepare').click();
 await page.locator('#update-repository').fill('https://evil.org/fixture/mein-iserv-zeitplaner');await page.locator('#update-repository-save').click();await expect(page.locator('#update-provider-steps')).toBeHidden();await expect(page.locator('#update-progress')).toContainText('eigenen GitHub-Kopie');
 await page.locator('#update-repository').fill('https://github.com/fixture/mein-iserv-zeitplaner');await page.locator('#update-repository-save').click();
 await expect(page.locator('#update-workflow')).toHaveAttribute('href','https://github.com/fixture/mein-iserv-zeitplaner/actions/workflows/zeitplaner-update.yml');
 await expect(page.locator('#update-compare')).toHaveAttribute('href','https://github.com/fixture/mein-iserv-zeitplaner/compare/main...zeitplaner-update/1.0.0-rc3?expand=1');
 await expect(page.locator('#update-provider-steps')).toContainText('Confirm merge');await page.locator('#update-verify').click();await expect(page.locator('#update-progress')).toContainText('weiterhin 1.0.0-rc2');await expect(page.locator('#update-reload')).toBeHidden();
 await page.screenshot({path:'test-results/update-guide-'+info.project.name+'.png',fullPage:true});
 f.upgrade();await page.locator('#update-verify').click();await expect(page.locator('#update-progress')).toContainText('Update installiert: 1.0.0-rc3');await expect(page.locator('#update-reload')).toBeVisible();
 await page.locator('#update-close').click();await page.locator('#logout').click();await expect(page.locator('#updates-panel')).toBeHidden();await expect(page.locator('#update-repository')).toHaveValue('');await expect(page.locator('#update-workflow')).not.toHaveAttribute('href',/github/);
});
test('release outages and incompatible updater versions do not offer an unsafe install',async({page})=>{
 await fixture(page,{checked:false});await page.goto('/');await page.locator('#settings-open').click();await expect(page.locator('#update-status')).toContainText('Updateprüfung gerade nicht möglich');await expect(page.locator('#update-prepare')).toBeHidden();
 await fixture(page,{compatible:false});await page.reload();await page.locator('#settings-open').click();await expect(page.locator('#update-prepare')).toBeDisabled();await expect(page.locator('#update-incompatible')).toBeVisible();
});
test('update guide remains within a narrow touch viewport',async({page})=>{
 await page.setViewportSize({width:375,height:812});await fixture(page);await page.goto('/');await page.getByRole('button',{name:'Einstellungen · Update verfügbar',exact:true}).click();await page.locator('#update-prepare').click();
 expect(await page.locator('#update-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.locator('#update-close').click();await expect(page.locator('#settings-dialog')).toBeVisible();
});
