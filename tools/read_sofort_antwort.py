import os
import json
from datetime import date, timedelta, datetime

import gspread
import pytz
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

load_dotenv()

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

BERLIN = pytz.timezone("Europe/Berlin")


def get_credentials() -> Credentials:
    # Cloud: JSON als String in Env-Var
    service_account_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if service_account_json:
        info = json.loads(service_account_json)
        return Credentials.from_service_account_info(info, scopes=SCOPES)
    # Lokal: Datei
    credentials_path = os.environ.get("GOOGLE_CREDENTIALS_PATH", "credentials.json")
    return Credentials.from_service_account_file(credentials_path, scopes=SCOPES)


def lese_sofort_antwort_daten(zieldatum: date | None = None) -> dict:
    """
    Liest Sofort-Antwort-Daten aus dem Google Sheet fuer ein bestimmtes Datum.
    Spalten: A=Name, B=Email, C=Nachricht, D=Kategorie, E=Status,
             F=Anfrage_Zeit, G=Antwort_Zeit, H=Reaktionszeit_Min
    Timestamp-Format in F, G: DD.MM.YYYY HH:MM:SS (bereits Europe/Berlin)
    """
    if zieldatum is None:
        zieldatum = date.today() - timedelta(days=1)

    leeres_ergebnis = {
        "anfragen": 0,
        "beantwortet": 0,
        "avg_reaktionszeit_min": 0.0,
        "schnellste_min": 0.0,
        "langsamste_min": 0.0,
    }

    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not sheet_id:
        print("Warnung: GOOGLE_SHEET_ID nicht gesetzt.", flush=True)
        return leeres_ergebnis

    creds = get_credentials()
    gc = gspread.authorize(creds)
    spreadsheet = gc.open_by_key(sheet_id)

    try:
        worksheet = spreadsheet.worksheet("Sofort-Antwort")
    except gspread.exceptions.WorksheetNotFound:
        worksheet = spreadsheet.sheet1

    alle_zeilen = worksheet.get_all_values()
    if len(alle_zeilen) <= 1:
        return leeres_ergebnis

    # Header-Zeile überspringen
    daten_zeilen = alle_zeilen[1:]

    anfragen = 0
    beantwortet = 0
    reaktionszeiten = []

    for zeile in daten_zeilen:
        if len(zeile) < 6:
            continue

        status = zeile[4].strip().upper()
        anfrage_zeit_str = zeile[5].strip()
        antwort_zeit_str = zeile[6].strip() if len(zeile) > 6 else ""
        reaktionszeit_str = zeile[7].strip() if len(zeile) > 7 else ""

        if not anfrage_zeit_str:
            continue

        try:
            anfrage_dt = datetime.strptime(anfrage_zeit_str, "%d.%m.%Y %H:%M:%S")
            anfrage_dt = BERLIN.localize(anfrage_dt)
        except ValueError:
            continue

        # Filter: nur Zeilen vom Zieldatum
        if anfrage_dt.date() != zieldatum:
            continue

        anfragen += 1

        if status == "GESENDET" and antwort_zeit_str:
            beantwortet += 1
            if reaktionszeit_str:
                try:
                    reaktionszeiten.append(float(reaktionszeit_str))
                except ValueError:
                    pass

    avg_reaktionszeit = round(sum(reaktionszeiten) / len(reaktionszeiten), 2) if reaktionszeiten else 0.0
    schnellste = round(min(reaktionszeiten), 2) if reaktionszeiten else 0.0
    langsamste = round(max(reaktionszeiten), 2) if reaktionszeiten else 0.0

    return {
        "anfragen": anfragen,
        "beantwortet": beantwortet,
        "avg_reaktionszeit_min": avg_reaktionszeit,
        "schnellste_min": schnellste,
        "langsamste_min": langsamste,
    }


if __name__ == "__main__":
    try:
        ergebnis = lese_sofort_antwort_daten()
    except Exception as e:
        ergebnis = {
            "fehler": str(e),
            "anfragen": 0,
            "beantwortet": 0,
            "avg_reaktionszeit_min": 0.0,
            "schnellste_min": 0.0,
            "langsamste_min": 0.0,
        }
    print(json.dumps(ergebnis, ensure_ascii=False))
