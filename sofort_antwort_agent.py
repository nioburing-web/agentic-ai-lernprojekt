"""
sofort_antwort_agent.py – Webhook-Agent fuer Kontaktformular-Anfragen.

Empfaengt Kontaktformular-Daten, generiert eine personalisierte Antwort
mit OpenAI und sendet sie per Brevo. Traegt den Kontakt ins Google Sheet ein.

Starten:
    python sofort_antwort_agent.py
    # Erreichbar unter: http://localhost:5000/kontakt (POST)

Beispiel-Request:
    curl -X POST http://localhost:5000/kontakt \
         -H "Content-Type: application/json" \
         -d '{"name": "Max Mustermann", "email": "max@beispiel.de", "nachricht": "Ich suche eine 3-Zimmer-Wohnung in Hamburg."}'
"""

from dotenv import load_dotenv
import os
from flask import Flask, request, jsonify
from openai import OpenAI
import requests
import gspread
from google.oauth2.service_account import Credentials
from datetime import datetime

load_dotenv()

app = Flask(__name__)
openai_client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

LOG_DATEI = "agent_log.txt"


def schreibe_log(eintrag: str):
    """Haengt einen Eintrag mit Zeitstempel an agent_log.txt."""
    try:
        zeitstempel = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_DATEI, "a", encoding="utf-8") as f:
            f.write(f"[{zeitstempel}] {eintrag}\n")
    except Exception as e:
        print(f"[WARNUNG] Log konnte nicht geschrieben werden: {e}")

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

# ── Google Sheets Verbindung ──────────────────────────────────────────────────
def sheets_verbinden():
    """Gibt ein gspread-Sheet-Objekt zurueck oder None bei Fehler."""
    try:
        credentials_pfad = os.environ.get("GOOGLE_CREDENTIALS_PATH", "credentials.json")
        sheet_id = os.environ.get("KONTAKT_SHEET_ID")
        if not sheet_id:
            print("[WARNUNG] KONTAKT_SHEET_ID nicht gesetzt – Sheet-Eintrag wird uebersprungen.")
            return None
        creds = Credentials.from_service_account_file(credentials_pfad, scopes=SCOPES)
        gc = gspread.authorize(creds)
        return gc.open_by_key(sheet_id).sheet1
    except Exception as e:
        print(f"[FEHLER] Google Sheets Verbindung fehlgeschlagen: {e}")
        return None


# ── Schritt 1: Anfrage analysieren & Antwort generieren ──────────────────────
def generiere_antwort(name: str, nachricht: str) -> str:
    """Analysiert die Nachricht und generiert eine personalisierte E-Mail-Antwort."""
    absender_name = os.environ.get("ABSENDER_NAME", "NIO Automation")
    absender_email = os.environ.get("ABSENDER_EMAIL", "")
    absender_website = os.environ.get("ABSENDER_WEBSITE", "")
    calendly_link = os.environ.get("CALENDLY_LINK", "")

    prompt = f"""Du bist ein professioneller Kundenberater fuer {absender_name}.
Du hast folgende Kontaktanfrage erhalten:

Name: {name}
Nachricht: {nachricht}

Schreibe eine Antwort-E-Mail auf Deutsch mit genau diesen Vorgaben:
- Sprich {name} direkt mit Vornamen an
- Fasse das konkrete Anliegen in einem Satz zusammen
- Schlage vor: "Ich wuerde gerne einen kurzen Telefontermin vereinbaren"
- Fuege den Calendly-Link ein: {calendly_link}
- Maximal 5 Saetze gesamt
- Professionell aber persoenlich

Schreibe NUR den E-Mail-Text ohne Betreff und ohne Abschiedsformel.
Die Signatur wird separat angehaengt."""

    try:
        antwort = openai_client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            max_tokens=250,
            temperature=0.7
        )
        text = antwort.choices[0].message.content.strip()
        # Signatur anhaengen
        signatur = (
            f"\n\nMit freundlichen Gruessen\n"
            f"{absender_name}\n"
            f"{absender_email}\n"
            f"{absender_website}"
        )
        return text + signatur
    except Exception as e:
        print(f"[FEHLER] OpenAI Anfrage fehlgeschlagen: {e}")
        schreibe_log(f"OPENAI-FEHLER fuer {name} ({e})")
        # Standard-Fallback-Antwort
        return (
            f"Sehr geehrte/r {name},\n\n"
            f"vielen Dank fuer Ihre Anfrage. Wir melden uns innerhalb von 24 Stunden bei Ihnen.\n\n"
            f"Mit freundlichen Gruessen\n"
            f"{os.environ.get('ABSENDER_NAME', 'NIO Automation')}\n"
            f"{os.environ.get('ABSENDER_EMAIL', '')}\n"
            f"{os.environ.get('ABSENDER_WEBSITE', '')}"
        )


