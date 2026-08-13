// Tests für die Hook-Kopie-Erkennung der Nacht-Recherche.
// Kein Netzwerk, kein Sheet, kein LLM — nur die Prüffunktion.
// Ausführen: npx tsx tests/test_hook_kopie.ts
//
// Warum es diese Prüfung gibt: in `nischen.ts` steht am Feld `hook` ausdrücklich
// "Kontext, nie wörtlich in die Mail". Der Lauf vom 13.08.2026 zeigte, dass die
// Prompt-Regel das nicht hält — 9 von 60 Entwürfen begannen mit dem Hook Wort
// für Wort, vier Steuerkanzleien in derselben Stadt mit demselben Satz.
// Dasselbe Muster wie die Betreff-Monokultur vom 17.07.: dem Prompt vertraut,
// das Ergebnis nie geprüft.

import { hookIstAbgeschrieben } from "../src/trigger/nacht-recherche";

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

const HOOK_TIERARZT =
  "Viele Tierbesitzer rufen abends oder am Wochenende an und erreichen niemanden — die erste Praxis, die reagiert, bekommt den Termin.";
const HOOK_KANZLEI =
  "Mandantenanfragen gehen häufig an die Kanzlei, die als erste antwortet — nicht an die fachlich beste.";
const HOOK_MAKLER =
  "Interessenten schreiben mehrere Makler gleichzeitig an — wer zuerst zurückmeldet, führt das Gespräch.";
const HOOK_ZAHNARZT =
  "Ein grosser Teil der Terminanfragen kommt abends oder am Wochenende — und landet bei der Praxis, die als erste reagiert.";

// ─── 1. Wörtliche Übernahme wird erkannt ─────────────────────────────────────
// Echter Entwurf, Zeile 1007 des Laufs vom 11.08.2026.
check(
  hookIstAbgeschrieben(
    "Hey, viele Tierbesitzer rufen abends oder am Wochenende an und erreichen niemanden — die erste Praxis, die reagiert, bekommt den Termin. Ich bin Nio, baue KI-Agenten in Hamburg.",
    HOOK_TIERARZT,
  ),
  "Hook wortgleich im ersten Satz → abgeschrieben",
);

// ─── 2. Auch wenn der Hook nicht am Anfang steht ─────────────────────────────
// Zeile 1010: erster Satz eigenständig, der Hook kommt danach.
check(
  hookIstAbgeschrieben(
    "Hey, hohe Temperaturen stellen auch für unsere Tiere eine große Belastung dar. Viele Tierbesitzer rufen abends oder am Wochenende an und erreichen niemanden — die erste Praxis, die reagiert, bekommt den Termin. Hier zum Ausprobieren:",
    HOOK_TIERARZT,
  ),
  "Hook wortgleich im zweiten Satz → abgeschrieben",
);

// ─── 3. Teilübernahme ab sieben Wörtern zählt ────────────────────────────────
// Zeile 1034: der Hook ist gekürzt, aber der Satzanfang ist Wort für Wort derselbe.
check(
  hookIstAbgeschrieben(
    "Guten Tag, Sie bieten gezielte Unterstützung für Freiberufler an. Mandantenanfragen gehen häufig an die Kanzlei, die als erste reagiert.",
    HOOK_KANZLEI,
  ),
  "neun Wörter am Stück übernommen → abgeschrieben",
);

// ─── 4. Echte Umformulierung ist erlaubt ─────────────────────────────────────
// Genau das, was der Prompt will: dasselbe Thema, eigene Worte.
check(
  hookIstAbgeschrieben(
    "Hey, euer Ansatz mit den regelmäßigen Vorsorgeuntersuchungen klingt echt gut. Viele Tierbesitzer bekommen abends oder am Wochenende keine Antwort und suchen dann die nächste Praxis, die reagiert.",
    HOOK_TIERARZT,
  ) === false,
  "Thema übernommen, Formulierung eigen → nicht abgeschrieben",
);

check(
  hookIstAbgeschrieben(
    "Guten Tag, in einem Markt, in dem Interessenten mehrere Makler gleichzeitig kontaktieren, führt eine schnelle Rückmeldung oft zum Gespräch.",
    HOOK_MAKLER,
  ) === false,
  "Makler-Hook umgebaut → nicht abgeschrieben",
);

// ─── 5. ß/ss und Zeichensetzung sind kein Unterschied ────────────────────────
// Zeile 1018: identisch bis auf "grosser" vs "großer". Wer nur auf Gleichheit
// prüft, sieht hier nichts — und genau so rutscht die Kopie durch.
check(
  hookIstAbgeschrieben(
    "Hey, ein großer Teil der Terminanfragen kommt abends oder am Wochenende – und landet bei der Praxis, die als erste reagiert!",
    HOOK_ZAHNARZT,
  ),
  "ß/ss und andere Gedankenstriche zählen nicht als Unterschied",
);

// ─── 6. Kurze gemeinsame Wendungen sind harmlos ──────────────────────────────
// "abends oder am Wochenende" steht in jeder zweiten Mail und ist kein Beleg.
check(
  hookIstAbgeschrieben(
    "Hey, bei euch kommen Anfragen oft abends oder am Wochenende rein, wenn niemand mehr da ist.",
    HOOK_TIERARZT,
  ) === false,
  "vier gemeinsame Wörter → nicht abgeschrieben",
);

// ─── 7. Nische ohne Hook flaggt nie ──────────────────────────────────────────
check(
  hookIstAbgeschrieben("Hey, irgendein Text über irgendwas.", "") === false,
  "leerer Hook → nie abgeschrieben",
);
check(
  hookIstAbgeschrieben("", HOOK_TIERARZT) === false,
  "leerer Entwurf → nie abgeschrieben",
);

// ─── 8. Schwelle ist einstellbar ─────────────────────────────────────────────
// Für den Fall, dass sich 7 Wörter im Betrieb als zu locker oder zu streng zeigt.
check(
  hookIstAbgeschrieben(
    "Hey, bei euch kommen Anfragen oft abends oder am Wochenende rein.",
    HOOK_TIERARZT,
    4,
  ),
  "Schwelle 4 greift, wo Schwelle 7 durchlässt",
);

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
