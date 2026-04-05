# Prompt: Fehlerbehandlung in sofort_antwort_agent.py

Verbessere die Fehlerbehandlung in `sofort_antwort_agent.py`.

Wenn OpenAI einen Fehler zurueckgibt:
- Sende trotzdem eine Standard-Antwort an den Interessenten
- Standard-Text: "Vielen Dank fuer Ihre Anfrage. Wir melden uns innerhalb von 24 Stunden bei Ihnen."

Wenn Brevo einen Fehler zurueckgibt:
- Logge den Fehler in agent_log.txt
- Benachrichtige den Anwalt per E-Mail dass manuelles Eingreifen noetig ist

Zeige mir den Unterschied bevor du aenderst.

---

## Umgesetzt als (Stand: Tag 26)

### Neue Hilfsfunktion `schreibe_log(eintrag)`
Haengt Eintraege mit Zeitstempel an `agent_log.txt`.

### Neue interne Funktion `_sende_anwalt_brevo_alert()`
Wird bei Brevo-Fehler aufgerufen – informiert `ANWALT_EMAIL` mit Fehlermeldung
und Aufforderung zum manuellen Eingreifen.

### OpenAI-Fehler
- Kein Abbruch mehr (kein 500-Response)
- Fallback-Text wird trotzdem per Brevo gesendet
- Fehler wird in `agent_log.txt` geloggt

### Brevo-Fehler
- Fehler in `agent_log.txt` geloggt
- `_sende_anwalt_brevo_alert()` aufgerufen
- Anwalt erhaelt E-Mail mit Betreff: "FEHLER: E-Mail an [Name] nicht gesendet"