# ── Interner Alert bei Brevo-Fehler ──────────────────────────────────────────
def _sende_anwalt_brevo_alert(interessent_name: str, interessent_email: str, fehler_info: str):
    """Benachrichtigt den Anwalt wenn eine Antwort-E-Mail nicht gesendet werden konnte."""
    anwalt_email = os.environ.get("ANWALT_EMAIL")
    absender_name = os.environ.get("ABSENDER_NAME", "NIO Automation")
    absender_email = os.environ.get("ABSENDER_EMAIL")
    brevo_api_key = os.environ.get("BREVO_API_KEY")

    if not anwalt_email or not brevo_api_key or not absender_email:
        return

    inhalt = (
        f"ACHTUNG: E-Mail-Versand fehlgeschlagen – manuelles Eingreifen noetig!\n\n"
        f"Interessent: {interessent_name}\n"
        f"E-Mail:      {interessent_email}\n"
        f"Zeitpunkt:   {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}\n\n"
        f"Fehler:\n{fehler_info}\n\n"
        f"Bitte manuell antworten."
    )
    try:
        requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": brevo_api_key, "Content-Type": "application/json"},
            json={
                "sender":  {"name": absender_name, "email": absender_email},
                "to":      [{"email": anwalt_email}],
                "subject": f"FEHLER: E-Mail an {interessent_name} nicht gesendet",
                "textContent": inhalt
            }
        )
        print(f"[OK] Anwalt ueber Brevo-Fehler informiert: {anwalt_email}")
    except Exception as e:
        print(f"[WARNUNG] Anwalt-Alert konnte nicht gesendet werden: {e}")


# ── Schritt 2: Antwort per Brevo senden ──────────────────────────────────────
def sende_antwort_email(empfaenger_name: str, empfaenger_email: str, antwort_text: str, nachricht: str) -> bool:
    """Sendet die generierte Antwort per Brevo an die Kontaktperson."""
    absender_name = os.environ.get("ABSENDER_NAME", "NIO Automation")
    absender_email = os.environ.get("ABSENDER_EMAIL")
    reply_email = os.environ.get("REPLY_EMAIL", absender_email)
    brevo_api_key = os.environ.get("BREVO_API_KEY")

    if not brevo_api_key:
        print("[FEHLER] BREVO_API_KEY nicht gesetzt.")
        return False
    if not absender_email:
        print("[FEHLER] ABSENDER_EMAIL nicht gesetzt.")
        return False

    # Betreff aus Nachricht ableiten (erste 50 Zeichen)
    betreff_basis = nachricht[:50].strip()
    if len(nachricht) > 50:
        betreff_basis += "..."
    betreff = f"Re: Ihre Anfrage – {betreff_basis}"

    try:
        r = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "api-key": brevo_api_key,
                "Content-Type": "application/json"
            },
            json={
                "sender":  {"name": absender_name, "email": absender_email},
                "replyTo": {"email": reply_email},
                "to":      [{"email": empfaenger_email, "name": empfaenger_name}],
                "subject": betreff,
                "textContent": antwort_text
            }
        )
        if r.status_code in (200, 201):
            print(f"[OK] Antwort gesendet an: {empfaenger_name} ({empfaenger_email})")
            return True
        else:
            fehler_info = f"Brevo Status {r.status_code}: {r.text[:200]}"
            print(f"[FEHLER] Brevo-Versand fehlgeschlagen – {fehler_info}")
            schreibe_log(f"BREVO-FEHLER fuer {empfaenger_name} ({empfaenger_email}): {fehler_info}")
            _sende_anwalt_brevo_alert(empfaenger_name, empfaenger_email, fehler_info)
            return False
    except Exception as e:
        fehler_info = str(e)
        print(f"[FEHLER] Brevo-Anfrage fehlgeschlagen: {fehler_info}")
        schreibe_log(f"BREVO-FEHLER fuer {empfaenger_name} ({empfaenger_email}): {fehler_info}")
        _sende_anwalt_brevo_alert(empfaenger_name, empfaenger_email, fehler_info)
        return False


