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
| Cloudflare schreibt beim Vorlagenimport den Projektnamen in `package.json` um | Der erste echte Build stoppte deshalb an der bisherigen Dateiprüfsumme. Die Paketprüfung berücksichtigt ausschließlich diesen Namen sowie JSON-Formatierung. Skripte, Installations-Hooks, Abhängigkeiten, Lockfile-Inhalte und Quelltexte bleiben geprüft. |

## Rückkehr nach der GitHub-Verknüpfung

Beim Praxistest führte die GitHub-Verknüpfung zur allgemeinen Repository-Auswahl statt zurück zur Zeitplaner-Vorlage. Der öffentliche Assistent führt die Verknüpfung deshalb als eigene Etappe, bietet erneut den vollständigen Vorlagenlink und speichert nur den aktuellen Schritt als erlaubten URL-Fragmentwert. Er erkennt weder Anbieter-Anmeldungen noch einen erfolgreichen Cloudflare-Build automatisch. Zugangscodes, private Website-Adressen und Kontodaten werden dabei nicht im Browser-Speicher abgelegt. MODE und SELF_HOSTED werden intern gesetzt; das Cloudflare-Formular benötigt diese Variablen nicht mehr.

## Beobachtungen im realen Browser am 16.11.2026

- Ein bereits verbundenes GitHub-Konto muss unter „Git account“ erneut ausgewählt werden; es ist nicht zwingend vorausgewählt. Die Anleitung bietet dafür einen direkten Weg ohne neue Freigabe.
- Im leeren Browser konnte vor der GitHub-Registrierung eine Geräteprüfung erscheinen. Diese Prüfung wird nicht umgangen.
- Cloudflare bietet GitHub-Social-Login an. Laut Anbieter können API-Token trotzdem ein nachträglich gesetztes Cloudflare-Passwort erfordern. Diese Option ist daher noch kein Beleg für eine Installation ohne weitere Passwortschritte.
- Der private Assistent prüft Uploadbeleg und Zeitsteuerung automatisch alle 15 Sekunden, solange der Testschritt sichtbar und die Sitzung gültig ist. Netzwerkfehler und verspätete Antworten dürfen keinen Abschluss auslösen.

Der Nutzer hat inzwischen getrennte GitHub- und Cloudflare-Testkonten angelegt. Beide angemeldeten Konten wurden im privaten Chrome-Fenster geprüft; die Cloudflare-E-Mail-Bestätigung hat der Nutzer abgeschlossen. Der Vorlagenimport über den öffentlichen Assistenten zeigt im neuen Konto die vorgesehenen Projekt-, Secret- und Build-Eingaben. Nach einer gezielten Korrektur für Cloudflares Änderung des Paketnamens hat der Cloudflare-Build die Release-Prüfung, den Website-Build und die Bereitstellung erfolgreich abgeschlossen. Die vier privaten Durable-Object-Bindings und der minütliche Cron wurden installiert. Der GitHub-Zugriff ist anschließend auf die private Zeitplaner-Kopie begrenzt worden.

Am 17.11.2026 wurden auch die persönliche Einrichtung mit Passkey und Wiederherstellungscode, die IServ-Verbindung und der echte Veröffentlichungstest abgeschlossen. Zugangsdaten gab der Nutzer ausschließlich auf seiner eigenen Website ein. Im ausdrücklich freigegebenen Testordner waren die WebDAV-Schreibrechte zunächst unbekannt; die bewusste Schreibprüfung mit Rücklesen war erfolgreich. Diese Prüfung wurde vom Assistenten korrekt nicht als geplanter Veröffentlichungsauftrag akzeptiert. Eine anschließend für 08:51 Uhr (Berlin) geplante synthetische Textdatei wurde bei geschlossenem Zeitplaner veröffentlicht und in IServ zurückgelesen. Der gewünschte Dateiname blieb erhalten. Der Assistent erkannte den Beleg und die funktionierende Zeitsteuerung selbstständig. Auf Wunsch des Nutzers wurde die externe Ausfallüberwachung übersprungen; der Abschluss zeigt dies ausdrücklich an.

Der öffentliche Einstieg und der private Assistent sind zwei Teile desselben Ablaufs. Die Oberfläche kennzeichnet sie als „Teil 1 · Website installieren“ und „Teil 2 · Persönliche Einrichtung“. Die fünf privaten Schritte bleiben unverändert benannt. Neue Nutzer beginnen mit GitHub und Cloudflare, eine bereits installierte Instanz setzt mit ihrer persönlichen Einrichtung fort.

