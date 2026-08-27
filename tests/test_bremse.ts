// Tests für die Bremse der Nacht-Recherche (Befund 27.08.2026).
// Kein Netzwerk: der Sheets-Client wird durch einen Stub ersetzt.
// Ausführen: npx tsx tests/test_bremse.ts
//
// Hintergrund: Solange die Kategorien PRUEFEN schreiben, muss ein Mensch
// freigeben. Am 26.08. lagen 60 ungelesene Entwürfe in der Queue — und der Lauf
// legte für 2-3 EUR Maps- und LLM-Kosten 30 weitere dazu. Der teuerste Schritt
// der Pipeline produzierte Nachschub für einen Stapel, der liegen blieb.

import { zaehleOffenePruefungen, PRUEFEN_OBERGRENZE } from "../src/trigger/nacht-recherche";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

// Minimaler Stub: liefert genau das, was zaehleOffenePruefungen liest — Spalte F.
function stubMitStatus(status: string[]): any {
  return {
    spreadsheets: {
      values: {
        get: async ({ range }: { range: string }) => {
          check(range.endsWith("!F:F"), `liest nur Spalte F, nicht das ganze Blatt (${range})`);
          return { data: { values: [["Status"], ...status.map((s) => [s])] } };
        },
      },
    },
  };
}

async function main(): Promise<void> {
  check(PRUEFEN_OBERGRENZE === 60, "Grenze steht auf zwei vollen Versandtagen (2 x 30)");

  const leer = await zaehleOffenePruefungen(stubMitStatus([]), "x");
  check(leer === 0, "leere Queue → 0 offene Prüfungen");

  const gemischt = await zaehleOffenePruefungen(
    stubMitStatus(["GESENDET", "PRUEFEN", "DRAFT", "PRUEFEN", "VERWORFEN", "NACHGEFASST_1"]),
    "x",
  );
  check(gemischt === 2, "zählt nur PRUEFEN, nicht DRAFT/GESENDET/VERWORFEN");

  // Der Header darf nicht mitgezählt werden — sonst bremst eine Queue, in der
  // zufällig "PRUEFEN" in der Kopfzeile steht.
  const nurHeader = await zaehleOffenePruefungen(stubMitStatus([]), "x");
  check(nurHeader === 0, "Kopfzeile wird übersprungen");

  const mitLeerzeichen = await zaehleOffenePruefungen(stubMitStatus([" PRUEFEN ", "PRUEFEN"]), "x");
  check(mitLeerzeichen === 2, "Leerzeichen um den Status werden getrimmt");

  // Die Entscheidung selbst: die Grenze ist ein "größer als", kein "größer gleich".
  // Genau 60 offene Zeilen sind noch zwei volle Versandtage, also kein Stau.
  check(!(60 > PRUEFEN_OBERGRENZE), "genau 60 offene Zeilen bremsen NICHT");
  check(61 > PRUEFEN_OBERGRENZE, "61 offene Zeilen bremsen");

  console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
  process.exit(fehlgeschlagen > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
