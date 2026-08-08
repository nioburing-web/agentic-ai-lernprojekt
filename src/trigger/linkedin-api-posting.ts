import { schedules } from "@trigger.dev/sdk";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";

// ─── Config ───────────────────────────────────────────────────────────────────
// Postet den heutigen READY-Draft aus der "LinkedIn Draft Queue" über die
// OFFIZIELLE LinkedIn-API (/rest/posts, Scope w_member_social).
// Kein Browser, kein Cookie-Transplant — läuft zuverlässig in der Cloud.
//
// Benötigte Env-Vars (Trigger.dev > Environment Variables):
//   LINKEDIN_ACCESS_TOKEN   — 60-Tage-Member-Token (via tools/linkedin-oauth.mjs)
//   LINKEDIN_AUTHOR_URN     — urn:li:person:{id} (gibt das OAuth-Tool aus)
//   GOOGLE_SERVICE_ACCOUNT_JSON, BREVO_API_KEY, ABSENDER_EMAIL — wie gehabt

const CONTENT_LOG_SHEET_ID =
  process.env.CONTENT_LOG_SHEET_ID ?? "1HGoFIl55_wxD91l746R3PA3YjShxUQ-j-DTrY8lqwfo";
const DRAFT_QUEUE_TAB = "LinkedIn Draft Queue";
const LINKEDIN_VERSION = process.env.LINKEDIN_API_VERSION ?? "202605"; // YYYYMM

// ─── Google Sheets ──────────────────────────────────────────────────────────

function getGoogleAuth() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON fehlt");
  return new GoogleAuth({
    credentials: JSON.parse(json),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheets() {
  const auth = getGoogleAuth();
  return { sheets: googleSheets({ version: "v4", auth }), sheetId: CONTENT_LOG_SHEET_ID };
}

type DraftRow = { rowIndex: number; datum: string; typ: string; postText: string };

async function ladeReadyDraft(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string
): Promise<DraftRow | null> {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${DRAFT_QUEUE_TAB}!A:F`,
  });
  const rows = resp.data.values ?? [];
  const heute = new Date().toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const toRow = (row: string[], i: number): DraftRow => ({
    rowIndex: i + 1,
    datum: row[0] as string,
    typ: row[1] as string,
    postText: row[2] as string,
  });

  // 1. heutiger READY-Draft
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row && row[4] === "READY" && row[0] === heute) return toRow(row, i);
  }
  // 2. Fallback: ältester READY-Draft
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row && row[4] === "READY") return toRow(row, i);
  }
  return null;
}

async function aktualisiereStatus(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  rowIndex: number,
  status: string
): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${DRAFT_QUEUE_TAB}!E${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[status]] },
  });
}

// ─── LinkedIn little-text Escaping ─────────────────────────────────────────────
// In der commentary müssen die "little"-Steuerzeichen escaped werden, sonst
// interpretiert LinkedIn sie als Annotationen. # bleibt frei (Hashtags),
// @-Mentions nutzen wir nicht.
function escapeCommentary(text: string): string {
  return text.replace(/[\\(){}\[\]<>@|]/g, (c) => `\\${c}`);
}

// ─── LinkedIn Posts API ────────────────────────────────────────────────────────

async function posteUeberApi(postText: string): Promise<string> {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const author = process.env.LINKEDIN_AUTHOR_URN;
  if (!token) throw new Error("LINKEDIN_ACCESS_TOKEN fehlt (tools/linkedin-oauth.mjs ausführen)");
  if (!author) throw new Error("LINKEDIN_AUTHOR_URN fehlt (z.B. urn:li:person:xxxx)");

  const body = {
    author,
    commentary: escapeCommentary(postText),
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  const resp = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": LINKEDIN_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (resp.status === 201) {
    return resp.headers.get("x-restli-id") ?? "(ohne ID)";
  }

  const errText = await resp.text().catch(() => "");
  if (resp.status === 401) {
    throw new Error(
      `401 — LINKEDIN_ACCESS_TOKEN abgelaufen oder ungültig. Bitte tools/linkedin-oauth.mjs neu ausführen und Token in Trigger.dev aktualisieren. ${errText.slice(0, 150)}`
    );
  }
  throw new Error(`LinkedIn API ${resp.status}: ${errText.slice(0, 250)}`);
}

// ─── Status-Report per Brevo ────────────────────────────────────────────────────

async function sendeStatusReport(
  datum: string,
  typ: string,
  erfolg: boolean,
  detail: string
): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const absenderEmail = process.env.ABSENDER_EMAIL;
  if (!apiKey || !absenderEmail) return;
  // Report-Mail deaktiviert auf Nios Wunsch (2026-07-06) — Crash-Alarme laufen weiter über agent-health-monitor. Reaktivieren: nächste Zeile entfernen.
  return;

  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "NIO Automation", email: absenderEmail },
      to: [{ email: "nioburing@gmail.com" }],
      subject: erfolg
        ? `LinkedIn gepostet (API): ${datum} (${typ})`
        : `LinkedIn Posting fehlgeschlagen (API): ${datum}`,
      textContent: erfolg
        ? `LinkedIn-Post für ${datum} wurde via offizieller API veröffentlicht.\n\nTyp: ${typ}\nPost-ID: ${detail}`
        : `LinkedIn Posting (API) fehlgeschlagen.\n\nFehler: ${detail}`,
    }),
  });
}

// ─── Main Task ──────────────────────────────────────────────────────────────────

export const linkedinApiPosting = schedules.task({
  id: "linkedin-api-posting",
  cron: {
    pattern: "0 8 * * 2-6", // 08:00 Europe/Berlin, Di–Sa (Content vom Vortag)
    timezone: "Europe/Berlin",
  },
  machine: "small-1x",
  maxDuration: 120,
  run: async () => {
    console.log("=== LinkedIn API-Posting gestartet ===");

    // Noch nicht konfiguriert (Token/URN fehlen, z.B. solange offizielle API
    // nicht eingerichtet) → still überspringen, KEINE Fehler-Mail.
    if (!process.env.LINKEDIN_ACCESS_TOKEN || !process.env.LINKEDIN_AUTHOR_URN) {
      console.log("LINKEDIN_ACCESS_TOKEN/AUTHOR_URN nicht gesetzt — übersprungen (noch nicht eingerichtet).");
      return;
    }

    const { sheets, sheetId } = await getSheets();

    const draft = await ladeReadyDraft(sheets, sheetId);
    if (!draft) {
      console.log("Kein READY-Draft in Queue — übersprungen");
      return;
    }
    console.log(`Draft: ${draft.datum} (${draft.typ})`);

    try {
      const postId = await posteUeberApi(draft.postText);
      await aktualisiereStatus(sheets, sheetId, draft.rowIndex, "GESENDET (API)");
      await sendeStatusReport(draft.datum, draft.typ, true, postId);
      console.log(`=== Post ${draft.datum} veröffentlicht: ${postId} ===`);
    } catch (err) {
      const detail = String(err instanceof Error ? err.message : err).slice(0, 250);
      console.error("Posting-Fehler:", err);
      await aktualisiereStatus(sheets, sheetId, draft.rowIndex, `FEHLER: ${detail}`);
      await sendeStatusReport(draft.datum, draft.typ, false, detail);
      throw err;
    }
  },
});
