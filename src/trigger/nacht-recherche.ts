import { schedules, wait } from "@trigger.dev/sdk";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import OpenAI from "openai";

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

// ─── Outreach Queue Sheet ─────────────────────────────────────────────────────

const QUEUE_TAB = "Outreach Queue";
const QUEUE_HEADER = ["Typ", "Name", "Stadt", "Kontakt", "Entwurf", "Status", "Erstellt", "Gesendet", "Betreff"];

async function sicherQueueTab(sheets: ReturnType<typeof googleSheets>, sheetId: string): Promise<void> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const tabExistiert = spreadsheet.data.sheets?.some(s => s.properties?.title === QUEUE_TAB);

  if (!tabExistiert) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: QUEUE_TAB } } }] },
    });
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!A1:I1`,
  });

  if (!response.data.values?.[0] || response.data.values[0][0] !== "Typ") {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${QUEUE_TAB}!A1:I1`,
      valueInputOption: "RAW",
      requestBody: { values: [QUEUE_HEADER] },
    });
  }
}

async function ladeVorhandeneKontakte(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string
): Promise<Set<string>> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!A:D`,
  });
  const rows = response.data.values ?? [];
  const kontakte = new Set<string>();
  for (const row of rows.slice(1)) {
    if (row[3]) kontakte.add((row[3] as string).toLowerCase().trim());
  }
  return kontakte;
}

async function speichereDraft(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  typ: "EMAIL" | "LINKEDIN",
  name: string,
  stadt: string,
  kontakt: string,
  entwurf: string,
  betreff = ""
): Promise<void> {
  const heute = new Date().toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!A:I`,
    valueInputOption: "RAW",
    requestBody: { values: [[typ, name, stadt, kontakt, entwurf, "DRAFT", heute, "", betreff]] },
  });
}

// ─── E-Mail Research ──────────────────────────────────────────────────────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const IGNORIERTE_PREFIXES = new Set([
  "noreply", "no-reply", "support", "postmaster",
  "webmaster", "admin", "newsletter", "news", "spam", "abuse",
]);

const IGNORIERTE_DOMAINS = ["kammer", "schlichtung", "brak", "stbk", "steuerberaterkammer", "rechtsanwaltskammer", "bundesverband", "verband"];
const BEVORZUGTE_PREFIXES = new Set([
  "kontakt", "contact", "mail", "office", "anfragen",
  "anfrage", "buchung", "beratung", "kanzlei",
]);

async function suchePerGoogleMaps(branche: string, stadt: string) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY fehlt");
  const query = encodeURIComponent(`${branche} ${stadt}`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`;
  const response = await fetchMitTimeout(url);
  if (!response.ok) throw new Error(`Google Maps Fehler: ${response.status}`);
  const data = await response.json() as {
    status: string;
    results: Array<{ name: string; formatted_address: string; place_id: string }>;
  };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") throw new Error(`Google Maps Status: ${data.status}`);
  return data.results.map(r => ({ name: r.name, adresse: r.formatted_address, placeId: r.place_id }));
}

async function holeWebsiteVonPlaceDetails(placeId: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=website&key=${apiKey}`;
  try {
    const response = await fetchMitTimeout(url, {}, 5000);
    if (!response.ok) return null;
    const data = await response.json() as { result?: { website?: string }; status: string };
    return data.result?.website ?? null;
  } catch { return null; }
}

