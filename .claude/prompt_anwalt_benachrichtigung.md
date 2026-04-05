# Prompt: Anwalt-Benachrichtigung in sofort_antwort_agent.py

Fuege in `sofort_antwort_agent.py` eine zweite E-Mail ein,
die an den Anwalt geht wenn jemand das Formular ausfuellt.

Diese E-Mail soll an `os.environ.get("ANWALT_EMAIL")` gehen und folgendes enthalten:
- Betreff: "Neue Anfrage von [Name]"
- Name und E-Mail des Interessenten
- Das Anliegen in Kurzform (max. 200 Zeichen)
- Datum und Uhrzeit der Anfrage
- Hinweis: "Automatische Antwort wurde bereits gesendet"

`ANWALT_EMAIL` in `.env` eintragen.
Zeige mir den Unterschied bevor du aenderst.

---

## Umgesetzt als (Stand: Tag 26)

Neue Funktion `sende_anwalt_benachrichtigung()` nach `sende_antwort_email()`.
Im Webhook als Schritt 3 eingefuegt (Sheet-Eintrag wurde zu Schritt 4).

### Benoetigte .env-Variable
```
ANWALT_EMAIL=anwalt@beispiel.de
```

### E-Mail-Inhalt
```
Neue Kontaktanfrage eingegangen:

Name:    [Name]
E-Mail:  [E-Mail]
Datum:   [TT.MM.JJJJ]
Uhrzeit: [HH:MM:SS]

Anliegen:
[erste 200 Zeichen der Nachricht]

---
Automatische Antwort wurde bereits an [E-Mail] gesendet.
```
