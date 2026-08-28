// Tests für den Nachfass-Zähler.
// Ausfuehren: npx tsx tests/test_nachfass_zaehler.ts
//
// Warum es ihn gibt (28.08.2026): Im Fokus steht seit dem 23.08. der Satz
// "Ob die 60-%-Retry-Quote faellt, ist nachzuzaehlen, nicht zu vermuten."
// Nachgezaehlt wurde sie nie — weil Nachzaehlen hiess, einen 611-Zeilen-Trace
// im Dashboard von Hand durchzugehen. Eine Messung, die so teuer ist, findet
// nicht statt, und dann bleibt die Vermutung stehen.
//
// Also misst der Lauf sich selbst und gibt die Zahl im Output zurueck, dort wo
// der Health-Monitor ohnehin schon liest. Das ist derselbe Schritt wie am
// 25.08. beim Leerlauf: nicht besser hinsehen, sondern das Ergebnis
// zurueckgeben.

import {
  neuerNachfasszaehler,
  zaehleEntwurf,
  zaehleNachfass,
  nachfassBericht,
} from "../src/trigger/nachfass-zaehler";

let bestanden = 0;
let fehlgeschlagen = 0;
function gleich(ist: unknown, soll: unknown, nachricht: string): void {
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a === b) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}\n        ist : ${a}\n        soll: ${b}`); fehlgeschlagen++; }
}

// ─── Ausgangslage ────────────────────────────────────────────────────────────

{
  const z = neuerNachfasszaehler();
  gleich(nachfassBericht(z), { entwuerfe: 0, nachgefasst: 0, quote: 0, ausgeloest: {}, gescheitert: {} },
    "leerer Zaehler meldet Nullen und keine Quote aus einer Division durch 0");
}

// ─── Der echte Fall vom 20.08.: 18 Nachfaesser auf 30 Entwuerfe ──────────────

{
  const z = neuerNachfasszaehler();
  for (let i = 0; i < 30; i++) zaehleEntwurf(z);
  for (let i = 0; i < 18; i++) zaehleNachfass(z, "name", true);
  const b = nachfassBericht(z);
  gleich(b.quote, 0.6, "18 von 30 ergibt genau die 0,6 aus dem Befund vom 20.08.");
  gleich(b.nachgefasst, 18, "Gesamtzahl stimmt");
  gleich(b.ausgeloest, { name: 18 }, "nur die Gruende auftauchen, die wirklich vorkamen");
}

// ─── Mehrere Gruende am selben Entwurf ───────────────────────────────────────

{
  const z = neuerNachfasszaehler();
  zaehleEntwurf(z);
  zaehleNachfass(z, "name", true);
  zaehleNachfass(z, "hook", true);
  const b = nachfassBericht(z);
  gleich(b.nachgefasst, 2, "ein Entwurf kann mehrfach nachfassen — gezaehlt werden Aufrufe, nicht Entwuerfe");
  gleich(b.quote, 2, "die Quote darf ueber 1 gehen; sie misst Zusatzaufrufe je Entwurf");
}

// ─── Gescheiterte Nachfaesser getrennt fuehren ───────────────────────────────

{
  const z = neuerNachfasszaehler();
  for (let i = 0; i < 10; i++) zaehleEntwurf(z);
  zaehleNachfass(z, "hook", true);
  zaehleNachfass(z, "hook", false);
  zaehleNachfass(z, "einstieg", false);
  const b = nachfassBericht(z);
  gleich(b.ausgeloest, { hook: 2, einstieg: 1 }, "ausgeloest zaehlt jeden Nachfass, gelungen wie gescheitert");
  gleich(b.gescheitert, { hook: 1, einstieg: 1 },
    "gescheitert zaehlt nur die, die das Problem NICHT geloest haben — das ist die teure Sorte");
  gleich(b.quote, 0.3, "Quote rechnet mit allen ausgeloesten Nachfaessern");
}

// ─── Uebersprungene Leads verfaelschen die Quote nicht ───────────────────────

{
  // Ein Lead ohne genug Website-Text wird uebersprungen, BEVOR ein Entwurf
  // entsteht. Wuerde er als Entwurf zaehlen, saehe die Quote besser aus als sie
  // ist — genau die Art Verduennung wie bei den sieben toten Adressen am 20.08.
  const z = neuerNachfasszaehler();
  zaehleEntwurf(z);
  zaehleEntwurf(z);
  zaehleNachfass(z, "betreff", true);
  gleich(nachfassBericht(z).quote, 0.5, "nur erzeugte Entwuerfe sind der Nenner");
}

// ─── Rundung ─────────────────────────────────────────────────────────────────

{
  const z = neuerNachfasszaehler();
  for (let i = 0; i < 3; i++) zaehleEntwurf(z);
  zaehleNachfass(z, "name", true);
  gleich(nachfassBericht(z).quote, 0.33, "Quote auf zwei Stellen gerundet, damit der Output lesbar bleibt");
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
