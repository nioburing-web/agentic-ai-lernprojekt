import { schedules, logger } from "@trigger.dev/sdk";
import axios from "axios";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";

// ─── Typen ────────────────────────────────────────────────────────────────────

type OutreachStats = {
  kontaktiert: number;
  interessiert: number;
  abgelehnt: number;
  conversionRate: number;
  offeneLeads: string[];
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
  const gestern = new Date(Date.now() - 86_400_000);
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

// ─── Schritt 1: Buchhalter-Outreach lesen ─────────────────────────────────────
// Spalten: A=Firma, B=Stadt, C=Status, D=Datum (DD.MM.YYYY), E=Uhrzeit, F=Betreff

async function leseOutreachDaten(gestern: string): Promise<OutreachStats> {
  const leer: OutreachStats = {
    kontaktiert: 0,
    interessiert: 0,
    abgelehnt: 0,
    conversionRate: 0,
    offeneLeads: [],
  };

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    logger.warn("GOOGLE_SHEET_ID nicht gesetzt – Outreach-Daten übersprungen");
    return leer;
  }

  const sheets = getSheetsClient();
  const tabName = await getTabName(sheets, sheetId, "Buchhalter Outreach");

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'!A:F`,
  });

  const rows = (response.data.values ?? []).slice(1); // Header überspringen
  logger.log("Outreach Sheet geladen", { zeilen: rows.length, gestern, tabName });

  let kontaktiert = 0;
  let interessiert = 0;
  let abgelehnt = 0;
  const offeneLeads: string[] = [];

  for (const row of rows) {
    const firma = (row[0] ?? "").trim();
    const status = (row[2] ?? "").trim().toUpperCase();
    const datum = normalizeDatum((row[3] ?? "").trim());

    if (!datum) continue;

    // Zähler für gestern
    if (datum === gestern) {
      if (status === "KONTAKTIERT") kontaktiert++;
      else if (status === "INTERESSIERT") interessiert++;
      else if (status === "ABGELEHNT") abgelehnt++;
    }

    // Offene Leads: kein Status oder KONTAKTIERT, 3+ Tage alt
    const tageAlt = tageDifferenz(datum);
    if (tageAlt >= 3 && (status === "" || status === "KONTAKTIERT") && firma) {
      offeneLeads.push(firma);
    }
  }

  const conversionRate =
    kontaktiert > 0 ? Math.round((interessiert / kontaktiert) * 1000) / 10 : 0;

  logger.log("Schritt 1 abgeschlossen", { kontaktiert, interessiert, abgelehnt, offeneLeads: offeneLeads.length });

  return { kontaktiert, interessiert, abgelehnt, conversionRate, offeneLeads };
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

  const offeneLeadsText =
    outreach.offeneLeads.length > 0
      ? outreach.offeneLeads.map((f) => `- ${f}`).join("\n")
      : "- Keine offenen Leads";

  const reportText =
    `Buchhalter-Outreach (${gestern}):\n` +
    `- E-Mails gesendet: ${outreach.kontaktiert}\n` +
    `- Interessenten: ${outreach.interessiert} (${outreach.conversionRate}%)\n` +
    `- Abgelehnt: ${outreach.abgelehnt}\n` +
    `\n` +
    `Sofort-Antwort (${gestern}):\n` +
    `- Anfragen: ${sofort.anfragen}\n` +
    `- Beantwortet: ${sofort.beantwortet}\n` +
    `- Ø Reaktionszeit: ${sofort.avgReaktionszeitMin} Minuten\n` +
    `- Schnellste Antwort: ${sofort.schnellsteMin} Minuten\n` +
    `\n` +
    `Handlungsbedarf (offene Leads 3+ Tage):\n` +
    offeneLeadsText;

  logger.log("Schritt 3 abgeschlossen", { betreff });
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
  cron: {
    pattern: "0 9 * * 1-5",
    timezone: "Europe/Berlin",
  },
  maxDuration: 120,
  run: async () => {
    logger.log("Reporting Agent gestartet");
    const gestern = gestrigDatumBerlin();

    // Schritt 1: Buchhalter-Outreach Daten
    let outreach: OutreachStats = {
      kontaktiert: 0, interessiert: 0, abgelehnt: 0, conversionRate: 0, offeneLeads: [],
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
