import { randomBytes } from "node:crypto";
import { schedules, wait } from "@trigger.dev/sdk";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import OpenAI from "openai";
import {
  aktiveKategorien,
  begriffeDerKategorie,
  nischeZuBegriff,
  waehleKategorie,
  type DemoProfil,
  type Kategorie,
  type Nische,
} from "./nischen";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000 });
}

function getGoogleAuth() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON fehlt");
  return new GoogleAuth({
    credentials: JSON.parse(json),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getQueue() {
  const auth = getGoogleAuth();
  const sheets = googleSheets({ version: "v4", auth });
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("GOOGLE_SHEET_ID fehlt");
  return { sheets, sheetId };
}

function fetchMitTimeout(url: string, options?: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── Outreach Queue Sheet ─────────────────────────────────────────────────────

const QUEUE_TAB = "Outreach Queue";
const QUEUE_HEADER = ["Typ", "Name", "Stadt", "Kontakt", "Entwurf", "Status", "Erstellt", "Gesendet", "Betreff"];

/**
 * Status eines frischen Entwurfs.
 *
 * morgen-versand filtert hart auf "DRAFT". Eine Kategorie in Bike-Phase 1
 * schreibt deshalb "PRUEFEN" — die Zeilen liegen im Sheet, gehen aber nicht
 * raus, bis Nio sie gelesen und auf DRAFT gesetzt hat.
 */
export type DraftStatus = "DRAFT" | "PRUEFEN";

async function sicherQueueTab(sheets: ReturnType<typeof googleSheets>, sheetId: string): Promise<void> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const tabExistiert = spreadsheet.data.sheets?.some(s => s.properties?.title === QUEUE_TAB);

  if (!tabExistiert) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: QUEUE_TAB } } }] },
    });
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!A1:I1`,
  });

  if (!response.data.values?.[0] || response.data.values[0][0] !== "Typ") {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${QUEUE_TAB}!A1:I1`,
      valueInputOption: "RAW",
      requestBody: { values: [QUEUE_HEADER] },
    });
  }

  // R/S sind die Demo-Klick-Spalten. J–Q sind belegt (Fehlergrund, Reply-Classifier,
  // Nachfass-Datum), deshalb erst ab R.
  //
  // T/U kamen mit der Nischen-Verbreiterung dazu: ohne sie lässt sich die
  // Reply-Rate nicht je Kategorie aufschlüsseln, und genau das versteckt sonst
  // den Ausreisser (Lehre aus der Betreff-Monokultur vom 17.07.2026).
  const kopfRU = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!R1:U1`,
  });
  const kopf = kopfRU.data.values?.[0] ?? [];
  if (kopf[0] !== "Demo-ID" || kopf[3] !== "Kategorie") {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${QUEUE_TAB}!R1:U1`,
      valueInputOption: "RAW",
      requestBody: { values: [["Demo-ID", "Demo geklickt", "Nische", "Kategorie"]] },
    });
  }
}

async function ladeVorhandeneKontakte(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string
): Promise<Set<string>> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!A:D`,
  });
  const rows = response.data.values ?? [];
  const kontakte = new Set<string>();
  for (const row of rows.slice(1)) {
    if (row[3]) kontakte.add((row[3] as string).toLowerCase().trim());
  }
  return kontakte;
}

// Letzte Zeile (1-basiert, ohne Header-Offset), die irgendwo in A–U noch etwas stehen hat.
// Bewusst über den ganzen Block statt nur über Spalte A: eine Zeile, deren A leer ist,
// aber deren R belegt ist, darf nicht überschrieben werden.
export function letzteBelegteZeile(rows: unknown[][]): number {
  let letzte = 0;
  rows.forEach((row, i) => {
    if (row?.some(zelle => String(zelle ?? "").trim() !== "")) letzte = i + 1;
  });
  return letzte;
}

async function speichereDraft(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  typ: "EMAIL" | "LINKEDIN",
  name: string,
  stadt: string,
  kontakt: string,
  entwurf: string,
  betreff = "",
  demoId = "",
  tab: string = QUEUE_TAB,
  status: DraftStatus = "DRAFT",
  nische = "",
  kategorie = ""
): Promise<void> {
  const heute = new Date().toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  // A–I wie gehabt, J–Q bleiben leer (gehören anderen Agenten), R = Demo-ID,
  // S = Demo geklickt (bleibt leer, füllt die Demo-Seite), T/U = Nische/Kategorie.
  const zeile = [typ, name, stadt, kontakt, entwurf, status, heute, "", betreff,
    "", "", "", "", "", "", "", "", demoId, "", nische, kategorie];

  // Kein values.append: dessen Tabellen-Erkennung sucht sich im Bereich A:R eine
  // "Tabelle" und fand ab dem 14.07.2026 den Demo-ID-Block in R1:S1 — jede Zeile
  // landete dann in R:AI statt A:I und war für morgen-versand unsichtbar.
  // Deshalb Zielzeile selbst bestimmen und per update fest nach A<n>:U<n> schreiben.
  const bestand = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab}!A:U`,
  });
  const zielZeile = letzteBelegteZeile(bestand.data.values ?? []) + 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${tab}!A${zielZeile}:U${zielZeile}`,
    valueInputOption: "RAW",
    requestBody: { values: [zeile] },
  });
}

export const _test = { speichereDraft };

// ─── E-Mail Research ──────────────────────────────────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const IGNORIERTE_PREFIXES = new Set([
  "noreply", "no-reply", "support", "postmaster",
  "webmaster", "admin", "newsletter", "news", "spam", "abuse",
]);

const IGNORIERTE_DOMAINS = ["kammer", "schlichtung", "brak", "stbk", "steuerberaterkammer", "rechtsanwaltskammer", "bundesverband", "verband"];
const BEVORZUGTE_PREFIXES = new Set([
  "kontakt", "contact", "mail", "office", "anfragen",
  "anfrage", "buchung", "beratung", "kanzlei",
  // Mit den neuen Nischen dazugekommen: so heisst das Postfach bei Praxen,
  // Salons und Studios meistens.
  "termin", "termine", "praxis", "salon", "studio", "empfang", "rezeption",
]);

async function suchePerGoogleMaps(branche: string, stadt: string) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY fehlt");
  const query = encodeURIComponent(`${branche} ${stadt}`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`;
  const response = await fetchMitTimeout(url);
  if (!response.ok) throw new Error(`Google Maps Fehler: ${response.status}`);
  const data = await response.json() as {
    status: string;
    results: Array<{ name: string; formatted_address: string; place_id: string }>;
  };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") throw new Error(`Google Maps Status: ${data.status}`);
  return data.results.map(r => ({ name: r.name, adresse: r.formatted_address, placeId: r.place_id }));
}

