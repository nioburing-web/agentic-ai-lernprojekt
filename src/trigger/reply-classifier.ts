import { schedules, logger } from "@trigger.dev/sdk/v3";
import { ImapFlow } from "imapflow";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import OpenAI from "openai";

// ─── Konfiguration: Der Autonomie-Korridor ──────────────────────────────────────
// Nios Reichweite (Entscheidung 18.06.2026):
// - INTERESSIERT + confidence >= 90  → Calendly-Terminvorschlag wird SELBST gesendet
// - INTERESSIERT + confidence < 90   → Gmail-Entwurf (Nio gibt frei)
// - RÜCKFRAGE (jede Frage)           → IMMER nur Entwurf, nie selbst senden
// - ABGELEHNT / ABWESEND             → nur Sheet-Status, kein Kontakt
const CONFIDENCE_SCHWELLE = 90;

const CALENDLY_LINK = process.env.CALENDLY_LINK ?? "https://calendly.com/nioburing/30min";

const LERN_TAB = "Lernbeispiele";

// ─── Entscheidungs-Prompt (statt reiner Klassifizierung) ────────────────────────
const ENTSCHEIDUNGS_SKILL = `Du bist der Reply-Agent für NIO Automation (maßgeschneiderte KI-Agenten).
Du liest die Antwort eines Leads auf eine Kaltakquise-Mail und entscheidest die nächste Aktion.

Kategorien und Signale:
- INTERESSIERT: "ja", "gerne", "klingt interessant", "können wir reden", "mehr erfahren", "Termin", "Angebot"
- ABGELEHNT: "nein", "kein Interesse", "danke aber", "nicht relevant", "bereits versorgt", "keine weiteren E-Mails"
- RÜCKFRAGE: stellt eine konkrete Frage ("was genau", "wie funktioniert", "welche Kosten", endet mit "?")
- ABWESEND: "abwesend", "urlaub", "out of office", "zurück am", "vertreten durch"

Regeln:
- Genau eine Kategorie.
- confidence = Ganzzahl 0-100, wie sicher du dir bei der Kategorie bist.
- Bei Unsicherheit zwischen INTERESSIERT und RÜCKFRAGE → RÜCKFRAGE mit niedriger confidence.
- "antwort": nur bei INTERESSIERT und RÜCKFRAGE. Kurz, professionell, Nios Stil: direkt, kein Blabla, Nutzen zuerst, kein Em-Dash.
  - Bei RÜCKFRAGE: beantworte die Frage knapp und biete ein 15-Min-Gespräch an (Link: ${CALENDLY_LINK}).
  - Bei INTERESSIERT: kurze positive Antwort plus Einladung zum Termin (Link: ${CALENDLY_LINK}).
  - Bei ABGELEHNT/ABWESEND: leerer String.

Antworte NUR mit reinem JSON, keine Code-Fences, exakt dieses Format:
{"kategorie":"INTERESSIERT","confidence":92,"grund":"ein Satz","antwort":"..."}`;

type EmailData = {
  uid: number;
  subject: string;
  from: string;
  body: string;
  messageId: string | null;
};

type Kategorie = "INTERESSIERT" | "ABGELEHNT" | "RÜCKFRAGE" | "ABWESEND";

type Entscheidung = {
  kategorie: Kategorie;
  confidence: number;
  grund: string;
  antwort: string;
};

// Aktion = was der Agent im Korridor tatsächlich tun darf
type Aktion = "CALENDLY_SENDEN" | "ENTWURF" | "NUR_STATUS";

type LeadRow = {
  rowNumber: number;
  name: string;
  email: string;
};

