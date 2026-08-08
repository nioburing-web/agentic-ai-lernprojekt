import { schedules, wait } from "@trigger.dev/sdk";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import OpenAI from "openai";

// ─── Config ───────────────────────────────────────────────────────────────────

const CONTENT_LOG_SHEET_ID =
  process.env.CONTENT_LOG_SHEET_ID ?? "1HGoFIl55_wxD91l746R3PA3YjShxUQ-j-DTrY8lqwfo";
const DRAFT_QUEUE_TAB = "LinkedIn Draft Queue";
const DRAFT_QUEUE_HEADER = ["Datum", "Typ", "Post-Text", "Image-URL", "Status", "Erstellt"];

interface PostKonfig {
  typ: string;
  aufgabe: string;
  zielgruppen: string[];
}

// Wochentag des MORGEN (0=So,1=Mo,...,5=Fr) → Post-Typ
const POST_TYPEN: Record<number, PostKonfig> = {
  1: {
    typ: "Value",
    aufgabe: "Konkreter KI-Tipp für KMU — sofort anwendbar, kein Tech-Jargon",
    zielgruppen: ["Makler", "Coaches", "Handwerker", "Einzelhändler"],
  },
  2: {
    typ: "Value",
    aufgabe: "Mythos Buster — ein verbreitetes KI-Missverständnis aus dem KMU-Umfeld richtigstellen",
    zielgruppen: ["Buchhalter", "Immobilienmakler", "Steuerberater", "Coaches", "Anwälte"],
  },
  3: {
    typ: "Social Proof",
    aufgabe: "NIO-Prozess zeigen — wie ein konkretes Problem mit einem KI-Agenten gelöst wurde (Vorher/Nachher). Kein Kundenname nötig, Branche reicht.",
    zielgruppen: ["Kanzleien", "mittelständische Unternehmen", "Selbstständige"],
  },
  4: {
    typ: "Value",
    aufgabe: "Mini-Case Study oder eine offene Frage an die Community stellen die zum Kommentieren einlädt",
    zielgruppen: ["Gründer", "Selbstständige", "KMU-Inhaber"],
  },
  5: {
    typ: "CTA",
    aufgabe: "Konkretes Angebot oder Einladung zum Discovery-Call — direkt ohne harte Verkaufsbotschaft. Calendly-Link: https://calendly.com/nioburing/30min",
    zielgruppen: ["Interessenten", "Buchhalter", "Steuerberater"],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fetchMitTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

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
  const sheets = googleSheets({ version: "v4", auth });
  return { sheets, sheetId: CONTENT_LOG_SHEET_ID };
}

// ─── Google Sheets ────────────────────────────────────────────────────────────

async function sicherDraftQueueTab(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string
): Promise<void> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = spreadsheet.data.sheets?.some(
    (s) => s.properties?.title === DRAFT_QUEUE_TAB
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: DRAFT_QUEUE_TAB } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${DRAFT_QUEUE_TAB}!A1:F1`,
      valueInputOption: "RAW",
      requestBody: { values: [DRAFT_QUEUE_HEADER] },
    });
    console.log(`Tab "${DRAFT_QUEUE_TAB}" erstellt`);
  }
}

async function speichereDraft(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  datum: string,
  typ: string,
  postText: string,
  imageUrl: string
): Promise<void> {
  const jetzt = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${DRAFT_QUEUE_TAB}!A:F`,
    valueInputOption: "RAW",
    requestBody: { values: [[datum, typ, postText, imageUrl, "READY", jetzt]] },
  });
}

// ─── Text-Generierung ─────────────────────────────────────────────────────────

