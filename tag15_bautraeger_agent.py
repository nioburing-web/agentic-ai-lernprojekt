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
client  = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

SHEET_ID  = "1LBEp_m5-8SGaB5vWjeuq12CK2N4Q8vBjsSzXZ5ZoKFQ"
DRY_RUN   = True   # Auf False setzen um E-Mails wirklich zu senden


# ── Suchkriterien des Kunden ──────────────────
KRITERIEN = """
- Eigentumswohnung (Neubau von Bauträger)
- Budget: bis 400.000 Euro
- Regionen: Hamburg, Nordsee, Ostsee oder Mallorca
- Zimmeranzahl: 3 Zimmer
- Wohnfläche: 70–100 qm
- Nur Neubau: Ja
- Ausstattung: Große Küche, Keller vorhanden
"""


# ── Google Sheets Verbindung ──────────────────
SCOPES = ["https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive"]
try:
    credentials_pfad = os.environ.get("GOOGLE_CREDENTIALS_PATH", "credentials.json")
    creds  = Credentials.from_service_account_file(credentials_pfad, scopes=SCOPES)
    gc     = gspread.authorize(creds)
    sheet  = gc.open_by_key(SHEET_ID).sheet1
    HEADERS = ["bautraeger_name", "region", "status", "email_subject",
               "email_gesendet_am", "antwort_erhalten_am", "termin_calendly", "notizen"]
    sheet.clear()
    sheet.append_row(HEADERS)
    print("Google Sheets Verbindung erfolgreich.")
except Exception as e:
    print(f"FEHLER: Google Sheets Verbindung fehlgeschlagen ({e})")
    sheet = None


# ── Funktion 1: Bauträger bewerten ────────────
def bewerte_bautraeger(firma):
    prompt = f"""
Bewerte diesen Bauträger als Kontakt für eine Wohnungssuche.

Gesucht wird: {KRITERIEN}

Bauträger:
Firma: {firma["firma"]}
Region: {firma["region"]}
Stadt: {firma["stadt"]}
Notizen: {firma["notizen"]}

Hohe Scores (7–10) wenn:
- Der Bauträger in einer der Zielregionen aktiv ist
- Die Notizen auf aktuelle Projekte hinweisen
- Es ein etablierter Bauträger wirkt

Niedrige Scores (1–4) wenn:
- Keine Information über aktuelle Projekte
- Region passt nicht zu den Suchkriterien

Antworte NUR mit einer Zahl zwischen 1 und 10.
"""
    try:
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=5,
            temperature=0.2
        )
        raw   = r.choices[0].message.content.strip()
        score = int(raw)
        if not 1 <= score <= 10:
            raise ValueError(f"Score außerhalb des gültigen Bereichs: {score}")
        return score
    except ValueError as e:
        print(f"   WARNUNG: Ungültige Score-Antwort ({e}) – Fallback-Score 5")
        return 5
    except Exception as e:
        print(f"   FEHLER: OpenAI API nicht erreichbar ({e}) – Fallback-Score 5")
        return 5


