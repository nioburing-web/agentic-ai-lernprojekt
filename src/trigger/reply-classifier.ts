import { schedules, logger } from "@trigger.dev/sdk/v3";
import { ImapFlow } from "imapflow";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import OpenAI from "openai";

// Klassifizierungsregeln (aus skills/klassifizierung.md)
const KLASSIFIZIERUNGS_SKILL = `Du bist ein E-Mail-Klassifizierer für NIO Automation.

Kategorien und Signale:
- INTERESSIERT: "ja", "gerne", "klingt interessant", "können wir mal reden", "mehr erfahren", "Termin", "Angebot"
- ABGELEHNT: "nein", "kein Interesse", "danke aber", "nicht relevant", "bereits versorgt", "bitte keine weiteren E-Mails"
- RÜCKFRAGE: "was genau", "wie funktioniert", "welche Kosten", "Frage:", "?"
- ABWESEND: "abwesend", "urlaub", "out of office", "bin ab", "zurück am", "vertreten durch"

Regeln:
- Bei Unsicherheit: RÜCKFRAGE
- Nur eine Kategorie pro E-Mail
- Kurze Begründung in einem Satz

Antworte NUR in diesem Format: KATEGORIE|Begründung in einem Satz
Beispiel: INTERESSIERT|Empfänger zeigt Interesse und fragt nach einem Termin.`;

type EmailData = {
  uid: number;
  subject: string;
  from: string;
  body: string;
};

type Klassifizierung = {
  kategorie: "INTERESSIERT" | "ABGELEHNT" | "RÜCKFRAGE" | "ABWESEND";
  grund: string;
};

function getOpenAI(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000 });
}

function getGoogleAuth(): GoogleAuth {
  const credentialsJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!credentialsJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON fehlt");
  const credentials = JSON.parse(credentialsJson);
  return new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export function extrahiereFirmaAusBetreff(subject: string): string | null {
  const match = subject.match(/KI-Agent f[uü]r neue Mandanten\s*[–\-]\s*(.+)/i);
  return match?.[1]?.trim() ?? null;
}

export function extrahiereTextAusBody(rawSource: string): string {
  // Entferne E-Mail-Header (alles vor der ersten Leerzeile)
  const bodyStart = rawSource.indexOf("\r\n\r\n");
  let body = bodyStart >= 0 ? rawSource.slice(bodyStart + 4) : rawSource;

  // Entferne HTML-Tags
  body = body.replace(/<[^>]+>/g, " ");
  // Entferne zitierte Zeilen (beginnen mit >)
  body = body
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n");
  // Normalisiere Whitespace
  body = body.replace(/\s+/g, " ").trim();

  return body.slice(0, 1000);
}

export function parseKlassifizierung(response: string): Klassifizierung {
  const teile = response.trim().split("|");
  const kategorie = teile[0]?.trim() ?? "";
  const grund = teile[1]?.trim() ?? "";

  const gueltig = ["INTERESSIERT", "ABGELEHNT", "RÜCKFRAGE", "ABWESEND"];
  if (!gueltig.includes(kategorie)) {
    return { kategorie: "RÜCKFRAGE", grund: "Unbekannte Kategorie vom Klassifizierer" };
  }

  return { kategorie: kategorie as Klassifizierung["kategorie"], grund };
}

async function leseUngeleseneEmails(): Promise<EmailData[]> {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPassword) {
    throw new Error("GMAIL_USER oder GMAIL_APP_PASSWORD fehlt");
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: gmailUser, pass: gmailPassword },
    logger: false,
  });

  const emails: EmailData[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const uids = await client.search({ seen: false, subject: "Re:" }, { uid: true });
      logger.log(`Ungelesene Re:-E-Mails gefunden: ${uids.length}`);

      const zuVerarbeiten = uids.slice(0, 50);

      for await (const message of client.fetch(
        zuVerarbeiten,
        { source: true, envelope: true },
        { uid: true }
      )) {
        try {
          const subject = message.envelope?.subject ?? "";
          const fromAddr = message.envelope?.from?.[0];
          const from = fromAddr
            ? `${fromAddr.name ?? ""} <${fromAddr.address ?? ""}>`.trim()
            : "";
          const rawSource = message.source?.toString("utf-8") ?? "";
          const body = extrahiereTextAusBody(rawSource);

          emails.push({ uid: message.uid, subject, from, body });
        } catch (err) {
          logger.error("Fehler beim Lesen einer E-Mail:", { error: String(err) });
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    logger.error("IMAP Verbindungsfehler:", { error: String(err) });
    try {
      await client.logout();
    } catch {}
  }

  return emails;
}

async function klassiziereEmail(email: EmailData): Promise<Klassifizierung> {
  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 100,
      messages: [
        { role: "system", content: KLASSIFIZIERUNGS_SKILL },
        {
          role: "user",
          content: `Betreff: ${email.subject}\nVon: ${email.from}\nText: ${email.body.slice(0, 500)}`,
        },
      ],
    });

    const response = completion.choices[0]?.message?.content ?? "";
    return parseKlassifizierung(response);
  } catch (err) {
    logger.error(`OpenAI Fehler für E-Mail von ${email.from}:`, { error: String(err) });
    return { kategorie: "RÜCKFRAGE", grund: "Klassifizierung fehlgeschlagen" };
  }
}

