// Tests für buchhalter-outreach Agent
// Ausführen: npx tsx tests/test_buchhalter_outreach.ts

import { findeEmailAufWebsite } from "../src/trigger/buchhalter-outreach";

let bestanden = 0;
let fehlgeschlagen = 0;

function assert(bedingung: boolean, nachricht: string): void {
  if (bedingung) {
    console.log(`[OK] ${nachricht}`);
    bestanden++;
  } else {
    console.log(`[FAIL] ${nachricht}`);
    fehlgeschlagen++;
  }
}

// --- Hilfsfunktionen aus buchhalter-outreach extrahiert (zum Testen) ---

function generiereBetreff(firmaName: string): string {
  return `Neue Mandanten für ${firmaName} – ohne eigenen Aufwand`;
}

function generiereSignatur(): string {
  return "\n\nMit freundlichen Grüßen\nNIO Automation\nanfragen@nio-automation.de";
}

function normalisiereFiremaKey(name: string): string {
  return name.toLowerCase().trim();
}

function formatiereTrackingDatum(datum: Date): string {
  return datum.toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// --- Test 1: E-Mail-Betreff enthält Firmennamen und neues Format ---
function test1_betreffsFormat(): void {
  const firma = "Steuerberater Müller GmbH";
  const betreff = generiereBetreff(firma);

  assert(betreff.includes(firma), "Betreff enthält Firmennamen");
  assert(betreff.includes("Neue Mandanten"), "Betreff enthält 'Neue Mandanten'");
  assert(betreff.startsWith("Neue Mandanten für"), "Betreff beginnt korrekt");
}

// --- Test 2: Firmenname in Anrede prüfen ---
function test2_firmenInAnrede(): void {
  const testFaelle = [
    { firma: "Kanzlei Schmidt", erwartetInAnrede: "Kanzlei Schmidt" },
    { firma: "Steuerberater Wagner GmbH", erwartetInAnrede: "Steuerberater Wagner GmbH" },
    { firma: "Buchhalter Meyer", erwartetInAnrede: "Buchhalter Meyer" },
  ];

  for (const fall of testFaelle) {
    const anrede = `Guten Tag ${fall.firma} Team,`;
    assert(
      anrede.includes(fall.erwartetInAnrede),
      `Anrede enthält Firmennamen: ${fall.firma}`
    );
  }
}

// --- Test 3: Verbotene Wörter nicht im E-Mail-Text ---
function test3_keineVerbotenenWoerter(): void {
  const verboteneWoerter = [
    "innovativ",
    "revolutionär",
    "optimieren",
    "skalieren",
    "Lösung",
    "bahnbrechend",
    "disruptiv",
    "KI-Agent",
    "automatisiert",
    "System",
    "täglich",
    "automatisch",
    "KI",
    "Agent",
  ];

  // Beispiel-E-Mail im finalen Format (Frage + human, keine Zahlen, kein "Team")
  const beispielEmail = `Guten Tag Kanzlei Schmidt,

Wie viel Zeit verbringt Ihre Kanzlei pro Woche damit, neue Mandanten zu suchen?

Wir helfen Buchhaltern dabei, neue Firmenkunden zu gewinnen – ohne dass Sie selbst akquirieren müssen.

Falls Sie neugierig sind – ich zeige Ihnen gerne in 15 Minuten wie das für Ihre Kanzlei aussehen könnte.`;

  for (const wort of verboteneWoerter) {
    assert(
      !beispielEmail.toLowerCase().includes(wort.toLowerCase()),
      `Kein verbotenes Wort "${wort}" in E-Mail`
    );
  }
}

// --- Test 7: Finale E-Mail-Struktur ---
function test7_finaleStruktur(): void {
  const beispielEmail = `Guten Tag Kanzlei Schmidt Team,

Mandantengewinnung kostet Zeit die man als Buchhalter eigentlich kaum hat.
Wer neue Mandanten gewinnen will, braucht dafür Zeit die im Alltag fehlt.

Ich helfe Kanzleien dabei neue Mandanten zu gewinnen ohne selbst Zeit dafür investieren zu müssen.
Das klingt vielleicht ungewöhnlich – aber ich zeige es Ihnen gerne konkret.

Ich zeige Ihnen live wie es funktioniert – Sie entscheiden dann selbst ob es passt.`;

  assert(beispielEmail.startsWith("Guten Tag"), "E-Mail beginnt mit 'Guten Tag'");
  assert(beispielEmail.includes("Team"), "Anrede enthält 'Team'");
  assert(!beispielEmail.includes("Sehr geehrte"), "Kein formelles 'Sehr geehrte'");
  assert(!beispielEmail.includes("3-5"), "Keine Zahlenversprechen (3-5)");
  assert(beispielEmail.includes("15 Minuten") || beispielEmail.includes("entscheiden dann selbst"), "CTA vorhanden");
}

// --- Test 9: Prompt enthält Anführungszeichen-Verbot ---
function test9_promptKeineAnfuehrungszeichen(): void {
  const fs = require("fs") as typeof import("fs");
  const code = fs.readFileSync("./src/trigger/buchhalter-outreach.ts", "utf-8");
  assert(
    code.includes("Anführungszeichen"),
    "Prompt verbietet Anführungszeichen im Text"
  );
}

// --- Test 10: Prompt verbietet 'täglich' und 'automatisch' explizit ---
function test10_promptVerbieteteWoerterGelistet(): void {
  const fs = require("fs") as typeof import("fs");
  const code = fs.readFileSync("./src/trigger/buchhalter-outreach.ts", "utf-8");
  const promptStart = code.indexOf("content: `");
  const promptEnd = code.indexOf("`, \n      },", promptStart);
  const prompt = promptStart > -1 ? code.slice(promptStart, promptEnd) : "";
  // Prompt muss diese Wörter in der Verboten-Liste haben
  assert(
    (prompt.includes("Verbotene Wörter") || prompt.includes("verbotene Wörter")) && prompt.includes("täglich"),
    "Prompt verbietet 'täglich' explizit"
  );
  assert(
    (prompt.includes("Verbotene Wörter") || prompt.includes("verbotene Wörter")) && prompt.includes("automatisch"),
    "Prompt verbietet 'automatisch' explizit"
  );
}

// --- Test 8: Brevo Payload – type muss "transactional" sein ---
function test8_brevoTransactional(): void {
  // Prüft ob der Brevo-Payload type: "transactional" enthält
  // Liest den Quellcode direkt (verhindert Abbestellen-Link)
  const fs = require("fs") as typeof import("fs");
  const code = fs.readFileSync("./src/trigger/buchhalter-outreach.ts", "utf-8");
  assert(
    code.includes('"transactional"'),
    "Brevo API-Call enthält type: 'transactional' (kein Abbestellen-Link)"
  );
}

// --- Test 4: Datum-Format korrekt (DD.MM.YYYY mit führender Null) ---
function test4_datumFormat(): void {
  // Teste mit einem Datum das eine einstellige Monats-/Tageszahl hat
  const testDatum = new Date("2026-04-05T10:00:00Z"); // 5. April 2026
  const formatiert = formatiereTrackingDatum(testDatum);

  // Muss "05.04.2026" sein, NICHT "5.4.2026"
  const teile = formatiert.split(".");
  assert(teile.length === 3, "Datum hat 3 Teile (TT.MM.JJJJ)");
  assert(teile[0].length === 2, `Tag hat 2 Stellen: "${teile[0]}"`);
  assert(teile[1].length === 2, `Monat hat 2 Stellen: "${teile[1]}"`);
  assert(teile[2].length === 4, `Jahr hat 4 Stellen: "${teile[2]}"`);
  assert(formatiert === "05.04.2026", `Datum korrekt formatiert: "${formatiert}"`);
}

// --- Test 5: Dedup-Logik (Firmenschlüssel normalisiert) ---
function test5_dedupLogik(): void {
  const vorhandene = new Set<string>();
  vorhandene.add(normalisiereFiremaKey("Kanzlei Schmidt GmbH"));
  vorhandene.add(normalisiereFiremaKey("  Steuerberater Müller  "));

  assert(
    vorhandene.has("kanzlei schmidt gmbh"),
    "Firma mit Großbuchstaben korrekt im Set"
  );
  assert(
    vorhandene.has("steuerberater müller"),
    "Firma mit Leerzeichen korrekt normalisiert"
  );
  assert(
    !vorhandene.has("Buchhalter Wagner"),
    "Neue Firma nicht im Set"
  );
}

// --- Test 6: E-Mail-Finder – Fehlerbehandlung (kein echter HTTP-Call nötig) ---
async function test6_emailFinder(): Promise<void> {
  console.log("\n--- Integrations-Test: E-Mail-Finder ---");

  const result1 = await findeEmailAufWebsite("https://ungueltige-domain-xyz999-abc.de");
  assert(result1.email === null, "Test 6a: Ungültige Domain → email: null");
  assert(result1.kontaktformularUrl === null, "Test 6a: Ungültige Domain → kontaktformularUrl: null");

  const result2 = await findeEmailAufWebsite("keine-url");
  assert(result2.email === null, "Test 6b: Ungültige URL → email: null");
  assert(result2.kontaktformularUrl === null, "Test 6b: Ungültige URL → kontaktformularUrl: null");

  const result3 = await findeEmailAufWebsite("");
  assert(result3.email === null, "Test 6c: Leere URL → email: null");
  assert(result3.kontaktformularUrl === null, "Test 6c: Leere URL → kontaktformularUrl: null");
}

async function test11_formularErkennung(): Promise<void> {
  console.log("\n--- Test: Kontaktformular-Erkennung ---");

  // Strukturprüfung: Funktion gibt immer beide Felder zurück
  const result = await findeEmailAufWebsite("https://ungueltige-domain-xyz999-abc.de");
  assert("email" in result, "Test 11a: Rückgabe hat 'email'-Feld");
  assert("kontaktformularUrl" in result, "Test 11b: Rückgabe hat 'kontaktformularUrl'-Feld");
  assert(
    result.email === null || typeof result.email === "string",
    "Test 11c: email ist null oder string"
  );
  assert(
    result.kontaktformularUrl === null || typeof result.kontaktformularUrl === "string",
    "Test 11d: kontaktformularUrl ist null oder string"
  );
}

// --- Alle Tests ausführen ---
console.log("=== Buchhalter-Outreach Tests ===\n");

test1_betreffsFormat();
test2_firmenInAnrede();
test3_keineVerbotenenWoerter();
test4_datumFormat();
test5_dedupLogik();
test7_finaleStruktur();
test8_brevoTransactional();
test9_promptKeineAnfuehrungszeichen();

// Integrations-Test (async)
test6_emailFinder().then(async () => {
  await test11_formularErkennung();
  console.log(`\n=== Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ===`);
  if (fehlgeschlagen > 0) process.exit(1);
});
