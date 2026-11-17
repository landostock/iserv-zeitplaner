# Mein IServ Zeitplaner

Browser-Assistent für eine eigene Installation im eigenen Cloudflare-Konto. iPad, Windows, Linux und macOS benötigen weder Terminal noch lokale Installationsprogramme.

**Stand: 17.11.2026 · 1.0.0-rc5.** Der reale Erstlauf mit neuen GitHub- und Cloudflare-Konten, Passkey, IServ-Verbindung und automatischer Veröffentlichung bei geschlossenem Zeitplaner ist abgeschlossen. Die optionale externe Ausfallüberwachung wurde dabei bewusst übersprungen. Eine Erstinstallation auf einem physischen iPad sowie unter Windows und Linux steht noch aus; automatisierte WebKit-Prüfungen ersetzen diese nicht.

## Installation starten

Der vollständige Einstieg ist [Installation starten](https://iserv-zeitplaner.pages.dev/installieren). **Teil 1 · Website installieren** führt in sieben kurzen Schritten durch GitHub, Cloudflare und die Bereitstellung. **Teil 2 · Persönliche Einrichtung** läuft anschließend auf Ihrer eigenen Website und hat fünf Schritte. Die Konten werden dort nicht erneut angelegt. Die fünf Schritte sind: Website vorbereiten, Anmeldung absichern, IServ verbinden, Veröffentlichung testen und optionale Ausfallüberwachung.

Über „Zurück“ können Sie Angaben nachlesen; „Hilfe“ enthält nur Hinweise zum gerade geöffneten Schritt. Beim Neuladen bleibt der öffentliche Schritt erhalten. Der Assistent erkennt Anbieter-Anmeldungen und erfolgreiche Builds nicht automatisch: Bestätigen Sie den Abschluss jeweils erst nach der Anzeige bei GitHub oder Cloudflare.

1. Ein eigenes kostenloses Cloudflare-Konto und GitHub-Konto anlegen bzw. anmelden; E-Mail-Adressen bestätigen und Mehrfaktoranmeldung absichern.
2. Den [Cloudflare-Installationsdialog öffnen](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Flandostock%2Fiserv-zeitplaner). Unter **Git account → New GitHub connection** das eigene GitHub-Konto verbinden. Im GitHub-Dialog das eigene Konto prüfen. Erscheint zunächst **Authorize Cloudflare Workers and Pages**, mit **Authorize** bestätigen. Im folgenden Fenster für die automatische Neuanlage **All repositories** wählen und **Install & Authorize** anklicken. Dies gewährt Cloudflare Zugriff auf alle Repositories des Kontos. Wer Cloudflare schon für bestimmte bestehende Projekte freigeben möchte, kann stattdessen **Only select repositories** verwenden; laut GitHub erhält die App auch Zugriff auf von ihr neu erstellte Repositories. Bei Cloudflare **Create private Git repository** aktivieren. Danach zum Assistenten zurückkehren. Wenn Cloudflare nur „Select a repository“ zeigt, die Zeitplaner-Vorlage über den vorbereiteten Link erneut öffnen; keines der anderen Projekte auswählen. Ist das GitHub-Konto bereits unter „Connected accounts“ sichtbar, dieses auswählen; die erneute Freigabe entfällt. Den eigenen Kontonamen prüfen. Cloudflare erstellt eine eigene Programmkopie in Ihrem GitHub-Konto.
3. Einen neuen Projektnamen verwenden und die erkannten Build-/Deploy-Befehle übernehmen: `npm run build` und `npx wrangler deploy` bzw. `npm run deploy`. Keine vorhandene produktive Installation überschreiben. Preview builds ausschalten und Cloudflare Access ausgeschaltet lassen. MODE und SELF_HOSTED werden intern gesetzt und brauchen kein Eingabefeld.
4. Im Feld **SETUP_CODE** ein selbst erzeugtes zufälliges Passwort mit mindestens 24 Zeichen aus Ihrem Passwortmanager als Secret hinterlegen. Dort aufbewahren. Niemals auf einer Website des Entwicklers eingeben.
5. Bei einer Nachfrage die kostenlose workers.dev-Kontoadresse aktivieren. Kein Paid-Abo und keine eigene Domain erforderlich. Nach erfolgreichem Deployment die feste workers.dev-Adresse aus Ihrem Cloudflare-Projekt öffnen.
6. Nach der erfolgreichen Bereitstellung unter [GitHub → Installed GitHub Apps](https://github.com/settings/installations) bei **Cloudflare Workers and Pages → Configure** den Zugriff auf **Only select repositories** begrenzen. Die neue Zeitplaner-Kopie und gegebenenfalls weitere bereits mit Cloudflare verbundene Projekte auswählen, dann **Save**. Andere bestehende Cloudflare-Projekte nicht versehentlich abwählen.
7. Auf dieser eigenen Website den Einrichtungscode und Ihre IServ-Adresse angeben. Der private Assistent führt durch Passkey, Wiederherstellungscode, Verbindung, echten Veröffentlichungstest und Ausfallüberwachung. Das Testergebnis wird bei geöffnetem Assistenten automatisch geprüft; erst ein vom Server bestätigter Upload und eine funktionierende Zeitsteuerung erlauben den nächsten Schritt.

Der Einrichtungscode beweist, dass Sie das Cloudflare-Projekt kontrollieren. Die Installation ist vor diesem Nachweis gesperrt. Unbeteiligte können den ersten Administrationszugang nicht einfach beanspruchen. Verschlüsselungs- und Push-Schlüssel werden erst in Ihrem eigenen privaten Durable Object erzeugt. Ein abgebrochener Durchlauf verwendet dieselbe Installation und dieselben Schlüssel weiter.

## Nach der Installation

Die eigene Website als Lesezeichen speichern. Auf anderen Geräten dieselbe Adresse öffnen, einen synchronisierten Passkey nutzen oder einen weiteren Passkey hinzufügen. Ein iPad kann über „Teilen → Zum Home-Bildschirm“ die Website installieren. Lokale Cookies müssen dabei nicht zwischen Geräten übertragen werden.

Datei → Zielordner → Datum/Uhrzeit → Zusammenfassung → Veröffentlichung planen. Erst nach „Verbindlich geplant“ schließen. Das Gerät darf danach ausgeschaltet sein. IServ-Verbindungen werden nach 30 Tagen erneuert; die App zeigt den Ablauf an.

## Zeitsteuerung und Ausfallüberwachung

Veröffentlichungsalarme, Kontrollalarm und minütlicher Cloudflare-Cron werden automatisch mitinstalliert. Ein manuell eingerichteter cron-job.org-Job ist für die Ausführung nicht notwendig.

Eine unabhängige Ausfallwarnung benötigt einen Dienst außerhalb dieses Cloudflare-Kontos. Der Assistent unterstützt [Healthchecks.io](https://healthchecks.io/): auf der Hauptseite oben rechts **Sign Up** wählen, ein kostenloses Konto und einen Check mit **Period 1 Minute / Grace Time 4 Minuten** anlegen, E-Mail-Kanal für den Check einschalten und die Ping-Adresse auf der eigenen Website einfügen. Die Adresse wird geprüft und verschlüsselt gespeichert. Es werden nur leere Zustands-Pings versandt, keine PDF-Inhalte, Dateinamen, IServ-Adressen oder Zugangsdaten. Ein absichtlicher Warnungstest mit eigener Empfangsbestätigung verhindert die Behauptung einer nur scheinbar eingerichteten Mailzustellung. Dieser zusätzliche Dienst ist nicht nötig, wenn Sie bewusst ohne externe Ausfallwarnung arbeiten wollen; der Assistent zeigt diesen Zustand ausdrücklich an.

## Daten und Grenzen

50 MiB pro Datei, 40 aktive Aufträge, 20 neue Aufträge pro UTC-Tag, 600 MiB Tresor pro Person. Die kostenlose Infrastruktur unterliegt den gemeinsamen Kontingenten des jeweiligen Anbieter-Kontos; Überschreitungen können die Verarbeitung blockieren. Neue Quellen werden nach Erfolg oder Storno, bei Fehlern nach sieben Tagen bereinigt. Bereinigte Auftragsdaten haben in der Regel 90 Tage, Ausführungsbelege 400 Tage Aufbewahrung.

IServ-Instanzen müssen die hier verwendeten WebDAV-Dateibereiche `/Files/` und gegebenenfalls `/Groups/` anbieten. Die Standardadresse `webdav.<Schule>` ist nur ein Vorschlag und wird beim Verbinden tatsächlich geprüft. Eine abweichende WebDAV-Adresse kann vorgegeben werden. Unbekannte Dateibereiche und gesperrtes WebDAV werden nicht durch eine erfolgreiche Website-Installation als unterstützt behauptet. Schreibrechte und erster Upload müssen im eigenen Zielordner getestet werden.

## Updates

Unter **Einstellungen / Updates** steht die installierte Version. Beim Anmelden und über **Nach Updates suchen** wird eine öffentliche Versionsliste abgerufen; bei einer neueren Version erscheint **Update verfügbar**. Dabei werden keine Datei-, IServ- oder Kontozugangsdaten an das Quellprojekt übertragen. Ist der Versionsdienst nicht erreichbar, arbeitet die vorhandene Installation weiter.

1. **Update vorbereiten** wählen und einmal den Link zur eigenen privaten GitHub-Kopie eintragen. Der Link steht auch bei Cloudflare im Build unter **Build settings**.
2. Beim ersten Update **Update-Funktion bei GitHub einrichten** öffnen. Die vorgefüllte Datei über **Commit changes… / Commit changes** auf **main** speichern. Ist sie schon vorhanden, diesen einmaligen Schritt überspringen. Danach **Update bei GitHub vorbereiten** öffnen. Falls GitHub nachfragt, den Workflow für das eigene Projekt aktivieren. **Run workflow** wählen, die im Zeitplaner angezeigte Version eintragen und mit **Run workflow** bestätigen.
3. Auf den grünen Lauf warten. Im Assistenten **Vorbereitete Änderung öffnen** wählen, Änderungen prüfen und über **Create pull request**, danach **Merge pull request / Confirm merge** übernehmen. Der Workflow selbst veröffentlicht nichts und benötigt keine Cloudflare-Zugangsdaten. Sein kurzlebiger GitHub-Token darf nur in dieser Programmkopie einen Update-Zweig schreiben.
4. Den erfolgreichen Cloudflare-Build unter **Deployments** abwarten. Im Zeitplaner **Installation prüfen** und nach Bestätigung der neuen Version **Zeitplaner neu laden** wählen.

Der Update-Weg unterstützt die unveränderte persönliche Vorlage ab Version 1.0.0-rc4. Er lädt ausschließlich einen fest benannten Versions-Tag aus dem öffentlichen Quellprojekt, prüft alle Release-Dateien und bricht bei eigenen Quelländerungen, neuen Speicher-Migrationen oder einem geänderten Update-Workflow vor der Übernahme ab. Solche Änderungen benötigen eine gesonderte manuelle Prüfung. Ältere Installationen benötigen einmalig eine manuelle Aktualisierung, die Worker-Konfiguration und Speicherzuordnungen erhält.

Sie kontrollieren die geklonte Programmkopie. Änderungen werden erst nach Ihrer Freigabe übernommen. Neue Versionen und Abhängigkeiten vor Übernahme prüfen. Das Release-Manifest erkennt Änderungen an ausgelieferten Quellen; Prüfsummen allein beweisen keine Vertrauenswürdigkeit. Den Worker-Namen beibehalten. Das private Installationsobjekt, vorhandene Speicherobjekte und ihre Schlüssel nicht löschen oder durch neue Migrationen ersetzen. Ein Update ist keine Neuinstallation.

## Verantwortungsgrenze

Der Entwickler erhält weder Kontozugriff noch Schlüssel oder einen Support-Hintereingang. Die Software muss von Ihnen oder einer von Ihnen bestimmten Person geprüft werden. Cloudflare, Ihr Gerät und bewusst installierter Code bleiben vertrauensnotwendig. Die technische Unabhängigkeit ersetzt keine Entscheidung, welche schulischen Inhalte extern verarbeitet werden dürfen.

Siehe [Sicherheitsmodell](SECURITY.md) und [Fehlerquellen und Prüfungen](INSTALLATION-CHECKS.md).

## Für die technische Prüfung

Die mitgelieferten nativen Installationsprüfungen sind mit `npm ci`, `npm run typecheck` und `npm test` reproduzierbar. Sie verwenden ausschließlich synthetische Konten und einen simulierten WebDAV-Server. Mit installierten Playwright-Browsern prüft `npm run test:browser` den Assistenten in Chromium und WebKit. Die produktive Bereitstellung benötigt diese lokalen Prüfwerkzeuge nicht. Die Browser-Testkonfiguration dient nur dem Testen der Oberfläche und veröffentlicht keine Cloud-Ressourcen.