async function holeWebsiteVonPlaceDetails(placeId: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=website&key=${apiKey}`;
  try {
    const response = await fetchMitTimeout(url, {}, 5000);
    if (!response.ok) return null;
    const data = await response.json() as { result?: { website?: string }; status: string };
    return data.result?.website ?? null;
  } catch { return null; }
}

function extrahiereEmails(html: string): string[] {
  const mailtoEmails = [...html.matchAll(/href=["']mailto:([^"'?\s]+)/gi)]
    .map(m => m[1].toLowerCase().replace(/[.,;)]+$/, ""))
    .filter(e => e.includes("@"));
  const textEmails = [...html.matchAll(EMAIL_REGEX)].map(m => m[0].toLowerCase().replace(/[.,;)]+$/, ""));
  return [...new Set([...mailtoEmails, ...textEmails])];
}

function findeImpressumLink(html: string, baseUrl: string): string | null {
  const matches = [...html.matchAll(/href=["']([^"']+)["'][^>]*>[^<]*impressum[^<]*/gi)];
  for (const m of matches) {
    const href = m[1];
    if (!href || href.startsWith("#") || href.startsWith("javascript")) continue;
    if (href.startsWith("http")) return href;
    if (href.startsWith("/")) return baseUrl + href;
    return `${baseUrl}/${href}`;
  }
  return null;
}

export async function findeEmailAufWebsite(websiteUrl: string): Promise<string | null> {
  let baseUrl = websiteUrl;
  if (!baseUrl.startsWith("http")) baseUrl = "https://" + websiteUrl;
  baseUrl = baseUrl.replace(/\/$/, "");

  // Nur die Gueltigkeit pruefen. Der Domain-Vergleich selbst liegt in
  // `emailPasstZurWebsite`, damit es genau eine Stelle gibt, die entscheidet,
  // ob eine Adresse zum Betrieb gehoert.
  try { new URL(baseUrl); }
  catch { return null; }

  const fetchSeite = async (url: string): Promise<string | null> => {
    try {
      const res = await fetchMitTimeout(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "de-DE,de;q=0.9",
        },
      }, 6000);
      if (!res.ok) return null;
      return await res.text();
    } catch { return null; }
  };

  // Die Domain-Passung gilt jetzt auf JEDEM Weg, auch im Impressum. Vorher war
  // sie nur auf Start- und Kontaktseite scharf — und genau das war das Loch:
  // im Impressum stehen die Agentur, die die Seite gebaut hat, und der externe
  // Datenschutzbeauftragte. Alle vier Fehlzuordnungen vom 25.08.2026 sind ueber
  // diesen Zweig hereingekommen (Z1186, Z1229, Z1241, Z1266).
  const pruefEmail = (email: string): boolean => {
    if (!email.includes("@")) return false;
    const prefix = email.split("@")[0];
    if (IGNORIERTE_PREFIXES.has(prefix)) return false;
    if (emailPasstZurWebsite(email, baseUrl) !== null) return false;
    return true;
  };

  const startseite = await fetchSeite(baseUrl);
  let impressumUrl = `${baseUrl}/impressum`;
  if (startseite) {
    const dynamisch = findeImpressumLink(startseite, baseUrl);
    if (dynamisch) impressumUrl = dynamisch;
  }

  const kandidatenseiten = [baseUrl, `${baseUrl}/kontakt`, `${baseUrl}/contact`, `${baseUrl}/ueber-uns`];
  const alleEmails: string[] = [];

  for (const seite of kandidatenseiten) {
    const inhalt = seite === baseUrl ? startseite : await fetchSeite(seite);
    if (!inhalt) continue;
    for (const email of extrahiereEmails(inhalt)) {
      if (!pruefEmail(email)) continue;
      const prefix = email.split("@")[0];
      if (BEVORZUGTE_PREFIXES.has(prefix)) return email;
      alleEmails.push(email);
    }
  }

  const impressumInhalt = await fetchSeite(impressumUrl);
  if (impressumInhalt) {
    for (const email of extrahiereEmails(impressumInhalt)) {
      if (!pruefEmail(email)) continue;
      const prefix = email.split("@")[0];
      if (BEVORZUGTE_PREFIXES.has(prefix)) return email;
      alleEmails.push(email);
    }
  }

  for (const email of [...new Set(alleEmails)]) {
    if (pruefEmail(email)) return email;
  }
  return null;
}

function htmlZuText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Zieht echten Seiten-Text (Startseite + Leistungen/Über-uns) für eine WAHRE Beobachtung.
export async function holeWebsiteText(websiteUrl: string): Promise<string> {
  let baseUrl = websiteUrl;
  if (!baseUrl.startsWith("http")) baseUrl = "https://" + websiteUrl;
  baseUrl = baseUrl.replace(/\/$/, "");

  const fetchSeite = async (url: string): Promise<string | null> => {
    try {
      const res = await fetchMitTimeout(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "de-DE,de;q=0.9",
        },
      }, 6000);
      if (!res.ok) return null;
      return await res.text();
    } catch { return null; }
  };

  const seiten = [baseUrl, `${baseUrl}/leistungen`, `${baseUrl}/ueber-uns`];
  let text = "";
  for (const seite of seiten) {
    const html = await fetchSeite(seite);
    if (html) text += " " + htmlZuText(html);
    if (text.length > 2500) break;
  }
  return text.slice(0, 2500).trim();
}

// Die Demo, die jeder Lead anklicken kann. Zeigt bewusst einen erfundenen
// Beispiel-Betrieb — nie den Namen des angeschriebenen Betriebs.
//
// Jeder Lead bekommt ein anonymes Kürzel: die Klick-Route zählt den Klick, schreibt
// ihn ins Sheet (Spalte R/S + Tab "Demo Klicks") und leitet auf die Demo weiter. Die
// ID sagt dem Empfänger nichts über sich, sie ist nur in Nios Sheet einem Lead zugeordnet.
//
// Zwei Demos, zwei Netlify-Sites aus demselben Repo:
//   werkstatt → /r/<id> → /demo       (KFZ, läuft seit Juni)
//   lokal     → /a/<id> → /assistent  (branchenneutral, für alle anderen Nischen)
export const DEMO_BASIS: Record<DemoProfil, string> = {
  werkstatt: "https://kfz-demo-agent.netlify.app",
  // Die neutrale Site wird über die Trigger.dev-Variable gesetzt, damit ein
  // Umzug oder eine eigene Domain kein Deploy dieser Datei braucht.
  lokal: process.env.DEMO_BASIS_LOKAL ?? "",
};

const KLICK_PFAD: Record<DemoProfil, string> = { werkstatt: "r", lokal: "a" };

function neueDemoId(): string {
  return randomBytes(3).toString("hex"); // 6 Zeichen, z.B. "7f3a2b"
}

export function demoLink(demoId: string, profil: DemoProfil = "werkstatt"): string {
  const basis = DEMO_BASIS[profil];
  if (!basis) {
    // Lieber laut abbrechen als 30 Mails mit kaputtem Link verschicken — der Klick
    // ist das einzige Signal, das gemessen wird.
    throw new Error(
      `Keine Demo-Basis für Profil "${profil}". Setz DEMO_BASIS_LOKAL in den Trigger.dev-Variablen.`
    );
  }
  return `${basis}/${KLICK_PFAD[profil]}/${demoId}`;
}

// Drei wirklich unterschiedliche Mail-Strukturen, damit die Mails nicht wie ein
// Serienbrief wirken. Pro Mail wird zufällig eine gewählt.
// Alle drei laufen auf DASSELBE Ziel zu: den Demo-Link anklicken. Der Beweis
// ersetzt das alte "ich schick dir bei Gelegenheit mal ein Beispiel".
//
// Bis 08.08.2026 stand hier "diese Werkstatt", "wenn alle in der Halle stehen"
// und "Name, Fahrzeug, Anliegen, Wunschzeit" fest im Text — die Strukturen waren
// damit für jede andere Nische unbrauchbar. Jetzt kommt das Branchen-Vokabular
// als Parameter aus nischen.ts.
export function mailAngles(k: Kategorie, n: Nische): { name: string; struktur: string }[] {
  return [
    {
      name: "detail-dann-demo",
      struktur: `1. Steig mit EINER konkreten Beobachtung ein, die NUR auf diesen Betrieb zutrifft — ein echtes Detail von ihrer Seite (eine genannte Leistung, ein Schwerpunkt, ein Satz von ihnen). KEINE allgemeine Aussage über fehlende Website-Funktionen.
2. EIN Satz zur Reibung, sinngemäß und in eigenen Worten: ${n.hook}
3. Führ den Demo-Link ein: du hast so einen Assistenten gebaut, er läuft, er kann direkt ausprobiert werden.`,
    },
    {
      name: "frage-dann-demo",
      struktur: `1. Steig mit EINER konkreten Beobachtung aus dem Website-Auszug ein (echtes Detail dieses Betriebs).
2. Stell eine echte, kurze Frage dazu, wie sie Anfragen heute abfangen, wenn gerade niemand frei ist — so wie jemand fragt, der das Thema versteht, nicht wie ein Verkäufer.
3. Führ den Demo-Link ein als das, was du dazu gebaut hast — er läuft, er ist in zehn Sekunden ausprobiert.`,
    },
    {
      name: "demo-zuerst",
      struktur: `1. Steig mit EINER konkreten Beobachtung aus dem Website-Auszug ein (echtes Detail dieses Betriebs), kurz gehalten.
2. Komm SOFORT zum Link: du hast einen Assistenten gebaut, der Anfragen abfängt, Fragen beantwortet und Termine aufnimmt — hier zum Ausprobieren.
3. Erst DANACH ein Satz dazu, was das für sie hieße (die Anfrage liegt fertig auf dem Tisch, mit ${k.demoFelder}).`,
    },
  ];
}

// Betreff-Blickwinkel. Am 17.07.2026 gingen 30 Erstmails raus, 19 davon trugen
// wörtlich "Anruf" im Betreff, zwei Paare waren exakt identisch — Open Rate 10%
// gegenüber 38% bei den Nachfass-Mails desselben Tages. Ursache im Prompt: der
// Betreff durfte sich wahlweise "auf das konkrete Detail ODER auf die verpassten
// Anrufe" beziehen, und das Modell griff zur immer verfügbaren zweiten Option.
//
// Deshalb: kein Zufall wie bei mailAngles(), sondern harte Rotation über den
// Lauf-Index. Bei 30 Mails pro Nacht kommt so jeder Blickwinkel ~6x vor statt
// einer Kategorie 19x.
const BETREFF_ANGLES: { name: string; anweisung: string }[] = [
  {
    name: "leistung",
    anweisung: "Nimm EINE konkrete Leistung oder einen Schwerpunkt, der wörtlich im Website-Auszug steht (z.B. Klimaservice, Getriebeinstandsetzung, Oldtimer). Der Betreff benennt diese Leistung.",
  },
  {
    name: "echte-frage",
    anweisung: "Formuliere den Betreff als kurze, echte Frage zum Arbeitsalltag dieses Betriebs — aber OHNE das Wort Anruf oder Telefon. Etwas, das ein Kollege fragen würde.",
  },
  {
    name: "spezialisierung",
    anweisung: "Nimm eine Spezialisierung, ein Verfahren oder ein besonderes Angebot aus dem Website-Auszug und bau den Betreff darum.",
  },
  {
    name: "ort-betrieb",
    anweisung: "Nimm etwas, das diesen Betrieb an seinem Ort auszeichnet — Stadtteil, Familienbetrieb, Jahreszahl, Bewertung — und bau den Betreff darum.",
  },
  {
    name: "kundensicht",
    anweisung: "Schreib den Betreff aus Sicht eines KUNDEN dieses Betriebs, als wäre es der Anfang einer echten Kundenanfrage. Kein Wort über Anrufe.",
  },
];

// Deterministische Rotation: über einen Lauf mit 30 Mails ist damit garantiert,
// dass alle Blickwinkel vorkommen. Math.random() garantiert das nicht.
export function waehleBetreffAngle(index: number): { name: string; anweisung: string } {
  const i = ((index % BETREFF_ANGLES.length) + BETREFF_ANGLES.length) % BETREFF_ANGLES.length;
  return BETREFF_ANGLES[i]!;
}

// Betreffe auf einen Vergleichskern reduzieren, damit "verpasste Anrufe abfangen"
// und "Verpasste Anrufe  abfangen!" als dieselbe Formulierung erkannt werden.
export function betreffKern(betreff: string): string {
  return betreff
    .toLowerCase()
    .replace(/[^a-zäöüß0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Die Wörter, die am 17.07.2026 in 19 von 30 Betreffen standen. Im Mailtext sind
// sie weiter erlaubt und erwünscht — nur die Betreffzeile muss variieren.
const BETREFF_VERBOTEN = ["anruf", "anrufen", "anrufe", "telefon", "verpasst"];

// Rechtsformen und Gattungswörter taugen nicht als Nachweis: "Salon" in
// "Salon Lindenhof" steht in jeder zweiten Mail ohnehin.
const NAME_FUELLWOERTER = new Set([
  "gmbh", "gbr", "ohg", "kg", "ag", "ug", "mbh", "co", "und", "the",
  "salon", "studio", "praxis", "kanzlei", "restaurant", "gasthaus", "fahrschule",
  "verwaltung", "hausverwaltung", "kosmetik", "physiotherapie", "werkstatt",
  "autohaus", "partner", "team", "haus", "zentrum",
]);

/**
 * Der markanteste Bestandteil eines Firmennamens — das Wort, an dem man den
 * Betrieb wiedererkennt ("Kupferpfanne" aus "Gasthaus Kupferpfanne").
 */
export function markanterNamensteil(firma: string): string {
  const woerter = firma
    .split(/[\s\-&.,]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !NAME_FUELLWOERTER.has(w.toLowerCase()));
  if (woerter.length === 0) return firma.trim();
  return woerter.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * Steht der Betrieb namentlich in der Mail?
 *
 * Eine Prompt-Regel ist keine Garantie — der Dry-Run vom 09.08.2026 zeigte, dass
 * 5 von 6 Mails den Namen trotz PFLICHT-Regel ausliessen und stattdessen "euer
 * Salon" schrieben. Ohne Namen liest sich die Mail wie ein Serienbrief.
 * Es zählt der volle Name ODER sein markanter Teil.
 */
export function nameIstGenannt(inhalt: string, firma: string): boolean {
  const text = inhalt.toLowerCase();
  if (text.includes(firma.toLowerCase().trim())) return true;
  const kern = markanterNamensteil(firma).toLowerCase();
  return kern.length >= 4 && text.includes(kern);
}

/**
 * Wortfolge eines Textes, so weit vereinheitlicht, dass Schreibvarianten keinen
 * Unterschied machen: Kleinschreibung, ß wie ss, alle Strich- und Anführungs-
 * arten weg. Sonst gilt "grosser" ≠ "großer" und eine 1:1-Kopie rutscht durch.
 */
function wortfolge(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-zäöü0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** Längste Folge von Wörtern, die in beiden Texten identisch hintereinander steht. */
function laengsterGemeinsamerLauf(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let beste = 0;
  let vorige = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const aktuell = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        aktuell[j] = (vorige[j - 1] ?? 0) + 1;
        if (aktuell[j]! > beste) beste = aktuell[j]!;
      }
    }
    vorige = aktuell;
  }
  return beste;
}

/**
 * Hat der Entwurf den Hook der Nische abgeschrieben, statt ihn als Kontext zu nutzen?
 *
 * In `nischen.ts` steht am Feld `hook` ausdrücklich "Kontext, nie wörtlich in die
 * Mail". Die Prüfung vom 13.08.2026 zeigte, dass die Prompt-Regel das nicht hält:
 * 9 von 60 Entwürfen begannen mit dem Hook Wort für Wort — vier Steuerkanzleien
 * in derselben Stadt bekamen denselben ersten Satz. Bei 30 Mails pro Nacht aus
 * derselben Absenderdomain ist das nicht nur langweilig, es ist das Muster, das
 * am 17.07. schon die Betreffzeilen vereinheitlicht und die Open Rate auf 10%
 * gedrückt hat.
 *
 * Gemessen wird die längste wörtlich übernommene Wortfolge, nicht die Ähnlichkeit
 * insgesamt: Abschreiben zeigt sich als langer identischer Lauf, während eine
 * echte Umformulierung dasselbe Thema trifft, ohne sieben Wörter am Stück zu
 * teilen. Ein Ähnlichkeitsmaß über den ganzen Satz würde erlaubte Umformulierungen
 * mitflaggen und die Prüfung damit wertlos machen.
 */
export function hookIstAbgeschrieben(inhalt: string, hook: string, minLauf = 7): boolean {
  const hookWorte = wortfolge(hook);
  const textWorte = wortfolge(inhalt);
  if (hookWorte.length < minLauf || textWorte.length === 0) return false;
  return laengsterGemeinsamerLauf(textWorte, hookWorte) >= minLauf;
}

// Dateiendungen, die als Domain auftauchen, wenn der Scraper einen Bild- oder
// Asset-Pfad fuer eine Adresse haelt. Echter Fund vom 17.08.2026: `de-de@2x.png`
// (ein Retina-Bildname) stand als Kontakt in der Queue.
const DATEI_ENDUNGEN = [
  "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "avif",
  "css", "js", "json", "pdf", "woff", "woff2", "ttf", "eot", "mp4", "webm",
];

// Postfaecher, die nie ein Entscheider liest. `job@` und `bewerbung@` landen bei
// der Personalstelle, `noreply@` bei niemandem.
const UNBRAUCHBARE_PREFIXES = [
  "job", "jobs", "bewerbung", "bewerbungen", "karriere", "career", "careers",
  "recruiting", "personal", "ausbildung", "praktikum",
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "postmaster", "abuse", "spam", "mailer-daemon",
];

// Fremde Absender: Software- und Buchungsplattformen, deren Adresse auf der Seite
// des Betriebs steht, ohne dem Betrieb zu gehoeren. Fund vom 17.08.2026:
// `service@studiolution.com` fuer "atelier stilwerk" — das ist die Salon-Software.
// Die Liste waechst, wenn ein Fall auftaucht. Sie raet nichts.
// Echte Freemail-Anbieter. Ein Kleinbetrieb, der seine Post ueber t-online oder
// gmx fuehrt, ist voellig normal — diese Adressen duerfen NICHT an der
// Domain-Pruefung scheitern, sonst kostet der Filter mehr Leads als er rettet.
const FREIMAIL_PROVIDER = [
  "t-online.de", "gmx.de", "gmx.net", "gmx.at", "gmx.ch", "web.de",
  "gmail.com", "googlemail.com", "outlook.de", "outlook.com", "hotmail.de",
  "hotmail.com", "live.de", "yahoo.de", "yahoo.com", "freenet.de", "aol.com",
  "icloud.com", "me.com", "mail.de", "posteo.de", "arcor.de", "online.de",
  "vodafone.de", "bluewin.ch", "a1.net",
];

// Zweiteilige oeffentliche Suffixe. Ohne die wuerde `firma.co.uk` auf `co.uk`
// zusammenfallen und jede britische Domain zur selben Firma gehoeren.
const ZWEITEILIGE_SUFFIXE = ["co.uk", "org.uk", "ac.uk", "com.au", "co.nz", "com.br"];

const FREMD_DOMAINS = [
  "studiolution.com", "shore.com", "treatwell.de", "treatwell.com",
  "planity.com", "phorest.com", "salonkee.de", "doctolib.de",
  "jameda.de", "samedi.de", "dr-flex.de", "terminland.de",
  "wixpress.com", "sentry.io", "example.com", "domain.de",
];

/**
 * Prueft, ob eine gefundene Adresse ueberhaupt zum Anschreiben taugt.
 * Gibt den Grund zurueck, wenn nicht, sonst `null`.
 *
 * Warum es diese Pruefung gibt (17.08.2026): der Quality-Gate prueft Betreff,
 * Firmenname und Hook — also den **Text**. Die **Adresse** hat nie jemand geprueft.
 * Bei der Freigabe von 72 Zeilen fielen 4 durch, alle wegen der Adresse: ein
 * Bilddateiname, ein Bewerbungspostfach, eine Salon-Software und ein Sportverein.
 * Das sind rund 6 %, die als GESENDET in die Statistik gehen und die Reply-Rate
 * still verduennen — derselbe Mechanismus wie beim Spalten-Bug und der
 * Betreff-Monokultur: der Fehler liegt **vor** der Messung.
 *
 * Bewusst deterministisch und bewusst unvollstaendig. Die zwei Faelle, die ein
 * Urteil brauchen (passt der Betrieb ueberhaupt zum Angebot, gehoert die Domain
 * zum Namen), bleiben draussen — eine geratene Regel dafuer wuerde echte Leads
 * verwerfen, und ein stiller Fehlalarm ist teurer als eine verschwendete Mail.
 */
export function adresseIstUnbrauchbar(email: string): string | null {
  const adresse = email.trim().toLowerCase();

  if (!adresse) return "leer";
  if (/\s/.test(adresse)) return "enthaelt Leerzeichen";

  const teile = adresse.split("@");
  if (teile.length !== 2) return "kein einzelnes @";

  const [lokal, domain] = teile as [string, string];
  if (!lokal) return "kein lokaler Teil";
  if (!domain.includes(".")) return "Domain ohne Punkt";

  const endung = domain.split(".").pop() ?? "";
  if (DATEI_ENDUNGEN.includes(endung)) return `Dateiendung als Domain (.${endung})`;

  // Zwei Vergleiche, weil beide Schreibweisen vorkommen: der ganze lokale Teil
  // faengt `no-reply@`, der erste Namensteil faengt `job.mueller@`. Nur den ersten
  // Teil zu pruefen liesse `no-reply@` durch (es wuerde zu "no"), nur den ganzen
  // liesse `job.mueller@` durch. `jobst@` bleibt bei beiden Wegen unberuehrt.
  const ersterTeil = lokal.split(/[.\-_+]/)[0] ?? "";
  const treffer = [lokal, ersterTeil].find((kandidat) => UNBRAUCHBARE_PREFIXES.includes(kandidat));
  if (treffer) return `Postfach "${treffer}@" liest kein Entscheider`;

  if (FREMD_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return `Fremde Domain (${domain}) — gehoert nicht dem Betrieb`;
  }

  return null;
}

/**
 * Reduziert einen Hostnamen auf die registrierbare Domain: `www.mail.firma.de`
 * wird zu `firma.de`. Gibt `null` zurueck, wenn nichts Verwertbares drinsteht.
 */
function registrierbareDomain(hostOderUrl: string): string | null {
  let host = (hostOderUrl || "").trim().toLowerCase();
  if (!host) return null;

  if (host.includes("://") || host.includes("/")) {
    try {
      host = new URL(host.startsWith("http") ? host : `https://${host}`).hostname;
    } catch {
      return null;
    }
  }

  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (!host.includes(".") || /\s/.test(host)) return null;

  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return null;

  const letzteZwei = labels.slice(-2).join(".");
  if (ZWEITEILIGE_SUFFIXE.includes(letzteZwei) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return letzteZwei;
}

