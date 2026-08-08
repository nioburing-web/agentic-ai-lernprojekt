import { schedules, logger } from "@trigger.dev/sdk";
import axios from "axios";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";

// ─── Typen ────────────────────────────────────────────────────────────────────

type OutreachStats = {
  gesendet: number;
  geoeffnet: number;
  geantwortet: number;
  positiv: number;
  offeneLeads: string[];
  interessiertFirmen: string[];
  rueckfrageFirmen: string[];
};

type SofortAntwortStats = {
  anfragen: number;
  beantwortet: number;
  avgReaktionszeitMin: number;
  schnellsteMin: number;
  langsamsteMin: number;
};

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function gestrigDatumBerlin(): string {
  const heute = new Date();
  const wochentag = heute.getDay(); // 0=Sonntag, 1=Montag

  // Montag → Outreach lief Freitag, also 3 Tage zurück
  const tageZurueck = wochentag === 1 ? 3 : 1;
  const gestern = new Date(heute.getTime() - tageZurueck * 86_400_000);

  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(gestern);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("day")}.${get("month")}.${get("year")}`;
}

function normalizeDatum(datumStr: string): string {
  // Normalisiert "D.M.YYYY" und "DD.MM.YYYY" zu einheitlichem "DD.MM.YYYY"
  const [day, month, year] = datumStr.split(".").map(Number);
  if (!day || !month || !year) return datumStr;
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
}

function tageDifferenz(datumStr: string): number {
  const [day, month, year] = datumStr.split(".").map(Number);
  const datum = new Date(year, month - 1, day);
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  return Math.floor((heute.getTime() - datum.getTime()) / 86_400_000);
}

function getSheetsClient() {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON nicht gesetzt");

  const auth = new GoogleAuth({
    credentials: JSON.parse(credentialsJson),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return googleSheets({ version: "v4", auth });
}

async function getTabName(sheets: ReturnType<typeof googleSheets>, sheetId: string, zielTab: string): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const alle = meta.data.sheets ?? [];
  const gefunden = alle.find((s) => s.properties?.title === zielTab);
  if (!gefunden) {
    logger.warn(`Tab '${zielTab}' nicht gefunden – verwende ersten Tab`);
  }
  return gefunden?.properties?.title ?? alle[0]?.properties?.title ?? "Sheet1";
}

// ─── Brevo Opens (transaktional) ──────────────────────────────────────────────
// Opens werden NICHT ins Sheet geschrieben – einzige Quelle ist die Brevo Events
// API (morgen-versand sendet mit trackOpens). Liefert Set aller Öffner-Adressen
// der letzten 7 Tage (lowercase).

async function getBrevoOpens(): Promise<Set<string>> {
  const opened = new Set<string>();
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    logger.warn("BREVO_API_KEY nicht gesetzt – Opens übersprungen");
    return opened;
  }

  try {
    const response = await axios.get("https://api.brevo.com/v3/smtp/statistics/events", {
      headers: { "api-key": apiKey, accept: "application/json" },
      params: { event: "opened", days: 7, limit: 2500, sort: "desc" },
    });
    const events = (response.data?.events ?? []) as Array<{ email?: string }>;
    for (const ev of events) {
      if (ev.email) opened.add(ev.email.toLowerCase().trim());
    }
    logger.log("Brevo Opens geladen", { uniqueOpener: opened.size, events: events.length });
  } catch (e) {
    logger.error("Brevo Opens konnten nicht geladen werden", { error: String(e) });
  }
  return opened;
}

// ─── Schritt 1: Outreach Queue lesen ──────────────────────────────────────────
// Spalten: A=Typ, B=Name, C=Stadt, D=Kontakt(Email), E=Entwurf, F=Status,
//          G=Erstellt, H=Gesendet (DD.MM.YYYY), I=Betreff, J=Fehler
// Status-Werte: DRAFT, GESENDET, FEHLER, INTERESSIERT, RÜCKFRAGE, ABGELEHNT, ABWESEND

const ANTWORT_STATUS = ["INTERESSIERT", "RÜCKFRAGE", "ABGELEHNT", "ABWESEND"];

async function leseOutreachDaten(gestern: string): Promise<OutreachStats> {
  const leer: OutreachStats = {
    gesendet: 0,
    geoeffnet: 0,
    geantwortet: 0,
    positiv: 0,
    offeneLeads: [],
    interessiertFirmen: [],
    rueckfrageFirmen: [],
  };

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    logger.warn("GOOGLE_SHEET_ID nicht gesetzt – Outreach-Daten übersprungen");
    return leer;
  }

  const sheets = getSheetsClient();
  const tabName = await getTabName(sheets, sheetId, "Outreach Queue");

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!A:J`,
  });

  const rows = (response.data.values ?? []).slice(1); // Header überspringen
  const opened = await getBrevoOpens();
  logger.log("Outreach Queue geladen", { zeilen: rows.length, gestern, tabName, opens: opened.size });

  let gesendet = 0;
  let geoeffnet = 0;
  let geantwortet = 0;
  let positiv = 0;
  const offeneLeads: string[] = [];
  const interessiertFirmen: string[] = [];
  const rueckfrageFirmen: string[] = [];

  for (const row of rows) {
    const typ = (row[0] ?? "").trim().toUpperCase();
    const name = (row[1] ?? "").trim();
    const kontakt = (row[3] ?? "").trim().toLowerCase();
    const status = (row[5] ?? "").trim().toUpperCase();
    const gesendetDatum = normalizeDatum((row[7] ?? "").trim());

    if (typ !== "EMAIL") continue; // LinkedIn läuft separat

    // Gestrige Kennzahlen: gestern versendete Zeilen (nicht DRAFT/FEHLER)
    if (gesendetDatum === gestern && status !== "DRAFT" && status !== "FEHLER") {
      gesendet++;
      if (kontakt && opened.has(kontakt)) geoeffnet++;
      if (ANTWORT_STATUS.includes(status)) geantwortet++;
      if (status === "INTERESSIERT" || status === "RÜCKFRAGE") positiv++;
    }

    // Historische HANDLUNGSBEDARF-Listen (alle Zeilen ohne Datumsfilter)
    if (status === "INTERESSIERT" && name) interessiertFirmen.push(name);
    if (status === "RÜCKFRAGE" && name) rueckfrageFirmen.push(name);

    // Offene Leads: gesendet, noch keine Antwort, 3+ Tage alt
    if (gesendetDatum && status === "GESENDET") {
      const tageAlt = tageDifferenz(gesendetDatum);
      if (tageAlt >= 3 && name) offeneLeads.push(name);
    }
  }

  logger.log("Schritt 1 abgeschlossen", { gesendet, geoeffnet, geantwortet, positiv, offeneLeads: offeneLeads.length });

  return { gesendet, geoeffnet, geantwortet, positiv, offeneLeads, interessiertFirmen, rueckfrageFirmen };
}

