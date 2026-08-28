// Tests für reply-classifier Agent
// Ausführen: npx tsx tests/test_reply_classifier.ts

import {
  parseKlassifizierung,
  extrahiereFirmaAusBetreff,
  extrahiereTextAusBody,
  parseEntscheidung,
  entscheideAktion,
  findeLeadRow,
  baueReBetreff,
  extrahiereMessageId,
  waehleLernbeispiele,
  formatiereLernbeispiele,
  zuHarvestendeZeilen,
  baueSystemPrompt,
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
  const f1 = extrahiereFirmaAusBetreff("Re: Kurze Frage, Steuerberater Wagner GmbH");
  assert(f1 === "Steuerberater Wagner GmbH", `Test 5a: Firma korrekt extrahiert: "${f1}"`);

  const f2 = extrahiereFirmaAusBetreff("AW: Kurze Frage, Kanzlei Müller & Partner");
  assert(
    f2 === "Kanzlei Müller & Partner",
    `Test 5b: Firma aus AW-Betreff extrahiert: "${f2}"`
  );

  const f3 = extrahiereFirmaAusBetreff("Re: anderer Betreff ohne Muster");
  assert(f3 === null, `Test 5c: Kein Match → null: "${f3}"`);

  const f4 = extrahiereFirmaAusBetreff("Fwd: Kurze Frage, Buchhalter Schmidt");
  assert(f4 === "Buchhalter Schmidt", `Test 5d: Fwd-Präfix auch extrahierbar: "${f4}"`);
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

// --- Test 7: parseEntscheidung liest sauberes JSON ---
function test7_entscheidungJson(): void {
  const r = parseEntscheidung(
    '{"kategorie":"INTERESSIERT","confidence":92,"grund":"Lead will Termin","antwort":"Gerne, hier mein Link"}'
  );
  assert(r.kategorie === "INTERESSIERT", "Test 7a: Kategorie INTERESSIERT");
  assert(r.confidence === 92, "Test 7b: confidence = 92");
  assert(r.antwort.includes("Link"), "Test 7c: antwort übernommen");
}

// --- Test 7b: JSON in Code-Fences + confidence-Clamping ---
function test7b_entscheidungRobust(): void {
  const r = parseEntscheidung('```json\n{"kategorie":"RÜCKFRAGE","confidence":150,"grund":"x","antwort":"y"}\n```');
  assert(r.kategorie === "RÜCKFRAGE", "Test 7b-1: Kategorie aus Code-Fence gelesen");
  assert(r.confidence === 100, "Test 7b-2: confidence auf 100 geclampt");

  const kaputt = parseEntscheidung("kein json hier");
  assert(kaputt.kategorie === "RÜCKFRAGE", "Test 7b-3: Murks → sicherer Fallback RÜCKFRAGE");
  assert(kaputt.confidence === 0, "Test 7b-4: Fallback confidence = 0 (kein Auto-Versand)");
}

// --- Test 8: entscheideAktion respektiert den Korridor ---
function test8_korridor(): void {
  const base = { grund: "x", antwort: "y" };
  assert(
    entscheideAktion({ ...base, kategorie: "INTERESSIERT", confidence: 90 }) === "CALENDLY_SENDEN",
    "Test 8a: INTERESSIERT 90% → Calendly selbst senden"
  );
  assert(
    entscheideAktion({ ...base, kategorie: "INTERESSIERT", confidence: 89 }) === "ENTWURF",
    "Test 8b: INTERESSIERT 89% → nur Entwurf (unter Schwelle)"
  );
  assert(
    entscheideAktion({ ...base, kategorie: "RÜCKFRAGE", confidence: 99 }) === "ENTWURF",
    "Test 8c: RÜCKFRAGE immer Entwurf, egal wie sicher"
  );
  assert(
    entscheideAktion({ ...base, kategorie: "ABGELEHNT", confidence: 99 }) === "NUR_STATUS",
    "Test 8d: ABGELEHNT → nur Status, kein Kontakt"
  );
  assert(
    entscheideAktion({ ...base, kategorie: "ABWESEND", confidence: 50 }) === "NUR_STATUS",
    "Test 8e: ABWESEND → nur Status"
  );
}

// --- Test 9: Lead-Lookup über Outreach Queue ---
function test9_leadLookup(): void {
  const rows = [
    ["Typ", "Name", "Stadt", "Kontakt", "Entwurf", "Status"],
    ["EMAIL", "KFZ Klinik", "München", "info@kfz-klinik.de", "...", "GESENDET"],
  ];
  const treffer = findeLeadRow(rows, "INFO@KFZ-KLINIK.DE");
  assert(treffer?.name === "KFZ Klinik", "Test 9a: Lead case-insensitiv gefunden");
  assert(treffer?.rowNumber === 2, "Test 9b: rowNumber 1-basiert korrekt");
  assert(findeLeadRow(rows, "fremd@example.com") === null, "Test 9c: Unbekannter Sender → null");
}

// --- Test 10: Re-Betreff & Message-ID ---
function test10_betreffUndMessageId(): void {
  assert(baueReBetreff("Kurze Frage, KFZ Klinik") === "Re: Kurze Frage, KFZ Klinik", "Test 10a: Re: gesetzt");
  assert(baueReBetreff("AW: Re: Test") === "Re: Test", "Test 10b: Mehrfach-Präfixe entfernt, genau ein Re:");

  const raw = "From: a@b.de\r\nMessage-ID: <abc123@mail>\r\nSubject: x\r\n\r\nText";
  assert(extrahiereMessageId(raw) === "<abc123@mail>", "Test 10c: Message-ID aus Header extrahiert");
  assert(extrahiereMessageId("kein header") === null, "Test 10d: Keine Message-ID → null");
}

// --- Test 11: waehleLernbeispiele nimmt letzte N, ausgewogen ---
function test11_waehleAusgewogen(): void {
  const mk = (kat: string, id: string) => ({
    datum: "", leadEmail: id + "@x.de", emailAuszug: id, agentKategorie: "X",
    richtigKategorie: kat, agentAntwort: "", deineAntwort: "",
  });
  // chronologisch (ältestes oben): 4x INTERESSIERT, 1x ABGELEHNT
  const alle = [
    mk("INTERESSIERT", "i1"), mk("INTERESSIERT", "i2"), mk("ABGELEHNT", "a1"),
    mk("INTERESSIERT", "i3"), mk("INTERESSIERT", "i4"),
  ];
  const sel = waehleLernbeispiele(alle, 3);
  assert(sel.length === 3, "Test 11a: genau 3 gewählt");
  assert(sel.some((b) => b.richtigKategorie === "ABGELEHNT"), "Test 11b: Minderheits-Kategorie ABGELEHNT trotzdem dabei");
  assert(sel[0]!.emailAuszug === "i4", "Test 11c: neuestes Beispiel zuerst");
  assert(waehleLernbeispiele(alle, 0).length === 0, "Test 11d: n=0 → leer");
  assert(waehleLernbeispiele([], 5).length === 0, "Test 11e: leere Eingabe → leer");
}

// --- Test 12: formatiereLernbeispiele baut Few-Shot-Block ---
function test12_formatiere(): void {
  assert(formatiereLernbeispiele([]) === "", "Test 12a: leer → leerer String");
  const b = {
    datum: "", leadEmail: "x@y.de", emailAuszug: "Was kostet das?",
    agentKategorie: "ABGELEHNT", richtigKategorie: "RÜCKFRAGE",
    agentAntwort: "", deineAntwort: "Gerne erkläre ich das im Gespräch.",
  };
  const out = formatiereLernbeispiele([b]);
  assert(out.includes("RÜCKFRAGE"), "Test 12b: enthält richtige Kategorie");
  assert(out.includes("ABGELEHNT"), "Test 12c: enthält Agent-Fehler");
  assert(out.includes("Gerne erkläre"), "Test 12d: enthält Nios Antworttext");
  const ohneAntwort = formatiereLernbeispiele([{ ...b, deineAntwort: "" }]);
  assert(!ohneAntwort.includes("bevorzugte Antwort"), "Test 12e: ohne Antwort keine Antwort-Zeile");
}

// --- Test 13: zuHarvestendeZeilen erkennt korrigierte, noch nicht gelernte Zeilen ---
function test13_harvest(): void {
  const mkRow = (over: Record<number, string>) => {
    const r = new Array(16).fill("");
    for (const k in over) r[+k] = over[k];
    return r;
  };
  const header = new Array(16).fill("");
  const r1 = mkRow({ 3: "a@b.de", 10: "Was kostet das?", 11: "ABGELEHNT", 12: "...", 13: "RÜCKFRAGE" }); // N gefüllt → harvest
  const r2 = mkRow({ 3: "c@d.de", 13: "INTERESSIERT", 15: "GELERNT" }); // schon gelernt → ignorieren
  const r3 = mkRow({ 3: "e@f.de", 11: "INTERESSIERT" }); // kein Feedback → ignorieren
  const r4 = mkRow({ 3: "g@h.de", 10: "Ja gerne", 11: "INTERESSIERT", 14: "Mein umformulierter Text" }); // nur O → harvest

  const out = zuHarvestendeZeilen([header, r1, r2, r3, r4]);
  assert(out.length === 2, "Test 13a: genau 2 Zeilen zum Harvesten");
  assert(out[0]!.rowNumber === 2, "Test 13b: rowNumber 1-basiert (erste Datenzeile = 2)");
  assert(out[0]!.beispiel.richtigKategorie === "RÜCKFRAGE", "Test 13c: richtige Kategorie aus Spalte N");
  const r4out = out.find((o) => o.beispiel.leadEmail === "g@h.de")!;
  assert(r4out.beispiel.richtigKategorie === "INTERESSIERT", "Test 13d: nur O gefüllt → Kategorie fällt auf Agent-Wert (L)");
  assert(r4out.beispiel.deineAntwort.includes("umformuliert"), "Test 13e: Nios Antwort übernommen");
}

// --- Test 14: baueSystemPrompt hängt Few-Shot an, Basis bleibt ---
function test14_systemPrompt(): void {
  const mit = baueSystemPrompt("MEINE-BEISPIELE");
  assert(mit.includes("MEINE-BEISPIELE"), "Test 14a: Few-Shot im Prompt enthalten");
  assert(mit.includes("Reply-Agent"), "Test 14b: Basis-Prompt bleibt erhalten");
  const ohne = baueSystemPrompt("");
  assert(!ohne.includes("MEINE-BEISPIELE"), "Test 14c: leer → kein Few-Shot");
  assert(ohne.includes("Reply-Agent"), "Test 14d: Basis-Prompt auch ohne Few-Shot");
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
test7_entscheidungJson();
test7b_entscheidungRobust();
test8_korridor();
test9_leadLookup();
test10_betreffUndMessageId();
test11_waehleAusgewogen();
test12_formatiere();
test13_harvest();
test14_systemPrompt();

console.log(
  `\n=== Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ===`
);
if (fehlgeschlagen > 0) process.exit(1);
