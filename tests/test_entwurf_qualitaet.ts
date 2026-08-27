// Tests für die zwei Entwurfs-Prüfungen aus der Freigabe-Runde vom 27.08.2026.
// Ausführen: npx tsx tests/test_entwurf_qualitaet.ts
//
// 1. Google-Maps-Titel als Firmenname: "dentimea | Zahnarzt Augsburg |
//    Praxisklinik für Zahnheilkunde und Implantologie | Dr. Dr. Alexander Mai"
//    ging unverändert in den ersten Satz einer Mail.
// 2. Verbotener Beobachtungs-Einstieg: der Prompt untersagt "ich habe gesehen"
//    ausdrücklich, 2 von 60 Entwürfen fingen trotzdem so an.

import { saubererBetriebsname, oeffnerIstFloskel } from "../src/trigger/entwurf-qualitaet";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}
function gleich(ist: string, soll: string, nachricht: string): void {
  if (ist === soll) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}\n        ist : ${ist}\n        soll: ${soll}`); fehlgeschlagen++; }
}

// ─── saubererBetriebsname ────────────────────────────────────────────────────

gleich(
  saubererBetriebsname("dentimea | Zahnarzt Augsburg | Praxisklinik für Zahnheilkunde und Implantologie | Dr. Dr. Alexander Mai", "Augsburg"),
  "dentimea",
  "echter Fund 27.08.: Marke gewinnt, SEO-Rest fällt weg",
);

gleich(
  saubererBetriebsname("Zahnarzt Augsburg | Praxisklinik für Zahnmedizin Alte Schmiede", "Augsburg"),
  "Praxisklinik für Zahnmedizin Alte Schmiede",
  "generisches ERSTES Segment wird übersprungen, nicht blind genommen",
);

gleich(
  saubererBetriebsname("Tierarztpraxis Bergheim", "Augsburg"),
  "Tierarztpraxis Bergheim",
  "Name ohne Pipe bleibt unangetastet",
);

gleich(
  saubererBetriebsname("Kosmetikstudio Kleopatra", "Mannheim"),
  "Kosmetikstudio Kleopatra",
  "generisches Wort im echten Namen wird nicht abgeschnitten",
);

gleich(
  saubererBetriebsname("Zahnarzt Augsburg | Zahnarztpraxis Augsburg", "Augsburg"),
  "Zahnarzt Augsburg",
  "wenn ALLES generisch ist, gewinnt das erste Segment statt leer zurückzukommen",
);

gleich(saubererBetriebsname("", "Augsburg"), "", "leerer Titel wirft nicht");

gleich(
  saubererBetriebsname("Hair Deluxe | Friseur Augsburg", "Augsburg"),
  "Hair Deluxe",
  "Branche+Stadt hinten fällt weg",
);

// ─── oeffnerIstFloskel ───────────────────────────────────────────────────────

check(
  oeffnerIstFloskel("Hey, ich habe gesehen, dass ihr digitales Röntgen anbietet. Und weiter."),
  "echter Fund 27.08.: \"ich habe gesehen\" nach der Anrede wird erkannt",
);
check(
  oeffnerIstFloskel("Hey, mir ist aufgefallen, dass ihr abends offen habt."),
  "\"mir ist aufgefallen\" wird erkannt",
);
check(
  oeffnerIstFloskel("Hallo, ich bin auf euch gestoßen und wollte fragen."),
  "\"ich bin auf euch gestoßen\" wird erkannt",
);
check(
  !oeffnerIstFloskel("Hey, bei Hair Deluxe legt ihr Wert auf Beratung. Ich habe gesehen, wie das läuft."),
  "die Floskel MITTEN im Text ist erlaubt — nur der Einstieg zählt",
);
check(
  !oeffnerIstFloskel("Hey, während einer Behandlung kann niemand ans Telefon."),
  "sauberer Einstieg schlägt nicht an",
);
check(!oeffnerIstFloskel(""), "leerer Text wirft nicht");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
