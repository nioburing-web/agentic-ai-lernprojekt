import gspread
from google.oauth2.service_account import Credentials
import pandas as pd
from datetime import datetime


# ── Google Sheets Verbindung ──────────────────
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]


creds  = Credentials.from_service_account_file("credentials.json", scopes=SCOPES)
client = gspread.authorize(creds)


# Sheet öffnen – ersetze mit deiner Sheet-ID
SHEET_ID = "1zGzhiVWPGveCFmbYQEifAAG7UpUA5ZCwws2d3HhSs-g"
sheet    = client.open_by_key(SHEET_ID).sheet1


print("✅ Verbindung zu Google Sheets hergestellt!")


# ── Spaltenköpfe setzen ───────────────────────
headers = [
    "Name", "Firma", "Branche", "Score", "Status",
    "E-Mail gesendet", "Antwort-Kategorie", "Termin", "Notizen"
]


# Nur setzen wenn Sheet noch leer ist
if sheet.row_count == 0 or sheet.cell(1, 1).value != "Name":
    sheet.append_row(headers)
    print("✅ Spaltenköpfe gesetzt.")


# ── Test-Daten schreiben ──────────────────────
test_leads = [
    ["Thomas Müller", "Müller Steuerberatung", "Steuerberatung",
     8, "TOP", "15.01.2025", "INTERESSE", "18.01. 14:00", "Sehr interessiert"],
    ["Anna Schmidt", "Schmidt Immobilien", "Immobilien",
     6, "MITTEL", "15.01.2025", "ABLEHNUNG", "—", "Kein Interesse"],
    ["Peter Koch", "Koch Logistik", "Logistik",
     7, "TOP", "15.01.2025", "FRAGE", "Offen", "Hat Fragen zu Kosten"],
]


print("📝 Schreibe Leads ins Sheet...")
for lead in test_leads:
    sheet.append_row(lead)
    print(f"   ✓ {lead[0]} – {lead[1]}")


print()
print("✅ Alle Leads ins Google Sheet geschrieben!")
print(f"📊 Sheet-Link: https://docs.google.com/spreadsheets/d/{SHEET_ID}")

