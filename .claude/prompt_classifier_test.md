# Claude Code Prompt – prompt_classifier_test.md
Erstelle eine Testdatei test_classifier.py die den
tag12_reply_classifier.py mit 6 verschiedenen Testfällen testet.


Testfälle:
1. "Ja, das klingt interessant. Schicken Sie mir mehr Infos."
   → Erwartet: INTERESSIERT


2. "Bitte schreiben Sie mich nicht nochmal an."
   → Erwartet: ABGELEHNT


3. "Was genau kostet das und wie lange dauert die Umsetzung?"
   → Erwartet: RÜCKFRAGE


4. "Ich bin bis 15. April im Urlaub."
   → Erwartet: ABWESEND


5. "Wir haben aktuell keine passenden Objekte."
   → Erwartet: ABGELEHNT


6. "Sehr interessant! Hätten Sie Zeit für ein kurzes Gespräch?"
   → Erwartet: INTERESSIERT


Das Skript soll alle 6 Tests durchlaufen und am Ende ausgeben:
"X von 6 Tests bestanden"


Falls ein Test fehlschlägt: Zeige erwartet vs. tatsächlich.
Alle Werte aus os.environ.get().

