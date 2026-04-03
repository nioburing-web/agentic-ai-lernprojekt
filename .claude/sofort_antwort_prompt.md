# Prompt: sofort_antwort_agent.py

Erstelle eine neue Datei `sofort_antwort_agent.py` mit Flask.

Der Agent soll folgendes tun:

1. Einen Webhook-Endpunkt erstellen: `POST /kontakt`
   Dieser empfaengt JSON-Daten mit:
   - `name`: Name der Person
   - `email`: E-Mail der Person
   - `nachricht`: Inhalt des Kontaktformulars

2. Die Nachricht mit OpenAI analysieren und eine personalisierte Antwort generieren, die:
   - Den Namen der Person verwendet
   - Das Anliegen kurz zusammenfasst
   - Einen naechsten Schritt vorschlaegt (Termin buchen)
   - Professionell und freundlich klingt

3. Die Antwort per Brevo an die E-Mail-Adresse senden

4. Ins Google Sheet eintragen:
   - Name, E-Mail, Datum, Uhrzeit, Anliegen, Status: BEANTWORTET

Alle Werte aus `os.environ.get()` – nichts direkt im Code.
Fehlerbehandlung mit try-except in jedem Schritt.

---

## Benoetigte .env-Variablen

```
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini          # optional, default: gpt-4o-mini
BREVO_API_KEY=...
ABSENDER_NAME=NIO Automation
ABSENDER_EMAIL=anfragen@nio-automation.de
ABSENDER_TEL=...
ABSENDER_WEBSITE=nio-automation.de
REPLY_EMAIL=...
GOOGLE_CREDENTIALS_PATH=credentials.json
KONTAKT_SHEET_ID=...              # Google Sheet ID fuer Kontaktanfragen
WEBHOOK_PORT=5000                 # optional, default: 5000
FLASK_DEBUG=false                 # optional, default: false
```

## Starten

```bash
python sofort_antwort_agent.py
```

## Test-Request

```bash
curl -X POST http://localhost:5000/kontakt \
     -H "Content-Type: application/json" \
     -d '{"name": "Max Mustermann", "email": "test@beispiel.de", "nachricht": "Ich suche eine 3-Zimmer-Wohnung in Hamburg."}'
```

## Endpunkte

| Method | Pfad | Beschreibung |
|--------|------|--------------|
| POST | /kontakt | Kontaktanfrage empfangen & beantworten |
| GET | /health | Statuscheck |
