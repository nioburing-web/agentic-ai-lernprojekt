# Claude Code Prompt – NIO Automation | Version 4 (Final)
# Aktueller Stand: Tag 18 | v1, v2, v3 wurden bereits ausgeführt
# NEU: Alle Feedback-Punkte vom Demo-Gespräch (Tag 17) vollständig eingebaut
# Kopiere alles ab der nächsten Zeile in Claude Code

---

Du bist ein erfahrener Python-Entwickler und arbeitest an meinem
KI-Outreach-Agenten für Immobilien (NIO Automation, nio-automation.de).

## WICHTIG – Lies das zuerst

Die vorherigen Prompts wurden bereits ausgeführt.
Verändere NIEMALS diese bestehenden Funktionen ohne meine Erlaubnis:
- reply_classifier()
- score_lead() / calculate_score()

Deine Aufgabe: Code ERWEITERN, Sheet-Struktur präzise abbilden,
und alle Feedback-Punkte aus der Demo umsetzen.

---

## Kontext & Regeln

- Python 3.11, Windows, VS Code
- OpenAI API: gpt-4o-mini | os.environ.get("OPENAI_API_KEY")
- Brevo: os.environ.get("BREVO_API_KEY") | anfragen@nio-automation.de
- Google Sheets: gspread | os.environ.get("GOOGLE_CREDENTIALS_PATH")
- NIEMALS API-Keys direkt im Code
- NIEMALS .env oder credentials.json auf GitHub
- Alle Print-Ausgaben auf Deutsch
- Korrekte deutsche Groß-/Kleinschreibung

## Pilot-Kunde – Suchkriterien

- Budget: bis 400.000 Euro
- Regionen: Hamburg, Nordsee, Ostsee, Mallorca/Spanien
- Zimmeranzahl: 3 Zimmer (NICHT "Schlafzimmer")
- Wohnfläche: 70–100 qm
- Nur Neubau: Ja
- Ausstattung: große Küche, Keller vorhanden

---

## FEEDBACK VOM KUNDEN – vollständig umgesetzt

Diese Punkte kamen direkt aus der Demo und müssen alle im Code landen:

| # | Feedback                                    | Umsetzung im Code                              |
|---|---------------------------------------------|------------------------------------------------|
| 1 | Groß-/Kleinschreibung                       | E-Mail-Prompt erzwingt korrekte Schreibung     |
| 2 | Kurze Unternehmensvorstellung               | Erster Satz im E-Mail-Prompt                   |
| 3 | Zimmeranzahl statt Schlafzimmer             | Parameter zimmer statt schlafzimmer            |
| 4 | Wohnfläche min/max                          | Parameter wohnflaeche_min / wohnflaeche_max    |
| 5 | Nur Neubau als Ja/Nein                      | Parameter nur_neubau (bool)                    |
| 6 | Antwort mit Datum + Uhrzeit                 | Neue Spalte "Antwort am" im Sheet              |
| 7 | Kategorie mit Terminen (Calendly)           | Neue Spalte "Termin (Calendly)" im Sheet       |
| 8 | Alle E-Mails mit Datum + Uhrzeit gekennz.   | Spalte "Anfrage gesendet am" + "Antwort am"    |

---

## EXAKTE SHEET-STRUKTUREN (bindend)

### Sheet 1: "Bauträger Dashboard"

| Spalte | Header              | Befüllt durch                    | Mögliche Werte                                        |
|--------|---------------------|----------------------------------|-------------------------------------------------------|
| A      | Firma               | bautraeger.csv                   | z.B. "Mustermann GmbH"                                |
| B      | E-Mail              | bautraeger.csv                   | z.B. "info@mustermann.de"                             |
| C      | Region              | bautraeger.csv                   | z.B. "Hamburg"                                        |
| D      | Stadt               | bautraeger.csv                   | z.B. "Hamburg"                                        |
| E      | Score               | score_lead() / calculate_score() | Zahl 0–100                                            |
| F      | Status              | Agent                            | "KONTAKTIERT" / "MANUELL PRÜFEN" / "ÜBERSPRUNGEN"     |
| G      | Anfrage gesendet am | Agent                            | datetime "%Y-%m-%d %H:%M" (beim E-Mail-Versand)       |
| H      | Antwort am          | reply_classifier()               | datetime "%Y-%m-%d %H:%M" (beim Eingang der Antwort)  |
| I      | Antwort-Kategorie   | reply_classifier()               | "Interessiert" / "Nicht interessiert" / "Rückfrage"   |
| J      | Termin (Calendly)   | Manuell / Calendly-Integration   | Datum oder Link, z.B. "2026-04-05 10:00"              |
| K      | Notizen             | Manuell                          | Freitext                                              |

