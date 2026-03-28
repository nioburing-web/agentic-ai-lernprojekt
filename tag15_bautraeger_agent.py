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
SHEET_ID        = "1LBEp_m5-8SGaB5vWjeuq12CK2N4Q8vBjsSzXZ5ZoKFQ"      # <-- Anpassen
TEST_EMAIL      = "nioburing@gmail.com"      # <-- Anpassen


# ── Suchkriterien des Kunden ─────────────────
KRITERIEN = """
- Eigentumswohnung (Neubau von Bautraeger)
- Budget: bis 400.000 Euro
- Regionen: Hamburg, Nordsee, Ostsee oder Mallorca
- Mindestens 2 Schlafzimmer
- Grosse Kueche
- Keller vorhanden
"""


# ── Google Sheets Verbindung ──────────────────
SCOPES = ["https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive"]
creds  = Credentials.from_service_account_file("credentials.json", scopes=SCOPES)
gc     = gspread.authorize(creds)
sheet  = gc.open_by_key(SHEET_ID).sheet1


# Sheet leeren und Spaltenkoepfe setzen
headers = ["Firma","E-Mail","Region","Stadt","Score","Status",
           "Anfrage gesendet am","Antwort","Notizen"]
sheet.clear()
sheet.append_row(headers)


# ── Funktion 1: Bautraeger bewerten ──────────
def bewerte_bautraeger(firma):
    prompt = f"""
Bewerte diesen Bautraeger als Kontakt fuer eine Wohnungssuche.


Gesucht wird: {KRITERIEN}


Bautraeger:
Firma: {firma["firma"]}
Region: {firma["region"]}
Stadt: {firma["stadt"]}
Notizen: {firma["notizen"]}


Hohe Scores (7-10) wenn:
- Der Bautraeger in einer der Zielregionen aktiv ist
- Die Notizen auf aktuelle Projekte hinweisen
- Es ein etablierter Bautraeger wirkt


Niedrige Scores (1-4) wenn:
- Keine Information ueber aktuelle Projekte
- Region passt nicht zu den Suchkriterien


Antworte NUR mit einer Zahl zwischen 1 und 10.
"""
    try:
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role":"user","content":prompt}],
            max_tokens=5, temperature=0.2
        )
        raw = r.choices[0].message.content.strip()
        score = int(raw)
        if not 1 <= score <= 10:
            raise ValueError(f"Score ausserhalb des gueltigen Bereichs: {score}")
        return score
    except ValueError as e:
        print(f"   WARNUNG: Ungueltige Score-Antwort von GPT ({e}) – verwende Fallback-Score 5")
        return 5
    except Exception as e:
        print(f"   FEHLER: OpenAI API nicht erreichbar ({e}) – verwende Fallback-Score 5")
        return 5


# ── Funktion 2: Anfrage-E-Mail generieren ────
def generiere_anfrage(firma):
    prompt = f"""
Schreibe eine professionelle Anfrage-E-Mail an diesen Bautraeger.


Firma: {firma["firma"]}
Region: {firma["region"]}


Die E-Mail soll:
- Kurz vorstellen dass wir fuer einen Kunden eine Eigentumswohnung suchen
- Die Suchkriterien nennen: bis 400.000 Euro, 2 Schlafzimmer, grosse Kueche, Keller
- Fragen ob der Bautraeger aktuell oder in naher Zukunft passende Einheiten anbietet
- Um Rueckmeldung oder Informationsmaterial bitten
- Hoeflich, professionell, maximal 5 Saetze
- keine signatur oder Gruessformel, nur der reine E-Mail-Text enthalten


Ausgabe: Nur der E-Mail-Text, kein Betreff.
"""
    r = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role":"user","content":prompt}],
        max_tokens=200, temperature=0.6
    )
    return r.choices[0].message.content.strip()


# ── Funktion 3: Antwort klassifizieren ───────
GUELTIGE_KATEGORIEN = {"INTERESSE", "ABLEHNUNG", "FRAGE", "ABWESENHEIT"}

def klassifiziere_antwort(antwort_text):
    prompt = f"""
Du analysierst die Antwort eines Bautraegers auf eine Wohnungsanfrage.

Ordne die Antwort in genau eine dieser Kategorien ein:
- INTERESSE: Der Bautraeger hat passende Wohnungen oder zeigt konkretes Interesse
- ABLEHNUNG: Der Bautraeger hat keine passenden Wohnungen oder lehnt ab
- FRAGE: Der Bautraeger stellt Rueckfragen bevor er antworten kann
- ABWESENHEIT: Automatische Abwesenheitsnotiz oder Bautraeger nicht erreichbar

Antwort des Bautraegers:
{antwort_text}

Antworte NUR mit einem dieser vier Woerter: INTERESSE, ABLEHNUNG, FRAGE oder ABWESENHEIT.
"""
    try:
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=10, temperature=0.0
        )
        kategorie = r.choices[0].message.content.strip().upper()
        if kategorie not in GUELTIGE_KATEGORIEN:
            raise ValueError(f"Unbekannte Kategorie: {kategorie}")
        return kategorie
    except ValueError as e:
        print(f"   WARNUNG: Ungueltige Kategorisierung ({e}) – verwende Fallback FRAGE")
        return "FRAGE"
    except Exception as e:
        print(f"   FEHLER: OpenAI API nicht erreichbar ({e}) – verwende Fallback FRAGE")
        return "FRAGE"


