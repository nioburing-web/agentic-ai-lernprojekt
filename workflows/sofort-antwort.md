# Workflow: Sofort-Antwort-Agent
# Zweck: Kontaktformular-Anfragen in 3 Minuten beantworten
# Sprache: TypeScript (Trigger.dev Cloud)
# Deployment: src/trigger/sofort-antwort.ts

## Trigger
- Trigger.dev Task-ID: sofort-antwort
- Input: name, email, message, company (optional)

## Schritt 1: Anfrage analysieren
- Funktion: analysiereAnfrage()
- OpenAI gpt-4o-mini klassifiziert: BUCHHALTUNG/BERATUNG/TERMIN/SONSTIGES
- Key: process.env.OPENAI_API_KEY

## Schritt 2: Antwort generieren
- Funktion: generiereAntwort()
- Skill beachten: skills/email-qualitaet.md
- Max 4 Sätze, Deutsch, professionell
- Key: process.env.OPENAI_API_KEY

## Schritt 3: E-Mail senden
- Funktion: sendeEmail()
- Via Brevo API (axios POST)
- Reply-To: process.env.REPLY_TO_EMAIL || process.env.REPLY_EMAIL
- Key: process.env.BREVO_API_KEY

## Schritt 4: Tracking
- Funktion: trackeAnfrage()
- Sheet: Sofort-Antwort (Tab-Name)
- Spalten: Name, Email, Anliegen, Kategorie, Status, Anfrage_Zeit, Antwort_Zeit, Reaktionszeit_Min
- Zeitformat: DD.MM.YYYY HH:MM:SS (Europe/Berlin)
- Keys: process.env.GOOGLE_SHEET_ID, process.env.GOOGLE_SERVICE_ACCOUNT_JSON

## Timestamps
- Anfrage_Zeit: new Date() bei Task-Start (Webhook-Eingang)
- Antwort_Zeit: new Date() nach E-Mail-Versand (Schritt 3)
- Reaktionszeit_Min: (Antwort_Zeit - Anfrage_Zeit) in Minuten, 2 Dezimalstellen

## Fehlerbehandlung
- Jeder Schritt in eigenem try/catch
- Fehler mit logger.error() loggen, nie abstürzen
- Fallback-Kategorie: SONSTIGES
- Fallback-Antwort: Generischer Text

## Google Sheets Header (manuell setzen)
Name | Email | Anliegen | Kategorie | Status | Anfrage_Zeit | Antwort_Zeit | Reaktionszeit_Min