function extrahiereEmails(html: string): string[] {
  const mailtoEmails = [...html.matchAll(/href=["']mailto:([^"'?\s]+)/gi)]
    .map(m => m[1].toLowerCase().replace(/[.,;)]+$/, ""))
    .filter(e => e.includes("@"));
  const textEmails = [...html.matchAll(EMAIL_REGEX)].map(m => m[0].toLowerCase().replace(/[.,;)]+$/, ""));
  return [...new Set([...mailtoEmails, ...textEmails])];
}

function findeImpressumLink(html: string, baseUrl: string): string | null {
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

async function findeEmailAufWebsite(websiteUrl: string): Promise<string | null> {
  let baseUrl = websiteUrl;
  if (!baseUrl.startsWith("http")) baseUrl = "https://" + websiteUrl;
  baseUrl = baseUrl.replace(/\/$/, "");

  let domain: string;
  try { domain = new URL(baseUrl).hostname.replace("www.", ""); }
  catch { return null; }

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
    } catch { return null; }
  };

  const pruefEmail = (email: string, nurDomain = false): boolean => {
    if (!email.includes("@")) return false;
    const prefix = email.split("@")[0];
    if (IGNORIERTE_PREFIXES.has(prefix)) return false;
    if (nurDomain && !email.includes(`@${domain}`) && !email.includes(`@www.${domain}`)) return false;
    return true;
  };

  const startseite = await fetchSeite(baseUrl);
  let impressumUrl = `${baseUrl}/impressum`;
  if (startseite) {
    const dynamisch = findeImpressumLink(startseite, baseUrl);
    if (dynamisch) impressumUrl = dynamisch;
  }

  const kandidatenseiten = [baseUrl, `${baseUrl}/kontakt`, `${baseUrl}/contact`, `${baseUrl}/ueber-uns`];
  const alleEmails: string[] = [];

  for (const seite of kandidatenseiten) {
    const inhalt = seite === baseUrl ? startseite : await fetchSeite(seite);
    if (!inhalt) continue;
    for (const email of extrahiereEmails(inhalt)) {
      if (!pruefEmail(email, true)) continue;
      const prefix = email.split("@")[0];
      if (BEVORZUGTE_PREFIXES.has(prefix)) return email;
      alleEmails.push(email);
    }
  }

  const impressumInhalt = await fetchSeite(impressumUrl);
  if (impressumInhalt) {
    for (const email of extrahiereEmails(impressumInhalt)) {
      if (!pruefEmail(email, false)) continue;
      const prefix = email.split("@")[0];
      if (BEVORZUGTE_PREFIXES.has(prefix)) return email;
      alleEmails.push(email);
    }
  }

  for (const email of [...new Set(alleEmails)]) {
    if (pruefEmail(email, false)) return email;
  }
  return null;
}

function htmlZuText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Zieht echten Seiten-Text (Startseite + Leistungen/Über-uns) für eine WAHRE Beobachtung.
async function holeWebsiteText(websiteUrl: string): Promise<string> {
  let baseUrl = websiteUrl;
  if (!baseUrl.startsWith("http")) baseUrl = "https://" + websiteUrl;
  baseUrl = baseUrl.replace(/\/$/, "");

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
    } catch { return null; }
  };

  const seiten = [baseUrl, `${baseUrl}/leistungen`, `${baseUrl}/ueber-uns`];
  let text = "";
  for (const seite of seiten) {
    const html = await fetchSeite(seite);
    if (html) text += " " + htmlZuText(html);
    if (text.length > 2500) break;
  }
  return text.slice(0, 2500).trim();
}

const BRANCHE_HOOKS: Record<string, string> = {
  Steuerberater: "60% der Mandantenanfragen gehen an die Kanzlei, die als erstes antwortet — nicht an die beste.",
  Buchhalter: "Wer eine Buchhaltungsanfrage nicht innerhalb von 2 Stunden beantwortet, verliert sie meist an den nächsten.",
  Buchhaltung: "Wer eine Buchhaltungsanfrage nicht innerhalb von 2 Stunden beantwortet, verliert sie meist an den nächsten.",
  Immobilienmakler: "Immobilienkäufer schreiben im Schnitt 3 Makler gleichzeitig — wer zuerst antwortet, macht das Geschäft.",
  Rechtsanwalt: "Mandanten entscheiden sich oft für die Kanzlei, die als erste antwortet — nicht für die erfahrenste.",
  Unternehmensberater: "Neue Anfragen landen häufig beim ersten Berater, der zurückschreibt — nicht beim besten.",
  Zahnarzt: "30% der Terminanfragen kommen abends oder am Wochenende — und landen bei der Praxis, die als erste reagiert.",
  Physiotherapie: "Patienten buchen beim ersten Therapeuten, der antwortet — Wartelisten entstehen durch langsame Reaktionszeiten.",
  Versicherungsmakler: "Kunden fragen täglich nach Vertragsdetails und Schadensmeldungen — wer nicht sofort antwortet, verliert sie an den nächsten Makler.",
  Hausverwaltung: "Mieter erwarten Antworten auf Anfragen innerhalb von Stunden — wer nicht schnell reagiert, riskiert Eskalation und schlechte Bewertungen.",
  Tierarztpraxis: "Viele Tierbesitzer rufen abends oder am Wochenende an und finden niemanden — die erste Praxis die reagiert, bekommt den Termin.",
  Notariat: "Mandanten fragen wiederholt nach dem Status ihrer Dokumente — manuelle Statusupdates fressen täglich wertvolle Arbeitszeit.",
  "Kfz-Werkstatt": "Kunden wollen bei jedem Schritt wissen wann ihr Auto fertig ist — wer proaktiv informiert, bekommt 5-Sterne-Bewertungen.",
  Fahrschule: "Fahrschüler buchen Stunden und Prüfungen kurzfristig um — manuelle Verwaltung kostet täglich Stunden die fürs Unterrichten fehlen.",
  Heilpraktiker: "Patienten erscheinen nicht zum Termin wenn sie keine Erinnerung bekommen — Ausfallrate sinkt spürbar mit automatischen Erinnerungen.",
};

