// Tests für die Fehlerklassen aus der Freigabe-Runde vom 06.10.2026.
// Kein Netzwerk: geprüft werden die reinen Funktionen.
// Ausführen: npx tsx tests/test_freigabe_06_10.ts
//
// Hintergrund: Die erste Luna-Charge hatte 59 Entwürfe ohne Regel-Befund. Beim
// Lesen fielen trotzdem 14 durch, 11 davon an Merkmalen, die man am Text oder an
// der Adresse ablesen kann. Jeder Fall hier ist eine echte Zeile aus dieser Runde.
// Ziel von Stufe 1 der Freigabe-Automatik: was ein Mensch heute mechanisch erkannt
// hat, erkennt ab jetzt die Prüfung.

import { betreffIstKoeder } from "../src/trigger/entwurf-qualitaet";
import { adresseIstUnbrauchbar } from "../src/trigger/nacht-recherche";
import { regelBefunde, beispielZurNische, nameWidersprichtNische } from "../tools/freigabe-pruefung";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

// ── Köder-Betreff: klingt wie eine echte Kundenanfrage ─────────────────────
// Alle acht verworfenen Betreffe vom 06.10. plus 2090 (Kater), Nische dazu.
const KOEDER: Array<[string, string]> = [
  ["mein hund kneift ein auge zu", "Tierarztpraxis"],          // 2085
  ["mein kater frisst seit gestern nicht", "Tierarztpraxis"],  // 2090
  ["habt ihr freitag einen tisch frei?", "Restaurant"],        // 2100
  ["mein hund braucht einen termin", "Tierarztpraxis"],        // 2110
  ["meine steuererklärung in friemersheim", "Steuerkanzlei"],  // 2115
  ["rückfrage zu meiner mietwohnung", "Hausverwaltung"],       // 2120
  ["rückfrage zu meiner wohnung", "Hausverwaltung"],           // 2125
  ["rückfrage zu meiner eigentumswohnung", "Hausverwaltung"],  // 2130
  ["ist die wohnung noch zu haben?", "Immobilienmakler-Büro"], // 2135
];
for (const [betreff, nische] of KOEDER) {
  check(betreffIstKoeder(betreff, beispielZurNische(nische)) !== null, `Köder erkannt: "${betreff}"`);
}

// Betreffe derselben Charge, die Nio freigegeben hat. Dürfen nicht anschlagen.
const EHRLICH: Array<[string, string]> = [
  ["chirurgie und orthopädie", "Tierarztpraxis"],
  ["wie haltet ihr den stress gering?", "Tierarztpraxis"],
  ["was macht ihr nach feierabend?", "Tierarztpraxis"],
  ["wie kommen reservierungen bei euch an?", "Restaurant"],
  ["eure firmen- und familienfeste", "Restaurant"],
  ["wie kommen bestellungen im service rein?", "Restaurant"],
  ["wie läuft’s zwischen den fahrstunden?", "Fahrschule"],
  ["wie startet ein neues mandat?", "Steuerkanzlei"],
  ["wie kommen mietermeldungen bei euch an?", "Hausverwaltung"],
  ["wie sortieren sie neue anliegen?", "Hausverwaltung"],
  ["wie kommen kaufanfragen bei euch an?", "Immobilienmakler-Büro"],
  ["wer kümmert sich um neue kaufinteressenten?", "Immobilienmakler-Büro"],
  ["zur wohnung in weitmar", "Immobilienmakler-Büro"],
  ["wohnhaus in bochum-hordel", "Immobilienmakler-Büro"],
];
for (const [betreff, nische] of EHRLICH) {
  check(betreffIstKoeder(betreff, beispielZurNische(nische)) === null, `kein Köder: "${betreff}"`);
}

// Der Beispielsatz der Nische selbst ist ein Köder, auch ohne "mein".
check(betreffIstKoeder("wann startet der nächste theoriekurs?", beispielZurNische("Fahrschule")) !== null,
  "Beispielsatz wörtlich als Betreff ist ein Köder");
// "Mein" als Teil des Firmennamens ist kein Köder (Bestands-Diff 06.10.: zwei
// freigegebene Betreffe schlugen sonst an). Ein anderes Ich-Wort daneben schon.
check(betreffIstKoeder("Ideen für Meine Fahrschule GmbH", beispielZurNische("Fahrschule"), "Meine Fahrschule GmbH") === null,
  "\"Meine\" im Firmennamen ist kein Köder");
