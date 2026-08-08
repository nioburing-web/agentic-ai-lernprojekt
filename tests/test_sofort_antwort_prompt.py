import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

system_prompt = (
    "Du schreibst eine kurze E-Mail-Antwort auf eine Kontaktformular-Anfrage fuer NIO Automation.\n\n"
    "Regeln:\n"
    "1. Satz 1: Beginne mit 'Guten Tag [Name],' und uebernimm das konkreteste Keyword der Nachricht WOERTLICH in einem Satz.\n"
    "   Beispiel Nachricht: 'Ich brauche Hilfe mit meiner Buchhaltung'\n"
    "   -> Richtig: 'Guten Tag Max, vielen Dank fuer Ihre Anfrage bezueglich Ihrer Buchhaltung.'\n"
    "   -> FALSCH: 'Guten Tag Max, ich verstehe dass Sie an einem Agenten interessiert sind der Probleme loest.'\n"
    "2. Satz 2 (letzter Satz): 'Ich melde mich innerhalb von 24 Stunden persoenlich bei Ihnen.'\n"
    "3. Genau 2 Saetze - nicht mehr, nicht weniger\n"
    "4. Keine Signatur, keine Betreffzeile, kein zusaetzlicher Text"
)

testfaelle = [
    {
        "name": "Thomas",
        "company": "Muster GmbH",
        "message": "Ich brauche Hilfe mit meiner Buchhaltung, wir haben viele offene Rechnungen.",
    },
    {
        "name": "Sandra",
        "company": None,
        "message": "Ich moechte einen Agenten bauen der automatisch E-Mails beantwortet.",
    },
    {
        "name": "Klaus",
        "company": "Bau AG",
        "message": "Wir suchen jemanden der unsere Lohnabrechnung automatisiert.",
    },
]

for fall in testfaelle:
    kontext = f"Name: {fall['name']}\n"
    if fall["company"]:
        kontext += f"Firma: {fall['company']}\n"
    kontext += f"Nachricht: {fall['message']}"

    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Schreibe die Antwort fuer:\n\n{kontext}"},
        ],
        max_tokens=100,
        temperature=0.3,
    )

    text = resp.choices[0].message.content or ""
    saetze = [s.strip() for s in text.split(".") if s.strip()]
    anzahl_saetze = len(saetze)

    print(f"\n=== Test: {fall['name']} ===")
    print(f"Betreff: Danke fuer Ihre Nachricht, {fall['name']}")
    print(f"Text: {text}")
    print(f"Saetze: {anzahl_saetze} (soll: 2)")
    if anzahl_saetze != 2:
        print("WARNUNG: Nicht genau 2 Saetze!")
    if "24 Stunden" not in text:
        print("WARNUNG: Schlusssatz fehlt!")
    if fall["name"] not in text:
        print("WARNUNG: Name nicht im Text!")

print("\nAlle Tests abgeschlossen.")
