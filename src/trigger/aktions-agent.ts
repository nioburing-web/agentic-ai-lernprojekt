import { schedules } from "@trigger.dev/sdk";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";

function fetchMitTimeout(url: string, options?: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function parseGermanDate(dateStr: string): Date | null {
  const match = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match as unknown as [string, string, string, string];
  return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
}

function tageDifferenz(datum: Date, jetzt: Date): number {
  const msPerTag = 24 * 60 * 60 * 1000;
  const jetztOhneZeit = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  const datumOhneZeit = new Date(datum.getFullYear(), datum.getMonth(), datum.getDate());
  return Math.floor((jetztOhneZeit.getTime() - datumOhneZeit.getTime()) / msPerTag);
}

async function sendeAktionEmail(
  betreff: string,
  inhalt: string,
  empfaengerEmail: string
): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const absenderName = process.env.ABSENDER_NAME ?? "NIO Automation";
  const absenderEmail = process.env.ABSENDER_EMAIL;

  if (!apiKey || !absenderEmail) {
    throw new Error("Brevo Env-Vars fehlen (BREVO_API_KEY, ABSENDER_EMAIL)");
  }

  const payload = {
    sender: { name: absenderName, email: absenderEmail },
    to: [{ email: empfaengerEmail }],
    subject: betreff,
    textContent: inhalt,
    type: "transactional",
  };

  const response = await fetchMitTimeout("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.text();
  console.log(`Brevo Response ${response.status}: ${responseBody}`);

  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`Brevo Fehler: ${response.status} – ${responseBody}`);
  }
}

export const aktionsAgent = schedules.task({
  id: "aktions-agent",
  // Cron deaktiviert auf Nios Wunsch (2026-07-08) — tägliche Aktions-Mail läuft jetzt via Terminal (/morning-briefing, /nachfassen). Reaktivieren: cron-Zeile wieder einkommentieren.
  // cron: { pattern: "30 8 * * 1-5", timezone: "Europe/Berlin" },
  machine: "small-1x",
  maxDuration: 120,
  run: async () => {
    console.log("=== Aktions-Agent gestartet ===");

    const reportEmail = process.env.REPORT_EMAIL;
    if (!reportEmail) {
      console.error("REPORT_EMAIL fehlt – Abbruch");
      return;
    }

    const sheetId = process.env.GOOGLE_SHEET_ID;
    if (!sheetId) throw new Error("GOOGLE_SHEET_ID fehlt");

    const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!credentialsJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON fehlt");

    const auth = new GoogleAuth({
      credentials: JSON.parse(credentialsJson),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = googleSheets({ version: "v4", auth });

    console.log("Lese Google Sheet...");
    // Outreach Queue: A=Typ, B=Name, C=Stadt, D=Kontakt, E=Entwurf, F=Status, G=Erstellt, H=Gesendet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Outreach Queue!A:H",
    });

    const rows = response.data.values ?? [];
    const jetzt = new Date();

    type SofortEintrag = { firma: string; stadt: string; status: string; datum: string };
    type AugeEintrag = { firma: string; stadt: string; datum: string; tage: number };

    const sofort: SofortEintrag[] = [];
    const imAuge: AugeEintrag[] = [];
    let gesternCount = 0;

    for (const row of rows.slice(1)) {
      const firma = (row[1] as string | undefined) ?? "";
      const stadt = (row[2] as string | undefined) ?? "";
      const status = (row[5] as string | undefined) ?? "";
      const gesendetDatum = (row[7] as string | undefined) ?? "";

      if (!firma || !status) continue;

      if (status === "INTERESSIERT" || status === "RÜCKFRAGE") {
        sofort.push({ firma, stadt, status, datum: gesendetDatum });
        continue;
      }

      if (status === "ABGELEHNT" || status === "ABWESEND") continue;

      if (status === "GESENDET" && gesendetDatum) {
        const parsedDatum = parseGermanDate(gesendetDatum);
        if (!parsedDatum) continue;
        const tage = tageDifferenz(parsedDatum, jetzt);
        if (tage === 1) gesternCount++;
        if (tage >= 3) imAuge.push({ firma, stadt, datum: gesendetDatum, tage });
      }
    }

    console.log(`SOFORT: ${sofort.length}, IM AUGE: ${imAuge.length}, GESTERN: ${gesternCount}`);

    const MAX_AKTIONEN = 5;

    // INTERESSIERT vor RÜCKFRAGE sortieren
    sofort.sort((a, b) => {
      if (a.status === "INTERESSIERT" && b.status !== "INTERESSIERT") return -1;
      if (a.status !== "INTERESSIERT" && b.status === "INTERESSIERT") return 1;
      return 0;
    });

    const sofortAnzeige = sofort.slice(0, MAX_AKTIONEN);
    const imAugeSlotsRestlich = Math.max(0, MAX_AKTIONEN - sofortAnzeige.length);
    const imAugeAnzeige = imAuge
      .sort((a, b) => b.tage - a.tage)
      .slice(0, imAugeSlotsRestlich);

    const zeilen: string[] = [
      "=== NIO AUTOMATION – WAS HEUTE ZU TUN IST ===",
      "",
      "--- SOFORT: INTERESSIERT & RÜCKFRAGE ---",
    ];

    if (sofortAnzeige.length === 0) {
      zeilen.push("(keine)");
    } else {
      for (const e of sofortAnzeige) {
        zeilen.push(`${e.status}: ${e.firma} (${e.stadt}) – ${e.datum}`);
      }
    }

    zeilen.push("", "--- IM AUGE: Offen seit 3+ Tagen ---");

    if (imAugeAnzeige.length === 0) {
      zeilen.push("(keine)");
    } else {
      for (const e of imAugeAnzeige) {
        zeilen.push(`${e.firma} (${e.stadt}) – seit ${e.tage} Tagen (${e.datum})`);
      }
    }

    zeilen.push("", "--- GESTERN: Gesendete E-Mails ---", `${gesternCount} E-Mail(s) gesendet`);

    const inhalt = zeilen.join("\n");
    const betreff = "NIO Automation – Was heute zu tun ist";

    await sendeAktionEmail(betreff, inhalt, reportEmail);
    console.log(`Bericht gesendet an ${reportEmail}`);
    console.log("=== Aktions-Agent abgeschlossen ===");
  },
});
