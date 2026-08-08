# Workflow: Aktions-Agent
# Zweck: Tägliche Aktions-E-Mail für Nio
# Trigger: Cron täglich 08:30 Mo-Fr Europe/Berlin

## Schritt 1: Google Sheet lesen
- Lese Tab "Buchhalter Outreach" (Spalten A:F)
- Spalten: Firma | Stadt | Status | Datum | Uhrzeit | Betreff
- Finde alle INTERESSIERT-Einträge
- Finde alle RÜCKFRAGE-Einträge
- Finde alle KONTAKTIERT-Einträge mit Datum >= 3 Tage alt
- Zähle KONTAKTIERT-Einträge von gestern

## Schritt 2: Aktionsliste generieren
- Priorisiere: INTERESSIERT > RÜCKFRAGE > OFFEN (3+ Tage)
- Maximal 5 Aktionen gesamt (SOFORT + IM AUGE zusammen)
- Restliche Slots für IM AUGE = 5 minus Anzahl SOFORT-Einträge
- GESTERN ist immer nur eine Zahl – zählt nicht zu den 5 Aktionen

## Schritt 3: E-Mail senden
- An: process.env.REPORT_EMAIL
- Von: process.env.ABSENDER_EMAIL
- Betreff: "NIO Automation – Was heute zu tun ist"
- Via: Brevo transactional API
- Struktur:

  --- SOFORT: INTERESSIERT & RÜCKFRAGE ---
  [bis zu 5 Einträge, INTERESSIERT zuerst]

  --- IM AUGE: Offen seit 3+ Tagen ---
  [restliche Slots bis max 5 gesamt, älteste zuerst]

  --- GESTERN: Gesendete E-Mails ---
  [Anzahl]

## Env-Variablen
- GOOGLE_SHEET_ID
- GOOGLE_SERVICE_ACCOUNT_JSON
- REPORT_EMAIL
- ABSENDER_EMAIL
- ABSENDER_NAME
- BREVO_API_KEY
