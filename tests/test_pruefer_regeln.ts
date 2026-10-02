// Tests für die festen Regeln des Freigabe-Prüfers (tools/pruefer.ts), 27.09.2026.
// Kein Netzwerk, kein Sheet, kein LLM.
// Ausführen: npx tsx tests/test_pruefer_regeln.ts
//
// Die Positiv-Fälle sind wörtliche Stellen aus Entwürfen, die Nio in der
// Freigabe-Runde verworfen hat. Die Negativ-Fälle sind die korrekten Formen,
// die dieselben Regeln nicht anschlagen dürfen — sonst verwirft der Prüfer
// gute Mails und niemand traut ihm.

import { regelTreffer, type PruefFall } from "../tools/pruefer";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

const basis: PruefFall = {
  name: "Praxis Lorbeer", stadt: "Bonn", kontakt: "info@lorbeer.de",
  betreff: "wie nehmt ihr anfragen auf?", entwurf: "", nische: "Fußpflege-Praxis",
};
const treffer = (entwurf: string, extra: Partial<PruefFall> = {}) =>
  regelTreffer({ ...basis, ...extra, entwurf });
const schlaegtAn = (entwurf: string, teil: string, extra: Partial<PruefFall> = {}) =>
  treffer(entwurf, extra).some((t) => t.startsWith(teil));

// ─── Verb passt nicht zu "ihr" ───────────────────────────────────────────────
check(schlaegtAn("Hey, wie fängt ihr Anfragen ab?", "Verb passt nicht"), "„wie fängt ihr“ (1731)");
check(schlaegtAn("Hey, ihr habt die Anfrage sofort, wenn ihr Zeit hat.", "Verb passt nicht"), "„wenn ihr Zeit hat.“ (1732)");
check(schlaegtAn("Hey, schön, dass ihr euch Zeit nimmt.", "Verb passt nicht"), "„dass ihr euch Zeit nimmt.“");
check(!schlaegtAn("Hey, wie fangt ihr Anfragen ab?", "Verb passt nicht"), "korrekt: „wie fangt ihr“");
check(!schlaegtAn("Hey, wenn ihr Zeit habt, schaut rein.", "Verb passt nicht"), "korrekt: „wenn ihr Zeit habt“");
check(!schlaegtAn("Hey, bietet ihr auch Hausbesuche an?", "Verb passt nicht"), "korrekt: „bietet ihr“ (gleiche Form)");

// ─── kleines "sie" als Anrede ────────────────────────────────────────────────
check(schlaegtAn("Hey, ein Satz, den sie reinschreiben können: …", "kleines sie"), "„den sie reinschreiben“ (1737)");
check(schlaegtAn("Hey, beispielsweise könnten sie reinfragen: …", "kleines sie"), "„könnten sie reinfragen“ (1868)");
check(!schlaegtAn("Hey, ihr könnt reinschreiben: …", "kleines sie"), "korrekt: „ihr könnt reinschreiben“");

// ─── Schlussformel ───────────────────────────────────────────────────────────
check(schlaegtAn("Hey, … Es gibt keine Anmeldung nötig.", "Formel kaputt"), "„Es gibt keine Anmeldung nötig“ (1749)");
check(schlaegtAn("Hey, … Für keine Anmeldung, es passiert nichts.", "Formel kaputt"), "„Für keine Anmeldung“ (1730)");
check(schlaegtAn("Hey, … Hätte das für euch einen Blick wert?", "Formel kaputt"), "„Hätte das … wert“ (1769)");
check(!schlaegtAn("Hey, … Keine Anmeldung nötig. Wäre das für euch einen Blick wert?", "Formel kaputt"), "korrekt: Formel heil");

// ─── Betreff-Register ────────────────────────────────────────────────────────
const siezt = "Guten Tag, wie erfassen Sie Anfragen? Wäre das für Sie einen Blick wert?";
check(schlaegtAn(siezt, "Betreff duzt", { betreff: "eure jahressteuererklärungen" }), "Betreff „eure …“, Text siezt (1793)");
check(!schlaegtAn(siezt, "Betreff duzt", { betreff: "anfragen nach feierabend" }), "neutraler Betreff bei Sie-Text");
check(!schlaegtAn("Hey, wie nehmt ihr Anfragen auf?", "Betreff duzt"), "ihr-Betreff bei ihr-Text");

// ─── Begrüßung, Maps-Name ────────────────────────────────────────────────────
check(schlaegtAn("eure Behandlungen sind gefragt.", "keine Begrüßung"), "Text ohne Begrüßung");
check(!schlaegtAn("Guten Tag, eure Behandlungen …", "keine Begrüßung"), "„Guten Tag,“ zählt als Begrüßung");
check(
  schlaegtAn("Hey, bei der med. Fußpflegepraxis Linzbach + Säger Podologen …", "Maps-Name",
    { name: "med. Fußpflegepraxis Linzbach + Säger Podologen" }),
  "Maps-Titel mit „med.“ wörtlich im Satz (1722)"
);
check(
  schlaegtAn("Hey, bei Karl Kompfe GmbH …", "Maps-Name", { name: "Karl Kompfe GmbH" }),
  "Rechtsform im Satz"
);
check(
  !schlaegtAn("Hey, bei Karl Kompfe …", "Maps-Name", { name: "Karl Kompfe GmbH" }),
  "bereinigter Name ohne Rechtsform ist in Ordnung"
);
check(!schlaegtAn("Hey, bei Praxis Lorbeer …", "Maps-Name"), "Name ohne Marker wird nie gemeldet");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
if (fehlgeschlagen) process.exit(1);