// Drei wirklich unterschiedliche Mail-Strukturen, damit die Mails nicht wie ein
// Serienbrief wirken. Pro Mail wird zufällig eine gewählt.
const MAIL_ANGLES: { name: string; struktur: string }[] = [
  {
    name: "detail-frage",
    struktur: `1. Steig mit EINER konkreten Beobachtung ein, die NUR auf diese Firma zutrifft — beziehe dich auf ein echtes Detail (eine konkret genannte Leistung, ein Schwerpunkt, ein Name, ein Satz von ihrer Seite). KEINE allgemeine Aussage über fehlende Website-Funktionen.
2. Verknüpfe das in EINEM Satz mit einer konkreten Reibung in ihrem Alltag. Dann EIN Satz dazu, dass du KI-Agenten für genau solche Betriebe baust (nicht behaupten, es sei schon fertig).
3. Biete konkret an, in 2 Minuten ein passendes Beispiel zu schicken, und gib einen leichten Ausweg ("wenn's nicht passt, kurz Bescheid und ich lass dich in Ruhe"). Variiere die Wortwahl.`,
  },
  {
    name: "konkrete-idee",
    struktur: `1. Steig mit EINER konkreten Beobachtung aus dem Website-Auszug ein (echtes Detail dieser Firma).
2. Gib dann EINE konkrete, auf sie zugeschnittene Idee, was ein KI-Agent bei genau ihnen übernehmen könnte — spezifisch genug, dass man merkt: du hast wirklich nachgedacht. Kein allgemeines "Anfragen beantworten".
3. Biete konkret an, ihnen dazu in 2 Minuten ein kurzes Beispiel zu schicken, plus leichter Ausweg ("wenn's nicht passt, kurz Bescheid, dann meld ich mich nicht wieder"). Kein Druck.`,
  },
  {
    name: "echte-frage",
    struktur: `1. Steig mit EINER konkreten Beobachtung aus dem Website-Auszug ein.
2. Stell eine echte, spezifische Frage dazu, wie sie einen bestimmten Prozess heute handhaben — so wie jemand fragt, der das Thema versteht, nicht wie ein Verkäufer.
3. Erwähne beiläufig in EINEM Satz, dass du KI-Agenten für solche Betriebe baust, und biete an, in 2 Minuten ein passendes Beispiel zu schicken — mit leichtem Ausweg, falls es gerade nicht passt.`,
  },
];

