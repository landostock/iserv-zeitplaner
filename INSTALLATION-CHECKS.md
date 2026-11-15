# Fehlerquellen und Freigabeprüfung

Die vorhandenen Release Notes und Prüfberichte des IServ-reMarkable-Assistenten bis RC27 wurden berücksichtigt. Diese Liste behauptet nicht, dass sämtliche damaligen 27 Versionen eigenständige Installationsfehler waren; die Historie enthält auch Sicherheitsupdates, Providerkorrekturen und neue Funktionen.

| Befund aus dem reMarkable-Projekt | Konsequenz für den Zeitplaner |
| --- | --- |
| Managed-Node-PATH, nicht gefundene Tools und systemabhängige Pakete | Browserinstallation statt lokaler Programme; iPad braucht kein Terminal. |
| OAuth-Callback und manuelle Codes, erfolgreiche CLI ohne echte Identität, private Credential-Verzeichnisse | Keine lokale CLI-Anmeldung. Cloudflare führt den Import im bereits angemeldeten Eigentümerkonto aus. Kontoname und E-Mail-Bestätigung werden ausdrücklich geprüft. |
| Unbestätigte E-Mail oder fehlende workers.dev-Adresse | Eigener Vorbereitungsschritt, verständliche Fortsetzungsanleitung, keine vermeintliche Fertigmeldung. |
| Ungültige noch nicht ersetzte Wrangler-Konfiguration schon beim Login | Vollständige ausführbare Konfiguration ohne Platzhalter-Namen, Account-IDs oder vorherige Ressourcen. |
| Ressourcen zuerst veröffentlicht, Secrets fehlen | Die neue App bleibt vor dem gültigen SETUP_CODE und der Eigentümerinitialisierung gesperrt. Keine Veröffentlichung ohne Nutzerauftrag. |
| Unklare Organisation oder Namenskollision | Eigenen Anbieter-Kontonamen prüfen; neue Projektkopie ausdrücklich wählen. Keine Suche nach ähnlich benannten fremden Ressourcen und kein automatisches Überschreiben. |
| Abgebrochene Erstellung legt Ressourcen erneut an | Fortsetzung im selben Cloudflare-Projekt; privates Installationsobjekt persistiert Schlüssel und Zustand. |
| Zu kurze Timeouts, neuer voller Timeout pro Retry, doppelte Aufrufe | Begrenzte API-Wartezeiten; keine automatische Wiederholung von Mutationen; Status neu lesen und bestehende Aufträge fortsetzen. |
| Veraltete Cloud-Images und Berichte eines vorherigen Laufs | Keine Fly-Images; ein tatsächlicher bestätigter Upload der eigenen neuen Instanz ist Voraussetzung für den Abschluss. Version und unveränderliche Quell-Prüfsummen werden mitgeliefert. |
| Falsch interpretierte Providerantworten und Tokenformate | Keine Fly-Token-Verarbeitung. Bestehender WebDAV-Adapter und natives Rücklesen; Heartbeat benötigt HTTP 200 plus exakte OK-Bestätigung. |
| Ein Dry-run beweist keinen echten Upload | Der Assistent verwechselt Anmeldung oder Ordnerliste nicht mit einer veröffentlichten Datei. |
| Fehlerdetails enthalten rohe Tokens, Namen oder Schulpfade | Kurze klassifizierte UI-Fehler; Support ohne Dateien, Passwörter oder Cloud-Tokens. |
| App-Update statt Cloud-Update | Die eigene Repository-Kopie ist die Deploymentquelle. Keine lokalen Paketversionen neben einem separat veralteten Agenten. |

## Rückkehr nach der GitHub-Verknüpfung

Beim Praxistest führte die GitHub-Verknüpfung zur allgemeinen Repository-Auswahl statt zurück zur Zeitplaner-Vorlage. Der öffentliche Assistent führt die Verknüpfung deshalb als eigene Etappe, bietet erneut den vollständigen Vorlagenlink und speichert nur den aktuellen Schritt als erlaubten URL-Fragmentwert. Er erkennt weder Anbieter-Anmeldungen noch einen erfolgreichen Cloudflare-Build automatisch. Zugangscodes, private Website-Adressen und Kontodaten werden dabei nicht im Browser-Speicher abgelegt. MODE und SELF_HOSTED werden intern gesetzt; das Cloudflare-Formular benötigt diese Variablen nicht mehr.

## Notwendige reale Abnahme

Automatische Tests decken Ursprungssperren, Eingabegrenzen, falschen Einrichtungscode, Single-use-Passkey, private Routen, CSRF, Fortsetzung, echte SQLite-Persistenz, Neustart, Dateiplanung, nativen Alarm, WebDAV-Übertragung und Rückprüfung mit synthetischen Daten ab. Browserprüfungen decken Chromium und WebKit einschließlich iPad-Größen, schmaler Ansicht, größerer Schrift, falscher Adresse, Passwortfeld-Leeren und Mailbestätigung ab.

Für die allgemeine Freigabe fehlt zusätzlich ein dokumentierter Durchlauf mit einem **frischen Cloudflare- und GitHub-Konto**, einschließlich E-Mail-Bestätigung, Kontoadresse, Git-Import, Secret-Eingabe und einer realen eigenen IServ-Datei. Die Sicherheitsgrenze verlangt, dass der jeweilige Kontoinhaber diesen Teil selbst ausführt. Sein Passwort, seine API-Tokens und seine Produktionsdateien werden dafür nicht an den Entwickler übergeben. Eine physische iPad-Erstinstallation ist von einer simulierten WebKit-Prüfung zu unterscheiden.

Bei einer Anbieteränderung oder einer unbekannten Fehlermeldung ist die Installation angehalten, nicht erfolgreich. Ein neuer Installationsdurchlauf ist kein Ersatz für die Diagnose einer angehaltenen vorhandenen Installation. Eine bestehende produktive Instanz wird durch diese Testvorlage nicht geändert.