### Sheet 2: "Lead-Qualifier Dashboard"

| Spalte | Header           | Befüllt durch  | Mögliche Werte               |
|--------|------------------|----------------|------------------------------|
| A      | Name             | leads.csv      | z.B. "Max Mustermann"        |
| B      | Firma            | leads.csv      | z.B. "Mustermann GmbH"       |
| C      | Branche          | leads.csv      | z.B. "Immobilien"            |
| D      | Score            | score_lead()   | Zahl 0–100                   |
| E      | Status           | Agent          | "TOP" / "MITTEL" / "NIEDRIG" |
| F      | E-Mail generiert | Agent          | "Ja" / "Nein"                |
| G      | Gesendet am      | Agent          | datetime "%Y-%m-%d %H:%M"    |
| H      | Notizen          | Manuell        | Freitext                     |

---

## SCHRITT 0 – Pflicht: Code analysieren

Bevor du irgendetwas änderst:

1. Öffne `tag15_bautraeger_agent.py` und `agent_komplett.py`
2. Liste alle vorhandenen Funktionen:
   - Name, was sie tut (1 Satz), welche Sheet-Spalten sie befüllt
3. Zeige die aktuellen Header-Zeilen beider Sheets (falls lesbar)

Erst danach weitermachen.

---

## AUFGABE 1 – Sheet-Header-Prüfung für beide Dashboards

```python
from datetime import datetime

# ── BAUTRÄGER DASHBOARD ──────────────────────────────────────────
BAUTRAEGER_HEADERS = [
    "Firma", "E-Mail", "Region", "Stadt", "Score", "Status",
    "Anfrage gesendet am", "Antwort am", "Antwort-Kategorie",
    "Termin (Calendly)", "Notizen"
]

def ensure_bautraeger_headers(sheet):
    """Prueft und ergaenzt Header-Zeile im Bautraeger-Dashboard."""
    try:
        aktuelle = sheet.row_values(1)
    except Exception:
        aktuelle = []

    if not aktuelle:
        sheet.insert_row(BAUTRAEGER_HEADERS, 1)
        print("[INFO] Bautraeger-Dashboard: Header neu erstellt.")
        return

    fehlende = [h for h in BAUTRAEGER_HEADERS if h not in aktuelle]
    if fehlende:
        naechste = len(aktuelle) + 1
        for i, h in enumerate(fehlende):
            sheet.update_cell(1, naechste + i, h)
        print(f"[INFO] Bautraeger-Dashboard: Neue Spalten ergaenzt: {fehlende}")
    else:
        print("[INFO] Bautraeger-Dashboard: Header vollstaendig.")


# ── LEAD-QUALIFIER DASHBOARD ─────────────────────────────────────
LEAD_HEADERS = [
    "Name", "Firma", "Branche", "Score",
    "Status", "E-Mail generiert", "Gesendet am", "Notizen"
]

def ensure_lead_headers(sheet):
    """Prueft und ergaenzt Header-Zeile im Lead-Qualifier-Dashboard."""
    try:
        aktuelle = sheet.row_values(1)
    except Exception:
        aktuelle = []

    if not aktuelle:
        sheet.insert_row(LEAD_HEADERS, 1)
        print("[INFO] Lead-Dashboard: Header neu erstellt.")
        return

    fehlende = [h for h in LEAD_HEADERS if h not in aktuelle]
    if fehlende:
        naechste = len(aktuelle) + 1
        for i, h in enumerate(fehlende):
            sheet.update_cell(1, naechste + i, h)
        print(f"[INFO] Lead-Dashboard: Neue Spalten ergaenzt: {fehlende}")
    else:
        print("[INFO] Lead-Dashboard: Header vollstaendig.")
```

---

## AUFGABE 2 – update_bautraeger_sheet() mit allen 11 Spalten