/**
 * Prueft, ob eine auf `websiteUrl` gefundene Adresse ueberhaupt dem Betrieb
 * gehoert, dem diese Website gehoert. Gibt den Grund zurueck, wenn nicht,
 * sonst `null`.
 *
 * Warum es diese Pruefung gibt (25.08.2026): bei der Freigabe von 92 Zeilen
 * fielen 4 durch, alle aus derselben Klasse — die Adresse war syntaktisch
 * einwandfrei und stand auf keiner Sperrliste, gehoerte aber einem Dritten:
 * der Werbeagentur aus dem Impressum, einer Marketing-Agentur fuer Kanzleien
 * (also dem Wettbewerb), dem Datenschutzbeauftragten von WordPress.org.
 * `adresseIstUnbrauchbar` kann das nicht sehen — der einzige Unterschied zu
 * einer echten Adresse ist, dass die Domain nicht zur Website passt.
 *
 * Bewusst NICHT verworfen wird Freemail: ein Betrieb mit `@t-online.de` ist
 * echt, nur schlecht organisiert. Und ist die Website unlesbar, wird nicht
 * geraten — ohne Vergleichsgroesse gibt es kein Urteil.
 */
export function emailPasstZurWebsite(email: string, websiteUrl: string): string | null {
  const adresse = (email || "").trim().toLowerCase();
  if (!adresse.includes("@")) return "keine Adresse";

  const mailHost = adresse.split("@")[1] ?? "";
  const mailDomain = registrierbareDomain(mailHost);
  if (!mailDomain) return "Domain nicht lesbar";

  const seitenDomain = registrierbareDomain(websiteUrl);
  if (!seitenDomain) return null; // ohne Vergleichsgroesse kein Urteil

  if (mailDomain === seitenDomain) return null;
  if (FREIMAIL_PROVIDER.includes(mailDomain)) return null;

  return `Fremde Domain (${mailDomain}) passt nicht zur Website (${seitenDomain})`;
}

