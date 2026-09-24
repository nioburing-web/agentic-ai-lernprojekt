// Tests für die reinen Teile des Modellvergleichs (24.09.2026).
// Kein Netzwerk, kein LLM: geprüft wird die Blindzuordnung und das Einlesen
// der angekreuzten Lesefassung.
// Ausführen: npx tsx tests/test_modell_vergleich.ts

import {
  blindeReihenfolge, buchstabe, leseUrteile, zaehleProModell, URTEIL_ZEILE,
} from "../tools/modell-vergleich-auswertung";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

// Blindzuordnung: jede Variante genau einmal, stabil, und nicht überall gleich.
const r = blindeReihenfolge(1822, 3);
check([...r].sort().join(",") === "0,1,2", "jede Variante kommt genau einmal vor");
check(blindeReihenfolge(1822, 3).join() === r.join(), "gleiche Zeile ergibt gleiche Reihenfolge");
const verschieden = new Set(Array.from({ length: 20 }, (_, i) => blindeReihenfolge(1800 + i, 3).join()));
check(verschieden.size > 1, "die Reihenfolge wechselt zwischen den Zeilen (sonst ist A immer dasselbe Modell)");
check(buchstabe(0) === "A" && buchstabe(2) === "C", "Positionen werden zu Buchstaben");

// Einlesen: genau ein Kreuz zählt, keins oder zwei sind "offen".
const md = [
  "# Lesefassung", "",
  "### 1822-A", "text", URTEIL_ZEILE.replace("[ ] grammatik", "[x] grammatik"), "",
  "### 1822-B", "text", URTEIL_ZEILE.replace("[ ] frei", "[X] frei"), "",
  "### 1822-C", "text", URTEIL_ZEILE, "",
  "### 1823-A", "text", URTEIL_ZEILE.replace("[ ] frei", "[x] frei").replace("[ ] anderes", "[x] anderes"), "",
  "### 1823-B", "text", URTEIL_ZEILE.replace("[ ] anderes", "[ x ] anderes"), "",
].join("\n");
const u = leseUrteile(md);
check(u.get("1822-A") === "grammatik", "Kreuz bei grammatik wird gelesen");
check(u.get("1822-B") === "frei", "großes X zählt auch");
check(u.get("1822-C") === "offen", "ohne Kreuz: offen");
check(u.get("1823-A") === "offen", "zwei Kreuze: offen, kein Urteil");
check(u.get("1823-B") === "anderes", "Leerzeichen in der Klammer stören nicht");

// Zählen pro Modell.
const z = zaehleProModell(
  [
    { id: "1822-A", modell: "m1", befunde: [] },
    { id: "1822-B", modell: "m2", befunde: ["Floskel-Einstieg"] },
    { id: "1822-C", modell: "m1", befunde: [] },
  ],
  u
);
check(z.get("m1")?.grammatik === 1 && z.get("m1")?.offen === 1, "m1: 1 grammatik, 1 offen");
check(z.get("m2")?.frei === 1 && z.get("m2")?.regelbefund === 1, "m2: 1 frei, 1 Regelbefund");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
if (fehlgeschlagen > 0) process.exit(1);
