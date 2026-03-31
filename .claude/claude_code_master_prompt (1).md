# Claude Code Master Prompt – NIO Automation Bauträger-Agent
# Kopiere alles zwischen den Trennlinien in Claude Code

---

Du bist ein erfahrener Python-Entwickler und hilfst mir, meinen KI-gestützten
Immobilien-Outreach-Agenten vollständig aufzubauen und zu verbessern.

## Projektkontext

Ich baue ein AI-Outreach-Business namens NIO Automation (nio-automation.de).
Der Agent kontaktiert automatisch Bauträger per E-Mail im Auftrag eines Kunden,
der eine Neubauwohnung sucht.

**Technischer Stack:**
- Python 3.11, Windows PC, VS Code
- OpenAI API (gpt-4o-mini)
- Brevo API für E-Mail-Versand (anfragen@nio-automation.de)
- Google Sheets API (gspread) für Kunden-Dashboard
- GitHub: nioburing-web/agentic-ai-lernprojekt (Branch: master)
- Alle API-Keys NUR über os.environ.get() aus .env – NIEMALS direkt im Code

**Pilot-Kunde (mein Vater) – Suchkriterien:**
- Budget: bis 400.000 Euro
- Regionen: Hamburg, Nordsee, Ostsee, Mallorca
- Zimmeranzahl: 3 Zimmer
- Wohnfläche: 70–100 qm
- Nur Neubau: Ja
- Ausstattung: große Küche, Keller vorhanden

---

## Was du jetzt tun sollst

Bitte führe ALLE folgenden Aufgaben nacheinander aus.
Frage nicht – handle direkt. Zeige mir den fertigen Code.

---

### AUFGABE 1 – E-Mail-Generierung verbessern

Öffne `tag15_bautraeger_agent.py` und ersetze die `generate_email()`-Funktion
durch diese verbesserte Version:

**Anforderungen an die neue Funktion:**
- Korrekte deutsche Groß- und Kleinschreibung im generierten Text
- Kurze Unternehmensvorstellung am Anfang (1 Satz):
  "NIO Automation ist ein KI-gestützter Immobilien-Suchservice, der qualifizierte
  Kaufinteressenten mit passenden Bauträgern verbindet."
- Persönliche Anrede mit dem Bauträgernamen aus der CSV
- Alle Suchkriterien klar nennen (Zimmeranzahl, Wohnfläche, Budget, Neubau, Ausstattung)
- Call-to-Action: Rückmeldung innerhalb von 5 Werktagen erbitten
- Maximale Länge: 150 Wörter
- Professionelle Signatur: "NIO Automation | anfragen@nio-automation.de | nio-automation.de"
- Betreff-Format zurückgeben: "BETREFF: [Betreff]\n\n[E-Mail Text]"
- Funktion gibt dict zurück: {"subject": ..., "body": ...}
- Nutze: os.environ.get("OPENAI_API_KEY"), Modell: gpt-4o-mini, temperature=0.7

---

### AUFGABE 2 – bautraeger.csv erweitern

Öffne `bautraeger.csv` und ergänze folgende neue Spalten,
falls sie noch nicht vorhanden sind:

| Spaltenname      | Typ    | Beispielwert | Beschreibung                    |
|------------------|--------|--------------|---------------------------------|
| zimmer_min       | int    | 3            | Mindestanzahl Zimmer            |
| zimmer_max       | int    | 4            | Maximale Zimmeranzahl           |
| wohnflaeche_min  | int    | 70           | Mindestfläche in qm             |
| wohnflaeche_max  | int    | 100          | Maximalfläche in qm             |
| nur_neubau       | bool   | True         | Nur Neubauten anfragen          |

Befülle alle bestehenden Zeilen mit sinnvollen Standardwerten (s.o.).

---

### AUFGABE 3 – Google Sheet mit Timestamps

Öffne `tag15_bautraeger_agent.py` und ersetze die Sheet-Update-Funktion durch:

**Anforderungen:**
- Importiere `from datetime import datetime` oben in der Datei
- Timestamp-Format: "%Y-%m-%d %H:%M"
- Neue Spaltenstruktur im Sheet:
  1. bautraeger_name
  2. region
  3. status
  4. email_subject
  5. email_gesendet_am  ← datetime.now() beim Senden
  6. antwort_erhalten_am  ← leer, wird später befüllt
  7. termin_calendly  ← leer, für Calendly-Termine
  8. notizen  ← leer
- Print-Ausgabe nach jedem Update: "[TIMESTAMP] Sheet aktualisiert: BAUTRAEGER_NAME"

---

### AUFGABE 4 – Suchkriterien in den E-Mail-Prompt einbauen

Stelle sicher, dass `generate_email()` die neuen CSV-Felder nutzt:
- zimmer_min / zimmer_max aus der Zeile des Bauträgers
- wohnflaeche_min / wohnflaeche_max aus der Zeile des Bauträgers
- nur_neubau als "Ja" oder "Nein" im Prompt

Übergabe-Signatur der Funktion:
```python
def generate_email(bautraeger_name: str, region: str,
                   zimmer_min: int = 3, zimmer_max: int = 4,
                   wohnflaeche_min: int = 70, wohnflaeche_max: int = 100,
                   nur_neubau: bool = True) -> dict:
```

---

### AUFGABE 5 – Testlauf

Führe nach allen Änderungen einen vollständigen Testlauf durch:

```bash
python tag15_bautraeger_agent.py
```

- Nutze den ersten Bauträger aus bautraeger.csv als Test
- Zeige mir die generierte E-Mail im Terminal (subject + body)
- Zeige mir die Google Sheet Ausgabe (Zeile + Timestamp)
- Sende die E-Mail NICHT wirklich – nur wenn ich explizit sage "jetzt senden"

---

### AUFGABE 6 – Code-Qualität prüfen

Prüfe die gesamte Datei `tag15_bautraeger_agent.py` auf:
- Keine API-Keys direkt im Code (alles über os.environ.get())
- Keine credentials.json im Code erwähnt (nur Pfad über .env)
- Korrekte deutsche Groß-/Kleinschreibung in allen Strings
- Sinnvolle Print-Ausgaben für jeden Schritt (Logging)
- Fehlerbehandlung: try/except um API-Calls

Zeige mir eine Zusammenfassung was du geändert hast.

---

### AUFGABE 7 – GitHub Commit vorbereiten

Erstelle am Ende folgenden Git-Commit:

```bash
git add tag15_bautraeger_agent.py bautraeger.csv
git commit -m "Tag 18: E-Mail verbessert, Suchkriterien erweitert, Sheet Timestamps, Fehlerbehandlung"
git push origin master
```

Führe diese Befehle aus und zeige mir die Ausgabe.

---

## Wichtige Regeln für dieses Projekt

1. NIEMALS API-Keys direkt im Code – immer os.environ.get()
2. NIEMALS credentials.json auf GitHub pushen
3. NIEMALS .env auf GitHub pushen
4. Alle Variablen auf Deutsch kommentieren
5. Print-Ausgaben auf Deutsch
6. Korrekte deutsche Groß- und Kleinschreibung in allen generierten Texten
7. Nach jeder Aufgabe kurze Bestätigung was gemacht wurde

---

## Dateistruktur zur Orientierung

```
agentic-ai-lernprojekt/
├── tag15_bautraeger_agent.py   ← Haupt-Agent (hier arbeiten wir)
├── bautraeger.csv              ← Bauträger-Liste
├── agent_komplett.py           ← Referenz-Agent
├── .env                        ← API-Keys (NICHT auf GitHub)
├── credentials.json            ← Google Service Account (NICHT auf GitHub)
└── .gitignore                  ← muss .env und credentials.json enthalten
```

---

Starte jetzt mit Aufgabe 1 und arbeite dich durch bis Aufgabe 7.
Zeige mir nach jeder Aufgabe den fertigen Code-Abschnitt.
