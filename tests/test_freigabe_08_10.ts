// Tests für die Fehlerklassen aus der Freigabe-Runde vom 08.10.2026.
// Kein Netzwerk: geprüft werden die reinen Funktionen.
// Ausführen: npx tsx tests/test_freigabe_08_10.ts
//
// Hintergrund: 50 Entwürfe ohne Regel-Befund, 21 fielen beim Lesen durch. Zwei
// Muster davon sind am Wortlaut ablesbar:
//  1. Köder-Betreffe ohne Ich-Form ("ein tisch für freitagabend"). Die Regel vom
//     06.10. sah nur "mein/ich" und den fast wörtlichen Demo-Beispielsatz.
//  2. Der No-Show-Aufhänger bei Heilpraktikern (5 von 9). Die Demo erinnert an
//     nichts, die Mail verspricht also etwas, das der Link nicht zeigt. Die Ursache
//     war der Hook in nischen.ts selbst — der Test unten hält ihn sauber.
// Jeder Fall ist eine echte Zeile aus der Runde.

import { betreffIstKoeder, noShowAufhaenger } from "../src/trigger/entwurf-qualitaet";
import { regelBefunde, beispielZurNische, hookZurNische } from "../tools/freigabe-pruefung";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

// ── Köder-Betreff: Buchungsgegenstand plus Zeitpunkt ───────────────────────
const KOEDER: Array<[string, string]> = [
  ["ein tisch im medivino am freitag", "Restaurant"],    // 2175
  ["ein tisch für freitagabend", "Restaurant"],          // 2180
  ["wann passt die nächste fahrstunde?", "Fahrschule"],  // 2187
];
for (const [betreff, nische] of KOEDER) {
  check(betreffIstKoeder(betreff, beispielZurNische(nische)) !== null, `Köder erkannt: "${betreff}"`);
}

// Alle 29 freigegebenen Betreffe der Runde plus die ehrlichen unter den
// verworfenen. Dürfen nicht anschlagen.
const EHRLICH: Array<[string, string]> = [
  ["balayage in bochum", "Friseursalon"],
  ["bleibt beim schneiden alles ruhig?", "Friseursalon"],
  ["airtouch für sonnengeküsste strähnen", "Friseursalon"],
  ["friseur mitten in bochums innenstadt", "Friseursalon"],
  ["glossing für strähnen", "Friseursalon"],
  ["wie laufen neue termine im salon?", "Friseursalon"],
  ["pflege mit newsha und joico", "Friseursalon"],
  ["frisuren für besondere anlässe", "Friseursalon"],
  ["bleibt während des schneidens alles ruhig?", "Friseursalon"],
  ["krankengymnastik und trainingstherapie", "Physiotherapie-Praxis"],
  ["heilpraktikerin in vohwinkel", "Heilpraktiker-Praxis"],
  ["abnehmen ohne diät", "Heilpraktiker-Praxis"],
  ["über 30 jahre in bochum", "Heilpraktiker-Praxis"],
  ["zahnmedizin für groß und klein", "Zahnarztpraxis"],
  ["zahnheilkunde für kleintiere", "Tierarztpraxis"],
  ["frühstück über bielefeld", "Restaurant"],
  ["halal essen am meierteich", "Restaurant"],
  ["gute stunden in der bielefelder altstadt", "Restaurant"],
  ["mediterrane küche im scarabaé", "Restaurant"],
  ["wann kommen reservierungen rein?", "Restaurant"],
  ["gutscheine zum selbstausdrucken", "Restaurant"],
  ["fabelhafte küche in bielefeld", "Restaurant"],
  ["schnitzel und pasta am freitag", "Restaurant"],
  ["bleibt zwischen mittag und abend luft?", "Restaurant"],
  ["führerscheinklassen bei fahrwerk", "Fahrschule"],
  ["fahrenlernen in bielefeld", "Fahrschule"],
  ["auffrischungsstunden fürs sichere fahren", "Fahrschule"],
  ["wer beantwortet fragen zwischen den stunden?", "Fahrschule"],
  ["erste hilfe und führerschein", "Fahrschule"],
  ["fahrschule rückenwind in bielefeld", "Fahrschule"],
  ["lkw-führerschein bei zöllner", "Fahrschule"],
  ["führerschein in wenigen wochen", "Fahrschule"],
  ["seit jahrzehnten in bielefeld", "Fahrschule"],
  ["intensivkurs für wohnmobile", "Fahrschule"],
];
for (const [betreff, nische] of EHRLICH) {
  check(betreffIstKoeder(betreff, beispielZurNische(nische)) === null, `kein Köder: "${betreff}"`);
}

