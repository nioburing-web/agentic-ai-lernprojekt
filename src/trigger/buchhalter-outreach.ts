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

export async function findeEmailAufWebsite(
  websiteUrl: string
): Promise<{ email: string | null; kontaktformularUrl: string | null }> {
  let baseUrl = websiteUrl;
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    baseUrl = "https://" + baseUrl;
  }
  baseUrl = baseUrl.replace(/\/$/, "");

  let domain: string;
  try {
    domain = new URL(baseUrl).hostname.replace("www.", "");
  } catch {
    console.log(`Ungültige URL: ${websiteUrl}`);
    return { email: null, kontaktformularUrl: null };
  }

  const kandidatenseiten = [
    baseUrl,
    `${baseUrl}/kontakt`,
    `${baseUrl}/impressum`,
    `${baseUrl}/contact`,
  ];

  const alleEmails: string[] = [];

  for (const seite of kandidatenseiten) {
    let inhalt: string;
    try {
      const res = await fetchMitTimeout(
        seite,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "de-DE,de;q=0.9",
          },
        },
        5000
      );
      if (!res.ok) continue;
      inhalt = await res.text();
    } catch {
      continue;
    }

    const gefunden = [...inhalt.matchAll(EMAIL_REGEX)]
      .map((m) => m[0].toLowerCase().replace(/[.,;)]+$/, ""))
      .filter((email) => email.includes(`@${domain}`) || email.includes(`@www.${domain}`));

    for (const email of gefunden) {
      const prefix = email.split("@")[0];
      if (BEVORZUGTE_PREFIXES.has(prefix)) return { email, kontaktformularUrl: null };
      alleEmails.push(email);
    }
  }

  for (const email of [...new Set(alleEmails)]) {
    const prefix = email.split("@")[0];
    if (!IGNORIERTE_PREFIXES.has(prefix)) return { email, kontaktformularUrl: null };
  }

  // Kontaktformular suchen wenn keine E-Mail gefunden
  const formularSeiten = [
    `${baseUrl}/kontakt`,
    `${baseUrl}/contact`,
    baseUrl,
  ];

  for (const seite of formularSeiten) {
    let inhalt: string;
    try {
      const res = await fetchMitTimeout(seite, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        },
      }, 5000);
      if (!res.ok) continue;
      inhalt = await res.text();
    } catch {
      continue;
    }

    // Prüfe ob Seite ein Formular mit Nachrichtenfeld enthält
    const hatFormular =
      inhalt.includes("<form") &&
      (inhalt.toLowerCase().includes("textarea") ||
        inhalt.toLowerCase().includes('type="email"') ||
        inhalt.toLowerCase().includes('name="nachricht"') ||
        inhalt.toLowerCase().includes('name="message"'));

    if (hatFormular) {
      console.log(`Kontaktformular gefunden auf: ${seite}`);
      return { email: null, kontaktformularUrl: seite };
    }
  }

  return { email: null, kontaktformularUrl: null };
}