async function generiereEmailEntwurf(firma: string, stadt: string, branche: string, website?: string | null, websiteText?: string): Promise<{ betreff: string; inhalt: string }> {
  const openai = getOpenAI();
  const branchenHinweis = BRANCHE_HOOKS[branche] ?? "Anfragen werden oft nicht schnell genug beantwortet — der Kunde ist dann schon weg.";
  const websiteAuszug = websiteText && websiteText.trim().length > 80 ? websiteText.trim().slice(0, 1800) : "";

  // Ohne brauchbaren Website-Auszug ist keine echte Personalisierung möglich →
  // immer "echte-frage" (ehrliche Frage statt erfundener Beobachtung).
  const angle = websiteAuszug
    ? MAIL_ANGLES[Math.floor(Math.random() * MAIL_ANGLES.length)]!
    : MAIL_ANGLES[2]!;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.9,
    max_tokens: 350,
    messages: [
      {
        role: "system",
        content: "Du bist Nio Büring, 19 Jahre alt aus Hamburg. Du schreibst Kaltakquise-E-Mails — so als hättest du dir wirklich kurz die Website der Firma angeschaut und schreibst direkt drauflos. Kein Marketingsprech, keine Floskeln, kein Ausrufezeichen. Klingt wie von einem echten Menschen getippt, nicht wie KI. Du erfindest NIE Fakten über die Firma und NIE Ergebnisse oder Referenzkunden — du hast noch keine vorzuweisen. Deine Glaubwürdigkeit kommt aus Spezifität, nicht aus behaupteten Erfolgen.",
      },
      {
        role: "user",
        content: `Schreibe eine kurze Kaltakquise-E-Mail an ${firma} in ${stadt} (${branche}).
${websiteAuszug ? `\nAuszug von DEREN Website (nur das hier ist echt — beziehe deine Beobachtung darauf):\n"""${websiteAuszug}"""\n` : "\n(Kein brauchbarer Website-Auszug vorhanden — erfinde KEINE Beobachtung über die Firma.)\n"}
Hintergrundwissen zur Branche (nur Kontext, NICHT wörtlich übernehmen): ${branchenHinweis}

Struktur für DIESE Mail:
${angle.struktur}

Regeln:
- Beginne mit "Hey," (oder einer ähnlich lockeren Anrede) und steig DANN direkt mit dem konkreten Detail ein. Starte NICHT mit "ich habe gesehen", "mir ist aufgefallen", "ich bin auf euch gestoßen" oder einer ähnlichen Beobachtungs-Floskel — das ist der klassische Serienbrief-Einstieg. Der erste inhaltliche Satz muss variieren.
- Sag in EINEM beiläufigen Halbsatz wer du bist: Nio, baust KI-Agenten in Hamburg. Keine förmliche Vorstellung, kein Lebenslauf.
- Erwähne ${firma} einmal natürlich im Text
- Unter 85 Wörter, keine Signatur, keine Anführungszeichen
- KEIN Preis, kein "2 Wochen"- oder Test-Angebot — die Mail soll Neugier wecken, nicht verkaufen
- Erfinde keine Ergebnisse, Zahlen oder Referenzkunden
- Abschluss (unabhängig vom Angle): schließe mit EINEM winzigen, konkreten nächsten Schritt, der fast keine Mühe kostet — z.B. anbieten, in 2 Minuten ein passendes Beispiel oder eine kurze Idee zu schicken. Direkt danach ein leichter Ausweg (Risk-Reversal): wenn's gerade nicht passt, reicht ein kurzes "kein Interesse" und du meldest dich nicht wieder. KEINE vage Floskel wie "Lust die Idee mal weiterzudenken?".
- Verbotene Marketing-Wörter: "revolutionieren", "optimieren", "transformieren", "maßgeschneidert", "innovativ", "Lösung", "effizienzsteigerung", "testen"
- Verbotene Floskeln (zu oft benutzt, wirken wie Serienbrief — formuliere frisch): "liegen bleiben", "genau dieses Problem lösen", "wer zuerst antwortet gewinnt", "Soll ich dir kurz skizzieren wie das bei euch konkret aussehen könnte", "Lust die Idee mal kurz weiterzudenken", "hättet ihr Lust die Idee durchzusprechen"
- Nutze NICHT als Aufhänger: "keine Online-Terminbuchung", "nur ein Kontaktformular", "kein Live-Chat" — das ist generisch. Finde etwas, das wirklich nach DIESER Firma klingt.

Schreibe auch einen Betreff (max 6 Wörter), der sich auf dein konkretes Detail bezieht, klein geschrieben wie von einem Menschen getippt — kein generisches "Interesse an…", "Idee für…" oder "Frage zu…", keine Zahl. Im Betreff gelten dieselben verbotenen Marketing-Wörter wie oben ("optimieren", "Lösung", "transformieren" usw.) — auf keinen Fall verwenden. Der Betreff muss auch für einen Außenstehenden verständlich klingen — KEIN hyper-spezifischer Nischenbegriff von ihrer Seite, der aus dem Kontext gerissen seltsam oder falsch adressiert wirkt.
Format:
BETREFF: <betreff>
EMAIL: <email-text>`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  const betreffMatch = raw.match(/BETREFF:\s*(.+)/);
  const emailMatch = raw.match(/EMAIL:\s*([\s\S]+)/);

  return {
    betreff: betreffMatch?.[1]?.trim() ?? "kurze frage",
    inhalt: emailMatch?.[1]?.trim() ?? raw,
  };
}

// ─── Main Task ────────────────────────────────────────────────────────────────
// LinkedIn-Outreach läuft separat über Claude + LinkedIn MCP (linkedin-outreach Skill)

export const nachtRecherche = schedules.task({
  id: "nacht-recherche",
  cron: {
    pattern: "0 23 * * 0-4", // 23:00 CEST So–Do → bereit für Mo–Fr morgens
    timezone: "Europe/Berlin",
  },
  machine: "small-2x",
  maxDuration: 600,
  run: async () => {
    console.log("=== Nacht-Recherche gestartet ===");

    const { sheets, sheetId } = await getQueue();
    await sicherQueueTab(sheets, sheetId);
    const vorhandene = await ladeVorhandeneKontakte(sheets, sheetId);

    const SUCHBEGRIFFE = [
      "Buchhalter", "Steuerberater", "Buchhaltung", "Immobilienmakler",
      "Rechtsanwalt", "Unternehmensberater", "Zahnarzt", "Physiotherapie",
      "Versicherungsmakler", "Hausverwaltung", "Tierarztpraxis", "Notariat",
      "Kfz-Werkstatt", "Fahrschule", "Heilpraktiker",
    ];
    const STAEDTE = ["Hamburg", "Berlin", "Köln", "München", "Stuttgart", "Frankfurt", "Düsseldorf", "Leipzig"];
    const dayOfWeek = new Date().getDay();
    const stadtIndex = ((dayOfWeek - 1) + STAEDTE.length) % STAEDTE.length;
    const zielstadt = STAEDTE[stadtIndex]!;

    // 4 zufällige Branchen für diese Nacht
    const zielBranchen = [...SUCHBEGRIFFE].sort(() => Math.random() - 0.5).slice(0, 4);

    console.log(`Ziel: ${zielBranchen.join(", ")} in ${zielstadt}`);

    // ── Phase 1: E-Mail-Leads ─────────────────────────────────────────────────
    console.log("Phase 1: E-Mail-Leads recherchieren...");
    let emailGespeichert = 0;

    for (const zielbranche of zielBranchen) {
      if (emailGespeichert >= 30) break;
      console.log(`Branche: ${zielbranche}...`);

      try {
        const firmen = await suchePerGoogleMaps(zielbranche, zielstadt);

        for (const firma of firmen) {
          if (emailGespeichert >= 30) break;

          const website = await holeWebsiteVonPlaceDetails(firma.placeId);
          if (!website) continue;

          const email = await findeEmailAufWebsite(website);
          if (!email) continue;

          const emailDomain = email.split("@")[1]?.toLowerCase() ?? "";
          if (IGNORIERTE_DOMAINS.some(d => emailDomain.includes(d) || firma.name?.toLowerCase().includes(d))) {
            console.log(`Kammer/Verband übersprungen: ${firma.name} (${email})`);
            continue;
          }

          if (vorhandene.has(email.toLowerCase())) {
            console.log(`Bereits in Queue: ${email}`);
            continue;
          }

          const websiteText = await holeWebsiteText(website);
          // Quality-Gate: ohne genug echten Website-Text gibt es keinen ehrlichen,
          // firmenspezifischen Aufhänger → Lead überspringen statt generisch anschreiben.
          if (websiteText.trim().length < 300) {
            console.log(`Zu wenig Website-Text (${websiteText.trim().length} Zeichen) für ${firma.name} – übersprungen`);
            continue;
          }
          const entwurf = await generiereEmailEntwurf(firma.name, zielstadt, zielbranche, website, websiteText);
          await speichereDraft(sheets, sheetId, "EMAIL", firma.name, zielstadt, email, entwurf.inhalt, entwurf.betreff);
          vorhandene.add(email.toLowerCase());
          emailGespeichert++;

          console.log(`E-Mail-Draft: ${firma.name} → ${email}`);
          await wait.for({ seconds: 2 });
        }
      } catch (err) {
        console.error(`${zielbranche} Fehler:`, err);
      }
    }

    console.log(`E-Mail-Phase fertig: ${emailGespeichert}/30 Drafts`);
    console.log(`=== Nacht-Recherche fertig: ${emailGespeichert} E-Mail Drafts ===`);
  },
});