export function betreffIstBrauchbar(betreff: string, verbrauchte: string[] = []): boolean {
  const kern = betreffKern(betreff);
  if (kern.length === 0) return false;
  if (BETREFF_VERBOTEN.some((wort) => kern.includes(wort))) return false;
  if (verbrauchte.some((b) => betreffKern(b) === kern)) return false;
  return true;
}

// Jeder Mail-Entwurf ist ein eigener API-Call ohne Wissen über die anderen 29 des
// Laufs. Das Modell KANN Wiederholung also nicht selbst vermeiden — "formuliere
// frisch" im Prompt reicht prinzipiell nicht. Deshalb bekommt es die zuletzt
// verwendeten Betreffe explizit als verbraucht mitgegeben.
async function ladeLetzteBetreffe(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  anzahl = 40
): Promise<string[]> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!I:I`,
  });
  const rows = response.data.values ?? [];
  const betreffe = rows
    .slice(1)
    .map((row) => String(row?.[0] ?? "").trim())
    .filter((b) => b.length > 0);
  return betreffe.slice(-anzahl);
}

export type EntwurfKontext = {
  firma: string;
  stadt: string;
  kategorie: Kategorie;
  nische: Nische;
  websiteText?: string;
  link: string;
  betreffIndex?: number;
  verbrauchteBetreffe?: string[];
};

export async function generiereEmailEntwurf(
  kontext: EntwurfKontext
): Promise<{ betreff: string; inhalt: string }> {
  const {
    firma, stadt, kategorie, nische, websiteText, link,
    betreffIndex = 0, verbrauchteBetreffe = [],
  } = kontext;
  const openai = getOpenAI();
  const branche = nische.name;
  const branchenHinweis = nische.hook;
  const websiteAuszug = websiteText && websiteText.trim().length > 80 ? websiteText.trim().slice(0, 1800) : "";
  const betreffAngle = waehleBetreffAngle(betreffIndex);
  const angles = mailAngles(kategorie, nische);

  // Ohne brauchbaren Website-Auszug ist keine echte Personalisierung möglich →
  // immer "demo-zuerst" (Link statt erfundener Beobachtung).
  const angle = websiteAuszug
    ? angles[Math.floor(Math.random() * angles.length)]!
    : angles[2]!;

  const nachrichten = [
      {
        role: "system" as const,
        content: "Du bist Nio Büring, 19 Jahre alt aus Hamburg. Du schreibst Kaltakquise-E-Mails — so als hättest du dir wirklich kurz die Website der Firma angeschaut und schreibst direkt drauflos. Kein Marketingsprech, keine Floskeln, kein Ausrufezeichen. Klingt wie von einem echten Menschen getippt, nicht wie KI. Du erfindest NIE Fakten über die Firma und NIE Ergebnisse oder Referenzkunden — du hast noch keine vorzuweisen. Deine Glaubwürdigkeit kommt aus Spezifität, nicht aus behaupteten Erfolgen.",
      },
      {
        role: "user" as const,
        content: `Schreibe eine kurze Kaltakquise-E-Mail an ${firma} in ${stadt} (${branche}).
