# Workflow: Buchhalter-Outreach
# Zweck: Kontaktiert Steuerberater/Buchhalter automatisch per E-Mail
# Platform: Trigger.dev (TypeScript)
# Datei: src/trigger/buchhalter-outreach.ts

## Trigger
- Cron: Mo–Fr 08:00 Europe/Berlin (= 06:00 UTC: "0 6 * * 1-5")

## Konfiguration (Env-Variablen)
- ZIELBRANCHE (Standard: "Steuerberater")
- ZIELSTADT (Standard: "Hamburg")
- MAX_EMAILS_PRO_TAG (Standard: 10)

## Schritt 1: Firmen via Google Maps suchen
- Tool: Google Places Text Search API
- Query: "{ZIELBRANCHE} {ZIELSTADT}"
- Maximal 20 Ergebnisse pro Anfrage
- Rückgabe: name, formatted_address

## Schritt 2: Google Sheets laden
- Tab: "Buchhalter Outreach"
- Spalten: A=Firma | B=Stadt | C=Status | D=Datum | E=Uhrzeit | F=Betreff
- Bereits kontaktierte Firmen: Set aus Spalte A (lowercased)
- Tageslimit prüfen: KONTAKTIERT + Datum == heute → heuteKontaktiert

## Schritt 3: E-Mail generieren (OpenAI)
- Modell: gpt-4o-mini
- Skill: skills/email-qualitaet-outreach.md
- Betreff: "KI-Agent für neue Mandanten – {Firmenname}"

## Schritt 4: E-Mail senden (Brevo)
- Endpoint: https://api.brevo.com/v3/smtp/email
- Absender: ABSENDER_EMAIL (Name: "NIO Automation")
- Reply-To: REPLY_TO_EMAIL
- Empfänger: TEST_EMAIL (Testmodus – keine echten Firmenadressen)
- Signatur: wird separat angehängt (nicht im generierten Text)

## Schritt 5: Tracking in Google Sheets
- Neue Zeile: [Firma, Stadt, "KONTAKTIERT", Datum, Uhrzeit, Betreff]
- Datum-Format: DD.MM.YYYY (toLocaleDateString mit day:"2-digit", month:"2-digit")
- Zeitzone: Europe/Berlin

## Dedup-Logik
- Firmenname lowercased → Set → skip wenn bereits vorhanden
- Tageslimit: stoppt wenn heuteKontaktiert >= MAX_EMAILS_PRO_TAG

## Rate-Limiting
- 5 Sekunden Pause zwischen E-Mail-Versand (Brevo Limit)

## Fehlerbehandlung
- Google Maps Fehler → kompletter Stop
- OpenAI Fehler für einzelne Firma → nächste Firma (continue)
- Brevo Fehler → nächste Firma (continue)
- Sheets Tracking Fehler → loggen, weiter (E-Mail gilt als gesendet)

## Datenformat-Verträge
- Datum schreibt: toLocaleDateString("de-DE", { day:"2-digit", month:"2-digit", year:"numeric" }) → "21.04.2026"
- Zeitzone: immer { timeZone: "Europe/Berlin" }
- Status-Werte (exakt): KONTAKTIERT | INTERESSIERT | ABGELEHNT

## Env-Variablen (vollständige Liste)
- OPENAI_API_KEY
- GOOGLE_SERVICE_ACCOUNT_JSON (JSON-String, kein Dateipfad)
- GOOGLE_SHEET_ID
- GOOGLE_MAPS_API_KEY
- BREVO_API_KEY
- ABSENDER_EMAIL
- REPLY_TO_EMAIL
- TEST_EMAIL
- ZIELBRANCHE
- ZIELSTADT
- MAX_EMAILS_PRO_TAG
