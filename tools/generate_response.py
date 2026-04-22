"""
generate_response.py
Generiert eine professionelle E-Mail-Antwort auf eine Kontaktformular-Anfrage via OpenAI.
"""

from openai import OpenAI
from dotenv import load_dotenv
import os

load_dotenv()

# OpenAI-Client initialisieren
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# System-Prompt mit E-Mail-Qualitäts-Regeln
SYSTEM_PROMPT = """Du bist ein professioneller E-Mail-Assistent für NIO Automation.
Erstelle eine professionelle E-Mail-Antwort auf eine Kontaktformular-Anfrage.

Halte dich strikt an folgende Regeln:
- Beginne immer mit: "Sehr geehrte/r [Name],"
- Maximal 4 Sätze Haupttext
- Immer einen klaren Call-to-Action am Ende
- Ton: professionell aber persönlich
- VERBOTEN: "Sehr geehrte Damen und Herren"
- VERBOTEN: Mehr als eine Frage in der E-Mail
- Betreff-Format: "Ihre Anfrage bei NIO Automation – wir melden uns"
- KEINE Signatur im generierten Text (Signatur wird separat angehängt)

Antworte ausschließlich mit dem E-Mail-Text, ohne Betreff-Zeile oder Signatur."""


def generiere_antwort(name: str, message: str, kategorie: str) -> dict:
    """
    Generiert eine professionelle E-Mail-Antwort auf eine Kontaktformular-Anfrage.

    Args:
        name: Name der anfragenden Person
        message: Inhalt der Anfrage
        kategorie: Klassifizierte Kategorie der Anfrage (z.B. INTERESSE, FRAGE, etc.)

    Returns:
        dict mit "betreff" und "email_text"
    """
    try:
        # User-Prompt mit den Anfrage-Details
        user_prompt = f"""Schreibe eine Antwort auf folgende Kontaktformular-Anfrage:

Name: {name}
Kategorie: {kategorie}
Nachricht:
{message}

Erstelle einen professionellen E-Mail-Text gemäß den Qualitäts-Regeln."""

        print(f"Generiere Antwort für '{name}' (Kategorie: {kategorie}) ...")

        antwort = client.chat.completions.create(
            model="gpt-4o-mini",
            max_tokens=300,
            temperature=0.7,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        )

        email_text = antwort.choices[0].message.content.strip()

        print("E-Mail-Text erfolgreich generiert.")

        return {
            "betreff": "Ihre Anfrage bei NIO Automation – wir melden uns",
            "email_text": email_text,
        }

    except Exception as fehler:
        print(f"Fehler bei der Generierung der E-Mail-Antwort: {fehler}")

        # Fallback-Text bei Fehler
        fallback_text = (
            f"Sehr geehrte/r {name},\n\n"
            "vielen Dank für Ihre Anfrage bei NIO Automation. "
            "Wir haben Ihre Nachricht erhalten und melden uns schnellstmöglich bei Ihnen. "
            "Bei dringenden Fragen erreichen Sie uns jederzeit direkt per E-Mail."
        )

        return {
            "betreff": "Ihre Anfrage bei NIO Automation – wir melden uns",
            "email_text": fallback_text,
        }


if __name__ == "__main__":
    # Beispiel-Aufruf zur Demonstration
    beispiel_name = "Max Mustermann"
    beispiel_nachricht = (
        "Ich interessiere mich für Ihre KI-Automatisierungslösungen und würde gerne "
        "mehr über die Möglichkeiten für mein Unternehmen erfahren."
    )
    beispiel_kategorie = "INTERESSE"

    print("=== Test: generiere_antwort ===")
    ergebnis = generiere_antwort(beispiel_name, beispiel_nachricht, beispiel_kategorie)

    print("\n--- Ergebnis ---")
    print(f"Betreff: {ergebnis['betreff']}")
    print(f"\nE-Mail-Text:\n{ergebnis['email_text']}")
