from dotenv import load_dotenv
load_dotenv()

from tag12_reply_classifier import klassifiziere_antwort

TESTFAELLE = [
    {
        "text": "Ja, das klingt interessant. Schicken Sie mir mehr Infos.",
        "erwartet": "INTERESSE"
    },
    {
        "text": "Bitte schreiben Sie mich nicht nochmal an.",
        "erwartet": "ABLEHNUNG"
    },
    {
        "text": "Was genau kostet das und wie lange dauert die Umsetzung?",
        "erwartet": "FRAGE"
    },
    {
        "text": "Ich bin bis 15. April im Urlaub.",
        "erwartet": "ABWESENHEIT"
    },
    {
        "text": "Wir haben aktuell keine passenden Objekte.",
        "erwartet": "ABLEHNUNG"
    },
    {
        "text": "Sehr interessant! Hätten Sie Zeit für ein kurzes Gespräch?",
        "erwartet": "INTERESSE"
    },
]

print("=" * 55)
print("Classifier-Test – tag12_reply_classifier.py")
print("=" * 55)

bestanden = 0

for i, fall in enumerate(TESTFAELLE, 1):
    ergebnis = klassifiziere_antwort(fall["text"])
    ok = ergebnis == fall["erwartet"]
    if ok:
        bestanden += 1
        print(f"[OK]   Test {i}: {ergebnis}")
    else:
        print(f"[FAIL] Test {i}: Erwartet {fall['erwartet']} – Tatsächlich {ergebnis}")
        print(f"       Text: \"{fall['text']}\"")

print("=" * 55)
print(f"{bestanden} von {len(TESTFAELLE)} Tests bestanden")