# ── Funktion 2: E-Mail generieren ─────────────
def generate_email(bautraeger_name: str, region: str,
                   zimmer_min: int = 3, zimmer_max: int = 4,
                   wohnflaeche_min: int = 70, wohnflaeche_max: int = 100,
                   nur_neubau: bool = True) -> dict:
    neubau_text = "Ja" if nur_neubau else "Nein"
    prompt = f"""
Schreibe eine professionelle Anfrage-E-Mail auf Deutsch an den Bauträger "{bautraeger_name}" in der Region {region}.

Verwende folgende Struktur:
1. Betreff in der ersten Zeile im Format: BETREFF: [Betreff]
2. Eine Leerzeile
3. Den E-Mail-Text

Inhalt der E-Mail:
- Beginne mit: "NIO Automation ist ein KI-gestützter Immobilien-Suchservice, der qualifizierte Kaufinteressenten mit passenden Bauträgern verbindet."
- Persönliche Anrede mit dem Bauträgernamen
- Wir suchen für einen Kunden folgende Immobilie:
  * Zimmeranzahl: {zimmer_min}–{zimmer_max} Zimmer
  * Wohnfläche: {wohnflaeche_min}–{wohnflaeche_max} qm
  * Budget: bis 400.000 Euro
  * Nur Neubau: {neubau_text}
  * Ausstattung: Große Küche, Keller vorhanden
  * Region: {region}
- Fragen ob der Bauträger aktuell oder in naher Zukunft passende Einheiten anbietet
- Bitte um Rückmeldung innerhalb von 5 Werktagen
- Maximale Länge: 150 Wörter
- Professionell, höflich, korrekte deutsche Groß- und Kleinschreibung
- Schließe mit der Signatur ab: "NIO Automation | anfragen@nio-automation.de | nio-automation.de"
- Keine zusätzliche Grußformel nach der Signatur
"""
    try:
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
            temperature=0.7
        )
        antwort = r.choices[0].message.content.strip()
        zeilen  = antwort.split("\n")

        betreff = ""
        body_zeilen = []
        betreff_gefunden = False

        for zeile in zeilen:
            if zeile.startswith("BETREFF:"):
                betreff = zeile.replace("BETREFF:", "").strip()
                betreff_gefunden = True
            elif betreff_gefunden:
                body_zeilen.append(zeile)

        body = "\n".join(body_zeilen).strip()

        if not betreff:
            betreff = f"Anfrage: Eigentumswohnung in {region}"
        if not body:
            body = antwort

        return {"subject": betreff, "body": body}

    except Exception as e:
        print(f"   FEHLER: E-Mail konnte nicht generiert werden ({e})")
        return {
            "subject": f"Anfrage: Eigentumswohnung in {region}",
            "body": f"Sehr geehrte Damen und Herren,\n\nwir suchen für einen Kunden eine Neubauwohnung in {region}.\n\nNIO Automation | anfragen@nio-automation.de | nio-automation.de"
        }


# ── Funktion 3: Antwort klassifizieren ────────
GUELTIGE_KATEGORIEN = {"INTERESSE", "ABLEHNUNG", "FRAGE", "ABWESENHEIT"}

def klassifiziere_antwort(antwort_text):
    prompt = f"""
Du analysierst die Antwort eines Bauträgers auf eine Wohnungsanfrage.

Ordne die Antwort in genau eine dieser Kategorien ein:
- INTERESSE: Der Bauträger hat passende Wohnungen oder zeigt konkretes Interesse
- ABLEHNUNG: Der Bauträger hat keine passenden Wohnungen oder lehnt ab
- FRAGE: Der Bauträger stellt Rückfragen bevor er antworten kann
- ABWESENHEIT: Automatische Abwesenheitsnotiz oder Bauträger nicht erreichbar

Antwort des Bauträgers:
{antwort_text}

Antworte NUR mit einem dieser vier Wörter: INTERESSE, ABLEHNUNG, FRAGE oder ABWESENHEIT.
"""
    try:
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=10,
            temperature=0.0
        )
        kategorie = r.choices[0].message.content.strip().upper()
        if kategorie not in GUELTIGE_KATEGORIEN:
            raise ValueError(f"Unbekannte Kategorie: {kategorie}")
        return kategorie
    except ValueError as e:
        print(f"   WARNUNG: Ungültige Kategorisierung ({e}) – Fallback FRAGE")
        return "FRAGE"
    except Exception as e:
        print(f"   FEHLER: OpenAI API nicht erreichbar ({e}) – Fallback FRAGE")
        return "FRAGE"


# ── Funktion 4: E-Mail senden ──────────────────
def sende_email(an, betreff, text):
    signatur = (
        f"\n\nMit freundlichen Grüßen\n"
        f"{os.environ.get('ABSENDER_NAME')}\n"
        f"NIO Automation\n"
        f"Tel: {os.environ.get('ABSENDER_TEL')}\n"
        f"{os.environ.get('ABSENDER_EMAIL')}"
    )
    try:
        r = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": os.environ.get("BREVO_API_KEY"),
                     "Content-Type": "application/json"},
            json={"sender":    {"name": "NIO Automation", "email": "anfragen@nio-automation.de"},
                  "replyTo":   {"email": os.environ.get("REPLY_EMAIL")},
                  "to":        [{"email": an}],
                  "subject":   betreff,
                  "textContent": text + signatur}
        )
        return r.status_code == 201
    except Exception as e:
        print(f"   FEHLER: E-Mail konnte nicht gesendet werden ({e})")
        return False


