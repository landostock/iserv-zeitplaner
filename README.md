# Mein IServ Zeitplaner

Browser-Assistent für eine eigene Installation im eigenen Cloudflare-Konto. iPad, Windows, Linux und macOS benötigen weder Terminal noch lokale Installationsprogramme.

**Stand: 15.11.2026 · 1.0.0-rc1.** Kontrollierte Testversion. Automatisierte Tests ersetzen keinen ersten Gesamttest im eigenen neuen Anbieter-Konto und am eigenen IServ. Fehlerfreiheit oder Ausfallsicherheit ohne Grenzen wird nicht versprochen.

## Installation starten

1. Ein eigenes kostenloses Cloudflare-Konto und GitHub-Konto anlegen bzw. anmelden; E-Mail-Adressen bestätigen und Mehrfaktoranmeldung absichern.
2. Den [Cloudflare-Installationsdialog öffnen](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Flandostock%2Fiserv-zeitplaner). Den eigenen Kontonamen prüfen. Cloudflare erstellt eine eigene Programmkopie in Ihrem GitHub-Konto.
3. Einen neuen Projektnamen verwenden und die erkannten Build-/Deploy-Befehle übernehmen: `npm run build` und `npx wrangler deploy` bzw. `npm run deploy`. Keine vorhandene produktive Installation überschreiben.
4. Im Feld **SETUP_CODE** ein selbst erzeugtes zufälliges Passwort mit mindestens 24 Zeichen aus Ihrem Passwortmanager als Secret hinterlegen. Dort aufbewahren. Niemals auf einer Website des Entwicklers eingeben.
5. Bei einer Nachfrage die kostenlose workers.dev-Kontoadresse aktivieren. Kein Paid-Abo und keine eigene Domain erforderlich. Nach erfolgreichem Deployment die feste workers.dev-Adresse aus Ihrem Cloudflare-Projekt öffnen.
6. Auf dieser eigenen Website den Einrichtungscode und Ihre IServ-Adresse angeben. Der private Assistent führt durch Passkey, Wiederherstellungscode, Verbindung, echten Veröffentlichungstest und Ausfallüberwachung.

Der Einrichtungscode beweist, dass Sie das Cloudflare-Projekt kontrollieren. Die Installation ist vor diesem Nachweis gesperrt. Unbeteiligte können den ersten Administrationszugang nicht einfach beanspruchen. Verschlüsselungs- und Push-Schlüssel werden erst in Ihrem eigenen privaten Durable Object erzeugt. Ein abgebrochener Durchlauf verwendet dieselbe Installation und dieselben Schlüssel weiter.

## Nach der Installation

Die eigene Website als Lesezeichen speichern. Auf anderen Geräten dieselbe Adresse öffnen, einen synchronisierten Passkey nutzen oder einen weiteren Passkey hinzufügen. Ein iPad kann über „Teilen → Zum Home-Bildschirm“ die Website installieren. Lokale Cookies müssen dabei nicht zwischen Geräten übertragen werden.

Datei → Zielordner → Datum/Uhrzeit → Zusammenfassung → Veröffentlichung planen. Erst nach „Verbindlich geplant“ schließen. Das Gerät darf danach ausgeschaltet sein. IServ-Verbindungen werden nach 30 Tagen erneuert; die App zeigt den Ablauf an.

## Zeitsteuerung und Ausfallüberwachung

Veröffentlichungsalarme, Kontrollalarm und minütlicher Cloudflare-Cron werden automatisch mitinstalliert. Ein manuell eingerichteter cron-job.org-Job ist für die Ausführung nicht notwendig.

Eine unabhängige Ausfallwarnung benötigt einen Dienst außerhalb dieses Cloudflare-Kontos. Der Assistent unterstützt [Healthchecks.io](https://healthchecks.io/): kostenloses Konto, einen Check mit **Period 1 Minute / Grace Time 4 Minuten** anlegen, E-Mail-Kanal für den Check einschalten und die Ping-Adresse auf der eigenen Website einfügen. Die Adresse wird geprüft und verschlüsselt gespeichert. Es werden nur leere Zustands-Pings versandt, keine PDF-Inhalte, Dateinamen, IServ-Adressen oder Zugangsdaten. Ein absichtlicher Warnungstest mit eigener Empfangsbestätigung verhindert die Behauptung einer nur scheinbar eingerichteten Mailzustellung. Dieser zusätzliche Dienst ist nicht nötig, wenn Sie bewusst ohne externe Ausfallwarnung arbeiten wollen; der Assistent zeigt diesen Zustand ausdrücklich an.

## Daten und Grenzen

50 MiB pro Datei, 40 aktive Aufträge, 20 neue Aufträge pro UTC-Tag, 600 MiB Tresor pro Person. Die kostenlose Infrastruktur unterliegt den gemeinsamen Kontingenten des jeweiligen Anbieter-Kontos; Überschreitungen können die Verarbeitung blockieren. Neue Quellen werden nach Erfolg oder Storno, bei Fehlern nach sieben Tagen bereinigt. Bereinigte Auftragsdaten haben in der Regel 90 Tage, Ausführungsbelege 400 Tage Aufbewahrung.

IServ-Instanzen müssen die hier verwendeten WebDAV-Dateibereiche `/Files/` und gegebenenfalls `/Groups/` anbieten. Die Standardadresse `webdav.<Schule>` ist nur ein Vorschlag und wird beim Verbinden tatsächlich geprüft. Eine abweichende WebDAV-Adresse kann vorgegeben werden. Unbekannte Dateibereiche und gesperrtes WebDAV werden nicht durch eine erfolgreiche Website-Installation als unterstützt behauptet. Schreibrechte und erster Upload müssen im eigenen Zielordner getestet werden.

## Updates

Sie kontrollieren die geklonte Programmkopie. Änderungen im Repository des Entwicklers werden nicht automatisch in diese Kopie übernommen. Neue Versionen und Abhängigkeiten vor Übernahme prüfen, danach im eigenen Konto veröffentlichen. Das Release-Manifest erkennt Änderungen an ausgelieferten Quellen; Prüfsummen allein beweisen keine Vertrauenswürdigkeit. Den Worker-Namen beibehalten. Das private Installationsobjekt, vorhandene Speicherobjekte und ihre Schlüssel nicht löschen oder durch neue Migrationen ersetzen. Ein Update ist keine Neuinstallation.

## Verantwortungsgrenze

Der Entwickler erhält weder Kontozugriff noch Schlüssel oder einen Support-Hintereingang. Die Software muss von Ihnen oder einer von Ihnen bestimmten Person geprüft werden. Cloudflare, Ihr Gerät und bewusst installierter Code bleiben vertrauensnotwendig. Die technische Unabhängigkeit ersetzt keine Entscheidung, welche schulischen Inhalte extern verarbeitet werden dürfen.

Siehe [Sicherheitsmodell](SECURITY.md) und [Fehlerquellen und Prüfungen](INSTALLATION-CHECKS.md).

## Für die technische Prüfung

Die mitgelieferten nativen Installationsprüfungen sind mit `npm ci`, `npm run typecheck` und `npm test` reproduzierbar. Sie verwenden ausschließlich synthetische Konten und einen simulierten WebDAV-Server. Mit installierten Playwright-Browsern prüft `npm run test:browser` den Assistenten in Chromium und WebKit. Die produktive Bereitstellung benötigt diese lokalen Prüfwerkzeuge nicht. Die Browser-Testkonfiguration dient nur dem Testen der Oberfläche und veröffentlicht keine Cloud-Ressourcen.