${websiteAuszug ? `\nAuszug von DEREN Website (nur das hier ist echt — beziehe deine Beobachtung darauf):\n"""${websiteAuszug}"""\n` : "\n(Kein brauchbarer Website-Auszug vorhanden — erfinde KEINE Beobachtung über die Firma.)\n"}
Hintergrundwissen zur Branche (nur Kontext, NICHT wörtlich übernehmen): ${branchenHinweis}

Struktur für DIESE Mail:
${angle.struktur}

DAS HERZSTÜCK DIESER MAIL — der Demo-Link:
Du hast einen digitalen Assistenten für ${kategorie.zielgruppe} gebaut. Er läuft, man kann ihn sofort anklicken und selbst mit ihm schreiben. ${kategorie.demoBeschreibung} Er nimmt dabei auf: ${kategorie.demoFelder}.
- Der Link MUSS wörtlich, vollständig und unverändert in der Mail stehen, in einer eigenen Zeile: ${link}
- Ändere den Link NICHT, kürze ihn nicht und bau ihn nicht in einen anderen Text ein.
- Sag dazu, dass es ein erfundener Beispiel-Betrieb ist, nicht ihrer.
- Gib EINEN konkreten Satz mit, den sie reinschreiben können, z.B.: ${nische.beispielFrage}
- Nimm die Hürde: keine Anmeldung, es passiert nichts, niemand meldet sich deswegen.
- Behaupte NICHT, du hättest die Demo für sie personalisiert oder ihren Betrieb nachgebaut. Das stimmt nicht.

