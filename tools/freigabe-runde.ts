/**
 * Freigabe-Runde: bereitet die PRUEFEN-Zeilen der Outreach-Queue zur Entscheidung auf.
 *
 * Warum es das gibt (27.08.2026): Solange `imTest: true` in `nischen.ts` steht,
 * schreibt die Nacht-Recherche `PRUEFEN` statt `DRAFT`, und jemand muss die
 * Entwürfe von Hand durchsehen. Das von Hand im Browser zu tun heißt: 60 Zeilen
 * lesen, dabei die immer gleichen mechanischen Fehler suchen und die inhaltliche
 * Frage — passt der Betrieb überhaupt? — zwischen dem Kleinkram verlieren.
 *
 * Dieses Werkzeug trennt beides. Es repariert und verwirft nur, was ohne Urteil
 * entscheidbar ist (Anrede, kaputte Adresse, Platzhalter-Adresse), und legt
 * alles Übrige zum Lesen vor. Die Fit-Frage bleibt bei einem Menschen.
 *
 * Seit dem 08.09.2026 laufen zusätzlich die echten Regelprüfungen aus
 * nacht-recherche noch einmal über jede Zeile (siehe freigabe-pruefung.ts).
 * Grund: der Mangel steht nur im Run-Log, nie im Sheet — die Runde meldete
 * deshalb null Befunde bei 23 defekten Entwürfen. Was einen Befund hat, nimmt
 * `--freigeben` nicht mehr mit.
 *
 * Lesen:     npx tsx tools/freigabe-runde.ts
 * Schreiben: npx tsx tools/freigabe-runde.ts --schreiben
 * Freigeben: npx tsx tools/freigabe-runde.ts --schreiben --freigeben
 *
 * Ohne `--schreiben` wird das Sheet nicht angefasst.
 */

import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { readFileSync } from "node:fs";
import { vereinheitlicheAnrede, anredeIstGemischt } from "../src/trigger/anrede";
import { adresseIstUnbrauchbar } from "../src/trigger/nacht-recherche";
import { regelBefunde, gesperrteZeilen } from "./freigabe-pruefung";
import type { Befund } from "./freigabe-pruefung";

const QUEUE_TAB = "Outreach Queue";
const SCHREIBEN = process.argv.includes("--schreiben");
// Letzter Schritt der Runde: was nach Reparatur und Verwerfen noch auf PRUEFEN
// steht, ist durchgesehen und geht in den Versand. Bewusst ein eigener Schalter
// — er ist der einzige Schritt, der Mails auf den Weg bringt.
const FREIGEBEN = process.argv.includes("--freigeben");

// Läuft außerhalb von Trigger.dev, also kommt die Umgebung aus der .env des Repos.
function ladeEnv(): void {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return;
  const roh = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const zeile of roh.split(/\r?\n/)) {
    const treffer = zeile.match(/^([A-Z0-9_]+)=(.*)$/);
    if (treffer) process.env[treffer[1] as string] ??= treffer[2] as string;
  }
}

type Zeile = {
  nummer: number;
  name: string;
  stadt: string;
  kontakt: string;
  entwurf: string;
  betreff: string;
  nische: string;
};

