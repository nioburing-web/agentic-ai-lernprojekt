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

