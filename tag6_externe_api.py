import requests

# ── Externe API aufrufen ──────────────────────
# Die Frankfurter API ist kostenlos und braucht keinen Key
url = "https://api.frankfurter.app/latest?from=EUR&to=USD,GBP,CHF"

print("Rufe aktuelle Wechselkurse ab...")
antwort = requests.get(url)

# Antwort als Python-Wörterbuch (JSON) lesen
daten = antwort.json()

# Was steckt in der Antwort?
print(f"Stand: {daten['date']}")
print(f"Basis-Währung: {daten['base']}")
print()

# Wechselkurse ausgeben
print("Aktuelle Kurse:")
for waehrung, kurs in daten["rates"].items():
    print(f"  1 EUR = {kurs} {waehrung}")