```python
def update_bautraeger_sheet(sheet, firma: str, email: str, region: str,
                             stadt: str, score: int, status: str,
                             email_subject: str = ""):
    """
    Fuegt eine neue Zeile im Bautraeger-Dashboard ein.
    11 Spalten: A–K wie in BAUTRAEGER_HEADERS definiert.
    Feedback eingebaut: Anfrage gesendet am (G), Antwort am (H, leer),
    Antwort-Kategorie (I, leer), Termin Calendly (J, leer), Notizen (K, leer)
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    zeile = [
        firma,      # A: Firma
        email,      # B: E-Mail
        region,     # C: Region
        stadt,      # D: Stadt
        score,      # E: Score (von score_lead())
        status,     # F: Status
        timestamp,  # G: Anfrage gesendet am ← Feedback Punkt 8
        "",         # H: Antwort am ← Feedback Punkt 6 (wird durch reply_classifier befüllt)
        "",         # I: Antwort-Kategorie (wird durch reply_classifier befüllt)
        "",         # J: Termin (Calendly) ← Feedback Punkt 7
        ""          # K: Notizen
    ]

    try:
        sheet.append_row(zeile)
        print(f"[{timestamp}] Bautraeger eingetragen: {firma} | Score: {score} | {status}")
    except Exception as e:
        print(f"[FEHLER] Bautraeger-Sheet fuer {firma}: {e}")
```

---

## AUFGABE 3 – update_lead_sheet() mit allen 8 Spalten

```python
def update_lead_sheet(sheet, name: str, firma: str, branche: str,
                      score: int, status: str, email_generiert: bool = False):
    """
    Fuegt eine neue Zeile im Lead-Qualifier-Dashboard ein.
    8 Spalten: A–H wie in LEAD_HEADERS definiert.
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    email_generiert_text = "Ja" if email_generiert else "Nein"

    zeile = [
        name,                                          # A: Name
        firma,                                         # B: Firma
        branche,                                       # C: Branche
        score,                                         # D: Score
        status,                                        # E: Status (TOP/MITTEL/NIEDRIG)
        email_generiert_text,                          # F: E-Mail generiert
        timestamp if email_generiert else "",          # G: Gesendet am ← Feedback Punkt 8
        ""                                             # H: Notizen
    ]

    try:
        sheet.append_row(zeile)
        print(f"[{timestamp}] Lead eingetragen: {name} | {firma} | Score: {score} | {status}")
    except Exception as e:
        print(f"[FEHLER] Lead-Sheet fuer {name}: {e}")
```

---

## AUFGABE 4 – Reply-Classifier mit Bauträger-Sheet verknüpfen

Schreibe `verarbeite_bautraeger_antwort()` die den bestehenden
`reply_classifier()` aufruft und danach Spalten H + I im Sheet aktualisiert:

```python
def verarbeite_bautraeger_antwort(sheet, firma: str, antwort_text: str):
    """
    Klassifiziert eine Bautraeger-Antwort und aktualisiert das Sheet.
    Nutzt reply_classifier() – wird NICHT veraendert.

    Aktualisiert:
    - Spalte H (Antwort am): Zeitstempel ← Feedback Punkt 6
    - Spalte I (Antwort-Kategorie): Klassifikation durch reply_classifier()
    - Spalte F (Status): wird auf "GEANTWORTET" gesetzt
    """
    # Bestehenden Reply-Classifier aufrufen – NICHT veraendern
    kategorie = reply_classifier(antwort_text)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    try:
        treffer = sheet.findall(firma)
        if treffer:
            zeile_nr = treffer[-1].row
            sheet.update_cell(zeile_nr, 8, timestamp)       # H: Antwort am
            sheet.update_cell(zeile_nr, 9, kategorie)       # I: Antwort-Kategorie
            sheet.update_cell(zeile_nr, 6, "GEANTWORTET")   # F: Status
            print(f"[{timestamp}] Antwort klassifiziert: {firma} → {kategorie}")
        else:
            print(f"[WARNUNG] Firma nicht im Sheet gefunden: {firma}")
    except Exception as e:
        print(f"[FEHLER] Antwort-Update fuer {firma}: {e}")

    return kategorie
```

---

## AUFGABE 5 – E-Mail-Prompt mit allen Feedback-Punkten

Finde `generate_email()` und ersetze NUR den Prompt-String.
Behalte Funktionsstruktur, Parameter und Return-Wert.

Erweitere Parameter falls nötig:

```python
def generate_email(
    bautraeger_name: str,
    region: str,
    zimmer: int = 3,                  # Feedback: Zimmeranzahl statt Schlafzimmer
    wohnflaeche_min: int = 70,        # Feedback: Wohnfläche min
    wohnflaeche_max: int = 100,       # Feedback: Wohnfläche max
    budget: int = 400000,
    nur_neubau: bool = True           # Feedback: Nur Neubau als Ja/Nein
) -> dict:
```

