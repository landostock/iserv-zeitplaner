import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile('release-manifest.json','utf8'));
for(const [file,wanted]of Object.entries(manifest.files)){
 if(file.startsWith('/')||file.split('/').includes('..'))throw new Error('Invalid release path');
 const actual=createHash('sha256').update(await readFile(file)).digest('hex');if(actual!==wanted)throw new Error('Release source changed: '+file+'. Review this change and update the manifest before building.');
}
const c=JSON.parse(await readFile('wrangler.jsonc','utf8'));
if(c.main!=='src/personal-worker.ts'||c.assets?.html_handling!=='none'||c.workers_dev!==true||c.preview_urls!==false||c.observability?.enabled!==false||c.services?.length||c.routes?.length||c.r2_buckets?.length||c.d1_databases?.length||JSON.stringify(c.triggers?.crons)!=='["* * * * *"]')throw new Error('Unexpected deployment configuration');
const wanted={INSTALLATION:'PersonalInstallation',GATE:'PersonalAccessGate',PUBLISHERS:'PersonalPublisher',VAULT_OBJECTS:'SqliteObjects'};
if(c.durable_objects?.bindings?.length!==4||c.durable_objects.bindings.some(b=>wanted[b.name]!==b.class_name))throw new Error('Unexpected private object binding');
if(JSON.stringify(c.migrations)!==JSON.stringify([{tag:'personal-v1',new_sqlite_classes:['PersonalInstallation','PersonalAccessGate','PersonalPublisher','SqliteObjects']}]))throw new Error('Unexpected storage migration');
if(!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(c.name)||Object.keys(c.vars||{}).length)throw new Error('Unsafe deployment variable');
console.log('Release source verified; secrets and private settings will be generated in the owner account.');
