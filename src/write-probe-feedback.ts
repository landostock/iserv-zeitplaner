export interface TestFileCheck {
  exists:boolean;emptyVerified:boolean;size?:number;version:'strong'|'weak'|'missing'|'invalid';
}
type ReadFailure='http'|'timeout'|'tls'|'dns'|'connection'|'invalid_response'|'too_large'|'unavailable';
export type TestFileProperties =
  | {status:'read';version:TestFileCheck['version'];size:number|null;sizeMatches:boolean|null;exclusiveWriteLock?:boolean|null}
  | {status:'failed';httpStatus?:number;reason:ReadFailure};
export type TestFileCapabilities =
  | {status:'read';davClass2:boolean|null;lockMethod:boolean|null;unlockMethod:boolean|null;moveMethod:boolean|null;copyMethod:boolean|null}
  | {status:'failed';httpStatus?:number;reason:ReadFailure};
export interface WriteProbeDiagnostic {
  httpStatus?:number;phase:'create'|'verify'|'cleanup';testFile:string;
  createdConfirmed:boolean;leftoverPossible:boolean;
  fileCheck?:TestFileCheck;
  readFailure?:ReadFailure;
}
export function testFilePropertiesFeedback(properties?:TestFileProperties):string {
  if(!properties)return '';
  const reasons:Record<ReadFailure,string>={http:'unerwartete HTTP-Antwort',timeout:'Zeitlimit überschritten',tls:'Zertifikat nicht sicher prüfbar',dns:'Serveradresse nicht auflösbar',connection:'Verbindung unterbrochen',invalid_response:'ungültige Antwort',too_large:'Antwort zu groß',unavailable:'keine auswertbare Antwort'};
  if(properties.status==='failed')return ' Die separate Abfrage der WebDAV-Dateieigenschaften konnte nicht sicher ausgewertet werden'
    +(properties.httpStatus?` (HTTP ${properties.httpStatus})`:' ('+reasons[properties.reason]+')')+'. Das Ergebnis des Dateilesens bleibt davon getrennt.';
  if(properties.sizeMatches===false)return ' Die Dateigröße in den WebDAV-Dateieigenschaften stimmt nicht mit dem zuvor gelesenen Inhalt überein. Das Ergebnis ist widersprüchlich; es erfolgt keine automatische Änderung.';
  const detail=properties.version==='strong'?'Eine starke Dateikennung (ETag) ist dort vorhanden. Die Unterstützung bedingter Lösch- und Verschiebebefehle ist damit noch nicht getestet.'
    :properties.version==='weak'?'Auch dort wird nur eine schwache Dateikennung (ETag) geliefert.'
    :properties.version==='invalid'?'Die dort gelieferte Dateikennung (ETag) hat ein unerwartetes Format.'
    :'Auch dort wird keine Dateikennung (ETag) geliefert.';
  return ' WebDAV-Dateieigenschaften: '+detail+(properties.size===null?' Eine auswertbare Dateigröße fehlt dort ebenfalls.':'');
}
export function testFileCapabilitiesFeedback(properties?:TestFileProperties,capabilities?:TestFileCapabilities):string {
  if(!capabilities&&!(properties?.status==='read'&&properties.exclusiveWriteLock!==undefined))return '';
  const announced=(value:boolean|null|undefined)=>value===true?'angekündigt':value===false?'nicht angekündigt':'keine auswertbare Angabe';
  const lock=properties?.status==='read'?properties.exclusiveWriteLock:undefined;
  let result=' Sperrprüfung: Exklusive Schreibsperre laut Dateieigenschaften: '+announced(lock)+'.';
  if(capabilities?.status==='read')result+=' Laut Methodenliste: Sperren '+announced(capabilities.lockMethod)+', Entsperren '+announced(capabilities.unlockMethod)
    +', Verschieben '+announced(capabilities.moveMethod)+', Kopieren '+announced(capabilities.copyMethod)+'. WebDAV-Klasse 2: '+announced(capabilities.davClass2)+'.';
  else result+=' Die Methodenliste konnte nicht sicher gelesen werden'+(capabilities?.httpStatus?` (HTTP ${capabilities.httpStatus})`:'')+'.';
  return result+' Das sind ausschließlich Serverangaben, kein Nachweis einer wirksamen Sperre oder eigener Rechte. Es wurde keine Sperre gesetzt.';
}
export function testFileFeedback(check:TestFileCheck):string {
  if(!check.exists)return 'IServ meldet die Testdatei als nicht vorhanden.';
  if(!check.emptyVerified)return 'Die gelesene Testdatei ist nicht leer. Sie wurde nicht verändert oder entfernt.';
  const content='Leere Datei durch erneutes Lesen bestätigt (0 Byte). ';
  if(check.version==='missing')return content+'IServ liefert beim Lesen keine Dateikennung (ETag). Deshalb ist das automatische Entfernen mit Änderungsschutz nicht freigegeben.';
  if(check.version==='weak')return content+'IServ liefert beim Lesen nur eine schwache Dateikennung (ETag). Sie reicht für das automatische Entfernen mit Änderungsschutz nicht aus.';
  if(check.version==='invalid')return content+'Die Dateikennung (ETag) hat ein unerwartetes Format. Das automatische Entfernen bleibt gesperrt.';
  return content+'Eine starke Dateikennung (ETag) ist vorhanden. Diese rein lesende Prüfung entfernt die Datei nicht und belegt noch keine Lösch- oder Verschieberechte.';
}
export function writeProbeFeedback(code:string,detail?:WriteProbeDiagnostic):string {
  if(code==='login_required')return 'Die lokale Testsitzung ist abgelaufen. Öffnen Sie die Testumgebung erneut.';
  if(code==='invalid_path')return 'Bitte geben Sie einen vollständigen Pfad beginnend mit / ein, ohne übergeordnete Pfade oder Internetadresse.';
  if(code==='invalid_request')return 'Bitte prüfen Sie den Benutzernamen, das erneut eingegebene Passwort und den Prüfpfad.';
  if(code==='network')return 'Die Verbindung zur lokalen Anwendung wurde unterbrochen. Es erfolgt kein automatischer weiterer Versuch.';
  if(code==='write_probe_test_path_required')return 'Bitte geben Sie den vollständigen Pfad einer zeitplaner-test-Datei innerhalb Ihrer eigenen Dateien unter /Files/ an.';
  if(code==='write_probe_private_only')return 'Der Schreibtest ist ausschließlich innerhalb Ihrer eigenen Dateien unter /Files/ möglich. Wählen Sie dort einen privaten Ordner.';
  if(code==='write_probe_consent_required')return 'Bitte bestätigen Sie zuerst, dass eine leere Testdatei in Ihrem eigenen privaten Ordner angelegt und wieder entfernt werden darf.';
  const status=detail?.httpStatus?` (HTTP ${detail.httpStatus})`:'';
  if(code==='write_probe_exists')return 'Unter diesem Testnamen ist bereits eine Datei vorhanden. Sie wurde weder überschrieben noch entfernt.'+status;
  if(code==='write_probe_denied')return (detail?.httpStatus===401?'IServ hat die Anmeldung abgewiesen. Bitte prüfen Sie Ihre Zugangsdaten.':'IServ hat das Anlegen der Testdatei abgelehnt. Der Schreibzugriff ist damit nicht bestätigt.')+status;
  if(code==='write_probe_cleanup_pending')return 'Das Anlegen wurde bestätigt, das vollständige Entfernen aber nicht. Bitte kontrollieren Sie die unten genannte Testdatei in Ihren eigenen IServ-Dateien.'+status;
  if(code==='write_probe_unverified'&&detail?.fileCheck)return 'IServ hat das Anlegen bestätigt. '+testFileFeedback(detail.fileCheck)+' Die Datei wurde nicht automatisch entfernt.';
  if(code==='write_probe_read_failed'||code==='write_probe_unverified'&&detail?.readFailure){
    const reason=detail?.readFailure;
    const cause=reason==='too_large'?'Die Dateiantwort überschreitet die Grenze dieser Leerdateiprüfung.'
      :reason==='invalid_response'?'IServ hat keine vollständig auswertbare Dateiantwort geliefert.'
      :reason==='timeout'?'Das Lesen hat das Zeitlimit überschritten.'
      :reason==='tls'?'Die verschlüsselte Verbindung konnte nicht sicher geprüft werden.'
      :reason==='dns'?'Der WebDAV-Server konnte nicht aufgelöst werden.'
      :reason==='http'&&detail?.httpStatus===401?'IServ hat die Anmeldung für die Dateiabfrage abgewiesen. Bitte prüfen Sie die Zugangsdaten.'
      :reason==='http'&&detail?.httpStatus===403?'IServ erlaubt diesem Konto nicht, die Testdatei zu lesen.'
      :reason==='http'?'IServ hat die Dateiabfrage mit einem unerwarteten HTTP-Status beantwortet.'
      :'Die Datei konnte nicht vollständig gelesen werden.';
    return (code==='write_probe_unverified'?'IServ hat das Anlegen bestätigt. ':'')+cause+status+' Es wurde nichts automatisch entfernt.';
  }
  if(code==='write_probe_unverified')return 'IServ hat das Anlegen bestätigt, aber die unveränderte leere Datei konnte nicht sicher geprüft werden. Sie wurde deshalb nicht automatisch entfernt.'+status;
  if(code==='write_probe_uncertain')return 'Das Ergebnis des Anlegens ist unklar. Es erfolgt kein automatischer weiterer Schreibversuch. Bitte kontrollieren Sie die unten genannte Testdatei.'+status;
  return 'Die Prüfung konnte nicht abgeschlossen werden. Es erfolgt kein automatischer weiterer Versuch.';
}