async function generierePostText(konfig: PostKonfig, datumStr: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000 });
  const zielgruppe =
    konfig.zielgruppen[Math.floor(Math.random() * konfig.zielgruppen.length)]!;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.85,
    max_tokens: 450,
    messages: [
      {
        role: "system",
        content:
          "Du bist Nio Büring, Gründer von NIO Automation in Hamburg. Du arbeitest SOLO und baust KI-Agenten für KMU (350-500 EUR/Monat). Stil: kurz, direkt, persönlich. Schreibe IMMER in Ich-Form, nie 'wir' oder 'unsere'. Kein Marketingsprech (verboten: 'messbare Ergebnisse', 'Schlüssel zum Wachstum', 'passen sich an', 'maßgeschneidert', 'optimieren'). Kein Em-Dash. Kein Konjunktiv. Nutze konkrete Zahlen und echte Situationen. Der Hook (erste Zeile) ist die stärkste Zeile — direkt rein, kein Aufwärmen.",
      },
      {
        role: "user",
        content: `Schreibe einen LinkedIn-Post für ${datumStr}.

Aufgabe: ${konfig.aufgabe}
Zielgruppe heute: ${zielgruppe}

Struktur:
1. Hook (1 Zeile) — direkt rein, keine Einleitung, kein "Heute möchte ich..."
2. 3-5 Absätze, max. 2 Zeilen pro Absatz, Leerzeile dazwischen
3. Abschluss: kurze Frage an die Community ODER sanfter CTA
4. Hashtags: #KI #Automatisierung #[passender Branchen-Hashtag]

Regeln:
- Kein Em-Dash (stattdessen Komma oder neuer Satz)
- Kein Konjunktiv wenn möglich
- Deutsch
- Max. 600 Zeichen (ohne Hashtags)

Schreibe NUR den Post-Text, keine Erklärungen.`,
      },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}

async function generiereKieBildPrompt(postText: string, typ: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000 });

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 150,
    messages: [
      {
        role: "system",
        content:
          "Generate a concise image prompt for Kie.ai Flux Kontext. Style: documentary realism, professional business context. No people, no text in image, no logos. Must look real, not like a stock photo or CGI.",
      },
      {
        role: "user",
        content: `Post type: ${typ}
Post excerpt: ${postText.slice(0, 150)}

Write ONE image prompt (max 70 words). Include: subject/scene, environment, lighting, camera (50mm, f/2.8). End with: "Documentary realism. No text, no logos, no people."`,
      },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}

// ─── Kie.ai Bild-Generierung ──────────────────────────────────────────────────

