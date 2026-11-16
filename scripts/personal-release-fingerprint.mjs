import {createHash} from 'node:crypto';

export const PERSONAL_PACKAGE_NAME='iserv-zeitplaner-personal';
export const RELEASE_HASH_MODE='sha256-project-package-name-v1';

function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}

export function releaseFileFingerprint(file,bytes){
 let content=bytes;
 if(file==='package.json'||file==='package-lock.json'){
  const data=JSON.parse(Buffer.from(bytes).toString('utf8'));
  // Cloudflare replaces only the project's package name during template import.
  // All scripts, dependency declarations and lockfile entries remain covered.
  if(file==='package.json')data.name='__ISERV_PROJECT_PACKAGE_NAME__';
  content=JSON.stringify(canonical(data));
 }
 return createHash('sha256').update(content).digest('hex');
}
