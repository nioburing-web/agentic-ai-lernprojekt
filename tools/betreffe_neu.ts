// Einmal-Werkzeug: erneuert die Betreffe der pausierten Drafts nach dem Fix vom
// 18.07.2026. Die 33 Zeilen wurden noch mit dem alten Prompt erzeugt (19 von 30
// Betreffen des 17.07. enthielten "Anruf") — der Mailtext bleibt unverändert,
// nur die Betreffzeile wird neu generiert.
//
// Sendet nichts. Setzt den Status NICHT zurück — das ist ein zweiter, bewusster
// Schritt.
//
// Ausführen: npx tsx tools/betreffe_neu.ts [--schreiben]
// Ohne --schreiben nur Vorschau.

import "dotenv/config";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { generiereEmailEntwurf, betreffKern, betreffIstBrauchbar } from "../src/trigger/nacht-recherche";

const QUEUE_TAB = "Outreach Queue";
const SCHREIBEN = process.argv.includes("--schreiben");

function getSheets() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON fehlt");
  const auth = new GoogleAuth({
    credentials: JSON.parse(json),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return googleSheets({ version: "v4", auth });
}

async function main(): Promise<void> {
  const sheets = getSheets();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("GOOGLE_SHEET_ID fehlt");

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!A:I`,
  });
  const rows = res.data.values ?? [];

  // Alle bisher verschickten Betreffe gelten als verbraucht.
  const verbraucht: string[] = rows
    .slice(1)
    .map((r) => String(r?.[8] ?? "").trim())
    .filter((b) => b.length > 0);

  const ziele: { zeile: number; name: string; stadt: string; alt: string; entwurf: string }[] = [];
  rows.forEach((r, i) => {
    if (i === 0) return;
    if (String(r?.[5] ?? "").trim() !== "PAUSIERT") return;
    ziele.push({
      zeile: i + 1,
      name: String(r?.[1] ?? ""),
      stadt: String(r?.[2] ?? ""),
      alt: String(r?.[8] ?? ""),
      entwurf: String(r?.[4] ?? ""),
    });
  });

  console.log(`${ziele.length} pausierte Drafts gefunden, ${verbraucht.length} Betreffe als verbraucht geladen`);
  console.log(SCHREIBEN ? "MODUS: schreiben\n" : "MODUS: Vorschau (--schreiben zum Übernehmen)\n");

  const updates: { range: string; values: string[][] }[] = [];
  let schlecht = 0;

  for (let i = 0; i < ziele.length; i++) {
    const z = ziele[i]!;
    // Der Mailtext bleibt wie er ist — wir brauchen nur einen neuen Betreff.
    // Als Quellmaterial dient der bereits geschriebene Entwurf: darin steckt die
    // echte, firmenspezifische Beobachtung aus dem Website-Text der Nacht-Recherche.
    // Ein generischer Platzhaltertext taugt hier nicht — dann fällt das Modell
    // mangels Unterscheidungsmerkmal reihenweise auf dieselbe Leistung zurück.
    const entwurf = await generiereEmailEntwurf(
      z.name,
      z.stadt,
      "Kfz-Werkstatt",
      null,
      z.entwurf,
      "https://kfz-demo-agent.netlify.app/r/platzhalter",
      i,
      verbraucht,
    );
    const neu = entwurf.betreff;
    const ok = betreffIstBrauchbar(neu, verbraucht);
    if (!ok) schlecht++;
    verbraucht.push(neu);
    updates.push({ range: `${QUEUE_TAB}!I${z.zeile}`, values: [[neu]] });
    console.log(`${ok ? "OK  " : "FEHL"} Z${z.zeile}  "${z.alt}"  ->  "${neu}"`);
  }

  // Bei temperature 0.9 würfelt jeder Lauf neu — ein paar Zeilen kollidieren
  // immer. Statt den ganzen Batch zu verwerfen: gezielt nachbessern, mit
  // verschobenem Blickwinkel, damit der Neuversuch nicht dieselbe Ecke trifft.
  for (let runde = 1; runde <= 4 && schlecht > 0; runde++) {
    console.log(`\n--- Nachbesserung Runde ${runde} (${schlecht} offen) ---`);
    for (let i = 0; i < updates.length; i++) {
      const aktuell = updates[i]!.values[0]![0]!;
      const andere = updates.filter((_, j) => j !== i).map((u) => u.values[0]![0]!);
      if (betreffIstBrauchbar(aktuell, [...verbraucht.filter((b) => b !== aktuell), ...andere])) continue;

      const z = ziele[i]!;
      const neu = await generiereEmailEntwurf(
        z.name, z.stadt, "Kfz-Werkstatt", null, z.entwurf,
        "https://kfz-demo-agent.netlify.app/r/platzhalter",
        i + runde * 3, [...verbraucht, ...andere],
      );
      updates[i]!.values = [[neu.betreff]];
      console.log(`  Z${z.zeile}: "${aktuell}" -> "${neu.betreff}"`);
    }
    schlecht = updates.filter((u, i) => {
      const andere = updates.filter((_, j) => j !== i).map((x) => x.values[0]![0]!);
      return !betreffIstBrauchbar(u.values[0]![0]!, andere);
    }).length;
  }

  const kerne = updates.map((u) => betreffKern(u.values[0]![0]!));
  const mitAnruf = kerne.filter((k) => /anruf|telefon|verpasst/.test(k)).length;
  if (new Set(kerne).size !== kerne.length) schlecht = Math.max(schlecht, 1);
  console.log(`\nneue Betreffe: ${updates.length}, einzigartig: ${new Set(kerne).size}, mit Anruf/Telefon: ${mitAnruf}, ungültig: ${schlecht}`);

  if (!SCHREIBEN) {
    console.log("\nNichts geschrieben. Mit --schreiben übernehmen.");
    return;
  }
  if (mitAnruf > 0 || schlecht > 0) {
    console.log("\nABBRUCH: nicht alle Betreffe sind sauber — nichts geschrieben.");
    process.exit(1);
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { valueInputOption: "RAW", data: updates },
  });
  console.log(`\n${updates.length} Betreffe geschrieben.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