async function generiereKieBild(prompt: string): Promise<string> {
  const apiKey = process.env.KIE_AI_API_KEY;
  if (!apiKey) throw new Error("KIE_AI_API_KEY fehlt");

  const negative =
    "plastic look, airbrushed surfaces, stock photography composition, CGI render, cartoon, stylized realism, text overlays, logos, people, hands, watermark";
  const fullPrompt = `${prompt}. Negative: ${negative}`;

  const createResp = await fetchMitTimeout(
    "https://api.kie.ai/api/v1/flux/kontext/generate",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        aspectRatio: "16:9",
        model: "flux-kontext-pro",
        outputFormat: "jpeg",
      }),
    }
  );

  if (!createResp.ok) {
    const text = await createResp.text();
    throw new Error(`Kie.ai create error: ${createResp.status} — ${text}`);
  }

  const createData = await createResp.json() as {
    data?: { taskId?: string };
    taskId?: string;
  };
  const taskId = createData.data?.taskId ?? createData.taskId;
  if (!taskId) throw new Error(`Kein taskId in Kie.ai-Antwort: ${JSON.stringify(createData)}`);

  console.log(`Kie.ai Task: ${taskId}`);

  for (let i = 0; i < 60; i++) {
    await wait.for({ seconds: 5 });

    const pollResp = await fetchMitTimeout(
      `https://api.kie.ai/api/v1/flux/kontext/record-info?taskId=${encodeURIComponent(taskId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    if (!pollResp.ok) continue;

    const pollData = await pollResp.json() as {
      data?: { successFlag?: number; response?: { resultImageUrl?: string }; errorMessage?: string };
    };
    const data = pollData.data ?? {};
    const flag = data.successFlag;

    if (flag === 1) {
      const imageUrl = data.response?.resultImageUrl;
      if (!imageUrl) throw new Error(`Kein resultImageUrl trotz Erfolg: ${JSON.stringify(data)}`);
      return imageUrl;
    }
    if (flag === 2 || flag === 3) {
      throw new Error(`Kie.ai-Task fehlgeschlagen: ${data.errorMessage ?? JSON.stringify(data)}`);
    }

    console.log(`Kie.ai Status: ${flag === 0 ? "generating" : "waiting"}...`);
  }

  throw new Error("Kie.ai Timeout nach 5 Minuten");
}

// ─── Status-Report ────────────────────────────────────────────────────────────

async function sendeStatusReport(
  morgenDatum: string,
  typ: string,
  erfolg: boolean,
  fehler?: string
): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const absenderEmail = process.env.ABSENDER_EMAIL;
  if (!apiKey || !absenderEmail) return;
  // Report-Mail deaktiviert auf Nios Wunsch (2026-07-06) — Crash-Alarme laufen weiter über agent-health-monitor. Reaktivieren: nächste Zeile entfernen.
  return;

  const betreff = erfolg
    ? `LinkedIn Draft bereit: ${morgenDatum} (${typ})`
    : `LinkedIn Draft fehlgeschlagen: ${morgenDatum}`;

  const inhalt = erfolg
    ? `LinkedIn-Post für morgen (${morgenDatum}) ist fertig und wartet in "LinkedIn Draft Queue".\n\nTyp: ${typ}\n\nEinfach /linkedin-post ausführen und in Sekunden live.`
    : `LinkedIn-Post Generierung fehlgeschlagen.\n\nFehler: ${fehler ?? "Unbekannt"}`;

  await fetchMitTimeout("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "NIO Automation", email: absenderEmail },
      to: [{ email: "nioburing@gmail.com" }],
      subject: betreff,
      textContent: inhalt,
    }),
  });
}

// ─── Main Task ────────────────────────────────────────────────────────────────

export const linkedinPostNacht = schedules.task({
  id: "linkedin-post-nacht",
  cron: {
    pattern: "0 21 * * 1-4", // 21:00 CET Mo–Do → generiert für Di–Fr
    timezone: "Europe/Berlin",
  },
  machine: "small-2x",
  maxDuration: 300,
  run: async () => {
    console.log("=== LinkedIn Post Nacht-Generierung gestartet ===");

    // Morgen-Datum bestimmen
    const morgen = new Date();
    morgen.setDate(morgen.getDate() + 1);
    const wochentag = morgen.getDay();
    const morgenDatum = morgen.toLocaleDateString("de-DE", {
      timeZone: "Europe/Berlin",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const konfig = POST_TYPEN[wochentag];
    if (!konfig) {
      console.log(`Kein Post-Typ für Wochentag ${wochentag} — übersprungen`);
      return;
    }

    console.log(`Morgen: ${morgenDatum} (Typ: ${konfig.typ})`);

    try {
      const { sheets, sheetId } = await getSheets();
      await sicherDraftQueueTab(sheets, sheetId);

      // Post-Text generieren
      console.log("Generiere Post-Text...");
      const postText = await generierePostText(konfig, morgenDatum);
      console.log(`Post-Text (${postText.length} Zeichen) generiert`);

      // Bild-Prompt generieren
      console.log("Generiere Bild-Prompt...");
      const bildPrompt = await generiereKieBildPrompt(postText, konfig.typ);
      console.log(`Bild-Prompt: ${bildPrompt.slice(0, 80)}...`);

      // Bild generieren
      console.log("Generiere Bild via Kie.ai...");
      const imageUrl = await generiereKieBild(bildPrompt);
      console.log(`Bild fertig: ${imageUrl.slice(0, 60)}...`);

      // Draft in Google Sheets speichern
      await speichereDraft(sheets, sheetId, morgenDatum, konfig.typ, postText, imageUrl);
      console.log(`Draft gespeichert in "${DRAFT_QUEUE_TAB}"`);

      // Bestätigung per E-Mail
      await sendeStatusReport(morgenDatum, konfig.typ, true);

      console.log(`=== Fertig: LinkedIn-Post für ${morgenDatum} bereit ===`);
    } catch (err) {
      const fehlerText = String(err).slice(0, 200);
      console.error("Fehler:", err);
      await sendeStatusReport(morgenDatum, konfig?.typ ?? "?", false, fehlerText).catch(() => {});
      throw err;
    }
  },
});
