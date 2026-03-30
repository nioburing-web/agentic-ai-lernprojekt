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
from openai import OpenAI

load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

GUELTIGE_KATEGORIEN = {"INTERESSE", "ABLEHNUNG", "FRAGE", "ABWESENHEIT"}


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
- INTERESSE: Der Bautraeger hat passende Wohnungen oder zeigt konkretes Interesse
- ABLEHNUNG: Der Bautraeger hat keine passenden Wohnungen oder lehnt ab
- FRAGE: Der Bautraeger stellt Rueckfragen bevor er antworten kann
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