// ── No-Show-Aufhänger: die Demo erinnert an nichts ─────────────────────────
const NO_SHOW: Array<[string, string]> = [
  ["2159", "Wenn jemand einen Termin vergisst, ist die dafür reservierte Zeit meist nicht mehr anderweitig zu vergeben."],
  ["2161", "Wenn jemand einen Termin vergisst, fehlt schnell eine ganze 50-Minuten-Stunde, die nicht bezahlt wird."],
  ["2162", "Wenn jemand den Termin vergisst, fehlt eine bezahlte Stunde im Praxisalltag."],
  ["2163", "Wenn jemand einen Termin vergisst, ist die Stunde für euch meist unbezahlt."],
  ["2164", "Wenn Patienten eine Erinnerung fehlt, bleiben Termine manchmal leer – und die Stunde ist nicht bezahlt."],
  ["Hook", "Ohne Erinnerung erscheint ein Teil der Patienten nicht zum Termin — jeder Ausfall ist eine Stunde, die niemand bezahlt."],
];
for (const [zeile, satz] of NO_SHOW) {
  check(noShowAufhaenger(`Hey, bei der Praxis X gibt's Akupunktur. ${satz} Ich bin Nio.`) !== null, `No-Show erkannt (${zeile})`);
}
// Freigegebene Sätze mit Termin/Stunde/Antwort dürfen nicht anschlagen.
for (const satz of [
  "Wenn Antworten auf Anfragen länger dauern, wenden sich manche Patienten einfach an eine andere Praxis.",
  "Wenn kurzfristig Fahrstunden verschoben werden, kostet das Hin und Her über Telefon und WhatsApp Zeit.",
  "Gleichzeitig klingelt vielleicht gerade, wenn jemand im Stuhl sitzt: rangehen unterbricht den Termin.",
  "Auffrischungsstunden an, wenn man länger nicht gefahren ist.",
  "Keine Anmeldung, es passiert nichts und niemand meldet sich deswegen.",
]) {
  check(noShowAufhaenger(satz) === null, `kein No-Show: "${satz.slice(0, 50)}…"`);
}

// Die Quelle: kein Nischen-Hook darf selbst den No-Show-Aufhänger tragen.
const hp = hookZurNische("Heilpraktiker-Praxis");
check(hp !== null && noShowAufhaenger(hp) === null, "Heilpraktiker-Hook verspricht keine Erinnerung");

// ── Verdrahtung ────────────────────────────────────────────────────────────
const basis = {
  name: "Naturheilpraxis Obermeier",
  stadt: "Bochum",
  entwurf: "Hey, bei der Naturheilpraxis Obermeier gehören Akupunktur und Osteopathie zum Angebot. Wenn jemand einen Termin vergisst, ist die Zeit weg. Ich bin Nio. https://demo.nio-automation.de/a/070ff3 Wäre das einen Blick wert?",
  betreff: "über 30 jahre in bochum",
  nische: "Heilpraktiker-Praxis",
};
check(regelBefunde(basis, []).some((b) => b.startsWith("No-Show-Aufhänger")), "regelBefunde meldet den No-Show-Aufhänger");
check(regelBefunde({ ...basis, nische: "Restaurant", betreff: "ein tisch für freitagabend" }, [])
  .some((b) => b.startsWith("Köder-Betreff")), "regelBefunde meldet den Köder ohne Ich-Form");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
if (fehlgeschlagen > 0) process.exit(1);
