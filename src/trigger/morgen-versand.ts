import { schedules, wait } from "@trigger.dev/sdk";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Queue Reading ────────────────────────────────────────────────────────────

const QUEUE_TAB = "Outreach Queue";

type QueueRow = {
  rowIndex: number;
  typ: "EMAIL" | "LINKEDIN";
  name: string;
  stadt: string;
  kontakt: string;
  entwurf: string;
  betreff: string;
};

async function ladeDraftRows(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  typ: "EMAIL" | "LINKEDIN",
  limit: number
): Promise<QueueRow[]> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!A:I`,
  });

  const rows = response.data.values ?? [];
  const result: QueueRow[] = [];

  for (let i = 1; i < rows.length && result.length < limit; i++) {
    const row = rows[i];
    if (!row) continue;
    if (row[0] !== typ) continue;
    if (row[5] !== "DRAFT") continue;

    result.push({
      rowIndex: i + 1,
      typ: row[0] as "EMAIL" | "LINKEDIN",
      name: (row[1] as string) ?? "",
      stadt: (row[2] as string) ?? "",
      kontakt: (row[3] as string) ?? "",
      entwurf: (row[4] as string) ?? "",
      betreff: (row[8] as string) ?? "",
    });
  }

  return result;
}

async function aktualisiereStatus(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  rowIndex: number,
  status: "GESENDET" | "FEHLER",
  fehlerGrund = ""
): Promise<void> {
  const heute = new Date().toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit", month: "2-digit", year: "numeric",
  });

  const updates = [
    { range: `${QUEUE_TAB}!F${rowIndex}`, values: [[status]] },
    { range: `${QUEUE_TAB}!H${rowIndex}`, values: [[heute]] },
  ];
  if (fehlerGrund) {
    updates.push({ range: `${QUEUE_TAB}!J${rowIndex}`, values: [[fehlerGrund]] });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { valueInputOption: "RAW", data: updates },
  });
}

// ─── E-Mail Senden ────────────────────────────────────────────────────────────

async function sendeEmail(row: QueueRow): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const absenderName = process.env.ABSENDER_NAME ?? "NIO Automation";
  const absenderEmail = process.env.ABSENDER_EMAIL;
  const replyToEmail = process.env.REPLY_TO_EMAIL;
  const testEmail = process.env.TEST_EMAIL;

  if (!apiKey || !absenderEmail) throw new Error("Brevo Env-Vars fehlen (BREVO_API_KEY, ABSENDER_EMAIL)");

  const empfaenger = testEmail ?? row.kontakt;
  if (testEmail) console.log(`Testmodus: sende an ${testEmail} statt ${row.kontakt}`);

  const signatur = `\n\nMit freundlichen Grüßen\n${absenderName}\n${absenderEmail}`;
  const plainText = row.entwurf + signatur;
  const htmlContent = `<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6">${
    plainText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>")
      .replace(/^/, "<p>")
      .replace(/$/, "</p>")
  }</body></html>`;

  const response = await fetchMitTimeout("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: absenderName, email: absenderEmail },
      replyTo: { email: replyToEmail ?? absenderEmail },
      to: [{ email: empfaenger }],
      subject: row.betreff,
      htmlContent,
      textContent: plainText,
      type: "transactional",
      trackOpens: 1,
      trackClicks: 1,
    }),
  });

  const body = await response.text();
  console.log(`Brevo ${response.status}: ${body}`);
  return response.status === 200 || response.status === 201;
}

// ─── Status Report ───────────────────────────────────────────────────────────
// LinkedIn-Outreach läuft separat über Claude + LinkedIn MCP (linkedin-outreach Skill)

async function sendeStatusReport(
  emailGesendet: number, emailTotal: number,
  fehler: string[]
): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const absenderEmail = process.env.ABSENDER_EMAIL;
  if (!apiKey || !absenderEmail) return;
  // Report-Mail deaktiviert auf Nios Wunsch (2026-07-06) — Crash-Alarme laufen weiter über agent-health-monitor. Reaktivieren: nächste Zeile entfernen.
  return;

  const heute = new Date().toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric",
  });

  const zeilen = [
    `Morgen-Versand ${heute}`,
    ``,
    `E-Mails:   ${emailGesendet}/${emailTotal} gesendet`,
  ];

  if (fehler.length > 0) {
    zeilen.push(``, `Fehler (${fehler.length}):`, ...fehler.map(f => `- ${f}`));
  } else {
    zeilen.push(``, `Alles ok.`);
  }

  await fetchMitTimeout("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "NIO Automation", email: absenderEmail },
      to: [{ email: "nioburing@gmail.com" }],
      subject: `Outreach ${heute}: ${emailGesendet}/${emailTotal} gesendet`,
      textContent: zeilen.join("\n"),
    }),
  });
}

// ─── Main Task ────────────────────────────────────────────────────────────────

export const morgenVersand = schedules.task({
  id: "morgen-versand",
  cron: {
    pattern: "0 9 * * 1-5", // 09:00 CEST Mo–Fr
    timezone: "Europe/Berlin",
  },
  machine: "small-2x",
  maxDuration: 600,
  run: async () => {
    console.log("=== Morgen-Versand gestartet ===");

    const { sheets, sheetId } = await getQueue();
    const fehler: string[] = [];

    // ── Phase 1: E-Mails ──────────────────────────────────────────────────────
    console.log("Phase 1: E-Mails senden...");
    const emailRows = await ladeDraftRows(sheets, sheetId, "EMAIL", 30);
    console.log(`${emailRows.length} E-Mail-Drafts gefunden`);

    let emailGesendet = 0;
    for (const row of emailRows) {
      if (!row.betreff) {
        console.warn(`Kein Betreff für ${row.name} – übersprungen`);
        fehler.push(`Kein Betreff: ${row.name}`);
        continue;
      }
      try {
        const erfolg = await sendeEmail(row);
        if (erfolg) {
          await aktualisiereStatus(sheets, sheetId, row.rowIndex, "GESENDET");
          emailGesendet++;
          console.log(`E-Mail gesendet: ${row.name} → ${row.kontakt}`);
        } else {
          await aktualisiereStatus(sheets, sheetId, row.rowIndex, "FEHLER", "Brevo Fehler");
          fehler.push(`E-Mail fehlgeschlagen: ${row.name}`);
        }
      } catch (err) {
        const grund = String(err).slice(0, 100);
        await aktualisiereStatus(sheets, sheetId, row.rowIndex, "FEHLER", grund);
        fehler.push(`E-Mail Fehler: ${row.name}`);
        console.error(`E-Mail Fehler für ${row.name}:`, err);
      }
      await wait.for({ seconds: 5 });
    }

    console.log(`E-Mail-Phase: ${emailGesendet}/${emailRows.length} gesendet`);

    // ── Status Report ─────────────────────────────────────────────────────────
    try {
      await sendeStatusReport(emailGesendet, emailRows.length, fehler);
      console.log("Status-Report gesendet");
    } catch (err) {
      console.error("Status-Report Fehler:", err);
    }

    console.log("=== Morgen-Versand fertig ===");

    // Das Ergebnis verlaesst den Lauf, statt nur im Log zu stehen. Der
    // agent-health-monitor liest es und schlaegt Alarm, wenn ein gruener Lauf
    // nichts bewirkt hat (25.08.2026: 0 von 0 gesendet, kein Alarm, kein Outreach).
    return { gefunden: emailRows.length, gesendet: emailGesendet, fehler: fehler.length };
  },
});
