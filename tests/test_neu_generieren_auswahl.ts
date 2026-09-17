// Tests für die Zeilenauswahl von neu-generieren.ts (17.09.2026).
// Kein Netzwerk: geprüft wird nur, WELCHE Zeilen der Lauf anfassen darf.
// Ausführen: npx tsx tests/test_neu_generieren_auswahl.ts
//
// Hintergrund: am 09.09.2026 sollte neu-generieren.ts 18 defekte Entwürfe
// reparieren, schrieb aber ALLE PRUEFEN-Zeilen neu. Unentdeckte Defekte stiegen
// von 1 auf 7, und 8 vorher gute Betreffe wurden ersetzt. Danach blieben
// Befund-Zeilen liegen, weil niemand das Werkzeug ohne Filter anfassen wollte —
// am 17.09. waren es 29.

import { zeilenZumNeuSchreiben } from "../tools/freigabe-pruefung";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

const kandidaten = [
  { nummer: 10, befunde: [] },
  { nummer: 11, befunde: ["Branchen-Hook wörtlich übernommen"] },
  { nummer: 12, befunde: [] },
  { nummer: 13, befunde: ['Betreff unbrauchbar oder doppelt: "x"', "Floskel-Einstieg"] },
];

// ── Standard: nur Zeilen mit Befund ─────────────────────────────────────────
const standard = zeilenZumNeuSchreiben(kandidaten, new Set());
check(standard.nehmen.has(11) && standard.nehmen.has(13), "ohne --zeilen: Zeilen mit Befund werden genommen");
check(!standard.nehmen.has(10) && !standard.nehmen.has(12), "ohne --zeilen: saubere Zeilen bleiben unangetastet");
check(standard.nehmen.size === 2, "ohne --zeilen: genau die zwei Befund-Zeilen");
check(standard.unbekannt.length === 0, "ohne --zeilen: nichts Unbekanntes gemeldet");

// ── Explizite Liste schlägt den Standard ────────────────────────────────────
const explizit = zeilenZumNeuSchreiben(kandidaten, new Set([12]));
check(explizit.nehmen.size === 1 && explizit.nehmen.has(12), "mit --zeilen: nur die genannte Zeile, auch wenn sie sauber ist");
check(!explizit.nehmen.has(11), "mit --zeilen: Befund-Zeilen ausserhalb der Liste bleiben liegen");

// ── Genannte Zeile, die nicht auf PRUEFEN steht ─────────────────────────────
// Ein Vertipper darf keine fremde Zeile treffen — und soll auch nicht still
// verschwinden, sonst glaubt man, sie sei neu geschrieben worden.
const vertippt = zeilenZumNeuSchreiben(kandidaten, new Set([11, 999]));
check(vertippt.nehmen.size === 1 && vertippt.nehmen.has(11), "mit --zeilen: nur Kandidaten werden genommen");
check(vertippt.unbekannt.length === 1 && vertippt.unbekannt[0] === 999, "mit --zeilen: Zeile ohne PRUEFEN wird als unbekannt gemeldet");

// ── Keine Kandidaten ────────────────────────────────────────────────────────
const leer = zeilenZumNeuSchreiben([], new Set());
check(leer.nehmen.size === 0 && leer.unbekannt.length === 0, "leere Queue → nichts zu tun");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
if (fehlgeschlagen > 0) process.exit(1);