async function generiereEmail(firma: string, stadt: string): Promise<string> {
  console.log(`Generiere E-Mail für: ${firma}`);
  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.8,
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `Schreibe eine kurze E-Mail an die Buchhalter-/Steuerberaterkanzlei ${firma} in ${stadt}.

Beginne mit dieser Anrede (zählt nicht zu den Sätzen):
Guten Tag ${firma} Team,

Schreibe danach genau drei Absätze mit dieser festen Satz-Verteilung:

Absatz 1 – 2 Sätze – Das echte Problem:
Satz 1: Beobachte ehrlich und locker, dass Mandantengewinnung Zeit kostet.
Satz 2: Zeige Verständnis – Buchhalter und Steuerberater haben diese Zeit kaum, weil sie mit bestehenden Mandanten ausgelastet sind.

Absatz 2 – 2 Sätze – Was ich mache:
Schreibe aus der Ich-Perspektive einer einzelnen Person (kein Firmenname).
Satz 3: Erkläre kurz, wie du Kanzleien hilfst neue Mandanten zu gewinnen ohne dass sie selbst Zeit investieren müssen.
Satz 4: Klingt wie ein Freund der etwas empfiehlt – kein Versprechen, keine Zahlen.

Absatz 3 – 1 Satz – Weicher Call to Action:
Satz 5: Lade zu einem 15-Minuten-Gespräch ein. Kein Druck. Sinngemäß: Ich zeige Ihnen live wie es funktioniert – Sie entscheiden dann selbst ob es passt.

Regeln:
- Exakt 5 Sätze insgesamt (2 + 2 + 1), nicht mehr, nicht weniger
- Durchgehend Ich-Perspektive – kein Firmenname im Text
- Locker und menschlich – wie eine einzelne Person schreibt, nicht wie Marketing
- Keine Anführungszeichen im Text
- Keine Aufzählungszeichen oder ungewöhnlichen Sonderzeichen
- Kein Betreff, keine Verabschiedung, keine Signatur
- Sprache: Deutsch`,
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
  const absenderEmail = process.env.ABSENDER_EMAIL;
  const replyToEmail = process.env.REPLY_EMAIL;
  // TEST_EMAIL überschreibt Empfänger wenn gesetzt (Testmodus)
  const testEmail = process.env.TEST_EMAIL;

  if (!apiKey || !absenderEmail) {
    throw new Error("Brevo Env-Vars fehlen (BREVO_API_KEY, ABSENDER_EMAIL)");
  }

  const empfaenger = testEmail ?? empfaengerEmail;
  if (testEmail) {
    console.log(`Testmodus aktiv – sende an ${testEmail} statt ${empfaengerEmail}`);
  }

  const signatur = `\n\nMit freundlichen Grüßen\nNIO Automation\n${absenderEmail}`;
  const vollstaendigerInhalt = inhalt + signatur;

  const payload = {
    sender: { name: "NIO Automation", email: absenderEmail },
    replyTo: { email: replyToEmail ?? absenderEmail },
    to: [{ email: empfaenger }],
    subject: betreff,
    textContent: vollstaendigerInhalt,
    type: "transactional",
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
    let firmen: Array<{ name: string; adresse: string; placeId: string }>;
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
    const neueKandidaten = firmen.filter(f => !vorhandene.has(f.name.toLowerCase().trim())).length;
    console.log(`Bereits heute kontaktiert: ${heuteKontaktiert}/${maxEmails}`);
    console.log(`Google Maps Ergebnisse: ${firmen.length} gesamt, ${vorhandene.size} bereits im Sheet, ${neueKandidaten} neue Kandidaten`);

    if (heuteKontaktiert >= maxEmails) {
      console.log("Tageslimit erreicht. Stoppe.");
      return;
    }

    let skipBereitsKontaktiert = 0;
    let skipKeineWebsite = 0;
    let skipKeineEmail = 0;

    // Loop über gefundene Firmen
    for (const firma of firmen) {
      if (heuteKontaktiert >= maxEmails) {
        console.log(`Tageslimit erreicht bei ${heuteKontaktiert}/${maxEmails}. Stoppe.`);
        break;
      }

      const firmaKey = firma.name.toLowerCase().trim();
      if (vorhandene.has(firmaKey)) {
        skipBereitsKontaktiert++;
        console.log(`Überspringe (bereits im Sheet): ${firma.name}`);
        continue;
      }

      // Schritt 1b: Website via Place Details holen (Text Search gibt kein website-Feld)
      const website = await holeWebsiteVonPlaceDetails(firma.placeId);
      if (!website) {
        skipKeineWebsite++;
        console.log(`Keine Website gefunden – überspringe: ${firma.name}`);
        continue;
      }

      let firmaEmail: string | null = null;
      try {
        const emailResult = await findeEmailAufWebsite(website);
        firmaEmail = emailResult.email;
      } catch (err) {
        console.error(`E-Mail-Suche Fehler für ${firma.name}:`, err);
        continue;
      }

      if (!firmaEmail) {
        skipKeineEmail++;
        console.log(`Keine E-Mail gefunden – überspringe: ${firma.name} (${website})`);
        continue;
      }

      console.log(`E-Mail gefunden: ${firmaEmail} für ${firma.name}`);

      // Schritt 3: E-Mail generieren
      const betreff = `Neue Mandanten für ${firma.name} – ohne eigenen Aufwand`;
      let emailInhalt: string;
      try {
        emailInhalt = await generiereEmail(firma.name, zielstadt);
      } catch (err) {
        console.error(`OpenAI Fehler für ${firma.name}:`, err);
        continue;
      }

      // Schritt 4: E-Mail senden
      try {
        const gesendet = await sendeEmail(firma.name, betreff, emailInhalt, firmaEmail);
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

    console.log(`=== Fertig. Heute kontaktiert: ${heuteKontaktiert}/${maxEmails} ===`);
    console.log(`Skip-Gründe: ${skipBereitsKontaktiert}x bereits im Sheet, ${skipKeineWebsite}x keine Website, ${skipKeineEmail}x keine E-Mail`);
  },
});