async function main(): Promise<void> {
  ladeEnv();
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = googleSheets({ version: "v4", auth });
  const sheetId = process.env.GOOGLE_SHEET_ID as string;

  const antwort = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!A:U`,
  });
  const rohzeilen = antwort.data.values ?? [];

  // Betreffe, die schon draussen sind. Gegen die prüft betreffIstBrauchbar —
  // ein Betreff, der bereits verschickt wurde, darf nicht ein zweites Mal raus.
  const verbrauchteBetreffe: string[] = [];
  for (let i = 1; i < rohzeilen.length; i++) {
    const r = rohzeilen[i] ?? [];
    const status = (r[5] ?? "").trim();
    if ((status === "GESENDET" || status.startsWith("NACHGEFASST")) && r[8]) {
      verbrauchteBetreffe.push(String(r[8]));
    }
  }

  const zeilen: Zeile[] = [];
  for (let i = 1; i < rohzeilen.length; i++) {
    const r = rohzeilen[i] ?? [];
    if ((r[5] ?? "").trim() !== "PRUEFEN") continue;
    zeilen.push({
      nummer: i + 1,
      name: (r[1] as string) ?? "",
      stadt: (r[2] as string) ?? "",
      kontakt: (r[3] as string) ?? "",
      entwurf: (r[4] as string) ?? "",
      betreff: (r[8] as string) ?? "",
      nische: (r[19] as string) ?? "",
    });
  }

  console.log(`${zeilen.length} Zeilen auf PRUEFEN\n`);

  const updates: Array<{ range: string; values: string[][] }> = [];
  const befunde = new Map<number, Befund[]>();

  for (const z of zeilen) {
    const liste: Befund[] = [];

    // ── Adresse: erst reparieren, was reparierbar ist, dann prüfen ──────────
    // Ein führendes `%20` ist kein kaputter Kontakt, sondern ein nicht
    // dekodiertes mailto. Die Adresse dahinter ist echt und wäre sonst verloren.
    let kontakt = z.kontakt.trim().toLowerCase();
    if (/^%20/.test(kontakt)) {
      kontakt = kontakt.replace(/^(%20)+/, "");
      liste.push({ art: "repariert", was: `Adresse ${z.kontakt} → ${kontakt}` });
      updates.push({ range: `${QUEUE_TAB}!D${z.nummer}`, values: [[kontakt]] });
    }

    const adressGrund = adresseIstUnbrauchbar(kontakt);
    if (adressGrund) {
      liste.push({ art: "verworfen", grund: adressGrund });
      updates.push({ range: `${QUEUE_TAB}!F${z.nummer}`, values: [["VERWORFEN"]] });
      updates.push({ range: `${QUEUE_TAB}!J${z.nummer}`, values: [[`Freigabe-Runde: ${adressGrund}`]] });
      befunde.set(z.nummer, liste);
      continue;
    }

    // ── Anrede: deterministisch umformen ───────────────────────────────────
    const neu = vereinheitlicheAnrede(z.entwurf);
    if (neu !== z.entwurf) {
      liste.push({ art: "repariert", was: "Anrede auf ihr vereinheitlicht" });
      updates.push({ range: `${QUEUE_TAB}!E${z.nummer}`, values: [[neu]] });
    }
    if (anredeIstGemischt(neu)) {
      liste.push({ art: "prüfen", hinweis: "Anrede BLEIBT gemischt — Regel greift nicht" });
    }

    // ── Betreff: nur melden, nie stillschweigend ändern ────────────────────
    // Ein Betreff ist die einzige Zeile, die der Empfänger garantiert liest.
    // Ihn automatisch umzuschreiben hieße raten, was gemeint war.
    if (z.betreff && z.betreff !== z.betreff.toLowerCase()) {
      liste.push({ art: "prüfen", hinweis: `Betreff bricht die Kleinschreibung: "${z.betreff}"` });
    }

    // ── Die vier Regeln, die nacht-recherche nur ins Log schreibt ───────────
    // Geprüft wird die reparierte Fassung, nicht das Original — sonst meldet
    // die Runde einen Mangel, den sie zwei Zeilen vorher selbst behoben hat.
    for (const hinweis of regelBefunde({ ...z, entwurf: neu }, verbrauchteBetreffe)) {
      liste.push({ art: "prüfen", hinweis });
    }

    if (liste.length) befunde.set(z.nummer, liste);
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const verworfen = [...befunde].filter(([, l]) => l.some((b) => b.art === "verworfen"));
  const repariert = [...befunde].filter(([, l]) => l.some((b) => b.art === "repariert") && !l.some((b) => b.art === "verworfen"));
  const zuPruefen = [...befunde].filter(([, l]) => l.some((b) => b.art === "prüfen"));

  const zeigen = (titel: string, eintraege: Array<[number, Befund[]]>) => {
    console.log(`== ${titel} (${eintraege.length}) ==`);
    for (const [nr, liste] of eintraege) {
      const z = zeilen.find((x) => x.nummer === nr) as Zeile;
      for (const b of liste) {
        const text = b.art === "verworfen" ? b.grund : b.art === "repariert" ? b.was : b.hinweis;
        console.log(`  ${nr} | ${z.name.slice(0, 38).padEnd(38)} | ${text}`);
      }
    }
    console.log("");
  };

  zeigen("VERWORFEN (Adresse unbrauchbar)", verworfen);
  zeigen("REPARIERT", repariert);
  zeigen("BRAUCHT EIN URTEIL", zuPruefen);

  // Freigabe: nur, was weder verworfen wurde noch einen offenen Befund hat.
  //
  // Bis zum 08.09.2026 stand hier "alles, was nicht verworfen wurde" — und weil
  // die Runde die Regelbrüche gar nicht sah, hiess das: alles. Ein Entwurf mit
  // wörtlich abgeschriebenem Branchen-Hook geht an dutzende Betriebe derselben
  // Branche mit demselben Satz. Was einen Befund hat, bleibt auf PRUEFEN, bis
  // ein Mensch hingesehen oder neu-generieren.ts die Copy ersetzt hat.
  const gesperrt = gesperrteZeilen(befunde);
  const freizugeben = zeilen.filter((z) => !gesperrt.has(z.nummer));
  if (FREIGEBEN) {
    for (const z of freizugeben) {
      updates.push({ range: `${QUEUE_TAB}!F${z.nummer}`, values: [["DRAFT"]] });
    }
    console.log(
      `== FREIGABE ==\n  ${freizugeben.length} Zeilen PRUEFEN → DRAFT\n` +
        `  ${gesperrt.size} bleiben auf PRUEFEN (verworfen oder mit Befund)\n`
    );
  }

  if (!SCHREIBEN) {
    console.log(`Trockenlauf. ${updates.length} Änderungen vorbereitet, nichts geschrieben.`);
    console.log("Zum Ausführen: npx tsx tools/freigabe-runde.ts --schreiben [--freigeben]");
    return;
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }
  console.log(`${updates.length} Zellen geschrieben.`);
}

main().catch((fehler) => {
  console.error(fehler);
  process.exit(1);
});