# ── Funktion 4: E-Mail senden ─────────────────
def sende_email(an, betreff, text):
    signatur = (
        f"\n\nMit freundlichen Gruessen\n"
        f"{os.environ.get('ABSENDER_NAME')}\n"
        f"NIO Automation\n"
        f"Tel: {os.environ.get('ABSENDER_TEL')}\n"
        f"{os.environ.get('ABSENDER_EMAIL')}"
    )
    r = requests.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={"api-key": os.environ.get("BREVO_API_KEY"),
                 "Content-Type": "application/json"},
        json={"sender": {"name": "NIO Automation", "email": "anfragen@nio-automation.de"},
              "to": [{"email": an}],
              "subject": betreff,
              "textContent": text + signatur}
    )
    return r.status_code == 201


# ── Funktion 4: Ins Sheet schreiben ──────────
def schreibe_ins_sheet(firma, score, status, gesendet, notiz=""):
    zeile = [
        firma["firma"],
        firma["email"],
        firma["region"],
        firma["stadt"],
        score,
        status,
        datetime.now().strftime("%d.%m.%Y") if gesendet else "—",
        "Ausstehend",
        notiz
    ]
    sheet.append_row(zeile)


# ── Funktion 5: Antwort im Sheet aktualisieren ──
def update_antwort_im_sheet(firma_name, kategorie):
    try:
        zellen = sheet.col_values(1)  # Spalte "Firma"
        for i, wert in enumerate(zellen):
            if wert == firma_name:
                zeilen_nr = i + 1          # gspread ist 1-basiert
                antwort_spalte = 8         # Spalte "Antwort"
                sheet.update_cell(zeilen_nr, antwort_spalte, kategorie)
                print(f"   Sheet aktualisiert: {firma_name} → {kategorie}")
                return True
        print(f"   WARNUNG: Firma '{firma_name}' nicht im Sheet gefunden.")
        return False
    except Exception as e:
        print(f"   FEHLER: Sheet konnte nicht aktualisiert werden ({e})")
        return False


# ── Haupt-Loop ────────────────────────────────
df = pd.read_csv("bautraeger.csv", index_col=False)
print(f"Agent startet - {len(df)} Bautraeger gefunden.")
print()


for index, firma in df.iterrows():
    print(f"[{int(index)+1}/{len(df)}] {firma['firma']} – {firma['region']}")

    score = bewerte_bautraeger(firma)
    time.sleep(1)


    if score >= 7:
        anfrage = generiere_anfrage(firma)
        betreff = f"Anfrage: Eigentumswohnung in {firma['region']}"
        erfolg  = sende_email(TEST_EMAIL, betreff, anfrage)
        status  = "KONTAKTIERT" if erfolg else "FEHLER"
        schreibe_ins_sheet(firma, score, status, True, f"Score {score}")
        print(f"   Score {score}/10 → Anfrage gesendet")
        time.sleep(45)


    elif score >= 5:
        schreibe_ins_sheet(firma, score, "MANUELL PRUEFEN", False, f"Score {score}")
        print(f"   Score {score}/10 → Manuell pruefen")


    else:
        schreibe_ins_sheet(firma, score, "UEBERSPRUNGEN", False, f"Score {score}")
        print(f"   Score {score}/10 → Uebersprungen")


    print()
    time.sleep(1)


print("Agent fertig! Ergebnisse im Google Sheet.")


# ── Test-Block: Antwort-Klassifizierung ───────
print("\n" + "="*50)
print("TEST: Antwort-Klassifizierung")
print("="*50)

test_antworten = [
    {
        "firma": "BPB Immobilien GmbH",
        "antwort": (
            "Vielen Dank fuer Ihre Anfrage! Wir haben aktuell zwei Neubauprojekte "
            "in Hamburg mit Einheiten ab 320.000 Euro. Alle Wohnungen "
            "verfuegen ueber 2-3 Schlafzimmer, eine grosse Kueche und Kellerraum. "
            "Gerne senden wir Ihnen unsere aktuellen Exposees zu."
        ),
        "erwartete_kategorie": "INTERESSE"
    },
    {
        "firma": "Strenger Holding GmbH",
        "antwort": (
            "Danke fuer Ihre Nachricht. Leider bauen wir aktuell ausschliesslich "
            "in Bayern und koennen Ihnen fuer Hamburg, Nordsee oder Mallorca "
            "keine passenden Objekte anbieten. Wir wuenschen Ihnen viel Erfolg "
            "bei Ihrer Suche."
        ),
        "erwartete_kategorie": "ABLEHNUNG"
    },
    {
        "firma": "Hamburg Homes",
        "antwort": (
            "Guten Tag, vielen Dank fuer Ihre Anfrage. Um Ihnen passende Angebote "
            "machen zu koennen, benoetigen wir noch einige Informationen: "
            "Wann ist der gewuenschte Einzugstermin? Bevorzugen Sie Erdgeschoss "
            "oder eine hoehere Etage? Ist ein Balkon oder eine Terrasse gewuenscht?"
        ),
        "erwartete_kategorie": "FRAGE"
    },
]

for test in test_antworten:
    print(f"\nFirma: {test['firma']}")
    print(f"Erwartet: {test['erwartete_kategorie']}")

    kategorie = klassifiziere_antwort(test["antwort"])
    print(f"Erhalten:  {kategorie}")

    erfolg = update_antwort_im_sheet(test["firma"], kategorie)

    if kategorie == test["erwartete_kategorie"]:
        print("   OK – Klassifizierung korrekt")
    else:
        print("   ABWEICHUNG – Klassifizierung weicht von Erwartung ab")

print("\nTest abgeschlossen.")

