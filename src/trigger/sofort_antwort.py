import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from tools.analyze_request import analysiere_anfrage
from tools.generate_response import generiere_antwort
from tools.send_email import sende_email
from tools.track_sheets import tracke_anfrage
from dotenv import load_dotenv
load_dotenv()


def verarbeite_anfrage(payload: dict) -> dict:
    """
    Orchestriert alle 4 Tools in der richtigen Reihenfolge.
    Gibt ein Dict zurück mit: {"kategorie": str, "status": str}
    """
    # Felder aus Payload holen
    name = payload.get("name", "")
    email = payload.get("email", "")
    message = payload.get("message", "")
    company = payload.get("company", "")

    # Schritt 1 – Anfrage analysieren
    try:
        kategorie = analysiere_anfrage(name, email, message, company)
        print(f"Schritt 1 abgeschlossen: Kategorie = {kategorie}")
    except Exception as e:
        print(f"FEHLER Schritt 1: {e}")
        kategorie = "SONSTIGES"

    # Schritt 2 – Antwort generieren
    try:
        antwort = generiere_antwort(name, message, kategorie)
        print(f"Schritt 2 abgeschlossen: Betreff = {antwort['betreff']}")
    except Exception as e:
        print(f"FEHLER Schritt 2: {e}")
        antwort = {"betreff": "Ihre Anfrage bei NIO Automation – wir melden uns", "email_text": "Wir melden uns bald."}

    # Schritt 3 – E-Mail senden
    try:
        gesendet = sende_email(email, antwort["betreff"], antwort["email_text"])
        print(f"Schritt 3 abgeschlossen: Gesendet = {gesendet}")
    except Exception as e:
        print(f"FEHLER Schritt 3: {e}")
        gesendet = False

    # Schritt 4 – Tracking
    status = "GESENDET" if gesendet else "FEHLER"
    try:
        tracke_anfrage(name, email, message, kategorie, status)
        print(f"Schritt 4 abgeschlossen: Status = {status}")
    except Exception as e:
        print(f"FEHLER Schritt 4: {e}")

    return {"kategorie": kategorie, "status": status}


if __name__ == "__main__":
    test_payload = {
        "name": "Max Mustermann",
        "email": os.environ.get("TEST_EMAIL", "test@beispiel.de"),
        "message": "Ich brauche Hilfe bei meiner Buchhaltung.",
        "company": "Mustermann GmbH"
    }
    ergebnis = verarbeite_anfrage(test_payload)
    print(f"\nErgebnis: {ergebnis}")
