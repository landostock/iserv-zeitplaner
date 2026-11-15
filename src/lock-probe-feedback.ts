export type LockProbePhase='create'|'lock'|'verify'|'without_token'|'wrong_token'|'with_token'|'unlock'|'after_unlock'|'done';
export interface LockProbeReport {
  testFile:string;phase:LockProbePhase;passed:boolean;created:boolean;possibleFile:boolean;
  lockAcquired:boolean;possibleLock:boolean;unlockConfirmed:boolean;releaseVerified:boolean;
  noTokenRejected:boolean;wrongTokenRejected:boolean;withTokenAccepted:boolean;
  noTokenStatus?:number;wrongTokenStatus?:number;withTokenStatus?:number;afterUnlockStatus?:number;
  timeoutSeconds?:number;fileVersion?:'strong'|'weak'|'missing'|'invalid';
  failure?:string;httpStatus?:number;unlockFailed?:boolean;unlockHttpStatus?:number;
}
export function lockProbeFeedback(result:LockProbeReport):string {
  const status=result.httpStatus?` (HTTP ${result.httpStatus})`:'';
  let text=result.passed?'WebDAV-Sperrtest bestanden: Ohne Sperrkennung wurde Schreiben blockiert, eine falsche Kennung abgewiesen und die richtige akzeptiert. Nach dem Aufheben war Schreiben wieder möglich; der bekannte Testinhalt wurde erneut geprüft.'
    :result.failure==='lock_probe_without_token_allowed'?'Sperrtest nicht bestanden: Der Server hat Schreiben ohne Sperrkennung nicht mit der erwarteten Sperrantwort blockiert.'
    :result.failure==='lock_probe_wrong_token_allowed'?'Sperrtest nicht bestanden: Die falsche Sperrkennung wurde nicht mit einer erwarteten Ablehnung beantwortet.'
    :result.failure==='lock_probe_unsafe_timeout'?'Der Server hat keine eindeutig kurze Sperrlaufzeit von 30 bis 120 Sekunden bestätigt. Der weitere Schreibtest wurde gestoppt.'
    :result.failure==='lock_probe_invalid_response'?'Die Sperrantwort passte nicht eindeutig zur angeforderten exklusiven Sperre dieser Testdatei. Der weitere Schreibtest wurde gestoppt.'
    :result.failure==='lock_probe_content_changed'?'Der gelesene Inhalt stimmt nicht mit dem bekannten Testtext überein. Der weitere Schreibtest wurde gestoppt.'
    :result.failure==='conflict'&&result.phase==='create'?'Der Testname ist bereits belegt. Diese vorhandene Datei wurde nicht verändert oder gesperrt.'
    :result.failure==='lock_probe_expired'?'Die kurze Sperrlaufzeit reicht für den weiteren Test nicht mehr sicher aus. Es wurde kein weiterer Prüfschreibversuch gestartet.'
    :'Der Sperrtest wurde nicht vollständig bestätigt (Schritt: '+({create:'Anlegen',lock:'Sperren',verify:'Inhalt prüfen',without_token:'ohne Kennung schreiben',wrong_token:'mit falscher Kennung schreiben',with_token:'mit richtiger Kennung schreiben',unlock:'Entsperren',after_unlock:'nach dem Entsperren prüfen',done:'Abschluss'}[result.phase])+').';
  text+=status;
  if(result.fileVersion)text+=' Dateikennung beim Lesen der nicht leeren Textdatei: '+({strong:'stark',weak:'schwach',missing:'fehlt',invalid:'unerwartetes Format'}[result.fileVersion])+'.';
  if(result.possibleLock)text+=' Eine Sperre kann noch bestehen. Bitte kontrollieren Sie die Testdatei in IServ; ihr Ablauf ist nicht garantiert.';
  else if(result.unlockConfirmed)text+=' Das Aufheben der angeforderten Sperre wurde bestätigt.';
  if(result.unlockFailed&&result.unlockHttpStatus)text+=` Antwort beim Aufheben: HTTP ${result.unlockHttpStatus}.`;
  if(result.possibleFile)text+=' Testdatei zur eigenen Kontrolle: '+result.testFile+'. Sie wurde nicht gelöscht.';
  return text+' Kein automatischer weiterer Versuch. Schutz über andere IServ-Zugriffswege, Verschieben, Gruppenrechte und langfristiger Cloudzugriff sind damit noch nicht bestätigt.';
}
