/**
 * Prüfer-Backtest: urteilt ein Modell über die Entwürfe so wie Nio in der Freigabe-Runde?
 *
 * bike-method-phase: 1 — von Hand laufen lassen, nichts verdrahten.
 * Adapted from The Three Ms of AI™ © 2026 Nate Herk.
 *
 * Warum es das gibt (27.09.2026, /level-up): Die Freigabe-Runde ist der Engpass im
 * Versand. Bevor ein Agent auch nur vorsortieren darf, muss belegt sein, dass er
 * dieselben Entwürfe verwirft wie Nio. Die Wahrheit liegt schon im Sheet — jedes
 * Fit-Nein mit Grund in Spalte J, jede Freigabe als verschickte Zeile. Dieses
 * Werkzeug legt dem Modell genau diese Entwürfe blind vor und zählt, wo es abweicht.
 *
 * Stufe 1 von 3. Liest nur (Scope `spreadsheets.readonly`), schreibt nichts ins
 * Sheet, deployt nichts. Das Modell sieht weder Status noch Grund.
 *
 * Die Zahl, die zählt, ist nicht die Übereinstimmung, sondern "falsch frei":
 * ein Entwurf, den Nio verworfen hat und das Modell durchlässt. Der ginge später
 * ungelesen raus. Ein zu strenges Modell kostet Lesezeit, ein zu laxes den Ruf.
 *
 * Zählen:  npx tsx tools/pruefer-backtest.ts [--ab=15.09.2026]
 * Laufen:  npx tsx tools/pruefer-backtest.ts --lauf [--ab=15.09.2026] [--modell=claude-haiku-4-5]
 */

import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const QUEUE_TAB = "Outreach Queue";
const LAUF = process.argv.includes("--lauf");
const arg = (name: string, standard: string): string =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? "").split("=").slice(1).join("=") || standard;
const AB = arg("ab", "15.09.2026");
const MODELL = arg("modell", "claude-haiku-4-5");

// Verschickt heißt: Nio hat die Zeile in der Freigabe-Runde durchgelassen. Seit dem
// 27.08. läuft jede Zeile über PRUEFEN (`imTest: true`), einen anderen Weg gibt es nicht.
const FREIGEGEBEN = new Set(["GESENDET", "NACHGEFASST_1", "INTERESSIERT", "ABGELEHNT", "ABWESEND"]);

function ladeEnv(): void {
  const roh = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const zeile of roh.split(/\r?\n/)) {
    const treffer = zeile.match(/^([A-Z0-9_]+)=(.*)$/);
    if (treffer) process.env[treffer[1] as string] ??= treffer[2] as string;
  }
}

function alsDatum(ddmmyyyy: string): number {
  const m = ddmmyyyy.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : NaN;
}

type Fall = {
  nr: number; name: string; stadt: string; kontakt: string; betreff: string;
  entwurf: string; nische: string; erstellt: string;
  nio: "frei" | "verwerfen"; nioGrund: string;
};

// Nur Nios eigene Urteile. "Regelbefund auch nach drei Neufassungen" und
// "Neufassung unmöglich" hat die Mechanik entschieden, nicht das Lesen.
export function nioUrteil(status: string, grundJ: string): Fall["nio"] | null {
  if (FREIGEGEBEN.has(status)) return "frei";
  if (status === "VERWORFEN" && grundJ.includes("Fit-Urteil") && !/Regelbefund/i.test(grundJ)) return "verwerfen";
  return null;
}

