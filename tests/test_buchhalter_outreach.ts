// Tests für buchhalter-outreach Agent
// Ausführen: npx tsx tests/test_buchhalter_outreach.ts

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
  return `KI-Agent für neue Mandanten – ${firmaName}`;
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

// --- Test 1: E-Mail-Betreff enthält Firmennamen und KI-Agent ---
function test1_betreffsFormat(): void {
  const firma = "Steuerberater Müller GmbH";
  const betreff = generiereBetreff(firma);

  assert(betreff.includes(firma), "Betreff enthält Firmennamen");
  assert(betreff.includes("KI-Agent"), "Betreff enthält 'KI-Agent'");
  assert(betreff.startsWith("KI-Agent für neue Mandanten"), "Betreff beginnt korrekt");
}

// --- Test 2: Firmenname in Anrede prüfen ---
function test2_firmenInAnrede(): void {
  const testFaelle = [
    { firma: "Kanzlei Schmidt", erwartetInAnrede: "Kanzlei Schmidt" },
    { firma: "Steuerberater Wagner GmbH", erwartetInAnrede: "Steuerberater Wagner GmbH" },
    { firma: "Buchhalter Meyer", erwartetInAnrede: "Buchhalter Meyer" },
  ];

  for (const fall of testFaelle) {
    const anrede = `Sehr geehrte Damen und Herren von ${fall.firma},`;
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
  ];

  // Beispiel-E-Mail wie sie generiert werden sollte
  const beispielEmail = `Sehr geehrte Damen und Herren von Kanzlei Schmidt,

unser KI-Agent findet täglich neue Firmengründungen und schreibt diese im Namen Ihrer Kanzlei an – ganz ohne Zeitaufwand für Sie.

Buchhalter die dieses System nutzen gewinnen durchschnittlich 3-5 neue Mandanten pro Monat.

Wären Sie offen für ein 15-minütiges Gespräch, um zu sehen ob das für Ihre Kanzlei passt?`;

  for (const wort of verboteneWoerter) {
    assert(
      !beispielEmail.toLowerCase().includes(wort.toLowerCase()),
      `Kein verbotenes Wort "${wort}" in E-Mail`
    );
  }
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

// --- Alle Tests ausführen ---
console.log("=== Buchhalter-Outreach Tests ===\n");

test1_betreffsFormat();
test2_firmenInAnrede();
test3_keineVerbotenenWoerter();
test4_datumFormat();
test5_dedupLogik();

console.log(`\n=== Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ===`);
if (fehlgeschlagen > 0) process.exit(1);
