/**
 * Misst den dreischichtigen Prüfer (tools/pruefer.ts) gegen Nios Urteile.
 *
 * bike-method-phase: 1 — liest nur, schreibt nichts ins Sheet.
 * Adapted from The Three Ms of AI™ © 2026 Nate Herk.
 *
 * Getrennt nach Entwicklung (erstellt vor dem 20.09.) und Prüfung (ab 20.09.):
 * an den frühen Fällen darf man Regeln und Prompts anpassen, die späten zeigen,
 * ob das hält. Wer auf denselben Daten abstimmt und misst, misst sich selbst.
 *
 * Modell-Antworten werden zwischengespeichert (Schlüssel: Zeile + Text), damit
 * eine Änderung an den festen Regeln keinen neuen Modell-Lauf kostet.
 *
 *   npx tsx tools/pruefer-eval.ts --nur-regeln [--ab=01.09.2026]
 *   npx tsx tools/pruefer-eval.ts [--ab=15.09.2026] [--modell=claude-sonnet-5]
 */

import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { nioUrteil } from "./pruefer-backtest";
import { regelTreffer, grammatikBefunde, fitUrteil, istKeineKorrektur, PROMPT_VERSION, type PruefFall } from "./pruefer";

const arg = (name: string, standard: string): string =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? "").split("=").slice(1).join("=") || standard;
const NUR_REGELN = process.argv.includes("--nur-regeln");
// Nur zwischengespeicherte Modell-Antworten auswerten, kein API-Aufruf. Fälle ohne
// Eintrag fallen raus (27.09.: Lauf brach bei 126/161 am leeren Guthaben ab).
const NUR_CACHE = process.argv.includes("--nur-cache");
// Harter Deckel für neue (nicht zwischengespeicherte) Fälle. Seit dem 27.09.: ein
// Testlauf hat das API-Guthaben geleert, das auch die Live-Demos bezahlt.
const MAX_NEU = Number(arg("max-neu", "0")) || Infinity;
let neuGestartet = 0;
const AB = arg("ab", NUR_REGELN ? "01.09.2026" : "15.09.2026");
const MODELL = arg("modell", "claude-sonnet-5");
const GRENZE_PRUEFUNG = Date.UTC(2026, 8, 20);
const ORDNER = new URL("./.pruefer-backtest/", import.meta.url);

type Fall = PruefFall & { nr: number; erstellt: string; nio: "frei" | "verwerfen"; nioGrund: string };

function ladeEnv(): void {
  const roh = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const zeile of roh.split(/\r?\n/)) {
    const t = zeile.match(/^([A-Z0-9_]+)=(.*)$/);
    if (t) process.env[t[1] as string] ??= t[2] as string;
  }
}

function alsDatum(s: string): number {
  const m = s.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : NaN;
}

async function ladeFaelle(): Promise<Fall[]> {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const a = await googleSheets({ version: "v4", auth }).spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID as string,
    range: "Outreach Queue!A:U",
  });
  const ab = alsDatum(AB);
  const faelle: Fall[] = [];
  (a.data.values ?? []).forEach((roh, i) => {
    if (i === 0) return;
    const r = roh.map((x) => String(x ?? ""));
    if (r[0] !== "EMAIL" || !(alsDatum(r[6] ?? "") >= ab) || !(r[4] ?? "").trim()) return;
    const nio = nioUrteil((r[5] ?? "").trim(), r[9] ?? "");
    if (!nio) return;
    faelle.push({
      nr: i + 1, name: r[1] ?? "", stadt: r[2] ?? "", kontakt: r[3] ?? "", entwurf: r[4] ?? "",
      erstellt: r[6] ?? "", betreff: r[8] ?? "", nische: r[19] ?? "",
      nio, nioGrund: (r[9] ?? "").replace(/^.*Fit-Urteil — /, ""),
    });
  });
  return faelle;
}

function cache<T>(name: string) {
  mkdirSync(ORDNER, { recursive: true });
  const datei = new URL(`./cache_${name}.json`, ORDNER);
  const daten: Record<string, T> = existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : {};
  return {
    schluessel: (f: Fall) => `${f.nr}:${createHash("sha1").update(f.betreff + "\n" + f.entwurf).digest("hex").slice(0, 10)}`,
    get: (k: string) => daten[k],
    set: (k: string, v: T) => { daten[k] = v; },
    speichern: () => writeFileSync(datei, JSON.stringify(daten, null, 1)),
  };
}

type Ergebnis = Fall & { regeln: string[]; grammatik: string[]; fit: string | null; urteil: "frei" | "verwerfen" };

