# Prompt: Bessere Antwort-E-Mail in sofort_antwort_agent.py

Verbessere den OpenAI-Prompt in `sofort_antwort_agent.py` der die Antwort-E-Mail generiert.

Die Antwort soll:
- Den Namen der Person verwenden (Vorname, direkte Ansprache)
- Das konkrete Anliegen in einem Satz zusammenfassen
- Einen klaren naechsten Schritt vorschlagen ("Ich wuerde gerne einen kurzen Telefontermin vereinbaren")
- Einen Calendly-Link einbauen: `os.environ.get("CALENDLY_LINK")`
- Maximal 5 Saetze lang sein
- Professionell aber persoenlich klingen

Zeige mir den Unterschied bevor du aenderst.

---

## Umgesetzter Prompt (Stand: Tag 26)

```python
calendly_link = os.environ.get("CALENDLY_LINK", "")

prompt = f"""Du bist ein professioneller Kundenberater fuer {absender_name}.
Du hast folgende Kontaktanfrage erhalten:

Name: {name}
Nachricht: {nachricht}

Schreibe eine Antwort-E-Mail auf Deutsch mit genau diesen Vorgaben:
- Sprich {name} direkt mit Vornamen an
- Fasse das konkrete Anliegen in einem Satz zusammen
- Schlage vor: "Ich wuerde gerne einen kurzen Telefontermin vereinbaren"
- Fuege den Calendly-Link ein: {calendly_link}
- Maximal 5 Saetze gesamt
- Professionell aber persoenlich

Schreibe NUR den E-Mail-Text ohne Betreff und ohne Abschiedsformel.
Die Signatur wird separat angehaengt."""
```

## Aenderungen gegenueber vorher
- `CALENDLY_LINK` aus `.env` eingebaut
- Explizite 5-Satz-Begrenzung
- Konkrete Formulierung statt vage Anweisung
- `max_tokens` von 300 auf 250 reduziert