Der neue Prompt-String:

```python
    neubau_text = "ausschließlich Neubauprojekte" if nur_neubau else "Neubau oder Bestand"

    prompt = f"""Schreibe eine professionelle Anfrage-E-Mail an den Bautraeger
"{bautraeger_name}" in der Region {region}.

STRUKTUR:
1. Anrede: "Sehr geehrtes Team von {bautraeger_name},"
2. Erster Satz – Unternehmensvorstellung:
   "NIO Automation ist ein KI-gestuetzter Immobilien-Suchservice, der
   qualifizierte Kaufinteressenten direkt mit passenden Bautraegern verbindet."
3. Suchkriterien des Kunden (alle nennen):
   - Region: {region}
   - Budget: bis {budget:,} Euro
   - Zimmeranzahl: {zimmer} Zimmer
   - Wohnflaeche: {wohnflaeche_min}–{wohnflaeche_max} qm
   - Objekttyp: {neubau_text}
   - Ausstattung: Grosse Kueche und Keller vorhanden
4. Bitte um Rueckmeldung innerhalb von 5 Werktagen
5. Signatur: NIO Automation | anfragen@nio-automation.de | nio-automation.de

PFLICHTREGELN:
- Korrekte deutsche Gross- und Kleinschreibung
- Region IMMER grossschreiben (Hamburg, Nordsee, Ostsee, Mallorca)
- KEIN "Sehr geehrte Damen und Herren"
- Maximal 160 Woerter
- Professioneller aber persoenlicher Ton

FORMAT – gib NUR das zurueck:
BETREFF: [Betreff hier]

[E-Mail Text hier]"""
```

---

## AUFGABE 6 – Test-Modus

Falls `--test` Flag noch nicht vorhanden:

```python
import sys
TEST_MODUS = "--test" in sys.argv

if TEST_MODUS:
    print("=" * 55)
    print("[TEST-MODUS] Keine E-Mails werden gesendet!")
    print("[TEST-MODUS] Sheets werden nicht aktualisiert.")
    print("=" * 55)
```

Im Test-Modus nur: E-Mail generieren + im Terminal anzeigen.

---

## AUFGABE 7 – Testlauf

```bash
python tag15_bautraeger_agent.py --test
```

Zeige mir:
1. Erster Bauträger aus CSV (Name, Region, Score)
2. Generierte E-Mail (Betreff + Body)
3. Was in Zeile 1 des Sheets stehen würde (alle 11 Spalten)

---

## AUFGABE 8 – GitHub Commit

```bash
git add tag15_bautraeger_agent.py agent_komplett.py bautraeger.csv .gitignore
git commit -m "Tag 18 v4: Alle Demo-Feedback-Punkte umgesetzt – Timestamps, Calendly-Spalte, Reply-Classifier verknuepft, E-Mail-Prompt verbessert"
git push origin master
```

---

## Vollständige Übersicht – Was sich ändert vs. was bleibt

| Funktion / Feature              | Aktion       | Feedback-Punkt           |
|---------------------------------|--------------|--------------------------|
| reply_classifier()              | BEHALTEN     | –                        |
| score_lead() / calculate_score()| BEHALTEN     | –                        |
| update_bautraeger_sheet()       | ERWEITERN    | Punkte 6, 7, 8           |
| update_lead_sheet()             | ERWEITERN    | Punkt 8                  |
| ensure_bautraeger_headers()     | NEU          | Automatische Prüfung     |
| ensure_lead_headers()           | NEU          | Automatische Prüfung     |
| verarbeite_bautraeger_antwort() | NEU          | Punkte 6 + Classifier    |
| generate_email() Prompt         | NUR TEXT NEU | Punkte 1, 2, 3, 4, 5     |
| Spalte H "Antwort am"           | NEU im Sheet | Punkt 6                  |
| Spalte J "Termin (Calendly)"    | NEU im Sheet | Punkt 7                  |
| Test-Modus --test               | NEU          | Sicherer Testlauf        |

---

Starte mit Schritt 0 (Code lesen und anzeigen).
Danach Aufgaben 1–8 der Reihe nach.
Zeige nach jeder Aufgabe was geändert wurde.
Verändere reply_classifier() und score_lead() NIEMALS ohne meine Erlaubnis.
