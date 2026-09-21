// Tests für betreffVergleichFuer (21.09.2026).
// Kein Netzwerk: geprüft wird, gegen welche Betreffe eine offene Zeile als
// "verbraucht" geprüft wird — und ob regelBefunde() damit eine Dublette
// innerhalb derselben Charge sperrt.
// Ausführen: npx tsx tests/test_betreff_charge.ts
//
// Hintergrund: Die Freigabe-Runde zählte nur GESENDET/NACHGEFASST als
// verbraucht. Zwei PRUEFEN-Zeilen derselben Nacht mit wortgleichem Betreff
// (Zeilen 1814/1819) sahen sich so nie gegenseitig und wären beide
// freigegeben worden — obwohl nacht-recherche die zweite selbst als
// "Betreff unbrauchbar" markiert hatte.

import { betreffVergleichFuer, regelBefunde, pruefEingabeAusZeile } from "../tools/freigabe-pruefung";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

// Sheet-Zeile nach Spaltenlayout der Outreach Queue: B Name, C Stadt,
// E Entwurf, F Status, I Betreff, T Nische. Index 0 ist die Kopfzeile,
// Index i ist Sheet-Zeile i + 1.
function zeile(status: string, betreff: string): unknown[] {
  const z: unknown[] = [];
  z[1] = "Muster Immobilien";
  z[2] = "Wiesbaden";
  z[4] = "Guten Tag, Muster Immobilien vermittelt Wohnungen. Ich habe einen digitalen Assistenten gebaut.";
  z[5] = status;
  z[8] = betreff;
  z[19] = "Immobilienmakler-Büro";
  return z;
}

const DOPPELT = "immobilienmakler mit 4,9 sterne bewertung";
const rohzeilen: unknown[][] = [
  ["Kopf"],                                         // Zeile 1
  zeile("GESENDET", "wie nehmt ihr anfragen auf?"),  // Zeile 2 — schon draussen
  zeile("PRUEFEN", DOPPELT),                         // Zeile 3 — erste der Dublette (1814)
  zeile("PRUEFEN", DOPPELT),                         // Zeile 4 — zweite der Dublette (1819)
  zeile("PRUEFEN", "eure marktpreiseinschätzung"),   // Zeile 5 — sauber
  zeile("VERWORFEN", "eure mietverwaltung"),         // Zeile 6 — geht nie raus
  zeile("PRUEFEN", "eure mietverwaltung"),           // Zeile 7 — gleicher Betreff wie eine verworfene
  zeile("PRUEFEN", "wie nehmt ihr anfragen auf?"),   // Zeile 8 — gleicher Betreff wie verschickt
  zeile("DRAFT", "eure immobilienbewertung"),        // Zeile 9 — freigegeben, geht morgen raus
  zeile("PRUEFEN", "eure immobilienbewertung"),      // Zeile 10 — gleicher Betreff wie ein DRAFT
];

function betreffBefund(nummer: number): boolean {
  const eingabe = pruefEingabeAusZeile(rohzeilen[nummer - 1]!);
  return regelBefunde(eingabe, betreffVergleichFuer(rohzeilen, nummer))
    .some((b) => b.startsWith("Betreff unbrauchbar oder doppelt"));
}

// ── Der Fall vom 21.09. ────────────────────────────────────────────────────
check(!betreffBefund(3), "erste Zeile der Dublette bleibt frei (wie in nacht-recherche)");
check(betreffBefund(4), "zweite Zeile der Dublette wird gesperrt — der Fall 1819");

// ── Die Zeile zählt nie gegen sich selbst ──────────────────────────────────
check(!betreffBefund(5), "saubere Zeile ohne Befund — kein Selbst-Duplikat");
check(!betreffVergleichFuer(rohzeilen, 5).includes("eure marktpreiseinschätzung"),
  "eigener Betreff steht nicht in der eigenen Vergleichsliste");

// ── Was schon vorher galt, gilt weiter ─────────────────────────────────────
check(betreffBefund(8), "Betreff, der schon verschickt wurde, bleibt gesperrt");

// ── Verworfene Zeilen gehen nie raus, zählen also nicht ────────────────────
check(!betreffBefund(7), "gleicher Betreff wie eine VERWORFENE Zeile ist frei");

// ── Freigegebene DRAFT-Zeilen gehen raus, zählen also mit ──────────────────
check(betreffBefund(10), "gleicher Betreff wie ein früherer DRAFT wird gesperrt");

// ── Kopfzeile und leere Betreffe landen nicht in der Liste ─────────────────
const liste = betreffVergleichFuer(rohzeilen, 10);
check(!liste.includes("Kopf") && liste.every((b) => b.length > 0), "keine Kopfzeile, keine leeren Einträge");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
if (fehlgeschlagen > 0) process.exit(1);