async function updateSheetStatus(
  firma: string,
  kategorie: string,
  grund: string,
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string
): Promise<void> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Buchhalter Outreach!A:G",
  });

  const rows = response.data.values ?? [];

  // Sicherstellen dass Spalte G den Header "Notizen" hat
  if (!rows[0] || rows[0][6] !== "Notizen") {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: "Buchhalter Outreach!G1",
      valueInputOption: "RAW",
      requestBody: { values: [["Notizen"]] },
    });
  }

  // Zeile mit passender Firma finden (Spalte A, case-insensitive)
  const firmaKey = firma.toLowerCase().trim();
  const rowIndex = rows.findIndex(
    (row, i) => i > 0 && (row[0] as string | undefined)?.toLowerCase().trim() === firmaKey
  );

  if (rowIndex === -1) {
    logger.log(`Firma nicht im Sheet gefunden: ${firma}`);
    return;
  }

  const rowNumber = rowIndex + 1; // 1-indexiert

  // Status (Spalte C) und Notizen (Spalte G) updaten
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `Buchhalter Outreach!C${rowNumber}`, values: [[kategorie]] },
        { range: `Buchhalter Outreach!G${rowNumber}`, values: [[grund]] },
      ],
    },
  });

  logger.log(`Sheet aktualisiert: ${firma} → ${kategorie}`);
}

async function markiereAlsGelesen(uid: number, client: ImapFlow): Promise<void> {
  try {
    await client.messageFlagsAdd(uid.toString(), ["\\Seen"], { uid: true });
  } catch (err) {
    logger.error(`Fehler beim Markieren als gelesen (UID ${uid}):`, { error: String(err) });
  }
}

export const replyClassifier = schedules.task({
  id: "reply-classifier",
  cron: {
    pattern: "0 10 * * 1-5",
    timezone: "Europe/Berlin",
  },
  maxDuration: 120,
  run: async () => {
    logger.log("=== Reply-Classifier gestartet ===");

    // Schritt 1: E-Mails lesen
    let emails: EmailData[] = [];
    try {
      emails = await leseUngeleseneEmails();
      logger.log(`${emails.length} ungelesene Antworten geladen`);
    } catch (err) {
      logger.error("Gmail Fehler:", { error: String(err) });
      return;
    }

    if (emails.length === 0) {
      logger.log("Keine neuen Antworten. Fertig.");
      return;
    }

    // Google Sheets initialisieren
    let sheets: ReturnType<typeof googleSheets>;
    let sheetId: string;
    try {
      const auth = getGoogleAuth();
      sheets = googleSheets({ version: "v4", auth });
      sheetId = process.env.GOOGLE_SHEET_ID ?? "";
      if (!sheetId) throw new Error("GOOGLE_SHEET_ID fehlt");
    } catch (err) {
      logger.error("Google Sheets Init Fehler:", { error: String(err) });
      return;
    }

    // IMAP-Client für \Seen-Markierung (separater Client)
    const gmailUser = process.env.GMAIL_USER!;
    const gmailPassword = process.env.GMAIL_APP_PASSWORD!;

    const imapClient = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: gmailUser, pass: gmailPassword },
      logger: false,
    });

    let imapVerbunden = false;
    let lock: Awaited<ReturnType<ImapFlow["getMailboxLock"]>> | null = null;

    try {
      await imapClient.connect();
      imapVerbunden = true;
      lock = await imapClient.getMailboxLock("INBOX");
    } catch (err) {
      logger.error("IMAP Verbindung für Markierung fehlgeschlagen:", { error: String(err) });
    }

    const zusammenfassung: Record<string, number> = {
      INTERESSIERT: 0,
      ABGELEHNT: 0,
      RÜCKFRAGE: 0,
      ABWESEND: 0,
    };
    let verarbeitet = 0;

    try {
      for (const email of emails) {
        // Schritt 2: Klassifizieren
        const klassifizierung = await klassiziereEmail(email);
        logger.log(
          `[${klassifizierung.kategorie}] ${email.subject} | ${klassifizierung.grund}`
        );
        zusammenfassung[klassifizierung.kategorie] =
          (zusammenfassung[klassifizierung.kategorie] ?? 0) + 1;

        // Schritt 3: Google Sheet updaten
        const firma = extrahiereFirmaAusBetreff(email.subject);
        if (firma) {
          try {
            await updateSheetStatus(firma, klassifizierung.kategorie, klassifizierung.grund, sheets, sheetId);
          } catch (err) {
            logger.error(`Sheet-Update Fehler für ${firma}:`, { error: String(err) });
          }
        } else {
          logger.log(`Firma nicht aus Betreff erkennbar: "${email.subject}"`);
        }

        // Schritt 4: E-Mail als gelesen markieren
        if (imapVerbunden) {
          await markiereAlsGelesen(email.uid, imapClient);
        }

        verarbeitet++;
      }
    } finally {
      lock?.release();
      if (imapVerbunden) {
        try {
          await imapClient.logout();
        } catch {}
      }
    }

    logger.log(`=== Fertig. ${verarbeitet} E-Mails verarbeitet ===`, zusammenfassung);
  },
});
