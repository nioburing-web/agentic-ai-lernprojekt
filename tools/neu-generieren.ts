/**
 * Schreibt die Copy bestehender PRUEFEN-Zeilen neu — mit der reparierten Strecke
 * (Hook-Prüfung seit v20260813.1), ohne neue Leads zu suchen.
 *
 * Warum es das braucht: am 13.08.2026 blieben 26 der 60 Entwürfe liegen, weil sie
 * den Branchen-Hook wörtlich übernommen hatten, Betreffe doppelten oder den
 * Firmennamen ausliessen. Die Leaddaten dafür sind bezahlt und stehen im Sheet —
 * nur die Copy taugt nicht. Eine neue Nacht-Recherche würde erneut Google Maps
 * anfassen (der eigentliche Kostentreiber, ~2-3 € pro Lauf) und andere Betriebe
 * finden. Hier läuft nur der LLM-Teil neu.
 *
 * Was bewusst NICHT neu erzeugt wird:
 * - Die Demo-ID und der Link. Beide stehen schon in der Zeile, und an der ID
 *   hängt das Klick-Tracking. Der Link wird aus dem alten Entwurf übernommen,
 *   nicht neu gebaut — so braucht der Lauf auch kein DEMO_BASIS_LOKAL, das
 *   lokal gar nicht gesetzt ist.
 * - Der Status. Alles bleibt PRUEFEN. Was rausgeht, entscheidet Nio.
 *
 * Der Website-Text wird nirgends gespeichert (nacht-recherche holt ihn live und
 * verwirft ihn). Ohne ihn fällt die Generierung auf den generischen "demo-zuerst"-
 * Blickwinkel zurück und die neue Mail wäre schlechter als die alte. Deshalb wird
 * er über die Domain der E-Mail-Adresse neu geholt, und Zeilen ohne genug Text
 * bleiben unangetastet statt generisch überschrieben zu werden.
 *
 * Zwei Schritte, absichtlich getrennt:
 *
 *   npx tsx --env-file=.env tools/neu-generieren.ts
 *     Erzeugt neu, prüft, legt das Ergebnis in tools/.neue-entwuerfe.json ab.
 *     Rührt das Sheet nicht an.
 *
 *   npx tsx --env-file=.env tools/neu-generieren.ts --uebernehmen [--alle]
 *     Schreibt GENAU DAS, was im Probelauf herauskam, ins Sheet. Erzeugt nichts
 *     neu. Standardmässig nur die Entwürfe ohne Befund — einen markierten Entwurf
 *     durch einen anders markierten zu ersetzen ist keine Verbesserung, nur Bewegung.
 *
 * Warum der zweite Schritt nicht selbst generiert: bei temperature 0.9 kommt jeder
 * Lauf anders heraus. Würde --uebernehmen neu erzeugen, stünde am Ende Text im
 * Sheet, den niemand gelesen hat, und jeder Lauf kostet erneut Aufrufe. Am
 * 13.08.2026 ist genau das passiert — zwei Probeläufe hintereinander liefen ins
 * OpenAI-Tokenlimit (200k TPM).
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import {
  generiereEmailEntwurf,
  holeWebsiteText,
  hookIstAbgeschrieben,
  nameIstGenannt,
  betreffIstBrauchbar,
} from "../src/trigger/nacht-recherche";
import { KATEGORIEN } from "../src/trigger/nischen";
import type { Kategorie, Nische } from "../src/trigger/nischen";

const QUEUE_TAB = "Outreach Queue";
const MIN_WEBSITE_TEXT = 300; // gleiches Quality-Gate wie in nacht-recherche
const UEBERNEHMEN = process.argv.includes("--uebernehmen");
const ALLE = process.argv.includes("--alle");
const ERGEBNIS_DATEI = "tools/.neue-entwuerfe.json";

type Zeile = {
  nr: number;
  firma: string;
  stadt: string;
  email: string;
  altEntwurf: string;
  altBetreff: string;
  demoId: string;
  nische: Nische;
  kategorie: Kategorie;
  link: string;
};

function findeNische(nischenName: string): { k: Kategorie; n: Nische } | null {
  for (const k of KATEGORIEN) {
    const n = k.nischen.find((x) => x.name === nischenName);
    if (n) return { k, n };
  }
  return null;
}

/** Die Website, von der die Adresse stammt. Kein Maps-Aufruf, nur die Domain. */
function websiteAusEmail(email: string): string | null {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain || !domain.includes(".")) return null;
  return `https://${domain}`;
}

