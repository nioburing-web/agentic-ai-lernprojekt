"""
Tests fuer den Reporting-Agent.
Ausfuehren: python tests/test_reporting.py
"""
import sys
import os
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools.read_outreach import lese_outreach_daten
from tools.read_sofort_antwort import lese_sofort_antwort_daten
from tools.calculate_stats import berechne_statistiken

bestanden = 0
fehlgeschlagen = 0


def pruefe(beschreibung: str, bedingung: bool):
    global bestanden, fehlgeschlagen
    if bedingung:
        print(f"[OK]   {beschreibung}")
        bestanden += 1
    else:
        print(f"[FAIL] {beschreibung}")
        fehlgeschlagen += 1


def fake_worksheet(zeilen: list[list[str]]) -> MagicMock:
    ws = MagicMock()
    ws.get_all_values.return_value = zeilen
    return ws


def fake_spreadsheet(worksheet: MagicMock) -> MagicMock:
    sp = MagicMock()
    sp.worksheet.return_value = worksheet
    return sp


# ---------------------------------------------------------------------------
# Test 1: Normaler Tag mit Daten
# ---------------------------------------------------------------------------
def test_normaler_tag():
    gestern = (date.today() - timedelta(days=1)).strftime("%d.%m.%Y")

    header = ["Firma", "Stadt", "Status", "Datum", "Uhrzeit", "Betreff"]
    zeilen = [
        header,
        ["Firma A", "Hamburg", "KONTAKTIERT", gestern, "09:00:00", "Betreff"],
        ["Firma B", "Berlin", "KONTAKTIERT", gestern, "09:01:00", "Betreff"],
        ["Firma C", "Bremen", "KONTAKTIERT", gestern, "09:02:00", "Betreff"],
        ["Firma D", "Kiel", "INTERESSIERT", gestern, "09:03:00", "Betreff"],
        ["Firma E", "Lübeck", "ABGELEHNT", gestern, "09:04:00", "Betreff"],
    ]

    ws = fake_worksheet(zeilen)
    sp = fake_spreadsheet(ws)

    with patch("gspread.authorize", return_value=MagicMock(open_by_key=lambda _: sp)):
        with patch("os.environ.get", side_effect=lambda k, d="": {
            "GOOGLE_SHEET_ID": "test-id",
            "GOOGLE_CREDENTIALS_PATH": "credentials.json",
        }.get(k, d)):
            with patch("google.oauth2.service_account.Credentials.from_service_account_file"):
                ergebnis = lese_outreach_daten()

    pruefe("Test 1: kontaktiert == 3", ergebnis["kontaktiert"] == 3)
    pruefe("Test 1: interessiert == 1", ergebnis["interessiert"] == 1)
    pruefe("Test 1: abgelehnt == 1", ergebnis["abgelehnt"] == 1)
    pruefe("Test 1: conversion_rate == 33.3", ergebnis["conversion_rate"] == 33.3)


# ---------------------------------------------------------------------------
# Test 2: Leeres Sheet – kein Absturz
# ---------------------------------------------------------------------------
def test_leeres_sheet():
    header = ["Firma", "Stadt", "Status", "Datum", "Uhrzeit", "Betreff"]
    ws = fake_worksheet([header])
    sp = fake_spreadsheet(ws)

    try:
        with patch("gspread.authorize", return_value=MagicMock(open_by_key=lambda _: sp)):
            with patch("os.environ.get", side_effect=lambda k, d="": {
                "GOOGLE_SHEET_ID": "test-id",
                "GOOGLE_CREDENTIALS_PATH": "credentials.json",
            }.get(k, d)):
                with patch("google.oauth2.service_account.Credentials.from_service_account_file"):
                    ergebnis = lese_outreach_daten()

        pruefe("Test 2: kein Absturz bei leerem Sheet", True)
        pruefe("Test 2: kontaktiert == 0", ergebnis.get("kontaktiert") == 0)
        pruefe("Test 2: offene_leads ist leer", ergebnis.get("offene_leads") == [])
        pruefe("Test 2: alle Pflicht-Keys vorhanden", all(
            k in ergebnis for k in ["kontaktiert", "interessiert", "abgelehnt", "conversion_rate", "offene_leads"]
        ))
    except Exception as e:
        pruefe(f"Test 2: kein Absturz bei leerem Sheet (Exception: {e})", False)


