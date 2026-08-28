/**
 * Faehrt alle tests/test_*.ts und zaehlt zusammen.
 *
 * Warum es das gibt (28.08.2026): Die Suite existierte, aber nur als Wissen —
 * jeder Lauf war eine handgetippte Schleife im Terminal, und `npm test` sagte
 * "Error: no test specified". Eine Pruefung, die man erst zusammenbauen muss,
 * laeuft seltener als eine, die man aufruft.
 *
 * Jede Testdatei druckt am Ende eine Zeile "N bestanden, M fehlgeschlagen" und
 * endet mit Exit 1, wenn etwas rot ist. Beides wird hier ausgewertet: der
 * Exit-Code entscheidet, die Zahlen sind fuer den Menschen. Eine Datei, die gar
 * keine Ergebniszeile druckt, gilt als Fehler — sonst verschwindet ein
 * abgestuerzter Test lautlos aus der Summe.
 *
 * Ausfuehren: npm test
 */

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const testOrdner = join(wurzel, "tests");

const dateien = readdirSync(testOrdner)
  .filter((n) => n.startsWith("test_") && n.endsWith(".ts"))
  .sort();

let summeOk = 0;
let summeFehl = 0;
const kaputt = [];

for (const datei of dateien) {
  // Weder `npx` noch `node_modules/.bin/tsx` direkt: beide sind unter Windows
  // .cmd-Wrapper und brauchen dafuer `shell: true` — wovor Node zurecht warnt,
  // weil Argumente dann unescaped aneinandergehaengt werden. Node selbst mit
  // `--import tsx` laedt denselben Transpiler ohne Wrapper und ohne Shell.
  const lauf = spawnSync(process.execPath, ["--import", "tsx", join("tests", datei)], {
    cwd: wurzel,
    encoding: "utf8",
  });
  const ausgabe = `${lauf.stdout ?? ""}${lauf.stderr ?? ""}`;
  const treffer = [...ausgabe.matchAll(/(\d+) bestanden, (\d+) fehlgeschlagen/g)].pop();

  if (!treffer) {
    console.log(`[KAPUTT] ${datei.padEnd(34)} keine Ergebniszeile (Exit ${lauf.status})`);
    kaputt.push(datei);
    const letzte = ausgabe.trim().split("\n").slice(-3).join("\n         ");
    if (letzte) console.log(`         ${letzte}`);
    continue;
  }

  const ok = Number(treffer[1]);
  const fehl = Number(treffer[2]);
  summeOk += ok;
  summeFehl += fehl;

  const zeichen = fehl === 0 && lauf.status === 0 ? "OK  " : "FEHL";
  console.log(`[${zeichen}] ${datei.padEnd(34)} ${String(ok).padStart(3)} bestanden, ${fehl} fehlgeschlagen`);
  if (fehl > 0) {
    kaputt.push(datei);
    for (const zeile of ausgabe.split("\n").filter((z) => z.includes("[FEHL]"))) {
      console.log(`         ${zeile.trim()}`);
    }
  }
}

console.log(`\n${dateien.length} Dateien, ${summeOk} bestanden, ${summeFehl} fehlgeschlagen`);
if (kaputt.length > 0) {
  console.log(`Auffaellig: ${kaputt.join(", ")}`);
  process.exit(1);
}
