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

import {
  hookIstAbgeschrieben,
  brancheZeileFuer,
  mailAngles,
  vorlageIstAbgeschrieben,
  vorlagenFuer,
  ABGELEGTE_VORLAGEN,
} from "../src/trigger/nacht-recherche";
import { KATEGORIEN } from "../src/trigger/nischen";
import { readFileSync } from "node:fs";

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

// -- Der Hook verschwindet im zweiten Anlauf (08.09.2026) -------------------
// Erkennen allein reichte nicht: 8 von 11 Hook-Neuversuchen scheiterten, weil
// `erzeuge()` die Nachfass-Anweisung an dieselbe Nachrichtenliste haengt und
// das Modell seinen eigenen Entwurf nie sieht - nur den Auftrag, in dem der
// Hook weiter stand. Vier Tierarztpraxen in Bremen trugen dieselben 19 Woerter.

const mitHook = brancheZeileFuer(HOOK_TIERARZT, false);
check(mitHook.includes(HOOK_TIERARZT), "erster Anlauf traegt den Hook im Auftrag");

const ohneHook = brancheZeileFuer(HOOK_TIERARZT, true);
check(!ohneHook.includes(HOOK_TIERARZT), "zweiter Anlauf traegt den Hook NICHT mehr");
check(
  !ohneHook.toLowerCase().includes("tierbesitzer") && !ohneHook.toLowerCase().includes("termin"),
  "die Ersatzzeile enthaelt auch keine Bruchstuecke des Hooks",
);
check(ohneHook.trim().length > 40, "die Ersatzzeile sagt, was stattdessen zu tun ist");
check(
  brancheZeileFuer("", true) === brancheZeileFuer(HOOK_TIERARZT, true),
  "die Ersatzzeile haengt nicht vom Hook ab",
);

// Quelltext-Pruefung, bewusst als solche benannt: dass die Zeile ohne Hook
// existiert, nuetzt nichts, wenn der Neuversuch sie nicht anfordert. Ohne
// Stub-Punkt fuer den OpenAI-Client ist das die einzige Stelle, an der ein
// spaeteres Entfernen des Schalters auffiele.
const quelle = readFileSync(new URL("../src/trigger/nacht-recherche.ts", import.meta.url), "utf8");
const von = quelle.indexOf("hookIstAbgeschrieben(ergebnis.inhalt, branchenHinweis)");
const bis = quelle.indexOf("const hookGeloest");
const hookNeuversuch = von >= 0 && bis > von ? quelle.slice(von, bis) : "";
check(hookNeuversuch.length > 0, "der Hook-Neuversuch ist im Quelltext auffindbar");
check(
  /,\s*true\s*\)/.test(hookNeuversuch),
  "der Hook-Neuversuch ruft erzeuge() mit ohneHook = true",
);
check(
  !hookNeuversuch.includes("aus dem Hintergrundwissen zur Branche abgeschrieben"),
  "die Nachfass-Anweisung verweist nicht mehr auf einen Satz, der gar nicht mehr dasteht",
);


// -- Der Hook hat ZWEI Wege in den Prompt, nicht einen ----------------------
// Der erste Anlauf des Fixes am 08.09.2026 blendete nur die Hintergrundwissen-
// Zeile aus. Der Neuversuch scheiterte weiter in 4 von 5 Faellen, weil
// mailAngles() den Hook ein zweites Mal in die Struktur-Anweisung backt.
// Dieser Test zaehlt beide Wege ueber ALLE Nischen ab, nicht ueber eine.

let nischenGeprueft = 0;
let strukturMitHook = 0;
let strukturOhneHook = 0;

for (const k of KATEGORIEN) {
  for (const n of k.nischen) {
    nischenGeprueft++;
    const sichtbar = mailAngles(k, n, false).map((a) => a.struktur).join("\n");
    const versteckt = mailAngles(k, n, true).map((a) => a.struktur).join("\n");
    if (sichtbar.includes(n.hook)) strukturMitHook++;
    if (versteckt.includes(n.hook)) strukturOhneHook++;
  }
}

check(nischenGeprueft >= 12, `alle Nischen geprueft (${nischenGeprueft})`);
check(strukturMitHook === nischenGeprueft, "im ersten Anlauf traegt jede Struktur den Hook");
check(
  strukturOhneHook === 0,
  `im zweiten Anlauf traegt KEINE Struktur den Hook (gefunden: ${strukturOhneHook})`,
);

// Und nicht nur der ganze Satz: auch keine lange woertliche Passage daraus.
let langePassage = 0;
for (const k of KATEGORIEN) {
  for (const n of k.nischen) {
    const versteckt = mailAngles(k, n, true).map((a) => a.struktur).join("\n");
    if (hookIstAbgeschrieben(versteckt, n.hook)) langePassage++;
  }
}
check(langePassage === 0, `keine Struktur enthaelt eine lange Passage des Hooks (${langePassage})`);

// Beide Wege haengen an DEMSELBEN Schalter. Wuerde jemand nur einen umstellen,
// faellt es hier auf: der komplette Auftrag darf den Hook nicht mehr tragen.
for (const k of KATEGORIEN) {
  for (const n of k.nischen) {
    const auftrag = brancheZeileFuer(n.hook, true) + "\n" + mailAngles(k, n, true).map((a) => a.struktur).join("\n");
    if (auftrag.includes(n.hook)) {
      check(false, `Auftrag ohne Hook enthaelt ihn trotzdem: ${n.name}`);
    }
  }
}
check(true, "kein Auftrag mit ausgeblendetem Hook traegt ihn noch");


