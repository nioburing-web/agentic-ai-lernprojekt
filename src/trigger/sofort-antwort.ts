import { task, logger } from "@trigger.dev/sdk";
import OpenAI from "openai";
import axios from "axios";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";

// ─── Typen ────────────────────────────────────────────────────────────────────

type Payload = {
  name: string;
  email: string;
  message: string;
  company?: string;
};

type Kategorie = "BUCHHALTUNG" | "BERATUNG" | "TERMIN" | "SONSTIGES";

type Antwort = {
  betreff: string;
  emailText: string;
};

// ─── Konstanten ───────────────────────────────────────────────────────────────

const GUELTIGE_KATEGORIEN: Kategorie[] = ["BUCHHALTUNG", "BERATUNG", "TERMIN", "SONSTIGES"];


// ─── Hilfsfunktion: Datum in Europe/Berlin formatieren ───────────────────────

function formatBerlinTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

// ─── Funktion 1: Anfrage analysieren ─────────────────────────────────────────

async function analysiereAnfrage(payload: Payload): Promise<Kategorie> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const anfrage =
    `Name: ${payload.name}\n` +
    (payload.company ? `Firma: ${payload.company}\n` : "") +
    `Nachricht: ${payload.message}`;

  const systemPrompt =
    "Du klassifizierst Kontaktformular-Anfragen in genau eine der folgenden Kategorien:\n" +
    "- BUCHHALTUNG: Fragen zu Buchhaltung, Rechnungen, Finanzen, Steuern\n" +
    "- BERATUNG: Allgemeine Beratungsanfragen, Informationen zu Dienstleistungen\n" +
    "- TERMIN: Terminanfragen, Terminvereinbarungen, Rückrufbitten\n" +
    "- SONSTIGES: Alles, was nicht in die anderen Kategorien passt\n\n" +
    "Antworte NUR mit der Kategorie, ohne weitere Erklärung.";

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Klassifiziere folgende Anfrage:\n\n${anfrage}` },
      ],
      max_tokens: 10,
      temperature: 0,
    });

    const kategorie = response.choices[0].message.content?.trim().toUpperCase() as Kategorie;

    if (!GUELTIGE_KATEGORIEN.includes(kategorie)) {
      throw new Error(`Ungültige Kategorie erhalten: '${kategorie}'`);
    }

    logger.log("Schritt 1 abgeschlossen", { kategorie });
    return kategorie;
  } catch (e) {
    logger.error("Fehler bei Kategorisierung – Fallback SONSTIGES", { error: e });
    return "SONSTIGES";
  }
}

// ─── Funktion 2: Antwort generieren ──────────────────────────────────────────

async function generiereAntwort(
  name: string,
  message: string,
  company: string | undefined,
  _kategorie: Kategorie
): Promise<Antwort> {
  const betreff = `Danke für Ihre Nachricht, ${name}`;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const kontext =
    `Name: ${name}\n` +
    (company ? `Firma: ${company}\n` : "") +
    `Nachricht: ${message}`;

  const systemPrompt =
    "Du schreibst eine kurze E-Mail-Antwort auf eine Kontaktformular-Anfrage für NIO Automation.\n\n" +
    "Regeln:\n" +
    "1. Satz 1: Beginne mit \"Guten Tag [Name],\" und übernimm das konkreteste Keyword der Nachricht WÖRTLICH in einem Satz.\n" +
    "   Beispiel Nachricht: 'Ich brauche Hilfe mit meiner Buchhaltung'\n" +
    "   → Richtig: \"Guten Tag Max, vielen Dank für Ihre Anfrage bezüglich Ihrer Buchhaltung.\"\n" +
    "   → FALSCH: \"Guten Tag Max, ich verstehe dass Sie an einem Agenten interessiert sind der Probleme löst.\"\n" +
    "2. Satz 2 (letzter Satz): \"Ich melde mich innerhalb von 24 Stunden persönlich bei Ihnen.\"\n" +
    "3. Genau 2 Sätze – nicht mehr, nicht weniger\n" +
    "4. Keine Signatur, keine Betreffzeile, kein zusätzlicher Text";

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Schreibe die Antwort für:\n\n${kontext}` },
      ],
      max_tokens: 100,
      temperature: 0.3,
    });

    const emailText =
      response.choices[0].message.content?.trim() ??
      `Guten Tag ${name},\n\nIch melde mich innerhalb von 24 Stunden persönlich bei Ihnen.`;

    logger.log("Schritt 2 abgeschlossen", { betreff, personalisiert: true });
    return { betreff, emailText };
  } catch (e) {
    logger.error("Fehler bei Antwort-Generierung – Fallback", { error: e });
    return {
      betreff,
      emailText: `Guten Tag ${name},\n\nIch melde mich innerhalb von 24 Stunden persönlich bei Ihnen.`,
    };
  }
}

// ─── Funktion 3: E-Mail senden ────────────────────────────────────────────────

