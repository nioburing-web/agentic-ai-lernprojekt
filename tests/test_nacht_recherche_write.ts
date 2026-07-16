// Tests für den Schreibpfad der Nacht-Recherche.
// Hintergrund: am 15.07.2026 landeten 30 fertige Drafts in R:AI statt A:I und waren
// für morgen-versand unsichtbar. Ursache war die Tabellen-Erkennung von values.append
// im Bereich A:R, die den Demo-ID-Block in R1:S1 als eigene Tabelle ansah.
//
// Ausführen: npx tsx tests/test_nacht_recherche_write.ts
// Braucht GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_SHEET_ID; legt einen temporären Tab an
// und räumt ihn wieder ab. Die Live-Queue wird nicht angefasst.

import "dotenv/config";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { letzteBelegteZeile, _test } from "../src/trigger/nacht-recherche";

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

// ── Reine Logik ───────────────────────────────────────────────────────────────
check(letzteBelegteZeile([]) === 0, "leeres Sheet → 0");
check(letzteBelegteZeile([["Typ"], ["EMAIL"]]) === 2, "zwei belegte Zeilen → 2");
check(
  letzteBelegteZeile([["Typ"], ["EMAIL"], ["", "", ""]]) === 2,
  "leere Zeile am Ende zählt nicht",
);
// Der Kern des Bugs: A leer, aber R belegt → Zeile ist belegt und darf nicht überschrieben werden.
const mitRSpalte: unknown[][] = [["Typ"], ["EMAIL"], []];
mitRSpalte[2]![17] = "e03ce1";
check(letzteBelegteZeile(mitRSpalte) === 3, "Zeile nur mit Wert in R gilt als belegt");

// ── Integration gegen echtes Sheet ────────────────────────────────────────────
const TEST_TAB = `ZZZ Test Write ${Date.now()}`;

(async () => {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = googleSheets({ version: "v4", auth });
  const sheetId = process.env.GOOGLE_SHEET_ID!;
  let tabId: number | undefined;

  try {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: TEST_TAB } } }] },
    });
    tabId = created.data.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined;

    // Exakt die Struktur nachbauen, die den Bug ausgelöst hat:
    // Header in A1:I1, separater Demo-Block in R1:S1, eine Datenzeile mit Demo-ID in R2.
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${TEST_TAB}!A1:I1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["Typ", "Name", "Stadt", "Kontakt", "Entwurf", "Status", "Erstellt", "Gesendet", "Betreff"]],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${TEST_TAB}!R1:S1`,
      valueInputOption: "RAW",
      requestBody: { values: [["Demo-ID", "Demo geklickt"]] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${TEST_TAB}!A2:R2`,
      valueInputOption: "RAW",
      requestBody: {
        values: [["EMAIL", "Bestandswerkstatt", "Hamburg", "alt@example.invalid", "alter Entwurf",
          "GESENDET", "14.07.2026", "15.07.2026", "betreff", "", "", "", "", "", "", "", "", "e03ce1"]],
      },
    });

    await _test.speichereDraft(
      sheets, sheetId, "EMAIL", "Testwerkstatt", "Stuttgart",
      "neu@example.invalid", "neuer Entwurf", "kurze frage", "abc123", TEST_TAB,
    );

    const zeile3 = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${TEST_TAB}!A3:R3`,
    });
    const werte = zeile3.data.values?.[0] ?? [];

    check(werte[0] === "EMAIL", `Draft landet in Spalte A (A3 = "${werte[0] ?? "LEER"}", erwartet "EMAIL")`);
    check(werte[1] === "Testwerkstatt", `Name landet in Spalte B (B3 = "${werte[1] ?? "LEER"}")`);
    check(werte[5] === "DRAFT", `Status DRAFT landet in Spalte F — nur so findet morgen-versand ihn (F3 = "${werte[5] ?? "LEER"}")`);
    check(werte[17] === "abc123", `Demo-ID landet in Spalte R (R3 = "${werte[17] ?? "LEER"}")`);

    // Nichts darf rechts von R stehen — dort landeten die verlorenen Zeilen.
    const rechts = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${TEST_TAB}!S3:AJ3`,
    });
    const rechtsWerte = (rechts.data.values?.[0] ?? []).filter(z => String(z ?? "").trim() !== "");
    check(rechtsWerte.length === 0, `keine Daten rechts von R (gefunden: ${JSON.stringify(rechtsWerte)})`);

    // Bestandszeile bleibt unangetastet
    const zeile2 = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${TEST_TAB}!A2:B2`,
    });
    check(zeile2.data.values?.[0]?.[1] === "Bestandswerkstatt", "Bestandszeile wurde nicht überschrieben");
  } finally {
    if (tabId !== undefined) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId: tabId } }] },
      });
      console.log(`(Test-Tab "${TEST_TAB}" wieder entfernt)`);
    }
  }

  console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
  process.exit(fehlgeschlagen === 0 ? 0 : 1);
})();
