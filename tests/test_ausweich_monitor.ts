// Tests für die Ausweichroute-Meldung des Health-Monitors.
// Kein Netzwerk, kein Trigger.dev — nur die reinen Funktionen.
// Ausführen: npx tsx tests/test_ausweich_monitor.ts
//
// Warum es diese Prüfung gibt (24.10.2026): Springt die OpenRouter-Ausweichroute
// still ein, merkt niemand, dass OpenAI seit Tagen tot ist — bis auch das
// OpenRouter-Guthaben leer ist und beide Wege gleichzeitig ausfallen. Nio will
// deshalb sofort eine Mail und danach eine Erinnerung pro Tag. Ab 20 statt 24
// Stunden, weil ein Nachtlauf knapp unter 24 h nach dem letzten fertig werden
// kann und die Erinnerung sonst einen Tag ausfiele.

import {
  ausweichAusAusgabe, ausweichMeldungFaellig, baueAusweichAlarm,
  AUSWEICH_TASKS, AUSWEICH_TAG, UEBERWACHTE_TASKS,
} from "../src/trigger/agent-health-monitor";
import type { AusweichRun } from "../src/trigger/agent-health-monitor";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

// ─── ausweichAusAusgabe ──────────────────────────────────────────────────────
check(ausweichAusAusgabe(undefined) === null, "undefined → null");
check(ausweichAusAusgabe({}) === null, "ohne Feld → null");
check(ausweichAusAusgabe({ ausweichroute: { umgeschaltet: 0, gruende: [], beideTot: 0 } }) === null, "alles 0 → null");
const a = ausweichAusAusgabe({ ausweichroute: { umgeschaltet: 3, gruende: ["401", "401", "401"], beideTot: 0 } });
check(a !== null && a.umgeschaltet === 3, "umgeschaltet 3 → Objekt");
const b = ausweichAusAusgabe({ ausweichroute: { umgeschaltet: 0, gruende: [], beideTot: 1 } });
check(b !== null && b.beideTot === 1, "nur beideTot 1 → Objekt");

// ─── ausweichMeldungFaellig ──────────────────────────────────────────────────
const jetzt = new Date("2026-10-26T10:00:00Z");
const vor = (h: number) => new Date(jetzt.getTime() - h * 3600_000);
check(ausweichMeldungFaellig(null, jetzt), "nie gemeldet → fällig");
check(!ausweichMeldungFaellig(vor(19), jetzt), "vor 19 h → nicht fällig");
check(ausweichMeldungFaellig(vor(20), jetzt), "vor 20 h → fällig");
check(ausweichMeldungFaellig(vor(30), jetzt), "vor 30 h → fällig");

// ─── baueAusweichAlarm ───────────────────────────────────────────────────────
const treffer: AusweichRun = {
  taskId: "reply-classifier", runId: "run_abc123", zeit: "26.10.2026, 10:00:05",
  umgeschaltet: 2, gruende: ["401", "401"], beideTot: 0,
};
const erst = baueAusweichAlarm([treffer], false);
check(erst.betreff.startsWith("🔀 OpenAI ausgefallen, Ausweichroute aktiv"), "Erstmeldung: Betreff");
check(baueAusweichAlarm([treffer], true).betreff.startsWith("🔀 Erinnerung: Ausweichroute weiter aktiv"), "Erinnerung: Betreff");
check(erst.text.includes("reply-classifier") && erst.text.includes("run_abc123"), "Text nennt Task und Run-ID");
check(erst.text.includes("401"), "Text nennt den Grund");
check(erst.text.includes("Key oder Guthaben bei OpenAI prüfen."), "Text sagt, was zu tun ist");
const tot = { ...treffer, beideTot: 1 };
check(baueAusweichAlarm([tot], false).betreff.startsWith("🚨 OpenAI und Ausweichroute ausgefallen"), "beide tot: Betreff (Erstmeldung)");
check(baueAusweichAlarm([tot], true).betreff.startsWith("🚨 OpenAI und Ausweichroute ausgefallen"), "beide tot: Betreff auch als Erinnerung");

// ─── Konstanten ──────────────────────────────────────────────────────────────
check(JSON.stringify([...AUSWEICH_TASKS]) === JSON.stringify(["nacht-recherche", "reply-classifier", "nachfass-versand", "sofort-antwort"]), "AUSWEICH_TASKS: die vier Agenten");
check(AUSWEICH_TAG === "ausweichroute-gemeldet", "AUSWEICH_TAG");
check(JSON.stringify([...UEBERWACHTE_TASKS]) === JSON.stringify(["morgen-versand", "nacht-recherche"]), "Leerlauf-Prüfung unverändert");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
if (fehlgeschlagen > 0) process.exit(1);