type Lernbeispiel = {
  datum: string;
  leadEmail: string;
  emailAuszug: string;
  agentKategorie: string;
  richtigKategorie: string;
  agentAntwort: string;
  deineAntwort: string;
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

// ─── Reine Funktionen (testbar) ─────────────────────────────────────────────────

export function extrahiereFirmaAusBetreff(subject: string): string | null {
  const match = subject.match(/(?:Re|AW|Aw|WG|Fwd|FW|SV):\s*Kurze Frage,\s*(.+)/i);
  return match?.[1]?.trim() ?? null;
}

export function extrahiereEmailAdresse(from: string): string {
  const match = from.match(/<([^>]+)>/) ?? from.match(/([^\s]+@[^\s]+)/);
  return match?.[1]?.toLowerCase().trim() ?? from.toLowerCase().trim();
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

export function extrahiereMessageId(rawSource: string): string | null {
  const match = rawSource.match(/^Message-ID:\s*(<[^>]+>)/im);
  return match?.[1]?.trim() ?? null;
}

// Entfernt vorhandene Re/AW-Präfixe und setzt genau eines
export function baueReBetreff(subject: string): string {
  const ohnePraefix = subject.replace(/^(?:\s*(?:Re|AW|Aw|WG|Fwd|FW|SV):\s*)+/i, "").trim();
  return `Re: ${ohnePraefix}`;
}

// Rückwärtskompatibel: alte Pipe-Klassifizierung (von Bestandstests genutzt)
export function parseKlassifizierung(response: string): { kategorie: Kategorie; grund: string } {
  const teile = response.trim().split("|");
  const kategorie = teile[0]?.trim() ?? "";
  const grund = teile[1]?.trim() ?? "";

  const gueltig: Kategorie[] = ["INTERESSIERT", "ABGELEHNT", "RÜCKFRAGE", "ABWESEND"];
  if (!gueltig.includes(kategorie as Kategorie)) {
    return { kategorie: "RÜCKFRAGE", grund: "Unbekannte Kategorie vom Klassifizierer" };
  }
  return { kategorie: kategorie as Kategorie, grund };
}

// Neue strukturierte Entscheidung aus dem LLM-JSON
export function parseEntscheidung(response: string): Entscheidung {
  const sicher: Entscheidung = {
    kategorie: "RÜCKFRAGE",
    confidence: 0,
    grund: "Antwort des Modells nicht lesbar, sicherheitshalber Entwurf",
    antwort: "",
  };

  // JSON kann in Code-Fences oder Fließtext stecken → erstes {...} herausschneiden
  const start = response.indexOf("{");
  const ende = response.lastIndexOf("}");
  if (start === -1 || ende === -1 || ende <= start) return sicher;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(response.slice(start, ende + 1));
  } catch {
    return sicher;
  }

  const gueltig: Kategorie[] = ["INTERESSIERT", "ABGELEHNT", "RÜCKFRAGE", "ABWESEND"];
  const kategorie = String(parsed.kategorie ?? "").trim() as Kategorie;
  if (!gueltig.includes(kategorie)) return sicher;

  // confidence robust auf 0-100 clampen; bei Murks → 0 (löst nie Auto-Versand aus)
  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  return {
    kategorie,
    confidence,
    grund: String(parsed.grund ?? "").trim() || "Keine Begründung",
    antwort: String(parsed.antwort ?? "").trim(),
  };
}

// Das Herz des Korridors: rein, deterministisch, ohne Seiteneffekte
export function entscheideAktion(e: Entscheidung): Aktion {
  if (e.kategorie === "ABGELEHNT" || e.kategorie === "ABWESEND") return "NUR_STATUS";
  if (e.kategorie === "RÜCKFRAGE") return "ENTWURF"; // Fragen immer nur als Entwurf
  // INTERESSIERT
  if (e.confidence >= CONFIDENCE_SCHWELLE) return "CALENDLY_SENDEN";
  return "ENTWURF";
}

// Lead-Lookup: Absender muss in der Outreach Queue stehen, sonst nicht anfassen
export function findeLeadRow(rows: string[][], senderEmail: string): LeadRow | null {
  const key = senderEmail.toLowerCase().trim();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const kontakt = (row[3] as string | undefined)?.toLowerCase().trim() ?? "";
    if (kontakt && kontakt === key) {
      return { rowNumber: i + 1, name: (row[1] as string) ?? "", email: kontakt };
    }
  }
  return null;
}

// ── Posteingang-Auswahl ─────────────────────────────────────────────────────
//
// Warum es das gibt (04.09.2026): Der Agent holte `uids.slice(0, 50)` aus einer
// IMAP-Suche. IMAP liefert UIDs **aufsteigend**, das waren also die 50
// **aeltesten** ungelesenen Mails. Der Posteingang hatte 580 ungelesene, fast
// alles Newsletter, und der Guardrail laesst alles ungelesen, was keinem Lead
// zugeordnet werden kann. Damit stand ein Deadlock: jeden Werktag wurden
// dieselben 50 alten Newsletter geholt, verworfen und ungelesen liegen
// gelassen, waehrend echte Lead-Antworten auf Position 51-580 nie geholt
// wurden. Ueber 1509 Queue-Zeilen war genau **eine** als INTERESSIERT und eine
// als ABGELEHNT erfasst — bei rund 1400 versendeten Mails.
//
// Die Auswahl trifft deshalb jetzt der Absender, nicht die Position: erst alle
// Umschlaege ansehen (billig), dann auf bekannte Kontakte filtern, **danach**
// deckeln. Der Deckel greift ab jetzt auf die *neuesten* Lead-Antworten, nicht
// auf die aeltesten Newsletter — und wieviele er abgeschnitten hat, steht im
// Log. Eine Grenze, die man nicht sieht, ist eine Grenze, die man vergisst.

export type PosteingangKandidat = { uid: number; absender: string };

export type PosteingangAuswahl = {
  /** UIDs mit Lead-Zuordnung, gedeckelt, aufsteigend (Fetch-Reihenfolge). */
  zuLesen: number[];
  /** UIDs von Maschinen-Absendern — duerfen auf \Seen. */
  massenpost: number[];
  /** Alles andere: bleibt bewusst ungelesen, das ist echte Post fuer Nio. */
  unberuehrt: number[];
  /** Lead-Treffer VOR dem Deckel, damit der Deckel sichtbar wird. */
  leadsGesamt: number;
};

