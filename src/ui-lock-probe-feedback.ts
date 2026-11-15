export const UI_PROBE_ORIGINAL='IServ Zeitplaner: Original fuer den manuellen Vergleichstest.\n';
export const UI_PROBE_REPLACEMENT='IServ Zeitplaner: geaendert ueber die normale IServ-Dateiverwaltung.\n';
export type UiObservation='blocked'|'changed'|'not_attempted';
export interface UiLockReport {
  testFile:string;outcome:'blocked_reported'|'bypass_detected'|'inconclusive'|'failed';
  possibleFile:boolean;possibleLock:boolean;unlockConfirmed:boolean;
  originalVerified:boolean;lockBefore:boolean;lockAfter:boolean;
  source:'original'|'changed'|'missing'|'unreadable';observation?:UiObservation;
  failure?:string;httpStatus?:number;
}
export type UiLockEvent={type:'preparing';id:string;testFile:string}
  |{type:'ready';id:string;testFile:string;windowEndsAt:number}
  |{type:'checking'}|{type:'result';report:UiLockReport};
export function uiLockFeedback(result:UiLockReport):string {
  let text=result.outcome==='bypass_detected'?'Änderung trotz bestätigter WebDAV-Sperre beobachtet: Der zuvor geprüfte Testinhalt wurde verändert oder die Datei entfernt. Ein Schutz dieses anderen Zugriffswegs durch die WebDAV-Sperre ist damit nicht tragfähig.'
    :result.outcome==='blocked_reported'?'Sie melden eine Ablehnung des konkreten Überschreibversuchs. Der Originalinhalt und die eigene Sperre wurden davor und danach bestätigt. Das stützt den Schutz für diesen Versuch und diesen Zugriffsweg; es ist keine allgemeine Freigabe.'
    :result.outcome==='failed'?'Der Vergleichstest konnte nicht sicher vorbereitet oder abgeschlossen werden.'
    :'Ergebnis unklar: Ein konkreter abgewiesener Versuch bei bestätigter Sperre und unverändertem Inhalt wurde nicht vollständig nachgewiesen. Unveränderter Inhalt allein zählt nicht als Erfolg.';
  if(result.httpStatus)text+=` (HTTP ${result.httpStatus})`;
  text+=' Dateiprüfung danach: '+({original:'Originalinhalt',changed:'anderer Inhalt',missing:'Datei nicht vorhanden',unreadable:'nicht sicher lesbar'}[result.source])+'. Eigene Sperre danach: '+(result.lockAfter?'bestätigt':'nicht bestätigt')+'.';
  if(result.possibleLock)text+=' Eine Sperre kann noch bestehen; ihr Ablauf ist nicht garantiert.';
  else if(result.unlockConfirmed)text+=' Das Aufheben der eigenen Sperre wurde bestätigt.';
  if(result.possibleFile)text+=' Testpfad zur eigenen Kontrolle: '+result.testFile+'. Die Anwendung hat keine Datei gelöscht.';
  return text+' Kein automatischer weiterer Schreib- oder Sperrversuch. Andere Zugriffswege, MOVE, Gruppenrechte und langfristige Cloudautorisierung bleiben gesondert zu prüfen.';
}
