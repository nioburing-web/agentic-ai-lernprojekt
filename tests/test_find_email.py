#!/usr/bin/env python3
"""
Tests für tools/find_email.py
Aufruf: python tests/test_find_email.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

bestanden = 0
fehlgeschlagen = 0


def check(bedingung: bool, nachricht: str) -> None:
    global bestanden, fehlgeschlagen
    if bedingung:
        print(f"[OK]   {nachricht}")
        bestanden += 1
    else:
        print(f"[FAIL] {nachricht}")
        fehlgeschlagen += 1


# --- Import ---
try:
    from tools.find_email import (
        normalisiere_url,
        extrahiere_emails,
        bewerte_email,
        beste_email,
        konvertiere_verschleiert,   # neu – muss implementiert werden
        KANDIDATENSEITEN_PFADE,     # neu – muss als Konstante exportiert werden
        TIMEOUT,                    # neu – muss als Konstante exportiert werden
    )
    import_ok = True
except ImportError as e:
    print(f"[FAIL] Import fehlgeschlagen: {e}")
    import_ok = False
    fehlgeschlagen += 1


# ── Test 1: normalisiere_url (bereits vorhanden) ─────────────────────────────
def test1_normalisiere_url() -> None:
    check(normalisiere_url("example.de") == "https://example.de", "http fehlt -> https ergänzt")
    check(normalisiere_url("https://example.de/") == "https://example.de", "Trailing Slash entfernt")
    check(normalisiere_url("http://example.de") == "http://example.de", "http bleibt erhalten")


# ── Test 2: bewerte_email (bereits vorhanden) ─────────────────────────────────
def test2_bewerte_email() -> None:
    check(bewerte_email("kontakt@firma.de") == 10, "Bevorzugter Prefix = Score 10")
    check(bewerte_email("info@firma.de") == -1, "Ignorierter Prefix = Score -1")
    check(bewerte_email("mueller@firma.de") == 5, "Unbekannter Prefix = Score 5")


# ── Test 3: beste_email (bereits vorhanden) ───────────────────────────────────
def test3_beste_email() -> None:
    emails = ["info@firma.de", "kontakt@firma.de", "mueller@firma.de"]
    check(beste_email(emails) == "kontakt@firma.de", "Bevorzugte E-Mail gewinnt")
    check(beste_email(["info@firma.de"]) is None, "Nur ignorierte E-Mails -> None")
    check(beste_email([]) is None, "Leere Liste -> None")


# ── Test 4: extrahiere_emails – Plain Text (bereits vorhanden) ────────────────
def test4_extrahiere_plain() -> None:
    html = "Kontaktieren Sie uns: anfragen@steuerberater-hamburg.de – wir helfen gerne."
    emails = extrahiere_emails(html, "steuerberater-hamburg.de")
    check("anfragen@steuerberater-hamburg.de" in emails, "E-Mail aus Fließtext extrahiert")

    html_fremd = "Schreiben Sie an info@anderedomain.de"
    emails_fremd = extrahiere_emails(html_fremd, "eigene-kanzlei.de")
    check(len(emails_fremd) == 0, "Fremde Domain wird herausgefiltert")


# ── Test 5: konvertiere_verschleiert (NEU – scheitert vor Implementierung) ────
def test5_verschleierte_emails() -> None:
    check(
        konvertiere_verschleiert("info [at] firma [dot] de") == "info@firma.de",
        "Konvertierung: [at] und [dot] -> @  und ."
    )
    check(
        konvertiere_verschleiert("mail (at) kanzlei.de") == "mail@kanzlei.de",
        "Konvertierung: (at) -> @"
    )
    check(
        konvertiere_verschleiert("office AT buchhaltung DOT de") == "office@buchhaltung.de",
        "Konvertierung: ` AT ` und ` DOT ` (Großbuchstaben)"
    )
    # Echter Text darf nicht beschädigt werden
    unveraendert = "Das ist ein normaler Satz ohne E-Mail."
    check(
        konvertiere_verschleiert(unveraendert) == unveraendert,
        "Text ohne E-Mail wird nicht verändert"
    )


# ── Test 6: extrahiere_emails erkennt verschleierte E-Mails (NEU) ─────────────
def test6_extrahiere_verschleiert() -> None:
    html = "Schreiben Sie an: buchhalter [at] kanzlei-berlin [dot] de"
    emails = extrahiere_emails(html, "kanzlei-berlin.de")
    check(
        "buchhalter@kanzlei-berlin.de" in emails,
        "Verschleierte E-Mail wird nach Konvertierung gefunden"
    )

    html_mailto = '<a href="mailto:office@steuerberater.de">Kontakt</a>'
    emails_mailto = extrahiere_emails(html_mailto, "steuerberater.de")
    check(
        "office@steuerberater.de" in emails_mailto,
        "E-Mail aus mailto:-Link gefunden"
    )


# ── Test 7: KANDIDATENSEITEN_PFADE enthält alle Pflichtseiten (NEU) ────────────
def test7_kandidatenseiten() -> None:
    pflichtseiten = ["/impressum", "/kontakt", "/contact", "/about", "/ueber-uns", "/datenschutz"]
    for pfad in pflichtseiten:
        check(pfad in KANDIDATENSEITEN_PFADE, f"Kandidatenseite vorhanden: {pfad}")


# ── Test 8: TIMEOUT ist 10 Sekunden (NEU) ─────────────────────────────────────
def test8_timeout() -> None:
    check(TIMEOUT == 10, f"Timeout = 10 Sekunden (aktuell: {TIMEOUT})")


# ── Alle Tests ausführen ──────────────────────────────────────────────────────
print("=== find_email.py Tests ===\n")

if import_ok:
    test1_normalisiere_url()
    test2_bewerte_email()
    test3_beste_email()
    test4_extrahiere_plain()
    test5_verschleierte_emails()
    test6_extrahiere_verschleiert()
    test7_kandidatenseiten()
    test8_timeout()

print(f"\n=== Ergebnis: {bestanden} bestanden, {fehlgeschlagen} fehlgeschlagen ===")
if fehlgeschlagen > 0:
    sys.exit(1)