# ── Funktion 5: Ins Sheet schreiben ───────────
def schreibe_ins_sheet(bautraeger_name, region, status, email_subject, gesendet=False):
    if sheet is None:
        print("   WARNUNG: Kein Sheet verfügbar, überspringe Eintrag.")
        return
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M") if gesendet else ""
    zeile = [
        bautraeger_name,
        region,
        status,
        email_subject,
        timestamp,   # email_gesendet_am
        "",          # antwort_erhalten_am
        "",          # termin_calendly
        ""           # notizen
    ]
    try:
        sheet.append_row(zeile)
        print(f"   [{datetime.now().strftime('%Y-%m-%d %H:%M')}] Sheet aktualisiert: {bautraeger_name}")
    except Exception as e:
        print(f"   FEHLER: Sheet konnte nicht beschrieben werden ({e})")


# ── Funktion 6: Antwort im Sheet aktualisieren ─
def update_antwort_im_sheet(firma_name, kategorie):
    if sheet is None:
        return False
    try:
        zellen = sheet.col_values(1)  # Spalte "bautraeger_name"
        for i, wert in enumerate(zellen):
            if wert == firma_name:
                zeilen_nr = i + 1
                sheet.update_cell(zeilen_nr, 6, kategorie)   # Spalte "antwort_erhalten_am"
                sheet.update_cell(zeilen_nr, 6, f"{kategorie} – {datetime.now().strftime('%Y-%m-%d %H:%M')}")
                print(f"   [{datetime.now().strftime('%Y-%m-%d %H:%M')}] Sheet aktualisiert: {firma_name} -> {kategorie}")
                return True
        print(f"   WARNUNG: Firma '{firma_name}' nicht im Sheet gefunden.")
        return False
    except Exception as e:
        print(f"   FEHLER: Sheet konnte nicht aktualisiert werden ({e})")
        return False


# ── Haupt-Loop ────────────────────────────────
df = pd.read_csv("bautraeger.csv", index_col=False)
print(f"Agent startet – {len(df)} Bauträger gefunden.")
if DRY_RUN:
    print("MODUS: DRY RUN – E-Mails werden NICHT gesendet.\n")
else:
    print("MODUS: LIVE – E-Mails werden wirklich gesendet!\n")


for index, firma in df.iterrows():
    print(f"[{int(index)+1}/{len(df)}] {firma['firma']} – {firma['region']}")

    score = bewerte_bautraeger(firma)
    time.sleep(1)

    if score >= 7:
        # Neue CSV-Felder mit Fallback auf Standardwerte
        email_dict = generate_email(
            bautraeger_name   = firma["firma"],
            region            = firma["region"],
            zimmer_min        = int(firma.get("zimmer_min",  3)),
            zimmer_max        = int(firma.get("zimmer_max",  4)),
            wohnflaeche_min   = int(firma.get("wohnflaeche_min",  70)),
            wohnflaeche_max   = int(firma.get("wohnflaeche_max", 100)),
            nur_neubau        = str(firma.get("nur_neubau", "True")).lower() in ("true", "1", "ja")
        )

        print(f"\n   --- Generierte E-Mail ---")
        print(f"   Betreff: {email_dict['subject']}")
        print(f"   Text:\n{email_dict['body']}")
        print(f"   -------------------------\n")

        if DRY_RUN:
            erfolg = True
            status = "DRY RUN"
            print(f"   Score {score}/10 -> DRY RUN (nicht gesendet)")
        else:
            erfolg = sende_email(firma["email"], email_dict["subject"], email_dict["body"])
            status = "KONTAKTIERT" if erfolg else "FEHLER"
            print(f"   Score {score}/10 -> E-Mail {'gesendet' if erfolg else 'FEHLER'}")
            time.sleep(45)

        schreibe_ins_sheet(firma["firma"], firma["region"], status, email_dict["subject"], gesendet=erfolg)

    elif score >= 5:
        schreibe_ins_sheet(firma["firma"], firma["region"], "MANUELL PRÜFEN", "", gesendet=False)
        print(f"   Score {score}/10 -> Manuell prüfen")

    else:
        schreibe_ins_sheet(firma["firma"], firma["region"], "ÜBERSPRUNGEN", "", gesendet=False)
        print(f"   Score {score}/10 -> Übersprungen")

    print()
    time.sleep(1)


print("Agent fertig! Ergebnisse im Google Sheet.")
