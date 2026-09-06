/**
 * Läuft `saubererBetriebsname` über JEDEN Firmennamen der Outreach-Queue und
 * meldet, was dabei kaputtgeht. Nur lesen, schreibt nichts.
 *
 * Ausführen: npx tsx tools/namensregel-gegenprobe.ts
 *
 * Warum dieses Werkzeug existiert, und warum es kein Test ist:
 *
 * Die Namensregel hatte am 04.09.2026 ihre fünfte Lücke, und keine der ersten
 * vier ist von der Suite gefunden worden. Gefunden hat sie jedes Mal ein Lauf
 * über den echten Bestand — 1351 Namen, die niemand ausgedacht hat. Die Suite
 * prüft, dass die bekannten Fälle weiter stimmen; sie kann per Bauart keinen
 * Fall finden, an den beim Schreiben niemand gedacht hat.
 *
 * Die vier bekannten Lücken schnitten alle zu WENIG (der SEO-Titel blieb
 * stehen). Die fünfte schnitt zu VIEL: eine Zeile trug als Firmennamen `lz`,
 * und das leckte in den Mailtext ("Wäre das für lz einen Blick wert?"). Die
 * Gegenprobe vom 01.09. konnte den Fall strukturell nicht sehen, weil sie nur
 * auf rohe SEO-Titel prüfte. Darum prüft dieses Werkzeug beide Richtungen.
 *
 * Vor jeder Änderung an `saubererBetriebsname` einmal laufen lassen, die
 * Ausgabe aufheben, ändern, nochmal laufen lassen, die beiden Ausgaben
 * vergleichen. Siehe [[feedback-regelaenderung-gegen-echtdaten-diffen]].
 */

import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { readFileSync } from "node:fs";
import { saubererBetriebsname } from "../src/trigger/entwurf-qualitaet";

const ENV = "C:/Users/niobu/OneDrive/Dokumente/agentic-ai-lernprojekt/.env";
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  for (const zeile of readFileSync(ENV, "utf8").split(/\r?\n/)) {
    const t = zeile.match(/^([A-Z0-9_]+)=(.*)$/);
    if (t) process.env[t[1] as string] ??= t[2] as string;
  }
}

async function main(): Promise<void> {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = googleSheets({ version: "v4", auth });
  const antwort = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID as string,
    range: "Outreach Queue!A:U",
  });
  const roh = antwort.data.values ?? [];

  type Zeile = { nr: number; name: string; stadt: string; entwurf: string; status: string };
  const zeilen: Zeile[] = [];
  for (let i = 1; i < roh.length; i++) {
    const r = (roh[i] ?? []) as string[];
    const name = (r[1] ?? "").trim();
    if (!name) continue;
    zeilen.push({
      nr: i + 1,
      name,
      stadt: (r[2] ?? "").trim(),
      entwurf: (r[4] ?? "").trim(),
      status: (r[5] ?? "").trim(),
    });
  }

  /** Wörter des Originals, damit "ist das noch ein Wort daraus" prüfbar wird. */
  function woerter(s: string): string[] {
    return s.split(/[^\p{L}\p{N}&]+/u).filter(Boolean);
  }

  const zuWenig: Zeile[] = [];   // SEO-Titel blieb stehen
  const zuViel: (Zeile & { ergebnis: string })[] = [];  // Fragment statt Name
  const geleckt: (Zeile & { ergebnis: string })[] = []; // Fragment steht im Mailtext

  for (const z of zeilen) {
    const ergebnis = saubererBetriebsname(z.name, z.stadt);

    // Richtung 1 — zu wenig geschnitten: ein Trenner steht noch im Ergebnis.
    if (/\s\|\s|\s[-–—]\s/.test(ergebnis)) zuWenig.push(z);

    // Richtung 2 — zu viel geschnitten. Ein gültiges Ergebnis besteht immer aus
    // ganzen Wörtern des Originals. "lz" aus "Milz" ist ein Wortfragment, und
    // genau das ist der Schaden: der Name existiert so nirgends.
    const originalWoerter = new Set(woerter(z.name).map((w) => w.toLowerCase()));
    const ergebnisWoerter = woerter(ergebnis);
    const istFragment =
      ergebnisWoerter.length > 0 &&
      ergebnisWoerter.some((w) => !originalWoerter.has(w.toLowerCase()));
    const istZuKurz = ergebnis.replace(/[^\p{L}\p{N}]/gu, "").length < 3;

    if (istFragment || istZuKurz) {
      zuViel.push({ ...z, ergebnis });
      // Steht das kaputte Ergebnis schon im fertigen Entwurf? Dann ist es keine
      // Theorie mehr, dann geht es so raus.
      if (ergebnis && new RegExp(`\\b${ergebnis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(z.entwurf)) {
        geleckt.push({ ...z, ergebnis });
      }
    }
  }

  console.log(`GEGENPROBE NAMENSREGEL — ${zeilen.length} Namen aus der Queue\n`);

  console.log(`ZU WENIG GESCHNITTEN (Trenner blieb stehen): ${zuWenig.length}`);
  for (const z of zuWenig.slice(0, 20)) {
    console.log(`  Zeile ${z.nr} [${z.status}] ${z.name}`);
  }
  if (zuWenig.length > 20) console.log(`  ... und ${zuWenig.length - 20} weitere`);

  console.log(`\nZU VIEL GESCHNITTEN (Ergebnis ist kein Wort des Originals): ${zuViel.length}`);
  for (const z of zuViel) {
    console.log(`  Zeile ${z.nr} [${z.status}] "${z.name}" (${z.stadt}) -> "${z.ergebnis}"`);
  }

  console.log(`\nDAVON BEREITS IM ENTWURFSTEXT GELANDET: ${geleckt.length}`);
  for (const z of geleckt) {
    const stelle = z.entwurf.split(/\n/).find((l) => l.includes(z.ergebnis)) ?? "";
    console.log(`  Zeile ${z.nr} [${z.status}] "${z.ergebnis}" in: ${stelle.trim().slice(0, 120)}`);
  }

  // Exit-Code nur auf das, was noch rausgehen kann. Eine alte VERWORFEN- oder
  // GESENDET-Zeile ist Geschichte und laesst sich nicht mehr reparieren — sie
  // bleibt in der Liste, damit der Fall belegt bleibt, aber sie darf das
  // Werkzeug nicht dauerhaft rot faerben. Sonst gewoehnt man sich an Rot.
  const offen = (z: { status: string }) => z.status === "DRAFT" || z.status === "PRUEFEN";
  const kaputt = zuWenig.filter(offen).length + zuViel.filter(offen).length;
  const historie = zuWenig.length + zuViel.length - kaputt;

  console.log(
    `\nERGEBNIS: ${kaputt} auffaellig unter den offenen Zeilen` +
    (historie > 0 ? `, dazu ${historie} bereits erledigte (Geschichte, kein Handlungsbedarf).` : "."),
  );
  process.exit(kaputt === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
