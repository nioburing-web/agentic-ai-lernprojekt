from dotenv import load_dotenv
import os
import pandas as pd
import requests
import gspread
from google.oauth2.service_account import Credentials
from openai import OpenAI
from datetime import datetime
import time


load_dotenv()
client          = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
MAILGUN_API_KEY = os.environ.get("MAILGUN_API_KEY")
MAILGUN_DOMAIN  = os.environ.get("MAILGUN_DOMAIN")
SHEET_ID        = "1zGzhiVWPGveCFmbYQEifAAG7UpUA5ZCwws2d3HhSs-g"
TEST_EMAIL      = "nioburing@gmail.com"


# ── Google Sheets Verbindung ──────────────────
SCOPES = ["https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive"]
creds  = Credentials.from_service_account_file("credentials.json", scopes=SCOPES)
gc     = gspread.authorize(creds)
sheet  = gc.open_by_key(SHEET_ID).sheet1


# Spaltenkoepfe setzen
headers = ["Name","Firma","Branche","Score","Status","E-Mail generiert","Gesendet am","Notizen"]

if not sheet.get_all_values():
    sheet.append_row(headers)


# ── Funktion 1: Lead bewerten ─────────────────
def bewerte_lead(lead):
    prompt = f"""
Bewerte diesen Lead fuer AI-Automatisierung (1-10).
Firmen mit 8-50 Mitarbeitern und vielen Routineaufgaben bekommen hohe Scores.
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
Schreibe eine kurze Cold-Email (4-5 Saetze) an {lead["name"]} von {lead["firma"]}.
Branche: {lead["branche"]}, Mitarbeiter: {lead["mitarbeiter"]}.
Biete AI-Automatisierung an. Professioneller, freundlicher Ton.
Nur der E-Mail-Text, kein Betreff. Keine Signatur.
"""
    r = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role":"user","content":prompt}],
        max_tokens=200, temperature=0.7
    )
    return r.choices[0].message.content.strip()


# ── Funktion 3: E-Mail senden ─────────────────
def sende_email(an, betreff, text):
    signatur = "\nNio Büring\nAI Automation Specialist\nnio.buring@gmail.com"
    r = requests.post(
        f"https://api.mailgun.net/v3/{MAILGUN_DOMAIN}/messages",
        auth=("api", MAILGUN_API_KEY),
        data={"from": f"AI Agent <mailgun@{MAILGUN_DOMAIN}>",
              "to": [an], "subject": betreff, "text": text + signatur}
    )
    return r.status_code == 200


# ── Funktion 4: Ins Sheet schreiben ──────────
def schreibe_ins_sheet(lead, score, status, email_generiert, notiz=""):
    zeile = [
        lead["name"],
        lead["firma"],
        lead["branche"],
        score,
        status,
        "Ja" if email_generiert else "Nein",
        datetime.now().strftime("%d.%m.%Y %H:%M"),
        notiz
    ]
    sheet.append_row(zeile)


# ── Haupt-Loop ────────────────────────────────
df = pd.read_csv("leads.csv")
print(f"Agent startet - {len(df)} Leads gefunden.")
print()


for index, lead in df.iterrows():
    print(f"[{index+1}/{len(df)}] {lead['firma']}")


    # Schritt 1: Bewerten
    score = bewerte_lead(lead)
    time.sleep(1)


    if score >= 7:
        # Top-Lead: E-Mail generieren und senden
        email_text = generiere_email(lead)
        betreff    = f"Kurze Frage zu {lead['firma']}"
        erfolg     = sende_email(TEST_EMAIL, betreff, email_text)
        status     = "TOP - E-Mail gesendet" if erfolg else "TOP - Sendefehler"
        schreibe_ins_sheet(lead, score, status, True, f"Score {score}")
        print(f"   Score {score}/10 - E-Mail gesendet")
        time.sleep(45)  # Anti-Spam Pause


    elif score >= 5:
        # Mittlerer Lead: Nur ins Sheet
        schreibe_ins_sheet(lead, score, "MITTEL - Manuell pruefen", False, f"Score {score}")
        print(f"   Score {score}/10 - Ins Sheet geschrieben")


    else:
        # Schwacher Lead: Ueberspringen
        schreibe_ins_sheet(lead, score, "NIEDRIG - Uebersprungen", False, f"Score {score}")
        print(f"   Score {score}/10 - Uebersprungen")


    print()
    time.sleep(1)


print("Agent fertig! Ergebnisse im Google Sheet.")

