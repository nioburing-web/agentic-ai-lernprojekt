// Tests für die Betreff-Logik der Nacht-Recherche.
// Kein Netzwerk, kein Sheet, kein LLM — nur Rotation, Normalisierung, Validierung.
// Ausführen: npx tsx tests/test_betreff.ts
//
// Hintergrund: Am 17.07.2026 gingen 30 Erstmails raus, 19 davon mit "Anruf" im
// Betreff, 2 Paare exakt identisch. Open Rate 10% gegenüber 38% bei den
// Nachfass-Mails desselben Tages. Diese Tests halten den Fix fest.

import { waehleBetreffAngle, betreffKern, betreffIstBrauchbar } from "../src/trigger/nacht-recherche";

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

// ─── Rotation ────────────────────────────────────────────────────────────────

// 1. Deterministisch: gleicher Index → gleicher Blickwinkel
check(
  waehleBetreffAngle(3).name === waehleBetreffAngle(3).name,
  "gleicher Index liefert denselben Blickwinkel (deterministisch)",
);

// 2. Aufeinanderfolgende Indizes liefern verschiedene Blickwinkel
check(
  waehleBetreffAngle(0).name !== waehleBetreffAngle(1).name,
  "Folge-Index → anderer Blickwinkel",
);

// 3. Über 30 Mails (ein Nachtlauf) kommt JEDER Blickwinkel vor.
//    Das ist der Kern des Fixes: Math.random() garantiert das nicht.
const ueber30 = new Set(Array.from({ length: 30 }, (_, i) => waehleBetreffAngle(i).name));
check(ueber30.size === 5, `alle 5 Blickwinkel kommen in 30 Mails vor (waren ${ueber30.size})`);

// 4. Gleichverteilung: kein Blickwinkel dominiert (17.07.: 19 von 30 = "Anrufe")
const verteilung = new Map<string, number>();
for (let i = 0; i < 30; i++) {
  const n = waehleBetreffAngle(i).name;
  verteilung.set(n, (verteilung.get(n) ?? 0) + 1);
}
check(
  [...verteilung.values()].every((n) => n === 6),
  `Gleichverteilung 6x je Blickwinkel (${JSON.stringify([...verteilung])})`,
);

// 5. Wrap-around und negative Indizes brechen nicht
check(waehleBetreffAngle(0).name === waehleBetreffAngle(5).name, "Index 5 wickelt auf 0 um");
check(typeof waehleBetreffAngle(-1).name === "string", "negativer Index bleibt gültig");

// ─── Normalisierung ──────────────────────────────────────────────────────────

// 6. Groß/Klein, Satzzeichen und Mehrfach-Leerzeichen sind egal
check(
  betreffKern("Verpasste Anrufe  abfangen!") === betreffKern("verpasste anrufe abfangen"),
  "Normalisierung ignoriert Groß/Klein, Satzzeichen, Doppel-Leerzeichen",
);

// 7. Umlaute bleiben erhalten (sonst kollabieren zu viele Betreffe auf denselben Kern)
check(betreffKern("Anrufe während der werkstattzeit").includes("während"), "Umlaute bleiben erhalten");

// ─── Validierung ─────────────────────────────────────────────────────────────

// 8. Die realen Betreffe vom 17.07. werden ALLE abgelehnt — das ist der Regressionstest
const echte1707 = [
  "viele Anrufe, keiner da",
  "verpasste Anrufe bei euch",
  "anrufe während der werkstattzeit",
  "wie geht ihr mit Anrufen um?",
  "müsst ihr oft an das telefon?",
  "verpasste Anrufe abfangen",
];
check(
  echte1707.every((b) => !betreffIstBrauchbar(b)),
  "alle sechs echten Anruf-Betreffe vom 17.07. werden abgelehnt",
);

// 9. Betreffe ohne die verbrannten Wörter gehen durch
check(betreffIstBrauchbar("klimaservice im sommer"), "sauberer Betreff wird akzeptiert");
check(betreffIstBrauchbar("termin für die hu?"), "Kundensicht-Betreff wird akzeptiert");

// 10. Duplikate gegen die Historie werden erkannt
check(
  !betreffIstBrauchbar("klimaservice im sommer", ["Klimaservice im Sommer!"]),
  "Duplikat der Historie wird erkannt (trotz anderer Schreibweise)",
);
check(
  betreffIstBrauchbar("getriebe instandsetzung", ["klimaservice im sommer"]),
  "anderer Betreff trotz gefüllter Historie akzeptiert",
);

// 11. Leerer Betreff ist nie brauchbar
check(!betreffIstBrauchbar(""), "leerer Betreff wird abgelehnt");
check(!betreffIstBrauchbar("   "), "Whitespace-Betreff wird abgelehnt");

// 12. Der Fallback-Betreff des Parsers ("kurze frage") ist formal brauchbar,
//     aber generisch — festhalten, dass er durchkommt, damit es niemanden überrascht
check(betreffIstBrauchbar("kurze frage"), "Parser-Fallback 'kurze frage' ist formal gültig");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
