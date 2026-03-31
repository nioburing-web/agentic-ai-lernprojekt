"""
tag12_reply_classifier.py – Klassifiziert Bautraeger-Antworten.

Kann unabhaengig gestartet werden:
    python tag12_reply_classifier.py

Oder importiert werden:
    from tag12_reply_classifier import klassifiziere_antwort
"""

from dotenv import load_dotenv
import os
import time
import requests
from openai import OpenAI

load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

GUELTIGE_KATEGORIEN = {"INTERESSE", "ABLEHNUNG", "FRAGE", "ABWESENHEIT"}


# ── Calendly-Antwort senden ───────────────────
def sende_calendly_antwort(empfaenger_email: str, bautraeger_name: str) -> bool:
    """
    Sendet automatisch eine Antwort-E-Mail mit Calendly-Link
    wenn klassifiziere_antwort() -> 'INTERESSE' zurueckgibt.
    Versand ueber Brevo.
    """
    calendly_link = os.environ.get("CALENDLY_LINK", "")
    inhalt = (
        f"Sehr geehrtes Team von {bautraeger_name},\n\n"
        f"vielen Dank fuer Ihre Rueckmeldung – das freut mich sehr!\n\n"
        f"Ich wuerde mich gerne kurz mit Ihnen austauschen und mehr ueber "
        f"Ihre aktuellen Projekte erfahren.\n\n"
        f"Hier koennen Sie direkt einen passenden Termin auswaehlen:\n"
        f"{calendly_link}\n\n"
        f"Der Termin dauert ca. 15 Minuten und ist natuerlich kostenlos.\n\n"
        f"NIO Automation\n"
        f"anfragen@nio-automation.de | nio-automation.de"
    )
    try:
        r = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": os.environ.get("BREVO_API_KEY"),
                     "Content-Type": "application/json"},
            json={"sender":  {"name": os.environ.get("ABSENDER_NAME"),
                               "email": os.environ.get("ABSENDER_EMAIL")},
                  "replyTo": {"email": os.environ.get("REPLY_EMAIL")},
                  "to":      [{"email": empfaenger_email, "name": bautraeger_name}],
                  "subject": "Re: KI-Projekt Immobiliensuche – Terminvorschlag",
                  "textContent": inhalt}
        )
        if r.status_code in (200, 201):
            print(f"[AUTO] Calendly-Link gesendet an: {bautraeger_name} ({empfaenger_email})")
            return True
        else:
            print(f"[FEHLER] Calendly-Antwort fehlgeschlagen: {r.text}")
            return False
    except Exception as e:
        print(f"[FEHLER] sende_calendly_antwort fuer {bautraeger_name}: {e}")
        return False


# ── Hauptfunktion: Antwort klassifizieren ─────
def klassifiziere_antwort(antwort_text: str) -> str:
    """
    Klassifiziert eine Bautraeger-Antwort in eine von 4 Kategorien.

    INTERESSE   – moechte mehr wissen oder Termin vereinbaren
    ABLEHNUNG   – kein Interesse oder keine passenden Objekte
    FRAGE       – stellt konkrete Rueckfragen
    ABWESENHEIT – nicht erreichbar oder Abwesenheitsnotiz

    Gibt immer einen gueltigen Wert zurueck (Fallback: FRAGE).
    """
    prompt = f"""
Du analysierst die Antwort eines Bautraegers auf eine Wohnungsanfrage.

Ordne die Antwort in genau eine dieser Kategorien ein:
- INTERESSE: Der Bautraeger zeigt Interesse, hat passende Wohnungen, moechte mehr Infos oder schlaegt ein Gespraech/Termin vor
- ABLEHNUNG: Der Bautraeger hat keine passenden Wohnungen oder lehnt ab
- FRAGE: Der Bautraeger stellt Rueckfragen zu Preis, Zeitplan oder Details – aber zeigt dabei kein klares Interesse
- ABWESENHEIT: Automatische Abwesenheitsnotiz oder Bautraeger nicht erreichbar

Antwort des Bautraegers:
{antwort_text}

Antworte NUR mit einem dieser vier Woerter: INTERESSE, ABLEHNUNG, FRAGE oder ABWESENHEIT.
"""
    try:
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=10,
            temperature=0.0
        )
        kategorie = r.choices[0].message.content.strip().upper()
        if kategorie not in GUELTIGE_KATEGORIEN:
            raise ValueError(f"Unbekannte Kategorie: {kategorie}")
        return kategorie
    except ValueError as e:
        print(f"   WARNUNG: Ungueltige Kategorisierung ({e}) – Fallback FRAGE")
        return "FRAGE"
    except Exception as e:
        print(f"   FEHLER: OpenAI API nicht erreichbar ({e}) – Fallback FRAGE")
        return "FRAGE"


# ── Benachrichtigung bei Interesse ───────────────────
def sende_interesse_benachrichtigung(bautraeger_email: str, bautraeger_name: str,
                                      antwort_text: str) -> bool:
    """
    Sendet eine Benachrichtigung an REPLY_EMAIL wenn ein Bautraeger Interesse zeigt.
    Kein automatischer Calendly-Link – der Kunde prueft manuell.
    """
    reply_email = os.environ.get("REPLY_EMAIL", "")
    inhalt = (
        f"Ein Bautraeger hat auf deine Anfrage geantwortet und zeigt Interesse!\n\n"
        f"Firma: {bautraeger_name}\n"
        f"E-Mail: {bautraeger_email}\n\n"
        f"Antwort des Bautraegers:\n{antwort_text}\n\n"
        f"Bitte manuell pruefen und bei Interesse Termin vereinbaren."
    )
    try:
        r = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": os.environ.get("BREVO_API_KEY"),
                     "Content-Type": "application/json"},
            json={"sender":  {"name": os.environ.get("ABSENDER_NAME"),
                               "email": os.environ.get("ABSENDER_EMAIL")},
                  "to":      [{"email": reply_email}],
                  "subject": "Bautraeger hat Interesse – manuelle Aktion noetig",
                  "textContent": inhalt}
        )
        if r.status_code in (200, 201):
            print(f"[INTERESSE] Benachrichtigung gesendet an: {reply_email}")
            return True
        else:
            print(f"[FEHLER] Benachrichtigung fehlgeschlagen: {r.text}")
            return False
    except Exception as e:
        print(f"[FEHLER] sende_interesse_benachrichtigung: {e}")
        return False


# ── Standalone: Gmail lesen + Sheet aktualisieren ─────
if __name__ == "__main__":
    from gmail_reader import lese_neue_antworten
    from tag15_bautraeger_agent import verarbeite_bautraeger_antwort, sheet

    print("=" * 55)
    print("Reply-Classifier – Gmail lesen & Sheet aktualisieren")
    print("=" * 55)

    antworten = lese_neue_antworten()

    if not antworten:
        print("Keine neuen Bautraeger-Antworten gefunden.")
    else:
        print(f"{len(antworten)} Antwort(en) gefunden – verarbeite...\n")
        for antwort in antworten:
            print(f"Firma:   {antwort['firma']}")
            print(f"Von:     {antwort['absender']}")
            print(f"Betreff: {antwort['betreff']}")
            kategorie = verarbeite_bautraeger_antwort(
                sheet            = sheet,
                firma            = antwort["firma"],
                antwort_text     = antwort["text"],
                empfaenger_email = antwort["absender"]
            )
            print(f"Ergebnis: {kategorie}")
            print()
            time.sleep(1)

    print("=" * 55)
    print("Fertig.")
