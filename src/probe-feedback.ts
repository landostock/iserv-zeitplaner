export interface ProbeDiagnostic {httpStatus?:number;method?:'PROPFIND';networkReason?:'timeout'|'tls'|'dns'|'connection';}
// Specific to the read-only test: never imply an upload job or automatic retries.
export function probeFeedback(code:string,detail?:ProbeDiagnostic):string {
  if(detail?.httpStatus){
    const status=detail.httpStatus;
    const suffix=` (HTTP ${status})`;
    if(status===401)return 'IServ hat die Anmeldung abgewiesen. Bitte prüfen Sie Ihren IServ-Benutzernamen und Ihr Passwort.'+suffix;
    if(status===403)return 'IServ ist erreichbar, erlaubt diesem Konto aber nicht, diesen Ordner aufzulisten. Prüfen Sie den Ordnerpfad.'+suffix;
    if(status===404)return 'IServ ist erreichbar, hat unter diesem Pfad aber keinen Ordner gefunden. Beginnen Sie erneut mit dem Ordnerpfad /.'+suffix;
    if(status>=300&&status<400)return 'IServ antwortet mit einer Weiterleitung. Die Zugangsdaten wurden nicht weitergeleitet. Die Zieladresse muss zuerst geprüft werden.'+suffix;
    if(status===405||status===501)return 'IServ ist erreichbar, unterstützt diese Ordnerabfrage an dieser Adresse jedoch nicht. Die WebDAV-Adresse muss geprüft werden.'+suffix;
    if(status===429)return 'IServ begrenzt gerade die Anfragen. Warten Sie bitte etwas, bevor Sie die Prüfung erneut starten.'+suffix;
    if(status>=500)return 'IServ ist erreichbar, hat die Ordnerabfrage aber mit einem Serverfehler beantwortet. Versuchen Sie die Prüfung später erneut.'+suffix;
    return 'IServ ist erreichbar, hat die Ordnerabfrage jedoch abgelehnt. Die genaue Serverantwort hilft bei der weiteren Prüfung.'+suffix;
  }
  if(code==='needs_auth')return 'IServ hat die Anmeldung abgewiesen. Bitte prüfen Sie Ihren Benutzernamen und Ihr Passwort.';
  if(code==='permission_denied')return 'IServ erlaubt diesem Konto nicht, diesen Ordner aufzulisten. Bitte prüfen Sie den Ordnerpfad.';
  if(code==='login_required')return 'Die lokale Testsitzung ist abgelaufen. Öffnen Sie die Testumgebung erneut und starten Sie die Prüfung nochmals.';
  if(code==='forbidden')return 'Die lokale Sitzung konnte nicht bestätigt werden. Laden Sie die Seite neu und versuchen Sie es erneut.';
  if(code==='invalid_path')return 'Bitte verwenden Sie einen absoluten Ordnerpfad, beginnend mit /, ohne übergeordnete Pfade oder eine Internetadresse.';
  if(code==='invalid_dav')return 'IServ hat geantwortet, aber keine sicher auswertbare WebDAV-Ordnerliste geliefert. Das ist kein nachgewiesener Verbindungsabbruch.';
  if(code==='folder_too_large')return 'Die Ordnerantwort ist für diese sichere Leseprüfung zu groß. Wählen Sie einen gezielten Unterordner.';
  if(code==='network')return 'Die Verbindung zwischen Browser und lokaler Testanwendung wurde unterbrochen. Bitte prüfen Sie, ob die lokale Anwendung noch läuft.';
  if(code==='probe_transport_failed'){
    if(detail?.networkReason==='timeout')return 'Die Ordnerabfrage hat das Zeitlimit überschritten. Bitte versuchen Sie die Prüfung später erneut.';
    if(detail?.networkReason==='tls')return 'Die lokale Anwendung konnte die verschlüsselte Verbindung zu IServ nicht sicher prüfen. Die Zertifikatsprüfung bleibt eingeschaltet.';
    if(detail?.networkReason==='dns')return 'Die lokale Anwendung konnte die Adresse des WebDAV-Servers nicht auflösen. Bitte prüfen Sie Ihre Internetverbindung.';
    return 'Die lokale Anwendung konnte keine vollständige Verbindung zum WebDAV-Server herstellen. Das beweist nicht, dass IServ allgemein ausgefallen ist.';
  }
  return 'Die lokale Ordnerprüfung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut; bei wiederholtem Fehler muss die Schnittstelle geprüft werden.';
}
