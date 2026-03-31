# NIO Automation – Command-Referenz

## Haupt-Pipeline (main.py)

| Command | Was passiert |
|---|---|
| `python main.py` | Komplette Pipeline: Recherche → E-Mails senden → Antworten klassifizieren |
| `python main.py --test` | Komplette Pipeline im Testmodus – keine echten E-Mails, keine Sheet-Einträge |
| `python main.py --nur-replies` | Nur Schritt 3: Gmail lesen, Antworten klassifizieren, Sheet aktualisieren |
| `python main.py --nur-replies --test` | Nur Replies – aber im Testmodus (kein Sheet-Update, keine Benachrichtigung) |

## Einzelne Agenten

| Command | Was passiert |
|---|---|
| `python tag15_bautraeger_agent.py` | Nur Bauträger bewerten & E-Mails senden (Schritt 2) |
| `python tag15_bautraeger_agent.py --test` | Bewertung & E-Mail-Vorschau ohne Versand |
| `python tag12_reply_classifier.py` | Nur Gmail lesen, klassifizieren & Sheet aktualisieren (Schritt 3) |
| `python maps_recherche.py` | Nur neue Bauträger über Google Maps recherchieren & in CSV speichern (Schritt 1) |

## Limits & Regeln

- Max. **10 E-Mails pro Tag** (nur Schritt 2, nicht der Reply-Classifier)
- Bauträger wird übersprungen wenn er bereits `KONTAKTIERT` im Sheet steht
- Mallorca/Spanien: Score wird um 2 reduziert wenn Budget unter 500.000 €
- Bei `INTERESSE`: Benachrichtigung geht an `REPLY_EMAIL` – kein automatischer Calendly-Link

## Logs & Dateien

| Command | Was passiert |
|---|---|
| `cat agent_log.txt` | Protokoll aller Pipeline-Läufe anzeigen |
| `tail -n 50 agent_log.txt` | Letzte 50 Zeilen des Logs anzeigen |

## Windows-Aufgabenplanung

Aktuell geplant: `python main.py` (täglich automatisch)
Für reine Reply-Checks zwischendurch: `python main.py --nur-replies`
