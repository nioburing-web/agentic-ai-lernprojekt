import requests
from dotenv import load_dotenv
import os

# Umgebungsvariablen laden
load_dotenv()


def sende_email(empfaenger_email: str, betreff: str, email_text: str) -> bool:
    """
    Sendet eine E-Mail via Brevo API.

    Args:
        empfaenger_email: Die Ziel-E-Mail-Adresse des Empfängers
        betreff: Der Betreff der E-Mail
        email_text: Der Inhalt der E-Mail (ohne Signatur)

    Returns:
        True bei Erfolg, False bei Fehler
    """
    try:
        api_key = os.environ.get("BREVO_API_KEY")
        if not api_key:
            print("Fehler: BREVO_API_KEY ist nicht gesetzt.")
            return False

        # Signatur aus ENV-Vars zusammenbauen
        signatur = (
            f"\n\nMit freundlichen Grüßen\n"
            f"{os.environ.get('ABSENDER_NAME', 'NIO Automation')}\n"
            f"{os.environ.get('ABSENDER_EMAIL', 'anfragen@nio-automation.de')}\n"
            f"{os.environ.get('ABSENDER_WEBSITE', 'nio-automation.de')}"
        )

        # Test-Modus: Empfänger-Adresse ggf. überschreiben
        test_email = os.environ.get("TEST_EMAIL")
        if test_email:
            print(
                f"[TEST-MODUS] E-Mail wird an Test-Adresse gesendet: {test_email} "
                f"(original: {empfaenger_email})"
            )
            tatsaechliche_empfaenger_email = test_email
        else:
            tatsaechliche_empfaenger_email = empfaenger_email

        # Absender und Reply-To aus ENV
        absender_name = os.environ.get("ABSENDER_NAME", "NIO Automation")
        absender_email = os.environ.get("ABSENDER_EMAIL", "anfragen@nio-automation.de")
        reply_to_email = os.environ.get("REPLY_TO_EMAIL") or os.environ.get("REPLY_EMAIL")

        headers = {
            "api-key": api_key,
            "Content-Type": "application/json",
        }

        body = {
            "sender": {
                "name": absender_name,
                "email": absender_email,
            },
            "to": [{"email": tatsaechliche_empfaenger_email}],
            "subject": betreff,
            "textContent": email_text + signatur,
        }

        # Reply-To nur hinzufügen wenn vorhanden
        if reply_to_email:
            body["replyTo"] = {"email": reply_to_email}

        r = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers=headers,
            json=body,
        )

        if r.status_code in (200, 201):
            print(f"E-Mail erfolgreich gesendet an: {tatsaechliche_empfaenger_email}")
            return True
        else:
            print(
                f"Fehler beim Senden der E-Mail. Statuscode: {r.status_code}, "
                f"Antwort: {r.text}"
            )
            return False

    except Exception as e:
        print(f"Ausnahme beim Senden der E-Mail: {e}")
        return False


if __name__ == "__main__":
    import sys
    import json

    if len(sys.argv) >= 4:
        # CLI-Modus fuer Trigger.dev subprocess-Aufruf
        # Aufruf: send_email.py <empfaenger> <betreff> <text>
        empfaenger_arg = sys.argv[1]
        betreff_arg = sys.argv[2]
        text_arg = sys.argv[3]
        ok = sende_email(empfaenger_arg, betreff_arg, text_arg)
        print(json.dumps({"gesendet": ok}))
    else:
        # Bestehender Test-Modus
        test_betreff = "Testmail von NIO Automation"
        test_text = (
            "Guten Tag,\n\n"
            "dies ist eine Testnachricht, um die E-Mail-Funktion zu überprüfen."
        )

        erfolg = sende_email(
            empfaenger_email="nioburing@gmail.com",
            betreff=test_betreff,
            email_text=test_text,
        )

        if erfolg:
            print("Test erfolgreich abgeschlossen.")
        else:
            print("Test fehlgeschlagen – bitte Logs prüfen.")