# ── Schritt 3: Anwalt benachrichtigen ────────────────────────────────────────
def sende_anwalt_benachrichtigung(name: str, email: str, nachricht: str) -> bool:
    """Sendet eine interne Benachrichtigung an den Anwalt bei neuer Kontaktanfrage."""
    anwalt_email = os.environ.get("ANWALT_EMAIL")
    absender_name = os.environ.get("ABSENDER_NAME", "NIO Automation")
    absender_email = os.environ.get("ABSENDER_EMAIL")
    brevo_api_key = os.environ.get("BREVO_API_KEY")

    if not anwalt_email:
        print("[INFO] ANWALT_EMAIL nicht gesetzt – Benachrichtigung uebersprungen.")
        return False
    if not brevo_api_key or not absender_email:
        print("[FEHLER] BREVO_API_KEY oder ABSENDER_EMAIL fehlt fuer Anwalt-Benachrichtigung.")
        return False

    jetzt = datetime.now()
    datum = jetzt.strftime("%d.%m.%Y")
    uhrzeit = jetzt.strftime("%H:%M:%S")
    anliegen_kurz = nachricht[:200].strip() + ("..." if len(nachricht) > 200 else "")

    inhalt = (
        f"Neue Kontaktanfrage eingegangen:\n\n"
        f"Name:    {name}\n"
        f"E-Mail:  {email}\n"
        f"Datum:   {datum}\n"
        f"Uhrzeit: {uhrzeit}\n\n"
        f"Anliegen:\n{anliegen_kurz}\n\n"
        f"---\n"
        f"Automatische Antwort wurde bereits an {email} gesendet."
    )

    try:
        r = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "api-key": brevo_api_key,
                "Content-Type": "application/json"
            },
            json={
                "sender":  {"name": absender_name, "email": absender_email},
                "to":      [{"email": anwalt_email}],
                "subject": f"Neue Anfrage von {name}",
                "textContent": inhalt
            }
        )
        if r.status_code in (200, 201):
            print(f"[OK] Anwalt benachrichtigt: {anwalt_email}")
            return True
        else:
            print(f"[FEHLER] Anwalt-Benachrichtigung fehlgeschlagen (Status {r.status_code}): {r.text}")
            return False
    except Exception as e:
        print(f"[FEHLER] Anwalt-Benachrichtigung fehlgeschlagen: {e}")
        return False


# ── Schritt 4: Ins Google Sheet eintragen ────────────────────────────────────
def sheet_eintragen(sheet, name: str, email: str, nachricht: str, status: str = "BEANTWORTET"):
    """Traegt den Kontakt mit Zeitstempel ins Google Sheet ein."""
    if sheet is None:
        print("[INFO] Kein Sheet verbunden – Eintrag uebersprungen.")
        return

    jetzt = datetime.now()
    datum = jetzt.strftime("%d.%m.%Y")
    uhrzeit = jetzt.strftime("%H:%M:%S")

    # Anliegen: erste 150 Zeichen der Nachricht
    anliegen = nachricht[:150].strip()
    if len(nachricht) > 150:
        anliegen += "..."

    try:
        # Header sicherstellen
        header = sheet.row_values(1)
        erwartete_header = ["Name", "E-Mail", "Datum", "Uhrzeit", "Anliegen", "Status"]
        if not header:
            sheet.insert_row(erwartete_header, 1)
            print("[INFO] Sheet-Header neu erstellt.")

        sheet.append_row([name, email, datum, uhrzeit, anliegen, status])
        print(f"[OK] Sheet-Eintrag erstellt: {name} ({email}) – {status}")
    except Exception as e:
        print(f"[FEHLER] Sheet-Eintrag fehlgeschlagen: {e}")


