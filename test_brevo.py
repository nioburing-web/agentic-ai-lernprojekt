from dotenv import load_dotenv
import os
import requests

load_dotenv()

BREVO_API_KEY = os.environ.get("BREVO_API_KEY")

r = requests.post(
    "https://api.brevo.com/v3/smtp/email",
    headers={
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json"
    },
    json={
        "sender": {
            "name": "NIO Automation",
            "email": "anfragen@nio-automation.de"
        },
        "to": [{"email": "nioburing@gmail.com"}],
        "subject": "Test – Brevo funktioniert",
        "textContent": "Dieser Test zeigt dass Brevo korrekt eingerichtet ist."
    }
)

if r.status_code == 201:
    print("✅ Brevo funktioniert!")
else:
    print(f"Fehler: {r.status_code} – {r.text}")