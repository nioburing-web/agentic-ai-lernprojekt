from dotenv import load_dotenv
import os
import sys
import pandas as pd
import requests
import gspread
from google.oauth2.service_account import Credentials
from openai import OpenAI
from datetime import datetime
import time


load_dotenv()
client  = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

SHEET_ID = "1LBEp_m5-8SGaB5vWjeuq12CK2N4Q8vBjsSzXZ5ZoKFQ"

# ── Test-Modus ────────────────────────────────
TEST_MODUS = "--test" in sys.argv

if TEST_MODUS:
    print("=" * 55)
    print("[TEST-MODUS] Keine E-Mails werden gesendet!")
    print("[TEST-MODUS] Sheets werden nicht aktualisiert.")
    print("=" * 55)


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

# ── Sheet-Header (Aufgabe 1) ──────────────────
BAUTRAEGER_HEADERS = [
    "Firma", "E-Mail", "Region", "Stadt", "Score", "Status",
    "Anfrage gesendet am", "Antwort am", "Antwort-Kategorie",
    "Termin (Calendly)", "Notizen"
]


# ── Google Sheets Verbindung ──────────────────
SCOPES = ["https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive"]
try:
    credentials_pfad = os.environ.get("GOOGLE_CREDENTIALS_PATH", "credentials.json")
    creds  = Credentials.from_service_account_file(credentials_pfad, scopes=SCOPES)
    gc     = gspread.authorize(creds)
    sheet  = gc.open_by_key(SHEET_ID).sheet1
    print("Google Sheets Verbindung erfolgreich.")
except Exception as e:
    print(f"FEHLER: Google Sheets Verbindung fehlgeschlagen ({e})")
    sheet = None


# ── Aufgabe 1: Header-Prüfung ─────────────────
def ensure_bautraeger_headers(sheet):
    """Prueft und ergaenzt Header-Zeile im Bautraeger-Dashboard."""
    try:
        aktuelle = sheet.row_values(1)
    except Exception:
        aktuelle = []

    if not aktuelle:
        sheet.insert_row(BAUTRAEGER_HEADERS, 1)
        print("[INFO] Bautraeger-Dashboard: Header neu erstellt.")
        return

    fehlende = [h for h in BAUTRAEGER_HEADERS if h not in aktuelle]
    if fehlende:
        naechste = len(aktuelle) + 1
        for i, h in enumerate(fehlende):
            sheet.update_cell(1, naechste + i, h)
        print(f"[INFO] Bautraeger-Dashboard: Neue Spalten ergaenzt: {fehlende}")
    else:
        print("[INFO] Bautraeger-Dashboard: Header vollstaendig.")


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


# ── Aufgabe 5: E-Mail generieren (neuer Prompt) ──
def generate_email(
    bautraeger_name: str,
    region: str,
    zimmer: int = 3,                  # Feedback: Zimmeranzahl statt Schlafzimmer
    wohnflaeche_min: int = 70,        # Feedback: Wohnfläche min
    wohnflaeche_max: int = 100,       # Feedback: Wohnfläche max
    budget: int = 400000,
    nur_neubau: bool = True           # Feedback: Nur Neubau als Ja/Nein
) -> dict:
    neubau_text = "ausschließlich Neubauprojekte" if nur_neubau else "Neubau oder Bestand"

    prompt = f"""Schreibe eine kurze lockere Anfrage-E-Mail an den Bautraeger
"{bautraeger_name}" in der Region {region}.


KONTEXT:
Ich entwickle ein KI-System das automatisch passende Neubauwohnungen
fuer Kaufinteressenten findet. Ich brauche echte Beispielobjekte
um das System zu testen und zu verbessern.


ZIEL DER E-MAIL:
Hoeflich und locker fragen ob der Bautraeger kurz Zeit haette,
uns ein aktuelles Neubauobjekt zu zeigen das zu diesen Kriterien passt:
- Region: {region}
- Budget: bis {budget} Euro
- Zimmeranzahl: {zimmer} Zimmer
- Wohnflaeche: {wohnflaeche_min}-{wohnflaeche_max} qm
- Nur Neubau: {neubau_text}


STRUKTUR:
1. Anrede: Sehr geehrtes Team von {bautraeger_name},
2. Ich-Perspektive: 'Ich entwickle gerade ein KI-System...'
3. Konkrete Bitte: Haetten Sie Zeit uns ein passendes Objekt zu zeigen?
4. Suchkriterien kurz nennen
5. Bitte nett und freundlich um kurze Rueckmeldung bitten

PFLICHTREGELN:
- Korrekte Gross-/Kleinschreibung
- Region grossschreiben (Hamburg, Nordsee, Ostsee, Mallorca)
- Locker und persoenlich – kein Unternehmens-Sprech
- KEIN 'Sehr geehrte Damen und Herren'
- KEINE Kaufversprechen oder Kaufabsichten
- KEINE Verabschiedung (kein 'Mit freundlichen Grüßen', 'Viele Grüße', 'Beste Grüße' o.ä.)
- Max. 120 Woerter
- Betreff muss das KI-Projekt erwaehnen (z.B. 'KI-Projekt' oder 'KI-Wohnungssuche')


FORMAT: BETREFF: [Betreff]\n\n[E-Mail Text]"""

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
            betreff = f"KI-Projekt: Neubauobjekt in {region} gesucht"
        if not body:
            body = antwort

        return {"subject": betreff, "body": body}

    except Exception as e:
        print(f"   FEHLER: E-Mail konnte nicht generiert werden ({e})")
        return {
            "subject": f"Anfrage: Eigentumswohnung in {region}",
            "body": f"Sehr geehrtes Team von {bautraeger_name},\n\nwir suchen für einen Kunden eine Neubauwohnung in {region}.\n\nNIO Automation | anfragen@nio-automation.de | nio-automation.de"
        }


