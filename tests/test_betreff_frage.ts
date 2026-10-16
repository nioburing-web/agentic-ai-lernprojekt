// Tests für die Betreff-Regel "Frage an den Betrieb" vom 16.10.2026.
// Kein Netzwerk, kein Sheet, kein LLM.
// Ausführen: npx tsx tests/test_betreff_frage.ts
//
// Hintergrund (gemessen am 16.10.2026 an allen Erstmails seit dem 05.10.):
// seit dem 11.10. wurden 42 von 46 Betreffen ohne Fragezeichen beim Lesen
// verworfen ("osteopathie in mannheim", "hautanalyse in augsburg" lesen sich
// wie ein Suchbegriff oder eine Kundenanfrage). Von 14 Frage-Betreffen gingen
// 8 durch, die 6 anderen fielen an Köder-Ich-Form oder am Mailtext, nie an der
// Form des Betreffs. Die Ursache lag im Erzeuger: vier von fünf Betreff-
// Blickwinkeln verlangten genau die verworfene Form. Nio hat am 16.10.
// entschieden: der Betreff ist immer eine Frage an den Betrieb.

import { betreffIstKeineFrage } from "../src/trigger/entwurf-qualitaet";
import { waehleBetreffAngle } from "../src/trigger/nacht-recherche";
import { regelBefunde } from "../tools/freigabe-pruefung";
import { readFileSync } from "node:fs";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

// ── Verworfen am 12./13.10. wegen der Form: muss anschlagen ────────────────
const KEINE_FRAGE = [
  "osteopathie in mannheim",        // 2279-Runde, Suchbegriff
  "hautanalyse in augsburg",
  "extensions bei hair lounge",
  "hausverkauf in mannheim",
  "physiotherapie am neckar",       // Slogan
  "beweglichkeit mit faszienrolle",
  "balayage und farbtechniken",
  "mannheim und umgebung",
];
for (const b of KEINE_FRAGE) check(betreffIstKeineFrage(b) !== null, `keine Frage erkannt: "${b}"`);

// ── Freigegeben, als Frage formuliert: darf nicht anschlagen ────────────────
const FRAGE = [
  "wer nimmt neue terminfragen auf?",
  "was passiert bei neuen patientenfragen?",
  "wie plant ihr neue termine?",
  "wie läuft’s zwischen den fahrstunden?",   // typografischer Apostroph
  "wer fängt neue kaufanfragen ab? ",        // Leerzeichen am Ende
  "was passiert nach büroschluss ?",         // Leerzeichen vor dem Zeichen
];
for (const b of FRAGE) check(betreffIstKeineFrage(b) === null, `Frage durchgelassen: "${b}"`);

check(betreffIstKeineFrage("") !== null, "leerer Betreff schlägt an");

// ── Erzeuger: jeder Blickwinkel verlangt eine Frage ────────────────────────
const namen = new Set<string>();
for (let i = 0; i < 5; i++) {
  const a = waehleBetreffAngle(i);
  namen.add(a.name);
  check(/frage/i.test(a.anweisung), `Blickwinkel "${a.name}" verlangt eine Frage`);
  check(!/kunden(sicht|anfrage)/i.test(a.anweisung) || /nicht/i.test(a.anweisung),
    `Blickwinkel "${a.name}" schreibt nicht aus Kundensicht`);
}
check(namen.size === 5, "fünf verschiedene Blickwinkel bleiben (gegen Monokultur)");

// Der Erzeuger prüft die Regel selbst, statt sie nur zu bitten.
const quelle = readFileSync(new URL("../src/trigger/nacht-recherche.ts", import.meta.url), "utf8");
check(/betreffIstKeineFrage\(/.test(quelle), "nacht-recherche ruft betreffIstKeineFrage auf");
check(/"betreff keine frage"/.test(quelle), "nacht-recherche meldet den Mangel, wenn der Nachfass reißt");

// ── Prüfer: dieselbe Regel, importiert ─────────────────────────────────────
const basis = {
  name: "Physiotherapie Beispiel",
  stadt: "Mannheim",
  entwurf: "Hallo, bei Physiotherapie Beispiel gibt es viele Terminanfragen. Ich bin Nio. https://demo.nio-automation.de/a/abc123 Wäre das einen Blick wert?",
  betreff: "osteopathie in mannheim",
  nische: "Physiotherapie",
};
check(regelBefunde(basis, []).some((b) => b.startsWith("Betreff ist keine Frage")), "regelBefunde meldet den Nicht-Frage-Betreff");
check(!regelBefunde({ ...basis, betreff: "wer nimmt neue terminfragen auf?" }, []).some((b) => b.startsWith("Betreff ist keine Frage")),
  "regelBefunde bleibt still bei Frage-Betreff");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
if (fehlgeschlagen > 0) process.exit(1);
