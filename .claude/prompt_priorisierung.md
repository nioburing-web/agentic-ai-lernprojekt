In tag15_bautraeger_agent.py soll der Agent nur Bautraeger 
verarbeiten die noch NICHT kontaktiert wurden.

Filtere die bautraeger.csv am Anfang des Loops:
- Lade alle Zeilen
- Filtere alle raus die in Spalte F bereits einen Status haben
  (KONTAKTIERT, ABGELEHNT, ABWESEND, INTERESSIERT)
- Verarbeite nur die verbleibenden – maximal MAX_EMAILS_PRO_TAG

Gib am Anfang aus:
"X Bautraeger noch nicht kontaktiert – sende heute max Y E-Mails"

Zeige mir den Unterschied bevor du die Aenderung machst.