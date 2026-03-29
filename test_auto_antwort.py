import os
from dotenv import load_dotenv
load_dotenv()

from tag15_bautraeger_agent import klassifiziere_antwort, sende_calendly_antwort

print("=== TEST: Interessiert ===")
antwort = "Vielen Dank! Wir haben aktuell passende Objekte und wuerden uns gerne austauschen."
kategorie = klassifiziere_antwort(antwort)
print(f"Kategorie: {kategorie}")

if kategorie == "INTERESSE":
    print("[OK] Kategorie erkannt – sende Calendly-Link...")
    print(f"[OK] Link: {os.environ.get('CALENDLY_LINK')}")
    # Test-E-Mail statt echter Adresse
    sende_calendly_antwort("nioburing@gmail.com", "Test Bautraeger GmbH")
else:
    print(f"[WARN] Unerwartete Kategorie: {kategorie}")

print()
print("=== TEST: Ablehnung ===")
antwort2 = "Leider haben wir keine passenden Objekte in Ihrem Budget."
kategorie2 = klassifiziere_antwort(antwort2)
print(f"Kategorie: {kategorie2}")

print()
print("=== TEST: Rueckfrage ===")
antwort3 = "Fuer welchen Zeitraum suchen Sie die Wohnung?"
kategorie3 = klassifiziere_antwort(antwort3)
print(f"Kategorie: {kategorie3}")
