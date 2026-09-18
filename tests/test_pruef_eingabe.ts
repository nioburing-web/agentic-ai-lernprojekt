// Tests für pruefEingabeAusZeile (18.09.2026).
// Kein Netzwerk: geprüft wird, dass Lesefassung und Freigabe-Runde dieselbe
// Eingabe an regelBefunde() geben — und damit dieselben Zeilen sperren.
// Ausführen: npx tsx tests/test_pruef_eingabe.ts
//
// Hintergrund: lesefassung.ts baute die Eingabe ohne `stadt`. Für einen
// Maps-Titel mit Ortszusatz meldete sie deshalb "Firmenname fehlt" und
// versteckte die Zeile, während freigabe-runde.ts sie freigegeben hätte.
// Die Mail wäre ungelesen rausgegangen.

import { pruefEingabeAusZeile, regelBefunde } from "../tools/freigabe-pruefung";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

// Sheet-Zeile nach Spaltenlayout der Outreach Queue: B Name, C Stadt, D Kontakt,
// E Entwurf, F Status, I Betreff, T Nische. Der Fall ist der vom 18.09.
const zeile: unknown[] = [];
zeile[1] = "DAHLER Karlsruhe | Baden-Baden - Finest Real Estate - Immobilienmakler";
zeile[2] = "Karlsruhe";
zeile[3] = "info@beispiel.invalid";
zeile[4] = "Guten Tag, DAHLER bietet eine beeindruckende Auswahl an Immobilien. Ich habe einen digitalen Assistenten entwickelt.";
zeile[5] = "PRUEFEN";
zeile[8] = "wie organisiert ihr die nachfragen?";
zeile[19] = "Immobilienmakler-Büro";

const eingabe = pruefEingabeAusZeile(zeile);

// ── Felder kommen aus den richtigen Spalten ────────────────────────────────
check(eingabe.name === zeile[1], "Name aus Spalte B");
check(eingabe.stadt === "Karlsruhe", "Stadt aus Spalte C — fehlte in der Lesefassung");
check(eingabe.entwurf === zeile[4], "Entwurf aus Spalte E");
check(eingabe.betreff === zeile[8], "Betreff aus Spalte I");
check(eingabe.nische === zeile[19], "Nische aus Spalte T");

// ── Die Stadt entscheidet über den Namensbefund ────────────────────────────
// Mit Stadt wird "DAHLER" als genannter Name erkannt. Ohne Stadt verlangt die
// Prüfung den rohen Titel samt Ortszusatz — genau die Abweichung vom 18.09.
const mitStadt = regelBefunde(eingabe, []);
const ohneStadt = regelBefunde({ ...eingabe, stadt: undefined }, []);
check(!mitStadt.includes("Firmenname fehlt im Entwurf"), "mit Stadt: kein Namensbefund");
check(
  ohneStadt.includes("Firmenname fehlt im Entwurf"),
  "ohne Stadt: Namensbefund — belegt, dass der alte Weg anders gesperrt hat"
);

// ── Leere Zellen werden zu leeren Strings, nicht zu "undefined" ────────────
const leer = pruefEingabeAusZeile([]);
check(
  leer.name === "" && leer.stadt === "" && leer.entwurf === "" && leer.betreff === "" && leer.nische === "",
  "fehlende Zellen ergeben leere Strings"
);

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
if (fehlgeschlagen > 0) process.exit(1);
