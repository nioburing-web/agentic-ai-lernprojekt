// Tests für die OpenRouter-Ausweichroute (src/trigger/ki-client.ts).
// Kein Netzwerk — die Klienten sind Attrappen mit chat.completions.create.
// Ausführen: npx tsx tests/test_ki_client.ts
//
// Warum es diese Prüfung gibt (24.10.2026): Alle produktiven Agenten hängen an
// einem einzigen OPENAI_API_KEY. Fällt er aus, steht dieselbe Nacht Recherche,
// Antworten und Nachfass still. Die Ausweichroute schickt dann dieselbe Anfrage
// an dasselbe Modell über OpenRouter — aber nur bei echten Ausfällen, nie bei
// einem kaputten Prompt (400), sonst bezahlt man einen Bug doppelt.

import OpenAI from "openai";
import {
  istAusfall, ausweichGrund, fuerOpenRouter, kiChat, ausweichStand, setzeAusweichZurueck,
  direktWiederholungen, AUSWEICH_WIEDERHOLUNGEN,
} from "../src/trigger/ki-client";
import type { KiKlient } from "../src/trigger/ki-client";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

function antwort(text: string) {
  return { id: "x", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", content: text, refusal: null } }] } as any;
}

type Attrappe = KiKlient & { aufrufe: any[] };
function klient(verhalten: () => any): Attrappe {
  const aufrufe: any[] = [];
  return {
    aufrufe,
    chat: { completions: { create: async (p: any) => { aufrufe.push(p); return verhalten(); } } },
  };
}
const liefert = (text: string) => klient(() => antwort(text));
const wirft = (fehler: unknown) => klient(() => { throw fehler; });

const NACHRICHT = [{ role: "user" as const, content: "hallo" }];

async function main(): Promise<void> {
  // ─── istAusfall ──────────────────────────────────────────────────────────
  for (const s of [401, 403, 429, 500, 503]) check(istAusfall({ status: s }), `Status ${s} ist Ausfall`);
  check(istAusfall({ code: "ETIMEDOUT" }), "ETIMEDOUT ist Ausfall");
  check(istAusfall(new Error("Request timed out.")), "Timeout-Text ist Ausfall");
  // Echte SDK-Klassen, keine Attrappe: das openai-SDK setzt `name` nicht, die
  // Klasse erkennt man nur über instanceof (Review 24.10.).
  check(istAusfall(new OpenAI.APIConnectionError({ cause: new Error("ECONNRESET") })), "echter APIConnectionError ist Ausfall");
  check(istAusfall(new OpenAI.APIConnectionTimeoutError()), "echter APIConnectionTimeoutError ist Ausfall");

  // ─── SDK-Wiederholungen ──────────────────────────────────────────────────
  // Mit Ausweiche wiederholt der Direktweg nicht selbst — sonst kostet ein
  // hängendes OpenAI 3x den Timeout, bevor OpenRouter überhaupt gefragt wird.
  check(direktWiederholungen(true) === 0, "mit Ausweiche: Direktweg 0 SDK-Wiederholungen");
  check(direktWiederholungen(false) === 2, "ohne Ausweiche: SDK-Standard 2 wie heute");
  check(AUSWEICH_WIEDERHOLUNGEN === 1, "Ausweiche: 1 SDK-Wiederholung");
  for (const s of [400, 404]) check(!istAusfall({ status: s }), `Status ${s} ist KEIN Ausfall`);
  check(!istAusfall(new Error("Ungültige Kategorie")), "fachlicher Fehler ist KEIN Ausfall");
  check(ausweichGrund({ status: 401 }) === "401", "Grund für 401 ist \"401\"");

  // ─── fuerOpenRouter ──────────────────────────────────────────────────────
  const eingabe = { model: "gpt-6-luna", reasoning_effort: "low", max_completion_tokens: 4000, messages: NACHRICHT } as any;
  const kopieVorher = JSON.stringify(eingabe);
  const or = fuerOpenRouter(eingabe) as any;
  check(or.model === "openai/gpt-6-luna", "Modell bekommt Präfix openai/");
  check(or.reasoning_effort === "low" && or.max_completion_tokens === 4000, "Reasoning-Parameter bleiben erhalten");
  check(JSON.stringify(or.provider) === JSON.stringify({ only: ["openai"], allow_fallbacks: false }), "Provider-Routing nur openai, keine Rückfälle");
  check(!("zdr" in or), "kein zdr-Parameter");
  check(JSON.stringify(eingabe) === kopieVorher, "Eingabeobjekt bleibt unverändert");

  // ─── kiChat: Normalweg ───────────────────────────────────────────────────
  setzeAusweichZurueck();
  let direkt = liefert("direkt"); let ausweich = liefert("ausweich");
  let r = await kiChat({ model: "gpt-4o-mini", messages: NACHRICHT }, { direkt, ausweich });
  check(r.choices[0]?.message?.content === "direkt", "Normalweg: Antwort kommt direkt");
  check(ausweich.aufrufe.length === 0, "Normalweg: Ausweiche nicht aufgerufen");
  check(JSON.stringify(ausweichStand()) === JSON.stringify({ umgeschaltet: 0, gruende: [], beideTot: 0 }), "Normalweg: Stand null");

  // ─── kiChat: 401 → Ausweiche ─────────────────────────────────────────────
  setzeAusweichZurueck();
  direkt = wirft({ status: 401 }); ausweich = liefert("ausweich");
  r = await kiChat({ model: "gpt-4o-mini", messages: NACHRICHT }, { direkt, ausweich });
  check(r.choices[0]?.message?.content === "ausweich", "401: Antwort kommt von der Ausweiche");
  check(ausweich.aufrufe[0]?.model === "openai/gpt-4o-mini", "401: Ausweiche bekam openai/gpt-4o-mini");
  check(ausweichStand().umgeschaltet === 1 && JSON.stringify(ausweichStand().gruende) === '["401"]', "401: Stand umgeschaltet 1, Grund 401");

  // Klebt für den Rest des Laufs
  r = await kiChat({ model: "gpt-4o-mini", messages: NACHRICHT }, { direkt, ausweich });
  check(direkt.aufrufe.length === 1, "klebt: Direktweg nicht erneut versucht");
  check(ausweichStand().umgeschaltet === 2, "klebt: Stand umgeschaltet 2");

  // Zurücksetzen (neuer Lauf im warmen Prozess)
  setzeAusweichZurueck();
  check(JSON.stringify(ausweichStand()) === JSON.stringify({ umgeschaltet: 0, gruende: [], beideTot: 0 }), "Zurücksetzen: Stand null");
  direkt = liefert("direkt");
  r = await kiChat({ model: "gpt-4o-mini", messages: NACHRICHT }, { direkt, ausweich });
  check(direkt.aufrufe.length === 1 && r.choices[0]?.message?.content === "direkt", "Zurücksetzen: wieder zuerst direkt");

  // ─── 400 schaltet nicht um ───────────────────────────────────────────────
  setzeAusweichZurueck();
  const f400 = { status: 400 };
  direkt = wirft(f400); ausweich = liefert("ausweich");
  let geworfen: unknown = null;
  try { await kiChat({ model: "gpt-4o-mini", messages: NACHRICHT }, { direkt, ausweich }); } catch (e) { geworfen = e; }
  check(geworfen === f400, "400: derselbe Fehler fliegt");
  check(ausweich.aufrufe.length === 0 && ausweichStand().umgeschaltet === 0, "400: keine Ausweiche");

  // ─── 200 mit leerem Inhalt schaltet nicht um ─────────────────────────────
  setzeAusweichZurueck();
  direkt = liefert(""); ausweich = liefert("ausweich");
  r = await kiChat({ model: "gpt-4o-mini", messages: NACHRICHT }, { direkt, ausweich });
  check(r.choices[0]?.message?.content === "" && ausweich.aufrufe.length === 0, "leerer Inhalt: kein Umschalten");

  // ─── kein Key → wie heute ────────────────────────────────────────────────
  setzeAusweichZurueck();
  const f429 = { status: 429 };
  geworfen = null;
  try { await kiChat({ model: "gpt-4o-mini", messages: NACHRICHT }, { direkt: wirft(f429), ausweich: null }); } catch (e) { geworfen = e; }
  check(geworfen === f429, "kein Key: 429 fliegt wie heute");
  check(ausweichStand().umgeschaltet === 0 && ausweichStand().beideTot === 0, "kein Key: Stand null");

  // ─── beide tot ───────────────────────────────────────────────────────────
  setzeAusweichZurueck();
  const f401 = { status: 401 };
  geworfen = null;
  try { await kiChat({ model: "gpt-4o-mini", messages: NACHRICHT }, { direkt: wirft(f401), ausweich: wirft({ status: 500 }) }); } catch (e) { geworfen = e; }
  check(geworfen === f401, "beide tot: der ursprüngliche 401 fliegt");
  check(ausweichStand().beideTot === 1, "beide tot: beideTot 1");

  // ─── Ausweiche fällt aus, nachdem schon umgeschaltet war ─────────────────
  // Sonst bliebe der zweite Ausfall unsichtbar: der Lauf klebt an OpenRouter,
  // OpenRouter ist leer, und der Monitor sähe nur "umgeschaltet".
  setzeAusweichZurueck();
  let ausweichKaputt = false;
  const wankend = klient(() => { if (ausweichKaputt) throw { status: 402 }; return antwort("ausweich"); });
  await kiChat({ model: "gpt-4o-mini", messages: NACHRICHT }, { direkt: wirft({ status: 401 }), ausweich: wankend });
  ausweichKaputt = true;
  geworfen = null;
  try { await kiChat({ model: "gpt-4o-mini", messages: NACHRICHT }, { direkt: wirft({ status: 401 }), ausweich: wankend }); } catch (e) { geworfen = e; }
  check(geworfen !== null, "klebt + Ausweiche kaputt: Fehler fliegt");
  check(ausweichStand().beideTot === 1, "klebt + Ausweiche kaputt: beideTot 1");

  // ─── ausweichStand ist eine Kopie ────────────────────────────────────────
  setzeAusweichZurueck();
  ausweichStand().gruende.push("manipuliert");
  check(ausweichStand().gruende.length === 0, "ausweichStand gibt eine Kopie zurück");

  console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
  if (fehlgeschlagen > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
