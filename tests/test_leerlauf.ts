// Tests für die Leerlauf-Erkennung des Health-Monitors.
// Kein Netzwerk, kein Trigger.dev — nur die Urteilsfunktion.
// Ausführen: npx tsx tests/test_leerlauf.ts
//
// Warum es diese Prüfung gibt (25.08.2026): `morgen-versand` lief um 09:00
// grün durch, meldete `completed` in 1,5 Sekunden und sendete 0 von 0 Mails.
// Kein Fehler, kein Alarm, kein Outreach. Der Health-Monitor sieht das nicht,
// weil er ausschliesslich nach FAILED/CRASHED/SYSTEM_FAILURE/TIMED_OUT sucht —
// ein Lauf, der nichts findet, endet per Definition mit Erfolg.
//
// Dasselbe Muster gab es schon zweimal: Maps-Billing aus (06.07.) und der
// Sheets-Spalten-Bug (16.07.). Beide Male stand die Zahl im Log, und beide Male
// hat sie niemand gelesen. Die Tasks WISSEN, dass sie nichts getan haben —
// `nacht-recherche` schreibt sogar "WARNUNG: 0 Entwürfe" — aber `run()` gab
// `undefined` zurück, also verliess das Wissen den Lauf nie.

import { leerlaufBefund, leerlaufArt, baueAlarm, pruefFenster, imFenster } from "../src/trigger/agent-health-monitor";
import type { FehlerRun, LeerlaufRun } from "../src/trigger/agent-health-monitor";
import { zaehleWartend } from "../src/trigger/morgen-versand";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

function meldet(taskId: string, ausgabe: unknown, was: string): void {
  const befund = leerlaufBefund(taskId, ausgabe);
  check(befund !== null, `meldet ${was}${befund ? ` — "${befund}"` : ""}`);
}

function schweigt(taskId: string, ausgabe: unknown, was: string): void {
  const befund = leerlaufBefund(taskId, ausgabe);
  check(befund === null, `schweigt bei ${was}${befund ? ` — FÄLSCHLICH gemeldet: ${befund}` : ""}`);
}

console.log("\n=== Der echte Fall vom 25.08.2026 ===");
meldet("morgen-versand", { gefunden: 0, gesendet: 0, fehler: 0 }, "morgen-versand mit 0 von 0");

console.log("\n=== morgen-versand: normale Läufe bleiben still ===");
schweigt("morgen-versand", { gefunden: 30, gesendet: 30, fehler: 0 }, "30 von 30");
schweigt("morgen-versand", { gefunden: 30, gesendet: 29, fehler: 1 }, "29 von 30, eine Panne");
schweigt("morgen-versand", { gefunden: 1, gesendet: 1, fehler: 0 }, "eine einzige Mail");

console.log("\n=== morgen-versand: gefunden, aber nichts ging raus ===");
meldet("morgen-versand", { gefunden: 30, gesendet: 0, fehler: 30 }, "30 gefunden, 0 gesendet");

console.log("\n=== nacht-recherche ===");
meldet("nacht-recherche", { entwuerfe: 0, kategorie: "Gesundheit" }, "0 Entwürfe (Pool leer / Billing aus)");
schweigt("nacht-recherche", { entwuerfe: 30, kategorie: "Gesundheit" }, "30 Entwürfe");
schweigt("nacht-recherche", { entwuerfe: 1, kategorie: "Handwerk" }, "ein Entwurf");

console.log("\n=== Fehlende oder kaputte Ausgabe wird gemeldet, nicht verschluckt ===");
meldet("morgen-versand", undefined, "gar keine Ausgabe (alte Version deployt?)");
meldet("morgen-versand", null, "null als Ausgabe");
meldet("nacht-recherche", { irgendwas: 1 }, "Ausgabe ohne das erwartete Feld");
meldet("morgen-versand", "fertig", "Ausgabe ist ein String statt eines Objekts");
meldet("nacht-recherche", { entwuerfe: "viele" }, "Feld hat den falschen Typ");

console.log("\n=== Unbeobachtete Tasks lösen nie aus ===");
schweigt("agent-health-monitor", { status: "ok", fehler: 0 }, "der Monitor selbst");
schweigt("nachfass-versand", { gesendet: 0 }, "Nachfassen ohne fällige Leads — 0 ist hier normal");
schweigt("linkedin-api-posting", undefined, "Posting-Stub ohne Token");
schweigt("irgendwas-neues", { gefunden: 0 }, "unbekannte Task");

console.log("\n=== Die fertige Alarm-Mail, nicht nur das Urteil darunter ===");

