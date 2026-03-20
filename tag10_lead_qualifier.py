from dotenv import load_dotenv
import os
import pandas as pd
import time
from openai import OpenAI


load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


# CSV einlesen
df = pd.read_csv("leads.csv")
print(f"✅ {len(df)} Leads geladen.")
print()


# Spalten vorbereiten
df["score"]      = 0
df["begruendung"] = ""
df["email"]      = ""
df["status"]     = ""

# ── Funktion 1: Lead bewerten ────────────────
def bewerte_lead(lead):
    prompt = f"""
Bewerte diesen Lead für einen AI-Automatisierungsservice.
Firmen mit 10-50 Mitarbeitern und vielen Routineaufgaben bekommen hohe Scores.


Firma: {lead["firma"]}
Branche: {lead["branche"]}
Mitarbeiter: {lead["mitarbeiter"]}
Notizen: {lead["notizen"]}


Antworte NUR mit einer einzigen Zahl zwischen 1 und 10. Kein anderer Text.
"""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=5,
        temperature=0.2
    )
    return int(response.choices[0].message.content.strip())

# ── Funktion 2: E-Mail generieren ───────────
def generiere_email(lead, score):
    prompt = f"""
Du bist ein erfahrener B2B-Vertriebler.
Schreibe eine kurze Cold-Email (maximal 5 Sätze) an:


Name: {lead["name"]}
Firma: {lead["firma"]}
Branche: {lead["branche"]}
Mitarbeiter: {lead["mitarbeiter"]}
Besonderheit: {lead["notizen"]}


Biete an: Ein AI-Agent der ihre häufigsten Routineaufgaben automatisiert um Zeit zu sparen.
Wenn die Branche Steuerberatung oder Rechtsberatung ist: formeller und sachlicher Ton.
Wenn die Branche IT oder Marketing ist: lockerer und freundlicher Ton.
Sonst: sachlich und direkt.
Ende mit einer einfachen Frage nach einem 15-Minuten-Gespräch.
Ausgabe: Nur die E-Mail selbst, kein Betreff, keine Erklärungen.
"""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=250,
        temperature=0.7
    )
    return response.choices[0].message.content.strip()

# ── Haupt-Loop: Jeden Lead verarbeiten ───────
print("🤖 Starte Lead-Qualifier-Agent...")
print()


for index, lead in df.iterrows():
    print(f"[{index+1}/{len(df)}] {lead['firma']}")


    # Schritt 1: Bewerten
    score = bewerte_lead(lead)
    df.at[index, "score"] = score
    time.sleep(1)


    # Schritt 2: Entscheidung
    if score >= 8:
        # Top-Lead: E-Mail generieren
        email = generiere_email(lead, score)
        df.at[index, "email"]  = email
        df.at[index, "status"] = "TOP - E-Mail bereit"
        print(f"   🔥 Score: {score}/10 → E-Mail generiert")
        time.sleep(2)


    elif score >= 5:
        # Mittlerer Lead: Merken für später
        df.at[index, "status"] = "MITTEL - Manuell prüfen"
        print(f"   ✅ Score: {score}/10 → Für manuelle Prüfung")


    else:
        # Schwacher Lead: Überspringen
        df.at[index, "status"] = "NIEDRIG - Übersprungen"
        print(f"   ❌ Score: {score}/10 → Übersprungen")


    print()
    time.sleep(1)

# ── Ergebnisse speichern ─────────────────────
df_sortiert = df.sort_values("score", ascending=False)
df_sortiert.to_csv("leads_final.csv", index=False)
print("💾 Gespeichert in: leads_final.csv")
print()


# ── Zusammenfassung ──────────────────────────
top    = df[df["status"].str.startswith("TOP")]
mittel = df[df["status"].str.startswith("MITTEL")]
niedrig = df[df["status"].str.startswith("NIEDRIG")]


print("=" * 50)
print("ERGEBNIS DES LEAD-QUALIFIER-AGENTEN")
print("=" * 50)
print(f"🔥 Top Leads mit E-Mail:    {len(top)}")
print(f"✅ Mittlere Leads:          {len(mittel)}")
print(f"❌ Übersprungene Leads:     {len(niedrig)}")
print()


# Top-Leads mit E-Mail anzeigen
print("🔥 TOP LEADS – GENERIERTE E-MAILS:")
print()
for index, lead in top.iterrows():
    print(f"Firma: {lead['firma']} (Score: {lead['score']})")
    print(f"An: {lead['name']}")
    print()
    print(lead["email"])
    print("-" * 40)
    print()

