import { schedules, wait } from "@trigger.dev/sdk";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import OpenAI from "openai";

// ─── Follow-up-Versand ──────────────────────────────────────────────────────────
// Schickt EINEN einzigen Nachfass an Leads, die eine Erstmail bekommen und nach
// 3-10 Werktagen nicht geantwortet haben. Danach ist Schluss (Status NACHGEFASST_1).
// Antworten werden weiter vom reply-classifier erfasst (matcht rein über E-Mail,
// nicht über Status). Auto-Send auf Nios Wunsch (2026-07-08).

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

// ─── Datum / Werktage ───────────────────────────────────────────────────────────

// Parst DD.MM.YYYY (das Format aus Spalte H) zu einem Date auf Mitternacht lokal.
function parseGermanDate(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return isNaN(date.getTime()) ? null : date;
}

// Zählt Werktage (Mo-Fr) zwischen zwei Daten, exklusiv Startdatum.
function werktageDazwischen(von: Date, bis: Date): number {
  if (bis <= von) return 0;
  let tage = 0;
  const cur = new Date(von.getFullYear(), von.getMonth(), von.getDate());
  const ende = new Date(bis.getFullYear(), bis.getMonth(), bis.getDate());
  while (cur < ende) {
    cur.setDate(cur.getDate() + 1);
    const tag = cur.getDay();
    if (tag !== 0 && tag !== 6) tage++;
  }
  return tage;
}

// ─── Queue lesen ────────────────────────────────────────────────────────────────

const QUEUE_TAB = "Outreach Queue";
const FOLLOWUP_MIN_WERKTAGE = 3;   // frühestens nach 3 Werktagen nachfassen
const FOLLOWUP_MAX_WERKTAGE = 10;  // älter als 10 Werktage: zu spät, "letzte Woche" unglaubwürdig
// Normal 30/Lauf. Einmaliger Backlog-Sweep (119 Alt-Leads im Fenster am 08.07.):
// bis einschl. 14.07.2026 auf 60 anheben, danach automatisch zurück auf 30 (selbst-zurücksetzend).
const TAGES_LIMIT = new Date().toISOString().slice(0, 10) < "2026-07-15" ? 60 : 30;

type QueueRow = {
  rowIndex: number;
  name: string;
  stadt: string;
  kontakt: string;
  entwurf: string;
  betreff: string;
};

async function ladeFaelligeLeads(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  heute: Date
): Promise<QueueRow[]> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!A:Q`,
  });

  const rows = response.data.values ?? [];
  const result: QueueRow[] = [];

  for (let i = 1; i < rows.length && result.length < TAGES_LIMIT; i++) {
    const row = rows[i];
    if (!row) continue;
    if (row[0] !== "EMAIL") continue;        // A=Typ
    if ((row[5] ?? "") !== "GESENDET") continue; // F=Status: nur unbeantwortete Erstmails
    const kontakt = (row[3] as string | undefined)?.trim() ?? ""; // D=Kontakt
    if (!kontakt || !kontakt.includes("@")) continue;

    const gesendet = parseGermanDate((row[7] as string | undefined) ?? ""); // H=Gesendet
    if (!gesendet) continue;
    const werktage = werktageDazwischen(gesendet, heute);
    if (werktage < FOLLOWUP_MIN_WERKTAGE || werktage > FOLLOWUP_MAX_WERKTAGE) continue;

    result.push({
      rowIndex: i + 1,
      name: (row[1] as string) ?? "",
      stadt: (row[2] as string) ?? "",
      kontakt,
      entwurf: (row[4] as string) ?? "", // E=Entwurf (Erstmail zum Referenzieren)
      betreff: (row[8] as string) ?? "", // I=Betreff
    });
  }

  return result;
}

async function markiereNachgefasst(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  rowIndex: number,
  datum: string
): Promise<void> {
  // F=Status auf NACHGEFASST_1, Q=Nachfass-Datum (eigene Spalte, überschreibt H=Gesendet NICHT).
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `${QUEUE_TAB}!F${rowIndex}`, values: [["NACHGEFASST_1"]] },
        { range: `${QUEUE_TAB}!Q${rowIndex}`, values: [[datum]] },
      ],
    },
  });
}

// ─── Follow-up-Text generieren ──────────────────────────────────────────────────

async function generiereFollowup(row: QueueRow): Promise<string> {
  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.85,
    max_tokens: 200,
    messages: [
      {
        role: "system",
        content:
          "Du bist Nio Büring, 19 Jahre aus Hamburg, baust KI-Agenten für kleine Betriebe. Du schreibst ein kurzes, lockeres Follow-up auf eine Kaltmail, die unbeantwortet blieb. Klingt wie von einem echten Menschen getippt, kein Marketingsprech, kein Ausrufezeichen, keine erfundenen Fakten oder Ergebnisse.",
      },
      {
        role: "user",
        content: `Du hattest ${row.name} in ${row.stadt} vor ein paar Tagen diese Kaltmail geschrieben:
"""${row.entwurf}"""

Sie hat nicht geantwortet. Schreibe ein sehr kurzes Follow-up.

Regeln:
- Unter 45 Wörter, keine Signatur, keine Anführungszeichen
- Beziehe dich beiläufig auf die erste Mail ("ich hatte dir letzte Woche kurz geschrieben")
- Wiederhole NICHT den Inhalt der ersten Mail
- Kein Druck, keine Entschuldigung fürs Nachfassen, kein neues Verkaufsargument
- Baue einen leichten Ausweg ein (Risk-Reversal): wenn es gerade nicht passt, reicht ein kurzes "kein Interesse" und du lässt in Ruhe
- Schließe mit einer einzigen, leicht zu beantwortenden Frage
- Gib NUR den E-Mail-Text zurück, kein Betreff, keine Vorrede`,
      },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}

// ─── E-Mail senden (Reply auf die Erstmail) ─────────────────────────────────────

async function sendeFollowup(row: QueueRow, text: string): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const absenderName = process.env.ABSENDER_NAME ?? "NIO Automation";
  const absenderEmail = process.env.ABSENDER_EMAIL;
  const replyToEmail = process.env.REPLY_TO_EMAIL;
  const testEmail = process.env.TEST_EMAIL;

  if (!apiKey || !absenderEmail) throw new Error("Brevo Env-Vars fehlen (BREVO_API_KEY, ABSENDER_EMAIL)");

  const empfaenger = testEmail ?? row.kontakt;
  if (testEmail) console.log(`Testmodus: sende an ${testEmail} statt ${row.kontakt}`);

  const signatur = `\n\nMit freundlichen Grüßen\n${absenderName}\n${absenderEmail}`;
  const plainText = text + signatur;
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

  const betreff = row.betreff.toLowerCase().startsWith("re:") ? row.betreff : `Re: ${row.betreff}`;

  const response = await fetchMitTimeout("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: absenderName, email: absenderEmail },
      replyTo: { email: replyToEmail ?? absenderEmail },
      to: [{ email: empfaenger }],
      subject: betreff,
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

// ─── Main Task ────────────────────────────────────────────────────────────────

export const nachfassVersand = schedules.task({
  id: "nachfass-versand",
  cron: {
    pattern: "30 9 * * 1-5", // 09:30 CEST Mo–Fr, nach dem morgen-versand (09:00)
    timezone: "Europe/Berlin",
  },
  machine: "small-2x",
  maxDuration: 600,
  run: async () => {
    console.log("=== Nachfass-Versand gestartet ===");

    const { sheets, sheetId } = await getQueue();
    const heute = new Date();
    const heuteStr = heute.toLocaleDateString("de-DE", {
      timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric",
    });

    const leads = await ladeFaelligeLeads(sheets, sheetId, heute);
    console.log(`${leads.length} fällige Follow-up-Leads gefunden (${FOLLOWUP_MIN_WERKTAGE}-${FOLLOWUP_MAX_WERKTAGE} Werktage, keine Antwort)`);

    let gesendet = 0;
    for (const row of leads) {
      try {
        const text = await generiereFollowup(row);
        if (!text || text.length < 20) {
          console.warn(`Leerer Follow-up-Text für ${row.name} – übersprungen`);
          continue;
        }
        const erfolg = await sendeFollowup(row, text);
        if (erfolg) {
          await markiereNachgefasst(sheets, sheetId, row.rowIndex, heuteStr);
          gesendet++;
          console.log(`Follow-up gesendet: ${row.name} → ${row.kontakt}`);
        } else {
          console.error(`Follow-up fehlgeschlagen (Brevo): ${row.name}`);
        }
      } catch (err) {
        console.error(`Follow-up Fehler für ${row.name}:`, err);
      }
      await wait.for({ seconds: 5 });
    }

    console.log(`=== Nachfass-Versand fertig. ${gesendet}/${leads.length} gesendet ===`);
  },
});
