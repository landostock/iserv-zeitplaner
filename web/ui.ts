/** Decorative local icons leave button labels and accessible names untouched. */
const icons:Record<string,string>={
 'settings-open':'settings','account-open':'user','login':'key','login-existing':'key','domain-key-create':'key','domain-key-verify':'check','passkey-enroll-start':'key','passkey-backup':'plus','recovery-start':'key',
 'refresh':'refresh','tab-planned':'clock','tab-past':'history','jobs-more':'more','review':'arrow','confirm-plan':'clock','confirm-back':'back','folder-back':'back','folder-select':'check','edit-save':'save','cancel-back':'back','cancel-confirm':'close',
 'connection-summary':'link','connection-open':'link','connection-disconnect':'logout','connection-save':'shield','logout':'logout',
 'push-enable':'bell','push-test':'mail','push-disable':'bell-off','push-local-test':'bell','quote-refresh':'refresh',
 'account-logout-others':'logout','account-logout-all':'logout','account-recovery-create':'shield','account-recovery-revoke':'close','account-delete':'close',
 'recovery-copy':'copy','invitation-copy':'copy','recovery-clear':'check',
};
function decorate(button:HTMLButtonElement){
 if(button.classList.contains('info-button'))return;
 if(button.id==='connection-summary'){delete button.dataset.uiIcon;button.style.removeProperty('--button-icon');return;}
 let icon:string|undefined=icons[button.id];
 if(button.classList.contains('close-button'))icon='close';
 if(!icon&&!button.matches('.folder-choice,.folder-row,.breadcrumbs button')){
  const text=button.textContent?.trim()||'';
  icon=/kopieren/i.test(text)?'copy':/einladung erstellen/i.test(text)?'mail':/speichern/i.test(text)?'save':/Termin ändern|Neu terminieren/.test(text)?'edit':/abmelden/i.test(text)?'logout':/entfernen|widerrufen|löschen|abbrechen|sperren/i.test(text)?'close':/hinzufügen|erstellen/i.test(text)?'plus':/prüfen|bestätigen|freigeben|gesichert/i.test(text)?'check':/anzeigen/i.test(text)?'more':/Administration|Mitglied/i.test(text)?'shield':'arrow';
 }
 if(icon){button.dataset.uiIcon=icon;button.style.setProperty('--button-icon',`url("/ui-icons/${icon}.svg")`);}
}
export function initUI(){
 const year=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',year:'numeric'}).format(new Date());document.querySelectorAll<HTMLElement>('[data-copyright-year]').forEach(n=>{n.textContent=year;});
 document.querySelectorAll<HTMLButtonElement>('button').forEach(decorate);
 const observer=new MutationObserver(records=>{
  const changed=new Set<HTMLButtonElement>();
  for(const r of records){const element=r.target instanceof Element?r.target:r.target.parentElement;const parent=element?.closest('button');if(parent)changed.add(parent);for(const n of r.addedNodes)if(n instanceof Element){if(n instanceof HTMLButtonElement)changed.add(n);n.querySelectorAll<HTMLButtonElement>('button').forEach(b=>changed.add(b));}}
  changed.forEach(decorate);
 });
 observer.observe(document.body,{childList:true,subtree:true,characterData:true});
}