# ── Webhook-Endpunkt ──────────────────────────────────────────────────────────
@app.route("/kontakt", methods=["POST"])
def kontakt_webhook():
    """
    Empfaengt Kontaktformular-Daten und verarbeitet sie vollautomatisch.

    Erwartet JSON:
        { "name": str, "email": str, "nachricht": str }

    Gibt zurueck:
        { "status": "ok" | "fehler", "nachricht": str }
    """
    # Eingabe validieren
    try:
        daten = request.get_json(force=True)
        if not daten:
            return jsonify({"status": "fehler", "nachricht": "Kein JSON-Body empfangen."}), 400

        name = str(daten.get("name", "")).strip()
        email = str(daten.get("email", "")).strip()
        nachricht = str(daten.get("nachricht", "")).strip()

        if not name or not email or not nachricht:
            return jsonify({
                "status": "fehler",
                "nachricht": "Fehlende Pflichtfelder: name, email, nachricht"
            }), 400

        print(f"\n[EINGANG] Neue Kontaktanfrage von {name} ({email})")
    except Exception as e:
        print(f"[FEHLER] Eingabe-Validierung fehlgeschlagen: {e}")
        return jsonify({"status": "fehler", "nachricht": "Ungueltige Anfrage."}), 400

    # Schritt 1: Antwort generieren (bei Fehler: Fallback-Text, kein Abbruch)
    try:
        antwort_text = generiere_antwort(name, nachricht)
        print(f"[OK] Antwort generiert ({len(antwort_text)} Zeichen)")
    except Exception as e:
        print(f"[FEHLER] Antwort-Generierung fehlgeschlagen: {e}")
        schreibe_log(f"OPENAI-FEHLER fuer {name} ({e})")
        absender_name = os.environ.get("ABSENDER_NAME", "NIO Automation")
        antwort_text = (
            f"Sehr geehrte/r {name},\n\n"
            f"vielen Dank fuer Ihre Anfrage. Wir melden uns innerhalb von 24 Stunden bei Ihnen.\n\n"
            f"Mit freundlichen Gruessen\n"
            f"{absender_name}\n"
            f"{os.environ.get('ABSENDER_EMAIL', '')}\n"
            f"{os.environ.get('ABSENDER_WEBSITE', '')}"
        )

    # Schritt 2: E-Mail senden
    try:
        gesendet = sende_antwort_email(name, email, antwort_text, nachricht)
        email_status = "BEANTWORTET" if gesendet else "FEHLER_EMAIL"
    except Exception as e:
        print(f"[FEHLER] E-Mail-Versand fehlgeschlagen: {e}")
        gesendet = False
        email_status = "FEHLER_EMAIL"

    # Schritt 3: Anwalt benachrichtigen
    try:
        sende_anwalt_benachrichtigung(name, email, nachricht)
    except Exception as e:
        print(f"[FEHLER] Anwalt-Benachrichtigung fehlgeschlagen: {e}")

    # Schritt 4: Sheet-Eintrag
    try:
        sheet = sheets_verbinden()
        sheet_eintragen(sheet, name, email, nachricht, email_status)
    except Exception as e:
        print(f"[FEHLER] Sheet-Eintrag fehlgeschlagen: {e}")

    if gesendet:
        return jsonify({
            "status": "ok",
            "nachricht": f"Anfrage von {name} empfangen und beantwortet."
        }), 200
    else:
        return jsonify({
            "status": "teilweise",
            "nachricht": "Anfrage empfangen, aber E-Mail-Versand fehlgeschlagen."
        }), 207


# ── Health-Check ──────────────────────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health_check():
    """Einfacher Statuscheck."""
    return jsonify({"status": "ok", "service": "sofort_antwort_agent"}), 200


# ── Start ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("WEBHOOK_PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    print(f"[START] Sofort-Antwort-Agent laeuft auf Port {port}")
    print(f"[INFO]  Endpunkt: POST http://localhost:{port}/kontakt")
    app.run(host="0.0.0.0", port=port, debug=debug)
