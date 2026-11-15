export {};
import {initUI} from './ui.ts';
import {initAccountUI} from './account.ts';
import {startRegistration,startAuthentication,browserSupportsWebAuthn} from '@simplewebauthn/browser';
import { probeFeedback } from '../src/probe-feedback.ts';
import type { ProbeDiagnostic } from '../src/probe-feedback.ts';
import { writeProbeFeedback, testFileFeedback, testFilePropertiesFeedback, testFileCapabilitiesFeedback } from '../src/write-probe-feedback.ts';
import type { WriteProbeDiagnostic } from '../src/write-probe-feedback.ts';
import { lockProbeFeedback } from '../src/lock-probe-feedback.ts';
import { UI_PROBE_REPLACEMENT, uiLockFeedback } from '../src/ui-lock-probe-feedback.ts';
import type { UiLockEvent, UiObservation } from '../src/ui-lock-probe-feedback.ts';
import { targetProbeFeedback } from '../src/target-probe-feedback.ts';
initUI();
class ApiError extends Error {constructor(code:string,public diagnostic?:unknown){super(code);}}
type Job={id:string;filename:string;publishedFilename?:string|null;targetNaming?:string;temporaryFilename?:string|null;folder:string;size:number;dueAt:number;localTime:string;status:string;revision:number;errorCode:string|null;confirmedAt:number|null;attempts:number;nextAttemptAt:number;editable:boolean;checkable?:boolean;cancellable?:boolean};
type Session={selfHosted?:boolean;legacyPasskeyAvailable?:boolean;legacyLoginOrigin?:string|null;accountManagementAvailable?:boolean;mode:string;ready:boolean;school:string;user:{id?:string;name:string;csrf:string}|null;groupRoot:string;maxFileBytes:number;lastSchedulerRun:number|null;integrationBlock?:string|null;authMode?:string;authReady?:boolean;stage?:string;rootLabel?:string;historyRetentionDays?:number;targetNaming?:string;originalMoveEnabled?:boolean;originalGroupsBlocked?:boolean;confirmedReplaceEnabled?:boolean;numberedNamingEnabled?:boolean;copyProbeBlocked?:boolean;targetCheckAvailable?:boolean};
type Folder={path:string;name:string;writable:boolean;permission:string};
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)as T;
const dialog=(id:string)=>$<HTMLDialogElement>(id);
let bootstrapInvite=/^#einladung=([a-f0-9]{64})$/.exec(location.hash)?.[1]||'';
if(bootstrapInvite)history.replaceState(null,'',location.pathname+location.search);
let passkeyBusy=false,inviteNoticeShown=false;
const errors:Record<string,string>={
  recovery_invalid:'Der Wiederherstellungscode ist ungültig oder bereits verwendet. Prüfen Sie den Code oder verwenden Sie einen bestehenden Passkey.',
  invitation_requires_logout:'Melden Sie sich zuerst ab, um mit dieser Einladung ein eigenes neues Konto einzurichten.',
  account_confirmation_required:'Die ausdrückliche Bestätigung fehlt. Bitte starten Sie die Änderung erneut.',
  account_limit:'Die fünf Plätze dieses Piloten sind durch Konten oder offene Einladungen belegt. Widerrufen Sie gegebenenfalls eine offene Einladung.',
  passkey_current:'Bestätigen Sie das Entfernen mit einem anderen verbleibenden Passkey.',
  passkey_last:'Der letzte Passkey bleibt erhalten. Richten Sie zuerst einen weiteren Passkey ein.',
  last_administrator:'Mindestens ein aktives Administrationskonto muss erhalten bleiben. Weisen Sie zuerst einer weiteren Person die Administration zu.',
  copy_probe_rejected:'Der Kopierweg hat den Schutz vor gleichzeitigem Überschreiben nicht bestanden. Weitere Kopiertests sind gesperrt. Nummerierte Veröffentlichungen bleiben deaktiviert.',
  copy_probe_consent_required:'Bitte bestätigen Sie zuerst den eigenen Testordner und die vier neuen Testdateien.',
  numbered_names_exhausted:'Im geprüften Nummernbereich ist kein freier Name vorhanden. Bitte wählen Sie einen anderen Dateinamen.',
  name_probe_unavailable:'Die Originalnamen-Prüfung ist für diese Verbindung noch nicht verfügbar.',
  name_probe_limit:'Heute wurden bereits drei Namensprüfungen begonnen. Bitte versuchen Sie es nach dem Tageswechsel erneut.',
  name_probe_consent_required:'Bitte bestätigen Sie zuerst den privaten Testordner und die beschriebenen Testdateien.',
  write_probe_private_only:'Bitte wählen Sie für diese Prüfung Ihren eigenen privaten Testordner unter Eigene Dateien.',
  push_unavailable:'Gerätebenachrichtigungen sind noch nicht verfügbar.',
  push_limit:'Für diesen Zugang sind bereits drei Geräte für Benachrichtigungen angemeldet.',
  invalid_push:'Die Geräteanmeldung für Benachrichtigungen konnte nicht bestätigt werden.',
  push_consent_required:'Bitte schalten Sie Benachrichtigungen mit der dafür vorgesehenen Schaltfläche ein.',
  passkey_expired:'Die Anmeldung ist abgelaufen. Bitte starten Sie sie erneut.',
  passkey_failed:'Die Geräteanmeldung konnte nicht bestätigt werden. Bitte versuchen Sie es erneut.',
  invitation_invalid:'Dieser Einrichtungslink ist ungültig oder wurde bereits verwendet. Mit einem eingerichteten Zugang können Sie sich weiterhin anmelden.',
  passkey_reauthenticate:'Bitte bestätigen Sie Ihre bestehende Geräteanmeldung erneut, bevor Sie einen weiteren Schlüssel hinterlegen.',
  passkey_limit:'Für diese Adresse sind bereits fünf Passkeys hinterlegt.',
  passkey_last_for_domain:'Der letzte Passkey für diese Adresse bleibt erhalten. Speichern Sie zuerst einen weiteren Passkey für dieselbe Adresse.',
  legacy_passkey_unavailable:'Die bisherige Anmeldung ist nicht mehr verfügbar. Verwenden Sie Ihren Passkey für die neue Adresse.',
  folder_probe_unavailable:'Für diese Verbindung ist die Schreibprüfung noch nicht verfügbar.',
  folder_probe_limit:'Heute wurden bereits zehn Schreibprüfungen begonnen. Bitte versuchen Sie es nach dem Tageswechsel erneut.',
  folder_probe_consent_required:'Bitte bestätigen Sie zuerst das Anlegen der harmlosen Testdatei.',
  folder_probe_unverified:'Der Testinhalt konnte nicht bestätigt werden. Dieser Ordner wurde nicht freigeschaltet.',
  setup_required:'Die Verbindung zur Schule ist noch nicht freigegeben. Bitte wenden Sie sich an die betreuende Person.',
  login_required:'Bitte melden Sie sich erneut an. Bereits geplante Aufträge bleiben erhalten.',
  login_failed:'Die Anmeldung konnte nicht bestätigt werden. Bitte versuchen Sie es erneut.',
  too_many_requests:'Es gab gerade zu viele Anfragen. Bitte warten Sie eine Minute und versuchen Sie es dann erneut.',
  login_unavailable:'Die IServ-Anmeldung ist gerade nicht erreichbar. Bitte versuchen Sie es später erneut.',
  account_not_allowed:'Dieses IServ-Konto ist für den Zeitplaner noch nicht freigeschaltet. Bitte wenden Sie sich an die betreuende Person.',
  needs_auth:'Bitte erneuern Sie Ihre IServ-Verbindung und prüfen Sie anschließend die betroffenen Aufträge.',
  authorization_too_short:'Die gespeicherte Verbindung reicht nicht bis zu diesem Termin einschließlich Wiederholungsfrist. Bitte erneuern Sie Ihre IServ-Verbindung oder wählen Sie einen früheren Termin.',
  forbidden:'Die Sitzung konnte nicht bestätigt werden. Laden Sie die Seite neu und versuchen Sie es erneut.',
  conditional_replacement_unavailable:'Diese getrennte Größenregel ist mit diesem IServ noch nicht sicher verfügbar. Bitte prüfen Sie die Ersetzungseinstellungen.',
  replacement_consent_required:'Zum Ersetzen fehlt die ausdrückliche Bestätigung für genau diesen Dateinamen und Ordner. Bitte prüfen Sie die Zusammenfassung erneut.',
  replacement_unavailable:'Bewusstes Ersetzen ist für diese Verbindung noch nicht verfügbar.',
  replacement_already_planned:'Für diesen Dateinamen ist bereits ein Auftrag aktiv. Bitte ändern Sie den Namen oder brechen Sie den vorherigen Auftrag ab.',
  original_move_suspended:'Das frühere Originalnamen-Verfahren ist angehalten. Weitere Namens-Tests sind nicht nötig. Planen Sie neu mit eindeutigem Zusatz oder ausdrücklich bestätigtem Ersetzen.',
  original_group_move_rejected:'Der Verschiebeschutz im Gruppenbereich hat die Konkurrenzprüfung nicht bestanden. Dieses Originalnamenverfahren ist gesperrt. Planen Sie neu mit eindeutigem Zusatz oder ausdrücklich bestätigtem Ersetzen.',
  folder_policy_changed:'Das Dateinamenverfahren dieses Ordners hat sich geändert. Bitte wählen Sie den Ordner erneut aus und prüfen Sie die Zusammenfassung.',
  temporary_conflict:'Eine temporäre Datei ist bereits vorhanden. Es wurde nichts überschrieben. Bitte prüfen Sie den Auftrag.',
  temporary_unverified:'Die temporäre Datei konnte nicht vollständig geprüft werden. Es wurde kein weiterer Upload gestartet. Bitte kontrollieren Sie den angezeigten temporären Namen.',
  folder_read_only:'In diesem Ordner können Sie keine Dateien erstellen. Bitte wählen Sie einen anderen Ordner.',
  permission_denied:'IServ verweigert den Zugriff. Bitte prüfen Sie Ihre Ordnerberechtigung.',
  conflict:'Im Zielordner existiert bereits eine Datei mit diesem Namen. Es wurde nichts überschrieben. Bitte wählen Sie einen anderen Dateinamen.',
  file_too_large:'Diese Datei überschreitet die erlaubte Größe. Bitte wählen Sie eine kleinere Datei.',
  file_changed:'Die ausgewählte Datei stimmt nicht mit dem Auftrag überein. Bitte wählen Sie die ursprüngliche Datei.',
  staging_unverified:'Die private Ablage konnte nicht vollständig bestätigt werden. Die Veröffentlichung ist noch nicht verbindlich geplant.',
  job_changed:'Der Auftrag hat sich inzwischen geändert oder wird bereits ausgeführt. Die Übersicht wurde aktualisiert.',
  upload_running:'Die Datei wird bereits übertragen. Bitte warten Sie und aktualisieren Sie anschließend die Übersicht.',
  invalid_time:'Bitte geben Sie ein gültiges Datum und eine gültige Uhrzeit an.',
  time_missing:'Diese Uhrzeit existiert wegen der Umstellung auf Sommerzeit nicht. Bitte wählen Sie eine andere Uhrzeit.',
  time_ambiguous:'Diese Uhrzeit kommt bei der Umstellung auf Winterzeit zweimal vor. Bitte wählen Sie eine eindeutige Uhrzeit, zum Beispiel 03:00.',
  time_out_of_range:'Bitte wählen Sie einen Termin mindestens eine Minute in der Zukunft und höchstens ein Jahr im Voraus.',
  time_elapsed:'Der Termin ist inzwischen erreicht. Diese Veröffentlichung wurde nicht aktiviert. Bitte planen Sie einen neuen Termin.',
  source_missing:'Die geplante Datei ist nicht mehr in der privaten Ablage vorhanden. Bitte wählen Sie die Datei erneut aus und legen Sie einen neuen Auftrag an.',
  credential_policy_required:'Das Speichern von IServ-Zugängen ist für diesen Dienst noch nicht freigegeben. Bitte wenden Sie sich an die betreuende Person.',
  credential_retention_required:'Für den Zugang fehlt eine gültige Aufbewahrungsfrist. Bitte lassen Sie die Verbindung prüfen.',
  storage_budget_exceeded:'Das sichere Tageskontingent des Dateispeichers ist erreicht. Es wurde keine zusätzliche Speicherung bestätigt. Bitte wenden Sie sich an die betreuende Person.',
  daily_job_limit:'Heute wurden bereits 20 neue Veröffentlichungen angelegt. Bereits geplante Termine werden weiterhin ausgeführt. Neue Aufträge sind nach dem Tageswechsel um 01:00 Uhr im Winter beziehungsweise 02:00 Uhr im Sommer wieder möglich.',
  job_limit:'Es warten bereits zu viele Veröffentlichungen. Bitte schließen Sie zunächst einen Auftrag ab oder brechen Sie ihn ab.',
  account_changed:'Das verbundene IServ-Konto wurde gewechselt. Für diesen Auftrag benötigen Sie die ursprüngliche Verbindung. Es wurde kein weiterer Upload gestartet.',
  target_policy_changed:'Dieser Auftrag verwendet noch die bisherige Dateibenennung. Bitte legen Sie ihn mit dem neuen Verfahren erneut an. Es wurde kein Upload gestartet.',
  source_changed:'Die privat gespeicherte Datei wurde verändert. Es wurde kein weiterer Veröffentlichungsversuch gestartet.',
  result_uncertain:'IServ hat kein eindeutiges Ergebnis bestätigt. Bitte prüfen Sie den Zielordner. Zum Schutz vor doppelten Veröffentlichungen wird die Datei nicht automatisch erneut hochgeladen.',
  target_unverified:'Die Datei am Ziel konnte nicht vollständig geprüft werden. Bitte kontrollieren Sie den Zielordner.',
  condition_failed:'Die Quelldatei oder das Ziel hat sich während der Veröffentlichung verändert. Es wurde nichts überschrieben. Bitte prüfen Sie beide Ordner.',
  quota:'Der IServ-Speicher ist voll. Bitte schaffen Sie Speicherplatz oder wenden Sie sich an die Schul-IT.',
  retry_expired:'Die Veröffentlichung konnte innerhalb von 24 Stunden nicht ausgeführt werden. Bitte prüfen Sie IServ und planen Sie bei Bedarf einen neuen Auftrag.',
  cleanup_pending:'Eine private Arbeitskopie konnte noch nicht entfernt werden. Der Status der Veröffentlichung bleibt bestehen; die Bereinigung wird erneut versucht.',
  preparation_expired:'Die Dateiübertragung wurde nicht abgeschlossen. Dieser Auftrag wurde nicht aktiviert.',
  connection_failed:'IServ ist gerade nicht erreichbar. Der Status in der Übersicht zeigt, ob ein weiterer Versuch geplant ist.',
  interrupted:'Ein unterbrochener Vorgang wird geprüft.',invalid_dav:'Die Ordnerinformationen konnten nicht sicher gelesen werden. Bitte wenden Sie sich an die betreuende Person.',
  folder_too_large:'Dieser Ordner enthält zu viele Einträge. Bitte wenden Sie sich an die betreuende Person.',
  unexpected_error:'Der Vorgang konnte nicht bestätigt werden. Bitte aktualisieren Sie die Übersicht, bevor Sie erneut planen.',
  network:'Die Verbindung wurde unterbrochen. Möglicherweise wurde der Auftrag bereits gespeichert. Bitte aktualisieren Sie die Übersicht.',
  numbering_unavailable:'Automatische Nummerierung ist für diese Verbindung noch nicht verfügbar. Bitte die App neu laden.',
  numbering_consent_required:'Die Namensregel muss für diese Datei und diesen Ordner neu bestätigt werden.',
  numbering_folder_busy:'Ein anderer Auftrag klärt gerade die Veröffentlichung in diesem Ordner. Der gespeicherte Auftrag wartet.',
  numbering_contended:'Der Zielordner wurde gleichzeitig geändert. Die Namenssuche wird erneut versucht.',
  numbering_attempt_limit:'Der Zielname konnte nach wiederholten Änderungen nicht sicher festgelegt werden. Bitte das Ergebnis prüfen.',
  numbering_scan_limit:'Die Namenssuche konnte nicht vollständig abgeschlossen werden. Der Auftrag wartet auf erneute Prüfung.',
  naming_quote_invalid:'Die Namensvorschau passt nicht mehr zur Auswahl. Bitte erneut prüfen.',
  naming_quote_expired:'Die Namensvorschau ist abgelaufen. Bitte erneuern und den vollständigen Namen nochmals prüfen.',
  planning_reload_required:'Bitte laden Sie die App neu, um die aktuelle Namensvorschau zu verwenden.',
  filename_too_long:'Bitte wählen Sie einen kürzeren Dateinamen. Der vollständige Name mit Kennung muss auf IServ passen.',
  invalid_filename:'Dieser Dateiname kann nicht verwendet werden. Bitte benennen Sie die Datei um.',
  unsafe_source:'Die Quelldatei kann nicht sicher veröffentlicht werden. Bitte wenden Sie sich an die betreuende Person.',
};
const statuses:Record<string,string>={preparing:'Übertragung nicht abgeschlossen',scheduled:'Verbindlich geplant',publishing:'Wird veröffentlicht',retry_wait:'Erneuter Versuch geplant',reconciling:'Ergebnis wird geprüft',published:'Veröffentlicht · Ziel geprüft',cancelled:'Abgebrochen',conflict:'Dateiname bereits vorhanden',needs_auth:'Anmeldung erneuern',needs_review:'Bitte Ergebnis prüfen',failed:'Fehlgeschlagen'};
let namePreviewVersion=0,namePreviewTimer:ReturnType<typeof setTimeout>|undefined;
let folderOriginal=false,browsingOriginal=false;
let session!:Session;let jobs:Job[]=[];let file:File|null=null;let folder='';let browsing='';let browsingWritable=false;let view='planned';let selected:Job|null=null;let busy=false;let pendingKey:string|null=null;let resumeId:string|null=null;let pending:{key:string;sha256:string;filename:string;folder:string;size:number;localTime:string;expectedNaming?:string;replacementConsent?:{target:string;policy:string};numberingConsent?:{folder:string;filename:string;policy:string};planningVersion?:number;namingQuote?:string}|null=null;
const dateFormat=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',weekday:'short',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
function localTime(n:number){const p=Object.fromEntries(new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(n).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
const prettyFolder=(p:string)=>{const parts=p.replace(session.groupRoot,'').replace(/\/$/,'').split('/').filter(Boolean);if(session.stage==='group-pilot'||session.selfHosted){if(parts[0]==='Files')parts[0]='Eigene Dateien';if(parts[0]==='Groups')parts[0]='Gruppen';}return parts.join(' / ')||(session.rootLabel||'Gruppen');};
const formatSize=(n:number)=>n<1024*1024?`${Math.ceil(n/1024)} KB`:`${(n/1024/1024).toLocaleString('de-DE',{maximumFractionDigits:1})} MB`;
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text='')=>{const e=document.createElement(tag);e.className=className;e.textContent=text;return e;};
// Help remains available on hover, keyboard focus and explicit touch/click.
let activeHelp:HTMLButtonElement|null=null;
function closeHelp(){if(!activeHelp)return;$(activeHelp.getAttribute('aria-controls')!).hidden=true;activeHelp.setAttribute('aria-expanded','false');activeHelp.dataset.pinned='false';activeHelp=null;}
function showHelp(button:HTMLButtonElement){if(activeHelp!==button)closeHelp();activeHelp=button;const tip=$(button.getAttribute('aria-controls')!);tip.hidden=false;tip.classList.remove('above');button.setAttribute('aria-expanded','true');const panel=button.closest('dialog');const bottom=Math.min(window.innerHeight-12,panel?panel.getBoundingClientRect().bottom-12:Infinity);if(tip.getBoundingClientRect().bottom>bottom)tip.classList.add('above');}
for(const button of document.querySelectorAll<HTMLButtonElement>('.info-button')){
 const wrap=button.closest('.info-help')!;
 button.setAttribute('aria-describedby',button.getAttribute('aria-controls')!);
 // Layout changes alone must not reopen help dismissed with Escape.
 wrap.addEventListener('pointermove',event=>{const pointer=event as PointerEvent;if(pointer.pointerType==='mouse'&&(pointer.movementX||pointer.movementY))showHelp(button);});
 wrap.addEventListener('mouseleave',()=>{if(button.dataset.pinned!=='true'&&document.activeElement!==button)closeHelp();});
 button.addEventListener('focus',()=>showHelp(button));
 button.onclick=()=>{if(button.dataset.pinned==='true')closeHelp();else{showHelp(button);button.dataset.pinned='true';}};
}
document.addEventListener('pointerdown',event=>{if(activeHelp&&!(event.target as Element).closest('.info-help'))closeHelp();});
document.addEventListener('focusin',event=>{if(activeHelp&&!(event.target as Element).closest('.info-help'))closeHelp();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeHelp){event.preventDefault();event.stopPropagation();activeHelp.focus({preventScroll:true});closeHelp();}},true);
for(const panel of document.querySelectorAll('dialog'))panel.addEventListener('close',closeHelp);
function message(text:string,error=false){const node=$('notice');node.textContent=text;node.className='notice'+(error?' error':'');node.hidden=false;if(error)node.scrollIntoView({block:'nearest',behavior:'smooth'});}
function errorText(e:unknown){return errors[e instanceof Error?e.message:'unexpected_error']||errors.unexpected_error;}
async function apiResponse(path:string,options:RequestInit={}):Promise<Response>{
  const headers=new Headers(options.headers);if(session?.user&&options.method&&options.method!=='GET')headers.set('X-CSRF-Token',session.user.csrf);
  let r:Response;try{r=await fetch(path,{...options,headers,credentials:'same-origin',cache:'no-store'});}catch{throw new Error('network');}
  if(!r.ok){let code='unexpected_error';let diagnostic:unknown;try{const data=await r.json();code=data.error;diagnostic=data.diagnostic;}catch{}throw new ApiError(code,diagnostic);}
  return r;
}
async function api(path:string,options:RequestInit={}):Promise<any>{const epoch=sessionEpoch,r=await apiResponse(path,options),data=r.status===204?null:await r.json();if(epoch!==sessionEpoch)throw new ApiError('login_required');return data;}
async function hash(f:File){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');}
function setFile(f:File|null){if(!f||submitted)return;if(f.size===0||f.size>session.maxFileBytes){submitted=false;file=null;pending=null;pendingKey=null;$('target-name-box').hidden=true;$('file-label').textContent='Datei auswählen';$('file-detail').textContent='oder hierher ziehen';$<HTMLInputElement>('file').value='';message(f.size===0?'Die Datei ist leer. Bitte wählen Sie eine Datei mit Inhalt.':'Die Datei ist '+formatSize(f.size)+' groß. Erlaubt sind bis '+formatSize(session.maxFileBytes)+'. Bitte verkleinern Sie sie oder wählen Sie eine andere Datei.',true);return;}$('notice').hidden=true;file=f;resetReplacement();$<HTMLInputElement>('target-name').value=f.name;$('target-name-box').hidden=false;showReviewPolicy();void previewTargetName();$('file-label').textContent=f.name;$('file-detail').textContent=formatSize(f.size)+'';}
function showLogin(){ document.body.classList.add('is-login');document.body.classList.remove('is-workspace');$('login-title').textContent=bootstrapInvite?'Ihr Zugang zum Zeitplaner.':'Willkommen zurück.';$('login-intro').textContent=bootstrapInvite?'Ihr persönlicher Zugang für geplante Veröffentlichungen.':'Planen Sie, wann Ihre Dateien auf IServ erscheinen.'; $('login-view').hidden=false;$('app-view').hidden=true;$('logout').hidden=true;$('settings-open').hidden=true;$('demo-banner').hidden=session.mode!=='demo';
  $('login').textContent=session.mode==='demo'?'Testumgebung öffnen':session.authMode==='passkey'?'Mit Gerät anmelden':session.authMode==='access'?'Am Zeitplaner anmelden':'Mit IServ anmelden';($('login')as HTMLButtonElement).disabled=!(session.authReady??session.ready);
  $('login-existing').hidden=!session.legacyPasskeyAvailable||Boolean(bootstrapInvite);
  $('login').hidden=session.authMode==='passkey'&&Boolean(bootstrapInvite);$('passkey-enroll').hidden=session.authMode!=='passkey'||!bootstrapInvite;$('passkey-backup').hidden=true;$('account-open').hidden=true;$('recovery-login').hidden=session.authMode!=='passkey';
  $('setup-message').textContent=session.mode==='demo'?'Sie testen mit einem Beispielkonto und simulierten Gruppenordnern.':session.authMode==='passkey'&&bootstrapInvite?'Wählen Sie einen Anzeigenamen und richten Sie Ihren Passkey ein.':session.authMode==='passkey'?(session.authReady?'':errors.setup_required):session.ready?(session.authMode==='access'?'Die Anmeldung am Zeitplaner und Ihre IServ-Verbindung werden getrennt geschützt.':'Sie verwenden Ihr bestehendes IServ-Konto.'):errors.setup_required;
}
let sessionEpoch=0;
function clearPrivateView(){
 sessionEpoch++;accountUI.reset();closeHelp();
 for(const panel of document.querySelectorAll<HTMLDialogElement>('dialog[open]'))panel.close();
 file=null;folder='';browsing='';selected=null;pending=null;pendingKey=null;resumeId=null;jobs=[];jobsLoaded=false;submitted=false;folderOriginal=false;browsingWritable=false;browsingOriginal=false;
 quoteVersion++;namePreviewVersion++;if(quoteTimer)clearTimeout(quoteTimer);if(namePreviewTimer)clearTimeout(namePreviewTimer);
 quoteExpires=0;jobsVisible=10;view='planned';
 for(const input of document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input:not([type=radio]):not([type=checkbox]),textarea')){if(!['date','time'].includes(input.id))input.value='';}
 for(const input of document.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))input.checked=false;
 for(const id of ['jobs','confirmation','folder-list','breadcrumbs','account-keys','account-sessions','account-members','account-invitations'])$(id).replaceChildren();
 for(const id of ['account-name','connection-status','connection-message','published-name','target-check-status','edit-name','cancel-name','push-diagnostics','folder-permission','folder-proof-result','upload-status','notice'])$(id).textContent='';
 $('notice').hidden=true;$('target-name-box').hidden=true;$('file-label').textContent='Datei auswählen';$('file-detail').textContent='oder hierher ziehen';$('chosen-folder').textContent='IServ-Ordner auswählen';$('job-count').textContent='0';$('jobs-summary').textContent='';
 $<HTMLInputElement>('naming-unique').checked=true;
}
async function refreshSession(signal?:AbortSignal){const previous=session?.user;session=await api('/api/session',{signal});$('startup-view').hidden=true;$('personal-setup').hidden=!session.selfHosted;if(previous&&(!session.user||(previous.id||previous.name)!==(session.user.id||session.user.name)))clearPrivateView();if(!session.user){dialog('settings-dialog').close();showLogin();return;}document.body.classList.remove('is-login');document.body.classList.toggle('is-workspace',session.mode!=='demo');$('login-view').hidden=true;$('app-view').hidden=false;$('logout').hidden=false;$('settings-open').hidden=false;$('demo-banner').hidden=session.mode!=='demo';$('local-probe-panel').hidden=session.mode!=='demo';$('ui-probe-panel').hidden=session.mode!=='demo';$('target-probe-panel').hidden=session.mode!=='demo';$('integration-block').hidden=!session.integrationBlock;$('integration-block').textContent=session.integrationBlock||'';$('passkey-enroll').hidden=true;$('passkey-backup').hidden=session.authMode!=='passkey';$('account-open').hidden=!session.accountManagementAvailable;$('account-name').textContent=session.user.name;$('school-label').textContent=session.school;if(session.stage==='personal-pilot'){if(!folder)$('chosen-folder').textContent='Privaten IServ-Ordner auswählen';$('folder-intro').textContent='Öffnen Sie einen eigenen privaten Testordner und wählen Sie ihn als Ziel aus.';$('demo-banner').hidden=false;$('demo-banner').textContent='Persönlicher Cloudtest · Bitte ausschließlich selbst erstellte Testdateien verwenden. Ziel ist Ihr eigener privater IServ-Bereich.';}
  if(session.stage==='group-pilot'){if(!folder)$('chosen-folder').textContent='IServ-Ordner auswählen';$('folder-intro').textContent='Zielordner öffnen und auswählen.';$('demo-banner').hidden=false;$('demo-banner').textContent='Persönlicher Gruppenpilot · Testversion';}
  if(bootstrapInvite&&!inviteNoticeShown){inviteNoticeShown=true;message('Ein Einladungslink wurde geöffnet. Melden Sie sich zuerst ab, um damit ein eigenes neues Konto einzurichten. Für eine andere Person können Sie den Link in einem privaten Browserfenster öffnen.');}
  showReviewPolicy();
  void refreshPush().catch(()=>{ $('push-status').textContent='Der Benachrichtigungsstatus konnte gerade nicht geladen werden.'; });
  $('file-limit').textContent='Bis '+formatSize(session.maxFileBytes);$<HTMLButtonElement>('review').disabled=!session.ready;$<HTMLButtonElement>('choose-folder').disabled=!session.ready;schedulerWarning();await refreshConnection();}
async function refreshConnection(){
  const visible=session.mode!=='demo'&&['access','passkey'].includes(session.authMode||'');$('connection-panel').hidden=!visible;if(!visible)return;
  const c=await api('/api/connection');if(c.username&&document.activeElement!==$('connection-user'))$<HTMLInputElement>('connection-user').value=c.username;
  $('connection-summary').hidden=false;$('connection-summary').textContent=c.connected?(c.expiresAt&&c.expiresAt<Date.now()+3*86400000?'IServ-Zugang bald abgelaufen · erneuern':'✓ IServ verbunden'):'IServ verbinden';$('connection-summary').dataset.connected=String(c.connected);
  $('connection-summary').classList.toggle('connection-attention',!c.connected||Boolean(c.expiresAt&&c.expiresAt<Date.now()+3*86400000));
  $('connection-status').textContent=c.connected?'Verbunden'+(c.expiresAt?' · Zugang gültig bis '+dateFormat.format(c.expiresAt)+' Uhr.':''):'IServ ist noch nicht verbunden. Bereits geplante Aufträge bleiben in Ihrer Übersicht.';
  $('connection-open').textContent=c.connected?'Verbindung erneuern':'IServ verbinden';$<HTMLButtonElement>('connection-open').disabled=!c.storageAllowed;
  $('connection-disconnect').hidden=!c.connected;
  if(!c.storageAllowed)$('connection-status').textContent+=' Das Speichern von Zugängen ist noch nicht freigegeben.';
  if(!c.connected){$<HTMLButtonElement>('review').disabled=true;$<HTMLButtonElement>('choose-folder').disabled=true;}
}
const desiredName=()=>$<HTMLInputElement>('target-name').value.trim().normalize('NFC');
let quoteVersion=0,quoteExpires=0,quoteTimer:ReturnType<typeof setTimeout>|undefined,submitted=false;
const normalNaming=()=>session?.numberedNamingEnabled?'numbered-v1':'unique-v1';
const exactNaming=()=>$<HTMLInputElement>('naming-exact').checked;
function invalidateQuote(){quoteVersion++;if(quoteTimer)clearTimeout(quoteTimer);if(pending)delete pending.namingQuote;quoteExpires=0;$('published-name').textContent='Vorschau wird vorbereitet …';showReviewPolicy();}
function resetReplacement(){if(submitted)return;pending=null;pendingKey=null;$<HTMLInputElement>('naming-unique').checked=true;invalidateQuote();}
function updateReviewDraft(){
 if(!pending||submitted)return;
 invalidateQuote();pendingKey=crypto.randomUUID();pending={...pending,key:pendingKey,filename:desiredName(),planningVersion:session.numberedNamingEnabled?3:2,expectedNaming:exactNaming()?'replace-v1':normalNaming()};
 delete pending.replacementConsent;delete pending.numberingConsent;
 if(!exactNaming()&&session.numberedNamingEnabled)pending.numberingConsent={folder:pending.folder,filename:pending.filename,policy:'number-if-occupied-allow-concurrent-change-risk'};
 if(exactNaming())pending.replacementConsent={target:pending.folder+desiredName(),policy:'replace-exact-target-even-if-changed'};
 showReviewPolicy();
}
function showReviewPolicy(){
 const numbered=Boolean(session?.numberedNamingEnabled);
 $('normal-naming-title').textContent=numbered?'Wunschnamen verwenden':'Vorhandene Dateien behalten';
 $('normal-naming-description').textContent=numbered?'Falls der Name beim Veröffentlichen belegt ist, wird automatisch (2), (3) … ergänzt.':'Mit eindeutiger Kennung veröffentlichen.';
 $('numbering-risk').hidden=!numbered;
 $('replacement-retry').hidden=!exactNaming();
 $<HTMLInputElement>('naming-exact').disabled=busy||submitted||!session?.confirmedReplaceEnabled;
 $('review-naming').textContent=pending&&exactNaming()?'Ersetzen ist für diesen Auftrag erlaubt.':'';
 $<HTMLButtonElement>('confirm-plan').disabled=busy||!pending||!pending.namingQuote||!desiredName()||(!submitted&&quoteExpires<=Date.now());
 $('quote-refresh').hidden=busy||submitted||!pending||Boolean(pending.namingQuote&&quoteExpires>Date.now());
}
async function prepareQuote(){
 if(!pending||submitted)return;
 invalidateQuote();const version=quoteVersion,draft=pending;
 try{
  const result=await api('/api/naming-quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});
  if(version!==quoteVersion||pending!==draft||!dialog('confirm-dialog').open)return;
  if(result.targetNaming!==draft.expectedNaming||typeof result.publishedFilename!=='string'||typeof result.namingQuote!=='string'||result.expiresAt<=Date.now())throw new Error('naming_quote_invalid');
  pending.namingQuote=result.namingQuote;quoteExpires=result.expiresAt;$('published-name').textContent=result.publishedFilename+(draft.expectedNaming==='numbered-v1'?' – bei Bedarf mit Nummer. Endgültiger Name beim Veröffentlichen.':'');
  quoteTimer=setTimeout(()=>{if(!submitted&&version===quoteVersion){delete pending?.namingQuote;$('published-name').textContent='Vorschau abgelaufen. Bitte erneuern und den Namen nochmals prüfen.';showReviewPolicy();}},Math.max(0,quoteExpires-Date.now()));
 }catch(error){if(version===quoteVersion)$('published-name').textContent=errorText(error);}
 if(version===quoteVersion)showReviewPolicy();
}
async function previewTargetName(){
 const version=++namePreviewVersion,out=$('target-check-status');
 if(!file||!folder||!session.targetCheckAvailable||!dialog('confirm-dialog').open){out.textContent='';return;}
 out.textContent='Name wird geprüft …';
 try{const result=await api('/api/target-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder,filename:desiredName(),size:file.size,planningVersion:2})});if(version!==namePreviewVersion)return;
  out.textContent=result.exists?'Eine Datei dieses Namens ist vorhanden':'Momentan frei';
 }catch{if(version===namePreviewVersion)out.textContent='Name gerade nicht prüfbar';}
}
$('target-name').oninput=()=>{if(submitted)return;$<HTMLInputElement>('naming-unique').checked=true;updateReviewDraft();namePreviewVersion++;if(namePreviewTimer)clearTimeout(namePreviewTimer);namePreviewTimer=setTimeout(()=>{void previewTargetName();void prepareQuote();},400);};
for(const id of ['naming-unique','naming-exact'])$(id).onchange=()=>{updateReviewDraft();void prepareQuote();};
$('quote-refresh').onclick=()=>void prepareQuote();
for(const id of ['date','time'])$(id).onchange=()=>{resetReplacement();};
function schedulerWarning(){const n=$('scheduler-warning');if(!session.ready){n.hidden=false;n.textContent='Neue Veröffentlichungen sind derzeit gesperrt. Sie können Ihre bestehenden Aufträge weiterhin einsehen und, soweit noch möglich, abbrechen.';return;}const stale=!session.lastSchedulerRun||Date.now()-session.lastSchedulerRun>180000;n.hidden=!stale;n.textContent=session.mode==='demo'?'Der lokale Testzeitplaner wurde noch nicht kürzlich bestätigt. Starten Sie die Anwendung mit dem Entwicklungsstart; dieser führt die Testaufträge auch bei geschlossenem Browser aus.':'Der Zeitplaner hat sich seit mehr als drei Minuten nicht gemeldet. Bitte verlassen Sie sich für unmittelbar bevorstehende Termine noch nicht auf die automatische Veröffentlichung.';}
let jobsLoaded=false;
async function refreshJobs(){if(!session.user)return;const epoch=sessionEpoch,result=await api('/api/jobs');if(epoch!==sessionEpoch||!session.user)return;if(!jobsLoaded||JSON.stringify(jobs)!==JSON.stringify(result.jobs)){jobsLoaded=true;jobs=result.jobs;renderJobs();}}
let jobsVisible=10;
const plannedJob=(j:Job)=>['scheduled','retry_wait','preparing','publishing','reconciling'].includes(j.status);
const compactDate=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
function renderJobs(){
 const attention=$('attention'),needsHelp=jobs.filter(j=>['failed','conflict','needs_auth','needs_review','reconciling'].includes(j.status));
 attention.hidden=!needsHelp.length;attention.replaceChildren();if(needsHelp.length){attention.append(el('strong','',`${needsHelp.length} Veröffentlichung${needsHelp.length===1?' benötigt':'en benötigen'} Ihre Aufmerksamkeit. `));const show=el('button','text-button','Aufträge anzeigen');show.onclick=()=>{view=needsHelp.some(plannedJob)?'planned':'past';$<HTMLInputElement>('job-search').value='';setTabs();$('jobs-title').scrollIntoView({block:'start'});};attention.append(show);}
 const list=$('jobs'),open=new Set([...list.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d=>d.dataset.job));
 const focused=document.activeElement as HTMLElement|null,focusJob=focused?.closest<HTMLElement>('[data-job]')?.dataset.job,focusText=focused?.textContent;list.replaceChildren();const query=$<HTMLInputElement>('job-search').value.trim().toLocaleLowerCase('de-DE');
 const selectedJobs=jobs.filter(j=>view==='planned'?plannedJob(j):!plannedJob(j));
 const filtered=selectedJobs.filter(j=>!query||[j.filename,j.publishedFilename||'',prettyFolder(j.folder)].some(t=>t.toLocaleLowerCase('de-DE').includes(query))).sort((a,b)=>view==='planned'?a.dueAt-b.dueAt:(b.confirmedAt||b.dueAt)-(a.confirmedAt||a.dueAt));
 $('job-count').textContent=String(selectedJobs.length);$('jobs-summary').textContent=query?`${filtered.length} Treffer`:selectedJobs.length?`${selectedJobs.length} ${view==='planned'?'geplant':'im Verlauf'}`:'';
 $('jobs-more').hidden=filtered.length<=jobsVisible;
 if(!filtered.length){const empty=el('div','empty-state');empty.append(el('strong','',query?'Keine passende Veröffentlichung.':view==='planned'?'Keine geplanten Veröffentlichungen.':'Keine vergangenen Veröffentlichungen.'));list.append(empty);return;}
 for(const job of filtered.slice(0,jobsVisible)){
  const card=el('article','job-card publication-row');card.dataset.job=job.id;
  const actual=job.status==='published'&&job.publishedFilename?job.publishedFilename:job.filename;
  const info=el('div','publication-info');info.append(el('h3','job-title',actual),el('p','job-meta',prettyFolder(job.folder)),el('p','job-meta',compactDate.format(job.dueAt)+' Uhr'));
  const side=el('div','job-side');side.append(el('span','status'+(['failed','needs_review','needs_auth','conflict'].includes(job.status)?' error':['publishing','reconciling'].includes(job.status)?' active':''),statuses[job.status]||job.status));
  const actions=el('div','job-actions');if(job.editable){const edit=el('button','',['scheduled','retry_wait'].includes(job.status)?'Termin ändern':'Neu terminieren');edit.onclick=()=>openEdit(job);actions.append(edit);}
  if(job.cancellable??job.editable){const cancel=el('button','','Abbrechen');cancel.onclick=()=>{selected=job;$('cancel-name').textContent=actual;dialog('cancel-dialog').showModal();};actions.append(cancel);}
  if(job.checkable){const check=el('button','','Ergebnis erneut prüfen');check.onclick=async()=>{check.disabled=true;try{await api('/api/jobs/'+job.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reconcile',revision:job.revision})});message('Das Ergebnis wird ausschließlich durch erneutes Lesen geprüft. Es wird kein weiterer Upload gestartet.');await refreshJobs();}catch(e){message(errorText(e),true);}finally{check.disabled=false;}};actions.append(check);}
  if(job.status==='preparing'){const resume=el('button','','Dateiübertragung fortsetzen');resume.onclick=()=>{resumeId=job.id;$<HTMLInputElement>('resume-file').click();};actions.append(resume);}
  if(actions.childElementCount)side.append(actions);card.append(info,side);
  if(job.errorCode&&job.errorCode!=='reconciled')card.append(el('p','publication-error',errors[job.errorCode]||errors.unexpected_error));
  const details=el('details','publication-details');details.dataset.job=job.id;details.open=open.has(job.id);details.append(el('summary','','Details'));
  const meta=el('dl','publication-facts');
  const fact=(label:string,value:string)=>meta.append(el('dt','',label),el('dd','',value));
  if(job.filename!==actual)fact('Gewünschter Name',job.filename);
  fact('Dateigröße',formatSize(job.size));fact('Zielordner',prettyFolder(job.folder));
  if(job.publishedFilename)fact(job.status==='published'?'Dateiname auf IServ':'Ausgewähltes Ziel',job.publishedFilename);
  else if(job.targetNaming==='numbered-v1')fact('Dateiname','Wunschname, bei Bedarf mit Nummer. Endgültiger Name beim Veröffentlichen.');
  fact('Namensregel',job.targetNaming==='replace-v1'?'Exakter Name; Ersetzen für diesen Auftrag ausdrücklich erlaubt.':job.targetNaming==='numbered-v1'?'Wunschname, bei Belegung nächste freie Nummer.':'Gespeicherter fester Zielname.');
  if(job.confirmedAt)fact('Am Ziel geprüft',dateFormat.format(job.confirmedAt)+' Uhr');
  if(job.temporaryFilename&&['failed','conflict','needs_auth','needs_review','reconciling'].includes(job.status))fact('Mögliche temporäre Datei',job.temporaryFilename+'. Zur eigenen Kontrolle; keine automatische Löschung.');
  details.append(meta);card.append(details);list.append(card);
 }
 if(focusJob&&focused!==document.activeElement){const card=[...list.querySelectorAll<HTMLElement>('.publication-row')].find(c=>c.dataset.job===focusJob);const replacement=card&&[...card.querySelectorAll<HTMLElement>('button,summary')].find(c=>c.textContent===focusText);replacement?.focus({preventScroll:true});}
}
$('job-search').oninput=()=>{jobsVisible=10;renderJobs();};
$('jobs-more').onclick=()=>{jobsVisible+=10;renderJobs();};
async function browse(p:string){
  const result=await api('/api/folders?path='+encodeURIComponent(p));browsing=p;browsingWritable=result.currentWritable;browsingOriginal=Boolean(result.originalNameReady);
  const crumbs=$('breadcrumbs');crumbs.replaceChildren();const root=el('button','',session.rootLabel||'Gruppen');root.onclick=()=>browseSafe(session.groupRoot);crumbs.append(root);
  let current=session.groupRoot;for(const part of p.slice(session.groupRoot.length).split('/').filter(Boolean)){current+=part+'/';const target=current;const label=(session.stage==='group-pilot'||session.selfHosted)&&current==='/Files/'?'Eigene Dateien':(session.stage==='group-pilot'||session.selfHosted)&&current==='/Groups/'?'Gruppen':part;const button=el('button','','› '+label);button.onclick=()=>browseSafe(target);crumbs.append(button);}
  const list=$('folder-list');list.replaceChildren();for(const f of result.folders as Folder[]){const b=el('button','folder-row');b.append(el('span','folder-symbol','▱'),el('span','',f.name),el('small','',f.permission==='unknown'?'Rechte unbekannt':f.writable?'':'Nur lesen'),el('span','','›'));b.onclick=()=>browseSafe(f.path);list.append(b);}
  if(!result.folders.length)list.append(el('p','muted','Keine weiteren Unterordner.'));
  $<HTMLButtonElement>('folder-select').disabled=!browsingWritable;$<HTMLButtonElement>('folder-back').disabled=p===session.groupRoot;
  $('name-probe-open').hidden=session.mode==='demo'||Boolean(session.originalGroupsBlocked&&(!session.originalMoveEnabled||p.startsWith('/Groups/')))||!(p.startsWith('/Files/')||session.originalMoveEnabled&&p.startsWith('/Groups/')&&p!=='/Groups/')||!browsingWritable;$('name-probe-result').textContent='';
  $('folder-name-policy').textContent=session.numberedNamingEnabled?'Der Wunschname wird bei Bedarf kurz nummeriert. Andere gleichzeitig schreibende IServ-Programme sind nicht gesperrt. Die früheren Schutztests bleiben gesperrt.':session.copyProbeBlocked?'Die Schreib-, Verschiebe- und Kopierprüfungen haben den nötigen Schutz bei gleichzeitigen Zugriffen nicht bestätigt. Weitere Namensprüfungen sind nicht nötig. Kurze nummerierte Zusätze bleiben deaktiviert.':session.originalGroupsBlocked&&!session.originalMoveEnabled?'Der bisherige Verschiebeweg bleibt gesperrt. Die separate Kopierprüfung untersucht eine andere Möglichkeit für nummerierte Namen.':session.originalGroupsBlocked&&p.startsWith('/Groups/')?'Originalnamen über Verschieben sind hier wegen einer fehlgeschlagenen Konkurrenzprüfung gesperrt. Es ist kein weiterer Namens-Test nötig. Neue Aufträge verwenden den eindeutigen Namenszusatz.':session.originalMoveEnabled&&browsingWritable?(browsingOriginal?'Neue Veröffentlichungen behalten hier den Originalnamen. Vorhandene Namen führen zu einem Konflikt.':'Originalnamen sind hier noch nicht geprüft. Bis zur bestandenen Namensprüfung bleibt der Zusatz bestehen.'):'';
  $('copy-probe-open').hidden=Boolean(session.copyProbeBlocked)||session.mode==='demo'||!/^\/(Files|Groups)\/.+\/$/.test(p);$('copy-probe-result').textContent='';
  $('folder-proof-open').hidden=!result.canProbe;$('folder-proof-result').textContent='';
  $('folder-permission').textContent=result.proofAt?'Erstellen und Rücklesen wurde mit Ihrem Konto am '+dateFormat.format(result.proofAt)+' Uhr geprüft. IServ prüft Ihren Zugriff bei jeder Veröffentlichung erneut.':result.canProbe?'IServ nennt keine eindeutigen Schreibrechte. Sie können das Erstellen einer harmlosen Testdatei ausdrücklich prüfen lassen.':browsingWritable?'Sie können diesen Ordner als Ziel auswählen.':'Dieser Ordner kann geöffnet, aber nicht als Schreibziel ausgewählt werden.';
}
async function browseSafe(p:string){try{await browse(p);}catch(e){$('folder-permission').textContent=errorText(e);$<HTMLButtonElement>('folder-select').disabled=true;}}
function openEdit(job:Job){selected=job;$('edit-name').textContent=(job.publishedFilename||job.filename)+(job.targetNaming==='replace-v1'?' · Exakter Name; Ersetzen für diesen Auftrag erlaubt.':job.targetNaming==='numbered-v1'?' · Wunschname, bei Bedarf mit Nummer; Namensregel bleibt erhalten.':' · Gespeicherter Zielname bleibt erhalten.');$<HTMLInputElement>('edit-time').value=job.dueAt>Date.now()+60000?job.localTime:localTime(Date.now()+86400000);dialog('edit-dialog').showModal();}
function busyDialog(value:boolean){busy=value;for(const id of ['confirm-back','confirm-close','target-name','naming-unique','naming-exact','quote-refresh'])$<HTMLButtonElement>(id).disabled=value||submitted;showReviewPolicy();}
async function confirmPlan(){
  if(!pending||!file||busy||!pending.namingQuote||!desiredName())return;if(!submitted&&quoteExpires<=Date.now()){invalidateQuote();$('published-name').textContent=errors.naming_quote_expired;return;}submitted=true;busyDialog(true);const status=$('upload-status');status.hidden=false;status.className='notice';status.textContent='Auftrag wird vorbereitet …';
  let jobAcquired=false;
  try{
    const job=await api('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending)});
    jobAcquired=true;status.textContent='Datei wird privat gespeichert und geprüft. Bitte lassen Sie die App noch geöffnet.';
    const done=await api(`/api/jobs/${job.id}/file`,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file});
    if(done.status!=='scheduled')throw new Error('unexpected_error');
    dialog('confirm-dialog').close();message('Verbindlich geplant. Sie können die App schließen.');
    submitted=false;file=null;pending=null;pendingKey=null;$('target-name-box').hidden=true;$<HTMLInputElement>('target-name').value='';$<HTMLInputElement>('file').value='';$('file-label').textContent='Datei auswählen';$('file-detail').textContent='oder hierher ziehen';view='planned';setTabs();
  }catch(e){if(!jobAcquired&&e instanceof ApiError&&['numbering_unavailable','numbering_consent_required','naming_quote_expired','naming_quote_invalid','time_out_of_range','authorization_too_short','folder_read_only','replacement_unavailable','replacement_consent_required','replacement_already_planned','planning_reload_required','filename_too_long','invalid_filename','invalid_request','file_too_large','account_changed','needs_auth','job_limit','daily_job_limit','conflict'].includes(e.message)){submitted=false;invalidateQuote();status.textContent=errorText(e);status.className='notice error';return;}status.textContent=errorText(e)+' Bitte denselben Auftrag erneut bestätigen, um das Anlageergebnis zu klären und die Übertragung fortzusetzen.';status.className='notice error';}
  finally{busyDialog(false);await refreshJobs().catch(()=>{});}
}
function setTabs(){jobsVisible=10;document.querySelector('.jobs-scroll')?.scrollTo({top:0});$('history-retention').hidden=view!=='past'||!session.historyRetentionDays;for(const v of ['planned','past']){const b=$('tab-'+v);b.classList.toggle('selected',view===v);b.setAttribute('aria-pressed',String(view===v));}renderJobs();if(view==='past')void api('/api/notifications/read',{method:'POST'}).catch(()=>{});}
$('login').onclick=async()=>{try{if(session.mode==='demo'){await api('/api/demo/login',{method:'POST'});await refreshSession();await refreshJobs();}else if(session.authMode==='passkey')await runPasskey(false);else location.href='/auth/login';}catch(e){$('setup-message').textContent=errorText(e);}};
$('login-existing').onclick=()=>{void runPasskey(false,true);};
async function runPasskey(register:boolean,legacy=false){
  if(passkeyBusy)return;if(!browserSupportsWebAuthn()){$('setup-message').textContent='Dieser Browser unterstützt die Geräteanmeldung nicht. Bitte verwenden Sie einen aktuellen Browser mit eingerichteter Gerätesperre.';return;}
  $('legacy-login').hidden=true;passkeyBusy=true;const out=session.user?(dialog('account-dialog').open?$('account-status'):$('notice')):$('setup-message');out.hidden=false;out.textContent='Bitte bestätigen Sie die Anmeldung an Ihrem Gerät …';
  try{
    let stepUp='';
    if(register&&session.user){
      const existing=await api('/auth/passkey/login/options',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose:'add-key'})});
      const proof=await startAuthentication({optionsJSON:existing.options});
      stepUp=(await api('/auth/passkey/login/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({response:proof})})).stepUp;
    }
    const initialPersonalSetup=register&&Boolean(bootstrapInvite)&&session.selfHosted;
    const kind=register?'register':'login';
    const d=await api('/auth/passkey/'+kind+'/options',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(register?{stepUp,invite:bootstrapInvite,name:$<HTMLInputElement>('passkey-name').value,label:session.user?$<HTMLInputElement>('new-key-label').value:'Passkey'}:legacy?{legacy:true}: {})});
    const response=register?await startRegistration({optionsJSON:d.options}):await startAuthentication({optionsJSON:d.options});
    await api('/auth/passkey/'+kind+'/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({response})});
    bootstrapInvite='';await refreshSession();if(initialPersonalSetup){location.assign('/einrichten');return;}await refreshJobs();await accountUI.refresh();message(register?'Ihr Anmeldeschlüssel ist eingerichtet.':'Sie sind angemeldet.');
  }catch(e){if(session.legacyLoginOrigin){const link=$<HTMLAnchorElement>('legacy-login-link');link.href=session.legacyLoginOrigin;$('legacy-login').hidden=false;}out.textContent=e instanceof Error&&e.name==='SecurityError'?'Dieser Browser unterstützt die gemeinsame Passkey-Anmeldung noch nicht. Verwenden Sie die bisherige Adresse oder einen aktuellen Safari-, Chrome- oder Edge-Browser.':e instanceof Error&&e.name==='NotAllowedError'?'Die Gerätebestätigung wurde abgebrochen oder ist abgelaufen. Sie können sie erneut starten.':errorText(e);}
  finally{passkeyBusy=false;}
}
const accountUI=initAccountUI({api,errorText,refresh:async()=>{await refreshSession();if(session.user)await refreshJobs();},hasUser:()=>Boolean(session?.user),notify:message,addDomainKey:async()=>{if(!$<HTMLInputElement>('new-key-label').value)$<HTMLInputElement>('new-key-label').value='Neue Adresse';await runPasskey(true);}});
$('passkey-enroll').onsubmit=e=>{e.preventDefault();void runPasskey(true);};
$('passkey-backup').onclick=()=>{void runPasskey(true);};
let pushBusy=false,pushPublicKey='';
function pushSupported(){return 'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;}
async function refreshPush(){
  $('push-panel').hidden=session.mode==='demo';if(session.mode==='demo')return;
  const state=await api('/api/push');pushPublicKey=state.publicKey||'';
  $<HTMLButtonElement>('push-enable').disabled=!state.available||!pushSupported();
  $<HTMLButtonElement>('push-test').disabled=!state.devices;
  $<HTMLButtonElement>('push-disable').disabled=!pushSupported();
  $<HTMLButtonElement>('push-local-test').disabled=!pushSupported();
  $('push-diagnostics').textContent=!pushSupported()?'Dieser Browser bietet hier keine Gerätebenachrichtigungen an. Auf dem iPad bitte die installierte App vom Home-Bildschirm öffnen.':!state.available?'Gerätebenachrichtigungen sind noch nicht eingerichtet.':state.deliveryFailed?'Eine Zustellung ist fehlgeschlagen. Bitte testen Sie die Benachrichtigungen und schalten Sie sie gegebenenfalls erneut ein.':state.devices?`${state.devices} Gerät(e) angemeldet. Eine Testnachricht prüft die tatsächliche Zustellung.`:'Noch kein Gerät angemeldet. Sie entscheiden selbst, ob Hinweise erlaubt sind.';
  $('push-status').textContent=!pushSupported()?'Hier nicht verfügbar.':!state.available?'Noch nicht eingerichtet.':state.deliveryFailed?'Zustellung fehlgeschlagen · bitte testen.':state.devices?`${state.devices} ${state.devices===1?'Gerät':'Geräte'} angemeldet.`:'Ausgeschaltet.';
  $('push-enable').hidden=Boolean(state.devices&&pushSupported()&&Notification.permission==='granted');$('push-disable').hidden=!state.devices;
  if(pushSupported()){
    const permission=Notification.permission;$('push-diagnostics').textContent+=' Browser-Erlaubnis: '+(permission==='granted'?'erteilt':permission==='denied'?'abgelehnt':permission==='default'?'noch nicht erteilt':'unbekannt')+'.';
    const last=state.lastDelivery;if(last?.last_attempt_at){$('push-diagnostics').textContent+=' Letzter Versandversuch: '+dateFormat.format(last.last_attempt_at)+' Uhr.';if(last.last_http)$('push-diagnostics').textContent+=' Pushdienst: HTTP '+last.last_http+(last.last_http>=200&&last.last_http<300?' (angenommen).':' (nicht angenommen).');else if(last.last_error)$('push-diagnostics').textContent+=' Der Pushdienst konnte nicht erreicht oder die Nachricht nicht erzeugt werden.';if(last.last_http>=200&&last.last_http<300)$('push-diagnostics').textContent+=' Falls nichts erscheint: Mitteilungsfreigabe des Browsers im Betriebssystem und Fokus/Nicht stören prüfen.';}
  }
}
async function pushAction(work:()=>Promise<void>){
  if(pushBusy)return;pushBusy=true;
  try{await work();await refreshPush();}catch(e){$('push-status').textContent=e instanceof Error&&e.message==='push_permission_denied'?'Benachrichtigungen wurden nicht erlaubt. Sie können die Berechtigung in den Browsereinstellungen ändern.':errorText(e);}finally{pushBusy=false;}
}
$('push-enable').onclick=()=>{void pushAction(async()=>{
  if(!pushSupported()||!pushPublicKey)throw new Error('push_unavailable');
  // Permission is requested only in direct response to the user's button click.
  if(await Notification.requestPermission()!=='granted')throw new Error('push_permission_denied');
  const registration=await navigator.serviceWorker.ready;
  const key=Uint8Array.from(atob(pushPublicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  await api('/api/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({consent:'notify-this-device',subscription:subscription.toJSON()})});
});};
$('push-local-test').onclick=()=>{void pushAction(async()=>{
  if(!pushSupported())throw new Error('push_unavailable');
  if(await Notification.requestPermission()!=='granted')throw new Error('push_permission_denied');
  const registration=await navigator.serviceWorker.ready;
  await registration.showNotification('IServ Zeitplaner',{body:'Lokaler Anzeigetest: Dieser Hinweis kommt direkt von Ihrem Browser.',icon:'/icon.svg',tag:'zeitplaner-local-test'});
  message('Die lokale Anzeige wurde beim Browser angefordert. Wenn auch dieser Hinweis fehlt, prüfen Sie die Mitteilungsfreigabe Ihres Browsers im Betriebssystem und Fokus/Nicht stören.');
});};
$('push-test').onclick=()=>{void pushAction(async()=>{const result=await api('/api/push/test',{method:'POST'}),d=result.delivery;if(d?.accepted)message('Der Pushdienst hat die Testnachricht angenommen. Bitte prüfen Sie die sichtbare Anzeige auf Ihrem Gerät.');else if(d?.failed)message('Der Pushdienst hat die Testnachricht nicht angenommen. Die genaue HTTP-Nummer oder Verbindungsstörung steht unten im Benachrichtigungsstatus.',true);else if(d?.removed)message('Die Geräteanmeldung ist beim Pushdienst abgelaufen. Bitte schalten Sie Benachrichtigungen erneut ein.',true);else message('Es wurde noch keine neue Testnachricht gesendet. Bitte warten Sie eine Minute und versuchen Sie es erneut.',true);});};
$('push-disable').onclick=()=>{void pushAction(async()=>{
  const registration=await navigator.serviceWorker.ready,subscription=await registration.pushManager.getSubscription();
  if(subscription){await api('/api/push',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:subscription.endpoint})});await subscription.unsubscribe();}
});};
$('settings-open').onclick=()=>dialog('settings-dialog').showModal();
$('settings-close').onclick=()=>dialog('settings-dialog').close();
$('connection-summary').onclick=()=>{if($('connection-summary').dataset.connected==='true')dialog('settings-dialog').showModal();else $('connection-open').click();};
$('connection-open').onclick=()=>{dialog('settings-dialog').close();$<HTMLFormElement>('connection-form').reset();$('connection-message').textContent='';dialog('connection-dialog').showModal();};
function clearConnectionPassword(){$<HTMLInputElement>('connection-password').value='';}
$('connection-close').onclick=()=>{clearConnectionPassword();dialog('connection-dialog').close();};
dialog('connection-dialog').addEventListener('close',clearConnectionPassword);
dialog('connection-dialog').addEventListener('cancel',clearConnectionPassword);
$('connection-form').onsubmit=async event=>{
  event.preventDefault();if(!$<HTMLInputElement>('connection-consent').checked)return;
  const button=$<HTMLButtonElement>('connection-save');button.disabled=true;$('connection-message').textContent='Die Verbindung wird lesend geprüft …';
  let body=JSON.stringify({username:$<HTMLInputElement>('connection-user').value,password:$<HTMLInputElement>('connection-password').value,consent:'store-encrypted-account-password'});clearConnectionPassword();
  try{await api('/api/connection',{method:'PUT',headers:{'Content-Type':'application/json'},body});body='';dialog('connection-dialog').close();await refreshSession();message('Ihre IServ-Verbindung ist für 30 Tage gespeichert. Sie können jetzt eine Veröffentlichung planen.');}
  catch(e){$('connection-message').textContent=errorText(e);}
  finally{body='';button.disabled=false;clearConnectionPassword();}
};
$('connection-disconnect').onclick=async()=>{
  if(!confirm('Gespeicherten IServ-Zugang entfernen? Wartende Veröffentlichungen benötigen danach eine erneuerte Verbindung und einen neuen Termin. Eine bereits begonnene Übertragung kann nicht sicher zurückgerufen werden.'))return;
  try{await api('/api/connection',{method:'DELETE'});await refreshSession();await refreshJobs();message('Der gespeicherte Zugang wurde entfernt. Noch nicht begonnene Aufträge wurden angehalten.');}catch(e){message(errorText(e),true);}
};
$('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'});await refreshSession();}catch(e){message(errorText(e),true);}};
$<HTMLInputElement>('file').onchange=e=>setFile((e.target as HTMLInputElement).files?.[0]||null);
for(const type of ['dragenter','dragover'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.add('dragging');});
for(const type of ['dragleave','drop'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.remove('dragging');});
$('dropzone').addEventListener('drop',e=>{const f=(e as DragEvent).dataTransfer?.files[0];if(f)setFile(f);});
let copyProbeBusy=false,copyProbeFolder='';
$('copy-probe-open').onclick=()=>{if(copyProbeBusy||session.copyProbeBlocked)return;copyProbeFolder=browsing;$('copy-probe-path').textContent=prettyFolder(copyProbeFolder);$<HTMLInputElement>('copy-probe-consent').checked=false;$<HTMLButtonElement>('copy-probe-start').disabled=true;$('copy-probe-progress').textContent='';dialog('copy-probe-dialog').showModal();};
$('copy-probe-consent').onchange=()=>{$<HTMLButtonElement>('copy-probe-start').disabled=copyProbeBusy||!$<HTMLInputElement>('copy-probe-consent').checked;};
$('copy-probe-close').onclick=()=>{if(!copyProbeBusy)dialog('copy-probe-dialog').close();};
dialog('copy-probe-dialog').addEventListener('cancel',event=>{if(copyProbeBusy)event.preventDefault();});
$('copy-probe-start').onclick=async()=>{
 if(copyProbeBusy||!$<HTMLInputElement>('copy-probe-consent').checked)return;copyProbeBusy=true;for(const id of ['copy-probe-start','copy-probe-close','copy-probe-consent'])$<HTMLButtonElement>(id).disabled=true;$('copy-probe-progress').textContent='Neue Testdateien werden angelegt, kopiert und geprüft …';
 try{const r=await api('/api/folders/numbering-probe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:copyProbeFolder,consent:'create-and-copy-four-harmless-test-files'})});
  if(r.passed)await browse(copyProbeFolder);$('copy-probe-result').textContent=(r.passed?'Kopierprüfung bestanden.':'Kopierprüfung nicht bestanden oder unklar.')+' '+r.steps.map((step:{name:string;statuses:number[];verified:boolean})=>step.name+': '+(step.statuses.length?'HTTP '+step.statuses.join('/')+', ':'')+(step.verified?'bestätigt':'nicht bestätigt')+'.').join(' ')+' Keine Freigabe für echte nummerierte Veröffentlichungen. Keine Dateien gelöscht. Kein automatischer weiterer Versuch. Mögliche eigene Testdateien: '+r.files.join(' · ');dialog('copy-probe-dialog').close();
 }catch(error){$('copy-probe-progress').textContent=errorText(error)+' Kein automatischer weiterer Versuch. Im gewählten Ordner können neue Dateien mit dem Anfang „zeitplaner-kopiertest-“ vorhanden sein.';}
 finally{copyProbeBusy=false;for(const id of ['copy-probe-close','copy-probe-consent'])$<HTMLButtonElement>(id).disabled=false;$<HTMLButtonElement>('copy-probe-start').disabled=!$<HTMLInputElement>('copy-probe-consent').checked;}
};
let nameProbeBusy=false,nameProbePath='';
$('name-probe-open').onclick=()=>{if(nameProbeBusy)return;nameProbePath=browsing;$('name-probe-path').textContent=prettyFolder(nameProbePath);$<HTMLInputElement>('name-probe-consent').checked=false;$<HTMLButtonElement>('name-probe-start').disabled=true;$('name-probe-progress').textContent='';dialog('name-probe-dialog').showModal();};
$('name-probe-consent').onchange=()=>{$<HTMLButtonElement>('name-probe-start').disabled=nameProbeBusy||!$<HTMLInputElement>('name-probe-consent').checked;};
$('name-probe-close').onclick=()=>{if(!nameProbeBusy)dialog('name-probe-dialog').close();};
dialog('name-probe-dialog').addEventListener('cancel',e=>{if(nameProbeBusy)e.preventDefault();});
$('name-probe-start').onclick=async()=>{
  if(nameProbeBusy||!$<HTMLInputElement>('name-probe-consent').checked)return;nameProbeBusy=true;$<HTMLButtonElement>('name-probe-start').disabled=true;$<HTMLButtonElement>('name-probe-close').disabled=true;
  $('name-probe-progress').textContent='Die neuen Testdateien werden angelegt, zurückgelesen und mit Schutz vor Ersetzen verschoben …';
  let text='';
  try{
    const result=await api('/api/folders/name-probe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:nameProbePath,consent:'create-and-move-harmless-private-test-files'})});
    text=(result.passed?(session.originalMoveEnabled?'Namensprüfung bestanden. Neue Veröffentlichungen in diesem geprüften Ordner können den Originalnamen behalten. Bestehende Aufträge behalten ihr bisheriges Verfahren.':'Namensprüfung bestanden. Der getestete Verschiebeweg ist ein möglicher Kandidat für Originalnamen; der laufende Veröffentlichungsmodus bleibt bis zur abschließenden Auswertung unverändert.'):'Namensprüfung nicht bestanden oder unklar. Originalnamen ohne Zusatz werden dadurch nicht freigegeben.')+' '+result.steps.map((step:{name:string;statuses:number[];verified:boolean})=>step.name+': '+(step.statuses.length?'HTTP '+step.statuses.join('/')+', ':'')+(step.verified?'bestätigt':'nicht bestätigt')+'.').join(' ')+' Keine Dateien gelöscht. Kein automatischer weiterer Versuch. Mögliche eigene Testdateien: '+result.files.join(' · ');
    if(result.passed)await browse(nameProbePath);dialog('name-probe-dialog').close();$('name-probe-result').textContent=text;
  }catch(e){$('name-probe-progress').textContent=errorText(e);}
  finally{nameProbeBusy=false;$<HTMLButtonElement>('name-probe-close').disabled=false;}
};
$('choose-folder').onclick=()=>{dialog('folder-dialog').showModal();void browseSafe(folder||session.groupRoot);};
$('folder-close').onclick=()=>dialog('folder-dialog').close();
$('folder-select').onclick=()=>{if(submitted)return;if(browsingWritable){folder=browsing;folderOriginal=browsingOriginal;resetReplacement();showReviewPolicy();void previewTargetName();$('chosen-folder').textContent=prettyFolder(folder);pendingKey=null;pending=null;dialog('folder-dialog').close();}};
let folderProofBusy=false,folderProofPath='';
$('folder-proof-open').onclick=()=>{if(folderProofBusy)return;folderProofPath=browsing;$('folder-proof-path').textContent=prettyFolder(folderProofPath);$<HTMLInputElement>('folder-proof-consent').checked=false;$<HTMLInputElement>('folder-proof-cleanup').checked=false;$<HTMLButtonElement>('folder-proof-start').disabled=true;$('folder-proof-progress').textContent='';dialog('folder-proof-dialog').showModal();};
$('folder-proof-consent').onchange=()=>{$<HTMLButtonElement>('folder-proof-start').disabled=folderProofBusy||!$<HTMLInputElement>('folder-proof-consent').checked;};
$('folder-proof-close').onclick=()=>{if(!folderProofBusy)dialog('folder-proof-dialog').close();};
dialog('folder-proof-dialog').addEventListener('cancel',e=>{if(folderProofBusy)e.preventDefault();});
$('folder-proof-start').onclick=async()=>{
  if(folderProofBusy||!$<HTMLInputElement>('folder-proof-consent').checked)return;
  folderProofBusy=true;$<HTMLInputElement>('folder-proof-cleanup').disabled=true;$<HTMLInputElement>('folder-proof-consent').disabled=true;$<HTMLButtonElement>('folder-proof-start').disabled=true;$<HTMLButtonElement>('folder-proof-close').disabled=true;$('folder-proof-progress').textContent='Die harmlose Testdatei wird angelegt und geprüft …';
  let text='';
  try{
    const r=await api('/api/folders/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:folderProofPath,consent:$<HTMLInputElement>('folder-proof-cleanup').checked?'create-and-remove-harmless-folder-proof-even-if-changed':'create-harmless-folder-proof'})});
    text=(r.verified?'Erstellen und Rücklesen bestätigt.':'Die Prüfung wurde nicht bestätigt. '+(errors[r.error]||errors.folder_probe_unverified))+(r.cleanup==='removed'?' Testdatei entfernt und Abwesenheit geprüft.':r.cleanup==='uncertain'?' Entfernen nicht sicher bestätigt. Kein weiterer Löschversuch.':r.verified?' Testdatei bleibt erhalten.':'')+(r.file&&r.cleanup!=='removed'?' Testdatei zur eigenen Kontrolle: '+r.file+'.':'')+(r.httpStatus!==undefined?' HTTP '+r.httpStatus+'.':'')+(r.cleanupHttpStatus!==undefined&&r.cleanup!=='removed'?' Löschen: HTTP '+r.cleanupHttpStatus+'.':'')+' Kein automatischer weiterer Schreibversuch.';
    await browse(folderProofPath);
  }catch(e){text=errorText(e)+' Eine harmlose Datei „zeitplaner-schreibpruefung“ mit zufälligem Zusatz kann im Ordner zurückgeblieben sein. Es erfolgt kein automatischer weiterer Schreibversuch.';$<HTMLButtonElement>('folder-select').disabled=true;}
  finally{folderProofBusy=false;$<HTMLInputElement>('folder-proof-cleanup').disabled=false;$<HTMLInputElement>('folder-proof-consent').disabled=false;$<HTMLButtonElement>('folder-proof-close').disabled=false;dialog('folder-proof-dialog').close();$('folder-proof-result').textContent=text;}
};
$('folder-back').onclick=()=>{const parts=browsing.replace(/\/$/,'').split('/');parts.pop();void browseSafe(parts.join('/')+'/');};
$('plan-form').onsubmit=async event=>{
 event.preventDefault();if(submitted){dialog('confirm-dialog').showModal();return;}if(!file){message('Bitte wählen Sie zuerst eine Datei aus.',true);return;}if(!folder){message('Bitte wählen Sie zuerst einen Zielordner aus.',true);return;}
 const reviewFile=file,reviewFolder=folder,reviewName=desiredName();const local=$<HTMLInputElement>('date').value+'T'+$<HTMLInputElement>('time').value;
 const review=$<HTMLButtonElement>('review');review.disabled=true;
 try{
  const digest=await hash(reviewFile);
  if(file!==reviewFile||folder!==reviewFolder||desiredName()!==reviewName||local!==$<HTMLInputElement>('date').value+'T'+$<HTMLInputElement>('time').value){message('Auswahl geändert. Bitte erneut prüfen.',true);return;}
  const metadata=[desiredName(),folder,file.size,digest,local];
  if(!pending||JSON.stringify([pending.filename,pending.folder,pending.size,pending.sha256,pending.localTime])!==JSON.stringify(metadata)){
   pending={key:crypto.randomUUID(),filename:desiredName(),folder,size:file.size,sha256:digest,localTime:local};updateReviewDraft();
  }
  const d=$('confirmation');d.replaceChildren();for(const [label,value]of [['Datei',file.name+' · '+formatSize(file.size)],['Zielordner',prettyFolder(folder)],['Veröffentlichung',local.replace('T',' · ')+' Uhr (Berlin)']])d.append(el('dt','',label),el('dd','',value));
  $('upload-status').hidden=true;$('target-name-box').hidden=false;showReviewPolicy();dialog('confirm-dialog').showModal();void previewTargetName();if(!pending?.namingQuote)void prepareQuote();
 }catch{message(errors.unexpected_error,true);}finally{review.disabled=false;}
};
$('confirm-plan').onclick=()=>void confirmPlan();for(const id of ['confirm-back','confirm-close'])$(id).onclick=()=>{if(!busy&&!submitted)dialog('confirm-dialog').close();};dialog('confirm-dialog').addEventListener('cancel',e=>{if(busy||submitted)e.preventDefault();});dialog('confirm-dialog').addEventListener('close',()=>{$('review').focus({preventScroll:true});});
$('edit-close').onclick=()=>dialog('edit-dialog').close();
$('edit-save').onclick=async()=>{if(!selected)return;try{await api('/api/jobs/'+selected.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reschedule',revision:selected.revision,localTime:$<HTMLInputElement>('edit-time').value})});dialog('edit-dialog').close();message('Der neue Termin ist verbindlich gespeichert.');}catch(e){dialog('edit-dialog').close();message(errorText(e),true);}await refreshJobs().catch(()=>{});};
for(const id of ['cancel-back','cancel-close'])$(id).onclick=()=>dialog('cancel-dialog').close();
$('cancel-confirm').onclick=async()=>{if(!selected)return;try{await api('/api/jobs/'+selected.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'cancel',revision:selected.revision})});dialog('cancel-dialog').close();message('Die Veröffentlichung wurde abgebrochen.');}catch(e){dialog('cancel-dialog').close();message(errorText(e),true);}await refreshJobs().catch(()=>{});};
$<HTMLInputElement>('resume-file').onchange=async e=>{const f=(e.target as HTMLInputElement).files?.[0];if(!f||!resumeId)return;try{await api(`/api/jobs/${resumeId}/file`,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:f});message('Die Dateiübertragung ist abgeschlossen. Die Veröffentlichung ist verbindlich geplant.');}catch(error){message(errorText(error),true);}await refreshJobs().catch(()=>{});$<HTMLInputElement>('resume-file').value='';};
$('tab-planned').onclick=()=>{view='planned';setTabs();};$('tab-past').onclick=()=>{view='past';setTabs();};
$('refresh').onclick=async()=>{const button=$<HTMLButtonElement>('refresh');button.disabled=true;button.setAttribute('aria-busy','true');try{await refreshSession();await refreshJobs();message('Übersicht aktualisiert.');}catch(e){message(errorText(e),true);}finally{button.disabled=false;button.removeAttribute('aria-busy');}};
const tomorrow=localTime(Date.now()+86400000);$<HTMLInputElement>('date').value=tomorrow.slice(0,10);
$('probe-form').onsubmit=async event=>{
  event.preventDefault();const button=$<HTMLButtonElement>('probe-submit');button.disabled=true;$('probe-status').textContent='Ihre erreichbaren Ordner werden gelesen …';$('probe-results').replaceChildren();
  try{const result=await api('/api/local-probe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$<HTMLInputElement>('probe-user').value,password:$<HTMLInputElement>('probe-password').value,path:$<HTMLInputElement>('probe-path').value})});
    $('probe-status').textContent='Verbindung erfolgreich. Dies war ausschließlich eine Leseprüfung; Schreiben und Verschieben sind noch nicht getestet.';
    for(const f of result.folders as Folder[]){const row=el('button','folder-row');row.type='button';row.append(el('span','folder-symbol','▱'),el('span','',f.name),el('small','',f.permission==='unknown'?'Schreibrechte unbekannt':f.writable?'Erstellen laut Server erlaubt':'Nur lesen'));row.onclick=()=>{$<HTMLInputElement>('probe-path').value=f.path;updateWriteProbe();$('probe-status').textContent='Pfad ausgewählt. Geben Sie für die nächste Leseabfrage Ihr Passwort erneut ein.';$<HTMLInputElement>('probe-password').focus();};$('probe-results').append(row);}
    if(!result.folders.length)$('probe-results').append(el('p','muted','Keine Unterordner in diesem Pfad.'));
  }catch(e){$('probe-status').textContent=probeFeedback(e instanceof Error?e.message:'unexpected_error',e instanceof ApiError?e.diagnostic as ProbeDiagnostic:undefined)+' Es wurden keine Dateien verändert. Diese Leseprüfung wird nicht automatisch wiederholt.';}
  finally{$<HTMLInputElement>('probe-password').value='';button.disabled=false;}
};
let targetId='',targetFolder='',targetBusy=false;
$('target-probe-form').onsubmit=event=>{
  event.preventDefault();if(targetBusy||!$<HTMLFormElement>('probe-form').reportValidity())return;
  targetFolder=$<HTMLInputElement>('target-probe-path').value;
  if(!targetFolder.startsWith('/Files/')||!targetFolder.endsWith('/')){$('target-probe-status').textContent='Bitte einen eigenen privaten Ordner innerhalb von Files mit abschließendem / eintragen.';return;}
  targetId=crypto.randomUUID();$('target-probe-summary').textContent=['einzeln','gleichzeitig','uebertragung'].map(name=>targetFolder+'zeitplaner-zieltest-'+targetId+'-'+name+'.txt').join(' · ');
  $<HTMLInputElement>('target-probe-consent').checked=false;$<HTMLButtonElement>('target-probe-start').disabled=true;dialog('target-probe-dialog').showModal();
};
$('target-probe-consent').onchange=()=>{$<HTMLButtonElement>('target-probe-start').disabled=!$<HTMLInputElement>('target-probe-consent').checked||targetBusy;};
$('target-probe-close').onclick=()=>{if(!targetBusy){$<HTMLInputElement>('probe-password').value='';dialog('target-probe-dialog').close();}};
dialog('target-probe-dialog').addEventListener('cancel',event=>{if(targetBusy)event.preventDefault();else $<HTMLInputElement>('probe-password').value='';});
$('target-probe-start').onclick=async()=>{
  if(targetBusy||!$<HTMLInputElement>('target-probe-consent').checked)return;targetBusy=true;$<HTMLButtonElement>('target-probe-start').disabled=true;
  $('target-probe-status').textContent='Eigene Testdateien werden angelegt und geprüft. Bitte kurz warten …';
  let body=JSON.stringify({path:targetFolder,testId:targetId,username:$<HTMLInputElement>('probe-user').value,password:$<HTMLInputElement>('probe-password').value,consent:'create-private-target-test-files'});$<HTMLInputElement>('probe-password').value='';
  try{const result=await api('/api/local-target-probe',{method:'POST',headers:{'Content-Type':'application/json'},body});$('target-probe-status').textContent=targetProbeFeedback(result);}
  catch{$('target-probe-status').textContent='Die Prüfung konnte nicht eindeutig abgeschlossen werden. Mögliche eigene Testdateien: '+targetFolder+'zeitplaner-zieltest-'+targetId+'-einzeln.txt, -gleichzeitig.txt, -uebertragung.txt. Kein automatischer weiterer Schreibversuch.';}
  finally{body='';targetBusy=false;dialog('target-probe-dialog').close();}
};
let writeBusy=false;let writeTestId='';let writeFolder='';
function updateWriteProbe(){const p=$<HTMLInputElement>('probe-path').value;$<HTMLButtonElement>('write-probe-open').disabled=!p.startsWith('/Files/')||!p.endsWith('/');}
$('probe-path').addEventListener('input',updateWriteProbe);
$('write-probe-open').onclick=()=>{
  if(!$<HTMLFormElement>('probe-form').reportValidity())return;
  writeFolder=$<HTMLInputElement>('probe-path').value;writeTestId=crypto.randomUUID();
  $('write-probe-folder').textContent=writeFolder+'zeitplaner-test-'+writeTestId+'.txt';$<HTMLInputElement>('write-probe-consent').checked=false;$<HTMLButtonElement>('write-probe-confirm').disabled=true;
  dialog('write-probe-dialog').showModal();
};
$('write-probe-consent').onchange=()=>{$<HTMLButtonElement>('write-probe-confirm').disabled=!$<HTMLInputElement>('write-probe-consent').checked;};
for(const id of ['write-probe-close','write-probe-back'])$(id).onclick=()=>{dialog('write-probe-dialog').close();$<HTMLInputElement>('probe-password').value='';};
dialog('write-probe-dialog').addEventListener('cancel',e=>{if(writeBusy)e.preventDefault();else $<HTMLInputElement>('probe-password').value='';});
$('write-probe-confirm').onclick=async()=>{
  if(writeBusy||!$<HTMLInputElement>('write-probe-consent').checked)return;
  writeBusy=true;for(const id of ['write-probe-confirm','write-probe-close','write-probe-back'])$<HTMLButtonElement>(id).disabled=true;
  const status=$('write-probe-status');status.textContent='Leere Testdatei wird angelegt, geprüft und wieder entfernt …';
  $<HTMLInputElement>('test-file-path').value=writeFolder+'zeitplaner-test-'+writeTestId+'.txt';
  try{
    const result=await api('/api/local-write-probe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$<HTMLInputElement>('probe-user').value,password:$<HTMLInputElement>('probe-password').value,path:writeFolder,testId:writeTestId,consent:'create-and-remove-empty-private-test-file'})});
    status.textContent=result.createVerified&&result.readVerified&&result.removedVerified?'Schreibtest bestanden: Die leere Testdatei wurde angelegt, gelesen und nachweislich wieder entfernt. Das bestätigt diese drei Vorgänge in diesem privaten Ordner zum Testzeitpunkt. Verschieben und Gruppenrechte sind noch nicht getestet.':'Das Testergebnis konnte nicht vollständig bestätigt werden.';
  }catch(e){
    const diagnostic=e instanceof ApiError?e.diagnostic as WriteProbeDiagnostic|undefined:undefined;
    status.textContent=writeProbeFeedback(e instanceof Error?e.message:'unexpected_error',diagnostic);
    if(!diagnostic||diagnostic.leftoverPossible)status.textContent+=' Möglicherweise verbliebene Testdatei: '+(diagnostic?.testFile||writeFolder+'zeitplaner-test-'+writeTestId+'.txt');
  }finally{
    $<HTMLInputElement>('probe-password').value='';writeBusy=false;for(const id of ['write-probe-confirm','write-probe-close','write-probe-back'])$<HTMLButtonElement>(id).disabled=false;
    dialog('write-probe-dialog').close();status.scrollIntoView({block:'center'});
  }
};
$('test-file-probe-form').onsubmit=async event=>{
  event.preventDefault();if(!$<HTMLFormElement>('probe-form').reportValidity())return;
  const button=$<HTMLButtonElement>('test-file-submit'),status=$('test-file-status');button.disabled=true;
  status.textContent='Die vorhandene Testdatei wird ausschließlich gelesen …';
  try{
    const result=await api('/api/local-test-file-probe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      username:$<HTMLInputElement>('probe-user').value,password:$<HTMLInputElement>('probe-password').value,testFile:$<HTMLInputElement>('test-file-path').value,includeProperties:true,includeCapabilities:true})});
    status.textContent=testFileFeedback(result)+testFilePropertiesFeedback(result.properties)+testFileCapabilitiesFeedback(result.properties,result.capabilities)+' Diese Prüfung hat keine Datei angelegt, verändert oder entfernt.';
  }catch(e){
    status.textContent=writeProbeFeedback(e instanceof Error?e.message:'unexpected_error',e instanceof ApiError?e.diagnostic as WriteProbeDiagnostic:undefined)+' Diese Prüfung hat keine Datei angelegt, verändert oder entfernt.';
  }finally{$<HTMLInputElement>('probe-password').value='';button.disabled=false;}
};
let lockBusy=false,lockFolder='',lockTestId='';
$('lock-probe-form').onsubmit=event=>{
  event.preventDefault();if(!$<HTMLFormElement>('probe-form').reportValidity())return;
  const folder=$<HTMLInputElement>('lock-probe-path').value;
  if(!folder.startsWith('/Files/')||!folder.endsWith('/')){$('lock-probe-status').textContent='Bitte wählen Sie Ihren eigenen privaten Testordner unter /Files/ mit abschließendem /.';return;}
  lockFolder=folder;lockTestId=crypto.randomUUID();
  $('lock-probe-file').textContent=lockFolder+'zeitplaner-test-'+lockTestId+'.txt';
  $<HTMLInputElement>('lock-probe-consent').checked=false;$<HTMLButtonElement>('lock-probe-confirm').disabled=true;
  dialog('lock-probe-dialog').showModal();
};
$('lock-probe-consent').onchange=()=>{$<HTMLButtonElement>('lock-probe-confirm').disabled=lockBusy||!$<HTMLInputElement>('lock-probe-consent').checked;};
for(const id of ['lock-probe-close','lock-probe-back'])$(id).onclick=()=>{dialog('lock-probe-dialog').close();$<HTMLInputElement>('probe-password').value='';};
dialog('lock-probe-dialog').addEventListener('cancel',event=>{if(lockBusy)event.preventDefault();else $<HTMLInputElement>('probe-password').value='';});
$('lock-probe-confirm').onclick=async()=>{
  if(lockBusy||!$<HTMLInputElement>('lock-probe-consent').checked)return;
  lockBusy=true;for(const id of ['lock-probe-close','lock-probe-back','lock-probe-confirm'])$<HTMLButtonElement>(id).disabled=true;
  $<HTMLInputElement>('lock-probe-consent').disabled=true;
  const status=$('lock-probe-status'),testFile=lockFolder+'zeitplaner-test-'+lockTestId+'.txt';
  status.textContent='Die neue Textdatei wird angelegt und die Sperre wird geprüft. Anschließend wird ihre Freigabe versucht. Bitte die lokale Anwendung geöffnet lassen …';
  $<HTMLInputElement>('test-file-path').value=testFile;
  const body=JSON.stringify({username:$<HTMLInputElement>('probe-user').value,password:$<HTMLInputElement>('probe-password').value,path:lockFolder,testId:lockTestId,consent:'create-private-text-file-and-test-lock'});
  $<HTMLInputElement>('probe-password').value='';
  try{status.textContent=lockProbeFeedback(await api('/api/local-lock-probe',{method:'POST',headers:{'Content-Type':'application/json'},body}));}
  catch(error){
    const code=error instanceof Error?error.message:'unexpected_error';
    status.textContent=code==='lock_probe_consent_required'?'Bitte bestätigen Sie die gesonderten Schritte dieses Sperrtests.':writeProbeFeedback(code);
    if(!['not_found','lock_probe_consent_required','write_probe_private_only','invalid_path','invalid_request','login_required','forbidden'].includes(code))status.textContent+=' Das Ergebnis ist unklar. Eine Testdatei oder Sperre kann bestehen: '+testFile+'. Es wird kein weiterer Schreib- oder Sperrversuch gestartet.';
  }finally{
    $<HTMLInputElement>('probe-password').value='';lockBusy=false;
    for(const id of ['lock-probe-close','lock-probe-back','lock-probe-confirm'])$<HTMLButtonElement>(id).disabled=false;
    $<HTMLInputElement>('lock-probe-consent').disabled=false;dialog('lock-probe-dialog').close();status.scrollIntoView({block:'center'});
  }
};
let uiBusy=false,uiFolder='',uiTestId='',uiFile='',uiReceipt='',uiDownloaded=false,uiDownloadUrl='',uiEndsAt=0,uiTimer:ReturnType<typeof setInterval>|undefined;
const uiDecisionButtons=['ui-probe-blocked','ui-probe-changed','ui-probe-skip'];
function uiButtons(disabled:boolean){for(const id of uiDecisionButtons)$<HTMLButtonElement>(id).disabled=disabled;}
function resetUiDownload(){if(uiDownloadUrl){const old=uiDownloadUrl;setTimeout(()=>URL.revokeObjectURL(old),1000);uiDownloadUrl='';}}
$('ui-probe-form').onsubmit=event=>{
  event.preventDefault();if(uiBusy||!$<HTMLFormElement>('probe-form').reportValidity())return;
  const folder=$<HTMLInputElement>('ui-probe-path').value;
  if(!folder.startsWith('/Files/')||!folder.endsWith('/')){$('ui-probe-status').textContent='Bitte verwenden Sie Ihren eigenen privaten Testordner unter /Files/ mit abschließendem /.';return;}
  uiFolder=folder;uiTestId=crypto.randomUUID();uiFile=folder+'zeitplaner-test-'+uiTestId+'.txt';uiDownloaded=false;resetUiDownload();
  uiDownloadUrl=URL.createObjectURL(new Blob([UI_PROBE_REPLACEMENT],{type:'text/plain;charset=utf-8'}));
  const download=$<HTMLAnchorElement>('ui-probe-download');download.href=uiDownloadUrl;download.download=uiFile.split('/').at(-1)!;
  $('ui-probe-file').textContent=uiFile;$<HTMLInputElement>('ui-probe-consent').checked=false;$<HTMLButtonElement>('ui-probe-confirm').disabled=true;
  dialog('ui-probe-dialog').showModal();
};
$('ui-probe-download').onclick=()=>{uiDownloaded=true;$<HTMLButtonElement>('ui-probe-confirm').disabled=uiBusy||!$<HTMLInputElement>('ui-probe-consent').checked;};
$('ui-probe-consent').onchange=()=>{$<HTMLButtonElement>('ui-probe-confirm').disabled=uiBusy||!uiDownloaded||!$<HTMLInputElement>('ui-probe-consent').checked;};
for(const id of ['ui-probe-close','ui-probe-back'])$(id).onclick=()=>{dialog('ui-probe-dialog').close();resetUiDownload();$<HTMLInputElement>('probe-password').value='';};
dialog('ui-probe-dialog').addEventListener('cancel',event=>{if(uiBusy)event.preventDefault();else{resetUiDownload();$<HTMLInputElement>('probe-password').value='';}});
function uiEvent(event:UiLockEvent){
  if(event.type==='preparing'){$('ui-probe-status').textContent='Die neue private Testdatei und die eigene Sperre werden vorbereitet …';}
  if(event.type==='ready'){
    uiReceipt=event.id;uiEndsAt=event.windowEndsAt;$('ui-probe-live').hidden=false;$('ui-probe-live-file').textContent=event.testFile;uiButtons(false);
    dialog('ui-probe-dialog').close();$('ui-probe-live').scrollIntoView({block:'center'});
    const tick=()=>{const seconds=Math.max(0,Math.ceil((uiEndsAt-Date.now())/1000));$('ui-probe-countdown').textContent='Verbleibendes Zeitfenster: '+seconds+' Sekunden';if(!seconds)uiButtons(true);};
    tick();uiTimer=setInterval(tick,250);$('ui-probe-status').textContent='Die eigene Sperre und der Originalinhalt wurden geprüft. Jetzt den beschriebenen Überschreibversuch in IServ durchführen und hier das Ergebnis melden.';
  }
  if(event.type==='checking'){uiButtons(true);if(uiTimer)clearInterval(uiTimer);$('ui-probe-countdown').textContent='Zeitfenster beendet · Ergebnisprüfung läuft';$('ui-probe-status').textContent='Sperrzustand und Dateiinhalt werden erneut geprüft. Anschließend wird die Freigabe versucht …';}
  if(event.type==='result'){$('ui-probe-countdown').textContent='Vergleichstest beendet';$('ui-probe-status').textContent=uiLockFeedback(event.report);}
}
for(const [id,observation]of [['ui-probe-blocked','blocked'],['ui-probe-changed','changed'],['ui-probe-skip','not_attempted']]as const)$(id).onclick=async()=>{
  if(!uiReceipt||!uiBusy)return;uiButtons(true);
  try{await api('/api/local-ui-lock-probe/'+uiReceipt+'/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({observation:observation as UiObservation})});}
  catch(error){$('ui-probe-status').textContent=error instanceof Error&&error.message==='probe_window_closed'?'Das Zeitfenster ist bereits geschlossen. Die automatische Ergebnisprüfung und Freigabe werden abgewartet.':'Ihre Rückmeldung konnte nicht bestätigt werden. Der laufende Test beendet das Zeitfenster selbst und versucht die Freigabe.';}
};
$('ui-probe-confirm').onclick=async()=>{
  if(uiBusy||!uiDownloaded||!$<HTMLInputElement>('ui-probe-consent').checked)return;
  uiBusy=true;uiReceipt='';$('ui-probe-live').hidden=true;uiButtons(true);
  for(const id of ['ui-probe-close','ui-probe-back','ui-probe-confirm'])$<HTMLButtonElement>(id).disabled=true;
  $<HTMLInputElement>('ui-probe-consent').disabled=true;
  let body=JSON.stringify({username:$<HTMLInputElement>('probe-user').value,password:$<HTMLInputElement>('probe-password').value,path:uiFolder,testId:uiTestId,consent:'create-private-file-and-compare-iserv-ui'});
  $<HTMLInputElement>('probe-password').value='';let completed=false;let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
    const response=await apiResponse('/api/local-ui-lock-probe',{method:'POST',headers:{'Content-Type':'application/json'},body});
    body='';
    if(!response.headers.get('Content-Type')?.startsWith('application/x-ndjson')||!response.body)throw new Error('unexpected_error');
    reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let buffered='',total=0;
    const process=(line:string)=>{if(!line.trim())return;const event=JSON.parse(line)as UiLockEvent;uiEvent(event);if(event.type==='result')completed=true;};
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>65536)throw new Error('unexpected_error');buffered+=decoder.decode(value,{stream:true});let newline:number;while((newline=buffered.indexOf('\n'))>=0){process(buffered.slice(0,newline));buffered=buffered.slice(newline+1);}}
    buffered+=decoder.decode();if(buffered.trim())process(buffered);if(!completed)throw new Error('network');
  }catch(error){
    const code=error instanceof Error?error.message:'unexpected_error';
    $('ui-probe-status').textContent=code==='probe_already_running'?'Ein Vergleichstest läuft bereits. Bitte sein Ergebnis abwarten.':writeProbeFeedback(code);
    if(!['ui_probe_consent_required','probe_already_running','write_probe_private_only','invalid_path','invalid_request','login_required','forbidden','not_found'].includes(code))$('ui-probe-status').textContent+=' Das Ergebnis ist unklar. Eine Testdatei oder Sperre kann bestehen: '+uiFile+'. Kein automatischer weiterer Versuch.';
    await reader?.cancel().catch(()=>{});
  }finally{
    body='';reader?.releaseLock();if(uiTimer)clearInterval(uiTimer);uiBusy=false;uiReceipt='';uiButtons(true);resetUiDownload();if(!completed)$('ui-probe-countdown').textContent='Vergleichstest nicht vollständig bestätigt';
    for(const id of ['ui-probe-close','ui-probe-back','ui-probe-confirm'])$<HTMLButtonElement>(id).disabled=false;
    $<HTMLInputElement>('ui-probe-consent').disabled=false;dialog('ui-probe-dialog').close();$('ui-probe-status').scrollIntoView({block:'center'});
  }
};
// Bound only the initial read. An interrupted upload or mutation must never be
// retried implicitly: its server-side result may already have been committed.
$('startup-retry').onclick=event=>{
 event.preventDefault();
 // The invitation was removed from the address bar during boot. Preserve it
 // for this explicit retry without saving it to browser storage.
 if(bootstrapInvite)history.replaceState(null,'',location.pathname+location.search+'#einladung='+bootstrapInvite);
 location.reload();
};
const startupAbort=new AbortController();
const startupTimer=setTimeout(()=>startupAbort.abort(),12000);
try{await refreshSession(startupAbort.signal);if(session.user)await refreshJobs();const loginError=new URLSearchParams(location.search).get('login_error');if(loginError){$('setup-message').textContent=errors[loginError]||errors.login_failed;history.replaceState(null,'','/');}}catch(e){
 if(!session){$('startup-title').textContent='Die Verbindung ist gerade unterbrochen.';$('startup-status').textContent='Bitte laden Sie die Seite erneut. Bereits geplante Veröffentlichungen laufen unabhängig von diesem Fenster.';}
 else message(errorText(e),true);
}finally{clearTimeout(startupTimer);$('startup-view').removeAttribute('aria-busy');}
setInterval(()=>{if(document.visibilityState==='visible'&&!busy&&session?.user)void refreshSession().then(refreshJobs).catch(()=>{});},15000);
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
