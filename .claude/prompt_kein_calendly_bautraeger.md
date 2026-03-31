In tag12_reply_classifier.py gibt es eine Funktion die bei INTERESSE 
automatisch einen Calendly-Link sendet.

Aendere das Verhalten bei INTERESSE folgendermassen:

VORHER: Automatisch Calendly-Link per Brevo senden

NACHHER: 
1. Sheet aktualisieren – Spalte F auf INTERESSIERT setzen
2. Spalte H mit aktuellem Datum und Uhrzeit befuellen
3. Benachrichtigungs-E-Mail an os.environ.get("REPLY_EMAIL") senden mit:
   - Betreff: "Bautraeger hat Interesse – manuelle Aktion noetig"
   - Text: Name der Firma, ihre Antwort, und der Hinweis 
     "Bitte manuell pruefen und bei Interesse Termin vereinbaren"
4. KEINEN Calendly-Link automatisch senden

Begruendung: Bei Bautraegern ist kein automatischer Termin sinnvoll.
Der Kunde prueft die Antwort zuerst manuell bevor ein Termin gebucht wird.

Alle Werte aus os.environ.get() – nichts direkt im Code.
Zeige mir den Unterschied bevor du die Aenderung machst.