Beim erstmaligen Verbinden erscheint zunächst **Authorize Cloudflare Workers and Pages** zur GitHub-Benutzerautorisierung. Erst danach folgt **Install & Authorize** mit der Repository-Auswahl und den getrennten Repository-Rechten. Der Assistent muss beide Dialoge berücksichtigen. Nach einer Unterbrechung wurde einmal ein deaktivierter Authorize-Button beobachtet; ein neu gestarteter Verknüpfungsdialog ließ sich autorisieren. Die Ursache des deaktivierten Buttons wurde nicht festgestellt.

Bei der Cloudflare-Registrierung wurde die vorgeschlagene Gmail-Plusadresse laut Nutzer mit „A variation of this email address is already taken“ abgelehnt. Cloudflare dokumentiert dies als [Fehler 1104](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1104/). Plus- und Punktvarianten einer bestehenden Gmail-Adresse dürfen daher nicht als getrennte Cloudflare-Testidentität eingeplant werden. Dafür wird eine tatsächlich andere, vom Nutzer autorisierte Adresse benötigt. Ein zusätzlicher Cloudflare-Account unter einem bestehenden Profil kann Ressourcen trennen, prüft aber keine frische Benutzerregistrierung. Das bestehende Profil wird nicht umbenannt, gelöscht oder mit der Testidentität verknüpft.

## Notwendige reale Abnahme

Beim Wiederholungslauf am 17.11.2026 wurden Worker, Durable Objects und die private GitHub-Kopie gezielt entfernt; die beiden Testkonten blieben bestehen. Nach Löschung der einzigen freigegebenen Kopie erschien wieder „New GitHub connection“. Die erneute Verbindung führte über „Continue as“ und „Install & Authorize“ zur allgemeinen Repository-Auswahl. Der vorbereitete Vorlagenlink stellte das richtige Installationsformular wieder her. Dort war der GitHub-Name erneut unter „Git account“ auszuwählen. Der Installationsschritt nennt deshalb jetzt diese Auswahl, den ausgeschalteten Preview-Schalter und den abschließenden Klick auf „Deploy“ direkt statt nur teilweise unter „Hilfe“.

Automatische Tests decken Ursprungssperren, Eingabegrenzen, falschen Einrichtungscode, Single-use-Passkey, private Routen, CSRF, Fortsetzung, echte SQLite-Persistenz, Neustart, Dateiplanung, nativen Alarm, WebDAV-Übertragung und Rückprüfung mit synthetischen Daten ab. Browserprüfungen decken Chromium und WebKit einschließlich iPad-Größen, schmaler Ansicht, größerer Schrift, falscher Adresse, Passwortfeld-Leeren und Mailbestätigung ab.

Der dokumentierte Durchlauf mit **frischen Cloudflare- und GitHub-Konten** einschließlich E-Mail-Bestätigung, Git-Import, Secret-Eingabe, Passkey, Verbindung und realer Veröffentlichung einer synthetischen IServ-Datei ist abgeschlossen. Er umfasst einen reparierten ersten Cloudflare-Build; ein weiterer frischer Import der korrigierten Vorlage ist davon zu unterscheiden. Die Sicherheitsgrenze verlangt weiterhin, dass der jeweilige Kontoinhaber Zugangsdaten und neue Anmeldeschlüssel selbst eingibt. Sein Passwort, seine API-Tokens und seine Produktionsdateien werden dafür nicht an den Entwickler übergeben.

Offen bleiben ein weiterer Erstlauf mit der vollständig korrigierten Vorlage, eine physische iPad-Erstinstallation sowie reale Erstläufe unter Windows und Linux. Die derzeitige Browserabdeckung in iPad-WebKit ist keine Hardwareabnahme. Die externe Ausfallwarnung wurde in diesem realen Durchlauf nicht eingerichtet oder getestet.

Bei einer Anbieteränderung oder einer unbekannten Fehlermeldung ist die Installation angehalten, nicht erfolgreich. Ein neuer Installationsdurchlauf ist kein Ersatz für die Diagnose einer angehaltenen vorhandenen Installation. Eine bestehende produktive Instanz wird durch diese Testvorlage nicht geändert.
