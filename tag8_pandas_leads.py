import pandas as pd


# ── Schritt 1: CSV einlesen ──────────────────
df = pd.read_csv("leads.csv")


# Wie viele Leads haben wir?
print(f"Anzahl Leads: {len(df)}")
print()


# Erste 3 Zeilen anzeigen
print("=== Erste 3 Leads ===")
print(df.head(3))
print()


# Alle Spaltennamen anzeigen
print("=== Spalten ===")
print(df.columns.tolist())

# ── Schritt 2: Einzelne Spalten abrufen ─────


# Alle Firmennamen als Liste
print("=== Alle Firmennamen ===")
print(df["firma"].tolist())
print()


# Alle Branchen – wie viele verschiedene gibt es?
print("=== Verschiedene Branchen ===")
print(df["branche"].unique())
print()


# Nur Firmen aus München
print("=== Nur München ===")
muenchen = df[df["stadt"] == "München"]
print(muenchen[["name", "firma"]])

# ── Schritt 3: Jeden Lead einzeln verarbeiten ──
print("=== Alle Leads einzeln ===")
print()


for index, lead in df.iterrows():
    print(f"Lead {index + 1}:")
    print(f"  Name:        {lead['name']}")
    print(f"  Firma:       {lead['firma']}")
    print(f"  Branche:     {lead['branche']}")
    print(f"  Mitarbeiter: {lead['mitarbeiter']}")
    print(f"  Stadt:       {lead['stadt']}")
    print()

