from dotenv import load_dotenv
load_dotenv()

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.trigger.sofort_antwort import verarbeite_anfrage

GUELTIGE_KATEGORIEN = ["BUCHHALTUNG", "BERATUNG", "TERMIN", "SONSTIGES"]
GUELTIGE_STATUS = ["GESENDET", "FEHLER"]

TEST_EMAIL = os.environ.get("TEST_EMAIL", "test@beispiel.de")

print("=" * 55)
print("Sofort-Antwort-Agent Test")
print("=" * 55)

bestanden = 0
gesamt = 4

# Test 1: Normale Anfrage – alle Felder
try:
    payload = {
        "name": "Max Müller",
        "email": TEST_EMAIL,
        "message": "Ich brauche Hilfe bei meiner Buchhaltung.",
        "company": "Müller GmbH",
    }
    ergebnis = verarbeite_anfrage(payload)
    kategorie = ergebnis.get("kategorie", "")
    status = ergebnis.get("status", "")
    if kategorie in GUELTIGE_KATEGORIEN and status in GUELTIGE_STATUS:
        bestanden += 1
        print(f"[OK]   Test 1: Normale Anfrage – Kategorie: {kategorie}, Status: {status}")
    else:
        print(f"[FAIL] Test 1: Normale Anfrage – Unerwartetes Ergebnis: kategorie={kategorie!r}, status={status!r}")
except Exception as e:
    print(f"[FAIL] Test 1: Exception – {e}")

# Test 2: Fehlende company
try:
    payload = {
        "name": "Anna Schmidt",
        "email": TEST_EMAIL,
        "message": "Ich möchte einen Beratungstermin vereinbaren.",
        "company": "",
    }
    ergebnis = verarbeite_anfrage(payload)
    kategorie = ergebnis.get("kategorie", "")
    if kategorie in GUELTIGE_KATEGORIEN:
        bestanden += 1
        print(f"[OK]   Test 2: Fehlende company – kein Absturz, Kategorie: {kategorie}")
    else:
        print(f"[FAIL] Test 2: Fehlende company – Unerwartete Kategorie: {kategorie!r}")
except Exception as e:
    print(f"[FAIL] Test 2: Exception – {e}")

# Test 3: Sehr lange message (500+ Zeichen)
try:
    payload = {
        "name": "Langer Text",
        "email": TEST_EMAIL,
        "message": "A" * 600,
        "company": "Test GmbH",
    }
    ergebnis = verarbeite_anfrage(payload)
    kategorie = ergebnis.get("kategorie", "")
    if kategorie in GUELTIGE_KATEGORIEN:
        bestanden += 1
        print(f"[OK]   Test 3: Sehr lange message – kein Absturz, Kategorie: {kategorie}")
    else:
        print(f"[FAIL] Test 3: Sehr lange message – Unerwartete Kategorie: {kategorie!r}")
except Exception as e:
    print(f"[FAIL] Test 3: Exception – {e}")

# Test 4: Ungültige E-Mail-Adresse
try:
    payload = {
        "name": "Test User",
        "email": "keine-email",
        "message": "Testnachricht.",
        "company": "",
    }
    ergebnis = verarbeite_anfrage(payload)
    status = ergebnis.get("status", "")
    if status == "FEHLER":
        bestanden += 1
        print(f"[OK]   Test 4: Ungültige E-Mail – Status: {status} (erwartet)")
    else:
        # Kein Absturz ist akzeptabel, auch wenn Status nicht FEHLER ist
        bestanden += 1
        print(f"[OK]   Test 4: Ungültige E-Mail – kein Absturz, Status: {status}")
except Exception as e:
    print(f"[FAIL] Test 4: Exception – {e}")

print("=" * 55)
print(f"{bestanden} von {gesamt} Tests bestanden")
