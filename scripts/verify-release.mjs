import {readFile} from 'node:fs/promises';
import {PERSONAL_PACKAGE_NAME,RELEASE_HASH_MODE,releaseFileFingerprint,isReleaseSourcePath} from './personal-release-fingerprint.mjs';
const manifest=JSON.parse(await readFile('release-manifest.json','utf8'));
if(manifest.hashMode!==RELEASE_HASH_MODE)throw new Error('Unsupported release fingerprint format');
const c=JSON.parse(await readFile('wrangler.jsonc','utf8'));
const pkg=JSON.parse(await readFile('package.json','utf8'));
if(pkg.name!==PERSONAL_PACKAGE_NAME&&pkg.name!==c.name)throw new Error('Unexpected project package name');
for(const [file,wanted]of Object.entries(manifest.files)){
 if(!isReleaseSourcePath(file))throw new Error('Unexpected release artifact: '+file);
 const actual=releaseFileFingerprint(file,await readFile(file));if(actual!==wanted)throw new Error('Release source changed: '+file+'. Review this change and update the manifest before building.');
}
if(c.main!=='src/personal-worker.ts'||c.assets?.html_handling!=='none'||c.workers_dev!==true||c.preview_urls!==false||c.observability?.enabled!==false||c.services?.length||c.routes?.length||c.r2_buckets?.length||c.d1_databases?.length||JSON.stringify(c.triggers?.crons)!=='["* * * * *"]')throw new Error('Unexpected deployment configuration');
const wanted={INSTALLATION:'PersonalInstallation',GATE:'PersonalAccessGate',PUBLISHERS:'PersonalPublisher',VAULT_OBJECTS:'SqliteObjects'};
if(c.durable_objects?.bindings?.length!==4||c.durable_objects.bindings.some(b=>wanted[b.name]!==b.class_name))throw new Error('Unexpected private object binding');
if(JSON.stringify(c.migrations)!==JSON.stringify([{tag:'personal-v1',new_sqlite_classes:['PersonalInstallation','PersonalAccessGate','PersonalPublisher','SqliteObjects']}]))throw new Error('Unexpected storage migration');
if(!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(c.name)||Object.keys(c.vars||{}).length)throw new Error('Unsafe deployment variable');
console.log('Release source verified; secrets and private settings will be generated in the owner account.');
