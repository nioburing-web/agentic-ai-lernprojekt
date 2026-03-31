# Claude Code Prompt – prompt_streamlit_app.md
Erstelle eine neue Datei dashboard.py mit einer Streamlit-App
fuer den Bautraeger-Agenten.


Die App soll folgende Bereiche haben:


── BEREICH 1: SUCHKRITERIEN ──
st.header("Suchkriterien")
- Eingabefeld: Budget (Zahl, Standard: 400000)
- Eingabefeld: Zimmeranzahl (Zahl, Standard: 3)
- Eingabefeld: Wohnflaeche min qm (Zahl, Standard: 70)
- Eingabefeld: Wohnflaeche max qm (Zahl, Standard: 100)
- Checkboxen fuer Regionen: Hamburg, Nordsee, Ostsee, Mallorca
- Checkbox: Nur Neubau (Standard: True)


── BEREICH 2: AGENT STEUERN ──
st.header("Agent steuern")
- Toggle: Test-Modus (Standard: True)
- Eingabefeld: Max E-Mails pro Tag (Standard: 10)
- Button: "Agent starten"
- Wenn Button gedrueckt: main.py ausfuehren und Output anzeigen


── BEREICH 3: ERGEBNISSE ──
st.header("Ergebnisse")
- Tabelle mit bautraeger.csv Inhalt anzeigen
- Farbe: KONTAKTIERT = gruen, ABGELEHNT = rot, offen = grau


Alle Werte aus os.environ.get() – nichts direkt im Code.
Keine Passwoerter oder API-Keys in der App anzeigen.

