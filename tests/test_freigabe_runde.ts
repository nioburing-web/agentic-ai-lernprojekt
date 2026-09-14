// Tests für die Mangel-Prüfung der Freigabe-Runde (Befund 08.09.2026).
// Kein Netzwerk: geprüft werden die reinen Funktionen, nicht der Sheet-Zugriff.
// Ausführen: npx tsx tests/test_freigabe_runde.ts
//
// Hintergrund: nacht-recherche schreibt den Mangel — "Regel riss auch im
// 2. Versuch" — nur ins Run-Log, nie ins Sheet. freigabe-runde.ts konnte ihn
// deshalb nicht sehen und meldete am 08.09.2026 null Befunde bei 60 Zeilen, von
// denen 23 einen hatten. Ein `--freigeben` hätte 11 Mails mit wörtlich
// abgeschriebenem Branchen-Hook an Tierarztpraxen derselben Stadt geschickt.

import { regelBefunde, hookZurNische, gesperrteZeilen, zeilenAusArgument } from "../tools/freigabe-pruefung";
import type { Befund } from "../tools/freigabe-pruefung";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

const HOOK_TIERARZT =
  "Viele Tierbesitzer rufen abends oder am Wochenende an und erreichen niemanden — die erste Praxis, die reagiert, bekommt den Termin.";

function zeile(over: Partial<{ name: string; entwurf: string; betreff: string; nische: string }> = {}) {
  return {
    name: "Kleintierpraxis Berg",
    entwurf:
      "Hey, wenn bei der Kleintierpraxis Berg abends noch Anrufe reinkommen, sitzt selten jemand am Apparat. " +
      "Ich bin Nio und baue digitale Assistenten. Probiert ihn aus: https://demo.nio-automation.de/a/abc123 " +
      "Wäre das einen Blick wert?",
    betreff: "wie plant ihr eure termine?",
    nische: "Tierarztpraxis",
    ...over,
  };
}

// ── hookZurNische ──────────────────────────────────────────────────────────
check(hookZurNische("Tierarztpraxis") === HOOK_TIERARZT, "findet den Hook zur bekannten Nische");
check(hookZurNische("Raumfahrtbetrieb") === null, "unbekannte Nische → null");
check(hookZurNische("") === null, "leerer Nischenname → null");

// ── sauberer Entwurf ───────────────────────────────────────────────────────
check(regelBefunde(zeile(), []).length === 0, "regelkonformer Entwurf hat keinen Befund");

// ── Firmenname ─────────────────────────────────────────────────────────────
const ohneNamen = regelBefunde(
  zeile({ entwurf: "Hey, wenn bei euch abends Anrufe reinkommen, sitzt selten jemand am Apparat. Wäre das einen Blick wert?" }),
  []
);
check(ohneNamen.some((b) => b.includes("Firmenname")), "fehlender Firmenname wird gemeldet");

// Freigabe-Runde 14.09.2026: Spalte B trägt den rohen Maps-Titel. Die Prüfung
// verlangte bis dahin dessen längstes Wort — hier "haftungsbeschränkt" —, also
// genau die Rechtsform, die im Satz nichts zu suchen hat.
const mitRechtsform = regelBefunde(
  {
    ...zeile(),
    name: "Fahrschule Tiger UG (haftungsbeschränkt)",
    stadt: "Nürnberg",
    nische: "Fahrschule",
    entwurf: "Hey, bei der Fahrschule Tiger gibt es Theorie am Abend. Probiert ihn aus: https://demo.nio-automation.de/a/abc123 Wäre das einen Blick wert?",
  },
  []
);
check(!mitRechtsform.some((b) => b.includes("Firmenname")), "bereinigter Name im Text reicht, die Rechtsform wird nicht verlangt");

// ── Branchen-Hook wörtlich ─────────────────────────────────────────────────
const mitHook = regelBefunde(
  zeile({ entwurf: `Hey, ${HOOK_TIERARZT} Ich baue für die Kleintierpraxis Berg einen Assistenten.` }),
  []
);
check(mitHook.some((b) => b.includes("Branchen-Hook")), "wörtlich abgeschriebener Hook wird gemeldet");

// Ein umformulierter Hook darf NICHT anschlagen — sonst blockiert die Regel
// genau die Entwürfe, die sie erzwingen soll.
const umformuliert = regelBefunde(
  zeile({
    entwurf:
      "Hey, bei der Kleintierpraxis Berg landen Anrufe oft dann, wenn die Sprechstunde längst zu ist. " +
      "Wer als Erster zurückschreibt, hat den Termin. Wäre das einen Blick wert?",
  }),
  []
);
check(umformuliert.every((b) => !b.includes("Branchen-Hook")), "umformulierter Hook schlägt nicht an");

// ── Floskel-Einstieg, klein geschrieben ────────────────────────────────────
// Das ist der Fall, an dem der Nachbau in neu-generieren.ts scheiterte: sein
// Muster /Ich habe gesehen, dass/ war gross geschrieben und hatte kein i-Flag,
// die Mail beginnt aber mit "Hey, ich habe gesehen, dass ...".
const floskelKlein = regelBefunde(
  zeile({ entwurf: "Hey, ich habe gesehen, dass die Kleintierpraxis Berg um Terminvereinbarung bittet. Wäre das einen Blick wert?" }),
  []
);
check(floskelKlein.some((b) => b.includes("Floskel")), "klein geschriebene Beobachtungs-Floskel wird gemeldet");