# ---------------------------------------------------------------------------
# Test 3: Timestamp-Berechnung korrekt (Zeitzone Europe/Berlin)
# ---------------------------------------------------------------------------
def test_timestamp_berechnung():
    gestern = (date.today() - timedelta(days=1)).strftime("%d.%m.%Y")
    anfrage_zeit = f"{gestern} 09:00:00"
    antwort_zeit = f"{gestern} 09:03:30"

    header = ["Name", "Email", "Nachricht", "Kategorie", "Status", "Anfrage_Zeit", "Antwort_Zeit", "Reaktionszeit_Min"]
    zeilen = [
        header,
        ["Max", "max@test.de", "Frage", "BUCHHALTUNG", "GESENDET", anfrage_zeit, antwort_zeit, "3.5"],
    ]

    ws = fake_worksheet(zeilen)
    sp = fake_spreadsheet(ws)

    with patch("gspread.authorize", return_value=MagicMock(open_by_key=lambda _: sp)):
        with patch("os.environ.get", side_effect=lambda k, d="": {
            "GOOGLE_SHEET_ID": "test-id",
            "GOOGLE_CREDENTIALS_PATH": "credentials.json",
        }.get(k, d)):
            with patch("google.oauth2.service_account.Credentials.from_service_account_file"):
                ergebnis = lese_sofort_antwort_daten()

    pruefe("Test 3: anfragen == 1", ergebnis["anfragen"] == 1)
    pruefe("Test 3: beantwortet == 1", ergebnis["beantwortet"] == 1)
    pruefe("Test 3: avg_reaktionszeit == 3.5 Minuten", abs(ergebnis["avg_reaktionszeit_min"] - 3.5) < 0.01)
    pruefe("Test 3: schnellste_min == 3.5", abs(ergebnis["schnellste_min"] - 3.5) < 0.01)


# ---------------------------------------------------------------------------
# Test 4: Offene Leads korrekt identifiziert (3+ Tage)
# ---------------------------------------------------------------------------
def test_offene_leads():
    heute = date.today()
    vor_4_tagen = (heute - timedelta(days=4)).strftime("%d.%m.%Y")
    vor_2_tagen = (heute - timedelta(days=2)).strftime("%d.%m.%Y")
    vor_5_tagen = (heute - timedelta(days=5)).strftime("%d.%m.%Y")
    vor_3_tagen = (heute - timedelta(days=3)).strftime("%d.%m.%Y")

    header = ["Firma", "Stadt", "Status", "Datum", "Uhrzeit", "Betreff"]
    zeilen = [
        header,
        ["Firma A", "Hamburg", "KONTAKTIERT", vor_4_tagen, "09:00", "B"],   # soll drin sein
        ["Firma B", "Berlin", "KONTAKTIERT", vor_2_tagen, "09:00", "B"],    # zu jung
        ["Firma C", "Bremen", "INTERESSIERT", vor_5_tagen, "09:00", "B"],   # hat Status
        ["Firma D", "Kiel", "", vor_3_tagen, "09:00", "B"],                  # soll drin sein
    ]

    ws = fake_worksheet(zeilen)
    sp = fake_spreadsheet(ws)

    with patch("gspread.authorize", return_value=MagicMock(open_by_key=lambda _: sp)):
        with patch("os.environ.get", side_effect=lambda k, d="": {
            "GOOGLE_SHEET_ID": "test-id",
            "GOOGLE_CREDENTIALS_PATH": "credentials.json",
        }.get(k, d)):
            with patch("google.oauth2.service_account.Credentials.from_service_account_file"):
                ergebnis = lese_outreach_daten()

    offene = set(ergebnis.get("offene_leads", []))
    pruefe("Test 4: Firma A in offene_leads", "Firma A" in offene)
    pruefe("Test 4: Firma D in offene_leads", "Firma D" in offene)
    pruefe("Test 4: Firma B NICHT in offene_leads", "Firma B" not in offene)
    pruefe("Test 4: Firma C NICHT in offene_leads", "Firma C" not in offene)
    pruefe("Test 4: genau 2 offene Leads", len(offene) == 2)


# ---------------------------------------------------------------------------
# Alle Tests ausfuehren
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 50)
    print("Reporting Agent Tests")
    print("=" * 50)

    test_normaler_tag()
    print()
    test_leeres_sheet()
    print()
    test_timestamp_berechnung()
    print()
    test_offene_leads()

    print()
    print("=" * 50)
    print(f"Ergebnis: {bestanden} bestanden, {fehlgeschlagen} fehlgeschlagen")
    print("=" * 50)
    sys.exit(0 if fehlgeschlagen == 0 else 1)
