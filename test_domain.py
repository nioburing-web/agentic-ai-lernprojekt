from dotenv import load_dotenv
import os
import requests


load_dotenv()


MAILGUN_API_KEY = os.environ.get("MAILGUN_API_KEY")
MAILGUN_DOMAIN  = os.environ.get("MAILGUN_DOMAIN")


# Test: E-Mail von deiner neuen Domain senden
r = requests.post(
    f"https://api.mailgun.net/v3/{MAILGUN_DOMAIN}/messages",
    auth=("api", MAILGUN_API_KEY),
    data={
        "from":    f"Immobilien Anfragen <anfragen@{MAILGUN_DOMAIN}>",
        "to":      ["deine@email.com"],  # <-- Deine eigene E-Mail
        "subject": "Test – Neue Domain funktioniert",
        "text":    "Dieser Test zeigt dass die eigene Domain korrekt eingerichtet ist."
    }
)


if r.status_code == 200:
    print("Neue Domain funktioniert!")
else:
    print(f"Fehler: {r.status_code} – {r.text}")

