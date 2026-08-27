// Tests für die Anrede-Vereinheitlichung und die zwei Adress-Befunde vom 27.08.2026.
// Kein Netzwerk, kein Sheet, kein LLM — nur Textumformung und Validierung.
// Ausführen: npx tsx tests/test_anrede.ts
//
// Hintergrund: In der Freigabe-Runde am 27.08. mischten 17 von 60 Entwürfen "du"
// und "ihr" im selben Text. Dazu zwei Adressen, die keine Prüfung abfing:
// `%20info@kosmetik-mannheim.de` (nicht dekodiertes mailto) und `beispiel@gmail.com`
// (Platzhalter aus einer Website-Vorlage). Diese Tests halten die Fixes fest.

import {
  vereinheitlicheAnrede,
  anredeIstGemischt,
  adresseIstUnbrauchbar,
  dekodiereMailto,
} from "../src/trigger/nacht-recherche";

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
function gleich(ist: string, soll: string, nachricht: string): void {
  if (ist === soll) {
    console.log(`[OK]   ${nachricht}`);
    bestanden++;
  } else {
    console.log(`[FEHL] ${nachricht}\n        ist : ${ist}\n        soll: ${soll}`);
    fehlgeschlagen++;
  }
}

// ─── Anrede: benachbarte Paare ───────────────────────────────────────────────

gleich(vereinheitlicheAnrede("Du kannst ihn direkt ausprobieren."),
  "Ihr könnt ihn direkt ausprobieren.", "Du kannst → Ihr könnt (Großschreibung bleibt)");

gleich(vereinheitlicheAnrede("Hier kannst du das ausprobieren."),
  "Hier könnt ihr das ausprobieren.", "kannst du → könnt ihr (Inversion)");

gleich(vereinheitlicheAnrede("bei Nord Kosmetik bietest du verschiedene Techniken an."),
  "bei Nord Kosmetik bietet ihr verschiedene Techniken an.", "bietest du → bietet ihr (regelmäßiges Verb)");

gleich(vereinheitlicheAnrede("Du könntest einfach reinschreiben:"),
  "Ihr könntet einfach reinschreiben:", "Du könntest → Ihr könntet");

gleich(vereinheitlicheAnrede("du musst dich nicht anmelden"),
  "ihr müsst euch nicht anmelden", "du musst dich → ihr müsst euch");

// ─── Anrede: getrennte Stellung ──────────────────────────────────────────────

gleich(vereinheitlicheAnrede("einen Assistenten, den du direkt ausprobieren kannst."),
  "einen Assistenten, den ihr direkt ausprobieren könnt.", "getrennt: du ... kannst → ihr ... könnt");

gleich(vereinheitlicheAnrede("Ein Beispiel, das du reinschreiben kannst:"),
  "Ein Beispiel, das ihr reinschreiben könnt:", "getrennt über Objekt hinweg");

gleich(vereinheitlicheAnrede("Während du dich um einen Kunden kümmerst, klingelt das Telefon."),
  "Während ihr euch um einen Kunden kümmert, klingelt das Telefon.",
  "getrennt mit Umlaut-Verb: kümmerst → kümmert");

// ─── Anrede: übrige Pronomen und Imperativ ───────────────────────────────────

gleich(vereinheitlicheAnrede("Ich wollte dir kurz etwas zeigen."),
  "Ich wollte euch kurz etwas zeigen.", "dir → euch");

gleich(vereinheitlicheAnrede("Schreib einfach rein: Was kostet das?"),
  "Schreibt einfach rein: Was kostet das?", "Imperativ Singular → Plural");

gleich(vereinheitlicheAnrede("Das ist dein Betrieb und deine Entscheidung."),
  "Das ist euer Betrieb und eure Entscheidung.", "dein/deine → euer/eure");

// ─── Anrede: was NICHT angefasst werden darf ─────────────────────────────────

gleich(vereinheitlicheAnrede("Er läuft direkt im Browser."),
  "Er läuft direkt im Browser.", "\"direkt\" wird nicht als \"dir\" gelesen");

gleich(vereinheitlicheAnrede("Wäre das für euch einen Blick wert?"),
  "Wäre das für euch einen Blick wert?", "reiner Ihr-Text bleibt unverändert");

gleich(vereinheitlicheAnrede("Am Schreibtisch sitzt niemand."),
  "Am Schreibtisch sitzt niemand.", "\"Schreibtisch\" bleibt (kein Imperativ-Treffer)");

// ─── Detektor ────────────────────────────────────────────────────────────────

check(anredeIstGemischt("Du kannst das testen. Wäre das für euch was?"),
  "Detektor erkennt gemischte Anrede");
check(!anredeIstGemischt("Ihr könnt das testen. Wäre das für euch was?"),
  "Detektor schweigt bei reinem Ihr");
check(!anredeIstGemischt("Du kannst das testen. Sag mir kurz Bescheid."),
  "Detektor schweigt bei reinem Du (nicht gemischt)");

// Der eigentliche Vertrag: nach der Umformung ist nichts mehr gemischt.
const echterFall =
  "Hey, bei Nord Kosmetik bietest du verschiedene Techniken an. " +
  "Hier kannst du ihn dir ohne Anmeldung anschauen. " +
  "Wäre das für euch einen Blick wert?";
check(anredeIstGemischt(echterFall), "echter Fall vom 27.08. ist vorher gemischt");
check(!anredeIstGemischt(vereinheitlicheAnrede(echterFall)),
  "echter Fall vom 27.08. ist nachher sauber");

// Idempotent: zweimal anwenden ändert nichts mehr.
gleich(vereinheitlicheAnrede(vereinheitlicheAnrede(echterFall)),
  vereinheitlicheAnrede(echterFall), "Umformung ist idempotent");

// ─── mailto-Dekodierung ──────────────────────────────────────────────────────

gleich(dekodiereMailto("%20info@kosmetik-mannheim.de"), "info@kosmetik-mannheim.de",
  "führendes %20 wird entfernt (Fund 27.08.)");
gleich(dekodiereMailto("Info@Firma.DE"), "info@firma.de", "wird kleingeschrieben");
gleich(dekodiereMailto("a%40b.de"), "a@b.de", "%40 wird zu @");
gleich(dekodiereMailto("kaputt%ZZ@firma.de"), "kaputt%zz@firma.de",
  "kaputte Sequenz wirft nicht, bleibt stehen");

// ─── Adressprüfung ───────────────────────────────────────────────────────────

check(adresseIstUnbrauchbar("beispiel@gmail.com") !== null,
  "beispiel@gmail.com wird verworfen (Platzhalter, Fund 27.08.)");
check(adresseIstUnbrauchbar("example@web.de") !== null, "example@ wird verworfen");
check(adresseIstUnbrauchbar("mustermann@gmx.de") !== null, "mustermann@ wird verworfen");
check(adresseIstUnbrauchbar("%20info@firma.de") !== null,
  "übrig gebliebenes Prozentzeichen wird verworfen");
check(adresseIstUnbrauchbar("info@firma.de") === null, "echte Adresse bleibt");
check(adresseIstUnbrauchbar("nord-kosmetik@gmx.de") === null, "Freemail bleibt erlaubt");
check(adresseIstUnbrauchbar("beispielhaft@firma.de") === null,
  "\"beispielhaft@\" ist kein Platzhalter (Wortgrenze zählt)");

// ─── Ergebnis ────────────────────────────────────────────────────────────────

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
