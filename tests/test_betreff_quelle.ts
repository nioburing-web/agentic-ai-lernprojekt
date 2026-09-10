// Tests für die zwei Regeln, die es bis zum 10.09.2026 nur im Prüfer gab, und
// für den Parser, der eine davon überhaupt erst erzeugt hat.
// Kein Netzwerk, kein Sheet, kein LLM.
// Ausführen: npx tsx tests/test_betreff_quelle.ts
//
// Hintergrund (gemessen am 10.09.2026 an den 53 offenen PRUEFEN-Zeilen der Queue):
// 37 Zeilen waren blockiert. 15 davon scheiterten AUSSCHLIESSLICH an zwei Regeln,
// die `tools/freigabe-runde.ts` und `tools/freigabe-pruefung.ts` kannten, aber
// `generiereEmailEntwurf` nicht — 9× "Betreffzeile steht im Mailtext", 8× "Betreff
// bricht die Kleinschreibung", 2 Zeilen trugen beides. Ein Erzeuger, der eine
// Regel nicht kennt, kann sie nicht erfüllen; die Handarbeit danach ist die Folge.
//
// Die Betreffzeile im Text war dabei nicht einmal ein Modellfehler, sondern
// unserer: fehlt in der Antwort der `EMAIL:`-Marker, nahm der Parser die ganze
// Rohausgabe — samt der `BETREFF:`-Zeile.

import { zerlegeAntwort } from "../src/trigger/nacht-recherche";
import {
  betreffzeileImText,
  ohneBetreffKopfzeile,
  betreffBrichtKleinschreibung,
} from "../src/trigger/entwurf-qualitaet";

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

// ─── zerlegeAntwort: der Normalfall bleibt, wie er war ───────────────────────

const mitMarker = zerlegeAntwort(
  "BETREFF: kurze frage zu euren anfragen\nEMAIL: Hey,\n\nbei Muster GmbH läuft das sicher gut.",
);
check(
  mitMarker.betreff === "kurze frage zu euren anfragen",
  "mit EMAIL-Marker: Betreff wird gelesen",
);
check(
  mitMarker.inhalt.startsWith("Hey,"),
  "mit EMAIL-Marker: Mailtext beginnt beim Marker",
);
check(
  !betreffzeileImText(mitMarker.inhalt),
  "mit EMAIL-Marker: keine Betreffzeile im Mailtext",
);

// ─── zerlegeAntwort ohne EMAIL-Marker: der echte Defekt ──────────────────────
// Das ist der Fall aus Zeile 1572, 1574, 1577, 1579, 1582, 1587, 1589, 1590 und
// 1596 der Queue. Alle neun sahen so aus, wörtlich aus Spalte E gelesen.

const ohneMarker = zerlegeAntwort(
  "BETREFF: frage zu ihren transaktionsberatungen  \n\nGuten Tag,  \n\nNexia bietet umfassende Beratung.",
);
check(
  ohneMarker.betreff === "frage zu ihren transaktionsberatungen",
  "ohne EMAIL-Marker: Betreff wird trotzdem gelesen",
);
check(
  !betreffzeileImText(ohneMarker.inhalt),
  "ohne EMAIL-Marker: die BETREFF-Zeile steht NICHT mehr im Mailtext",
);
check(
  ohneMarker.inhalt.startsWith("Guten Tag,"),
  "ohne EMAIL-Marker: Mailtext beginnt bei der Anrede",
);
check(
  ohneMarker.inhalt.includes("Nexia bietet umfassende Beratung."),
  "ohne EMAIL-Marker: der Rest des Textes bleibt vollständig erhalten",
);

// Groß/klein geschriebener Marker, gleiche Behandlung.
check(
  !betreffzeileImText(zerlegeAntwort("Betreff: kurze frage\n\nHey,\n\nText.").inhalt),
  "ohne EMAIL-Marker: auch 'Betreff:' in gemischter Schreibung wird abgeschnitten",
);

// Eine Antwort ganz ohne Marker darf nicht leer werden — lieber der Rohtext als
// nichts. Ein leerer Entwurf würde die Demo-Link-Prüfung reißen und den Lead
// still verlieren.
const garKeinMarker = zerlegeAntwort("Hey,\n\neinfach nur Text ohne jeden Marker.");
check(
  garKeinMarker.inhalt.includes("einfach nur Text ohne jeden Marker."),
  "ganz ohne Marker: der Rohtext bleibt der Mailtext",
);
check(
  garKeinMarker.betreff === "kurze frage",
  "ganz ohne Marker: Betreff fällt auf den Standard zurück",
);

// Nur eine BETREFF-Zeile und sonst nichts: dann bleibt der Rohtext stehen,
// statt einen leeren Entwurf zu erzeugen.
const nurBetreff = zerlegeAntwort("BETREFF: kurze frage");
check(
  nurBetreff.inhalt.length > 0,
  "nur eine BETREFF-Zeile: der Entwurf wird nicht leer",
);

// ─── betreffzeileImText ──────────────────────────────────────────────────────

check(
  betreffzeileImText("BETREFF: kurze frage\n\nHey,"),
  "Betreffzeile als erste Zeile wird erkannt",
);
check(
  betreffzeileImText("\n\n  betreff : kurze frage\n\nHey,"),
  "Betreffzeile wird auch mit Leerzeilen und Leerraum davor erkannt",
);
check(
  !betreffzeileImText("Hey,\n\nmein Betreff: war eine andere Frage."),
  "'Betreff:' mitten im Text ist kein Befund",
);
check(!betreffzeileImText(""), "leerer Text ist kein Befund");

// ─── ohneBetreffKopfzeile ────────────────────────────────────────────────────

check(
  ohneBetreffKopfzeile("Hey,\n\nalles gut.") === "Hey,\n\nalles gut.",
  "ohne Kopfzeile bleibt der Text unangetastet",
);
check(
  ohneBetreffKopfzeile("BETREFF: x\n\nHey,\n\nalles gut.") === "Hey,\n\nalles gut.",
  "mit Kopfzeile wird genau die Kopfzeile entfernt",
);

// ─── betreffBrichtKleinschreibung ────────────────────────────────────────────
// Die acht echten Fälle vom 10.09. sind genau dieser Art.

check(
  betreffBrichtKleinschreibung("Frage zur Unternehmensnachfolge"),
  "großgeschriebener Betreff wird erkannt (Zeile 1574)",
);
check(
  betreffBrichtKleinschreibung("wie bearbeiten Sie Anfragen heute?"),
  "ein einzelnes großes Wort reicht (Zeile 1590)",
);
check(
  !betreffBrichtKleinschreibung("frage zu euren anfragen"),
  "durchgehend kleiner Betreff ist sauber",
);
check(
  !betreffBrichtKleinschreibung(""),
  "leerer Betreff meldet hier nichts — dafür ist betreffIstBrauchbar da",
);
check(
  !betreffBrichtKleinschreibung("   "),
  "nur Leerraum meldet hier nichts",
);

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