// Bewusst nur der Lokalteil und eine kurze Domain-Liste. Ein Absender wird nur
// dann als Massenpost eingestuft, wenn er sich selbst so nennt — alles
// Zweifelhafte bleibt ungelesen. Lieber ein Newsletter zuviel im Posteingang
// als eine echte Anfrage, die niemand mehr sieht.
const MASSEN_LOKALTEILE = [
  "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply",
  "notification", "notifications", "updates", "newsletter", "news-",
  "mailer-daemon", "postmaster", "bounce", "bounces", "campaigns",
  "invitations", "digest", "welcome", "marketing", "mailing",
];

const MASSEN_DOMAINS = ["t.brevo.com", "m.brevo.com"];

// Exakte Adressen. Bisher genau eine: die eigene Outreach-Adresse. Von ihr lagen
// am 04.09.2026 **139 ungelesene** Mails im Posteingang — die Tagesreports der
// Agenten aus Juni ("Outreach 09.06.2026: 9/10 gesendet"), deren Versand am
// 06.07. abgeschaltet wurde. Reines Archiv, nie wieder Post fuer einen Menschen.
// Ungefaehrlich, weil die Lead-Pruefung vorher laeuft: eine echte Antwort wird
// ueber die Kontaktspalte erkannt, nicht ueber den Umschlag-Absender.
const MASSEN_ADRESSEN = ["anfragen@nio-automation.de"];

export function istMassenAbsender(adresse: string): boolean {
  const a = adresse.toLowerCase().trim();
  const at = a.lastIndexOf("@");
  if (at <= 0) return false;
  if (MASSEN_ADRESSEN.includes(a)) return true;
  const lokal = a.slice(0, at);
  const domain = a.slice(at + 1);
  if (MASSEN_DOMAINS.includes(domain)) return true;
  return MASSEN_LOKALTEILE.some((m) => lokal.includes(m));
}

/**
 * Teilt die ungelesenen Mails in drei Toepfe. `istLead` kommt von aussen
 * herein, damit diese Funktion ohne Sheet und ohne IMAP testbar bleibt.
 */
export function waehlePosteingang(
  kandidaten: PosteingangKandidat[],
  istLead: (adresse: string) => boolean,
  limit: number,
): PosteingangAuswahl {
  const leads: number[] = [];
  const massenpost: number[] = [];
  const unberuehrt: number[] = [];

  for (const k of kandidaten) {
    const adresse = k.absender.toLowerCase().trim();
    // Reihenfolge ist die Sicherung: ein Lead wird nie als Massenpost
    // eingestuft, auch wenn seine Adresse zufaellig "news" enthaelt.
    if (adresse && istLead(adresse)) leads.push(k.uid);
    else if (istMassenAbsender(adresse)) massenpost.push(k.uid);
    else unberuehrt.push(k.uid);
  }

  // Beim Deckeln gewinnt das Neueste. Eine Antwort von heute ist mehr wert als
  // eine von vor drei Wochen, und genau andersherum lief es bisher.
  const neuesteZuerst = [...leads].sort((a, b) => b - a);
  const zuLesen = neuesteZuerst.slice(0, Math.max(0, limit)).sort((a, b) => a - b);

  return { zuLesen, massenpost, unberuehrt, leadsGesamt: leads.length };
}

// Wählt die letzten n Korrekturen, ausgewogen über die richtigen Kategorien.
// Eingabe ist chronologisch (ältestes zuerst, wie im Sheet).
export function waehleLernbeispiele(alle: Lernbeispiel[], n: number): Lernbeispiel[] {
  if (n <= 0 || alle.length === 0) return [];
  const neueste = [...alle].reverse(); // neuestes zuerst
  const buckets = new Map<string, Lernbeispiel[]>();
  for (const b of neueste) {
    const key = b.richtigKategorie || "?";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(b);
  }
  const ergebnis: Lernbeispiel[] = [];
  const keys = [...buckets.keys()];
  let fortschritt = true;
  while (ergebnis.length < n && fortschritt) {
    fortschritt = false;
    for (const k of keys) {
      const bucket = buckets.get(k)!;
      if (bucket.length > 0) {
        ergebnis.push(bucket.shift()!);
        fortschritt = true;
        if (ergebnis.length >= n) break;
      }
    }
  }
  return ergebnis;
}

// Baut den Few-Shot-Block für den Prompt. Leer → leerer String.
export function formatiereLernbeispiele(bsp: Lernbeispiel[]): string {
  if (bsp.length === 0) return "";
  const zeilen = [
    "Aus früheren Korrekturen von Nio (lerne daraus, wiederhole diese Fehler nicht):",
  ];
  for (const b of bsp) {
    const auszug = b.emailAuszug.slice(0, 200);
    zeilen.push(
      `- Mail: "${auszug}" → richtig: ${b.richtigKategorie} (du sagtest: ${b.agentKategorie})`
    );
    if (b.deineAntwort.trim()) {
      zeilen.push(`  Nios bevorzugte Antwort: "${b.deineAntwort.slice(0, 300)}"`);
    }
  }
  return zeilen.join("\n");
}

// Setzt den Few-Shot-Block vor den Basis-Prompt. Leer → nur Basis.
export function baueSystemPrompt(fewShot: string): string {
  return fewShot ? `${ENTSCHEIDUNGS_SKILL}\n\n${fewShot}` : ENTSCHEIDUNGS_SKILL;
}

