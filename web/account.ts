import {startAuthentication,startRegistration} from '@simplewebauthn/browser';
type Key={id:string;label:string;created_at:number;last_used_at:number|null;domain?:string;last_login_at?:number|null};
type State={owner:string;name:string;admin:boolean;keys:Key[];sessions:{id:string;label:string|null;created_at:number|null;expires_at:number;current:boolean}[];recoveryReady:boolean;recoveryCreatedAt:number|null;accounts:{id:string;name:string;role:string;active:number}[];invitations:{id:string;label:string;expires_at:number}[];domainMigration?:{enabled:boolean;target:string;registered:boolean;verifiedAt:number|null};migrationSummary?:{active:number;verified:number;ready:boolean}|null};
export function initAccountUI(deps:{api:(path:string,options?:RequestInit)=>Promise<any>;errorText:(e:unknown)=>string;refresh:()=>Promise<void>;hasUser:()=>boolean;notify:(text:string,error?:boolean)=>void;addDomainKey:()=>Promise<void>}){
 const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)as T,dialog=(id:string)=>$<HTMLDialogElement>(id);
 const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
 const date=(n:number)=>new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'}).format(n)+' Uhr';
 let generation=0;let state:State|null=null,busy=false,returnSettings=true,confirmDone:((v:boolean)=>void)|null=null;
 const status=(text:string,error=false)=>{$('account-status').textContent=text;$('account-status').className=error?'publication-error':'hint';};
 function clearSecrets(){$<HTMLTextAreaElement>('recovery-output').value='';$<HTMLTextAreaElement>('invitation-output').value='';$('recovery-secret').hidden=true;$('invitation-secret').hidden=true;}
 function confirm(title:string,text:string){$('account-confirm-title').textContent=title;$('account-confirm-text').textContent=text;dialog('account-confirm-dialog').showModal();return new Promise<boolean>(resolve=>{confirmDone=resolve;});}
 function finishConfirm(value:boolean){confirmDone?.(value);confirmDone=null;dialog('account-confirm-dialog').close();}
 $('account-confirm-no').onclick=()=>finishConfirm(false);$('account-confirm-yes').onclick=()=>finishConfirm(true);dialog('account-confirm-dialog').addEventListener('cancel',e=>{e.preventDefault();finishConfirm(false);});
 async function proof(){
  const options=await deps.api('/auth/passkey/login/options',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:'manage-account'})});
  const response=await startAuthentication({optionsJSON:options.options});
  return (await deps.api('/auth/passkey/login/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({response})})).stepUp;
 }
 async function refresh(){
  if(!dialog('account-dialog').open)return;
  const current=generation;try{const loaded=await deps.api('/api/account');if(current!==generation||!deps.hasUser())return false;state=loaded;render();return true;}catch(error){status(deps.errorText(error),true);return false;}
 }
 async function manage(input:Record<string,unknown>,confirmation?:[string,string]){
  if(busy)return null;if(confirmation&&!await confirm(...confirmation))return null;
  const cosmetic=input.action==='rename-key'||input.action==='rename-account';
  const current=generation;busy=true;$<HTMLButtonElement>('account-close').disabled=true;status(cosmetic?'Wird gespeichert …':'Bitte bestätigen Sie die Änderung mit einem eingerichteten Passkey …');
  try{
   const stepUp=cosmetic?undefined:await proof();if(current!==generation||!deps.hasUser())return null;const result=await deps.api('/api/account/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,...(stepUp?{stepUp}:{})})});
   if(current!==generation)return null;
   if(result.signedOut){returnSettings=false;clearSecrets();dialog('account-dialog').close();await deps.refresh();return result;}
   let sessionUpdated=true;try{await deps.refresh();}catch{sessionUpdated=false;}if(current!==generation||!deps.hasUser())return null;const loaded=await refresh();status(sessionUpdated&&loaded?'Änderung gespeichert.':'Änderung gespeichert. Die Übersicht konnte noch nicht aktualisiert werden. Bitte erneut öffnen.',!sessionUpdated||!loaded);return result;
  }catch(error){status(error instanceof Error&&error.name==='NotAllowedError'?'Die Gerätebestätigung wurde abgebrochen. Es wurde keine Änderung bestätigt.':deps.errorText(error),true);return null;}
  finally{busy=false;$<HTMLButtonElement>('account-close').disabled=false;}
 }
 function action(text:string,fn:()=>void,cls='text-button'){const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;}
 function render(){
  if(!state)return;$('account-content').hidden=false;$<HTMLInputElement>('account-display-name').value=state.name;$('account-admin').hidden=!state.admin;
  const migration=state.domainMigration;$('domain-migration').hidden=!migration?.enabled;
  if(migration?.enabled){$('domain-migration-status').textContent=migration.verifiedAt?'✓ Anmeldung für die neue Adresse bestätigt.':migration.registered?'Passkey gespeichert. Prüfen Sie jetzt die Anmeldung für die neue Adresse.':'Speichern Sie einen Passkey für die neue Adresse. Ihr Konto und Ihre Aufträge bleiben erhalten.';$('domain-key-create').hidden=Boolean(migration.verifiedAt);$('domain-key-create').textContent=migration.registered?'Anderen Passkey speichern':'Passkey für neue Adresse speichern';$('domain-key-verify').hidden=!migration.registered||Boolean(migration.verifiedAt);$('domain-migration-summary').hidden=!state.admin;if(state.migrationSummary)$('domain-migration-summary').textContent=state.migrationSummary.ready?'Alle aktiven Zugänge sind umgestellt. Die alte Adresse kann technisch abgeschaltet werden.':state.migrationSummary.verified+' von '+state.migrationSummary.active+' aktiven Zugängen umgestellt.';}
  const list=$('account-keys');list.replaceChildren();
  for(const key of state.keys){
   const row=node('div','','account-item'),input=node('input');input.value=key.label;input.maxLength=80;input.setAttribute('aria-label','Bezeichnung für '+key.label);
   const meta=node('p',(state.domainMigration?.enabled?(key.domain===state.domainMigration.target?'Neue Adresse':'Bisherige Adresse')+' · ':'')+'Erstellt '+date(key.created_at)+(key.last_used_at?' · zuletzt bestätigt '+date(key.last_used_at):''),'hint');
   const buttons=node('div','','settings-actions');buttons.append(action('Bezeichnung speichern',()=>{void manage({action:'rename-key',id:key.id,label:input.value});}),action('Passkey entfernen',()=>{void manage({action:'remove-key',id:key.id,confirm:'remove-passkey'},['Passkey entfernen?',`„${key.label}“ kann danach nicht mehr zur Anmeldung dienen. Mit diesem Passkey verbundene andere Sitzungen werden abgemeldet. Bestätigen Sie mit einem anderen verbleibenden Passkey.`]);}));
   (buttons.lastElementChild as HTMLButtonElement).disabled=state.keys.length<=1;row.append(input,meta,buttons);list.append(row);
  }
  const sessions=$('account-sessions');sessions.replaceChildren();for(const s of state.sessions){const row=node('div','','account-item'),text=(s.current?'Diese Sitzung':s.label||'Weitere Sitzung')+' · gültig bis '+date(s.expires_at);row.append(node('p',text,'hint'));if(!s.current)row.append(action('Sitzung abmelden',()=>{void manage({action:'revoke-session',id:s.id});}));sessions.append(row);}
  $<HTMLButtonElement>('account-logout-others').disabled=!state.sessions.some(s=>!s.current);
  $('account-recovery-state').textContent=state.recoveryReady?'Ein Wiederherstellungscode ist eingerichtet'+(state.recoveryCreatedAt?' seit '+date(state.recoveryCreatedAt):'')+'.':'Noch kein Wiederherstellungscode eingerichtet.';
  $('account-recovery-create').textContent=state.recoveryReady?'Code ersetzen':'Wiederherstellungscode erstellen';$('account-recovery-revoke').hidden=!state.recoveryReady;
  const invitations=$('account-invitations');invitations.replaceChildren();for(const i of state.invitations){const row=node('div','','account-item');row.append(node('p',i.label+' · gültig bis '+date(i.expires_at),'hint'),action('Einladung widerrufen',()=>{void manage({action:'revoke-invite',id:i.id});}));invitations.append(row);}
  const members=$('account-members');members.replaceChildren();for(const a of state.accounts){
   const row=node('div','','account-item');row.append(node('strong',a.name+(a.id===state.owner?' (Sie)':'')),node('p',(a.role==='admin'?'App-Administration':'Mitglied')+' · '+(a.active?'aktiv':'gesperrt'),'hint'));
   const buttons=node('div','','settings-actions');
   buttons.append(action(a.active?'Konto sperren':'Konto freigeben',()=>{void manage({action:'set-account-active',owner:a.id,active:!a.active},[a.active?'Konto sperren?':'Konto freigeben?',a.active?'Alle App-Sitzungen werden beendet. Der gespeicherte IServ-Zugang wird entfernt; wartende Aufträge werden angehalten.':'Die Person kann sich wieder mit ihren Passkeys anmelden und muss IServ gegebenenfalls neu verbinden.']);}));
   buttons.append(action(a.role==='admin'?'Als Mitglied führen':'Administration erlauben',()=>{void manage({action:'set-role',owner:a.id,role:a.role==='admin'?'member':'admin'},['App-Rolle ändern?',a.role==='admin'?'Diese Person verliert die Verwaltung von App-Konten und Einladungen.':'Diese Person darf weitere App-Konten einladen, sperren und entfernen. Das verleiht keine zusätzlichen IServ-Rechte.']);}));
   if(a.id!==state.owner)buttons.append(action('Konto löschen …',()=>{void manage({action:'delete-account',owner:a.id,confirm:'delete-account-and-private-sources'},['App-Konto löschen?',`„${a.name}“ verliert den Zugang. Gespeicherter IServ-Zugang, Dateiquellen und Aufträge werden entfernt. Dateien auf IServ bleiben erhalten; bereits gestartete Übertragungen lassen sich nicht sicher zurückrufen. Technische Ausführungsbelege bleiben befristet erhalten.`]);},'text-button danger-text'));
   row.append(buttons);members.append(row);
  }
  const soleAdmin=state.admin&&state.accounts.filter(a=>a.role==='admin'&&a.active).length<=1;
  $<HTMLButtonElement>('account-delete').disabled=soleAdmin;$('account-delete-note').textContent=soleAdmin?'Das letzte Administrationskonto bleibt erhalten. Weisen Sie zuerst einer anderen vertrauenswürdigen Person die Administration zu.':'';
 }
 $('account-open').onclick=()=>{returnSettings=true;clearSecrets();dialog('settings-dialog').close();dialog('account-dialog').showModal();status('Kontoverwaltung wird geladen …');$('account-content').hidden=true;void refresh().then(()=>{if(state)status('');});};
 $('account-close').onclick=()=>{if(!busy)dialog('account-dialog').close();};
 dialog('account-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 dialog('account-dialog').addEventListener('close',()=>{clearSecrets();state=null;if(returnSettings&&deps.hasUser()){dialog('settings-dialog').showModal();$('account-open').focus();}});
 $('account-name-form').onsubmit=e=>{e.preventDefault();void manage({action:'rename-account',name:$<HTMLInputElement>('account-display-name').value});};
 $('domain-key-create').onclick=()=>{void deps.addDomainKey();};
 $('domain-key-verify').onclick=async()=>{
  if(busy)return;const current=generation;busy=true;$<HTMLButtonElement>('domain-key-verify').disabled=true;$<HTMLButtonElement>('account-close').disabled=true;status('Bitte den Passkey für die neue Adresse bestätigen …');
  try{const options=await deps.api('/auth/passkey/login/options',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:'verify-domain'})});const response=await startAuthentication({optionsJSON:options.options});if(current!==generation||!deps.hasUser())return;await deps.api('/auth/passkey/login/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({response})});await deps.refresh();if(current!==generation||!deps.hasUser())return;await refresh();status('Anmeldung auf der neuen Adresse bestätigt.');}
  catch(error){if(current===generation)status(error instanceof Error&&error.name==='NotAllowedError'?'Prüfung abgebrochen. Sie können sie erneut starten.':deps.errorText(error),true);}
  finally{busy=false;$<HTMLButtonElement>('domain-key-verify').disabled=false;$<HTMLButtonElement>('account-close').disabled=false;}
 };
 $('account-logout-others').onclick=()=>{void manage({action:'logout-others'});};
 $('account-logout-all').onclick=()=>{void manage({action:'logout-all',confirm:'logout-all'},['Überall abmelden?','Alle App-Sitzungen einschließlich dieser werden beendet. Geplante Veröffentlichungen laufen weiter.']);};
 $('account-recovery-create').onclick=async()=>{const r=await manage({action:'create-recovery',confirm:'replace-recovery-code'},['Wiederherstellungscode erstellen?','Ein bisheriger Code wird ungültig. Mit dem neuen Code kann Ihr App-Konto auf ein neues Gerät übernommen werden. Bewahren Sie ihn separat und geschützt auf.']);if(r?.recoveryCode){$<HTMLTextAreaElement>('recovery-output').value=r.recoveryCode;$('recovery-secret').hidden=false;status('Code wird nur jetzt angezeigt. Bitte sicher speichern.');}};
 $('account-recovery-revoke').onclick=()=>{void manage({action:'revoke-recovery'},['Code ungültig machen?','Ohne weitere Passkeys und ohne gültigen Wiederherstellungscode können Sie bei Geräteverlust den Zugang verlieren.']);};
 $('recovery-clear').onclick=()=>{$<HTMLTextAreaElement>('recovery-output').value='';$('recovery-secret').hidden=true;};
 $('invitation-form').onsubmit=async e=>{e.preventDefault();const r=await manage({action:'create-invite',label:$<HTMLInputElement>('invitation-label').value});if(r?.invitation){$<HTMLTextAreaElement>('invitation-output').value=r.invitation;$('invitation-secret').hidden=false;status('Einladungslink ist einmalig und 24 Stunden gültig. Nur persönlich weitergeben.');}};
 $('account-delete').onclick=()=>{void manage({action:'delete-account',confirm:'delete-account-and-private-sources'},['Ihr App-Konto löschen?','Diese Änderung ist nicht rückgängig zu machen. Ihr gespeicherter IServ-Zugang, Dateiquellen und Aufträge werden entfernt. Dateien auf IServ bleiben erhalten. Technische Ausführungsbelege bleiben befristet zum Schutz vor Doppelveröffentlichung erhalten. Bereits gestartete Übertragungen lassen sich nicht sicher zurückrufen.']);};
 for(const [button,field]of [['recovery-copy','recovery-output'],['invitation-copy','invitation-output']])$(button).onclick=async()=>{const input=$<HTMLTextAreaElement>(field);try{await navigator.clipboard.writeText(input.value);status('Kopiert.');}catch{input.focus();input.select();status('Bitte den markierten Text selbst kopieren.');}};
 $('recovery-form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;busy=true;const button=$<HTMLButtonElement>('recovery-start');button.disabled=true;const code=$<HTMLInputElement>('recovery-input').value;$<HTMLInputElement>('recovery-input').value='';
  try{const d=await deps.api('/auth/passkey/recover/options',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recoveryCode:code})});const response=await startRegistration({optionsJSON:d.options});await deps.api('/auth/passkey/recover/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({response})});await deps.refresh();deps.notify('Zugang wiederhergestellt. Alte Passkeys, Sitzungen und der verwendete Code sind ungültig. Richten Sie in den Einstellungen einen neuen Wiederherstellungscode ein.');}
  catch(error){$('setup-message').textContent=error instanceof Error&&error.name==='NotAllowedError'?'Die Gerätebestätigung wurde abgebrochen. Der Wiederherstellungscode wurde nicht verbraucht.':deps.errorText(error);}
  finally{busy=false;button.disabled=false;}
 };
 return {refresh,reset:()=>{generation++;returnSettings=false;clearSecrets();state=null;if(confirmDone)finishConfirm(false);}};
}
