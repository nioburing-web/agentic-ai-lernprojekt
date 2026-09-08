/**
 * Legt die regelkonformen PRUEFEN-Zeilen als lesbare Markdown-Datei vor.
 *
 * Warum es das gibt (08.09.2026): `freigabe-runde.ts` sagt, was NICHT rausgehen
 * darf. Die Fit-Frage — passt der Betrieb, klingt die Mail wie ein Mensch —
 * bleibt bei einem Menschen, und der braucht die Entwuerfe am Stueck zum Lesen,
 * nicht 27 Sheet-Zeilen im Browser.
 *
 * Die Auswahl kommt aus derselben regelBefunde() wie die Freigabe-Runde. Zwei
 * Fassungen derselben Auswahl wuerden driften, und dann laege hier ein Entwurf
 * zum Lesen, den die Runde sperrt (oder umgekehrt).
 *
 * Schreibt nie ins Sheet. Das Ziel liegt bewusst ausserhalb des Repos:
 * Kontaktdaten Dritter gehoeren nicht in Git.
 *
 *   npx tsx tools/lesefassung.ts <zielpfad.md>
 */

import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { readFileSync, writeFileSync } from "node:fs";
import { regelBefunde } from "./freigabe-pruefung";
import { anredeIstGemischt } from "../src/trigger/anrede";

const QUEUE_TAB = "Outreach Queue";
const ZIEL = process.argv[2];
if (!ZIEL) {
  console.error("Zielpfad fehlt. Aufruf: npx tsx tools/lesefassung.ts <zielpfad.md>");
  process.exit(1);
}

function ladeEnv(): void {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return;
  const roh = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const zeile of roh.split(/\r?\n/)) {
    const t = zeile.match(/^([A-Z0-9_]+)=(.*)$/);
    if (t) process.env[t[1] as string] = t[2] as string;
  }
}

async function main(): Promise<void> {
  ladeEnv();
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = googleSheets({ version: "v4", auth });
  const antwort = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID as string,
    range: `${QUEUE_TAB}!A:U`,
  });
  const rows = antwort.data.values ?? [];

  const verbrauchte: string[] = [];
  for (const r of rows.slice(1)) {
    const st = String(r?.[5] ?? "").trim();
    if ((st === "GESENDET" || st.startsWith("NACHGEFASST")) && r?.[8]) verbrauchte.push(String(r[8]));
  }

  const teile: string[] = [];
  const kurz: string[] = [];
  let n = 0;
  let gesperrt = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (String(r[5] ?? "").trim() !== "PRUEFEN") continue;
    const z = {
      name: String(r[1] ?? ""),
      entwurf: String(r[4] ?? ""),
      betreff: String(r[8] ?? ""),
      nische: String(r[19] ?? ""),
    };
    // Dieselbe Reihenfolge wie in freigabe-runde.ts.
    const befunde = regelBefunde(z, verbrauchte);
    if (z.betreff && z.betreff !== z.betreff.toLowerCase()) befunde.push("Betreff nicht klein");
    if (anredeIstGemischt(z.entwurf)) befunde.push("Anrede gemischt");
    if (befunde.length) {
      gesperrt++;
      continue;
    }

    n++;
    const nr = i + 1;
    kurz.push(`${String(nr).padEnd(5)} | ${z.name.slice(0, 38).padEnd(38)} | ${String(r[2] ?? "").padEnd(8)} | ${z.betreff}`);
    teile.push(`## ${n}. Zeile ${nr} — ${z.name}`);
    teile.push(`**${String(r[2] ?? "")} · ${z.nische} · ${String(r[3] ?? "")}**`);
    teile.push("");
    teile.push(`**Betreff:** ${z.betreff}`);
    teile.push("");
    teile.push(z.entwurf.split(/\r?\n/).map((x) => "> " + x).join("\n"));
    teile.push("");
  }

  const kopf = [
    "# Regelkonforme Entwürfe aus der Outreach-Queue",
    "",
    `**${n} Entwürfe zum Lesen, ${gesperrt} mit Befund zurückgehalten.**`,
    "",
    "Geprüft: Firmenname, Branchen-Hook, Floskel-Einstieg, Anrede, Betreff",
    "(verbraucht, verbotene Wörter, Kleinschreibung).",
    "Offen ist nur die Fit-Frage: passt der Betrieb, klingt die Mail wie ein Mensch?",
    "",
  ];
  writeFileSync(ZIEL, kopf.concat(teile).join("\n"), "utf8");
  console.log(kurz.join("\n"));
  console.log(`\n${n} Entwürfe geschrieben nach ${ZIEL} (${gesperrt} mit Befund zurückgehalten)`);
}

main().catch((f) => {
  console.error(f);
  process.exit(1);
});
