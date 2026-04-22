import { schedules, wait } from "@trigger.dev/sdk/v3";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000,
});

function fetchMitTimeout(url: string, options?: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function getGoogleAuth() {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON fehlt");
  const credentials = JSON.parse(credentialsJson);
  return new GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

async function getSheet() {
  console.log("Google Sheets Auth wird initialisiert...");
  const auth = getGoogleAuth();
  const sheets = googleSheets({ version: "v4", auth });
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("GOOGLE_SHEET_ID fehlt");
  return { sheets, sheetId };
}

async function ladeVorhandeneEintraege(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string
): Promise<{ firmen: Set<string>; heuteKontaktiert: number }> {
  console.log("Lade bestehende Einträge aus Google Sheets...");
  const heute = new Date().toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Buchhalter Outreach!A:F",
  });

  const rows = response.data.values ?? [];
  const firmen = new Set<string>();
  let heuteKontaktiert = 0;

  for (const row of rows.slice(1)) {
    const firma = row[0] as string | undefined;
    const status = row[2] as string | undefined;
    const datum = row[3] as string | undefined;
    if (firma) firmen.add(firma.toLowerCase().trim());
    if (status === "KONTAKTIERT" && datum === heute) heuteKontaktiert++;
  }

  console.log(`${rows.length - 1} bestehende Einträge geladen`);
  return { firmen, heuteKontaktiert };
}

async function stelleHeaderSicher(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string
): Promise<void> {
  // Prüfe ob Tab existiert, sonst anlegen
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const tabExistiert = spreadsheet.data.sheets?.some(
    (s) => s.properties?.title === "Buchhalter Outreach"
  );

  if (!tabExistiert) {
    console.log("Tab 'Buchhalter Outreach' wird angelegt...");
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: "Buchhalter Outreach" } } }],
      },
    });
  }

  // Header setzen falls noch nicht vorhanden
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Buchhalter Outreach!A1:F1",
  });
  const ersteZeile = response.data.values?.[0];
  if (!ersteZeile || ersteZeile[0] !== "Firma") {
    console.log("Header-Zeile wird angelegt...");
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: "Buchhalter Outreach!A1:F1",
      valueInputOption: "RAW",
      requestBody: {
        values: [["Firma", "Stadt", "Status", "Datum", "Uhrzeit", "Betreff"]],
      },
    });
  }
}

async function suchePerGoogleMaps(
  zielbranche: string,
  zielstadt: string
): Promise<Array<{ name: string; adresse: string }>> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY fehlt");

  console.log("Google Maps API wird aufgerufen...");
  const query = encodeURIComponent(`${zielbranche} ${zielstadt}`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`;

  const response = await fetchMitTimeout(url);
  if (!response.ok) throw new Error(`Google Maps Fehler: ${response.status}`);

  const data = (await response.json()) as {
    status: string;
    results: Array<{ name: string; formatted_address: string }>;
  };

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Maps Status: ${data.status}`);
  }

  console.log(`Google Maps: ${data.results.length} Treffer (Status: ${data.status})`);
  return data.results.map((r) => ({ name: r.name, adresse: r.formatted_address }));
}

async function generiereEmail(firma: string, stadt: string): Promise<string> {
  console.log(`Generiere E-Mail für: ${firma}`);
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 700,
    messages: [
      {
        role: "user",
        content: `Schreibe eine kurze E-Mail an die Kanzlei "${firma}" in ${stadt}.

Struktur (exakt so):
1. Beginne mit: "Sehr geehrte Damen und Herren von ${firma},"
2. Absatz 1: Erkläre dass unser System täglich automatisch neue Firmengründungen findet und im Namen der Kanzlei anschreibt – ohne Zeitaufwand für die Kanzlei.
3. Absatz 2: "Buchhalter die dieses System nutzen gewinnen durchschnittlich 3-5 neue Mandanten pro Monat."
4. Absatz 3: "Wären Sie offen für ein 15-minütiges Gespräch, um zu sehen ob das für Ihre Kanzlei passt?"

Regeln:
- Maximal 5 Sätze insgesamt
- Ton: direkt, professionell, menschlich
- Verbotene Wörter: innovativ, KI-Agent, Lösung, revolutionär, optimieren, skalieren
- Füge KEINE Signatur, KEINE Verabschiedung und KEINEN Betreff hinzu
- Sprache: Deutsch`,
      },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}

async function sendeEmail(
  firma: string,
  betreff: string,
  inhalt: string
): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const absenderEmail = process.env.ABSENDER_EMAIL;
  const replyToEmail = process.env.REPLY_TO_EMAIL;
  const testEmail = process.env.TEST_EMAIL;

  if (!apiKey || !absenderEmail || !testEmail) {
    throw new Error("Brevo Env-Vars fehlen (BREVO_API_KEY, ABSENDER_EMAIL, TEST_EMAIL)");
  }

  const signatur = `\n\nMit freundlichen Grüßen\nNIO Automation\nanfragen@nio-automation.de`;
  const vollstaendigerInhalt = inhalt + signatur;

  const payload = {
    sender: { name: "NIO Automation", email: absenderEmail },
    replyTo: { email: replyToEmail ?? absenderEmail },
    to: [{ email: testEmail }],
    subject: betreff,
    textContent: vollstaendigerInhalt,
  };

  console.log(`Sende E-Mail via Brevo für: ${firma}`);
  const response = await fetchMitTimeout(
    "https://api.brevo.com/v3/smtp/email",
    {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const responseBody = await response.text();
  console.log(`Brevo Response ${response.status}: ${responseBody}`);

  return response.status === 200 || response.status === 201;
}

async function trackingEintrag(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  firma: string,
  stadt: string,
  betreff: string
): Promise<void> {
  const jetzt = new Date();
  const datum = jetzt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
  const uhrzeit = jetzt.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Buchhalter Outreach!A:F",
    valueInputOption: "RAW",
    requestBody: {
      values: [[firma, stadt, "KONTAKTIERT", datum, uhrzeit, betreff]],
    },
  });
}

