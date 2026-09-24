/**
 * Modellvergleich für die Outreach-Entwürfe: dieselben Leads, dieselbe
 * Prüfstrecke, verschiedene Schreiber. Nio liest blind.
 *
 * Warum es das gibt (24.09.2026, /level-up): Grammatik war seit dem 15.09. der
 * häufigste Grund, beim Fit-Lesen zu verwerfen (34 Mal, am 22.09. allein 9).
 * Die Hälfte der gelesenen Entwürfe fiel durch, der Versand-Puffer lief leer.
 * Verdacht: `gpt-4o-mini` bei temperature 0.9. Ein Verdacht ist kein Befund,
 * also erst messen, dann umstellen. Entscheidung: decisions/log.md, 24.09.2026.
 *
 * Genommen werden nur Zeilen, die schon ein Mensch gelesen hat: beim Fit-Lesen
 * verworfene und freigegebene aus der Zeit nach dem Namens-Fix (15.09.). So
 * vergleichen die Modelle auf Betrieben, deren alte Fassung ein Urteil hat.
 *
 *   npx tsx --env-file=.env tools/modell-vergleich.ts [--anzahl=8] [--modelle=4o-mini,luna,haiku]
 *     Schreibt pro Zeile je Modell einen Entwurf, legt die Lesefassung nach
 *     tools/.modell-vergleich/lesefassung.md und den Schlüssel daneben.
 *     Rührt das Sheet nicht an. Kostet LLM-Aufrufe (bis zu 7 pro Entwurf).
 *
 *   npx tsx tools/modell-vergleich.ts --auswerten
 *     Liest die angekreuzte Lesefassung und zählt pro Modell. Kostet nichts.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  generiereEmailEntwurf, holeWebsiteText, standardSchreiber,
} from "../src/trigger/nacht-recherche";
import type { Schreiber } from "../src/trigger/nacht-recherche";
import { nameFuerMail } from "../src/trigger/entwurf-qualitaet";
import { KATEGORIEN } from "../src/trigger/nischen";
import type { Kategorie, Nische } from "../src/trigger/nischen";
import { regelBefunde, zeilenAusArgument } from "./freigabe-pruefung";
import {
  blindeReihenfolge, buchstabe, leseUrteile, zaehleProModell, URTEIL_ZEILE,
} from "./modell-vergleich-auswertung";
import type { Schluesseleintrag } from "./modell-vergleich-auswertung";

const ORDNER = "tools/.modell-vergleich";
const LESEFASSUNG = `${ORDNER}/lesefassung.md`;
const SCHLUESSEL = `${ORDNER}/schluessel.json`;
const MIN_WEBSITE_TEXT = 300; // gleiches Quality-Gate wie in nacht-recherche
const AB_DATUM = new Date(2026, 8, 15); // Namens-Fix 14.09., vorher lag ein anderer Fehler oben

const arg = (name: string): string =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) ?? "").split("=").slice(1).join("=");
const ANZAHL = Number.parseInt(arg("anzahl") || "8", 10);
const NUR_ZEILEN = zeilenAusArgument(arg("zeilen"));
const AUSWERTEN = process.argv.includes("--auswerten");

// ── Die Schreiber ─────────────────────────────────────────────────────────────

function lunaSchreiber(): Schreiber {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 120000 });
  // Ein Reasoning-Modell: kein temperature, das Tokenlimit zählt das Denken mit.
  return async (nachrichten) => {
    const c = await openai.chat.completions.create({
      model: "gpt-6-luna",
      reasoning_effort: "low",
      max_completion_tokens: 4000,
      messages: nachrichten,
    });
    return c.choices[0]?.message?.content?.trim() ?? "";
  };
}

function haikuSchreiber(): Schreiber {
  const client = new Anthropic();
  return async (nachrichten) => {
    const system = nachrichten.filter((n) => n.role === "system").map((n) => n.content).join("\n\n");
    const rest = nachrichten.filter((n) => n.role !== "system").map((n) => ({ role: "user" as const, content: n.content }));
    const r = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1000,
      system,
      messages: rest,
    });
    return r.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  };
}

const SCHREIBER: Record<string, () => Schreiber> = {
  "4o-mini": standardSchreiber,
  luna: lunaSchreiber,
  haiku: haikuSchreiber,
};

// ── Auswahl ───────────────────────────────────────────────────────────────────

type Zeile = {
  nr: number; firma: string; stadt: string; email: string; altEntwurf: string;
  demoId: string; kategorie: Kategorie; nische: Nische; link: string; herkunft: string;
};

function findeNische(name: string): { k: Kategorie; n: Nische } | null {
  for (const k of KATEGORIEN) {
    const n = k.nischen.find((x) => x.name === name);
    if (n) return { k, n };
  }
  return null;
}

function datumAus(feld: string): Date | null {
  const m = feld.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

function linkAusEntwurf(entwurf: string, demoId: string): string | null {
  for (const t of entwurf.match(/https?:\/\/[^\s<>"')]+/g) ?? []) {
    if (t.includes(demoId)) return t.replace(/[.,;:]+$/, "");
  }
  return null;
}

async function ladeQueue(): Promise<unknown[][]> {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const s = googleSheets({ version: "v4", auth: auth as never });
  const r = await s.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID as string,
    range: "Outreach Queue!A:U",
  });
  return (r.data.values ?? []) as unknown[][];
}

function waehleZeilen(rows: unknown[][]): Zeile[] {
  const grammatik: Zeile[] = [];
  const frei: Zeile[] = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    const r = rows[i] ?? [];
    const f = (n: number) => String(r[n] ?? "");
    const nr = i + 1;
    const status = f(5).trim();
    const grund = f(9);
    const datum = datumAus(f(6));
    const treffer = findeNische(f(19));
    const demoId = f(17).trim();
    const link = demoId ? linkAusEntwurf(f(4), demoId) : null;
    if (!treffer || !link || !datum) continue;
    let herkunft = "";
    if (NUR_ZEILEN.size > 0) {
      if (!NUR_ZEILEN.has(nr)) continue;
      herkunft = status;
    } else {
      if (datum < AB_DATUM) continue;
      if (status === "VERWORFEN" && /Fit-Urteil/.test(grund) && /grammatik|tippfehler|kasus|satzbau/i.test(grund)) herkunft = "verworfen (Grammatik)";
      else if (status === "GESENDET" || status.startsWith("NACHGEFASST") || status === "DRAFT") herkunft = "freigegeben";
      else continue;
    }
    const z: Zeile = {
      nr, firma: f(1), stadt: f(2), email: f(3), altEntwurf: f(4), demoId,
      kategorie: treffer.k, nische: treffer.n, link, herkunft,
    };
    (herkunft.startsWith("verworfen") ? grammatik : frei).push(z);
  }
  if (NUR_ZEILEN.size > 0) return [...grammatik, ...frei];
  // Halb und halb: sonst misst man nur, ob ein Modell schlechte Fälle rettet,
  // und nicht, ob es gute verdirbt.
  const halb = Math.ceil(ANZAHL / 2);
  return [...grammatik.slice(0, halb), ...frei.slice(0, ANZAHL - Math.min(halb, grammatik.length))];
}

// ── Auswerten ─────────────────────────────────────────────────────────────────

function auswerten(): void {
  if (!existsSync(LESEFASSUNG) || !existsSync(SCHLUESSEL)) {
    throw new Error(`${LESEFASSUNG} oder ${SCHLUESSEL} fehlt — erst den Vergleichslauf fahren`);
  }
  const schluessel: Schluesseleintrag[] = JSON.parse(readFileSync(SCHLUESSEL, "utf-8"));
  const urteile = leseUrteile(readFileSync(LESEFASSUNG, "utf-8"));
  const z = zaehleProModell(schluessel, urteile);
  console.log("Modell      frei  grammatik  anderes  offen  | Regelbefund");
  for (const [m, w] of z) {
    const gelesen = w.frei + w.grammatik + w.anderes;
    const quote = gelesen ? `${Math.round((100 * w.frei) / gelesen)} %` : "–";
    console.log(
      `${m.padEnd(10)} ${String(w.frei).padStart(5)} ${String(w.grammatik).padStart(10)} ${String(w.anderes).padStart(8)} ` +
        `${String(w.offen).padStart(6)}  | ${w.regelbefund}   Quote frei: ${quote}`
    );
  }
  const offen = [...z.values()].reduce((s, w) => s + w.offen, 0);
  if (offen > 0) console.log(`\n${offen} Einträge ohne eindeutiges Urteil — noch nicht fertig gelesen?`);
}

// ── Vergleichslauf ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (AUSWERTEN) return auswerten();

  const namen = (arg("modelle") || Object.keys(SCHREIBER).join(",")).split(",").map((s) => s.trim());
  for (const n of namen) if (!SCHREIBER[n]) throw new Error(`unbekanntes Modell "${n}" — bekannt: ${Object.keys(SCHREIBER).join(", ")}`);
  if (namen.includes("haiku") && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY fehlt in .env — für haiku nötig. Ohne: --modelle=4o-mini,luna");
  }
  const schreiber = new Map(namen.map((n) => [n, (SCHREIBER[n] as () => Schreiber)()]));

  const rows = await ladeQueue();
  const alleBetreffe = rows.slice(1).map((r) => String(r?.[8] ?? "").trim()).filter(Boolean);
  const zeilen = waehleZeilen(rows);
  console.log(`${zeilen.length} Zeilen, ${namen.length} Modelle: ${namen.join(", ")}\n`);

  mkdirSync(ORDNER, { recursive: true });
  const schluessel: Schluesseleintrag[] = [];
  const md: string[] = [
    "# Modellvergleich — Lesefassung",
    "",
    "Pro Betrieb mehrere Fassungen, Buchstaben zufällig pro Betrieb. Genau ein x pro Urteil-Zeile:",
    "`frei` = würde ich so verschicken, `grammatik` = Sprachfehler, `anderes` = inhaltlich unpassend.",
    "Danach: `npx tsx tools/modell-vergleich.ts --auswerten`",
    "",
  ];
  const neueBetreffe = new Map<string, string[]>(namen.map((n) => [n, []]));

  for (const [idx, z] of zeilen.entries()) {
    const domain = z.email.split("@")[1]?.trim().toLowerCase();
    let text = "";
    try {
      text = domain ? await holeWebsiteText(`https://${domain}`) : "";
    } catch {
      text = "";
    }
    if (text.trim().length < MIN_WEBSITE_TEXT) {
      console.log(`[--] ${z.nr} ${z.firma.slice(0, 40)}: zu wenig Website-Text, übersprungen`);
      continue;
    }

    const fassungen: { modell: string; betreff: string; inhalt: string; befunde: string[] }[] = [];
    for (const n of namen) {
      try {
        const e = await generiereEmailEntwurf({
          firma: nameFuerMail(z.firma, z.stadt),
          stadt: z.stadt, kategorie: z.kategorie, nische: z.nische,
          websiteText: text, link: z.link, betreffIndex: idx,
          verbrauchteBetreffe: [...alleBetreffe, ...(neueBetreffe.get(n) ?? [])],
          schreiber: schreiber.get(n),
        });
        neueBetreffe.get(n)?.push(e.betreff);
        const befunde = [
          ...e.maengel,
          ...regelBefunde(
            { name: z.firma, stadt: z.stadt, entwurf: e.inhalt, betreff: e.betreff, nische: z.nische.name },
            [...alleBetreffe, ...(neueBetreffe.get(n) ?? []).slice(0, -1)]
          ),
        ];
        if (!e.inhalt.includes(z.demoId)) befunde.push("Demo-Link fehlt");
        fassungen.push({ modell: n, betreff: e.betreff, inhalt: e.inhalt, befunde });
      } catch (err) {
        console.log(`[!!] ${z.nr} ${n}: ${(err as Error).message.slice(0, 160)}`);
      }
    }
    if (fassungen.length === 0) continue;

    md.push(`## ${z.nr} · ${nameFuerMail(z.firma, z.stadt)} (${z.stadt}, ${z.nische.name})`, "");
    const reihenfolge = blindeReihenfolge(z.nr, fassungen.length);
    reihenfolge.forEach((fi, pos) => {
      const f = fassungen[fi]!;
      const id = `${z.nr}-${buchstabe(pos)}`;
      schluessel.push({ id, modell: f.modell, befunde: f.befunde });
      md.push(`### ${id}`, "", `**Betreff:** ${f.betreff}`, "", f.inhalt, "", URTEIL_ZEILE, "");
    });
    console.log(`[OK] ${z.nr} ${z.firma.slice(0, 40).padEnd(40)} ${z.herkunft} · ${fassungen.map((f) => `${f.modell}:${f.befunde.length}`).join(" ")}`);

    // Nach jeder Zeile sichern — ein Abbruch soll bezahlte Entwürfe nicht wegwerfen.
    writeFileSync(LESEFASSUNG, md.join("\n"), "utf-8");
    writeFileSync(SCHLUESSEL, JSON.stringify(schluessel, null, 1), "utf-8");
  }

  console.log(`\nLesefassung: ${LESEFASSUNG} (${schluessel.length} Entwürfe). Schlüssel nicht öffnen, bevor gelesen ist.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
