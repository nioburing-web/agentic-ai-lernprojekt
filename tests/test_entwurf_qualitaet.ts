// Tests für die zwei Entwurfs-Prüfungen aus der Freigabe-Runde vom 27.08.2026.
// Ausführen: npx tsx tests/test_entwurf_qualitaet.ts
//
// 1. Google-Maps-Titel als Firmenname: "dentimea | Zahnarzt Augsburg |
//    Praxisklinik für Zahnheilkunde und Implantologie | Dr. Dr. Alexander Mai"
//    ging unverändert in den ersten Satz einer Mail.
// 2. Verbotener Beobachtungs-Einstieg: der Prompt untersagt "ich habe gesehen"
//    ausdrücklich, 2 von 60 Entwürfen fingen trotzdem so an.

import { saubererBetriebsname, oeffnerIstFloskel, nameIstBrauchbar } from "../src/trigger/entwurf-qualitaet";

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

// ─── Nachtrag Freigabe-Runde 28.08.2026 ──────────────────────────────────────
// Zwei Luecken, beide an echten Zeilen der Nacht vom 27.08. gefunden:
// 1. Getrennt wurde nur an "|". Maps liefert genauso oft " - ".
// 2. Bei einer Partnerschaft blieb nur der erste Partner uebrig.

// (1) Bindestrich als Trenner. Nur der freistehende Bindestrich zaehlt —
//     der Bindestrich IM Wort ("Haus- und", "Scholze-Kurz") ist Teil des Namens.

gleich(
  saubererBetriebsname("DEBUS Immobilien Rüdiger Debus - Immobilienmakler - Verkauf, Vermietung und Verwaltung von Immobilien", "Wiesbaden"),
  "DEBUS Immobilien Rüdiger Debus",
  "echter Fund 28.08.: Bindestrich trennt, der Beschreibungs-Schwanz faellt weg",
);

gleich(
  saubererBetriebsname("UP Steuerrecht Rechtsanwalts GmbH - Ihre Unternehmens-Partner", "Wiesbaden"),
  "UP Steuerrecht Rechtsanwalts GmbH",
  "echter Fund 28.08.: Slogan hinter dem Bindestrich faellt weg",
);

gleich(
  saubererBetriebsname("Hausverwaltung Wiesbaden - Naspa Immobilien GmbH", "Wiesbaden"),
  "Naspa Immobilien GmbH",
  "echter Fund 28.08.: Branche+Stadt VOR dem Bindestrich wird uebersprungen",
);

gleich(
  saubererBetriebsname("FNW Haus- und Grundstücksverwaltung GmbH", "Wiesbaden"),
  "FNW Haus- und Grundstücksverwaltung GmbH",
  "Bindestrich im Wort ist kein Trenner — 'Haus- und' bleibt zusammen",
);

gleich(
  saubererBetriebsname("Scholze-Kurz & Kurz Immobilien GmbH", "Wiesbaden"),
  "Scholze-Kurz & Kurz Immobilien GmbH",
  "durchgekoppelter Nachname bleibt unangetastet",
);

gleich(
  saubererBetriebsname("Kanzlei Meinke – Steuerberatung", "Wiesbaden"),
  "Kanzlei Meinke",
  "auch der Gedankenstrich trennt, nicht nur der Bindestrich",
);

// (2) Partnerschaft: fuehrende Einzelwort-Segmente sind Nachnamen und gehoeren
//     an das Segment dahinter. Sie enden, sobald ein generisches Segment kommt —
//     genau daran unterscheidet sich der Partner-Fall vom SEO-Fall.

gleich(
  saubererBetriebsname("HERKERT | SCHULZ | FRICK Rechtsanwälte Steuerberater PartG", "Wiesbaden"),
  "HERKERT SCHULZ FRICK Rechtsanwälte Steuerberater PartG",
  "echter Fund 28.08.: alle Partner bleiben, nicht nur der erste",
);

gleich(
  saubererBetriebsname("Meier | Müller | Schulz", "Hamburg"),
  "Meier Müller Schulz",
  "nur Nachnamen, kein Segment dahinter: trotzdem alle drei",
);

gleich(
  saubererBetriebsname("dentimea | Zahnarzt Augsburg | Dr. Dr. Alexander Mai", "Augsburg"),
  "dentimea",
  "die Partner-Regel darf den 27.08.-Fund nicht wieder aufreissen: nach der Marke kommt Branche+Stadt, also Schluss",
);

gleich(
  saubererBetriebsname("JK - Büroservice", "Hamburg"),
  "JK Büroservice",
  "Fund aus der Gegenprobe 28.08.: kurzes Kuerzel wird nicht zugunsten der Branche weggeworfen",
);

gleich(
  saubererBetriebsname("F80 – Die Zahn- und Gesichtsspezialisten – Berlin", "Berlin"),
  "F80",
  "Kuerzel mit Ziffer bleibt ebenfalls stehen",
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

// ─── nameIstBrauchbar ────────────────────────────────────────────────────────
//
// Der Fall vom 04.09.2026: Eine Queue-Zeile trug den Firmennamen "lz", und er
// landete im Mailtext ("Wäre das für lz einen Blick wert?"). Wichtig für die
// Diagnose: "lz" kam SO von Google Maps. Die Schneideregel hat nichts
// kaputtgemacht — es fehlte eine Untergrenze. Belegt am 06.09. durch den Lauf
// über alle 1509 Namen der Queue (tools/namensregel-gegenprobe.ts).

check(!nameIstBrauchbar("lz"), "zwei Buchstaben sind kein Betriebsname (Fall 04.09.)");
gleich(
  saubererBetriebsname("lz", "Stuttgart"),
  "lz",
  "saubererBetriebsname laesst 'lz' unveraendert — es gibt nichts zu schneiden",
);
check(!nameIstBrauchbar(""), "leerer Name ist unbrauchbar");
check(!nameIstBrauchbar("  -  "), "nur Satzzeichen ist unbrauchbar");
check(nameIstBrauchbar("BMW"), "drei Buchstaben reichen — echte Marken sind kurz");
check(nameIstBrauchbar("K&L"), "'K&L' bleibt brauchbar, das Kaufmanns-Und zaehlt nicht mit");
check(nameIstBrauchbar("Tierarztpraxis Milz"), "der vollstaendige Name bleibt brauchbar");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