export const buchhalterOutreach = schedules.task({
  id: "buchhalter-outreach",
  cron: "0 6 * * 1-5", // Mo–Fr 08:00 CEST (= 06:00 UTC)
  machine: "small-1x",
  maxDuration: 300,
  run: async () => {
    console.log("=== Buchhalter Outreach Agent gestartet ===");

    const zielbranche = process.env.ZIELBRANCHE ?? "Steuerberater";
    const zielstadt = process.env.ZIELSTADT ?? "Hamburg";
    const maxEmails = parseInt(process.env.MAX_EMAILS_PRO_TAG ?? "10", 10);

    console.log(`Konfiguration: ${zielbranche} in ${zielstadt}, max ${maxEmails} E-Mails`);

    // Schritt 1: Google Maps
    let firmen: Array<{ name: string; adresse: string }>;
    try {
      firmen = await suchePerGoogleMaps(zielbranche, zielstadt);
    } catch (err) {
      console.error("Google Maps Fehler:", err);
      return;
    }

    if (firmen.length === 0) {
      console.log("Keine Firmen gefunden. Stoppe.");
      return;
    }

    // Schritt 2: Google Sheets laden
    let sheets: ReturnType<typeof googleSheets>;
    let sheetId: string;
    try {
      ({ sheets, sheetId } = await getSheet());
      await stelleHeaderSicher(sheets, sheetId);
    } catch (err) {
      console.error("Google Sheets Init Fehler:", err);
      return;
    }

    let { firmen: vorhandene, heuteKontaktiert } = await ladeVorhandeneEintraege(sheets, sheetId);
    console.log(`Bereits heute kontaktiert: ${heuteKontaktiert}/${maxEmails}`);

    if (heuteKontaktiert >= maxEmails) {
      console.log("Tageslimit erreicht. Stoppe.");
      return;
    }

    // Loop über gefundene Firmen
    for (const firma of firmen) {
      if (heuteKontaktiert >= maxEmails) {
        console.log("Tageslimit erreicht. Stoppe.");
        break;
      }

      const firmaKey = firma.name.toLowerCase().trim();
      if (vorhandene.has(firmaKey)) {
        console.log(`Überspringe (bereits kontaktiert): ${firma.name}`);
        continue;
      }

      // Schritt 3: E-Mail generieren
      const betreff = `KI-Agent für neue Mandanten – ${firma.name}`;
      let emailInhalt: string;
      try {
        emailInhalt = await generiereEmail(firma.name, zielstadt);
      } catch (err) {
        console.error(`OpenAI Fehler für ${firma.name}:`, err);
        continue;
      }

      // Schritt 4: E-Mail senden
      try {
        const gesendet = await sendeEmail(firma.name, betreff, emailInhalt);
        if (!gesendet) {
          console.error(`Brevo Fehler für ${firma.name}: E-Mail nicht gesendet`);
          continue;
        }
        console.log(`E-Mail gesendet: ${firma.name}`);
      } catch (err) {
        console.error(`Brevo Fehler für ${firma.name}:`, err);
        continue;
      }

      // 5 Sekunden Pause zwischen Versand (Brevo Rate-Limit)
      await wait.for({ seconds: 5 });

      // Schritt 5: Tracking
      try {
        await trackingEintrag(sheets, sheetId, firma.name, zielstadt, betreff);
        vorhandene.add(firmaKey);
        heuteKontaktiert++;
      } catch (err) {
        console.error(`Sheets Tracking Fehler für ${firma.name}:`, err);
      }
    }

    console.log(`=== Fertig. Heute kontaktiert: ${heuteKontaktiert} ===`);
  },
});