const SYSTEM = `Du prüfst Kaltakquise-Entwürfe von NIO Automation (KI-Assistenten für kleine Betriebe) vor dem Versand. Ein Mensch gibt nur frei, was er ohne Scham unter seinem Namen verschicken würde.

Hausstil, KEIN Fehler: Es gibt zwei gültige Register, je nach Branche — "Hey," mit durchgehend "ihr/euch", oder "Guten Tag," mit durchgehend "Sie". Beide sind richtig. Betreffzeilen sind absichtlich komplett kleingeschrieben. Ein Gedankenstrich ist erlaubt. Ein Link zur Demo gehört dazu.

Verwirf, wenn mindestens eins zutrifft:
1. Grammatik: Tippfehler, falscher Kasus, kaputter Satzbau, unsinnige Sätze, Reste einer Anweisung an ein Modell.
2. Firmenname so wörtlich aus Google Maps übernommen, wie ihn kein Mensch schreiben würde: mit Rechtsform (GmbH, e.K., UG), mit Zusätzen nach | oder - , mit Slogan, als englische Übersetzung, abgehackt.
3. Anrede: fehlt, wechselt innerhalb der Mail zwischen du/ihr/Sie, oder der Betreff redet anders an als der Text (Betreff mit "ihr/eure", Text mit "Sie").
4. Betreff passt nicht zum Text, ist irreführend oder grammatisch falsch.
5. Eine Behauptung über den Betrieb, die erfunden wirkt, oder ein Aufhänger, der nicht zu einem Chat-Assistenten für die Website passt.
6. Kein passender Empfänger: Kette, Konzern, überregionale AG, Klinik, oder die Adresse ist offensichtlich kein Betriebs-Postfach (Datenschutz, Compliance, Bewerbung).

Sonst frei. Im Zweifel verwerfen.

Antworte nur mit JSON, ohne Codeblock: {"urteil":"frei"|"verwerfen","grund":"<ein kurzer Satz>"}`;

function nachricht(f: Fall): string {
  return [
    `Betrieb: ${f.name} (${f.stadt}), Nische: ${f.nische}`,
    `Empfänger: ${f.kontakt}`,
    `Betreff: ${f.betreff}`,
    `Entwurf:\n${f.entwurf}`,
  ].join("\n");
}

export function leseUrteil(text: string): { urteil: "frei" | "verwerfen"; grund: string } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    if (j.urteil !== "frei" && j.urteil !== "verwerfen") return null;
    return { urteil: j.urteil, grund: String(j.grund ?? "") };
  } catch {
    return null;
  }
}

