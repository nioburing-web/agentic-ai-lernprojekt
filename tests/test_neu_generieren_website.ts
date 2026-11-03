// Tests für die Website-Quelle von tools/neu-generieren.ts (03.11.2026).
// Kein Netzwerk.
// Ausführen: npx tsx tests/test_neu_generieren_website.ts
//
// Hintergrund: neu-generieren holt den Website-Text über die Domain der
// E-Mail-Adresse. Bei Freemail-Adressen ist das die Startseite des Anbieters.
// Am 03.11. schrieb das Modell deshalb in vier Entwürfen über "die Gmail-
// Anmeldeseite" oder "GMX-Schlagzeilen statt Praxisinfos" — kein Regelbefund
// fing das, erst die Fit-Lesung. Alle vier wurden verworfen.

import { websiteAusEmail } from "../tools/freigabe-pruefung";
import { istFreemailDomain } from "../src/trigger/nacht-recherche";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

// Die vier Fälle vom 03.11. (Adressen anonymisiert, Domains echt).
for (const adresse of ["restaurant@gmail.com", "praxis@gmx.de", "praxis@web.de", "verein@gmail.com"]) {
  check(websiteAusEmail(adresse) === null, `Freemail liefert keine Website: ${adresse.split("@")[1]}`);
}
check(websiteAusEmail("Info@T-Online.de") === null, "Groß/klein egal");
check(websiteAusEmail("info@googlemail.com") === null, "googlemail zählt mit");

// Eigene Domain bleibt die Quelle.
check(websiteAusEmail("info@fahrschule-liah.de") === "https://fahrschule-liah.de", "eigene Domain wird Website");
check(websiteAusEmail("ohne-at") === null, "kaputte Adresse liefert nichts");

// Dieselbe Liste wie die Domain-Prüfung im Erzeuger, keine zweite.
check(istFreemailDomain("gmx.net") && !istFreemailDomain("gmx-praxis.de"), "istFreemailDomain trifft nur echte Anbieter");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen ? 1 : 0);
