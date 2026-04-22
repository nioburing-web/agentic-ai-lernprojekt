# Workflow: Reply-Classifier
# Zweck: Klassifiziert Antworten auf Buchhalter-Outreach
# Migration von: n8n
# Neue Platform: Trigger.dev

## Trigger
- Cron: täglich um 10:00 Uhr (0 10 * * 1-5)
- Montag bis Freitag

## Schritt 1: Gmail lesen
- Lese alle ungelesenen E-Mails mit Betreff "Re:"
- Filter: Antworten auf KI-Agent E-Mails
- Maximal 50 E-Mails pro Durchlauf

## Schritt 2: Klassifizieren
- OpenAI gpt-4o-mini liest E-Mail Text
- Klassifiziert in: INTERESSIERT / ABGELEHNT /
  RÜCKFRAGE / ABWESEND
- Skill: skills/klassifizierung.md

## Schritt 3: Google Sheet updaten
- Finde die Firma im Sheet "Buchhalter Outreach"
- Update Status-Spalte mit neuem Wert
- Update Notizen-Spalte mit kurzem Grund

## Schritt 4: E-Mail als gelesen markieren
- Markiere verarbeitete E-Mails als gelesen
- Verhindert doppelte Verarbeitung

## Fehlerbehandlung
- Fehler loggen aber nie abstürzen
- Bei Unsicherheit: Status RÜCKFRAGE setzen