const beispielFehler: FehlerRun[] = [{
  taskId: "linkedin-post-nacht", status: "FAILED", runId: "run_abc",
  zeit: "24.8.2026, 21:03:56", fehler: "Kie.ai-Task fehlgeschlagen: Internal Error",
}];
const beispielLeerlauf: LeerlaufRun[] = [{
  taskId: "morgen-versand", runId: "run_xyz", zeit: "25.8.2026, 09:01:09",
  befund: "0 freigegebene Entwuerfe in der Queue - es ging keine einzige Mail raus. Queue auf DRAFT pruefen.",
}];

const nurLeerlauf = baueAlarm([], beispielLeerlauf, 65);
check(nurLeerlauf.betreff.includes("Leerlauf"), `Betreff nennt Leerlauf: "${nurLeerlauf.betreff}"`);
check(!nurLeerlauf.betreff.includes("down"), "Betreff behauptet keinen Ausfall, wenn nur Leerlauf vorliegt");
// Escape-frei formuliert: ein woertliches "\\n" in dieser Quelle waere
// genau der Fehler, den die Pruefung finden soll.
const backslashN = String.fromCharCode(92) + "n";
check(!nurLeerlauf.text.includes(backslashN), "Mail-Text enthaelt keine sichtbaren Backslash-n-Escapes");
check(nurLeerlauf.text.split("\n").length > 5, "Mail-Text hat echte Zeilenumbrueche");
check(nurLeerlauf.text.includes("0 freigegebene Entwuerfe"), "Mail-Text nennt den konkreten Befund");
check(nurLeerlauf.text.includes("run_xyz"), "Mail-Text nennt die Run-ID");
check(!nurLeerlauf.text.includes("---"), "kein leerer Trenner, wenn es nur einen Abschnitt gibt");

const beides = baueAlarm(beispielFehler, beispielLeerlauf, 65);
check(beides.betreff.includes("1 Task down") && beides.betreff.includes("1x Leerlauf"),
  `Betreff nennt beides: "${beides.betreff}"`);
check(beides.text.includes("Kie.ai") && beides.text.includes("0 freigegebene"),
  "Mail-Text traegt beide Abschnitte");
check(beides.text.includes("---"), "Trenner zwischen den beiden Abschnitten");

// ─── Gebremste Nacht ist kein Leerlauf (27.08.2026) ──────────────────────────
//
// nacht-recherche bremst sich selbst, wenn zu viele Entwürfe unbearbeitet auf
// PRUEFEN liegen. Sie meldet dann 0 Entwürfe — aber mit Grund. Ohne diese
// Unterscheidung hätte der Monitor jede gebremste Nacht als "Pool erschöpft"
// gemeldet, also genau dann Alarm gegeben, wenn alles richtig läuft.

check(
  leerlaufBefund("nacht-recherche", {
    entwuerfe: 0, kategorie: "-", status: "-",
    uebersprungen: "72 Entwuerfe stehen auf PRUEFEN (Grenze 60)",
  }) === null,
  "gebremste Nacht (uebersprungen gesetzt) löst KEINEN Alarm aus",
);
check(
  leerlaufBefund("nacht-recherche", { entwuerfe: 0 }) !== null,
  "0 Entwürfe OHNE Grund löst weiterhin Alarm aus",
);
check(
  leerlaufBefund("nacht-recherche", { entwuerfe: 0, uebersprungen: "" }) !== null,
  "leerer Grund zählt nicht als übersprungen",
);
check(
  leerlaufBefund("nacht-recherche", { entwuerfe: 0, uebersprungen: 42 }) !== null,
  "Grund muss ein Text sein, keine Zahl",
);
check(
  leerlaufBefund("nacht-recherche", { entwuerfe: 30, kategorie: "x", status: "PRUEFEN" }) === null,
  "normale Nacht mit 30 Entwürfen bleibt still",
);

const nurFehler = baueAlarm(beispielFehler, [], 65);
check(nurFehler.betreff.includes("1 Task down") && !nurFehler.betreff.includes("Leerlauf"),
  `Betreff ohne Leerlauf-Teil: "${nurFehler.betreff}"`);

// ─── Freigabe-Pause ist kein Leerlauf (Audit AIOS-20261017-01) ───────────────
// 28.09.–16.10.2026: acht Alarm-Mails "⚠️ Agent-Alarm: 1x Leerlauf", alle acht
// waren Tage, an denen die Entwuerfe noch auf PRUEFEN lagen. Ein echter Ausfall
// (Pool leer, Sheets kaputt) sah im Postfach genauso aus. Nios Entscheidung
// 17.10.: weiter melden, aber unter eigenem Namen.
console.log("\n=== morgen-versand: Freigabe-Pause vs. echter Leerlauf ===");
check(leerlaufArt("morgen-versand", { gefunden: 0, gesendet: 0, fehler: 0, wartetAufFreigabe: 42 }) === "freigabe",
  "0 DRAFT, 42 PRUEFEN → Art freigabe");
check(leerlaufArt("morgen-versand", { gefunden: 0, gesendet: 0, fehler: 0, wartetAufFreigabe: 0 }) === "leerlauf",
  "0 DRAFT, 0 PRUEFEN → Art leerlauf (echter Ausfall)");
