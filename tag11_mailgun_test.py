from dotenv import load_dotenv
import os
import requests


load_dotenv()


MAILGUN_API_KEY = os.environ.get("MAILGUN_API_KEY")
MAILGUN_DOMAIN  = os.environ.get("MAILGUN_DOMAIN")


# ── E-Mail senden Funktion ───────────────────
def sende_email(an, betreff, text):
    """Sendet eine E-Mail über die Mailgun API"""
    antwort = requests.post(
        f"https://api.mailgun.net/v3/{MAILGUN_DOMAIN}/messages",
        auth=("api", MAILGUN_API_KEY),
        data={
            "from":    f"Mein Agent <mailgun@{MAILGUN_DOMAIN}>",
            "to":      [an],
            "subject": betreff,
            "text":    text
        }
    )
    return antwort.status_code, antwort.text


# ── Test: E-Mail an dich selbst senden ───────
meine_email = "nioburing@gmail.com"  # HIER deine eigene E-Mail eintragen


status, antwort = sende_email(
    an       = meine_email,
    betreff  = "Test – Mein erster Python-E-Mail-Agent",
    text     = "Hallo!\n\nDas ist ein Test meines AI-Agenten.\nWenn du das liest, funktioniert alles.\n\nViele Grüße"
)


if status == 200:
    print("✅ E-Mail erfolgreich gesendet!")
else:
    print(f"❌ Fehler: {status} – {antwort}")