async function urteile(client: Anthropic, f: Fall): Promise<{ urteil: "frei" | "verwerfen" | "kaputt"; grund: string }> {
  for (let versuch = 0; versuch < 2; versuch++) {
    const r = await client.messages.create({
      model: MODELL,
      max_tokens: 1000,
      // Neuere Modelle lehnen `temperature` mit 400 ab (Sonnet 5, 27.09.2026).
      ...(MODELL.includes("haiku") ? { temperature: 0 } : {}),
      system: SYSTEM,
      messages: [{ role: "user", content: nachricht(f) }],
    });
    const text = r.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const u = leseUrteil(text);
    if (u) return u;
  }
  return { urteil: "kaputt", grund: "keine lesbare Antwort nach zwei Versuchen" };
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
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = googleSheets({ version: "v4", auth });
  const antwort = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID as string,
    range: `${QUEUE_TAB}!A:U`,
  });
  const rohzeilen = antwort.data.values ?? [];
  const ab = alsDatum(AB);

  const faelle: Fall[] = [];
  for (let i = 1; i < rohzeilen.length; i++) {
    const r = (rohzeilen[i] ?? []).map((x) => String(x ?? ""));
    if (r[0] !== "EMAIL" || !(alsDatum(r[6] ?? "") >= ab)) continue;
    const nio = nioUrteil((r[5] ?? "").trim(), r[9] ?? "");
    if (!nio || !(r[4] ?? "").trim()) continue;
    faelle.push({
      nr: i + 1, name: r[1] ?? "", stadt: r[2] ?? "", kontakt: r[3] ?? "", entwurf: r[4] ?? "",
      erstellt: r[6] ?? "", betreff: r[8] ?? "", nische: r[19] ?? "",
      nio, nioGrund: (r[9] ?? "").replace(/^.*Fit-Urteil — /, ""),
    });
  }

  const nein = faelle.filter((f) => f.nio === "verwerfen").length;
  console.log(`${faelle.length} Fälle ab ${AB}: ${faelle.length - nein} freigegeben, ${nein} verworfen (Nios Urteil)`);
  if (!LAUF) {
    console.log(`Zählung. Zum Ausführen: npx tsx tools/pruefer-backtest.ts --lauf --ab=${AB} --modell=${MODELL}`);
    return;
  }

  const client = testClient();
  const ergebnisse: Array<Fall & { modell: string; modellGrund: string }> = [];
  const PARALLEL = 5;
  for (let i = 0; i < faelle.length; i += PARALLEL) {
    const block = faelle.slice(i, i + PARALLEL);
    const urteile_ = await Promise.all(block.map((f) => urteile(client, f)));
    block.forEach((f, k) => ergebnisse.push({ ...f, modell: urteile_[k]!.urteil, modellGrund: urteile_[k]!.grund }));
    process.stdout.write(`\r${ergebnisse.length}/${faelle.length}`);
  }
  console.log("\n");

  const zaehle = (nio: string, modell: string) => ergebnisse.filter((e) => e.nio === nio && e.modell === modell).length;
  const falschFrei = ergebnisse.filter((e) => e.nio === "verwerfen" && e.modell === "frei");
  const falschVerworfen = ergebnisse.filter((e) => e.nio === "frei" && e.modell === "verwerfen");
  const kaputt = ergebnisse.filter((e) => e.modell === "kaputt");
  const einig = ergebnisse.filter((e) => e.nio === e.modell).length;

  console.log(`== ${MODELL} gegen Nio, ${ergebnisse.length} Fälle ab ${AB} ==`);
  console.log(`                  Modell frei   Modell verwerfen`);
  console.log(`  Nio frei        ${String(zaehle("frei", "frei")).padStart(11)}   ${String(zaehle("frei", "verwerfen")).padStart(16)}`);
  console.log(`  Nio verwerfen   ${String(zaehle("verwerfen", "frei")).padStart(11)}   ${String(zaehle("verwerfen", "verwerfen")).padStart(16)}`);
  console.log(`  Einig: ${einig}/${ergebnisse.length} (${Math.round((100 * einig) / ergebnisse.length)} %), unlesbar: ${kaputt.length}`);
  console.log(`  FALSCH FREI (muss 0 sein): ${falschFrei.length} von ${nein} Verworfenen`);
  console.log(`  zu streng: ${falschVerworfen.length} von ${faelle.length - nein} Freigegebenen\n`);

  // Nach Kohorte, nicht nur im Schnitt: ein Tag mit anderer Nische oder anderem
  // Schreiber kann im Mittel verschwinden.
  console.log("== nach Erstellt-Datum ==");
  const tage = [...new Set(ergebnisse.map((e) => e.erstellt))].sort((a, b) => alsDatum(a) - alsDatum(b));
  for (const t of tage) {
    const tag = ergebnisse.filter((e) => e.erstellt === t);
    const ff = tag.filter((e) => e.nio === "verwerfen" && e.modell === "frei").length;
    console.log(`  ${t}: ${tag.length} Fälle, einig ${tag.filter((e) => e.nio === e.modell).length}, falsch frei ${ff}`);
  }

  console.log("\n== FALSCH FREI im Einzelnen ==");
  for (const e of falschFrei) console.log(`  ${e.nr} | ${e.name.slice(0, 32).padEnd(32)} | Nio: ${e.nioGrund.slice(0, 70)}`);

  mkdirSync(new URL("./.pruefer-backtest/", import.meta.url), { recursive: true });
  const datei = new URL(`./.pruefer-backtest/${new Date().toISOString().slice(0, 10)}_${MODELL}.json`, import.meta.url);
  writeFileSync(datei, JSON.stringify(ergebnisse, null, 2));
  console.log(`\nAlle Urteile: ${datei.pathname}`);
}

// Nur beim direkten Aufruf laufen — pruefer-eval.ts importiert nioUrteil.
if (/pruefer-backtest/.test(process.argv[1] ?? "")) {
  main().catch((fehler) => {
    console.error(fehler);
    process.exit(1);
  });
}