Ton:
${kategorie.register.ton}

Regeln:
- ${kategorie.register.anrede} und steig DANN direkt mit dem konkreten Detail ein. Starte NICHT mit "ich habe gesehen", "mir ist aufgefallen", "ich bin auf euch gestoßen" oder einer ähnlichen Beobachtungs-Floskel — das ist der klassische Serienbrief-Einstieg. Der erste inhaltliche Satz muss variieren.
- PFLICHT: Nenne den Betrieb einmal beim Namen. Schreib "${firma}" oder den markanten Teil davon (bei "Gasthaus Kupferpfanne" reicht "Kupferpfanne"). NICHT "euer Salon", "Ihre Kanzlei", "euer Betrieb" — ohne den Namen liest sich die Mail wie ein Serienbrief an hundert Adressen.
- Sag in EINEM beiläufigen Halbsatz wer du bist: Nio, baust KI-Agenten in Hamburg. Keine förmliche Vorstellung, kein Lebenslauf.
- Unter 110 Wörter, keine Signatur, keine Anführungszeichen
- KEIN Preis, kein "2 Wochen"-Angebot — der Link soll klicken lassen, nicht verkaufen
- Erfinde keine Ergebnisse, Zahlen oder Referenzkunden
- Abschluss: EINE weiche, echte Frage, ob das für sie einen Blick wert wäre. Direkt danach ein leichter Ausweg (Risk-Reversal): wenn's gerade nicht passt, reicht ein kurzes "kein Interesse" und du meldest dich nicht wieder.
- Verbotene Marketing-Wörter: "revolutionieren", "optimieren", "transformieren", "maßgeschneidert", "innovativ", "Lösung", "effizienzsteigerung", "testen"
- Verbotene Floskeln (zu oft benutzt, wirken wie Serienbrief — formuliere frisch): "liegen bleiben", "genau dieses Problem lösen", "wer zuerst antwortet gewinnt", "Soll ich dir kurz skizzieren wie das bei euch konkret aussehen könnte", "Lust die Idee mal kurz weiterzudenken", "hättet ihr Lust die Idee durchzusprechen"
- Nutze NICHT als Aufhänger: "keine Online-Terminbuchung", "nur ein Kontaktformular", "kein Live-Chat" — das ist generisch. Finde etwas, das wirklich nach DIESEM Betrieb klingt.