check(leerlaufArt("morgen-versand", { gefunden: 0, gesendet: 0, fehler: 0 }) === "leerlauf",
  "alte Ausgabe ohne wartetAufFreigabe → leerlauf (fail-closed)");
check(leerlaufArt("morgen-versand", { gefunden: 5, gesendet: 0, fehler: 5, wartetAufFreigabe: 9 }) === "leerlauf",
  "5 gefunden, 0 gesendet bleibt Leerlauf, auch wenn PRUEFEN wartet");
const pauseBefund = leerlaufBefund("morgen-versand", { gefunden: 0, gesendet: 0, fehler: 0, wartetAufFreigabe: 42 }) ?? "";
check(pauseBefund.includes("42") && /freigabe/i.test(pauseBefund), `Befund nennt Zahl und Freigabe: "${pauseBefund}"`);

const pause: LeerlaufRun = { taskId: "morgen-versand", runId: "run_p", zeit: "16.10.2026, 09:02", befund: pauseBefund, art: "freigabe" };
const nurPause = baueAlarm([], [pause], 60);
check(nurPause.betreff.startsWith("📝 Freigabe fällig") && !nurPause.betreff.includes("Agent-Alarm"),
  `reine Pause: eigener Betreff — "${nurPause.betreff}"`);
const echt: LeerlaufRun = { taskId: "morgen-versand", runId: "run_e", zeit: "16.10.2026, 09:02", befund: "0 DRAFT, 0 PRUEFEN", art: "leerlauf" };
const gemischt = baueAlarm([], [pause, echt], 60);
check(gemischt.betreff.startsWith("⚠️ Agent-Alarm"), `Pause + echter Leerlauf: Alarm gewinnt — "${gemischt.betreff}"`);
const mitFehler = baueAlarm(beispielFehler, [pause], 60);
check(mitFehler.betreff.startsWith("⚠️ Agent-Alarm") && mitFehler.betreff.includes("Task down"),
  `Fehler + Pause: Alarm gewinnt — "${mitFehler.betreff}"`);

// Die andere Haelfte: morgen-versand muss die Zahl auch liefern. Spalte A = Typ, F = Status.
console.log("\n=== morgen-versand zählt, was auf Freigabe wartet ===");
const queue: unknown[][] = [
  ["Typ", "Name", "Stadt", "Kontakt", "Entwurf", "Status"],
  ["EMAIL", "a", "", "", "", "PRUEFEN"],
  ["EMAIL", "b", "", "", "", "DRAFT"],
  ["LINKEDIN", "c", "", "", "", "PRUEFEN"],
  ["EMAIL", "d", "", "", "", "PRUEFEN"],
  ["EMAIL", "e", "", "", "", "GESENDET"],
  [],
];
check(zaehleWartend(queue, "EMAIL") === 2, "2 EMAIL auf PRUEFEN, LinkedIn und Kopfzeile zählen nicht");
check(zaehleWartend([["Typ"]], "EMAIL") === 0, "leere Queue → 0");

// ─── Jeder Lauf genau einmal (Doppelmeldungen 15.10., 06.10., 30.09.) ────────
// Das Fenster war "65 Minuten ab jetzt": ein Lauf, der vor dem naechsten
// Monitor-Lauf fertig war, lag in zwei Fenstern und kam zweimal per Mail.
console.log("\n=== Fenster: jeder Lauf genau einmal ===");
const t = (s: string) => new Date(s);
const f1 = pruefFenster({ timestamp: t("2026-10-15T07:00:00Z"), lastTimestamp: t("2026-10-15T06:00:00Z") });
const f2 = pruefFenster({ timestamp: t("2026-10-15T08:00:00Z"), lastTimestamp: t("2026-10-15T07:00:00Z") });
const fertig = t("2026-10-15T07:00:49Z"); // morgen-versand 15.10.
check([f1, f2].filter((f) => imFenster(fertig, f)).length === 1, "Lauf von 07:00:49 liegt in genau einem Fenster");
check(imFenster(t("2026-10-15T07:00:00Z"), f2) && !imFenster(t("2026-10-15T07:00:00Z"), f1), "Grenze: Start inklusiv, Ende exklusiv");
check(!imFenster(null, f2), "ohne finishedAt kein Treffer");
const ohneLast = pruefFenster({ timestamp: t("2026-10-15T08:00:00Z") });
check(ohneLast.bis.getTime() - ohneLast.von.getTime() === 60 * 60_000, "erster Lauf ohne lastTimestamp: eine Stunde zurück");

console.log("\n--- So sieht die Mail bei reinem Leerlauf aus ---");
console.log(`Betreff: ${nurLeerlauf.betreff}`);
console.log(nurLeerlauf.text);
console.log("--- Ende ---");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
