import pandas as pd


# CSV einlesen
df = pd.read_csv("leads.csv")


# ── Analyse 1: Firmengrößen filtern ──────────
kleine_firmen  = df[df["mitarbeiter"] <= 10]
mittlere_firmen = df[(df["mitarbeiter"] > 10) & (df["mitarbeiter"] <= 20)]
grosse_firmen  = df[df["mitarbeiter"] > 20]


print("=== LEAD-ANALYSE ===")
print(f"Kleine Firmen  (≤10 MA):  {len(kleine_firmen)}")
print(f"Mittlere Firmen (11-20 MA): {len(mittlere_firmen)}")
print(f"Große Firmen   (>20 MA):  {len(grosse_firmen)}")
print()


# ── Analyse 2: Branchen zählen ───────────────
print("=== BRANCHEN ===")
branchen_count = df["branche"].value_counts()
for branche, anzahl in branchen_count.items():
    print(f"  {branche}: {anzahl} Firma(en)")
print()


# ── Analyse 3: Städte zählen ─────────────────
print("=== STÄDTE ===")
staedte_count = df["stadt"].value_counts()
for stadt, anzahl in staedte_count.items():
    print(f"  {stadt}: {anzahl} Lead(s)")
print()


# ── Analyse 4: Interessanteste Leads ─────────
# Firmen mit mehr als 8 Mitarbeitern in München oder Hamburg
top_leads = df[
    (df["mitarbeiter"] > 8) &
    (df["stadt"].isin(["München", "Hamburg"]))
]


print("=== TOP LEADS (>8 MA in München/Hamburg) ===")
for index, lead in top_leads.iterrows():
    print(f"  ★  {lead['firma']} – {lead['stadt']} ({lead['mitarbeiter']} MA)")

