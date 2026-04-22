import sys
import json
from datetime import date, timedelta


def berechne_statistiken(outreach_data: dict, sofort_antwort_data: dict) -> dict:
    """
    Kombiniert Outreach- und Sofort-Antwort-Daten zu einem einheitlichen Stats-Dict.
    Kein I/O – reine Berechnung.
    """
    kontaktiert = outreach_data.get("kontaktiert", 0)
    interessiert = outreach_data.get("interessiert", 0)

    # Conversion-Rate defensiv neu berechnen
    conversion_rate = round(interessiert / kontaktiert * 100, 1) if kontaktiert > 0 else 0.0

    offene_leads = outreach_data.get("offene_leads", [])
    datum_gestern = (date.today() - timedelta(days=1)).strftime("%d.%m.%Y")

    stats = {
        **outreach_data,
        **sofort_antwort_data,
        "conversion_rate": conversion_rate,
        "offene_leads": offene_leads,
        "datum_gestern": datum_gestern,
        "hat_offene_leads": bool(offene_leads),
    }

    return stats


if __name__ == "__main__":
    try:
        outreach_data = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        sofort_antwort_data = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        ergebnis = berechne_statistiken(outreach_data, sofort_antwort_data)
    except Exception as e:
        ergebnis = {"fehler": str(e), "datum_gestern": "", "hat_offene_leads": False}
    print(json.dumps(ergebnis, ensure_ascii=False))
