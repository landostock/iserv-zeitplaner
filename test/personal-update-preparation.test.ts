import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const tooling=await import(pathToFileURL(resolve('scripts/personal-release-fingerprint.mjs')).href);
const {prepareUpdate}=await import(pathToFileURL(resolve('scripts/prepare-personal-update.mjs')).href);
async function fixture(t:any){
 const dir=await mkdtemp(join(tmpdir(),'update-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 async function make(name:string,version:string){const root=join(dir,name),files:Record<string,string>={};
  async function put(path:string,data:string){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),data);files[path]=tooling.releaseFileFingerprint(path,Buffer.from(data));}
  for(const d of ['src','web','scripts','migrations','test','browser-tests'])await mkdir(join(root,d),{recursive:true});
  await put('personal-release.json',JSON.stringify({version,updaterProtocol:1,notes:['Synthetic release']}));
  await put('package.json',JSON.stringify({name:name==='own'?'eigener-worker':'iserv-zeitplaner-personal'}));
  await put('src/app.ts',version);await put('migrations/0001.sql','unchanged schema');await put('.github/workflows/zeitplaner-update.yml','unchanged workflow');
  await writeFile(join(root,'wrangler.jsonc'),JSON.stringify({name:name==='own'?'eigener-worker':'mein-iserv-zeitplaner',durable_objects:{bindings:[{name:'FIXTURE',class_name:'Fixture'}]},migrations:[{tag:'v1'}]}));
  const manifest=()=>writeFile(join(root,'release-manifest.json'),JSON.stringify({hashMode:tooling.RELEASE_HASH_MODE,files}));await manifest();return{root,put,manifest};
 }
 return{own:await make('own','1.0.0-rc2'),next:await make('next','1.0.0-rc3')};
}
test('update preparation preserves worker configuration and local secrets while updating all reviewed sources',async t=>{
 const {own,next}=await fixture(t),config=await readFile(join(own.root,'wrangler.jsonc'));
 await writeFile(join(own.root,'.dev.vars'),'SYNTHETIC_PRIVATE=keep');await writeFile(join(own.root,'src/removed.ts'),'old');await own.put('src/removed.ts','old');await own.manifest();
 const r=await prepareUpdate(own.root,next.root,'1.0.0-rc3');assert.equal(r.to,'1.0.0-rc3');assert.equal(await readFile(join(own.root,'src/app.ts'),'utf8'),'1.0.0-rc3');
 assert.deepEqual(await readFile(join(own.root,'wrangler.jsonc')),config);assert.equal(await readFile(join(own.root,'.dev.vars'),'utf8'),'SYNTHETIC_PRIVATE=keep');assert.equal(JSON.parse(await readFile(join(own.root,'package.json'),'utf8')).name,'eigener-worker');await assert.rejects(readFile(join(own.root,'src/removed.ts')),/ENOENT/);
});
for(const change of ['custom source','extra source','migration','config','workflow','downgrade','path traversal'] as const)test('update preparation stops before writes for '+change,async t=>{
 const {own,next}=await fixture(t),before=await readFile(join(own.root,'personal-release.json'));
 if(change==='custom source')await writeFile(join(own.root,'src/app.ts'),'custom');
 if(change==='extra source')await writeFile(join(own.root,'src/custom.ts'),'custom');
 if(change==='migration'){await next.put('migrations/0001.sql','changed schema');await next.manifest();}
 if(change==='workflow'){await next.put('.github/workflows/zeitplaner-update.yml','changed workflow');await next.manifest();}
 if(change==='config')await writeFile(join(next.root,'wrangler.jsonc'),'{"name":"other","migrations":[]}');
 if(change==='path traversal'){const m=JSON.parse(await readFile(join(next.root,'release-manifest.json'),'utf8'));m.files['src/../../secrets.key']='a'.repeat(64);await writeFile(join(next.root,'release-manifest.json'),JSON.stringify(m));}
 await assert.rejects(prepareUpdate(own.root,next.root,change==='downgrade'?'1.0.0-rc1':'1.0.0-rc3'));assert.deepEqual(await readFile(join(own.root,'personal-release.json')),before);
});
