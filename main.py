import os
import sys
import subprocess
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

LOG_DATEI = "agent_log.txt"
TEST_MODUS = "--test" in sys.argv


def log(schritt: int, nachricht: str, auch_datei: bool = True):
    """Gibt Nachricht im Terminal aus und schreibt sie in agent_log.txt."""
    zeitstempel = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    zeile = f"[{zeitstempel}] Schritt {schritt}: {nachricht}"
    print(zeile)
    if auch_datei:
        with open(LOG_DATEI, "a", encoding="utf-8") as f:
            f.write(zeile + "\n")


def log_header(text: str):
    """Schreibt Trennzeile und Header ins Terminal und Log."""
    zeitstempel = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    zeile = f"[{zeitstempel}] {text}"
    print("-" * 55)
    print(zeile)
    with open(LOG_DATEI, "a", encoding="utf-8") as f:
        f.write("\n" + "=" * 55 + "\n")
        f.write(zeile + "\n")


# ── Pipeline-Start ins Log schreiben ─────────────────────
with open(LOG_DATEI, "a", encoding="utf-8") as f:
    f.write("\n" + "=" * 55 + "\n")
    f.write(f"Pipeline-Start: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    f.write("=" * 55 + "\n")

print("=" * 55)
print("NIO Automation - Haupt-Pipeline")
if TEST_MODUS:
    print("[TEST-MODUS] Keine E-Mails werden gesendet!")
print(f"Start: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("=" * 55)


# ── Schritt 1: Neue Bautraeger recherchieren ──────────────
log_header("Schritt 1 startet: Neue Bautraeger recherchieren")
neue_bautraeger = 0
try:
    from maps_recherche import recherchiere_alle_regionen, lade_bestehende_csv
    vorher = len(lade_bestehende_csv())
    recherchiere_alle_regionen()
    nachher = len(lade_bestehende_csv())
    neue_bautraeger = nachher - vorher
    log(1, f"Erfolgreich - {neue_bautraeger} neue Bautraeger in bautraeger.csv geschrieben.")
except Exception as e:
    log(1, f"FEHLER - {e}")


# ── Schritt 2: Bautraeger bewerten & E-Mails senden ───────
log_header("Schritt 2 startet: Bautraeger bewerten & E-Mails senden")
try:
    ergebnis = subprocess.run(
        [sys.executable, "tag15_bautraeger_agent.py"] + (["--test"] if TEST_MODUS else []),
        capture_output=False,
        text=True
    )
    if ergebnis.returncode == 0:
        log(2, "Erfolgreich - Bautraeger bewertet, E-Mails gesendet, Sheet aktualisiert.")
    else:
        log(2, f"FEHLER - Exitcode {ergebnis.returncode}")
except Exception as e:
    log(2, f"FEHLER - {e}")


# ── Schritt 3+4: Gmail lesen, klassifizieren, Sheet + Calendly ──
log_header("Schritt 3+4 startet: Antworten lesen, klassifizieren & reagieren")
try:
    ergebnis = subprocess.run(
        [sys.executable, "tag12_reply_classifier.py"],
        capture_output=False,
        text=True
    )
    if ergebnis.returncode == 0:
        log(3, "Erfolgreich - Antworten klassifiziert, Sheet aktualisiert, Calendly gesendet.")
    else:
        log(3, f"FEHLER - Exitcode {ergebnis.returncode}")
except Exception as e:
    log(3, f"FEHLER - {e}")


# ── Abschluss ─────────────────────────────────────────────
print("-" * 55)
abschluss = f"Pipeline abgeschlossen. Neue Bautraeger: {neue_bautraeger}"
log(0, abschluss)
print("=" * 55)
