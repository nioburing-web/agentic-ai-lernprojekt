import { schedules, wait } from "@trigger.dev/sdk";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import OpenAI from "openai";

function getOpenAI(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000 });
}

// E-Mail-Filterregeln (gespiegelt aus tools/find_email.py)
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const IGNORIERTE_PREFIXES = new Set([
  "info", "noreply", "no-reply", "support", "postmaster",
  "webmaster", "admin", "newsletter", "news", "spam", "abuse",
]);
const BEVORZUGTE_PREFIXES = new Set([
  "kontakt", "contact", "mail", "office", "anfragen",
  "anfrage", "buchung", "beratung", "kanzlei",
]);

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
  const heute = new Date().toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
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

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Buchhalter Outreach!A1:G1",
  });
  const ersteZeile = response.data.values?.[0];
  if (!ersteZeile || ersteZeile[0] !== "Firma") {
    console.log("Header-Zeile wird angelegt...");
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: "Buchhalter Outreach!A1:G1",
      valueInputOption: "RAW",
      requestBody: {
        values: [["Firma", "Stadt", "Status", "Datum", "Uhrzeit", "Betreff", "Geoeffnet"]],
      },
    });
  }
}

async function suchePerGoogleMaps(
  zielbranche: string,
  zielstadt: string
): Promise<Array<{ name: string; adresse: string; placeId: string }>> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY fehlt");

  console.log("Google Maps API wird aufgerufen...");
  const query = encodeURIComponent(`${zielbranche} ${zielstadt}`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`;

  const response = await fetchMitTimeout(url);
  if (!response.ok) throw new Error(`Google Maps Fehler: ${response.status}`);

  const data = (await response.json()) as {
    status: string;
    results: Array<{ name: string; formatted_address: string; place_id: string }>;
  };

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Maps Status: ${data.status}`);
  }

  console.log(`Google Maps: ${data.results.length} Treffer (Status: ${data.status})`);
  return data.results.map((r) => ({
    name: r.name,
    adresse: r.formatted_address,
    placeId: r.place_id,
  }));
}

