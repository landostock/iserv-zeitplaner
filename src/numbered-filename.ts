import {filename} from './security.ts';
export function numberedFilename(name:string,n:number){
 const dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';
 return filename(stem.replace(/ \(\d+\)$/,'')+' ('+n+')'+ext);
}
