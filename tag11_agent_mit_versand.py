from dotenv import load_dotenv
import os
import pandas as pd
import requests
import time
from openai import OpenAI


load_dotenv()
client          = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
MAILGUN_API_KEY = os.environ.get("MAILGUN_API_KEY")
MAILGUN_DOMAIN  = os.environ.get("MAILGUN_DOMAIN")


# ── WICHTIG: Nur an deine eigene E-Mail senden! ──
TEST_EMAIL = "nioburing@gmail.com"  # Hier deine E-Mail eintragen


# CSV einlesen
df = pd.read_csv("leads.csv")


# ── Funktion 1: Bewerten ─────────────────────
def bewerte_lead(lead):
    prompt = f"""
Bewerte diesen Lead für AI-Automatisierung (1-10).
Firma: {lead["firma"]}, Branche: {lead["branche"]},
Mitarbeiter: {lead["mitarbeiter"]}, Notizen: {lead["notizen"]}
Nur eine Zahl, kein anderer Text.
"""
    r = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role":"user","content":prompt}],
        max_tokens=5, temperature=0.2
    )
    return int(r.choices[0].message.content.strip())


# ── Funktion 2: E-Mail generieren ────────────
def generiere_email(lead):
    prompt = f"""
Schreibe eine kurze Cold-Email (4-5 Sätze) an {lead["name"]} von {lead["firma"]}.
Branche: {lead["branche"]}, Mitarbeiter: {lead["mitarbeiter"]}.
Biete AI-Automatisierung an. Professioneller, freundlicher Ton.
Nur der E-Mail-Text, kein Betreff. schreibe keine verabschiedung.
"""
    r = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role":"user","content":prompt}],
        max_tokens=200, temperature=0.7
    )
    return r.choices[0].message.content.strip()

# ── Funktion 3: E-Mail senden ────────────────
def sende_email(an, betreff, text):
    r = requests.post(
        f"https://api.mailgun.net/v3/{MAILGUN_DOMAIN}/messages",
        auth=("api", MAILGUN_API_KEY),
        data={"from": f"AI Agent <mailgun@{MAILGUN_DOMAIN}>",
              "to": [an], "subject": betreff, "text": text}
    )
    return r.status_code == 200


# ── Haupt-Loop ───────────────────────────────
print("🤖 Agent startet...")
print()


for index, lead in df.head(3).iterrows():  # Nur erste 3 zum Testen
    print(f"[{index+1}] {lead['firma']}")


    score = bewerte_lead(lead)
    time.sleep(1)


    if score >= 7:
        signatur   = "\n\nMit freundlichen Grüßen,\nNio Buering\nAI Automation Specialist\n+49 123 456789\nnioburing@gmail.com"
        email_text = generiere_email(lead) + signatur
        betreff    = f"Kurze Frage zu {lead['firma']}"


        # Zum Testen: sendet an DEINE E-Mail, nicht an den Lead
        erfolg = sende_email(TEST_EMAIL, betreff, email_text)


        if erfolg:
            print(f"   🔥 Score {score}/10 → E-Mail gesendet an {TEST_EMAIL}")
        else:
            print(f"   ❌ Fehler beim Senden")


        time.sleep(45)  # Anti-Spam: 45 Sekunden Pause


    else:
        print(f"   ⏭️  Score {score}/10 → Übersprungen")


    print()


print("✅ Fertig!")