// ─── Schritt 2: Sofort-Antwort lesen ─────────────────────────────────────────
// Spalten: A=Name, B=Email, C=Nachricht, D=Kategorie, E=Status,
//          F=Anfrage_Zeit, G=Antwort_Zeit, H=Reaktionszeit_Min (DD.MM.YYYY HH:MM:SS)

async function leseSofortAntwortDaten(gestern: string): Promise<SofortAntwortStats> {
  const leer: SofortAntwortStats = {
    anfragen: 0,
    beantwortet: 0,
    avgReaktionszeitMin: 0,
    schnellsteMin: 0,
    langsamsteMin: 0,
  };

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    logger.warn("GOOGLE_SHEET_ID nicht gesetzt – Sofort-Antwort-Daten übersprungen");
    return leer;
  }

  const sheets = getSheetsClient();
  const tabName = await getTabName(sheets, sheetId, "Sofort-Antwort");

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!A:H`,
  });

  const rows = (response.data.values ?? []).slice(1); // Header überspringen

  let anfragen = 0;
  let beantwortet = 0;
  const reaktionszeiten: number[] = [];

  for (const row of rows) {
    const status = (row[4] ?? "").trim().toUpperCase();
    const anfrageZeitStr = (row[5] ?? "").trim();
    const antwortZeitStr = (row[6] ?? "").trim();
    const reaktionszeitStr = (row[7] ?? "").trim();

    if (!anfrageZeitStr) continue;

    // Datum aus "DD.MM.YYYY HH:MM:SS" extrahieren
    const anfrageD = anfrageZeitStr.slice(0, 10); // "DD.MM.YYYY"
    if (anfrageD !== gestern) continue;

    anfragen++;

    if (status === "GESENDET" && antwortZeitStr) {
      beantwortet++;
      const minuten = parseFloat(reaktionszeitStr);
      if (!isNaN(minuten)) reaktionszeiten.push(minuten);
    }
  }

  const avgReaktionszeitMin =
    reaktionszeiten.length > 0
      ? Math.round((reaktionszeiten.reduce((a, b) => a + b, 0) / reaktionszeiten.length) * 100) / 100
      : 0;
  const schnellsteMin = reaktionszeiten.length > 0 ? Math.min(...reaktionszeiten) : 0;
  const langsamsteMin = reaktionszeiten.length > 0 ? Math.max(...reaktionszeiten) : 0;

  logger.log("Schritt 2 abgeschlossen", { anfragen, beantwortet, avgReaktionszeitMin });

  return { anfragen, beantwortet, avgReaktionszeitMin, schnellsteMin, langsamsteMin };
}

// ─── Schritt 3: Report generieren ────────────────────────────────────────────

function generiereReport(
  gestern: string,
  outreach: OutreachStats,
  sofort: SofortAntwortStats
): { betreff: string; reportText: string } {
  const betreff = `NIO Automation Report – ${gestern}`;

  const openRate = outreach.gesendet > 0
    ? Math.round((outreach.geoeffnet / outreach.gesendet) * 1000) / 10 : 0;
  const antwortRate = outreach.gesendet > 0
    ? Math.round((outreach.geantwortet / outreach.gesendet) * 1000) / 10 : 0;
  const positiveRate = outreach.gesendet > 0
    ? Math.round((outreach.positiv / outreach.gesendet) * 1000) / 10 : 0;

  const interessiertText = outreach.interessiertFirmen.length > 0
    ? outreach.interessiertFirmen.join(", ") : "Keine";
  const rueckfrageText = outreach.rueckfrageFirmen.length > 0
    ? outreach.rueckfrageFirmen.join(", ") : "Keine";
  const offeneText = outreach.offeneLeads.length > 0
    ? outreach.offeneLeads.join(", ") : "Keine";

  const reportText =
    `=== NIO Automation Report – ${gestern} ===\n` +
    `\n` +
    `BUCHHALTER-OUTREACH:\n` +
    `Gesendet:     ${outreach.gesendet} E-Mails\n` +
    `Geöffnet:     ${outreach.geoeffnet} (${openRate}% Open Rate)\n` +
    `Geantwortet:  ${outreach.geantwortet} (${antwortRate}% Antwort Rate)\n` +
    `Positiv:      ${outreach.positiv} (${positiveRate}% Positive Rate)\n` +
    `\n` +
    `SOFORT-ANTWORT:\n` +
    `Anfragen:          ${sofort.anfragen}\n` +
    `Beantwortet:       ${sofort.beantwortet}\n` +
    `Ø Reaktionszeit:   ${sofort.avgReaktionszeitMin} Minuten\n` +
    `\n` +
    `HANDLUNGSBEDARF:\n` +
    `▸ INTERESSIERT: ${interessiertText}\n` +
    `▸ RÜCKFRAGE:    ${rueckfrageText}\n` +
    `▸ OFFEN 3+ Tage:${offeneText}\n` +
    `\n` +
    `INTERPRETATION:\n` +
    `Open Rate < 20%    → Betreff verbessern\n` +
    `Antwort Rate < 3%  → Text verbessern\n` +
    `Positive Rate < 1% → Zielgruppe prüfen`;

  logger.log("Schritt 3 abgeschlossen", { betreff, openRate, antwortRate, positiveRate });
  return { betreff, reportText };
}

// ─── Schritt 4: Report senden ─────────────────────────────────────────────────

async function sendeReport(betreff: string, reportText: string): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const reportEmail = process.env.REPORT_EMAIL;

  if (!apiKey) { logger.error("BREVO_API_KEY nicht gesetzt"); return false; }
  if (!reportEmail) { logger.error("REPORT_EMAIL nicht gesetzt"); return false; }

  const absenderName    = process.env.ABSENDER_NAME    ?? "NIO Automation";
  const absenderEmail   = process.env.ABSENDER_EMAIL   ?? "anfragen@nio-automation.de";
  const absenderWebsite = process.env.ABSENDER_WEBSITE ?? "nio-automation.de";
  const testEmail       = process.env.TEST_EMAIL;

  const empfaenger = testEmail ?? reportEmail;
  if (testEmail) logger.log("TEST-MODUS aktiv", { testEmail, original: reportEmail });

  const signatur = `\n\nMit freundlichen Grüßen\n${absenderName}\n${absenderEmail}\n${absenderWebsite}`;

  const response = await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender:      { name: absenderName, email: absenderEmail },
      to:          [{ email: empfaenger }],
      subject:     betreff,
      textContent: reportText + signatur,
    },
    {
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
    }
  );

  const erfolg = response.status === 201;
  logger.log("Schritt 4 abgeschlossen", { gesendet: erfolg, empfaenger });
  return erfolg;
}

// ─── Trigger.dev Cron Task ────────────────────────────────────────────────────

export const reportingAgent = schedules.task({
  id: "reporting-agent",
  // Cron deaktiviert auf Nios Wunsch (2026-07-08) — Performance-Report läuft jetzt via Terminal. Reaktivieren: cron-Block wieder einkommentieren.
  // cron: {
  //   pattern: "0 9 * * 1-5",
  //   timezone: "Europe/Berlin",
  // },
  maxDuration: 120,
  run: async () => {
    logger.log("Reporting Agent gestartet");
    const gestern = gestrigDatumBerlin();

    // Schritt 1: Buchhalter-Outreach Daten
    let outreach: OutreachStats = {
      gesendet: 0, geoeffnet: 0, geantwortet: 0, positiv: 0,
      offeneLeads: [], interessiertFirmen: [], rueckfrageFirmen: [],
    };
    try {
      outreach = await leseOutreachDaten(gestern);
    } catch (e) {
      logger.error("Schritt 1 fehlgeschlagen – weiter mit Nullwerten", { error: e });
    }

    // Schritt 2: Sofort-Antwort Daten
    let sofort: SofortAntwortStats = {
      anfragen: 0, beantwortet: 0, avgReaktionszeitMin: 0, schnellsteMin: 0, langsamsteMin: 0,
    };
    try {
      sofort = await leseSofortAntwortDaten(gestern);
    } catch (e) {
      logger.error("Schritt 2 fehlgeschlagen – weiter mit Nullwerten", { error: e });
    }

    // Schritt 3: Report generieren
    let betreff = "";
    let reportText = "";
    try {
      const report = generiereReport(gestern, outreach, sofort);
      betreff = report.betreff;
      reportText = report.reportText;
    } catch (e) {
      logger.error("Schritt 3 fehlgeschlagen", { error: e });
    }

    // Schritt 4: Report senden
    if (betreff && reportText) {
      try {
        await sendeReport(betreff, reportText);
      } catch (e) {
        logger.error("Schritt 4 fehlgeschlagen – Report nicht gesendet", { error: e });
      }
    } else {
      logger.error("Kein Report-Text – E-Mail wird nicht gesendet");
    }

    logger.log("Reporting Agent abgeschlossen", { gestern });
  },
});
