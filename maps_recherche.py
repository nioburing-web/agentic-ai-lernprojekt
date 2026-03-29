import os
import csv
import re
import time
import requests
from dotenv import load_dotenv

load_dotenv()

CSV_DATEI = "bautraeger.csv"

# Regionen die gesucht werden sollen
REGIONEN = [
    "Hamburg",
    "Nordsee",
    "Ostsee",
    "Mallorca"
]

# Suchbegriffe fuer Google Maps
SUCHBEGRIFFE = [
    "Bautraeger Neubau {region}",
    "Immobilien Neubau {region}",
    "Wohnungsbau {region}"
]


# ── Aufgabe 2: Bautraeger suchen ──────────────
def suche_bautraeger_google_maps(region: str, max_ergebnisse: int = 10) -> list:
    """
    Sucht Bautraeger in einer Region ueber Google Places API.
    Gibt Liste zurueck: [{name, adresse, website, telefon, ort}]
    """
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    ergebnisse = []

    for suchbegriff_template in SUCHBEGRIFFE:
        suchbegriff = suchbegriff_template.format(region=region)

        url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
        params = {
            "query": suchbegriff,
            "language": "de",
            "key": api_key
        }

        try:
            response = requests.get(url, params=params)
            daten = response.json()

            if daten.get("status") != "OK":
                print(f"[WARNUNG] Google Maps Antwort: {daten.get('status')} fuer '{suchbegriff}'")
                continue

            for ort in daten.get("results", [])[:max_ergebnisse]:
                eintrag = {
                    "name": ort.get("name", ""),
                    "adresse": ort.get("formatted_address", ""),
                    "ort": region,
                    "place_id": ort.get("place_id", "")
                }
                ergebnisse.append(eintrag)
                print(f"[GEFUNDEN] {eintrag['name']} | {region}")

            # Kurze Pause zwischen Anfragen (API-Limit vermeiden)
            time.sleep(1)

        except Exception as e:
            print(f"[FEHLER] Google Maps Suche fuer '{suchbegriff}': {e}")

    return ergebnisse


# ── Aufgabe 3: Details abrufen ────────────────
def hole_details(place_id: str) -> dict:
    """
    Holt Website und Telefonnummer eines Bautraegers ueber Place Details API.
    """
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    url = "https://maps.googleapis.com/maps/api/place/details/json"
    params = {
        "place_id": place_id,
        "fields": "name,website,formatted_phone_number,formatted_address",
        "language": "de",
        "key": api_key
    }

    try:
        response = requests.get(url, params=params)
        daten = response.json()

        if daten.get("status") == "OK":
            result = daten.get("result", {})
            return {
                "website": result.get("website", ""),
                "telefon": result.get("formatted_phone_number", "")
            }
    except Exception as e:
        print(f"[FEHLER] Details fuer place_id {place_id}: {e}")

    return {"website": "", "telefon": ""}


# ── Aufgabe 4: E-Mail extrahieren ─────────────
def extrahiere_email(website_url: str) -> str:
    """
    Versucht eine E-Mail-Adresse von der Bautraeger-Website zu lesen.
    Schaut auf der Hauptseite und auf /kontakt oder /impressum.
    """
    if not website_url:
        return ""

    seiten = [
        website_url,
        website_url.rstrip("/") + "/kontakt",
        website_url.rstrip("/") + "/impressum"
    ]

    email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'

    for seite in seiten:
        try:
            headers = {"User-Agent": "Mozilla/5.0"}
            response = requests.get(seite, headers=headers, timeout=5)

            # Mailto-Links bevorzugen
            mailto_pattern = r'mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})'
            mailto_treffer = re.findall(mailto_pattern, response.text)
            if mailto_treffer:
                print(f"[EMAIL] Gefunden: {mailto_treffer[0]} auf {seite}")
                return mailto_treffer[0]

            # Normale E-Mail suchen
            treffer = re.findall(email_pattern, response.text)
            for email in treffer:
                if not any(x in email.lower() for x in ["noreply", "no-reply", "example", "test"]):
                    print(f"[EMAIL] Gefunden: {email} auf {seite}")
                    return email

            time.sleep(0.5)

        except Exception:
            continue

    print(f"[WARNUNG] Keine E-Mail gefunden fuer: {website_url}")
    return ""


