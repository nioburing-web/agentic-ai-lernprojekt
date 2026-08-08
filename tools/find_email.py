"""
Tool: find_email.py
Zweck: Findet E-Mail-Adresse einer Firma anhand ihrer Website-URL
Aufruf: python tools/find_email.py <website_url>
"""

import re
import sys
import json
import logging
from urllib.parse import urljoin, urlparse

try:
    import requests
except ImportError:
    print(json.dumps({"email": None, "fehler": "requests nicht installiert"}))
    sys.exit(0)

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

# Timeout pro Seite in Sekunden
TIMEOUT = 10

# Kandidatenseiten-Pfade in Reihenfolge (Impressum zuerst als Fallback – gesetzlich Pflicht)
KANDIDATENSEITEN_PFADE = [
    "",           # Hauptseite
    "/impressum", # Pflichtfeld nach §5 TMG – enthält fast immer E-Mail
    "/kontakt",
    "/contact",
    "/ueber-uns",
    "/about",
    "/datenschutz",
]

# E-Mail-Muster für normale und mailto:-Links
EMAIL_PATTERN = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}"
)

# Verschleierungs-Muster: "info [at] firma [dot] de" → "info@firma.de"
# Erste Alternative: Brackets wie [at], (at), {at} mit optionalen Leerzeichen drumherum
# Zweite Alternative: Standalone " at " / " AT " nur wenn von Leerzeichen umgeben
_VERSCHLEIERUNG_AT = re.compile(
    r"\s*[\[\({]\s*(?:at|AT)\s*[\]\)}]\s*|\s+(?:at|AT)\s+"
)
_VERSCHLEIERUNG_DOT = re.compile(
    r"\s*[\[\({]\s*(?:dot|DOT)\s*[\]\)}]\s*|\s+(?:dot|DOT)\s+"
)

IGNORIERTE_PREFIXES = {
    "info", "noreply", "no-reply", "support", "postmaster",
    "webmaster", "admin", "newsletter", "news", "spam",
    "abuse", "mailer-daemon",
}

BEVORZUGTE_PREFIXES = {
    "kontakt", "contact", "mail", "office", "anfragen",
    "anfrage", "buchung", "beratung", "kanzlei",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "de-DE,de;q=0.9",
}


def normalisiere_url(url: str) -> str:
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url.rstrip("/")


def konvertiere_verschleiert(text: str) -> str:
    """
    Wandelt verschleierte E-Mails um:
    "info [at] firma [dot] de" → "info@firma.de"
    "mail (at) kanzlei.de"    → "mail@kanzlei.de"
    "office AT firma DOT de"  → "office@firma.de"
    """
    # Ersetze [at]/(at)/AT (mit optionalen Leerzeichen/Klammern) durch @
    result = _VERSCHLEIERUNG_AT.sub("@", text)
    # Ersetze [dot]/(dot)/DOT nur wenn kein echter Punkt folgt (verhindert Doppel-Konvertierung)
    result = _VERSCHLEIERUNG_DOT.sub(".", result)
    return result


def extrahiere_emails(text: str, basis_domain: str) -> list[str]:
    """Extrahiert E-Mails aus Text – inkl. verschleierter Varianten und mailto:-Links."""
    # Verschleierte Emails zuerst konvertieren
    text_konvertiert = konvertiere_verschleiert(text)

    gefunden = EMAIL_PATTERN.findall(text_konvertiert)
    ergebnis = []
    for email in gefunden:
        email = email.lower().strip(".,;)")
        domain = email.split("@")[1] if "@" in email else ""
        if basis_domain not in domain:
            continue
        ergebnis.append(email)
    return list(dict.fromkeys(ergebnis))


def bewerte_email(email: str) -> int:
    """Höhere Zahl = besser. Ignorierte = -1."""
    prefix = email.split("@")[0]
    if prefix in IGNORIERTE_PREFIXES:
        return -1
    if prefix in BEVORZUGTE_PREFIXES:
        return 10
    return 5


def beste_email(emails: list[str]) -> str | None:
    """Wählt die beste E-Mail aus der Liste."""
    bewertet = [(bewerte_email(e), e) for e in emails]
    bewertet.sort(key=lambda x: x[0], reverse=True)
    bester_score, beste = bewertet[0] if bewertet else (-1, None)
    if bester_score < 0:
        return None
    return beste


def lade_seite(url: str) -> str | None:
    """Lädt eine Seite und gibt den Text zurück. None bei Fehler."""
    try:
        response = requests.get(url, headers=HEADERS, timeout=TIMEOUT, allow_redirects=True)
        response.raise_for_status()
        return response.text
    except Exception as e:
        logger.debug(f"  Laden fehlgeschlagen ({url}): {type(e).__name__}")
        return None


def finde_email(website_url: str) -> str | None:
    """
    Hauptfunktion: Findet die beste E-Mail-Adresse einer Website.
    Sucht auf Hauptseite, /impressum, /kontakt und weiteren Seiten.
    """
    url = normalisiere_url(website_url)
    parsed = urlparse(url)
    basis_domain = parsed.netloc.replace("www.", "")

    logger.info(f"Suche E-Mail für: {basis_domain}")

    alle_emails: list[str] = []
    seiten_besucht = 0
    fund_seite: str | None = None

    for pfad in KANDIDATENSEITEN_PFADE:
        seite_url = url if pfad == "" else urljoin(url, pfad)
        seiten_label = pfad if pfad else "(Hauptseite)"

        logger.info(f"  Prüfe {seiten_label} ...")
        inhalt = lade_seite(seite_url)
        seiten_besucht += 1

        if not inhalt:
            logger.info(f"  → Nicht erreichbar")
            continue

        emails = extrahiere_emails(inhalt, basis_domain)
        if not emails:
            logger.info(f"  → Keine E-Mail gefunden")
            continue

        logger.info(f"  → {len(emails)} E-Mail(s) gefunden: {emails}")
        alle_emails.extend(emails)

        # Frühzeitiger Abbruch bei bevorzugter E-Mail
        for email in emails:
            if email.split("@")[0] in BEVORZUGTE_PREFIXES:
                logger.info(f"  ✓ Bevorzugte E-Mail gefunden auf {seiten_label}: {email}")
                return email

    logger.info(f"  Seiten besucht: {seiten_besucht}")

    if not alle_emails:
        logger.info(f"  ✗ Keine E-Mail gefunden auf {basis_domain}")
        return None

    ergebnis = beste_email(list(dict.fromkeys(alle_emails)))
    if ergebnis:
        logger.info(f"  ✓ Beste E-Mail: {ergebnis}")
    else:
        logger.info(f"  ✗ Nur ignorierte Prefixes (info@, noreply@ etc.) gefunden")
    return ergebnis


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Aufruf: python tools/find_email.py <website_url>")
        print("Beispiel: python tools/find_email.py https://steuerberater-example.de")
        sys.exit(1)

    website = sys.argv[1]

    try:
        email = finde_email(website)
        print(json.dumps({"email": email, "fehler": None}))
    except Exception as e:
        logger.error(f"Unerwarteter Fehler: {e}")
        print(json.dumps({"email": None, "fehler": str(e)}))
