import release from '../personal-release.json';
import {readLimited} from './security.ts';
export const UPDATE_SOURCE='https://raw.githubusercontent.com/landostock/iserv-zeitplaner/main/release-channel.json';
export const UPDATE_PROTOCOL=1;
export const INSTALLED_VERSION=release.version;
export type UpdateRelease={version:string;commit:string;updaterProtocol:number;notes:string[]};
export function versionParts(value:unknown):number[]|null{
 if(typeof value!=='string')return null;
 const m=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc([1-9]\d*))?$/.exec(value);
 if(!m)return null;const p=[Number(m[1]),Number(m[2]),Number(m[3]),m[4]?Number(m[4]):Number.MAX_SAFE_INTEGER];
 return p.every(Number.isSafeInteger)?p:null;
}
export function newerVersion(candidate:string,installed:string){const a=versionParts(candidate),b=versionParts(installed);if(!a||!b)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]>b[i];return false;}
export function parseRelease(data:unknown):UpdateRelease{
 const d=data as UpdateRelease;
 if(!d||!versionParts(d.version)||!/^\d+\.\d+\.\d+(?:-rc\d+)?$/.test(d.version)||typeof d.commit!=='string'||!(/^[a-f0-9]{40}$/).test(d.commit)||!Number.isSafeInteger(d.updaterProtocol)||d.updaterProtocol<1||!Array.isArray(d.notes)||d.notes.length>12||!d.notes.every(n=>typeof n==='string'&&n.length>0&&n.length<=500))throw new Error('Invalid update release');
 return {version:d.version,commit:d.commit,updaterProtocol:d.updaterProtocol,notes:d.notes};
}
export function updateRepository(value:unknown):string{
 if(typeof value!=='string')throw new Error('Invalid repository');
 let s=value.trim();if(s.startsWith('https://github.com/'))s=s.slice(19);s=s.replace(/\/$/,'').replace(/\.git$/,'');
 if(!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9_.-]{1,100}$/.test(s)||s.split('/').some(p=>p==='.'||p==='..')||s.toLowerCase()==='landostock/iserv-zeitplaner')throw new Error('Invalid repository');
 return s;
}
let cached:{at:number;value:UpdateRelease}|null=null;
export async function updateStatus(fetcher:typeof fetch=fetch){
 const base={installed:INSTALLED_VERSION,repositorySource:'https://github.com/landostock/iserv-zeitplaner',latest:null as UpdateRelease|null,available:false,compatible:false,checked:false};
 try{
  if(!cached||Date.now()-cached.at>900000){const r=await fetcher(UPDATE_SOURCE,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});if(!r.ok)throw new Error('Unavailable');cached={at:Date.now(),value:parseRelease(JSON.parse(new TextDecoder().decode(await readLimited(r,12000))))};}
  const latest=cached.value;return {...base,latest,available:newerVersion(latest.version,INSTALLED_VERSION),compatible:latest.updaterProtocol===UPDATE_PROTOCOL,checked:true};
 }catch{return base;}
}