# ── Aufgabe 5: CSV speichern ──────────────────
def lade_bestehende_csv() -> set:
    """Laedt bestehende Firmennamen aus bautraeger.csv um Duplikate zu vermeiden."""
    bestehende = set()
    try:
        with open(CSV_DATEI, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for zeile in reader:
                # Unterstuetzt beide Spaltenbezeichnungen: 'name' und 'firma'
                name = zeile.get("name", zeile.get("firma", ""))
                bestehende.add(name.lower().strip())
    except FileNotFoundError:
        pass
    return bestehende


def speichere_in_csv(bautraeger_liste: list):
    """
    Speichert neue Bautraeger in bautraeger.csv.
    Ueberspringt Duplikate die bereits in der CSV stehen.
    """
    bestehende = lade_bestehende_csv()
    neu_eingetragen = 0

    csv_existiert = os.path.exists(CSV_DATEI)

    with open(CSV_DATEI, "a", newline="", encoding="utf-8") as f:
        fieldnames = [
            "firma", "email", "region", "stadt",
            "website", "notizen", "zimmer_min", "zimmer_max",
            "wohnflaeche_min", "wohnflaeche_max", "nur_neubau"
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)

        if not csv_existiert:
            writer.writeheader()

        for bautraeger in bautraeger_liste:
            name = bautraeger.get("name", "").lower().strip()

            if name in bestehende:
                print(f"[SKIP] Bereits vorhanden: {bautraeger['name']}")
                continue

            writer.writerow({
                "firma":          bautraeger.get("name", ""),
                "email":          bautraeger.get("email", ""),
                "region":         bautraeger.get("region", ""),
                "stadt":          bautraeger.get("ort", ""),
                "website":        bautraeger.get("website", ""),
                "notizen":        bautraeger.get("telefon", ""),
                "zimmer_min":     "3",
                "zimmer_max":     "4",
                "wohnflaeche_min":"70",
                "wohnflaeche_max":"100",
                "nur_neubau":     "True"
            })

            bestehende.add(name)
            neu_eingetragen += 1
            print(f"[NEU] Eingetragen: {bautraeger['name']} | {bautraeger.get('region', '')}")

    print(f"\n[FERTIG] {neu_eingetragen} neue Bautraeger in CSV gespeichert.")


# ── Aufgabe 6: Hauptfunktion ──────────────────
def recherchiere_alle_regionen(max_pro_region: int = 10):
    """
    Hauptfunktion: Sucht Bautraeger in allen Regionen
    und speichert sie in bautraeger.csv.
    """
    print("=" * 55)
    print("NIO Automation – Google Maps Bautraeger-Recherche")
    print("=" * 55)

    alle_bautraeger = []

    for region in REGIONEN:
        print(f"\n[SUCHE] Region: {region}")
        ergebnisse = suche_bautraeger_google_maps(region, max_pro_region)

        for eintrag in ergebnisse:
            if eintrag.get("place_id"):
                details = hole_details(eintrag["place_id"])
                eintrag["website"] = details.get("website", "")
                eintrag["telefon"] = details.get("telefon", "")
                time.sleep(0.5)

            if eintrag.get("website"):
                eintrag["email"] = extrahiere_email(eintrag["website"])
            else:
                eintrag["email"] = ""

            eintrag["region"] = region
            alle_bautraeger.append(eintrag)

    speichere_in_csv(alle_bautraeger)


if __name__ == "__main__":
    import sys

    # Einzelne Region testen: python maps_recherche.py --region Hamburg --anzahl 5
    if "--region" in sys.argv:
        idx = sys.argv.index("--region")
        region = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else "Hamburg"
        anzahl = int(sys.argv[sys.argv.index("--anzahl") + 1]) if "--anzahl" in sys.argv else 5

        print(f"[TEST] Suche {anzahl} Bautraeger in: {region}")
        ergebnisse = suche_bautraeger_google_maps(region, anzahl)

        for e in ergebnisse:
            if e.get("place_id"):
                details = hole_details(e["place_id"])
                e.update(details)
            if e.get("website"):
                e["email"] = extrahiere_email(e["website"])
            else:
                e["email"] = ""
            e["region"] = region

        speichere_in_csv(ergebnisse)

    else:
        # Alle Regionen durchsuchen
        recherchiere_alle_regionen(max_pro_region=10)