# ── Funktion 3: Antwort klassifizieren ────────
# NICHT VERÄNDERN
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
        "\n\nNIO Automation\n"
        "anfragen@nio-automation.de | nio-automation.de"
    )
    try:
        r = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": os.environ.get("BREVO_API_KEY"),
                     "Content-Type": "application/json"},
            json={"sender":    {"name": os.environ.get("ABSENDER_NAME"), "email": os.environ.get("ABSENDER_EMAIL")},
                  "replyTo":   {"email": os.environ.get("REPLY_EMAIL")},
                  "to":        [{"email": an}],
                  "subject":   betreff,
                  "textContent": text + signatur}
        )
        return r.status_code == 201
    except Exception as e:
        print(f"   FEHLER: E-Mail konnte nicht gesendet werden ({e})")
        return False


# ── Aufgabe 2: update_bautraeger_sheet() ─────────
def update_bautraeger_sheet(sheet, firma: str, email: str, region: str,
                             stadt: str, score: int, status: str):
    """
    Fuegt eine neue Zeile im Bautraeger-Dashboard ein.
    11 Spalten: A–K wie in BAUTRAEGER_HEADERS definiert.
    Feedback eingebaut: Anfrage gesendet am (G), Antwort am (H, leer),
    Antwort-Kategorie (I, leer), Termin Calendly (J, leer), Notizen (K, leer)
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    zeile = [
        firma,      # A: Firma
        email,      # B: E-Mail
        region,     # C: Region
        stadt,      # D: Stadt
        score,      # E: Score (von bewerte_bautraeger())
        status,     # F: Status
        timestamp,  # G: Anfrage gesendet am ← Feedback Punkt 8
        "",         # H: Antwort am ← Feedback Punkt 6 (wird durch klassifiziere_antwort befüllt)
        "",         # I: Antwort-Kategorie (wird durch klassifiziere_antwort befüllt)
        "",         # J: Termin (Calendly) ← Feedback Punkt 7
        ""          # K: Notizen
    ]

    try:
        sheet.append_row(zeile)
        print(f"[{timestamp}] Bautraeger eingetragen: {firma} | Score: {score} | {status}")
    except Exception as e:
        print(f"[FEHLER] Bautraeger-Sheet fuer {firma}: {e}")


# ── Aufgabe 4: verarbeite_bautraeger_antwort() ───
def verarbeite_bautraeger_antwort(sheet, firma: str, antwort_text: str):
    """
    Klassifiziert eine Bautraeger-Antwort und aktualisiert das Sheet.
    Nutzt klassifiziere_antwort() – wird NICHT veraendert.

    Aktualisiert:
    - Spalte H (Antwort am): Zeitstempel ← Feedback Punkt 6
    - Spalte I (Antwort-Kategorie): Klassifikation durch klassifiziere_antwort()
    - Spalte F (Status): wird auf "GEANTWORTET" gesetzt
    """
    # Bestehenden Reply-Classifier aufrufen – NICHT veraendern
    kategorie = klassifiziere_antwort(antwort_text)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    try:
        treffer = sheet.findall(firma)
        if treffer:
            zeile_nr = treffer[-1].row
            sheet.update_cell(zeile_nr, 8, timestamp)       # H: Antwort am
            sheet.update_cell(zeile_nr, 9, kategorie)       # I: Antwort-Kategorie
            sheet.update_cell(zeile_nr, 6, "GEANTWORTET")   # F: Status
            print(f"[{timestamp}] Antwort klassifiziert: {firma} → {kategorie}")
        else:
            print(f"[WARNUNG] Firma nicht im Sheet gefunden: {firma}")
    except Exception as e:
        print(f"[FEHLER] Antwort-Update fuer {firma}: {e}")

    return kategorie


# ── Duplikat-Schutz ──────────────────────────
def ist_bereits_kontaktiert(sheet, firma: str) -> bool:
    """
    Prueft ob ein Bautraeger bereits im Sheet steht UND
    den Status KONTAKTIERT oder GEANTWORTET hat.
    Gibt True zurueck wenn uebersprungen werden soll.
    """
    try:
        treffer = sheet.findall(firma)
        if not treffer:
            return False  # Nicht im Sheet → neu eintragen

        for zelle in treffer:
            zeile_nr = zelle.row
            status = sheet.cell(zeile_nr, 6).value  # Spalte F = Status
            if status in ("KONTAKTIERT", "GEANTWORTET"):
                print(f"[SKIP] {firma} – bereits kontaktiert (Status: {status}). Wird übersprungen.")
                return True

        return False  # Im Sheet aber kein KONTAKTIERT-Status → neu eintragen

    except Exception as e:
        print(f"[WARNUNG] Duplikat-Pruefung fuer {firma} fehlgeschlagen: {e}")
        return False  # Im Zweifel lieber nicht überspringen


# ── Haupt-Loop ────────────────────────────────
df = pd.read_csv("bautraeger.csv", index_col=False)
print(f"Agent startet – {len(df)} Bauträger gefunden.")

if not TEST_MODUS and sheet is not None:
    ensure_bautraeger_headers(sheet)

print()

for index, firma in df.iterrows():
    print(f"[{int(index)+1}/{len(df)}] {firma['firma']} – {firma['region']}")

    # ── DUPLIKAT-SCHUTZ ─────────────────────────────────────────
    if not TEST_MODUS and sheet is not None and ist_bereits_kontaktiert(sheet, firma["firma"]):
        continue  # Überspringen – kein doppelter Eintrag
    # ────────────────────────────────────────────────────────────

    score = bewerte_bautraeger(firma)
    time.sleep(1)

    if score >= 7:
        email_dict = generate_email(
            bautraeger_name = firma["firma"],
            region          = firma["region"],
            zimmer          = int(firma.get("zimmer_min", 3)),
            wohnflaeche_min = int(firma.get("wohnflaeche_min", 70)),
            wohnflaeche_max = int(firma.get("wohnflaeche_max", 100)),
            nur_neubau      = str(firma.get("nur_neubau", "True")).lower() in ("true", "1", "ja")
        )

        print(f"\n   --- Generierte E-Mail ---")
        print(f"   Betreff: {email_dict['subject']}")
        signatur_vorschau = "\n\nNIO Automation\nanfragen@nio-automation.de | nio-automation.de"
        print(f"   Text:\n{email_dict['body']}{signatur_vorschau}")
        print(f"   -------------------------\n")

        if TEST_MODUS:
            print(f"   Score {score}/10 → [TEST-MODUS] E-Mail nicht gesendet")
            print(f"   Absender: {os.environ.get('ABSENDER_EMAIL')} → Empfaenger: {firma['email']}")
            print(f"   Sheet-Eintrag (simuliert):")
            print(f"   {[firma['firma'], firma['email'], firma['region'], firma['stadt'], score, 'KONTAKTIERT', datetime.now().strftime('%Y-%m-%d %H:%M'), '', '', '', '']}")
        else:
            erfolg = sende_email(firma["email"], email_dict["subject"], email_dict["body"])
            status = "KONTAKTIERT" if erfolg else "FEHLER"
            print(f"   Score {score}/10 → E-Mail {'gesendet' if erfolg else 'FEHLER'}")
            if sheet is not None:
                update_bautraeger_sheet(
                    sheet, firma["firma"], firma["email"],
                    firma["region"], firma["stadt"],
                    score, status
                )
            time.sleep(45)

    elif score >= 5:
        print(f"   Score {score}/10 → Manuell prüfen")
        if not TEST_MODUS and sheet is not None:
            update_bautraeger_sheet(
                sheet, firma["firma"], firma.get("email", ""),
                firma["region"], firma["stadt"],
                score, "MANUELL PRÜFEN"
            )

    else:
        print(f"   Score {score}/10 → Übersprungen")
        if not TEST_MODUS and sheet is not None:
            update_bautraeger_sheet(
                sheet, firma["firma"], firma.get("email", ""),
                firma["region"], firma["stadt"],
                score, "ÜBERSPRUNGEN"
            )

    print()
    time.sleep(1)


print("Agent fertig! Ergebnisse im Google Sheet.")