check(betreffIstKoeder("Idee für Mein Makler Berlin-Spandau", beispielZurNische("Immobilienmakler-Büro"), "Mein Makler Berlin-Spandau") === null,
  "\"Mein\" im Firmennamen ist kein Köder (Makler)");
check(betreffIstKoeder("rückfrage zu meiner wohnung", beispielZurNische("Immobilienmakler-Büro"), "Mein Makler Bochum") !== null,
  "anderes Ich-Wort bleibt ein Köder, auch wenn der Name \"Mein\" trägt");
// Unbekannte Nische: nur die Ich-Form greift, kein Absturz.
check(betreffIstKoeder("wie plant ihr?", null) === null, "unbekannte Nische, ehrlicher Betreff → null");
check(betreffIstKoeder("mein auto ist kaputt", null) !== null, "unbekannte Nische, Ich-Form → Köder");

// ── Adresse ────────────────────────────────────────────────────────────────
check(adresseIstUnbrauchbar("ssstik.io_@schnitzery.de") !== null, "Scrape-Rest am lokalen Teil (2098)");
check(adresseIstUnbrauchbar(".info@betrieb.de") !== null, "Punkt am Anfang des lokalen Teils");
check(adresseIstUnbrauchbar("info@tierarzt-onlineverzeichnis.de") !== null, "Verzeichnis-Domain (2090)");
check(adresseIstUnbrauchbar("info@mein-branchenbuch.de") !== null, "Branchenbuch-Domain");
// Freigegebene Adressen derselben Runde bleiben brauchbar.
for (const ok of [
  "info@tierklinik-nbg.de", "praxis@dietz.vet", "hvtillmann@t-online.de", "ersenerguec@gmail.com",
  "shadi-tex@hotmail.com", "info@immoklar.nrw", "bochum@immobilienmakler12.de", "nuernberg@medivetgroup.com",
  "info.berg@betrieb.de", "a_b@betrieb.de",
]) {
  check(adresseIstUnbrauchbar(ok) === null, `brauchbar: ${ok}`);
}

// ── Name widerspricht der Nische ───────────────────────────────────────────
check(nameWidersprichtNische("PAVO Immobilien GmbH | Immobilienmakler Bochum", "Hausverwaltung") !== null,
  "Makler in der Hausverwaltungs-Nische (2126)");
check(nameWidersprichtNische("Hausverwaltung Grunwald", "Immobilienmakler-Büro") !== null,
  "Hausverwaltung in der Makler-Nische");
for (const [name, nische] of [
  ["PRANDO GmbH - Hausverwaltung, Mietverwaltung & Immobilienservice", "Hausverwaltung"],
  ["Scholler Immobilien und Verwaltung GmbH", "Hausverwaltung"],
  ["Oehler Immobilien- und Hausverwaltung", "Hausverwaltung"],
  ["IMMOBILIENMAKLER BOCHUM - FREIESLEBEN GmbH", "Immobilienmakler-Büro"],
  ["RheinStein Immobilien GmbH - Hausverwaltung & Makler", "Hausverwaltung"],
  ["Tierarztpraxis Dierks", "Tierarztpraxis"],
] as const) {
  check(nameWidersprichtNische(name, nische) === null, `passt: ${name}`);
}

// ── Verdrahtung: regelBefunde meldet die neuen Klassen ─────────────────────
const basis = {
  name: "Tierarztpraxis Eichenberg",
  stadt: "Duisburg",
  entwurf: "Hey, bei Tierarztpraxis Eichenberg gibt’s einen Hinweis zu Notfällen. Ich bin Nio. https://demo.nio-automation.de/a/683e03 Wäre das einen Blick wert?",
  betreff: "mein hund braucht einen termin",
  nische: "Tierarztpraxis",
};
check(regelBefunde(basis, []).some((b) => b.startsWith("Köder-Betreff")), "regelBefunde meldet den Köder-Betreff");
check(!regelBefunde({ ...basis, betreff: "notfälle und termine" }, []).some((b) => b.startsWith("Köder-Betreff")),
  "regelBefunde bleibt still bei ehrlichem Betreff");
check(regelBefunde({ ...basis, name: "PAVO Immobilien GmbH | Immobilienmakler Bochum", nische: "Hausverwaltung",
  betreff: "eure immobilienvermietung" }, []).some((b) => b.startsWith("Name passt nicht zur Nische")),
  "regelBefunde meldet den Nischen-Widerspruch");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
if (fehlgeschlagen > 0) process.exit(1);