type HarvestZeile = { rowNumber: number; beispiel: Lernbeispiel };

// Liefert Queue-Zeilen mit gefülltem N oder O und leerem P (Lern-Flag).
export function zuHarvestendeZeilen(rows: string[][]): HarvestZeile[] {
  const result: HarvestZeile[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const richtigKat = (row[13] ?? "").trim(); // N
    const deineAntwort = (row[14] ?? "").trim(); // O
    const lernFlag = (row[15] ?? "").trim(); // P
    if ((richtigKat || deineAntwort) && !lernFlag) {
      const agentKat = (row[11] ?? "").trim(); // L
      result.push({
        rowNumber: i + 1,
        beispiel: {
          datum: (row[7] ?? "").trim(), // H
          leadEmail: (row[3] ?? "").trim().toLowerCase(), // D
          emailAuszug: (row[10] ?? "").trim(), // K
          agentKategorie: agentKat,
          richtigKategorie: richtigKat || agentKat, // N, sonst L (Kategorie war ok)
          agentAntwort: (row[12] ?? "").trim(), // M
          deineAntwort,
        },
      });
    }
  }
  return result;
}

// Baut eine RFC822-Antwortmail (für Gmail-Draft oder Brevo-Text)
export function baueReplyMime(opts: {
  von: string;
  an: string;
  betreff: string;
  body: string;
  inReplyTo: string | null;
}): string {
  const datum = new Date().toUTCString();
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@nio-automation>`;
  const headers = [
    `From: ${opts.von}`,
    `To: ${opts.an}`,
    `Subject: ${opts.betreff}`,
    `Date: ${datum}`,
    `Message-ID: ${messageId}`,
  ];
  if (opts.inReplyTo) {
    headers.push(`In-Reply-To: ${opts.inReplyTo}`);
    headers.push(`References: ${opts.inReplyTo}`);
  }
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="utf-8"');
  headers.push("Content-Transfer-Encoding: 8bit");
  return headers.join("\r\n") + "\r\n\r\n" + opts.body.replace(/\n/g, "\r\n");
}

// ─── IMAP: Lesen, Draft anlegen, als gelesen markieren ──────────────────────────

function neuerImapClient(): ImapFlow {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPassword) {
    throw new Error("GMAIL_USER oder GMAIL_APP_PASSWORD fehlt");
  }
  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: gmailUser, pass: gmailPassword },
    logger: false,
  });
}

// Lädt die Outreach Queue (A:J) als Rohzeilen für Lead-Zuordnung
export async function ladeOutreachQueue(): Promise<{
  sheets: ReturnType<typeof googleSheets>;
  sheetId: string;
  rows: string[][];
}> {
  const auth = getGoogleAuth();
  const sheets = googleSheets({ version: "v4", auth });
  const sheetId = process.env.GOOGLE_SHEET_ID ?? "";
  if (!sheetId) throw new Error("GOOGLE_SHEET_ID fehlt");
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Outreach Queue!A:P",
  });
  return { sheets, sheetId, rows: (res.data.values ?? []) as string[][] };
}

export type PosteingangErgebnis = {
  emails: EmailData[];
  /** UIDs, die als Massenpost auf \Seen duerfen. */
  massenpost: number[];
  /** Lead-Treffer vor dem Deckel. */
  leadsGesamt: number;
  ungelesenGesamt: number;
  unberuehrt: number;
};

/**
 * Holt die ungelesenen Mails, die zu einem Lead gehoeren.
 *
 * `istLead` kommt von aussen, weil die Queue dafuer schon geladen sein muss —
 * das ist die eigentliche Aenderung vom 04.09.2026. Vorher lief es andersherum:
 * erst 50 Mails blind holen, dann zuordnen. Siehe den Block bei
 * `waehlePosteingang` fuer den Deadlock, der daraus entstand.
 */
export async function leseUngeleseneEmails(
  istLead: (adresse: string) => boolean,
  limit = 50,
): Promise<PosteingangErgebnis> {
  const client = neuerImapClient();
  const emails: EmailData[] = [];
  let massenpost: number[] = [];
  let leadsGesamt = 0;
  let ungelesenGesamt = 0;
  let unberuehrt = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Kein Betreff-Filter: alle ungelesenen holen, der Absender entscheidet.
      const uids = await client.search({ seen: false }, { uid: true });
      // imapflow liefert `false`, wenn die Suche selbst fehlschlaegt. Ohne diese
      // Pruefung lief `uids.slice()` in einen TypeError und der Agent stuerzte —
      // gefunden vom ersten Typecheck-Lauf am 28.08.2026. Bewusst ein Fehler und
      // keine leere Liste: eine fehlgeschlagene Suche sieht sonst aus wie "keine
      // Antworten da", und genau diese Verwechslung hat schon zweimal Tage
      // gekostet (Maps-Billing 06.07., Spalten-Bug 16.07.).
      if (uids === false) {
        throw new Error("IMAP-Suche fehlgeschlagen (search lieferte false) — keine Aussage ueber ungelesene Mails moeglich");
      }
      ungelesenGesamt = uids.length;
      logger.log(`Ungelesene E-Mails gesamt: ${uids.length}`);

      // Durchgang 1: nur Umschlaege. Das ist billig genug, um sich ALLE
      // anzusehen — und genau deshalb muss nicht mehr nach Position gedeckelt
      // werden, sondern nach Absender.
      const kandidaten: PosteingangKandidat[] = [];
      for await (const m of client.fetch(uids, { envelope: true }, { uid: true })) {
        const f = m.envelope?.from?.[0];
        const roh = f ? `${f.name ?? ""} <${f.address ?? ""}>`.trim() : "";
        kandidaten.push({ uid: m.uid, absender: extrahiereEmailAdresse(roh) });
      }

      const auswahl = waehlePosteingang(kandidaten, istLead, limit);
      massenpost = auswahl.massenpost;
      leadsGesamt = auswahl.leadsGesamt;
      unberuehrt = auswahl.unberuehrt.length;

      // Den Deckel sichtbar machen. Eine Grenze, die nur im Code steht, ist
      // beim naechsten Blick aufs Log unsichtbar — und dann glaubt man der Zahl.
      if (auswahl.leadsGesamt > auswahl.zuLesen.length) {
        logger.warn(
          `Deckel greift: ${auswahl.leadsGesamt} Lead-Antworten gefunden, ` +
            `nur die ${auswahl.zuLesen.length} neuesten werden verarbeitet.`
        );
      }
      logger.log(
        `Auswahl: ${auswahl.leadsGesamt} Lead-Antworten, ` +
          `${auswahl.massenpost.length} Massenpost, ` +
          `${auswahl.unberuehrt.length} bleiben ungelesen`
      );

      // Durchgang 2: der volle Text, aber nur fuer die Lead-Antworten.
      // Bewusst kein frueher `return` hier — der stuende vor `client.logout()`
      // und liesse die IMAP-Verbindung offen.
      if (auswahl.zuLesen.length > 0) {
        for await (const message of client.fetch(
          auswahl.zuLesen,
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
            const messageId =
              message.envelope?.messageId ?? extrahiereMessageId(rawSource);

            emails.push({ uid: message.uid, subject, from, body, messageId });
          } catch (err) {
            logger.error("Fehler beim Lesen einer E-Mail:", { error: String(err) });
          }
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

  return { emails, massenpost, leadsGesamt, ungelesenGesamt, unberuehrt };
}

// Findet den Drafts-Ordner über das \Drafts Special-Use-Flag
async function findeDraftsOrdner(client: ImapFlow): Promise<string> {
  try {
    const liste = await client.list();
    const treffer = liste.find((m) => m.specialUse === "\\Drafts");
    if (treffer) return treffer.path;
  } catch (err) {
    logger.error("Drafts-Ordner-Suche fehlgeschlagen:", { error: String(err) });
  }
  return "[Gmail]/Drafts"; // Fallback
}

async function legeGmailEntwurfAn(
  client: ImapFlow,
  email: EmailData,
  antwortText: string
): Promise<boolean> {
  try {
    const absenderName = process.env.ABSENDER_NAME ?? "NIO Automation";
    const absenderEmail = process.env.ABSENDER_EMAIL ?? process.env.GMAIL_USER ?? "";
    const signatur = `\n\nMit freundlichen Grüßen\n${absenderName}\n${absenderEmail}`;

    const mime = baueReplyMime({
      von: `${absenderName} <${absenderEmail}>`,
      an: extrahiereEmailAdresse(email.from),
      betreff: baueReBetreff(email.subject),
      body: antwortText + signatur,
      inReplyTo: email.messageId,
    });

    const ordner = await findeDraftsOrdner(client);
    await client.append(ordner, mime, ["\\Draft"]);
    logger.log(`Gmail-Entwurf abgelegt in "${ordner}" für ${email.from}`);
    return true;
  } catch (err) {
    logger.error(`Entwurf anlegen fehlgeschlagen für ${email.from}:`, { error: String(err) });
    return false;
  }
}

async function markiereAlsGelesen(uid: number, client: ImapFlow): Promise<void> {
  try {
    await client.messageFlagsAdd(uid.toString(), ["\\Seen"], { uid: true });
  } catch (err) {
    logger.error(`Fehler beim Markieren als gelesen (UID ${uid}):`, { error: String(err) });
  }
}

// ─── LLM: Entscheidung treffen ──────────────────────────────────────────────────

export async function entscheideEmail(email: EmailData, fewShot: string = ""): Promise<Entscheidung> {
  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: baueSystemPrompt(fewShot) },
        {
          role: "user",
          content: `Betreff: ${email.subject}\nVon: ${email.from}\nText: ${email.body.slice(0, 600)}`,
        },
      ],
    });
    const response = completion.choices[0]?.message?.content ?? "";
    return parseEntscheidung(response);
  } catch (err) {
    logger.error(`OpenAI Fehler für E-Mail von ${email.from}:`, { error: String(err) });
    return {
      kategorie: "RÜCKFRAGE",
      confidence: 0,
      grund: "Entscheidung fehlgeschlagen, sicherheitshalber Entwurf",
      antwort: "",
    };
  }
}

// ─── Aktion: Calendly-Termin selbst senden (Brevo) ──────────────────────────────

async function sendeCalendlyTermin(email: EmailData, antwortText: string): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  const absenderName = process.env.ABSENDER_NAME ?? "NIO Automation";
  const absenderEmail = process.env.ABSENDER_EMAIL;
  const replyToEmail = process.env.REPLY_TO_EMAIL;
  const testEmail = process.env.TEST_EMAIL;
  if (!apiKey || !absenderEmail) throw new Error("Brevo Env-Vars fehlen (BREVO_API_KEY, ABSENDER_EMAIL)");

  const empfaenger = testEmail ?? extrahiereEmailAdresse(email.from);
  if (testEmail) logger.log(`Testmodus: sende an ${testEmail} statt ${email.from}`);

  // Fallback-Text falls das Modell keinen lieferte
  const text =
    antwortText ||
    `Freut mich, dass es passt. Such dir einfach einen Slot aus, dann sprechen wir kurz konkret:\n${CALENDLY_LINK}`;
  const signatur = `\n\nMit freundlichen Grüßen\n${absenderName}\n${absenderEmail}`;
  const plainText = text + signatur;
  const htmlContent = `<html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.6"><p>${plainText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p></body></html>`;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: absenderName, email: absenderEmail },
      replyTo: { email: replyToEmail ?? absenderEmail },
      to: [{ email: empfaenger }],
      subject: baueReBetreff(email.subject),
      htmlContent,
      textContent: plainText,
      type: "transactional",
    }),
  });
  const body = await response.text();
  logger.log(`Brevo ${response.status}: ${body.slice(0, 200)}`);
  return response.status === 200 || response.status === 201;
}

