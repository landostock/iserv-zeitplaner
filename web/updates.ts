type Release={version:string;commit:string;updaterProtocol:number;notes:string[]};
type Status={installed:string;latest:Release|null;available:boolean;compatible:boolean;checked:boolean;repository:string|null};
export function initUpdatesUI(deps:{api:(path:string,options?:RequestInit)=>Promise<any>;active:()=>boolean}){
 const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)as T;
 const dialog=$<HTMLDialogElement>('update-dialog');let state:Status|null=null,generation=0,busy=false,lastCheck=0,target:string|null=null;
 const status=(text:string)=>{$('update-progress').textContent=text;};
 function render(){
  if(!state)return;const offer=Boolean(state.checked&&state.available&&state.latest);
  $('update-installed').textContent='Installiert: '+state.installed;
  $('update-status').textContent=!state.checked?'Updateprüfung gerade nicht möglich. Ihre installierte Version läuft weiter.':state.available?'Version '+state.latest!.version+' verfügbar.': 'Sie verwenden die aktuelle Version.';
  $('settings-open').textContent=offer?'Einstellungen · Update verfügbar':'Einstellungen';
  $<HTMLButtonElement>('update-prepare').hidden=!offer;
  $<HTMLButtonElement>('update-prepare').disabled=!state.compatible;
  $('update-incompatible').hidden=!offer||state.compatible;
  const notes=$('update-notes');notes.replaceChildren();if(offer)for(const text of state.latest!.notes){const li=document.createElement('li');li.textContent=text;notes.append(li);}
 }
 async function check(force=false){
  if(!deps.active()||busy||!force&&Date.now()-lastCheck<900000)return;
  const current=generation;busy=true;$<HTMLButtonElement>('update-check').disabled=true;
  try{const data:Status=await deps.api('/api/updates');if(current!==generation||!deps.active())return;state=data;lastCheck=Date.now();$('updates-panel').hidden=false;render();
   if(dialog.open&&target)status(data.installed===target?'Update installiert: '+target+'. Sie können den Zeitplaner neu laden.':'Installiert ist weiterhin '+data.installed+'. Warten Sie auf den erfolgreichen Cloudflare-Build und prüfen Sie erneut.');
   $('update-reload').hidden=!dialog.open||data.installed!==target;
  }catch{if(current!==generation)return;if(state){state.checked=false;render();}else $('updates-panel').hidden=true;if(dialog.open)status('Die Installation konnte gerade nicht geprüft werden. Prüfen Sie den Cloudflare-Build und versuchen Sie es erneut.');}
  finally{busy=false;$<HTMLButtonElement>('update-check').disabled=false;}
 }
 function links(){
  if(!state?.repository||!target)return;
  const base='https://github.com/'+state.repository;
  $<HTMLAnchorElement>('update-workflow').href=base+'/actions/workflows/zeitplaner-update.yml';
  $<HTMLAnchorElement>('update-compare').href=base+'/compare/main...zeitplaner-update/'+target+'?expand=1';
  $('update-provider-steps').hidden=false;
 }
 $('update-check').onclick=()=>{void check(true);};
 $('update-prepare').onclick=()=>{
  if(!state?.checked||!state.latest||!state.available||!state.compatible)return;
  target=state.latest.version;$('update-target').textContent=target;$<HTMLInputElement>('update-repository').value=state.repository||'';
  $('update-provider-steps').hidden=!state.repository;$('update-reload').hidden=true;status('');links();dialog.showModal();
 };
 $('update-repository-form').onsubmit=async e=>{
  e.preventDefault();if(busy||!deps.active())return;busy=true;const current=generation;$<HTMLButtonElement>('update-repository-save').disabled=true;status('Projektadresse wird geprüft …');
  try{const r=await deps.api('/api/updates',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({repository:$<HTMLInputElement>('update-repository').value})});if(current!==generation||!state)return;state.repository=r.repository;links();status('Projekt gespeichert. Prüfen Sie beim Öffnen von GitHub, dass es Ihre Zeitplaner-Kopie ist.');}
  catch{status('Bitte die Adresse Ihrer eigenen GitHub-Kopie eingeben, zum Beispiel https://github.com/IhrName/mein-iserv-zeitplaner.');}
  finally{busy=false;$<HTMLButtonElement>('update-repository-save').disabled=false;}
 };
 $('update-close').onclick=()=>dialog.close();$('update-verify').onclick=()=>{void check(true);};$('update-reload').onclick=()=>location.reload();
 return {
  refresh(){if(deps.active()){if(!lastCheck)$('updates-panel').hidden=false;void check();}else this.clear();},
  clear(){generation++;state=null;target=null;lastCheck=0;dialog.close();$('updates-panel').hidden=true;$('update-notes').replaceChildren();$<HTMLInputElement>('update-repository').value='';$('update-provider-steps').hidden=true;for(const id of ['update-workflow','update-compare'])$(id).removeAttribute('href');$('settings-open').textContent='Einstellungen';}
 };
}
