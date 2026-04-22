// Tests für reply-classifier Agent
// Ausführen: npx tsx tests/test_reply_classifier.ts

import {
  parseKlassifizierung,
  extrahiereFirmaAusBetreff,
  extrahiereTextAusBody,
} from "../src/trigger/reply-classifier";

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

// --- Test 1: INTERESSIERT korrekt erkannt ---
function test1_interessiert(): void {
  const response = "INTERESSIERT|Empfänger zeigt Interesse und fragt nach einem Termin.";
  const result = parseKlassifizierung(response);

  assert(result.kategorie === "INTERESSIERT", "Test 1: Kategorie ist INTERESSIERT");
  assert(result.grund.length > 0, "Test 1: Grund ist nicht leer");
  assert(result.grund.includes("Interesse"), "Test 1: Grund enthält 'Interesse'");
}

// --- Test 2: ABGELEHNT korrekt erkannt ---
function test2_abgelehnt(): void {
  const response = "ABGELEHNT|Explizite Ablehnung mit 'kein Interesse'.";
  const result = parseKlassifizierung(response);

  assert(result.kategorie === "ABGELEHNT", "Test 2: Kategorie ist ABGELEHNT");
  assert(result.grund.length > 0, "Test 2: Grund ist nicht leer");
}

// --- Test 3: ABWESEND korrekt erkannt ---
function test3_abwesend(): void {
  const response = "ABWESEND|Out-of-office-Meldung mit Urlaubsangabe bis Ende April.";
  const result = parseKlassifizierung(response);

  assert(result.kategorie === "ABWESEND", "Test 3: Kategorie ist ABWESEND");
  assert(result.grund.length > 0, "Test 3: Grund ist nicht leer");
}

// --- Test 4: Unklare E-Mail → RÜCKFRAGE ---
function test4_rueckfrage(): void {
  const response = "RÜCKFRAGE|Empfänger fragt nach Kosten und Details des Angebots.";
  const result = parseKlassifizierung(response);

  assert(result.kategorie === "RÜCKFRAGE", "Test 4: Kategorie ist RÜCKFRAGE");
  assert(result.grund.length > 0, "Test 4: Grund ist nicht leer");
}

// --- Test 4b: Ungültige OpenAI-Antwort → Fallback RÜCKFRAGE ---
function test4b_fallback(): void {
  const result = parseKlassifizierung("UNBEKANNT|Irgendwas");

  assert(result.kategorie === "RÜCKFRAGE", "Test 4b: Ungültige Kategorie fällt auf RÜCKFRAGE zurück");
  assert(result.grund.includes("Unbekannte Kategorie"), "Test 4b: Fallback-Grund erklärt das Problem");
}

// --- Test 5: Firma-Extraktion aus Betreff ---
function test5_firmaExtraktion(): void {
  const f1 = extrahiereFirmaAusBetreff(
    "Re: KI-Agent für neue Mandanten – Steuerberater Wagner GmbH"
  );
  assert(f1 === "Steuerberater Wagner GmbH", `Test 5a: Firma korrekt extrahiert: "${f1}"`);

  const f2 = extrahiereFirmaAusBetreff(
    "Re: KI-Agent für neue Mandanten - Kanzlei Müller & Partner"
  );
  assert(
    f2 === "Kanzlei Müller & Partner",
    `Test 5b: Firma mit Bindestrich extrahiert: "${f2}"`
  );

  const f3 = extrahiereFirmaAusBetreff("Re: anderer Betreff ohne Muster");
  assert(f3 === null, `Test 5c: Kein Match → null: "${f3}"`);

  const f4 = extrahiereFirmaAusBetreff("Fw: KI-Agent für neue Mandanten – Buchhalter Schmidt");
  assert(f4 === "Buchhalter Schmidt", `Test 5d: Ohne 'Re:' auch extrahierbar: "${f4}"`);
}

// --- Test 6: Text-Extraktion aus E-Mail Body ---
function test6_bodyExtraktion(): void {
  const rawEmail = [
    "From: test@example.com",
    "Subject: Re: Test",
    "Content-Type: text/plain",
    "",
    "Guten Tag,",
    "",
    "ja, das klingt interessant! Gerne mehr erfahren.",
    "",
    "> Original-Nachricht:",
    "> Text der ursprünglichen E-Mail",
    "",
  ].join("\r\n");

  const body = extrahiereTextAusBody(rawEmail);

  assert(body.includes("klingt interessant"), "Test 6a: Relevanter Text im Body enthalten");
  assert(!body.includes("Original-Nachricht"), "Test 6b: Zitierter Text wird entfernt");
  assert(body.length <= 1000, "Test 6c: Body auf 1000 Zeichen begrenzt");
}

// --- Alle Tests ausführen ---
console.log("=== Reply-Classifier Tests ===\n");

test1_interessiert();
test2_abgelehnt();
test3_abwesend();
test4_rueckfrage();
test4b_fallback();
test5_firmaExtraktion();
test6_bodyExtraktion();

console.log(
  `\n=== Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ===`
);
if (fehlgeschlagen > 0) process.exit(1);
