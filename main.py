import os
import sys
import subprocess
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()


def log(schritt: int, nachricht: str):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Schritt {schritt}: {nachricht}")


def trennlinie():
    print("-" * 55)


print("=" * 55)
print("NIO Automation – Haupt-Pipeline")
print(f"Start: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("=" * 55)


# ── Schritt 1: Neue Bautraeger recherchieren ──────────────
trennlinie()
log(1, "maps_recherche.py startet – neue Bautraeger suchen...")
try:
    from maps_recherche import recherchiere_alle_regionen
    recherchiere_alle_regionen()
    log(1, "Erfolgreich – neue Bautraeger in bautraeger.csv geschrieben.")
except Exception as e:
    log(1, f"FEHLER – {e}")


# ── Schritt 2: Bautraeger bewerten & E-Mails senden ───────
trennlinie()
log(2, "tag15_bautraeger_agent.py startet – Bewertung & E-Mail-Versand...")
try:
    ergebnis = subprocess.run(
        [sys.executable, "tag15_bautraeger_agent.py"],
        capture_output=False,
        text=True
    )
    if ergebnis.returncode == 0:
        log(2, "Erfolgreich – Bautraeger bewertet, E-Mails gesendet, Sheet aktualisiert.")
    else:
        log(2, f"FEHLER – Exitcode {ergebnis.returncode}")
except Exception as e:
    log(2, f"FEHLER – {e}")


# ── Schritt 3: Gmail lesen & Antworten klassifizieren ─────
trennlinie()
log(3, "Gmail startet – ungelesene Bautraeger-Antworten lesen...")
antworten = []
try:
    from gmail_reader import lese_neue_antworten
    from tag15_bautraeger_agent import klassifiziere_antwort
    antworten = lese_neue_antworten()
    for antwort in antworten:
        kategorie = klassifiziere_antwort(antwort["text"])
        antwort["kategorie"] = kategorie
        print(f"  {antwort['firma']} → {kategorie}")
    log(3, f"Erfolgreich – {len(antworten)} Antwort(en) klassifiziert.")
except Exception as e:
    log(3, f"FEHLER – {e}")


# ── Schritt 4: Automatisch auf Antworten reagieren ────────
trennlinie()
log(4, "Antwort-Verarbeitung startet – automatisch reagieren...")
try:
    if not antworten:
        log(4, "Keine Antworten vorhanden – nichts zu tun.")
    else:
        from tag15_bautraeger_agent import verarbeite_bautraeger_antwort, sheet
        for antwort in antworten:
            verarbeite_bautraeger_antwort(
                sheet            = sheet,
                firma            = antwort["firma"],
                antwort_text     = antwort["text"],
                empfaenger_email = antwort["absender"]
            )
        log(4, f"Erfolgreich – {len(antworten)} Antwort(en) verarbeitet.")
except Exception as e:
    log(4, f"FEHLER – {e}")


# ── Abschluss ─────────────────────────────────────────────
trennlinie()
print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Pipeline abgeschlossen.")
print("=" * 55)