// ─── Sheet-Status ───────────────────────────────────────────────────────────────

async function setzeStatus(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  rowNumber: number,
  status: string,
  notiz: string
): Promise<void> {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `Outreach Queue!F${rowNumber}`, values: [[status]] },
        { range: `Outreach Queue!J${rowNumber}`, values: [[notiz]] },
      ],
    },
  });
}

// Legt den Lernbeispiele-Tab an, falls er fehlt. Existiert er schon → still ok.
async function stelleLernbeispieleTabSicher(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string
): Promise<void> {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: LERN_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${LERN_TAB}!A1:G1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["Datum", "LeadEmail", "EmailAuszug", "AgentKategorie", "RichtigKategorie", "AgentAntwort", "DeineAntwort"]],
      },
    });
    logger.log(`Tab "${LERN_TAB}" angelegt`);
  } catch (err) {
    logger.log(`Tab "${LERN_TAB}" existiert bereits (ok): ${String(err).slice(0, 80)}`);
  }
}

// Liest alle Lernbeispiele (chronologisch, ältestes oben).
export async function ladeLernbeispiele(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string
): Promise<Lernbeispiel[]> {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${LERN_TAB}!A2:G`,
    });
    const rows = (res.data.values ?? []) as string[][];
    return rows
      .filter((r) => r && ((r[4] ?? "").trim() || (r[6] ?? "").trim()))
      .map((r) => ({
        datum: (r[0] ?? "").trim(),
        leadEmail: (r[1] ?? "").trim(),
        emailAuszug: (r[2] ?? "").trim(),
        agentKategorie: (r[3] ?? "").trim(),
        richtigKategorie: (r[4] ?? "").trim(),
        agentAntwort: (r[5] ?? "").trim(),
        deineAntwort: (r[6] ?? "").trim(),
      }));
  } catch (err) {
    logger.error("Lernbeispiele laden fehlgeschlagen:", { error: String(err) });
    return [];
  }
}

// Sichert korrigierte Queue-Zeilen in den Lernbeispiele-Tab und setzt P=GELERNT.
export async function harvesteKorrekturen(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  rows: string[][]
): Promise<number> {
  const zuHarvesten = zuHarvestendeZeilen(rows);
  if (zuHarvesten.length === 0) return 0;

  const heute = new Date().toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric",
  });
  const werte = zuHarvesten.map(({ beispiel: b }) => [
    b.datum || heute, b.leadEmail, b.emailAuszug, b.agentKategorie, b.richtigKategorie, b.agentAntwort, b.deineAntwort,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${LERN_TAB}!A:G`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: werte },
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: zuHarvesten.map(({ rowNumber }) => ({
        range: `Outreach Queue!P${rowNumber}`,
        values: [["GELERNT"]],
      })),
    },
  });

  logger.log(`${zuHarvesten.length} Korrekturen weggesichert`);
  return zuHarvesten.length;
}