/** Der Demo-Link steht bereits im alten Entwurf — übernehmen statt neu bauen. */
function linkAusEntwurf(entwurf: string, demoId: string): string | null {
  for (const treffer of entwurf.match(/https?:\/\/[^\s<>"')]+/g) ?? []) {
    if (treffer.includes(demoId)) return treffer.replace(/[.,;:]+$/, "");
  }
  return null;
}

function befunde(inhalt: string, betreff: string, z: Zeile, andere: string[]): string[] {
  const out: string[] = [];
  if (hookIstAbgeschrieben(inhalt, z.nische.hook)) out.push("Hook wörtlich");
  if (!nameIstGenannt(inhalt, z.firma)) out.push("Firmenname fehlt");
  if (!betreffIstBrauchbar(betreff, andere)) out.push("Betreff unbrauchbar/doppelt");
  const du = inhalt.match(/\b(?:du|dir|dich|dein\w*)\b/gi) ?? [];
  const ihr = inhalt.match(/\b(?:ihr|euch|eure\w*|euer)\b/gi) ?? [];
  if (z.kategorie.slug !== "b2b-kleinbetriebe" && du.length > 0 && ihr.length > 0) {
    out.push("du/ihr gemischt");
  }
  if (/Ich habe gesehen, dass|Mir ist aufgefallen/.test(inhalt)) out.push("Floskel-Einstieg");
  return out;
}

async function main(): Promise<void> {
  const roh = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!roh || !sheetId) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON oder GOOGLE_SHEET_ID fehlt");

  const auth = new GoogleAuth({
    credentials: JSON.parse(roh),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = googleSheets({ version: "v4", auth: auth as never });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${QUEUE_TAB}!A:U`,
  });
  const rows = res.data.values ?? [];

  // Alle bereits vergebenen Betreffe — auch die der gesendeten Mails. Sonst
  // erzeugt der Lauf einen Betreff, der schon draussen ist.
  const alleBetreffe = rows
    .slice(1)
    .map((r) => String(r?.[8] ?? "").trim())
    .filter((b) => b.length > 0);

  const offen: Zeile[] = [];
  const uebersprungen: string[] = [];

  rows.slice(1).forEach((r, i) => {
    const nr = i + 2;
    if (String(r?.[5] ?? "").trim() !== "PRUEFEN") return;
    const firma = String(r?.[1] ?? "");
    const email = String(r?.[3] ?? "");
    const altEntwurf = String(r?.[4] ?? "");
    const demoId = String(r?.[17] ?? "").trim();
    const treffer = findeNische(String(r?.[19] ?? ""));
    if (!treffer) return void uebersprungen.push(`${nr} ${firma}: Nische unbekannt`);
    if (!demoId) return void uebersprungen.push(`${nr} ${firma}: keine Demo-ID`);
    const link = linkAusEntwurf(altEntwurf, demoId);
    if (!link) return void uebersprungen.push(`${nr} ${firma}: Demo-Link nicht im alten Entwurf`);
    offen.push({
      nr, firma, stadt: String(r?.[2] ?? ""), email, altEntwurf,
      altBetreff: String(r?.[8] ?? ""), demoId, nische: treffer.n, kategorie: treffer.k, link,
    });
  });

  console.log(`${offen.length} Zeilen auf PRUEFEN, die neu geschrieben werden können`);
  if (uebersprungen.length) console.log("übersprungen:\n  " + uebersprungen.join("\n  "));

  // ── Schritt 2: das Ergebnis des Probelaufs ins Sheet schreiben ──────────────
  if (UEBERNEHMEN) {
    if (!existsSync(ERGEBNIS_DATEI)) {
      throw new Error(`${ERGEBNIS_DATEI} fehlt — erst den Probelauf ohne --uebernehmen fahren`);
    }
    const gespeichert: { range: string; values: string[][] }[] = JSON.parse(
      readFileSync(ERGEBNIS_DATEI, "utf-8")
    );
    const proZeile = new Map<number, { entwurf?: string; betreff?: string }>();
    for (const u of gespeichert) {
      const nr = Number(u.range.slice(1));
      const eintrag = proZeile.get(nr) ?? {};
      if (u.range.startsWith("E")) eintrag.entwurf = u.values[0]![0];
      if (u.range.startsWith("I")) eintrag.betreff = u.values[0]![0];
      proZeile.set(nr, eintrag);
    }

    const nehmen: { range: string; values: string[][] }[] = [];
    const gesetzteBetreffe: string[] = [];
    let ausgelassen = 0;
    for (const z of offen) {
      const neu = proZeile.get(z.nr);
      if (!neu?.entwurf || !neu.betreff) continue;
      const rest = befunde(neu.entwurf, neu.betreff, z, [...alleBetreffe, ...gesetzteBetreffe]);
      if (rest.length > 0 && !ALLE) {
        console.log(`[--] ${z.nr} ${z.firma.slice(0, 34).padEnd(34)} bleibt alt (${rest.join(", ")})`);
        ausgelassen++;
        continue;
      }
      console.log(`[OK] ${z.nr} ${z.firma.slice(0, 34).padEnd(34)} wird übernommen`);
      gesetzteBetreffe.push(neu.betreff);
      nehmen.push({ range: `E${z.nr}`, values: [[neu.entwurf]] });
      nehmen.push({ range: `I${z.nr}`, values: [[neu.betreff]] });
    }

    console.log(`\nzu übernehmen: ${nehmen.length / 2} · alte Fassung behalten: ${ausgelassen}`);
    if (nehmen.length === 0) return void console.log("nichts zu schreiben");

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: nehmen.map((u) => ({ range: `${QUEUE_TAB}!${u.range}`, values: u.values })),
      },
    });

    // Zurücklesen statt der API-Antwort glauben (Lehre aus dem Spalten-Bug 16.07.).
    const nach = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${QUEUE_TAB}!A:U`,
    });
    const nachRows = nach.data.values ?? [];
    let bestaetigt = 0;
    for (const u of nehmen) {
      if (!u.range.startsWith("E")) continue;
      const nr = Number(u.range.slice(1));
      if (String(nachRows[nr - 1]?.[4] ?? "") === u.values[0]![0]) bestaetigt++;
    }
    console.log(`geschrieben und gegengelesen: ${bestaetigt} von ${nehmen.length / 2} Entwürfen`);
    console.log("Status bleibt überall PRUEFEN — was rausgeht, entscheidet Nio.");
    return;
  }

  console.log("\nMODUS: Probelauf, schreibt nichts ins Sheet\n");

  writeFileSync(
    "tools/.backup-entwuerfe.json",
    JSON.stringify(offen.map((z) => ({ nr: z.nr, betreff: z.altBetreff, entwurf: z.altEntwurf })), null, 1),
    "utf-8"
  );
  console.log("alte Entwürfe gesichert: tools/.backup-entwuerfe.json\n");

  const neueBetreffe: string[] = [];
  const updates: { range: string; values: string[][] }[] = [];
  let sauber = 0;
  let unveraendert = 0;

  for (const [idx, z] of offen.entries()) {
    const website = websiteAusEmail(z.email);
    if (!website) {
      console.log(`[--] ${z.nr} ${z.firma}: keine Domain aus "${z.email}"`);
      unveraendert++;
      continue;
    }

    let text = "";
    try {
      text = await holeWebsiteText(website);
    } catch (e) {
      console.log(`[--] ${z.nr} ${z.firma}: Website nicht erreichbar (${website})`);
      unveraendert++;
      continue;
    }
    if (text.trim().length < MIN_WEBSITE_TEXT) {
      console.log(`[--] ${z.nr} ${z.firma}: nur ${text.trim().length} Zeichen Website-Text – alte Fassung bleibt`);
      unveraendert++;
      continue;
    }

    const neu = await generiereEmailEntwurf({
      firma: z.firma,
      stadt: z.stadt,
      kategorie: z.kategorie,
      nische: z.nische,
      websiteText: text,
      link: z.link,
      betreffIndex: idx,
      verbrauchteBetreffe: [...alleBetreffe, ...neueBetreffe],
    });

    // Ohne den Link ist die Mail wertlos — der Klick ist das einzige Signal.
    if (!neu.inhalt.includes(z.demoId)) {
      console.log(`[--] ${z.nr} ${z.firma}: Demo-Link fehlt im neuen Entwurf – alte Fassung bleibt`);
      unveraendert++;
      continue;
    }

    const rest = befunde(neu.inhalt, neu.betreff, z, [...alleBetreffe, ...neueBetreffe]);
    if (rest.length === 0) sauber++;
    console.log(
      `[${rest.length === 0 ? "OK" : "!!"}] ${z.nr} ${z.firma.slice(0, 34).padEnd(34)} ` +
        `${rest.length === 0 ? "sauber" : rest.join(", ")}`
    );

    neueBetreffe.push(neu.betreff);
    updates.push({ range: `E${z.nr}`, values: [[neu.inhalt]] });
    updates.push({ range: `I${z.nr}`, values: [[neu.betreff]] });
  }

  console.log(`\nneu geschrieben: ${updates.length / 2} · davon ohne Befund: ${sauber} · unverändert gelassen: ${unveraendert}`);

  writeFileSync(ERGEBNIS_DATEI, JSON.stringify(updates, null, 1), "utf-8");
  console.log(`Probelauf — Ergebnis in ${ERGEBNIS_DATEI}, Sheet unberührt.`);
  console.log("Übernehmen mit: npx tsx --env-file=.env tools/neu-generieren.ts --uebernehmen");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
