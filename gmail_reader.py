"""
gmail_reader.py – Liest neue Bautraeger-Antworten aus Gmail via IMAP.

Benoetigt in .env:
    GMAIL_USER         = nioburing@gmail.com
    GMAIL_APP_PASSWORD = xxxx xxxx xxxx xxxx   (Google App-Passwort)
"""

import os
import imaplib
import email
import csv
from email.header import decode_header
from dotenv import load_dotenv

load_dotenv()

IMAP_SERVER = "imap.gmail.com"
IMAP_PORT   = 993


def lade_bekannte_emails() -> dict:
    """
    Laedt alle bekannten Bautraeger-E-Mail-Adressen aus bautraeger.csv.
    Gibt ein Dict zurueck: {email_lower: firmenname}
    """
    bekannt = {}
    try:
        with open("bautraeger.csv", "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for zeile in reader:
                email_adresse = zeile.get("email", "").lower().strip()
                firma = zeile.get("firma", "")
                if email_adresse:
                    bekannt[email_adresse] = firma
    except FileNotFoundError:
        print("[WARNUNG] bautraeger.csv nicht gefunden.")
    return bekannt


def dekodiere_header(wert: str) -> str:
    """Dekodiert E-Mail-Header (z.B. UTF-8 oder Base64 kodierte Betreffzeilen)."""
    teile = decode_header(wert)
    ergebnis = ""
    for teil, encoding in teile:
        if isinstance(teil, bytes):
            ergebnis += teil.decode(encoding or "utf-8", errors="replace")
        else:
            ergebnis += teil
    return ergebnis


def extrahiere_text(msg) -> str:
    """Extrahiert den Plaintext-Body einer E-Mail."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                try:
                    return part.get_payload(decode=True).decode(
                        part.get_content_charset() or "utf-8", errors="replace"
                    )
                except Exception:
                    continue
    else:
        try:
            return msg.get_payload(decode=True).decode(
                msg.get_content_charset() or "utf-8", errors="replace"
            )
        except Exception:
            return ""
    return ""


def lese_neue_antworten() -> list:
    """
    Verbindet sich mit Gmail via IMAP und liest ungelesene E-Mails.
    Filtert auf Antworten von bekannten Bautraeger-Adressen.

    Gibt zurueck: [{firma, absender, betreff, text}]
    """
    gmail_user     = os.environ.get("GMAIL_USER", "")
    gmail_password = os.environ.get("GMAIL_APP_PASSWORD", "")

    if not gmail_user or not gmail_password:
        print("[FEHLER] GMAIL_USER oder GMAIL_APP_PASSWORD nicht in .env gesetzt.")
        return []

    bekannte_emails = lade_bekannte_emails()
    antworten = []

    try:
        print(f"[GMAIL] Verbinde mit {IMAP_SERVER}...")
        verbindung = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
        verbindung.login(gmail_user, gmail_password)
        verbindung.select("INBOX")

        # Ungelesene E-Mails suchen
        _, nachrichten = verbindung.search(None, "UNSEEN")
        ids = nachrichten[0].split()
        print(f"[GMAIL] {len(ids)} ungelesene E-Mail(s) gefunden.")

        for msg_id in ids:
            _, daten = verbindung.fetch(msg_id, "(RFC822)")
            raw = daten[0][1]
            msg = email.message_from_bytes(raw)

            absender  = dekodiere_header(msg.get("From", ""))
            betreff   = dekodiere_header(msg.get("Subject", ""))
            text      = extrahiere_text(msg)

            # Absender-E-Mail extrahieren
            absender_email = ""
            if "<" in absender and ">" in absender:
                absender_email = absender.split("<")[1].rstrip(">").lower().strip()
            else:
                absender_email = absender.lower().strip()

            # Nur Antworten von bekannten Bautraegern verarbeiten
            if absender_email in bekannte_emails:
                firma = bekannte_emails[absender_email]
                print(f"[GMAIL] Antwort von Bautraeger: {firma} ({absender_email})")
                antworten.append({
                    "firma":   firma,
                    "absender": absender_email,
                    "betreff": betreff,
                    "text":    text
                })
            else:
                print(f"[GMAIL] Unbekannter Absender uebersprungen: {absender_email}")

        verbindung.logout()
        print(f"[GMAIL] {len(antworten)} Bautraeger-Antwort(en) gefunden.")

    except imaplib.IMAP4.error as e:
        print(f"[FEHLER] IMAP-Login fehlgeschlagen: {e}")
        print("[HINWEIS] Stelle sicher dass GMAIL_APP_PASSWORD korrekt ist.")
    except Exception as e:
        print(f"[FEHLER] Gmail-Verbindung: {e}")

    return antworten
