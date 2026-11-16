import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
const tooling=await import(pathToFileURL(resolve('scripts/personal-release-fingerprint.mjs')).href);

async function fixture(t:any){
 const dir=await mkdtemp(join(tmpdir(),'iserv-release-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'scripts'));await mkdir(join(dir,'src'));
 const verifier=existsSync('scripts/verify-personal-release.mjs')?'scripts/verify-personal-release.mjs':'scripts/verify-release.mjs';
 await copyFile(verifier,join(dir,'scripts/verify-release.mjs'));
 await copyFile('scripts/personal-release-fingerprint.mjs',join(dir,'scripts/personal-release-fingerprint.mjs'));
 const config=JSON.parse(await readFile(existsSync('wrangler.personal.jsonc')?'wrangler.personal.jsonc':'wrangler.jsonc','utf8'));
 await writeFile(join(dir,'wrangler.jsonc'),JSON.stringify(config));
 const pkg:any={name:tooling.PERSONAL_PACKAGE_NAME,private:true,scripts:{build:'node scripts/verify-release.mjs && vite build'},dependencies:{example:'1.0.0'}};
 const lock:any={name:pkg.name,lockfileVersion:3,packages:{'':{name:pkg.name,dependencies:{example:'1.0.0'}},'node_modules/example':{version:'1.0.0',integrity:'sha512-fixture'}}};
 const write=(name:string,value:unknown)=>writeFile(join(dir,name),JSON.stringify(value,null,2)+'\n');
 await write('package.json',pkg);await write('package-lock.json',lock);await writeFile(join(dir,'src/personal-worker.ts'),'export default {};\n');
 const files:Record<string,string>={};
 for(const file of ['package.json','package-lock.json','scripts/verify-release.mjs','scripts/personal-release-fingerprint.mjs','src/personal-worker.ts'])files[file]=tooling.releaseFileFingerprint(file,await readFile(join(dir,file)));
 await write('release-manifest.json',{hashMode:tooling.RELEASE_HASH_MODE,files});
 return {dir,pkg,lock,config,write,verify:()=>run(process.execPath,['scripts/verify-release.mjs'],{cwd:dir})};
}

test('release verification accepts the observed Cloudflare project rename and JSON formatting',async t=>{
 const f=await fixture(t);await f.verify();
 f.pkg.name=f.config.name;
 await writeFile(join(f.dir,'package.json'),JSON.stringify(Object.fromEntries(Object.entries(f.pkg).reverse())));
 await writeFile(join(f.dir,'package-lock.json'),JSON.stringify(f.lock));
 await f.verify();
});

for(const change of ['build script','install hook','dependency','lockfile integrity','unrelated project name','source'] as const)test('release verification rejects changed '+change,async t=>{
 const f=await fixture(t);
 if(change==='build script')f.pkg.scripts.build='echo changed';
 if(change==='install hook')f.pkg.scripts.preinstall='echo changed';
 if(change==='dependency')f.pkg.dependencies.example='2.0.0';
 if(change==='lockfile integrity'){f.lock.packages['node_modules/example'].integrity='sha512-changed';await f.write('package-lock.json',f.lock);}
 if(change==='unrelated project name')f.pkg.name='unrelated-project';
 if(change==='source')await writeFile(join(f.dir,'src/personal-worker.ts'),'export default {changed:true};\n');
 await f.write('package.json',f.pkg);
 await assert.rejects(f.verify(),/Release source changed|Unexpected project package name/);
});