const floskelGross = regelBefunde(
  zeile({ entwurf: "Hey, Mir ist aufgefallen, dass die Kleintierpraxis Berg um Terminvereinbarung bittet. Wäre das einen Blick wert?" }),
  []
);
check(floskelGross.some((b) => b.includes("Floskel")), "gross geschriebene Floskel wird ebenfalls gemeldet");

// Dieselbe Wendung mitten im Text ist harmlos und darf nicht anschlagen.
const floskelMittig = regelBefunde(
  zeile({ entwurf: "Hey, bei der Kleintierpraxis Berg klingelt es oft nach Feierabend. Ich habe gesehen, dass ihr Termine vergebt. Einen Blick wert?" }),
  []
);
check(floskelMittig.every((b) => !b.includes("Floskel")), "Floskel mitten im Text schlägt nicht an");

// ── Betreff ────────────────────────────────────────────────────────────────
const doppelt = regelBefunde(zeile({ betreff: "wie plant ihr eure termine?" }), ["wie plant ihr eure termine?"]);
check(doppelt.some((b) => b.includes("Betreff")), "bereits verschickter Betreff wird gemeldet");

const verboten = regelBefunde(zeile({ betreff: "kurzer anruf?" }), []);
check(verboten.some((b) => b.includes("Betreff")), "Betreff mit verbotenem Wort wird gemeldet");

// ── unbekannte Nische ──────────────────────────────────────────────────────
const unbekannt = regelBefunde(zeile({ nische: "Raumfahrtbetrieb" }), []);
check(
  unbekannt.some((b) => b.includes("ungeprüft")),
  "unbekannte Nische wird als ungeprüft gemeldet statt still übersprungen"
);

// ── Betreffzeile im Mailtext (Befund 09.09.2026) ───────────────────────────
// Das Modell schreibt gelegentlich "BETREFF: ..." als erste Zeile in den TEXT,
// zusätzlich zum Betreff in Spalte I. Der Empfänger liest das als Kopfzeile
// eines Formbriefs. Keine Regel hat das gesehen: am 09.09. trugen 7 von 41
// freigabereifen Entwürfen diese Zeile, und --freigeben hätte sie mitgenommen.
const mitBetreffzeile = regelBefunde(
  zeile({ entwurf: "BETREFF: kurze frage\n\nHey, bei der Kleintierpraxis Berg ist abends niemand am Apparat. Probiert es aus: https://demo.nio-automation.de/a/abc123" }),
  []
);
check(
  mitBetreffzeile.some((b) => b.includes("Betreffzeile")),
  "Betreffzeile im Mailtext wird gemeldet"
);

const kleingeschrieben = regelBefunde(
  zeile({ entwurf: "betreff: kurze frage\n\nHey, bei der Kleintierpraxis Berg ist abends niemand am Apparat. https://demo.nio-automation.de/a/abc123" }),
  []
);
check(
  kleingeschrieben.some((b) => b.includes("Betreffzeile")),
  "auch klein geschrieben, mit Doppelpunkt"
);

// Gegenrichtung: das Wort mitten im Fliesstext ist keine Kopfzeile.
const wortImText = regelBefunde(
  zeile({ entwurf: "Hey, bei der Kleintierpraxis Berg ist abends niemand am Apparat. Schreibt einfach einen Betreff: egal welchen. https://demo.nio-automation.de/a/abc123" }),
  []
);
check(
  !wortImText.some((b) => b.includes("Betreffzeile")),
  "das Wort im Fliesstext loest keinen Befund aus"
);

// ── Fit-Nein eines Menschen (Befund 09.09.2026) ────────────────────────────
// Die Runde trennt Mechanik von Urteil, aber das Urteil hatte bis heute keinen
// Ort: --freigeben nimmt ALLE Zeilen ohne Befund mit. Wer beim Lesen fünf
// Entwürfe als unpassend erkennt, musste das Sheet von Hand anfassen. Damit war
// die Runde nur zur Hälfte durchführbar.
check(zeilenAusArgument("1526,1555,1559").size === 3, "drei Nummern werden gelesen");
check(zeilenAusArgument("1526, 1555 , 1559").has(1555), "Leerzeichen stoeren nicht");
check(zeilenAusArgument("").size === 0, "leeres Argument ergibt keine Zeile");
check(zeilenAusArgument("abc,12x,7").size === 1, "Unfug wird verworfen, gueltige Nummer bleibt");
check(!zeilenAusArgument("0,-3").has(0), "Zeile 0 ist keine Sheet-Zeile");

// ── die Freigabe-Sperre ────────────────────────────────────────────────────
// Der eigentliche Fix: was einen Befund hat, darf --freigeben nicht mitnehmen.
const befunde = new Map<number, Befund[]>([
  [10, [{ art: "verworfen", grund: "Adresse unbrauchbar" }]],
  [11, [{ art: "repariert", was: "Anrede auf ihr vereinheitlicht" }]],
  [12, [{ art: "prüfen", hinweis: "Branchen-Hook wörtlich übernommen" }]],
  [13, [{ art: "repariert", was: "Adresse entkodiert" }, { art: "prüfen", hinweis: "Firmenname fehlt im Entwurf" }]],
]);
const gesperrt = gesperrteZeilen(befunde);
check(gesperrt.has(10), "verworfene Zeile bleibt gesperrt");
check(!gesperrt.has(11), "rein reparierte Zeile darf freigegeben werden");
check(gesperrt.has(12), "Zeile mit Regelbruch bleibt gesperrt");
check(gesperrt.has(13), "repariert UND Befund → bleibt gesperrt");
check(gesperrteZeilen(new Map()).size === 0, "ohne Befunde ist nichts gesperrt");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
