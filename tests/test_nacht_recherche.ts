// Tests für die reine Städte-Auswahl-Logik der Nacht-Recherche.
// Kein Netzwerk, kein Sheet, kein LLM — nur die Rotations-Funktion.
// Ausführen: npx tsx tests/test_nacht_recherche.ts

import { waehleStaedte } from "../src/trigger/nacht-recherche";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) {
    console.log(`[OK]   ${nachricht}`);
    bestanden++;
  } else {
    console.log(`[FEHL] ${nachricht}`);
    fehlgeschlagen++;
  }
}

const STAEDTE = ["A", "B", "C", "D", "E", "F", "G", "H"];

// 1. Liefert genau `anzahl` Städte
check(waehleStaedte(STAEDTE, 0, 5).length === 5, "liefert genau anzahl Städte");

// 2. Startet am Rotations-Offset (tagImJahr % länge)
check(
  JSON.stringify(waehleStaedte(STAEDTE, 0, 3)) === JSON.stringify(["A", "B", "C"]),
  "startet bei Offset 0 → A,B,C",
);
check(
  JSON.stringify(waehleStaedte(STAEDTE, 2, 3)) === JSON.stringify(["C", "D", "E"]),
  "tagImJahr=2 → C,D,E (Fenster verschoben)",
);

// 3. Wickelt am Array-Ende um
check(
  JSON.stringify(waehleStaedte(STAEDTE, 7, 3)) === JSON.stringify(["H", "A", "B"]),
  "wrap-around am Ende → H,A,B",
);

// 4. anzahl > länge → alle Städte, keine Dubletten
const alle = waehleStaedte(STAEDTE, 3, 99);
check(alle.length === STAEDTE.length, "anzahl > länge → auf Array-Länge gedeckelt");
check(new Set(alle).size === alle.length, "keine Dubletten im Batch");

// 5. Aufeinanderfolgende Tage liefern KEINEN identischen Batch (Rotation greift)
const heute = JSON.stringify(waehleStaedte(STAEDTE, 10, 4));
const morgen = JSON.stringify(waehleStaedte(STAEDTE, 11, 4));
check(heute !== morgen, "Folgetag → anderer Städte-Batch");

// 6. Negativer/robuster Umgang mit großem tagImJahr (Modulo bleibt im Bereich)
const gross = waehleStaedte(STAEDTE, 195, 5);
check(gross.length === 5 && gross.every((s) => STAEDTE.includes(s)), "großer tagImJahr bleibt gültig");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
