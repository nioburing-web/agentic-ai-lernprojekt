from urllib import response

from dotenv import load_dotenv
import os
import requests
from openai import OpenAI

load_dotenv()

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

verlauf = [
    {"role": "system", "content": "Du bist ein hilfreicher Finanz-Assistent der sich an frühere Fragen erinnert."}
]
# ── TOOL: Wechselkurse holen ──────────────────
def hole_wechselkurs(von_waehrung, zu_waehrungen):
    """Ruft aktuelle Wechselkurse von externer API ab"""
    url = f"https://api.frankfurter.app/latest?from={von_waehrung}&to={zu_waehrungen}"
    antwort = requests.get(url)
    daten = antwort.json()
    return daten


# ── AGENT: Fragen mit echten Daten beantworten ──
def beantworte_waehrungsfrage(frage):
    """Agent der echte Kurse abruft und dann AI antworten lässt"""

    # Schritt 1: Echte Daten vom Tool holen
    print("🔧 Rufe Wechselkurse ab...")
    kurse = hole_wechselkurs("EUR", "USD,GBP,CHF,JPY")
    kurs_text = f"Stand {kurse['date']}: "
    for w, k in kurse["rates"].items():
        kurs_text += f"1 EUR = {k} {w}, "

    print(f"   Aktuelle Daten: {kurs_text[:60]}...")
    print()

    # Schritt 2: Daten + Frage an AI übergeben
    prompt = f"""
Du bist ein hilfreicher Finanz-Assistent.
Aktuelle Wechselkurse: {kurs_text}
Beantworte diese Frage präzise und freundlich: {frage}
"""
    verlauf.append({"role": "user", "content": prompt})

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=verlauf,
        max_tokens=200,
        temperature=0.4
    )

    antwort = response.choices[0].message.content
    verlauf.append({"role": "assistant", "content": antwort})
    return antwort

# ── AUSFÜHREN ──────────────────────────────────
fragen = [
    "Wie viel Dollar bekomme ich für 500 Euro?",
    "und wie viel wären das in pfund?",
    "welche der drei währungen ist gerade am stärksten?",
]

print("=" * 50)
print("WECHSELKURS-AGENT")
print("=" * 50)

for frage in fragen:
    print(f"\n❓ Frage: {frage}")
    antwort = beantworte_waehrungsfrage(frage)
    print(f"🤖 Agent: {antwort}")
    print()