function bericht(titel: string, e: Ergebnis[]): void {
  const n = (nio: string, u: string) => e.filter((x) => x.nio === nio && x.urteil === u).length;
  const nein = e.filter((x) => x.nio === "verwerfen").length;
  console.log(`\n== ${titel}: ${e.length} Fälle (${e.length - nein} frei / ${nein} verworfen bei Nio) ==`);
  console.log(`  falsch frei: ${n("verwerfen", "frei")} von ${nein}   zu streng: ${n("frei", "verwerfen")} von ${e.length - nein}   einig: ${n("frei", "frei") + n("verwerfen", "verwerfen")}/${e.length}`);
  // Welche Schicht trägt was — getrennt, damit man sieht, wo Treffer und wo Lärm herkommt.
  for (const [schicht, hat] of [
    ["Regeln", (x: Ergebnis) => x.regeln.length > 0],
    ["Grammatik", (x: Ergebnis) => x.grammatik.length > 0],
    ["Fit", (x: Ergebnis) => x.fit !== null],
  ] as const) {
    const fang = e.filter((x) => x.nio === "verwerfen" && hat(x)).length;
    const laerm = e.filter((x) => x.nio === "frei" && hat(x)).length;
    console.log(`  ${schicht.padEnd(9)} fängt ${String(fang).padStart(3)} von ${nein} Verworfenen, meldet ${String(laerm).padStart(3)} von ${e.length - nein} Freigegebenen`);
  }
}

// Tests zahlen nie vom Guthaben der Live-Demos (27.09.2026: ein Backtest leerte es,
// beide Demo-Chats gaben danach nur noch die Rückfallantwort). Ohne eigenen
// Test-Key mit Ausgabenlimit läuft hier nichts — fail-closed, kein Rückfall auf
// ANTHROPIC_API_KEY.
function testClient(): Anthropic {
  const key = process.env.ANTHROPIC_TEST_API_KEY;
  if (!key) throw new Error("ANTHROPIC_TEST_API_KEY fehlt in .env — Tests laufen nur über den Test-Workspace mit Ausgabenlimit, nie über den Demo-Key.");
  return new Anthropic({ apiKey: key });
}

async function main(): Promise<void> {
  ladeEnv();
  const faelle = await ladeFaelle();
  console.log(`${faelle.length} Fälle ab ${AB}${NUR_REGELN ? " (nur feste Regeln)" : `, Modell ${MODELL}`}`);

  const client = NUR_REGELN || NUR_CACHE ? null : testClient();
  const gCache = cache<string[] | null>(`grammatik_${PROMPT_VERSION}_${MODELL}`);
  const fCache = cache<string | null>(`fit_${PROMPT_VERSION}_${MODELL}`);
  const ergebnisse: Ergebnis[] = [];
  const PARALLEL = 6;
  for (let i = 0; i < faelle.length; i += PARALLEL) {
    await Promise.all(faelle.slice(i, i + PARALLEL).map(async (f) => {
      const regeln = regelTreffer(f);
      let grammatik: string[] = [];
      let fit: string | null = null;
      if (NUR_CACHE) {
        const k = gCache.schluessel(f);
        const g = gCache.get(k), fu = fCache.get(k);
        if (g === undefined || fu === undefined) return;
        // Der Filter kam nach dem Lauf dazu — auf gespeicherte Meldungen nachträglich anwenden.
        grammatik = (g ?? []).filter((m) => {
          const t = m.match(/^„([\s\S]*)“ → „([\s\S]*)“$/);
          return !t || !istKeineKorrektur(t[1] as string, t[2] as string);
        });
        fit = fu ?? null;
      } else if (client) {
        const k = gCache.schluessel(f);
        const neu = gCache.get(k) === undefined || fCache.get(k) === undefined;
        if (neu && ++neuGestartet > MAX_NEU) return;
        let g = gCache.get(k);
        if (g === undefined) {
          const r = await grammatikBefunde(client, MODELL, f);
          g = r ? r.belegt : null;
          gCache.set(k, g);
        }
        grammatik = g ?? [];
        let fu = fCache.get(k);
        if (fu === undefined) {
          const r = await fitUrteil(client, MODELL, f);
          fu = r && r.urteil === "verwerfen" ? r.grund : null;
          fCache.set(k, fu);
        }
        fit = fu ?? null;
      }
      const urteil = regeln.length || grammatik.length || fit ? "verwerfen" : "frei";
      ergebnisse.push({ ...f, regeln, grammatik, fit, urteil });
    }));
    if (client) { gCache.speichern(); fCache.speichern(); process.stdout.write(`\r${ergebnisse.length}/${faelle.length}`); }
  }
  ergebnisse.sort((a, b) => a.nr - b.nr);

  const entw = ergebnisse.filter((x) => alsDatum(x.erstellt) < GRENZE_PRUEFUNG);
  const pruef = ergebnisse.filter((x) => alsDatum(x.erstellt) >= GRENZE_PRUEFUNG);
  bericht("ENTWICKLUNG (vor 20.09.)", entw);
  bericht("PRÜFUNG (ab 20.09.)", pruef);

  console.log("\n== FALSCH FREI ==");
  for (const x of ergebnisse.filter((x) => x.nio === "verwerfen" && x.urteil === "frei")) {
    console.log(`  ${x.nr} ${x.erstellt.slice(0, 5)} | ${x.name.slice(0, 30).padEnd(30)} | Nio: ${x.nioGrund.slice(0, 60)}`);
  }
  const out = new URL(`./eval_${NUR_REGELN ? "regeln" : `${PROMPT_VERSION}_${MODELL}`}.json`, ORDNER);
  writeFileSync(out, JSON.stringify(ergebnisse, null, 1));
  console.log(`\nDetails: ${out.pathname}`);
}

main().catch((f) => { console.error(f); process.exit(1); });