// Schreibt die Agent-Entscheidung (K/L/M) in die Lead-Zeile für spätere Korrektur.
async function schreibeAgentEntscheidung(
  sheets: ReturnType<typeof googleSheets>,
  sheetId: string,
  rowNumber: number,
  auszug: string,
  kategorie: string,
  antwort: string
): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `Outreach Queue!K${rowNumber}:M${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[auszug.slice(0, 500), kategorie, antwort.slice(0, 500)]] },
  });
}

// ─── Status-Report an Nio ───────────────────────────────────────────────────────

async function sendeReport(zeilen: string[]): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const absenderEmail = process.env.ABSENDER_EMAIL;
  if (!apiKey || !absenderEmail) return;
  // Report-Mail deaktiviert auf Nios Wunsch (2026-07-06) — Crash-Alarme laufen
  // weiter ueber agent-health-monitor. Reaktivieren: auf true setzen.
  //
  // Bewusst ein annotierter Schalter statt eines nackten `return;`: mit dem
  // nackten return galt alles darunter als unerreichbar, und unerreichbarer
  // Code verliert jede Typinformation. Der erste Typecheck-Lauf (28.08.2026)
  // meldete das vier Mal in vier Dateien — immer denselben Report-Block.
  const REPORT_MAILS_AKTIV: boolean = false;
  if (!REPORT_MAILS_AKTIV) return;
  const heute = new Date().toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric",
  });
  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "NIO Automation", email: absenderEmail },
      to: [{ email: "nioburing@gmail.com" }],
      subject: `Reply-Agent ${heute}`,
      textContent: zeilen.join("\n"),
    }),
  });
}

// ─── Main Task ──────────────────────────────────────────────────────────────────

export const replyClassifier = schedules.task({
  id: "reply-classifier",
  cron: {
    pattern: "0 10 * * 1-5",
    timezone: "Europe/Berlin",
  },
  maxDuration: 180,
  run: async () => {
    logger.log("=== Reply-Agent gestartet ===");

    // Schritt 1: Outreach Queue laden.
    //
    // Sie kommt seit dem 04.09.2026 ZUERST, nicht mehr nach den E-Mails: die
    // Kontaktspalte entscheidet, welche Mails ueberhaupt geholt werden. Vorher
    // wurden blind die 50 aeltesten ungelesenen geholt und danach zugeordnet —
    // bei 580 ungelesenen Newslettern hiess das, dass echte Lead-Antworten nie
    // an die Reihe kamen.
    let sheets: ReturnType<typeof googleSheets>;
    let sheetId: string;
    let queueRows: string[][];
    try {
      ({ sheets, sheetId, rows: queueRows } = await ladeOutreachQueue());
    } catch (err) {
      logger.error("Google Sheets Init Fehler:", { error: String(err) });
      return;
    }

    const bekannteKontakte = new Set<string>();
    for (let i = 1; i < queueRows.length; i++) {
      const k = (queueRows[i]?.[3] ?? "").toLowerCase().trim();
      if (k) bekannteKontakte.add(k);
    }
    logger.log(`Queue: ${bekannteKontakte.size} bekannte Kontaktadressen`);

    // Schritt 1b: ungelesene E-Mails laden, gefiltert auf bekannte Kontakte
    let emails: EmailData[] = [];
    let massenpost: number[] = [];
    try {
      const p = await leseUngeleseneEmails((a) => bekannteKontakte.has(a));
      emails = p.emails;
      massenpost = p.massenpost;
      logger.log(`${emails.length} Lead-Antworten geladen`);
    } catch (err) {
      logger.error("Gmail Fehler:", { error: String(err) });
      return;
    }
    if (emails.length === 0 && massenpost.length === 0) {
      logger.log("Keine neuen E-Mails. Fertig.");
      return;
    }

    // Schritt 2b: Korrekturen wegsichern + Few-Shot bauen
    let geharvtet = 0;
    let fewShot = "";
    let aktiveBeispiele = 0;
    try {
      await stelleLernbeispieleTabSicher(sheets, sheetId);
      geharvtet = await harvesteKorrekturen(sheets, sheetId, queueRows);
      const alle = await ladeLernbeispiele(sheets, sheetId);
      aktiveBeispiele = Math.min(alle.length, 12);
      fewShot = formatiereLernbeispiele(waehleLernbeispiele(alle, 12));
      logger.log(`Lernschleife: ${geharvtet} neu gelernt, ${alle.length} Beispiele gesamt`);
    } catch (err) {
      logger.error("Lernschleife-Fehler (Agent läuft ohne Few-Shot weiter):", { error: String(err) });
    }

    // Schritt 3: IMAP-Client für Draft + \Seen
    const imapClient = neuerImapClient();
    let imapVerbunden = false;
    let lock: Awaited<ReturnType<ImapFlow["getMailboxLock"]>> | null = null;
    try {
      await imapClient.connect();
      imapVerbunden = true;
      lock = await imapClient.getMailboxLock("INBOX");
    } catch (err) {
      logger.error("IMAP Verbindung fehlgeschlagen:", { error: String(err) });
    }

    // Schritt 3b: Massenpost aufräumen.
    //
    // Nur Absender, die sich selbst als Maschine ausweisen (noreply, newsletter,
    // die eigenen Agenten-Reports). Leads sind hier per Konstruktion nie dabei,
    // `waehlePosteingang` prueft die Queue zuerst. Alles Zweifelhafte bleibt
    // ungelesen — lieber ein Newsletter zuviel im Posteingang als eine echte
    // Anfrage, die niemand mehr sieht.
    let aufgeraeumt = 0;
    if (imapVerbunden && massenpost.length > 0) {
      try {
        await imapClient.messageFlagsAdd(massenpost.join(","), ["\\Seen"], { uid: true });
        aufgeraeumt = massenpost.length;
        logger.log(`Massenpost als gelesen markiert: ${aufgeraeumt}`);
      } catch (err) {
        // Fail-open: das Aufräumen ist Komfort, die Lead-Antworten sind die Arbeit.
        logger.error("Massenpost markieren fehlgeschlagen:", { error: String(err) });
      }
    }

    const report: string[] = [];
    let termineGesendet = 0;
    let entwuerfe = 0;
    let nurStatus = 0;
    let unbekannt = 0;

    try {
      for (const email of emails) {
        const senderEmail = extrahiereEmailAdresse(email.from);
        const lead = findeLeadRow(queueRows, senderEmail);

        // Guardrail: keine Lead-Zuordnung → nicht anfassen, ungelesen lassen
        if (!lead) {
          logger.log(`Übersprungen (kein Lead): ${senderEmail}`);
          unbekannt++;
          continue;
        }

        // Schritt 4: Entscheidung treffen
        const e = await entscheideEmail(email, fewShot);
        const aktion = entscheideAktion(e);
        logger.log(
          `[${e.kategorie} ${e.confidence}%] → ${aktion} | ${lead.name} <${senderEmail}> | ${e.grund}`
        );

        // Schritt 5: Aktion im Korridor ausführen
        try {
          if (aktion === "CALENDLY_SENDEN") {
            const ok = await sendeCalendlyTermin(email, e.antwort);
            if (ok) {
              await setzeStatus(sheets, sheetId, lead.rowNumber, "TERMIN_GESENDET", e.grund);
              termineGesendet++;
              report.push(`AUTO-TERMIN → ${lead.name} (${e.confidence}%)`);
            } else {
              // Versand gescheitert → als Entwurf zurückfallen
              if (imapVerbunden) await legeGmailEntwurfAn(imapClient, email, e.antwort);
              await setzeStatus(sheets, sheetId, lead.rowNumber, "ENTWURF_BEREIT", "Auto-Versand fehlgeschlagen");
              entwuerfe++;
              report.push(`ENTWURF (Versand-Fehler) → ${lead.name}`);
            }
          } else if (aktion === "ENTWURF") {
            if (imapVerbunden) await legeGmailEntwurfAn(imapClient, email, e.antwort);
            await setzeStatus(sheets, sheetId, lead.rowNumber, "ENTWURF_BEREIT", `${e.kategorie} ${e.confidence}%: ${e.grund}`);
            entwuerfe++;
            report.push(`ENTWURF → ${lead.name} (${e.kategorie} ${e.confidence}%)`);
          } else {
            await setzeStatus(sheets, sheetId, lead.rowNumber, e.kategorie, e.grund);
            nurStatus++;
            report.push(`${e.kategorie} → ${lead.name}`);
          }
        } catch (err) {
          logger.error(`Aktion fehlgeschlagen für ${senderEmail}:`, { error: String(err) });
          report.push(`FEHLER → ${lead.name}: ${String(err).slice(0, 80)}`);
        }

        // Agent-Entscheidung für spätere Korrektur festhalten (K/L/M)
        try {
          await schreibeAgentEntscheidung(
            sheets, sheetId, lead.rowNumber, email.body.slice(0, 500), e.kategorie, e.antwort
          );
        } catch (err) {
          logger.error(`Agent-Entscheidung schreiben fehlgeschlagen für ${senderEmail}:`, { error: String(err) });
        }

        // Schritt 6: als gelesen markieren (nur bekannte Leads)
        if (imapVerbunden) await markiereAlsGelesen(email.uid, imapClient);
      }
    } finally {
      lock?.release();
      if (imapVerbunden) {
        try {
          await imapClient.logout();
        } catch {}
      }
    }

    // Schritt 7: Report an Nio
    const kopf = [
      `Reply-Agent Lauf:`,
      `  Auto-Termine gesendet: ${termineGesendet}`,
      `  Entwürfe zur Freigabe:  ${entwuerfe}`,
      `  Nur Status (Absage/Abw): ${nurStatus}`,
      `  Übersprungen (kein Lead): ${unbekannt}`,
      `  Massenpost aufgeräumt:   ${aufgeraeumt}`,
      `  Neu gelernte Korrekturen:  ${geharvtet}`,
      `  Aktive Lernbeispiele:      ${aktiveBeispiele}`,
      ``,
    ];
    try {
      await sendeReport([...kopf, ...report]);
    } catch (err) {
      logger.error("Report-Versand Fehler:", { error: String(err) });
    }

    logger.log(
      `=== Fertig. Termine: ${termineGesendet}, Entwürfe: ${entwuerfe}, Status: ${nurStatus}, übersprungen: ${unbekannt} ===`
    );
  },
});
