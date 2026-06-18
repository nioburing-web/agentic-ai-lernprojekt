// Read-only Dry-Run der Lernschleife: zeigt, welche Korrektionen geharvtet WÜRDEN
// und welcher Few-Shot-Block injiziert würde. Schreibt nichts.
// Ausführen: npx tsx -r dotenv/config tests/dryrun_lernschleife.ts

import {
  ladeOutreachQueue,
  zuHarvestendeZeilen,
  ladeLernbeispiele,
  waehleLernbeispiele,
  formatiereLernbeispiele,
} from "../src/trigger/reply-classifier";

async function main() {
  console.log("=== Lernschleife DRY-RUN (read-only) ===\n");

  const { sheets, sheetId, rows } = await ladeOutreachQueue();
  console.log(`Queue-Zeilen (A:P): ${rows.length}`);

  const zuHarvesten = zuHarvestendeZeilen(rows);
  console.log(`Würde harvesten: ${zuHarvesten.length} Korrektur(en)`);
  for (const h of zuHarvesten) {
    console.log(`  - Zeile ${h.rowNumber}: ${h.beispiel.leadEmail} → richtig: ${h.beispiel.richtigKategorie} (Agent: ${h.beispiel.agentKategorie})`);
  }

  const alle = await ladeLernbeispiele(sheets, sheetId);
  console.log(`\nGespeicherte Lernbeispiele: ${alle.length}`);

  const fewShot = formatiereLernbeispiele(waehleLernbeispiele(alle, 12));
  console.log(`\n=== Injizierter Few-Shot-Block ===`);
  console.log(fewShot || "(leer — keine Korrekturen vorhanden, Agent läuft wie bisher)");
}

main().catch((err) => {
  console.error("Dry-Run Fehler:", err);
  process.exit(1);
});
