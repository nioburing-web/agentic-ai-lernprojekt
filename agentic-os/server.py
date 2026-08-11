import http.server
import socketserver
import os
import subprocess
import json
from datetime import date, datetime

BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR  = os.path.normpath(os.path.join(BASE_DIR, '..'))
SKILLS_DIR   = os.path.join(BASE_DIR, '..', 'skills')
PORT = 8768

os.chdir(BASE_DIR)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(PROJECT_DIR, '.env'))
except ImportError:
    pass

try:
    import gspread
    from google.oauth2.service_account import Credentials
    SHEETS_OK = True
except ImportError:
    SHEETS_OK = False

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def _get_credentials():
    json_str = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if json_str:
        return Credentials.from_service_account_info(json.loads(json_str), scopes=SCOPES)
    path = os.environ.get("GOOGLE_CREDENTIALS_PATH",
                          os.path.join(PROJECT_DIR, "credentials.json"))
    return Credentials.from_service_account_file(path, scopes=SCOPES)


def haal_outreach_stats() -> dict:
    leer = {"gesendet": 0, "geoeffnet": 0, "geantwortet": 0,
            "positiv": 0, "offene_leads": []}
    if not SHEETS_OK:
        return leer
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not sheet_id:
        return leer
    try:
        gc = gspread.authorize(_get_credentials())
        ws = gc.open_by_key(sheet_id).worksheet("Buchhalter Outreach")
        rows = ws.get_all_values()[1:]
    except Exception as e:
        print(f"Sheets-Fehler (Outreach): {e}")
        return leer

    gesendet = geoeffnet = geantwortet = positiv = 0
    offene_leads = []
    heute = date.today()

    for r in rows:
        if len(r) < 4 or not r[3].strip():
            continue
        firma  = r[0].strip()
        status = r[2].strip().upper()
        geoeff = r[6].strip().upper() if len(r) > 6 else ""
        try:
            zeilen_datum = datetime.strptime(r[3].strip(), "%d.%m.%Y").date()
        except ValueError:
            continue
        gesendet += 1
        if geoeff == "JA":
            geoeffnet += 1
        if status in ("INTERESSIERT", "ABGELEHNT", "RÜCKFRAGE"):
            geantwortet += 1
        if status == "INTERESSIERT":
            positiv += 1
        if (heute - zeilen_datum).days >= 3 and status in ("", "KONTAKTIERT") and firma:
            offene_leads.append(firma)

    return {"gesendet": gesendet, "geoeffnet": geoeffnet,
            "geantwortet": geantwortet, "positiv": positiv,
            "offene_leads": offene_leads}


def haal_sofort_antwort_stats() -> dict:
    leer = {"anfragen": 0, "beantwortet": 0, "avg_reaktionszeit": 0.0}
    if not SHEETS_OK:
        return leer
    sheet_id = os.environ.get("GOOGLE_SHEET_ID")
    if not sheet_id:
        return leer
    try:
        gc = gspread.authorize(_get_credentials())
        ws = gc.open_by_key(sheet_id).worksheet("Sofort-Antwort")
        rows = ws.get_all_values()[1:]
    except Exception as e:
        print(f"Sheets-Fehler (Sofort-Antwort): {e}")
        return leer

    anfragen = beantwortet = 0
    zeiten = []

    for r in rows:
        if len(r) < 6 or not r[5].strip():
            continue
        status       = r[4].strip().upper()
        antwort_zeit = r[6].strip() if len(r) > 6 else ""
        reaktion_str = r[7].strip() if len(r) > 7 else ""
        anfragen += 1
        if status == "GESENDET" and antwort_zeit:
            beantwortet += 1
            try:
                zeiten.append(float(reaktion_str))
            except (ValueError, TypeError):
                pass

    avg = round(sum(zeiten) / len(zeiten), 1) if zeiten else 0.0
    return {"anfragen": anfragen, "beantwortet": beantwortet,
            "avg_reaktionszeit": avg}


def detect_domain(filename: str) -> str:
    n = filename.lower()
    if 'outreach' in n or 'email' in n or 'buchhalter' in n:
        return 'Outreach'
    if 'klassif' in n or 'kommunik' in n:
        return 'Kommunikation'
    if 'report' in n:
        return 'Reporting'
    if 'vertrieb' in n:
        return 'Vertrieb'
    if 'onboarding' in n:
        return 'Produkt'
    return 'Allgemein'


def load_skills():
    skills = []
    if not os.path.isdir(SKILLS_DIR):
        return skills
    for fname in sorted(os.listdir(SKILLS_DIR)):
        if not fname.endswith('.md'):
            continue
        path = os.path.join(SKILLS_DIR, fname)
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        skills.append({
            'name':    fname.replace('.md', ''),
            'domain':  detect_domain(fname),
            'content': content,
            'file':    fname,
        })
    return skills


class AgentOSHandler(http.server.SimpleHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def _json_response(self, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/skills':
            self._json_response(load_skills())
        elif self.path == '/api/stats':
            self._json_response(haal_outreach_stats())
        elif self.path == '/api/sofort-antwort':
            self._json_response(haal_sofort_antwort_stats())
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/run':
            length = int(self.headers.get('Content-Length', 0))
            data   = json.loads(self.rfile.read(length))
            prompt = data.get('prompt', '')

            try:
                proc = subprocess.Popen(
                    [r'C:\Users\niobu\AppData\Roaming\npm\claude.cmd', '--print', prompt],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                self._json_response({'status': 'started', 'pid': proc.pid})
            except Exception as e:
                self._json_response({'status': 'error', 'pid': 0, 'message': str(e)})
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        print(f'  {args[1]}  {args[0]}')


with socketserver.TCPServer(('', PORT), AgentOSHandler) as httpd:
    httpd.allow_reuse_address = True
    print(f'Agentic OS  →  http://localhost:{PORT}')
    httpd.serve_forever()
