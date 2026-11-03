// Tests für die vollständige Betreff-Liste des Erzeugers (03.11.2026).
// Kein Netzwerk, kein LLM.
// Ausführen: npx tsx tests/test_betreff_vollstaendig.ts
//
// Hintergrund: In der Freigabe-Runde 03.11. hingen 37 von 51 PRUEFEN-Zeilen an
// "Betreff unbrauchbar oder doppelt". Der Erzeuger prüfte nur gegen die letzten
// 40 Betreffe der Queue, die Freigabe-Runde gegen alles, was draußen ist. Über
// die letzten 400 Zeilen: 38 Dubletten, davon konnte der Erzeuger 2 sehen.
// Er hielt für frisch, was vor Wochen schon verschickt war, und fasste nie nach.

import { betreffIstBrauchbar, verbrauchteBetreffeAusQueue, betreffeFuerPrompt } from "../src/trigger/nacht-recherche";
import { betreffVergleichFuer as ausQualitaet } from "../src/trigger/entwurf-qualitaet";
import { betreffVergleichFuer as ausPruefung } from "../tools/freigabe-pruefung";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

function zeile(status: string, betreff: string): unknown[] {
  const z: unknown[] = [];
  z[5] = status;
  z[8] = betreff;
  return z;
}

// 200 verschickte Zeilen, die älteste trägt den Betreff, der heute wiederkommt.
const ALT = "was fragen kaufinteressenten zuerst?";
const rohzeilen: unknown[][] = [["Kopf"], zeile("NACHGEFASST_1", ALT)];
for (let i = 0; i < 200; i++) rohzeilen.push(zeile("GESENDET", `frage nummer ${i}?`));
rohzeilen.push(zeile("VERWORFEN", "wie plant ihr neue termine?"));
rohzeilen.push(zeile("PRUEFEN", "wer nimmt neue mieterfragen auf?"));

const verbraucht = verbrauchteBetreffeAusQueue(rohzeilen);

// Der Fehler, wie er bis heute lief: die letzten 40 kennen den alten Betreff nicht.
check(betreffIstBrauchbar(ALT, verbraucht.slice(-40)), "Beleg des alten Fehlers: letzte 40 lassen die Dublette durch");
check(!betreffIstBrauchbar(ALT, verbraucht), "volle Liste erkennt einen Betreff, der vor 200 Zeilen verschickt wurde");
check(!betreffIstBrauchbar("wer nimmt neue mieterfragen auf?", verbraucht), "offene Zeile zählt als verbraucht");
check(betreffIstBrauchbar("wie plant ihr neue termine?", verbraucht), "VERWORFEN zählt nicht, die Zeile geht nie raus");
check(verbraucht.length === 202, `alles Verschickte und Offene drin (${verbraucht.length})`);

// Dieselbe Regel wie in der Freigabe-Runde, nicht eine zweite Fassung.
check(ausQualitaet === ausPruefung, "Freigabe-Runde und Erzeuger nutzen dieselbe Funktion");

// Der Prompt bleibt kurz: nur die letzten 40, aber die Prüfung sieht alles.
const prompt = betreffeFuerPrompt(verbraucht);
check(prompt.length === 40, `Prompt zeigt 40 Betreffe (${prompt.length})`);
check(prompt[prompt.length - 1] === "wer nimmt neue mieterfragen auf?", "Prompt endet mit dem jüngsten Betreff");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen ? 1 : 0);
