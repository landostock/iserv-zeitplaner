import {createHash} from 'node:crypto';

export const PERSONAL_PACKAGE_NAME='iserv-zeitplaner-personal';
export const RELEASE_HASH_MODE='sha256-project-package-name-v1';
export const RELEASE_SOURCE_DIRS=['src','web','migrations','scripts','test','browser-tests'];
export const RELEASE_SOURCE_FILES=['personal-release.json','.dev.vars.example','.gitignore','.node-version','package.json','package-lock.json','tsconfig.json','tsconfig.web.json','vite.config.ts','playwright.config.ts','README.md','SECURITY.md','INSTALLATION-CHECKS.md'];

export function isReleaseSourcePath(file){
 if(typeof file!=='string'||file.includes('\\'))return false;
 if(RELEASE_SOURCE_FILES.includes(file)||file==='.github/workflows/zeitplaner-update.yml')return true;
 const parts=file.split('/');
 if(parts.length<2||!RELEASE_SOURCE_DIRS.includes(parts[0])||parts.some(p=>!p||p==='.'||p==='..'))return false;
 return !parts.some(p=>/^(?:secrets|tmp|output|node_modules|dist|test-results|playwright-report|\.git|\.wrangler|\.dev\.vars(?:\..*)?|\.env(?:\..*)?|\.DS_Store)$/i.test(p))&&!/\.(?:pdf|sqlite|sqlite3|db|key|secret)$/i.test(file);
}

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