async function sendeEmail(empfaengerEmail: string, betreff: string, emailText: string): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    logger.error("BREVO_API_KEY ist nicht gesetzt");
    return false;
  }

  try {
    // Test-Modus: Empfänger überschreiben wenn TEST_EMAIL gesetzt
    const testEmail = process.env.TEST_EMAIL;
    const tatsaechlicheEmail = testEmail ?? empfaengerEmail;
    if (testEmail) {
      logger.log("TEST-MODUS: E-Mail geht an Test-Adresse", { testEmail, original: empfaengerEmail });
    }

    // Signatur separat anhängen (nicht vom LLM generiert)
    const absenderName    = process.env.ABSENDER_NAME    ?? "NIO Automation";
    const absenderEmail   = process.env.ABSENDER_EMAIL   ?? "anfragen@nio-automation.de";
    const absenderWebsite = process.env.ABSENDER_WEBSITE ?? "nio-automation.de";
    const replyToEmail    = process.env.REPLY_TO_EMAIL   ?? process.env.REPLY_EMAIL;

    const signatur = `\n\nMit freundlichen Grüßen\n${absenderName}\n${absenderEmail}\n${absenderWebsite}`;

    const body: Record<string, unknown> = {
      sender:      { name: absenderName, email: absenderEmail },
      to:          [{ email: tatsaechlicheEmail }],
      subject:     betreff,
      textContent: emailText + signatur,
    };

    if (replyToEmail) {
      body.replyTo = { email: replyToEmail };
    }

    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      body,
      {
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
        },
      }
    );

    const erfolg = response.status === 201;
    logger.log("Schritt 3 abgeschlossen", { gesendet: erfolg, status: response.status });
    return erfolg;
  } catch (e) {
    logger.error("Fehler beim E-Mail-Versand", { error: e });
    return false;
  }
}

// ─── Funktion 4: Google Sheets Tracking ──────────────────────────────────────

async function trackeAnfrage(
  name: string,
  email: string,
  message: string,
  kategorie: Kategorie,
  status: string,
  anfrageZeit: Date,
  antwortZeit: Date
): Promise<boolean> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    logger.warn("GOOGLE_SHEET_ID nicht gesetzt – Tracking übersprungen");
    return false;
  }

  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) {
    logger.warn("GOOGLE_SERVICE_ACCOUNT_JSON nicht gesetzt – Tracking übersprungen");
    return false;
  }

  try {
    const credentials = JSON.parse(credentialsJson);

    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = googleSheets({ version: "v4", auth });

    const reaktionszeitMin = ((antwortZeit.getTime() - anfrageZeit.getTime()) / 60000).toFixed(2);

    const zeile = [
      name,
      email,
      message.slice(0, 100),
      kategorie,
      status,
      formatBerlinTime(anfrageZeit),
      formatBerlinTime(antwortZeit),
      reaktionszeitMin,
    ];

    // Tab-Namen ermitteln: "Sofort-Antwort" bevorzugt, sonst erstes Sheet
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const verfuegbareSheets = meta.data.sheets ?? [];
    const zielSheet = verfuegbareSheets.find(
      (s) => s.properties?.title === "Sofort-Antwort"
    );
    const tabName = zielSheet?.properties?.title ?? verfuegbareSheets[0]?.properties?.title ?? "Sheet1";

    if (!zielSheet) {
      logger.warn("Tab 'Sofort-Antwort' nicht gefunden – verwende ersten Tab", { tabName });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `'${tabName}'!A:H`,
      valueInputOption: "RAW",
      requestBody: { values: [zeile] },
    });

    logger.log("Schritt 4 abgeschlossen", { name, kategorie, status, reaktionszeitMin });
    return true;
  } catch (e) {
    logger.error("Fehler beim Google Sheets Tracking", { error: e });
    return false;
  }
}

// ─── Trigger.dev Task ─────────────────────────────────────────────────────────

export const sofortAntwortTask = task({
  id: "sofort-antwort",
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 5000,
    factor: 2,
  },
  run: async (payload: Payload) => {
    const anfrageZeit = new Date();
    logger.log("Sofort-Antwort-Agent gestartet", { name: payload.name, email: payload.email });

    // Schritt 1: Anfrage analysieren
    let kategorie: Kategorie = "SONSTIGES";
    try {
      kategorie = await analysiereAnfrage(payload);
    } catch (e) {
      logger.error("Schritt 1 fehlgeschlagen", { error: e });
    }

    // Schritt 2: Antwort generieren
    let antwort: Antwort = {
      betreff: `Danke für Ihre Nachricht, ${payload.name}`,
      emailText: `Guten Tag ${payload.name},\n\nIch melde mich innerhalb von 24 Stunden persönlich bei Ihnen.`,
    };
    try {
      antwort = await generiereAntwort(payload.name, payload.message, payload.company, kategorie);
    } catch (e) {
      logger.error("Schritt 2 fehlgeschlagen", { error: e });
    }

    // Schritt 3: E-Mail senden
    let gesendet = false;
    try {
      gesendet = await sendeEmail(payload.email, antwort.betreff, antwort.emailText);
    } catch (e) {
      logger.error("Schritt 3 fehlgeschlagen", { error: e });
    }
    const antwortZeit = new Date();

    // Schritt 4: Tracking
    const status = gesendet ? "GESENDET" : "FEHLER";
    try {
      await trackeAnfrage(payload.name, payload.email, payload.message, kategorie, status, anfrageZeit, antwortZeit);
    } catch (e) {
      logger.error("Schritt 4 fehlgeschlagen", { error: e });
    }

    logger.log("Sofort-Antwort-Agent abgeschlossen", { kategorie, status });
    return { kategorie, status };
  },
});
