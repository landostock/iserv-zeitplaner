const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)as T;
const states=['konten','cloudflare','github','installation','ergebnis','zugriff','website'] as const;
const panels=['prepare','connect-cloudflare','connect-github','configure-deploy','deployment-result','review-github','open'];
let current=0;
const template='https://deploy.workers.cloudflare.com/?url='+encodeURIComponent('https://github.com/landostock/iserv-zeitplaner');
for(const a of document.querySelectorAll<HTMLAnchorElement>('.deploy-template'))a.href=template;
// The fragment holds only an allowlisted step name, never credentials or an owner URL.
function show(index:number,focus=true){
 current=index;
 for(const [i,id]of panels.entries())$(id).hidden=i!==index;
 $('step-count').textContent='Teil 1 · Schritt '+(index+1)+' von '+states.length;
 $('step-title').textContent=['Konten anmelden','GitHub verbinden','GitHub freigeben','Zeitplaner installieren','Bereitstellung abwarten','Zugriff begrenzen','Website öffnen'][index];
 $('back').hidden=index===0;
 $<HTMLDetailsElement>('help').open=false;
 for(const e of document.querySelectorAll<HTMLElement>('[data-help]'))e.hidden=!e.dataset.help!.split(' ').includes(states[index]);
 history.replaceState(null,'','#schritt='+states[index]);
 if(focus)$('step-title').focus({preventScroll:false});
}
$('accounts-ready').onchange=()=>{$<HTMLButtonElement>('prepare-next').disabled=!$<HTMLInputElement>('accounts-ready').checked;};
$('prepare-next').onclick=()=>show(1);
$('cloudflare-next').onclick=()=>show(2);
$('github-connected').onclick=()=>show(3);
$('github-next').onclick=()=>show(3);
$('configure-next').onclick=()=>show(4);
$('deploy-next').onclick=()=>show(5);
$('scope-next').onclick=()=>show(6);
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
 hint.textContent='Einrichtungscode und IServ-Passwort erst auf Ihrer eigenen Website eingeben.';
 if(!value)return;
 try{
  // Retain only an owner's canonical origin, including when /einrichten was copied.
  const u=new URL(value.includes('://')?value:'https://'+value);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.workers\.dev$/.test(u.origin))throw new Error();
  a.href=u.origin+'/einrichten';a.hidden=false;hint.textContent='Weiter auf '+u.hostname+'.';
 }catch{input.setAttribute('aria-invalid','true');hint.textContent='Bitte die feste Adresse aus Ihrem Cloudflare-Projekt einfügen, zum Beispiel mein-planer.mein-konto.workers.dev. Keine Vorschau- oder Dashboard-Adresse.';}
};
function restore(){const match=/^#schritt=([a-z]+)$/.exec(location.hash),index=states.indexOf(match?.[1] as typeof states[number]);show(index<0?0:index,false);}
window.addEventListener('hashchange',restore);
restore();