// Text Search gibt kein website-Feld zurück – Place Details ist nötig
async function holeWebsiteVonPlaceDetails(placeId: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=website&key=${apiKey}`;
  try {
    const response = await fetchMitTimeout(url, {}, 5000);
    if (!response.ok) return null;
    const data = (await response.json()) as { result?: { website?: string }; status: string };
    return data.result?.website ?? null;
  } catch {
    return null;
  }
}

function extrahiereEmails(html: string): string[] {
  // 1. mailto: Links direkt parsen (zuverlässigste Quelle)
  const mailtoEmails = [...html.matchAll(/href=["']mailto:([^"'?\s]+)/gi)]
    .map((m) => m[1].toLowerCase().replace(/[.,;)]+$/, ""))
    .filter((e) => e.includes("@"));

  // 2. Alle E-Mail-Adressen im Text
  const textEmails = [...html.matchAll(EMAIL_REGEX)]
    .map((m) => m[0].toLowerCase().replace(/[.,;)]+$/, ""));

  return [...new Set([...mailtoEmails, ...textEmails])];
}

function findeImpressumLink(html: string, baseUrl: string): string | null {
  // Impressum-Link dynamisch aus der Seite extrahieren
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

export async function findeEmailAufWebsite(
  websiteUrl: string
): Promise<{ email: string | null; kontaktformularUrl: string | null }> {
  let baseUrl = websiteUrl;
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    baseUrl = "https://" + websiteUrl;
  }
  baseUrl = baseUrl.replace(/\/$/, "");

  let domain: string;
  try {
    domain = new URL(baseUrl).hostname.replace("www.", "");
  } catch {
    console.log(`Ungültige URL: ${websiteUrl}`);
    return { email: null, kontaktformularUrl: null };
  }

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
    } catch {
      return null;
    }
  };

  const pruefEmail = (email: string, nurDomain = false): boolean => {
    if (!email.includes("@")) return false;
    const prefix = email.split("@")[0];
    if (IGNORIERTE_PREFIXES.has(prefix)) return false;
    if (nurDomain && !email.includes(`@${domain}`) && !email.includes(`@www.${domain}`)) return false;
    return true;
  };

  // Schritt 1: Startseite laden – Impressum-Link suchen + erste Emails
  const startseite = await fetchSeite(baseUrl);
  let impressumUrl = `${baseUrl}/impressum`;
  if (startseite) {
    const dynamisch = findeImpressumLink(startseite, baseUrl);
    if (dynamisch) impressumUrl = dynamisch;
  }

  // Schritt 2: Alle Kandidatenseiten prüfen (domain-gefiltert)
  const kandidatenseiten = [
    baseUrl,
    `${baseUrl}/kontakt`,
    `${baseUrl}/contact`,
    `${baseUrl}/ueber-uns`,
    `${baseUrl}/team`,
  ];

  const alleEmails: string[] = [];

  for (const seite of kandidatenseiten) {
    const inhalt = seite === baseUrl ? startseite : await fetchSeite(seite);
    if (!inhalt) continue;

    for (const email of extrahiereEmails(inhalt)) {
      if (!pruefEmail(email, true)) continue; // nur domain-Emails auf normalen Seiten
      const prefix = email.split("@")[0];
      if (BEVORZUGTE_PREFIXES.has(prefix)) return { email, kontaktformularUrl: null };
      alleEmails.push(email);
    }
  }

  // Schritt 3: Impressum – hier auch fremde Domains akzeptieren (z.B. gmail.com)
  const impressumInhalt = await fetchSeite(impressumUrl);
  if (impressumInhalt) {
    for (const email of extrahiereEmails(impressumInhalt)) {
      if (!pruefEmail(email, false)) continue; // kein Domain-Filter auf Impressum
      const prefix = email.split("@")[0];
      if (BEVORZUGTE_PREFIXES.has(prefix)) return { email, kontaktformularUrl: null };
      alleEmails.push(email);
    }
  }

  for (const email of [...new Set(alleEmails)]) {
    if (pruefEmail(email, false)) return { email, kontaktformularUrl: null };
  }

  return { email: null, kontaktformularUrl: null };
}

async function generiereEmail(
  firma: string,
  stadt: string,
): Promise<string> {
  console.log(`Generiere E-Mail für: ${firma}`);
  const openai = getOpenAI();
  const calendlyLink = process.env.CALENDLY_LINK ?? "https://calendly.com/nioburing/30min";

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.9,
    max_tokens: 300,
    messages: [
      {
        role: "system",
        content: `Du bist Nio – ein junger Unternehmer aus Hamburg. Du schreibst kurze persönliche Kaltakquise-E-Mails an Buchhalter und Steuerberater – wie ein echter Mensch, nicht wie ein Verkäufer.`,
      },
      {
        role: "user",
        content: `Schreibe eine kurze E-Mail an die Kanzlei ${firma} in ${stadt}.

Zeile 1:
Guten Tag,

Absatz 1 (2 Sätze):
Eine ganz konkrete Beobachtung über den Buchhalter-Alltag die jeder Buchhalter sofort wiedererkennt. Nicht abstrakt. Keine Formulierungen wie "beeindruckend", "Blick von außen" oder "hektisch". Klingt wie ein Gedanke den jemand laut ausspricht der die Branche wirklich kennt. Variiere bei jedem Run.

Absatz 2 (1 Satz):
Erkläre direkt was du gebaut hast: einen KI-Agenten der täglich automatisch neue Mandantenanfragen für Buchhaltungskanzleien generiert – ohne dass die Kanzlei selbst akquirieren muss. Ich-Perspektive. Konkret, kein Marketingsprech.

Absatz 3 (1 Satz):
Weiche Einladung zu einem 15-Minuten-Gespräch mit diesem Buchungslink: ${calendlyLink} – kein Druck, nur Neugier wecken.

Keine Signatur – kommt separat.
Keine Anführungszeichen.
Keine Sonderzeichen.
Jede E-Mail klingt anders.`,
      },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}

async function sendeEmail(
  firma: string,
  betreff: string,
  inhalt: string,
  empfaengerEmail: string
): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const absenderName = process.env.ABSENDER_NAME ?? "NIO Automation";
  const absenderEmail = process.env.ABSENDER_EMAIL;
  const replyToEmail = process.env.REPLY_TO_EMAIL;
  // TEST_EMAIL überschreibt Empfänger wenn gesetzt (Testmodus)
  const testEmail = process.env.TEST_EMAIL;

  if (!apiKey || !absenderEmail) {
    throw new Error("Brevo Env-Vars fehlen (BREVO_API_KEY, ABSENDER_EMAIL)");
  }

  const empfaenger = testEmail ?? empfaengerEmail;
  if (testEmail) {
    console.log(`Testmodus aktiv – sende an ${testEmail} statt ${empfaengerEmail}`);
  }

  const signatur = `\n\nMit freundlichen Grüßen\n${absenderName}\n${absenderEmail}`;
  const vollstaendigerInhalt = inhalt + signatur;

  const payload = {
    sender: { name: absenderName, email: absenderEmail },
    replyTo: { email: replyToEmail ?? absenderEmail },
    to: [{ email: empfaenger }],
    subject: betreff,
    textContent: vollstaendigerInhalt,
    type: "transactional",
    trackOpens: 1,
    trackClicks: 1,
  };

  console.log(`Sende E-Mail via Brevo für: ${firma} → ${empfaenger}`);
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
  const datum = jetzt.toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const uhrzeit = jetzt.toLocaleTimeString("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Buchhalter Outreach!A:G",
    valueInputOption: "RAW",
    requestBody: {
      values: [[firma, stadt, "KONTAKTIERT", datum, uhrzeit, betreff, "NEIN"]],
    },
  });
}

// Task deaktiviert – Logik übernommen von nacht-recherche + morgen-versand
