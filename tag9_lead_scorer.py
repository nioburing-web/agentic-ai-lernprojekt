from dotenv import load_dotenv
import os
import pandas as pd
import time
from openai import OpenAI


load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


# ── Schritt 1: CSV einlesen ──────────────────
df = pd.read_csv("leads.csv")
print(f"✅ {len(df)} Leads geladen.")
print()


# Neue Spalten für Score und Begründung vorbereiten
df["score"] = 0
df["begruendung"] = ""

# ── Schritt 2: Scoring-Funktion ─────────────
def bewerte_lead(lead):
    """Bewertet einen einzelnen Lead mit AI – gibt Score 1-10 zurück"""


    # Score-Prompt – AI gibt NUR eine Zahl zurück
    score_prompt = f"""
Bewerte diesen Lead für einen AI-Automatisierungsservice.
Unternehmen die viele manuelle Routineaufgaben haben bekommen höhere Scores.
bevorzugt werden firmen mit 10-20 mitarbeitern in den branchen steuerberatung,logistik,personalberatung,it dienstleistungen und auf manuelle datenpflege hinweisen.



Firma: {lead["firma"]}
Branche: {lead["branche"]}
Mitarbeiter: {lead["mitarbeiter"]}
Notizen: {lead["notizen"]}


Antworte NUR mit einer einzigen Zahl zwischen 1 und 10. Kein anderer Text.

"""


    score_response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": score_prompt}],
        max_tokens=5,
        temperature=0.2
    )
    score = int(score_response.choices[0].message.content.strip())


    # Begründungs-Prompt – kurze Erklärung
    begruendungs_prompt = f"""
Erkläre in einem einzigen Satz mit maximal 10 Wörtern warum {lead["firma"]} ({lead["branche"]})
ein {"guter" if score >= 7 else "mittelmäßiger" if score >= 5 else "schwacher"} Lead ist.
"""


    begruendungs_response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": begruendungs_prompt}],
        max_tokens=100,
        temperature=0.3
    )
    begruendung = begruendungs_response.choices[0].message.content.strip()


    return score, begruendung

# ── Schritt 3: Alle Leads bewerten ──────────
print("🤖 Bewerte alle Leads...")
print()


for index, lead in df.iterrows():
    print(f"Lead {index + 1}/{len(df)}: {lead['firma']}...")


    score, begruendung = bewerte_lead(lead)


    # Ergebnis in DataFrame speichern
    df.at[index, "score"] = score
    df.at[index, "begruendung"] = begruendung


    # Score visuell anzeigen
    if score >= 7:
        symbol = "🔥"
    elif score >= 5:
        symbol = "✅"
    else:
        symbol = "❌"


    print(f"   {symbol} Score: {score}/10 – {begruendung[:60]}...")
    print()


    time.sleep(2)  # Pause zwischen API-Calls

# ── Schritt 4: Ergebnisse speichern ─────────
df_sortiert = df.sort_values("score", ascending=False)
df_sortiert.to_csv("leads_bewertet.csv", index=False)
print("💾 Ergebnisse gespeichert in: leads_bewertet.csv")
print()


# ── Zusammenfassung anzeigen ─────────────────
print("=" * 50)
print("ZUSAMMENFASSUNG")
print("=" * 50)


top_leads = df_sortiert[df_sortiert["score"] >= 7]
mid_leads  = df_sortiert[(df_sortiert["score"] >= 5) & (df_sortiert["score"] < 7)]
low_leads  = df_sortiert[df_sortiert["score"] < 5]


print(f"🔥 Top Leads (Score 7-10):  {len(top_leads)}")
print(f"✅ Mittlere Leads (5-6):    {len(mid_leads)}")
print(f"❌ Schwache Leads (1-4):    {len(low_leads)}")
print()


print("🔥 TOP LEADS:")
for index, lead in top_leads.iterrows():
    print(f"   {lead['score']}/10 – {lead['firma']} ({lead['branche']})")

