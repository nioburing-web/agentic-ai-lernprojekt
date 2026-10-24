/**
 * Echte Probe der OpenRouter-Ausweichroute.
 *
 * Warum es das gibt (24.10.2026): Die Unit-Tests in tests/test_ki_client.ts
 * belegen nur, dass umgeschaltet wird — nicht, dass am anderen Ende jemand
 * antwortet. Ob OpenRouter mit "nur openai, keine Rückfälle" die beiden Modelle
 * überhaupt ausliefert, zeigt nur eine echte Anfrage. Und die Antwort muss
 * inhaltlich stimmen: Am 24.09. gab der Demo-Chat 7/7 nur die Rückfallantwort
 * bei HTTP 200.
 *
 * Der Direktweg scheitert hier absichtlich mit einem ungültigen Schlüssel, so
 * läuft der ganze Pfad durch kiChat — Fehlererkennung, Umschalten, Provider-
 * Routing. Kostet pro Lauf unter einen Cent OpenRouter-Guthaben.
 *
 *   npx tsx tools/ausweich-probe.ts
 */

import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { kiChat, ausweichStand, setzeAusweichZurueck } from "../src/trigger/ki-client";
import type { KiParams } from "../src/trigger/ki-client";

function ladeEnv(): void {
  const roh = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const zeile of roh.split(/\r?\n/)) {
    const treffer = zeile.match(/^([A-Z0-9_]+)=(.*)$/);
    if (treffer) process.env[treffer[1] as string] ??= treffer[2] as string;
  }
}

const FRAGE = [{ role: "user" as const, content: "Antworte nur mit dem Wort: Ausweichroute" }];
const PROBEN: KiParams[] = [
  { model: "gpt-6-luna", reasoning_effort: "low", max_completion_tokens: 300, messages: FRAGE } as KiParams,
  { model: "gpt-4o-mini", max_tokens: 20, temperature: 0, messages: FRAGE },
];

async function main(): Promise<void> {
  ladeEnv();
  if (!process.env.OPENROUTER_API_KEY) { console.log("FEHL: OPENROUTER_API_KEY fehlt in .env"); process.exit(1); }

  const kaputt = new OpenAI({ apiKey: "sk-ungueltig-probe", maxRetries: 0 });
  let fehl = 0;
  for (const p of PROBEN) {
    setzeAusweichZurueck();
    try {
      const r = await kiChat(p, { direkt: kaputt, timeoutMs: 60000 });
      const inhalt = r.choices[0]?.message?.content ?? "";
      const stand = ausweichStand();
      const ok = /ausweichroute/i.test(inhalt) && stand.umgeschaltet === 1;
      if (!ok) fehl++;
      console.log(`${ok ? "OK  " : "FEHL"} ${p.model}: Inhalt "${inhalt.slice(0, 40)}", umgeschaltet ${stand.umgeschaltet}, Grund ${stand.gruende.join(",") || "-"}`);
    } catch (e) {
      fehl++;
      const f = e as { status?: unknown; name?: unknown };
      console.log(`FEHL ${p.model}: ${String(f.name ?? "Fehler")} Status ${String(f.status ?? "-")}, beideTot ${ausweichStand().beideTot}`);
    }
  }
  process.exit(fehl > 0 ? 1 : 0);
}

main();
