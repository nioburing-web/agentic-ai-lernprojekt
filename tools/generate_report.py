import os
import sys
import json


def generiere_report(stats: dict) -> dict:
    """
    Generiert den E-Mail-Report auf Basis der kombinierten Statistiken.
    Liest Format-Regeln aus skills/reporting-qualitaet.md als Referenz.
    Max 20 Zeilen, nur Zahlen, Handlungsbedarf am Ende.
    """
    # Skill-Datei als Referenz einlesen (nicht kritisch wenn fehlt)
    basis_pfad = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    qualitaet_pfad = os.path.join(basis_pfad, "skills", "reporting-qualitaet.md")
    if not os.path.exists(qualitaet_pfad):
        print("Warnung: skills/reporting-qualitaet.md nicht gefunden.", flush=True)

    datum = stats.get("datum_gestern", "")
    betreff = f"NIO Automation Report – {datum}"

    # Abschnitt 1: Buchhalter-Outreach
    kontaktiert = stats.get("kontaktiert", 0)
    interessiert = stats.get("interessiert", 0)
    abgelehnt = stats.get("abgelehnt", 0)
    conversion_rate = stats.get("conversion_rate", 0.0)

    # Abschnitt 2: Sofort-Antwort
    anfragen = stats.get("anfragen", 0)
    beantwortet = stats.get("beantwortet", 0)
    avg_reaktionszeit = stats.get("avg_reaktionszeit_min", 0.0)
    schnellste = stats.get("schnellste_min", 0.0)

    # Abschnitt 3: Handlungsbedarf
    offene_leads = stats.get("offene_leads", [])
    if offene_leads:
        leads_text = "\n".join(f"- {firma}" for firma in offene_leads)
    else:
        leads_text = "- Keine offenen Leads"

    report_text = (
        f"Buchhalter-Outreach ({datum}):\n"
        f"- E-Mails gesendet: {kontaktiert}\n"
        f"- Interessenten: {interessiert} ({conversion_rate}%)\n"
        f"- Abgelehnt: {abgelehnt}\n"
        f"\n"
        f"Sofort-Antwort ({datum}):\n"
        f"- Anfragen: {anfragen}\n"
        f"- Beantwortet: {beantwortet}\n"
        f"- Ø Reaktionszeit: {avg_reaktionszeit} Minuten\n"
        f"- Schnellste Antwort: {schnellste} Minuten\n"
        f"\n"
        f"Handlungsbedarf (offene Leads 3+ Tage):\n"
        f"{leads_text}"
    )

    return {"betreff": betreff, "report_text": report_text}


if __name__ == "__main__":
    try:
        stats = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        ergebnis = generiere_report(stats)
    except Exception as e:
        ergebnis = {"fehler": str(e), "betreff": "", "report_text": ""}
    print(json.dumps(ergebnis, ensure_ascii=False))
