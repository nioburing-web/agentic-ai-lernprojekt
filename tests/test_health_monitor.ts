// Tests für die Fehlertext-Aufbereitung des Agent-Health-Monitors.
// Kein Netzwerk, kein Trigger.dev, kein Brevo — nur die reine Funktion.
// Ausführen: npx tsx tests/test_health_monitor.ts
//
// Warum es diese Prüfung gibt: nacht-recherche fiel am 11.08. und am 17.08.2026
// aus. Der Health-Monitor hat beide Male korrekt angeschlagen und die Mail
// zugestellt — aber als Fehlertext stand beide Male "Kein Fehlertext im Run"
// drin, obwohl der Run einen hatte ("The service is currently unavailable."
// in sicherQueueTab, nacht-recherche.ts:70).
//
// Ursache, belegt an den SDK-Typen von @trigger.dev/core 4.4.4:
//   ListRunResponseItem (was runs.list() liefert)  → hat KEIN error-Feld
//   RetrieveRunResponse (was runs.retrieve() liefert) → hat error
// run.error?.message war also nie undefined-durch-Zufall, sondern immer
// undefined. Ohne Fehlertext muss man ins Dashboard, also tut man es nicht,
// also blieben beide Mails ungelesen und beide Ausfälle unbemerkt.

import { fehlertextAus } from "../src/trigger/agent-health-monitor";

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

// Der echte Fehler aus run_06g131itv29gmij9ekdcgoru01 (17.08.2026, wörtlich)
const echterFehler = {
  name: "Error",
  message: "The service is currently unavailable.",
  stackTrace:
    "Error: The service is currently unavailable.\n" +
    "    at Gaxios._request (file:///node_modules/gaxios/src/gaxios.ts:146:15)\n" +
    "    at processTicksAndRejections (node:internal/process/task_queues:95:5)\n" +
    "    at _JWT.requestAsync (file:///node_modules/google-auth-library/build/src/auth/oauth2client.js:429:18)\n" +
    "    at sicherQueueTab (file:///src/trigger/nacht-recherche.ts:70:20)\n" +
    "    at run (file:///src/trigger/nacht-recherche.ts:778:5)",
};

console.log("\n=== Der echte Ausfall vom 17.08.2026 ===");
const echt = fehlertextAus(echterFehler);
console.log(`       → ${echt}`);
check(echt.includes("The service is currently unavailable."), "nennt die Fehlermeldung");
check(echt.includes("nacht-recherche.ts:70"), "nennt die eigene Code-Stelle, nicht die von gaxios");
check(!echt.includes("Kein Fehlertext"), "faellt NICHT auf den Platzhalter zurueck");
check(!echt.includes("node_modules"), "zeigt keine Fremdbibliothek als Fundort");

console.log("\n=== Der Fall, der den Platzhalter rechtfertigt ===");
check(fehlertextAus(undefined) === "Kein Fehlertext im Run", "undefined → Platzhalter");
check(fehlertextAus({} as any) === "Kein Fehlertext im Run", "leeres Objekt → Platzhalter");
check(
  fehlertextAus({ message: "", name: "" } as any) === "Kein Fehlertext im Run",
  "leere Strings → Platzhalter"
);

console.log("\n=== Teilweise vorhandene Angaben ===");
check(
  fehlertextAus({ message: "Sheet nicht gefunden" }) === "Sheet nicht gefunden",
  "nur message → message pur, kein Rauschen angehaengt"
);
check(
  fehlertextAus({ name: "TimeoutError" } as any).includes("TimeoutError"),
  "nur name → name wird benutzt"
);
check(
  fehlertextAus({ name: "QuotaError", message: "Limit erreicht" }).startsWith("QuotaError: "),
  "aussagekraeftiger name wird vorangestellt"
);
check(
  fehlertextAus({ name: "Error", message: "Limit erreicht" }) === "Limit erreicht",
  "generisches 'Error' wird NICHT vorangestellt"
);

console.log("\n=== Stacktrace ohne eigenen Code ===");
const nurFremd = fehlertextAus({
  message: "Netzwerkfehler",
  stackTrace: "Error: Netzwerkfehler\n    at Gaxios._request (file:///node_modules/gaxios/src/gaxios.ts:146:15)",
});
console.log(`       → ${nurFremd}`);
check(nurFremd.includes("Netzwerkfehler"), "Meldung bleibt erhalten");
check(nurFremd.includes("gaxios"), "faellt auf den ersten Stack-Rahmen zurueck statt ihn zu verschlucken");

console.log("\n=== Laenge bleibt mailtauglich ===");
const lang = fehlertextAus({ message: "x".repeat(2000), stackTrace: "at foo (file:///src/a.ts:1:1)" });
check(lang.length <= 400, `gekuerzt auf ${lang.length} Zeichen (<= 400)`);
check(fehlertextAus({ message: "kurz" }).length < 20, "kurze Meldung wird nicht aufgeblaeht");

console.log("\n=== Einzeilig, damit die Mail lesbar bleibt ===");
check(!echt.includes("\n"), "enthaelt keinen Zeilenumbruch");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
