"""
track_sheets.py – Schreibt eine Anfrage in ein Google Sheet zur Nachverfolgung.
Tab: "Sofort-Antwort"
"""

import gspread
from google.oauth2.service_account import Credentials
from dotenv import load_dotenv
import os
from datetime import datetime

load_dotenv()

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def tracke_anfrage(name: str, email: str, message: str, kategorie: str, status: str) -> bool:
    """
    Schreibt eine Anfrage in das Google Sheet zur Nachverfolgung.

    Args:
        name:      Name des Absenders
        email:     E-Mail-Adresse des Absenders
        message:   Nachrichtentext (wird auf 100 Zeichen gekürzt)
        kategorie: Klassifizierungs-Kategorie (z. B. INTERESSE, FRAGE, ...)
        status:    Aktueller Status der Anfrage

    Returns:
        True bei Erfolg, False bei Fehler
    """
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not sheet_id:
        print("Warnung: GOOGLE_SHEET_ID ist nicht gesetzt – Tracking übersprungen.")
        return False

    try:
        credentials_path = os.environ.get("GOOGLE_CREDENTIALS_PATH", "credentials.json")
        creds = Credentials.from_service_account_file(credentials_path, scopes=SCOPES)
        gc = gspread.authorize(creds)

        spreadsheet = gc.open_by_key(sheet_id)

        # Tab "Sofort-Antwort" öffnen, Fallback auf erstes Sheet
        try:
            worksheet = spreadsheet.worksheet("Sofort-Antwort")
        except gspread.exceptions.WorksheetNotFound:
            print("Hinweis: Tab 'Sofort-Antwort' nicht gefunden – verwende erstes Sheet als Fallback.")
            worksheet = spreadsheet.sheet1

        # Nachricht auf 100 Zeichen kürzen für bessere Lesbarkeit im Sheet
        nachricht_gekuerzt = message[:100]

        jetzt = datetime.now()
        zeile = [
            name,
            email,
            nachricht_gekuerzt,
            kategorie,
            status,
            jetzt.strftime("%Y-%m-%d"),
            jetzt.strftime("%H:%M:%S"),
        ]

        worksheet.append_row(zeile)
        print(f"Tracking erfolgreich: {name} ({email}) – Kategorie: {kategorie}, Status: {status}")
        return True

    except Exception as fehler:
        print(f"Fehler beim Schreiben ins Google Sheet: {fehler}")
        return False


if __name__ == "__main__":
    # Beispielaufruf zum Testen
    erfolg = tracke_anfrage(
        name="Max Mustermann",
        email="max.mustermann@beispiel.de",
        message="Ich interessiere mich für Ihre Neubauwohnungen in Hamburg. Bitte schicken Sie mir weitere Informationen.",
        kategorie="INTERESSE",
        status="offen",
    )
    if erfolg:
        print("Test-Eintrag erfolgreich ins Sheet geschrieben.")
    else:
        print("Test-Eintrag fehlgeschlagen – bitte .env und credentials.json prüfen.")
