const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)as T;
const states=['konten','github','installation','ergebnis','website'] as const;
let current=0;
const template='https://deploy.workers.cloudflare.com/?url='+encodeURIComponent('https://github.com/landostock/iserv-zeitplaner');
for(const a of document.querySelectorAll<HTMLAnchorElement>('.deploy-template'))a.href=template;
// The fragment holds only an allowlisted step name, never credentials or an owner URL.
function show(index:number,focus=true){
 current=index;
 const main=index===0?0:index===4?2:1;
 for(const [i,id]of ['prepare','deploy','open'].entries())$(id).hidden=i!==main;
 for(const [i,id]of ['connect-github','configure-deploy','deployment-result'].entries())$(id).hidden=index!==i+1;
 $('step-count').textContent='Schritt '+(main+1)+' von 3';
 $('step-title').textContent=['Konten vorbereiten','GitHub verbinden','Zeitplaner installieren','Installation abschließen','Website öffnen'][index];
 $('back').hidden=index===0;
 document.querySelectorAll('#steps li').forEach((e,i)=>{e.classList.toggle('current',i===main);e.classList.toggle('done',i<main);if(i===main)e.setAttribute('aria-current','step');else e.removeAttribute('aria-current');});
 document.querySelectorAll('.deployment-stages li').forEach((e,i)=>{e.classList.toggle('current',index===i+1);e.classList.toggle('done',index>i+1);if(index===i+1)e.setAttribute('aria-current','step');else e.removeAttribute('aria-current');});
 history.replaceState(null,'','#schritt='+states[index]);
 if(focus)$('step-title').focus({preventScroll:false});
}
$('accounts-ready').onchange=()=>{$<HTMLButtonElement>('prepare-next').disabled=!$<HTMLInputElement>('accounts-ready').checked;};
$('prepare-next').onclick=()=>show(1);
$('github-next').onclick=()=>show(2);
$('configure-next').onclick=()=>show(3);
$('deploy-next').onclick=()=>show(4);
$('back').onclick=()=>show(Math.max(0,current-1));
$('copy-project').onclick=async()=>{
 const input=$<HTMLInputElement>('project-suggestion'),note=$('copy-status');
 try{await navigator.clipboard.writeText(input.value);note.textContent='Projektname kopiert.';}
 catch{input.focus();input.select();note.textContent='Bitte den markierten Projektnamen kopieren.';}
 note.hidden=false;
};
$('own-address').oninput=()=>{
 const a=$<HTMLAnchorElement>('open-own'),input=$<HTMLInputElement>('own-address'),hint=$('address-hint');
 a.hidden=true;a.removeAttribute('href');input.removeAttribute('aria-invalid');
 const value=input.value.trim();
 hint.textContent='Die Adresse endet auf .workers.dev. Einrichtungscode und IServ-Passwort erst auf Ihrer eigenen Website eingeben.';
 if(!value)return;
 try{
  // Accept a copied /einrichten or dashboard path, but only retain the canonical origin.
  const u=new URL(value.includes('://')?value:'https://'+value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.workers\.dev$/.test(u.origin))throw new Error();
  a.href=u.origin+'/einrichten';a.hidden=false;hint.textContent='Weiter auf '+u.hostname+'.';
 }catch{input.setAttribute('aria-invalid','true');hint.textContent='Bitte die feste Adresse aus Ihrem Cloudflare-Projekt einfügen, zum Beispiel mein-planer.mein-konto.workers.dev. Keine Vorschau- oder Dashboard-Adresse.';}
};
$('release-note').textContent='Testversion: Die Installation mit neu angelegten Konten ist noch nicht abschließend geprüft.';
function restore(){const match=/^#schritt=([a-z]+)$/.exec(location.hash),index=states.indexOf(match?.[1] as typeof states[number]);show(index<0?0:index,false);}
window.addEventListener('hashchange',restore);
restore();
