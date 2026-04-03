In dashboard.py soll eine neue Funktion eingebaut werden:
Ein Toggle ob die Maps-Recherche beim Start mitlaufen soll oder nicht.

── TOGGLE: MIT MAPS RECHERCHE ──
Wenn aktiviert: main.py läuft komplett durch
  Schritt 1: maps_recherche.py (neue Bauträger suchen)
  Schritt 2: tag15_bautraeger_agent.py (E-Mails senden)
  Schritt 3: tag12_reply_classifier.py (Antworten klassifizieren)

── TOGGLE: OHNE MAPS RECHERCHE ──
Wenn deaktiviert: main.py überspringt Schritt 1
  Schritt 1: ÜBERSPRUNGEN
  Schritt 2: tag15_bautraeger_agent.py (E-Mails senden)
  Schritt 3: tag12_reply_classifier.py (Antworten klassifizieren)

So soll es im Dashboard aussehen:
  st.toggle("🗺️ Maps-Recherche einschließen", value=True)

Wenn Toggle aus ist soll ein Hinweis erscheinen:
  st.info("Maps-Recherche deaktiviert – Agent arbeitet nur mit bestehenden Leads")

In main.py soll ein Parameter ergänzt werden:
  python main.py --ohne-maps
  
Wenn dieser Parameter gesetzt ist wird Schritt 1 übersprungen.

Alle Werte aus os.environ.get() – nichts direkt im Code.
Zeige mir den Unterschied bevor du die Aenderung machst.