"""
Klassifiziert eine Kontaktformular-Anfrage via OpenAI gpt-4o-mini.
Kategorien: BUCHHALTUNG | BERATUNG | TERMIN | SONSTIGES
"""

from openai import OpenAI
from dotenv import load_dotenv
import os

# Umgebungsvariablen laden
load_dotenv()

# Gültige Kategorien
GUELTIGE_KATEGORIEN = ["BUCHHALTUNG", "BERATUNG", "TERMIN", "SONSTIGES"]

# OpenAI-Client initialisieren
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


def analysiere_anfrage(name: str, email: str, message: str, company: str = "") -> str:
    """
    Klassifiziert eine Kontaktformular-Anfrage in eine Kategorie.

    Args:
        name: Name des Absenders
        email: E-Mail-Adresse des Absenders
        message: Nachrichtentext der Anfrage
        company: Optionaler Firmenname des Absenders

    Returns:
        Kategorie als String: "BUCHHALTUNG" | "BERATUNG" | "TERMIN" | "SONSTIGES"
    """
    # Anfrage-Details zusammenbauen
    anfrage_details = f"Name: {name}\nE-Mail: {email}\n"
    if company:
        anfrage_details += f"Firma: {company}\n"
    anfrage_details += f"Nachricht: {message}"

    system_prompt = (
        "Du klassifizierst Kontaktformular-Anfragen in genau eine der folgenden Kategorien:\n"
        "- BUCHHALTUNG: Fragen zu Buchhaltung, Rechnungen, Finanzen, Steuern\n"
        "- BERATUNG: Allgemeine Beratungsanfragen, Informationen zu Dienstleistungen\n"
        "- TERMIN: Terminanfragen, Terminvereinbarungen, Rückrufbitten\n"
        "- SONSTIGES: Alles, was nicht in die anderen Kategorien passt\n\n"
        "Antworte NUR mit der Kategorie, ohne weitere Erklärung."
    )

    user_prompt = f"Klassifiziere folgende Anfrage:\n\n{anfrage_details}"

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=10,
            temperature=0.0,
        )

        # Antwort bereinigen und validieren
        kategorie = response.choices[0].message.content.strip().upper()

        if kategorie not in GUELTIGE_KATEGORIEN:
            raise ValueError(f"Ungültige Kategorie erhalten: '{kategorie}'")

        return kategorie

    except ValueError as e:
        print(f"Warnung: Kategorievalidierung fehlgeschlagen – {e}. Fallback auf 'SONSTIGES'.")
        return "SONSTIGES"

    except Exception as e:
        print(f"Fehler bei der Klassifizierung: {e}. Fallback auf 'SONSTIGES'.")
        return "SONSTIGES"


if __name__ == "__main__":
    # Beispielaufruf zur Demonstration
    beispiel_name = "Max Mustermann"
    beispiel_email = "max.mustermann@beispiel.de"
    beispiel_nachricht = (
        "Guten Tag, ich würde gerne einen Termin vereinbaren, "
        "um Ihre Buchhaltungsdienstleistungen kennenzulernen."
    )
    beispiel_firma = "Mustermann GmbH"

    print("Klassifiziere Beispiel-Anfrage...")
    print(f"Name: {beispiel_name}")
    print(f"E-Mail: {beispiel_email}")
    print(f"Firma: {beispiel_firma}")
    print(f"Nachricht: {beispiel_nachricht}")
    print("-" * 50)

    ergebnis = analysiere_anfrage(
        name=beispiel_name,
        email=beispiel_email,
        message=beispiel_nachricht,
        company=beispiel_firma,
    )

    print(f"Erkannte Kategorie: {ergebnis}")