BETREFF — eigene Aufgabe, nicht nebenbei erledigen:
Blickwinkel für DIESEN Betreff (verbindlich): ${betreffAngle.anweisung}
- Max 6 Wörter, klein geschrieben wie von einem Menschen getippt, keine Zahl.
- Der Betreff darf das Wort "Anruf", "anrufen" oder "Telefon" NICHT enthalten. Auch nicht "verpasst". Das Thema gehört in den Mailtext, nicht in die Betreffzeile.
- Kein generisches "Interesse an…", "Idee für…", "Frage zu…". Dieselben verbotenen Marketing-Wörter wie oben gelten auch hier.
- Der Betreff muss auch für einen Außenstehenden verständlich klingen — KEIN hyper-spezifischer Nischenbegriff von ihrer Seite, der aus dem Kontext gerissen seltsam wirkt.
${verbrauchteBetreffe.length > 0 ? `- VERBRAUCHT — diese Betreffe wurden bereits an andere Betriebe geschickt. Formuliere etwas erkennbar anderes, nicht bloß umgestellt:\n${verbrauchteBetreffe.map((b) => `  · ${b}`).join("\n")}\n` : ""}
Format:
BETREFF: <betreff>
EMAIL: <email-text>`,
      },
  ];

  async function erzeuge(extra?: string): Promise<{ betreff: string; inhalt: string }> {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.9,
      max_tokens: 350,
      messages: extra
        ? [...nachrichten, { role: "user" as const, content: extra }]
        : nachrichten,
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    return {
      betreff: raw.match(/BETREFF:\s*(.+)/)?.[1]?.trim() ?? "kurze frage",
      inhalt: raw.match(/EMAIL:\s*([\s\S]+)/)?.[1]?.trim() ?? raw,
    };
  }

  // Eine Prompt-Regel ist keine Garantie. Der Ausfall vom 17.07. entstand genau
  // dadurch, dass dem Prompt vertraut und das Ergebnis nie geprüft wurde.
  // Also: Ergebnis prüfen, bei Verstoß einmal gezielt nachfassen.
  let ergebnis = await erzeuge();
  if (!betreffIstBrauchbar(ergebnis.betreff, verbrauchteBetreffe)) {
    console.log(`Betreff verworfen ("${ergebnis.betreff}") – Neuversuch für ${firma}`);
    ergebnis = await erzeuge(
      `Der Betreff "${ergebnis.betreff}" ist unbrauchbar: er enthält ein verbotenes Wort (Anruf/anrufen/Telefon/verpasst) oder wiederholt einen bereits verschickten Betreff. Gib die Mail unverändert erneut aus, aber mit einem NEUEN Betreff nach diesem Blickwinkel: ${betreffAngle.anweisung} Wieder im Format BETREFF: / EMAIL:.`
    );
    if (!betreffIstBrauchbar(ergebnis.betreff, verbrauchteBetreffe)) {
      console.log(`Betreff auch im 2. Versuch unbrauchbar ("${ergebnis.betreff}") für ${firma}`);
    }
  }

  // Gleiche Behandlung für den Firmennamen: prüfen statt hoffen.
  if (!nameIstGenannt(ergebnis.inhalt, firma)) {
    console.log(`Firmenname fehlt im Entwurf – Neuversuch für ${firma}`);
    const nachgefasst = await erzeuge(
      `In der Mail fehlt der Name des Betriebs. Gib denselben Betreff und dieselbe Mail erneut aus, aber nenne den Betrieb genau einmal beim Namen: "${firma}" oder "${markanterNamensteil(firma)}". Ersetze dafür eine Umschreibung wie "euer Salon" oder "Ihre Kanzlei". Sonst nichts ändern. Wieder im Format BETREFF: / EMAIL:.`
    );
    // Nur übernehmen, wenn der zweite Versuch das Problem wirklich löst — sonst
    // lieber die erste, sprachlich saubere Fassung behalten.
    if (nameIstGenannt(nachgefasst.inhalt, firma)) {
      ergebnis = { betreff: ergebnis.betreff, inhalt: nachgefasst.inhalt };
    } else {
      console.log(`Firmenname auch im 2. Versuch nicht drin für ${firma}`);
    }
  }

  // Dritte Prüfung derselben Bauart: hat das Modell den Branchen-Hinweis
  // abgeschrieben, statt ihn als Kontext zu nutzen? Der Prompt sagt zweimal
  // "NICHT wörtlich übernehmen" und wurde am 11./12.08. trotzdem in 9 von 60
  // Entwürfen ignoriert. Der Nachfass nennt den Hook bewusst NICHT noch einmal —
  // ihn zu wiederholen wäre die sicherste Art, ihn wieder abgeschrieben zu bekommen.
  if (hookIstAbgeschrieben(ergebnis.inhalt, branchenHinweis)) {
    console.log(`Hook wörtlich übernommen – Neuversuch für ${firma}`);
    const nachgefasst = await erzeuge(
      `Ein Satz der Mail ist Wort für Wort aus dem Hintergrundwissen zur Branche abgeschrieben. Genau das darf nicht passieren — dieselbe Zeile geht heute Nacht an dutzende weitere Betriebe derselben Branche. Gib denselben Betreff und dieselbe Mail erneut aus, aber formuliere den Satz zur Reibung komplett neu: andere Wörter, anderer Satzbau, gern aus Sicht von ${firma} statt allgemein über die Branche. Sonst nichts ändern. Wieder im Format BETREFF: / EMAIL:.`
    );
    // Nur übernehmen, wenn der zweite Versuch das Problem wirklich löst — und
    // dabei nicht den Firmennamen verliert, den der Schritt davor gerettet hat.
    if (
      !hookIstAbgeschrieben(nachgefasst.inhalt, branchenHinweis) &&
      nameIstGenannt(nachgefasst.inhalt, firma)
    ) {
      ergebnis = { betreff: ergebnis.betreff, inhalt: nachgefasst.inhalt };
    } else {
      console.log(`Hook auch im 2. Versuch übernommen für ${firma}`);
    }
  }

  return ergebnis;
}

// Wählt pro Nacht ein zusammenhängendes Städte-Fenster aus der Rotation. Startet
// am Tages-Offset (tagImJahr) und nimmt `anzahl` aufeinanderfolgende Städte, am
// Array-Ende umlaufend. Folgetage verschieben das Fenster um 1 → keine identischen
// Batches an aufeinanderfolgenden Tagen, aber jede Stadt kommt regelmäßig dran.
export function waehleStaedte(alle: string[], tagImJahr: number, anzahl: number): string[] {
  const laenge = alle.length;
  if (laenge === 0) return [];
  const start = ((tagImJahr % laenge) + laenge) % laenge;
  const out: string[] = [];
  for (let i = 0; i < Math.min(anzahl, laenge); i++) {
    out.push(alle[(start + i) % laenge]!);
  }
  return out;
}

// ─── Main Task ────────────────────────────────────────────────────────────────
// LinkedIn-Outreach läuft separat über Claude + LinkedIn MCP (linkedin-outreach Skill)

export const nachtRecherche = schedules.task({
  id: "nacht-recherche",
  // Am 08.08.2026 pausiert (KFZ-Pool erschöpft, Lauf lief ab 29.07. jede Nacht ins
  // Timeout), am 11.08.2026 wieder scharf: die Rotation läuft jetzt über drei neue
  // Kategorien, KFZ steht in nischen.ts auf aktiv: false.
  // Die neuen Kategorien schreiben Status PRUEFEN — morgen-versand rührt sie nicht
  // an, bis Nio sie gelesen und auf DRAFT gesetzt hat (Bike-Method Phase 1).
  cron: {
    pattern: "0 23 * * 0-4", // 23:00 CEST So–Do → bereit für Mo–Fr morgens
    timezone: "Europe/Berlin",
  },
  machine: "small-2x",
  maxDuration: 900,
  run: async () => {
    console.log("=== Nacht-Recherche gestartet ===");

    const { sheets, sheetId } = await getQueue();
    await sicherQueueTab(sheets, sheetId);
    const vorhandene = await ladeVorhandeneKontakte(sheets, sheetId);
    // Betreff-Historie: verhindert, dass Nacht für Nacht dieselben Formulierungen
    // rausgehen. Wächst im Lauf mit jedem neuen Betreff weiter.
    const verbrauchteBetreffe = await ladeLetzteBetreffe(sheets, sheetId);
    let betreffIndex = 0;
    console.log(`${verbrauchteBetreffe.length} bisherige Betreffe geladen (werden als verbraucht behandelt)`);

    const STAEDTE = [
      "Hamburg", "Berlin", "Köln", "München", "Stuttgart", "Frankfurt", "Düsseldorf", "Leipzig",
      "Dortmund", "Essen", "Bremen", "Dresden", "Hannover", "Nürnberg", "Duisburg", "Bochum",
      "Wuppertal", "Bielefeld", "Bonn", "Münster", "Karlsruhe", "Mannheim", "Augsburg", "Wiesbaden",
    ];

    // Geografische Breite statt Begriffs-Breite: die vier KFZ-Synonyme überlappen
    // stark, eine Stadt liefert nur ~10-15 verwertbare Leads. Mehrere Städte pro
    // Nacht abarbeiten, bis der Tages-Deckel erreicht ist.
    //
    // Achtung bei der Fehlersuche: der "1 Lead pro Nacht"-Effekt am 14.07.2026 kam
    // NICHT vom Suchbegriff-Zuschnitt. Der Ertrag war die ganze Zeit in Ordnung — die
    // Drafts landeten nur in den falschen Spalten (siehe speichereDraft).
    const STAEDTE_PRO_NACHT = 6;   // Fenster; bricht früher ab sobald Deckel erreicht
    const BEGRIFFE_PRO_STADT = 3;  // Stichprobe aus den Begriffen der Kategorie
    const TAGES_DECKEL = 30;

    // Harte Bremse gegen den Ausfall ab dem 29.07.2026: als der KFZ-Pool leer war,
    // churnte der Lauf alle Städte durch, riss die 15-Minuten-Grenze und endete als
    // TIMED_OUT — also ohne Log, ohne Zahl, ohne Alarm. Neun Nächte lang.
    // Mit dem Budget endet der Lauf sauber als "completed" und sagt, wie viel er
    // geschafft hat. Eine Null ist erst dann eine echte Null.
    const LAUF_BUDGET_MS = 12 * 60_000;
    const start = Date.now();
    const budgetAlle = () => Date.now() - start > LAUF_BUDGET_MS;

    // Städte rotieren über den Jahrestag, damit derselbe Ort nicht jede Woche drankommt.
    const tagImJahr = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000
    );

    // Eine Kategorie pro Nacht. So ist ein Batch = eine Kategorie = eine
    // Bewertungseinheit für die Reply-Rate, und Nio prüft in Bike-Phase 1
    // pro Nacht genau einen Ton statt drei gemischt.
    const kategorie = waehleKategorie(tagImJahr);
    if (!kategorie) {
      console.log("Keine aktive Kategorie in nischen.ts — nichts zu tun.");
      return;
    }

    // Lieber hier abbrechen als 30 Mails mit kaputtem Demo-Link erzeugen.
    demoLink("pruefung", kategorie.demo);

    const zielStaedte = waehleStaedte(STAEDTE, tagImJahr, STAEDTE_PRO_NACHT);
    const kategorieBegriffe = begriffeDerKategorie(kategorie);
    const draftStatus: DraftStatus = kategorie.imTest ? "PRUEFEN" : "DRAFT";

    console.log(`Kategorie heute: ${kategorie.label} (${kategorie.slug}), Demo: ${kategorie.demo}`);
    console.log(`Status der Entwürfe: ${draftStatus}${kategorie.imTest ? " — gehen NICHT automatisch raus, Nio prüft erst" : ""}`);
    console.log(`Ziel-Städte (${zielStaedte.length}): ${zielStaedte.join(", ")}`);

    // ── Phase 1: E-Mail-Leads ─────────────────────────────────────────────────
    console.log("Phase 1: E-Mail-Leads recherchieren...");
    let emailGespeichert = 0;

    for (const zielstadt of zielStaedte) {
      if (emailGespeichert >= TAGES_DECKEL) break;
      if (budgetAlle()) {
        console.log(`Zeitbudget erreicht — Lauf endet nach ${zielstadt} nicht mehr weiter`);
        break;
      }

      // Pro Stadt eine frische, gemischte Auswahl der Suchbegriffe dieser Kategorie.
      const zielBranchen = [...kategorieBegriffe].sort(() => Math.random() - 0.5).slice(0, BEGRIFFE_PRO_STADT);
      console.log(`Stadt: ${zielstadt} (${zielBranchen.join(", ")})...`);

      for (const zielbranche of zielBranchen) {
        if (emailGespeichert >= TAGES_DECKEL) break;
        if (budgetAlle()) break;

        try {
          const firmen = await suchePerGoogleMaps(zielbranche, zielstadt);

          const nische = nischeZuBegriff(kategorie, zielbranche);
          if (!nische) {
            console.error(`Suchbegriff "${zielbranche}" gehört zu keiner Nische in ${kategorie.slug} — übersprungen`);
            continue;
          }

          for (const firma of firmen) {
            if (emailGespeichert >= TAGES_DECKEL) break;
            if (budgetAlle()) break;

            // Fehler-Isolation pro Shop: ein einzelner Fetch-/LLM-/Sheets-Fehler
            // darf nicht die restlichen Shops dieses Begriffs mitreißen (vorher lag
            // das try/catch pro Suchbegriff → ein Fehler killte ~20 Shops).
            try {
              const website = await holeWebsiteVonPlaceDetails(firma.placeId);
              if (!website) continue;

              const email = await findeEmailAufWebsite(website);
              if (!email) continue;

              // Adress-Pruefung vor Website-Text und LLM: ein unbrauchbarer Kontakt
              // soll weder einen Fetch noch einen API-Call kosten.
              const adressGrund = adresseIstUnbrauchbar(email);
              if (adressGrund) {
                console.log(`Adresse unbrauchbar (${adressGrund}): ${firma.name} → ${email} – übersprungen`);
                continue;
              }

              const emailDomain = email.split("@")[1]?.toLowerCase() ?? "";
              if (IGNORIERTE_DOMAINS.some(d => emailDomain.includes(d) || firma.name?.toLowerCase().includes(d))) {
                console.log(`Kammer/Verband übersprungen: ${firma.name} (${email})`);
                continue;
              }

              if (vorhandene.has(email.toLowerCase())) {
                console.log(`Bereits in Queue: ${email}`);
                continue;
              }

              const websiteText = await holeWebsiteText(website);
              // Quality-Gate: ohne genug echten Website-Text gibt es keinen ehrlichen,
              // firmenspezifischen Aufhänger → Lead überspringen statt generisch anschreiben.
              if (websiteText.trim().length < 300) {
                console.log(`Zu wenig Website-Text (${websiteText.trim().length} Zeichen) für ${firma.name} – übersprungen`);
                continue;
              }
              const demoId = neueDemoId();
              const entwurf = await generiereEmailEntwurf({
                firma: firma.name,
                stadt: zielstadt,
                kategorie,
                nische,
                websiteText,
                link: demoLink(demoId, kategorie.demo),
                betreffIndex,
                verbrauchteBetreffe,
              });
              betreffIndex++;
              // Sofort als verbraucht führen, damit die nächste Mail desselben Laufs
              // den Betreff nicht wiederholt (17.07.: 2 exakte Duplikate im Batch).
              if (entwurf.betreff) verbrauchteBetreffe.push(entwurf.betreff);

              // Sicherheitsnetz: ohne den Link ist die Mail wertlos (der Klick ist das
              // einzige Signal, das wir messen). Lieber überspringen als blind senden.
              if (!entwurf.inhalt.includes(demoId)) {
                console.log(`Demo-Link fehlt im Entwurf für ${firma.name} – übersprungen`);
                continue;
              }

              await speichereDraft(
                sheets, sheetId, "EMAIL", firma.name, zielstadt, email, entwurf.inhalt, entwurf.betreff, demoId,
                QUEUE_TAB, draftStatus, nische.name, kategorie.slug
              );
              vorhandene.add(email.toLowerCase());
              emailGespeichert++;

              console.log(`${draftStatus}: ${firma.name} → ${email} (${zielstadt}, ${nische.name}, Demo-ID ${demoId})`);
              await wait.for({ seconds: 2 });
            } catch (shopErr) {
              console.error(`Shop ${firma.name} übersprungen:`, shopErr);
              continue;
            }
          }
        } catch (err) {
          console.error(`${zielbranche}/${zielstadt} Fehler:`, err);
        }
      }
    }

    const dauerMin = ((Date.now() - start) / 60_000).toFixed(1);
    console.log(`E-Mail-Phase fertig: ${emailGespeichert}/${TAGES_DECKEL} Entwürfe in ${dauerMin} min`);
    if (emailGespeichert === 0) {
      console.log(
        `WARNUNG: 0 Entwürfe für ${kategorie.label}. Pool erschöpft, Maps-Billing aus oder Quality-Gate zu streng — nicht als "läuft schon" abhaken.`
      );
    }
    console.log(
      `=== Nacht-Recherche fertig: ${emailGespeichert} Entwürfe (${kategorie.label}, Status ${draftStatus}) ===`
    );
  },
});
