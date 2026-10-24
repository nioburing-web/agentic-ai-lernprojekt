// Prüft, dass die vier produktiven Agenten ihre KI-Aufrufe über kiChat machen
// und den Ausweichstand in jeder Lauf-Ausgabe zurückgeben.
// Kein Netzwerk — liest die Quelltexte.
// Ausführen: npx tsx tests/test_ki_umstellung.ts
//
// Warum es diese Prüfung gibt (24.10.2026): Die Ausweichroute wirkt nur, wo
// sie aufgerufen wird. Ein einziger übersehener `client.chat.completions.create`
// ist ein Agent, der bei einem OpenAI-Ausfall trotzdem stumm wird — und der
// Health-Monitor sieht vom Umschalten nur, was in der Lauf-Ausgabe steht.
// Ohne setzeAusweichZurueck() am Laufanfang erbt ein warmer Prozess den
// Umschaltzustand des Vorlaufs.

import { readFileSync } from "node:fs";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

const TASKS = ["nacht-recherche", "reply-classifier", "nachfass-versand", "sofort-antwort"];
const quelle = (t: string) => readFileSync(new URL(`../src/trigger/${t}.ts`, import.meta.url), "utf8");
const anzahl = (text: string, muster: RegExp) => (text.match(muster) ?? []).length;

/** Text von `run: async` bis zum Ende der Datei, zeilenweise. */
function runZeilen(text: string): string[] {
  const zeilen = text.split(/\r?\n/);
  const start = zeilen.findIndex((z) => /run: async/.test(z));
  return start < 0 ? [] : zeilen.slice(start);
}

for (const t of TASKS) {
  const text = quelle(t);
  const erwartetCreate = t === "nacht-recherche" ? 1 : 0; // gpt4oMiniSchreiber bleibt für den Modellvergleich
  check(anzahl(text, /chat\.completions\.create/g) === erwartetCreate, `${t}: ${erwartetCreate}x chat.completions.create`);
  if (t !== "nacht-recherche") check(!/new OpenAI\(/.test(text), `${t}: kein new OpenAI( mehr`);
  check(/from "\.\/ki-client"/.test(text), `${t}: importiert ./ki-client`);

  const run = runZeilen(text);
  const reset = run.slice(0, 15).some((z) => /setzeAusweichZurueck\(\)/.test(z));
  check(reset, `${t}: setzeAusweichZurueck() in den ersten 15 Zeilen von run`);

  // Jede return-Anweisung im run-Block (bis zur schließenden Task-Klammer).
  const ende = run.findIndex((z, i) => i > 0 && /^\}\);/.test(z));
  const block = run.slice(0, ende < 0 ? run.length : ende);
  const returns = block.filter((z) => /^\s*return\b/.test(z));
  check(returns.length > 0, `${t}: run hat mindestens ein return`);
  // Mehrzeilige returns: die Zeile selbst oder die nächsten 8 Zeilen enthalten ausweichroute.
  const ohne = block
    .map((z, i) => ({ z, i }))
    .filter(({ z }) => /^\s*return\b/.test(z))
    .filter(({ i }) => !block.slice(i, i + 9).join("\n").match(/ausweichroute/));
  check(ohne.length === 0, `${t}: jedes return in run enthält ausweichroute${ohne.length ? ` (fehlt: ${ohne.map((o) => o.z.trim()).join(" | ")})` : ""}`);
}

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
if (fehlgeschlagen > 0) process.exit(1);