// -- Die zweite Vorlage: der Blickwinkel-Text (08.09.2026) ------------------
// Beim Lesen der frisch geschriebenen Entwuerfe trugen 7 von 24 denselben Satz
// aus mailAngles(). Die Hook-Pruefung sah ihn nicht - sie vergleicht nur gegen
// nische.hook. Gemessen ueber 160 echte Entwuerfe liegt zwischen normaler
// Sprachueberschneidung (<=5 Woerter) und Abschreiben (>=8) eine leere Zone.

const KAT = KATEGORIEN[0]!;
const NIS = KAT.nischen[0]!;
const STRUKTUREN = mailAngles(KAT, NIS, true).map((a) => a.struktur);

// Der Satz, der 28 mal woertlich in echten Entwuerfen stand.
const ABGESCHRIEBEN =
  "Hey, ich habe einen Assistenten gebaut, der Anfragen abfaengt, Fragen beantwortet und Termine aufnimmt - hier zum Ausprobieren.";
check(
  vorlageIstAbgeschrieben(ABGESCHRIEBEN, [
    "2. Komm SOFORT zum Link: du hast einen Assistenten gebaut, der Anfragen abfaengt, Fragen beantwortet und Termine aufnimmt - hier zum Ausprobieren.",
  ]),
  "woertlich uebernommene Vorlage wird erkannt",
);

const EIGEN =
  "Hey, bei euch klingelt es mitten in der Behandlung. Ich habe dafuer etwas gebaut, das ans Telefon geht, wenn ihr es nicht koennt, und den Wunschtermin gleich mitnotiert.";
check(
  !vorlageIstAbgeschrieben(EIGEN, STRUKTUREN),
  "selbst formulierte Fassung schlaegt nicht an",
);

check(!vorlageIstAbgeschrieben("", STRUKTUREN), "leerer Entwurf schlaegt nie an");
check(!vorlageIstAbgeschrieben(EIGEN, []), "ohne Vorlagen schlaegt nie an");

// Die Schwelle sitzt in der gemessenen leeren Zone. Fuenf gemeinsame Woerter
// sind normale Sprache und duerfen nicht anschlagen.
const FUENF = "Ich habe einen Assistenten gebaut und melde mich kurz.";
check(
  !vorlageIstAbgeschrieben(FUENF, ["du hast einen Assistenten gebaut, der Anfragen abfaengt"]),
  "fuenf gemeinsame Woerter sind normale Sprache, kein Befund",
);

// Die Vorlagen selbst duerfen dem Modell keinen fertigen Satz mehr reichen.
// Geprueft ueber alle Nischen: kein Blickwinkel enthaelt noch die Prosa, die
// am 08.09. 28 mal woertlich in den Mails landete.
let mitFertigemSatz = 0;
for (const k of KATEGORIEN) {
  for (const n of k.nischen) {
    for (const a of mailAngles(k, n, true)) {
      if (a.struktur.includes("der Anfragen abfängt, Fragen beantwortet und Termine aufnimmt")) {
        mitFertigemSatz++;
      }
    }
  }
}
check(
  mitFertigemSatz === 0,
  `keine Vorlage reicht den fertigen Satz noch durch (gefunden: ${mitFertigemSatz})`,
);


// -- Abgelegte Vorlagen bleiben pruefbar -----------------------------------
// Die Falle, in die der Fix am 08.09.2026 selbst lief: nach dem Umschreiben
// der Vorlage meldete die Freigabe-Runde 1 statt 7 Treffern - die Pruefung
// vergleicht gegen den AKTUELLEN Text, und der kennt den abgeschriebenen Satz
// nicht mehr. Die 7 Entwuerfe lagen unveraendert in der Queue.

check(ABGELEGTE_VORLAGEN.length > 0, "es gibt abgelegte Vorlagen zum Mitpruefen");

const ALTER_SATZ =
  "Hey, bei euch klingelt viel. Komm SOFORT zum Link: du hast einen Assistenten gebaut, " +
  "der Anfragen abfängt, Fragen beantwortet und Termine aufnimmt — hier zum Ausprobieren.";

// Gegen die aktuellen Vorlagen allein faellt der alte Satz durch.
const nurAktuell = mailAngles(KAT, NIS, true).map((a) => a.struktur);
check(
  !vorlageIstAbgeschrieben(ALTER_SATZ, nurAktuell),
  "gegen die aktuellen Vorlagen allein bleibt der alte Satz unsichtbar (die Falle)",
);

// Ueber vorlagenFuer() wird er gefunden.
check(
  vorlageIstAbgeschrieben(ALTER_SATZ, vorlagenFuer(KAT, NIS)),
  "vorlagenFuer() findet den Satz aus der abgelegten Vorlage",
);

// vorlagenFuer() traegt beide Listen, und zwar fuer jede Nische.
let ohneAltlast = 0;
for (const k of KATEGORIEN) {
  for (const n of k.nischen) {
    const alle = vorlagenFuer(k, n);
    if (!ABGELEGTE_VORLAGEN.every((v) => alle.includes(v))) ohneAltlast++;
    if (alle.length <= mailAngles(k, n, true).length) ohneAltlast++;
  }
}
check(ohneAltlast === 0, `jede Nische bekommt aktuelle UND abgelegte Vorlagen (${ohneAltlast} Ausreisser)`);

// Und eine selbst formulierte Fassung schlaegt auch gegen die volle Liste nicht an.
check(
  !vorlageIstAbgeschrieben(EIGEN, vorlagenFuer(KAT, NIS)),
  "selbst formulierte Fassung schlaegt auch gegen die volle Liste nicht an",
);


console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
