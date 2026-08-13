// Fährt die Hook-Prüfung gegen die 60 echten Entwürfe der Nächte 11./12.08.2026,
// die als PRUEFEN im Sheet stehen. Kein LLM, kein Maps — nur Sheet lesen.
// Ausführen: npx tsx tests/dryrun_hook_kopie_echt.ts
//
// Zweck: eine Unit-Prüfung mit erfundenen Sätzen kann grün sein, während die
// Funktion an echter Copy danebenliegt. Hier zählt, ob sie auf dem Material
// trennt, das den Befund ausgelöst hat.

import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { hookIstAbgeschrieben } from "../src/trigger/nacht-recherche";
import { KATEGORIEN } from "../src/trigger/nischen";

const QUEUE_TAB = "Outreach Queue";

function hookVon(nischenName: string): string {
  for (const k of KATEGORIEN) {
    const n = k.nischen.find((x) => x.name === nischenName);
    if (n) return n.hook;
  }
  return "";
}

async function main(): Promise<void> {
  const roh = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!roh) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON fehlt");
  const auth = new GoogleAuth({
    credentials: JSON.parse(roh),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = googleSheets({ version: "v4", auth: auth as never });
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("GOOGLE_SHEET_ID fehlt");

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!A:U`,
  });
  const rows = res.data.values ?? [];

  let geprueft = 0;
  let geflaggt = 0;
  const treffer: string[] = [];

  rows.slice(1).forEach((row, i) => {
    const zeile = i + 2;
    if (String(row?.[5] ?? "").trim() !== "PRUEFEN") return;
    const firma = String(row?.[1] ?? "");
    const inhalt = String(row?.[4] ?? "");
    const nische = String(row?.[19] ?? "");
    const hook = hookVon(nische);
    if (!hook) {
      console.log(`[?]    Zeile ${zeile}: kein Hook für Nische "${nische}"`);
      return;
    }
    geprueft++;
    if (hookIstAbgeschrieben(inhalt, hook)) {
      geflaggt++;
      treffer.push(`  Zeile ${zeile}  ${nische.padEnd(22)} ${firma.slice(0, 44)}`);
    }
  });

  console.log(`\ngeprüft: ${geprueft} Entwürfe`);
  console.log(`Hook wörtlich übernommen: ${geflaggt}`);
  console.log(treffer.join("\n"));
  console.log(
    `\nDiese ${geflaggt} hätten mit dem Fix einen Neuversuch bekommen. ` +
      `Die übrigen ${geprueft - geflaggt} bleiben unangetastet.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
