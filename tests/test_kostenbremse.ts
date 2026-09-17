// Tests für die Kostenbremse vor Place Details (17.09.2026).
// Kein Netzwerk: geprüft wird nur der Schlüssel, an dem ein bekannter Betrieb
// erkannt wird, BEVOR der kostenpflichtige Details-Abruf läuft.
// Ausführen: npx tsx tests/test_kostenbremse.ts
//
// Hintergrund: nacht-recherche holte Place Details für jeden der bis zu 20
// Treffer einer Suche und erkannte Dubletten erst danach, an der E-Mail-Adresse.
// Die Details-Abrufe sind der Kostentreiber des Laufs, nicht das LLM.

import { betriebsSchluessel, bekannteBetriebe } from "../src/trigger/nacht-recherche";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

// ── Schlüssel ───────────────────────────────────────────────────────────────
check(
  betriebsSchluessel("Tierarztpraxis am Waldbach", "Münster") ===
    betriebsSchluessel("  tierarztpraxis am waldbach ", "münster"),
  "Gross/klein und Rand-Leerzeichen spielen keine Rolle"
);
check(
  betriebsSchluessel("Tierarztpraxis am Waldbach", "Münster") !==
    betriebsSchluessel("Tierarztpraxis am Waldbach", "Bonn"),
  "gleicher Name in anderer Stadt ist ein anderer Betrieb"
);
check(
  betriebsSchluessel("Praxis A", "Bonn") !== betriebsSchluessel("Praxis B", "Bonn"),
  "anderer Name ist ein anderer Betrieb"
);
// Kein Raten: "GmbH" oder ein Zusatz machen einen anderen Titel. Lieber einmal
// zu viel abrufen, als einen neuen Betrieb fälschlich für bekannt zu halten.
check(
  betriebsSchluessel("Praxis A GmbH", "Bonn") !== betriebsSchluessel("Praxis A", "Bonn"),
  "Titel wird nicht normalisiert, nur Gross/klein und Leerzeichen"
);
check(betriebsSchluessel("", "Bonn") === null, "leerer Name ergibt keinen Schlüssel");
check(betriebsSchluessel("Praxis A", "") === null, "leere Stadt ergibt keinen Schlüssel");

// ── Aus den Queue-Zeilen A:D ────────────────────────────────────────────────
const zeilen = [
  ["Typ", "Name", "Stadt", "Kontakt"],
  ["EMAIL", "Tierarztpraxis am Waldbach", "Münster", "info@x.de"],
  ["EMAIL", "Praxis ohne Stadt", "", "a@b.de"],
  [],
  ["EMAIL", "Lehners Wirtshaus Karlsruhe", "Karlsruhe", "c@d.de"],
];
const bekannt = bekannteBetriebe(zeilen);
check(bekannt.size === 2, "Kopfzeile, leere Zeilen und Zeilen ohne Stadt zählen nicht");
check(bekannt.has(betriebsSchluessel("tierarztpraxis am waldbach", "Münster")!), "bekannter Betrieb wird gefunden");
check(!bekannt.has(betriebsSchluessel("Neue Praxis", "Münster")!), "unbekannter Betrieb wird nicht gefunden");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
if (fehlgeschlagen > 0) process.exit(1);
