import {readFile,writeFile,mkdir,rm,mkdtemp,readdir,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isReleaseSourcePath,releaseFileFingerprint,RELEASE_HASH_MODE} from './personal-release-fingerprint.mjs';
const SOURCE='https://github.com/landostock/iserv-zeitplaner.git';
const WORKFLOW='.github/workflows/zeitplaner-update.yml',TEMPLATE='scripts/zeitplaner-update.yml';
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
const json=async(root,path)=>JSON.parse(await readFile(join(root,path),'utf8'));
function version(v){if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc([1-9]\d*))?$/.test(v))throw new Error('Ungültige Versionsnummer.');return v;}
function newer(a,b){const parts=v=>v.split(/[.\-]/).map(x=>x.startsWith('rc')?Number(x.slice(2)):Number(x));const x=parts(a),y=parts(b);x[3]??=Number.MAX_SAFE_INTEGER;y[3]??=Number.MAX_SAFE_INTEGER;for(let i=0;i<4;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
async function regular(root,path){
 const parts=path.split('/');for(let i=1;i<=parts.length;i++){const p=await lstat(join(root,...parts.slice(0,i)));if(p.isSymbolicLink()||i===parts.length&&!p.isFile())throw new Error('Keine reguläre Quelldatei: '+path);}
 return readFile(join(root,path));
}
async function validate(root){
 const m=await json(root,'release-manifest.json');if(m.hashMode!==RELEASE_HASH_MODE||!m.files||typeof m.files!=='object'||Array.isArray(m.files))throw new Error('Ungültiges Release-Manifest.');
 const entries=Object.entries(m.files);if(!entries.length||entries.length>2000)throw new Error('Ungültiger Release-Umfang.');
 for(const [file,hash]of entries){if(!isReleaseSourcePath(file)||!(/^[a-f0-9]{64}$/).test(hash))throw new Error('Unerlaubte Quelldatei: '+file);const bytes=await regular(root,file);if(bytes.length>5*1024*1024||releaseFileFingerprint(file,bytes)!==hash)throw new Error('Eigene oder unvollständige Quelländerung: '+file);}
 const pkg=await json(root,'package.json'),config=await json(root,'wrangler.jsonc');if(!['iserv-zeitplaner-personal',config.name].includes(pkg.name))throw new Error('Unbekannter Paketname.');
 // Unknown source files are never silently deleted or incorporated into an update.
 async function walk(path){for(const e of await readdir(join(root,path),{withFileTypes:true})){const name=path+'/'+e.name;if(e.isDirectory())await walk(name);else if(isReleaseSourcePath(name)&&!m.files[name])throw new Error('Eigene zusätzliche Quelldatei: '+name);}}
 for(const dir of ['src','web','scripts','migrations','test','browser-tests'])await walk(dir);
 return m;
}
function deploymentShape(c){const d=structuredClone(c);delete d.name;return JSON.stringify(Object.fromEntries(Object.entries(d).sort(([a],[b])=>a.localeCompare(b))));}
export async function prepareUpdate(root,source,requested){
 version(requested);const before=await validate(root),next=await validate(source),current=await json(root,'personal-release.json'),release=await json(source,'personal-release.json');
 if(release.version!==requested||release.updaterProtocol!==2||current.updaterProtocol!==2||!newer(version(release.version),version(current.version)))throw new Error('Kein unterstütztes neueres Update.');
 const config=await json(root,'wrangler.jsonc'),newConfig=await json(source,'wrangler.jsonc');
 if(deploymentShape(config)!==deploymentShape(newConfig))throw new Error('Speicher- oder Worker-Konfiguration geändert. Manuelle Prüfung erforderlich.');
 const oldWorkflow=before.files[TEMPLATE]||before.files[WORKFLOW],newWorkflow=next.files[TEMPLATE]||next.files[WORKFLOW];
 if(!oldWorkflow||!newWorkflow||oldWorkflow!==newWorkflow||releaseFileFingerprint(TEMPLATE,await regular(root,WORKFLOW))!==oldWorkflow)throw new Error('Der Update-Workflow benötigt eine manuelle Aktualisierung.');
 for(const p of new Set([...Object.keys(before.files),...Object.keys(next.files)].filter(p=>p.startsWith('migrations/'))))if(before.files[p]!==next.files[p])throw new Error('Speicher-Migration geändert. Manuelle Prüfung erforderlich.');
 // Validate everything before the first mutation. Keep the owner's config and name.
 const projectName=(await json(root,'package.json')).name;
 for(const p of Object.keys(before.files))if(p!==WORKFLOW&&!next.files[p])await rm(join(root,p));
 for(const p of Object.keys(next.files)){
  if(p===WORKFLOW)continue;
  let bytes=await readFile(join(source,p));if(p==='package.json'){const pkg=JSON.parse(bytes);pkg.name=projectName;bytes=Buffer.from(JSON.stringify(pkg,null,2)+'\n');}
  await mkdir(dirname(join(root,p)),{recursive:true});await writeFile(join(root,p),bytes);
 }
 await writeFile(join(root,'release-manifest.json'),JSON.stringify(next,null,2)+'\n');
 return {from:current.version,to:release.version,notes:release.notes};
}
async function main(){
 const requested=version(process.argv[2]||''),root=process.cwd();
 if(git(root,['status','--porcelain']))throw new Error('Die Arbeitskopie enthält eigene Änderungen.');
 const branch='zeitplaner-update/'+requested;
 // This is a manually confirmed preparation, never a push to the live branch.
 const existing=git(root,['ls-remote','--heads','origin','refs/heads/'+branch]);
 if(existing){console.log('Vorbereiteter Update-Zweig existiert bereits: '+branch);return;}
 const temp=await mkdtemp(join(tmpdir(),'zeitplaner-update-'));
 try{
  git(temp,['init','--quiet']);git(temp,['fetch','--quiet','--depth=1',SOURCE,'refs/tags/v'+requested]);
  const commit=git(temp,['rev-parse','FETCH_HEAD']);
  const response=await fetch('https://raw.githubusercontent.com/landostock/iserv-zeitplaner/main/release-channel.json',{redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Die veröffentlichte Versionsliste ist nicht erreichbar.');
  const text=await response.text();if(text.length>12000)throw new Error('Ungültige Versionsliste.');const channel=JSON.parse(text);
  if(channel.version!==requested||channel.commit!==commit||channel.updaterProtocol!==2)throw new Error('Version und freigegebener Commit stimmen nicht überein. Im Zeitplaner erneut nach Updates suchen.');
  const tree=git(temp,['ls-tree','-r','FETCH_HEAD']);
  const entries=tree.split('\n').map(line=>{const m=/^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(line);if(!m)throw new Error('Unerlaubter Dateityp in Release.');return {sha:m[1],path:m[2]};});
  if(entries.length>2000)throw new Error('Release zu groß.');
  const stage=join(temp,'release');await mkdir(stage);
  for(const entry of entries){if(!['release-manifest.json','wrangler.jsonc'].includes(entry.path)&&!isReleaseSourcePath(entry.path))continue;const bytes=execFileSync('git',['show','FETCH_HEAD:'+entry.path],{cwd:temp,maxBuffer:5*1024*1024});await mkdir(dirname(join(stage,entry.path)),{recursive:true});await writeFile(join(stage,entry.path),bytes);}
  const result=await prepareUpdate(root,stage,requested);
  git(root,['checkout','-b',branch]);git(root,['add','--all','--',...Object.keys((await json(root,'release-manifest.json')).files).filter(p=>p!==WORKFLOW),'release-manifest.json']);
  // Include removals of obsolete source files, without touching local configuration.
  git(root,['add','--update','--','src','web','scripts','migrations','test','browser-tests']);
  git(root,['-c','user.name=Zeitplaner Update','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','-m','Update Zeitplaner auf '+requested]);
  git(root,['push','origin','HEAD:refs/heads/'+branch]);
  const repo=process.env.GITHUB_REPOSITORY;if(!/^[\w-]+\/[\w.-]+$/.test(repo||''))throw new Error('GitHub-Projekt fehlt.');
  const summary='## Zeitplaner-Update vorbereitet\n\n'+result.from+' → '+result.to+'\n\n'+result.notes.map(n=>'- '+n).join('\n')+'\n\nQuelle: `'+commit+'`\n\n[Änderungen prüfen und Pull Request erstellen](https://github.com/'+repo+'/compare/main...'+branch+'?expand=1)\n\nErst **Merge pull request → Confirm merge** übernimmt das Update in die Installation.\n';
  if(process.env.GITHUB_STEP_SUMMARY)await writeFile(process.env.GITHUB_STEP_SUMMARY,summary);console.log('Update-Zweig vorbereitet. Weiter mit der Prüfung und Freigabe bei GitHub.');
 }finally{await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error.message);process.exitCode=1;});
