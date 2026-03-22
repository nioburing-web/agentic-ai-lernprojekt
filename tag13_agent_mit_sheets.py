from dotenv import load_dotenv
import os
import pandas as pd
import gspread
from google.oauth2.service_account import Credentials
from openai import OpenAI
from datetime import datetime
import time


load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


# ── Google Sheets Verbindung ──────────────────
SCOPES = ["https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive"]
creds  = Credentials.from_service_account_file("credentials.json", scopes=SCOPES)
gc     = gspread.authorize(creds)
sheet  = gc.open_by_key("1zGzhiVWPGveCFmbYQEifAAG7UpUA5ZCwws2d3HhSs-g").sheet1


# ── Spaltenköpfe setzen ───────────────────────
headers = ["Name","Firma","Branche","Score","Status",
           "Kontaktiert am","Antwort","Termin","Notizen"]
if not sheet.get_all_values():
    sheet.append_row(headers)


# ── Funktion: Lead bewerten ───────────────────
def bewerte_lead(lead):
    prompt = f"""
Bewerte diesen Lead (1-10) für AI-Automatisierung.
Firma: {lead["firma"]}, Branche: {lead["branche"]},
Mitarbeiter: {lead["mitarbeiter"]}
Nur eine Zahl.
"""
    r = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role":"user","content":prompt}],
        max_tokens=5, temperature=0.2
    )
    return int(r.choices[0].message.content.strip())


# ── Funktion: Lead ins Sheet schreiben ────────
def schreibe_ins_sheet(lead, score, status, notiz=""):
    zeile = [
        lead["name"],
        lead["firma"],
        lead["branche"],
        score,
        status,
        datetime.now().strftime("%d.%m.%Y"),
        "Ausstehend",
        "—",
        notiz
    ]
    sheet.append_row(zeile)


# ── Haupt-Loop ───────────────────────────────
df = pd.read_csv("leads.csv")
print(f"🤖 Verarbeite {len(df)} Leads...")
print()


for index, lead in df.head(5).iterrows():
    print(f"[{index+1}] {lead['firma']}")


    score = bewerte_lead(lead)


    if score >= 7:
        status = "TOP – E-Mail bereit"
        notiz  = f"Score {score} – Für Outreach vorgemerkt"
    elif score >= 5:
        status = "MITTEL – Manuell prüfen"
        notiz  = f"Score {score} – Mittleres Potenzial"
    else:
        status = "NIEDRIG – Übersprungen"
        notiz  = f"Score {score} – Nicht relevant"


    schreibe_ins_sheet(lead, score, status, notiz)
    print(f"   ✓ Score {score} → ins Sheet geschrieben")
    time.sleep(2)


print()
print("✅ Alle Leads bewertet und ins Google Sheet geschrieben!")

