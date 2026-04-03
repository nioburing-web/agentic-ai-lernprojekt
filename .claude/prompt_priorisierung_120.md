# Claude Code Prompt – prompt_priorisierung_120.md
In tag15_bautraeger_agent.py habe ich 120 Leads in bautraeger.csv.


Stelle sicher dass der Agent folgendes macht:


1. Beim Start ausgeben:
   "Gesamt: X Leads | Noch nicht kontaktiert: Y | Heute max: Z"


2. NUR Leads verarbeiten die in der Spalte "email_gesendet"
   keinen Eintrag haben oder leer sind.


3. Wenn alle Leads bereits kontaktiert wurden:
   "Alle X Leads wurden bereits kontaktiert. Nichts zu tun."
   Und das Programm sauber beenden.


4. Nach jedem gesendeten Tag ausgeben:
   "Fortschritt: X von Y Leads kontaktiert (Z% abgeschlossen)"


Zeige mir den Unterschied bevor du die Aenderung machst.
Alle Werte aus os.environ.get().

In dashboard.py soll eine neue Funktion eingebaut werden:
Ein Toggle ob die Maps-Recherche beim Start mitlaufen soll oder nicht.

── TOGGLE: AKTIVIERT = KEINE MAPS RECHERCHE ──
Wenn Toggle aktiviert ist: main.py überspringt Schritt 1
  Schritt 1: ÜBERSPRUNGEN
  Schritt 2: tag15_bautraeger_agent.py (E-Mails senden)
  Schritt 3: tag12_reply_classifier.py (Antworten klassifizieren)

── TOGGLE: DEAKTIVIERT = MIT MAPS RECHERCHE ──
Wenn Toggle deaktiviert ist: main.py läuft komplett durch
  Schritt 1: maps_recherche.py (neue Bauträger suchen)
  Schritt 2: tag15_bautraeger_agent.py (E-Mails senden)
  Schritt 3: tag12_reply_classifier.py (Antworten klassifizieren)

So soll es im Dashboard aussehen:
  st.toggle("⏭️ Maps-Recherche überspringen", value=True)

Wenn Toggle aktiviert ist soll ein Hinweis erscheinen:
  st.info("Maps-Recherche übersprungen – Agent arbeitet nur mit bestehenden Leads")

Wenn Toggle deaktiviert ist soll ein Hinweis erscheinen:
  st.warning("Maps-Recherche aktiv – neue Bauträger werden gesucht")

In main.py soll ein Parameter ergänzt werden:
  python main.py --ohne-maps

Wenn dieser Parameter gesetzt ist wird Schritt 1 übersprungen.
Das Dashboard übergibt diesen Parameter automatisch wenn Toggle aktiviert.

Alle Werte aus os.environ.get() – nichts direkt im Code.
Zeige mir den Unterschied bevor du die Aenderung machst.
