import os
import json
from datetime import date, timedelta, datetime

import gspread
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

load_dotenv()

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def get_credentials() -> Credentials:
    # Cloud: JSON als String in Env-Var
    service_account_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if service_account_json:
        info = json.loads(service_account_json)
        return Credentials.from_service_account_info(info, scopes=SCOPES)
    # Lokal: Datei
    credentials_path = os.environ.get("GOOGLE_CREDENTIALS_PATH", "credentials.json")
    return Credentials.from_service_account_file(credentials_path, scopes=SCOPES)


def lese_outreach_daten(zieldatum: date | None = None) -> dict:
    """
    Liest Buchhalter-Outreach-Daten aus dem Google Sheet fuer ein bestimmtes Datum.
    Spalten: A=Firma, B=Stadt, C=Status, D=Datum, E=Uhrzeit, F=Betreff
    Datumsformat in Spalte D: DD.MM.YYYY
    """
    if zieldatum is None:
        zieldatum = date.today() - timedelta(days=1)

    leeres_ergebnis = {
        "kontaktiert": 0,
        "interessiert": 0,
        "abgelehnt": 0,
        "conversion_rate": 0.0,
        "offene_leads": [],
    }

    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not sheet_id:
        print("Warnung: GOOGLE_SHEET_ID nicht gesetzt.", flush=True)
        return leeres_ergebnis

    creds = get_credentials()
    gc = gspread.authorize(creds)
    spreadsheet = gc.open_by_key(sheet_id)

    try:
        worksheet = spreadsheet.worksheet("Buchhalter Outreach")
    except gspread.exceptions.WorksheetNotFound:
        worksheet = spreadsheet.sheet1

    alle_zeilen = worksheet.get_all_values()
    if len(alle_zeilen) <= 1:
        return leeres_ergebnis

    # Header-Zeile überspringen
    daten_zeilen = alle_zeilen[1:]

    kontaktiert = 0
    interessiert = 0
    abgelehnt = 0
    offene_leads = []
    heute = date.today()

    for zeile in daten_zeilen:
        if len(zeile) < 4:
            continue

        firma = zeile[0].strip()
        status = zeile[2].strip().upper()
        datum_str = zeile[3].strip()

        if not datum_str:
            continue

        try:
            zeilen_datum = datetime.strptime(datum_str, "%d.%m.%Y").date()
        except ValueError:
            try:
                zeilen_datum = datetime.fromisoformat(datum_str).date()
            except ValueError:
                continue

        # Zähler für gestern
        if zeilen_datum == zieldatum:
            if status == "KONTAKTIERT":
                kontaktiert += 1
            elif status == "INTERESSIERT":
                interessiert += 1
            elif status == "ABGELEHNT":
                abgelehnt += 1

        # Offene Leads: kein Status oder KONTAKTIERT, 3+ Tage alt
        tage_alt = (heute - zeilen_datum).days
        if tage_alt >= 3 and status in ("", "KONTAKTIERT") and firma:
            offene_leads.append(firma)

    conversion_rate = round(interessiert / kontaktiert * 100, 1) if kontaktiert > 0 else 0.0

    return {
        "kontaktiert": kontaktiert,
        "interessiert": interessiert,
        "abgelehnt": abgelehnt,
        "conversion_rate": conversion_rate,
        "offene_leads": offene_leads,
    }


if __name__ == "__main__":
    try:
        ergebnis = lese_outreach_daten()
    except Exception as e:
        ergebnis = {
            "fehler": str(e),
            "kontaktiert": 0,
            "interessiert": 0,
            "abgelehnt": 0,
            "conversion_rate": 0.0,
            "offene_leads": [],
        }
    print(json.dumps(ergebnis, ensure_ascii=False))
