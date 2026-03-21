from dotenv import load_dotenv
import os
import requests
import time
from openai import OpenAI


load_dotenv()
client         = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
MAILGUN_API_KEY = os.environ.get("MAILGUN_API_KEY")
MAILGUN_DOMAIN  = os.environ.get("MAILGUN_DOMAIN")
CALENDLY_LINK   = os.environ.get("CALENDLY_LINK")
TEST_EMAIL      = "nioburing@gmail.com"  # Deine eigene E-Mail


# ── Funktion 1: Antwort klassifizieren ───────
def klassifiziere_antwort(antwort_text):
    """Klassifiziert eine E-Mail-Antwort in 4 Kategorien"""
    prompt = f"""
Klassifiziere diese E-Mail-Antwort.


Text: {antwort_text}


Kategorien:
INTERESSE   – möchte mehr wissen oder Termin
ABLEHNUNG   – kein Interesse
FRAGE       – stellt konkrete Fragen
ABWESENHEIT – nicht erreichbar


Antworte NUR mit einem Wort: INTERESSE, ABLEHNUNG, FRAGE, oder ABWESENHEIT.
"""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=10,
        temperature=0.1
    )
    return response.choices[0].message.content.strip().upper()

# ── Funktion 2: E-Mail senden ────────────────
def sende_email(an, betreff, text):
    r = requests.post(
        f"https://api.mailgun.net/v3/{MAILGUN_DOMAIN}/messages",
        auth=("api", MAILGUN_API_KEY),
        data={"from": f"AI Agent <mailgun@{MAILGUN_DOMAIN}>",
              "to": [an], "subject": betreff, "text": text}
    )
    return r.status_code == 200


# ── Funktion 3: Auf Antwort reagieren ────────
def reagiere_auf_antwort(name, firma, kategorie, antwort_text):
    """Führt die richtige Aktion basierend auf der Kategorie aus"""


    if kategorie == "INTERESSE":
        # Calendly-Link senden
        text = f"""Vielen Dank für Ihr Interesse, {name}!


Ich freue mich über Ihre positive Rückmeldung.
Hier können Sie direkt einen Termin buchen:
{CALENDLY_LINK}


Ich freue mich auf unser Gespräch!


Mit freundlichen Grüßen
Nio Buering
AI Automation Specialist
+49 123 456789
"""


        erfolg = sende_email(TEST_EMAIL,
                             f"Re: Kurze Frage zu {firma}",
                             text)
        return f"✅ Calendly-Link gesendet an {name}"


    elif kategorie == "ABLEHNUNG":
        # Höflich bestätigen
        text = f"""Vielen Dank für Ihre Rückmeldung, {name}.


Ich respektiere Ihre Entscheidung und melde mich nicht mehr.
Sollte sich Ihre Situation ändern, stehe ich gerne zur Verfügung.


Mit freundlichen Grüßen
Nio Buering
AI Automation Specialist
+49 123 456789"""


        erfolg = sende_email(TEST_EMAIL,
                             f"Re: Kurze Frage zu {firma}",
                             text)
        return f"❌ Ablehnung bestätigt für {name}"


    elif kategorie == "FRAGE":
        # Auf Human-Review-Liste
        return f"❓ MANUELL PRÜFEN: {name} hat Fragen gestellt"


    elif kategorie == "ABWESENHEIT":
        # Notieren und später nochmal kontaktieren
        return f"🏖️ ABWESENHEIT notiert für {name} – später nochmal kontaktieren"


    return f"❓ UNBEKANNT: {name} – manuell prüfen"

# ── Test: Simulierte Antworten ───────────────
# In der Praxis kommen diese aus der Gmail API
# Heute simulieren wir sie direkt im Code


test_antworten = [
    {
        "name":   "Thomas Müller",
        "firma":  "Müller Steuerberatung",
        "text":   "Guten Tag, das klingt interessant! Wie viel würde so etwas kosten? Wann hätten Sie Zeit für ein kurzes Gespräch? Ich wäre diese Woche verfügbar."
    },
    {
        "name":   "Anna Schmidt",
        "firma":  "Schmidt Immobilien",
        "text":   "Vielen Dank für Ihre Nachricht, aber wir haben derzeit kein Interesse an solchen Diensten vielleicht werden wir in Zukunft interessiert sein."
    },
    {
        "name":   "Peter Koch",
        "firma":  "Koch Logistik",
        "text":   "Was genau würde der Agent bei uns automatisieren? Und was sind die monatlichen Kosten? welches system setzen Sie denn voraus?"
    },
    {
        "name":   "Maria Weber",
        "firma":  "Weber Rechtsanwälte",
        "text":   "Ich bin bis zum 15. Januar im Urlaub. Bitte kontaktieren Sie mich danach erneut."
    },
]


# ── Haupt-Loop: Alle Antworten verarbeiten ───
print("🤖 Reply-Classifier startet...")
print()
human_review = []  # Liste für manuelle Fälle


for antwort in test_antworten:
    print(f"📧 Antwort von: {antwort['name']} ({antwort['firma']})")
    print(f"   Text: {antwort['text'][:60]}...")


    # Klassifizieren
    kategorie = klassifiziere_antwort(antwort["text"])
    print(f"   Kategorie: {kategorie}")


    # Reagieren
    ergebnis = reagiere_auf_antwort(
        antwort["name"],
        antwort["firma"],
        kategorie,
        antwort["text"]
    )
    print(f"   Aktion: {ergebnis}")


    # Fälle für manuelle Prüfung sammeln
    if kategorie in ["FRAGE", "ABWESENHEIT", "UNBEKANNT"]:
        human_review.append({
            "name":      antwort["name"],
            "firma":     antwort["firma"],
            "kategorie": kategorie,
            "text":      antwort["text"]
        })


    print()
    time.sleep(1)


# ── Zusammenfassung ──────────────────────────
print("=" * 50)
print("ZUSAMMENFASSUNG")
print("=" * 50)
print(f"Verarbeitet: {len(test_antworten)} Antworten")
print(f"Automatisch erledigt: {len(test_antworten) - len(human_review)}")
print(f"Braucht deine Aufmerksamkeit: {len(human_review)}")
print()


if human_review:
    print("📋 DEINE AUFGABEN FÜR HEUTE:")
    for fall in human_review:
        print(f"  → {fall['name']} ({fall['firma']}) – {fall['kategorie']}")
        print(f"    Text: {fall['text'][:80]}...")
        print()

