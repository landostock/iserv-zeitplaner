const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)as T;
let step=0;
function show(n:number){step=n;for(const [i,id]of ['prepare','deploy','open'].entries())$(id).hidden=i!==n;$('step-count').textContent='Schritt '+(n+1)+' von 3';$('step-title').textContent=['Konten vorbereiten','Zeitplaner installieren','Website öffnen'][n];$('back').hidden=n===0;document.querySelectorAll('#steps li').forEach((e,i)=>{e.classList.toggle('current',i===n);e.classList.toggle('done',i<n);});}
$('accounts-ready').onchange=()=>{$<HTMLButtonElement>('prepare-next').disabled=!$<HTMLInputElement>('accounts-ready').checked;};
$('prepare-next').onclick=()=>show(1);$('deploy-next').onclick=()=>show(2);$('back').onclick=()=>show(step-1);
$('own-address').oninput=()=>{const a=$<HTMLAnchorElement>('open-own');a.hidden=true;try{const u=new URL($<HTMLInputElement>('own-address').value.trim());if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.workers\.dev$/.test(u.origin))return;a.href=u.origin+'/einrichten';a.hidden=false;}catch{}};
const link=$<HTMLAnchorElement>('deploy-link');
// This is a source transfer into the owner's repository, not a remote updater.
link.href='https://deploy.workers.cloudflare.com/?url='+encodeURIComponent('https://github.com/landostock/iserv-zeitplaner');
$('release-note').textContent='Testversion: Die Installation mit neu angelegten Konten ist noch nicht abschließend geprüft.';
show(0);
