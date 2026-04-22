# Workflow: Reporting-Agent
# Zweck: Täglicher Report über alle Agenten
# Sprache: Python + TypeScript für Trigger.dev

## Trigger
- Cron: täglich um 09:00 Uhr (0 9 * * 1-5)
- Montag bis Freitag

## Datenformat-Verträge
# WICHTIG: Schreibender und lesender Agent müssen identische Formate benutzen.
# Abweichungen führen zu stillen 0-Werten ohne Fehlermeldung.

### Datumsformat
- Immer DD.MM.YYYY mit führender Null: "21.04.2026" nicht "21.4.2026"
- Buchhalter-Outreach schreibt: toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
- Reporting liest: normalizeDatum() normalisiert vor Vergleich als Sicherheitsnetz

### Timestamp-Format
- Sofort-Antwort schreibt: "DD.MM.YYYY HH:MM:SS" (Europe/Berlin)
- Reporting liest ersten 10 Zeichen als Datum: slice(0, 10)

### Zeitzone
- Alle Timestamps: Europe/Berlin
- Cron-Trigger: timezone: "Europe/Berlin"
- Datumsvergleiche: immer mit { timeZone: "Europe/Berlin" }

### Status-Werte (exakte Strings, Großschreibung)
- Buchhalter Outreach: KONTAKTIERT | INTERESSIERT | ABGELEHNT
- Sofort-Antwort: GESENDET | FEHLER

### Env-Variablen
- Google Sheets Auth: GOOGLE_SERVICE_ACCOUNT_JSON (JSON-String, kein Dateipfad)
- Sheet ID: GOOGLE_SHEET_ID
- Tab-Namen: "Buchhalter Outreach" | "Sofort-Antwort" (exakt mit Leerzeichen/Bindestrich)

### Debugging-Regel
# Wenn Agent überall 0 anzeigt: zuerst logger.log({ gestern, ersteDatumImSheet })
# prüfen bevor Code geändert wird.

## Schritt 1: Buchhalter-Outreach Daten lesen
- Tool: tools/read_outreach.py
- Sheet: Buchhalter Outreach
- Lese: Firma, Status, Datum, Reaktionszeit
- Berechne: Anzahl KONTAKTIERT, INTERESSIERT,
  ABGELEHNT, Conversion-Rate

## Schritt 2: Sofort-Antwort Daten lesen
- Tool: tools/read_sofort_antwort.py
- Sheet: Sofort-Antwort
- Lese: Name, Status, Anfrage_Zeit, Antwort_Zeit,
  Reaktionszeit_Min
- Berechne: Durchschnitt Reaktionszeit, schnellste,
  langsamste Antwort

## Schritt 3: Statistiken berechnen
- Tool: tools/calculate_stats.py
- Vergleiche mit Vortag falls Daten vorhanden
- Identifiziere offene Leads (3+ Tage keine Antwort)

## Schritt 4: Report generieren
- Tool: tools/generate_report.py
- Skill: skills/reporting-qualitaet.md
- Format: übersichtliche E-Mail mit Zahlen

## Schritt 5: Report senden
- Tool: tools/send_email.py (bereits vorhanden)
- Empfänger: os.environ.get("REPORT_EMAIL")
- Betreff: "NIO Automation Report – [Datum]"
