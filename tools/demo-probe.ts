/**
 * Demo-Probe: schickt jede aktive `beispielFrage` an die Live-Demo und prueft,
 * ob die Antwort darauf eingeht oder abwinkt.
 *
 * Warum es das gibt (02.10.2026): Jede Outreach-Mail empfiehlt einen Satz, den
 * der Empfaenger in die Demo tippen soll. Die neutrale Demo (Profil `lokal`)
 * winkte bei fuenf von zwoelf Nischen genau bei diesem Satz ab ("nicht fuer
 * Heizungsreparaturen zustaendig", "das ist nicht unser Thema", "wir sind hier
 * kein Tierarzt"). Geprueft wurde bis dahin nur "antwortet der Chat ueberhaupt".
 * Die Probe vom 29.09. lief nur gegen die Saetze der aktuellen Charge und
 * uebersah deshalb drei der fuenf Nischen. Diese Probe nimmt die Saetze direkt
 * aus `nischen.ts`, also immer alle.
 *
 * Kostet einen Haiku-Aufruf pro Satz auf dem Demo-Konto. Sendet nie eine Mail:
 * ein einzelner Satz liefert weder Name noch Rueckrufnummer, das Termin-Tool
 * feuert damit nicht.
 *
 *   npx tsx tools/demo-probe.ts                          # Live-Demo
 *   npx tsx tools/demo-probe.ts --url=http://localhost:3000
 *   npx tsx tools/demo-probe.ts --runden=2               # jeder Satz zweimal
 *   npx tsx tools/demo-probe.ts --nur=kanzlei --zeigen   # eine Nische, Antworten voll
 *
 * Exit 1, sobald ein Satz abgewunken wird oder die Rueckfallantwort kommt.
 */

import { pathToFileURL } from "node:url";
import { KATEGORIEN, type DemoProfil } from "../src/trigger/nischen";

/** Saetze, mit denen die Demo einen Interessenten wegschickt. */
const ABSAGE_MUSTER: RegExp[] = [
  /nicht (?:unser|mein) (?:thema|bereich|gebiet)/i,
  /nicht (?:dafür |für [^.!?]{0,40})?zuständig/i,
  /(?:wir sind|ich bin|sind wir) (?:hier )?(?:leider )?(?:auch )?kein(?:e|en)?\b/i,
  /(?:können|kann) (?:dir|ihnen|euch) (?:bei [^.!?]{0,50} |da |dabei |damit |hier )?(?:leider )?nicht (?:weiter)?helfen/i,
  /\b(?:wende|wenden) (?:dich|sie sich) (?:bitte )?(?:an|lieber an)/i,
  /\b(?:brauchst du|benötigst du|brauchen sie|benötigen sie) (?:dafür |hier )?(?:einen|eine)\b/i,
  // Nur der Verweis an einen ANDEREN Betrieb ist eine Absage. "Ist es akut,
  // ruf uns direkt an oder nimm den Notdienst" ist gewollt (LOKAL_FAKTEN).
  /empfehle[n]?[^.!?]{0,60}\b(?:einen|eine|einem|einer) (?:tierarzt|tierärztin|tierklinik|klempner|installateur|handwerker|heizungs\w*|makler\w*|steuerberater\w*|kanzlei|anwalt|restaurant|hausverwaltung)[^.!?]{0,30}(?:aufzusuchen|zu kontaktieren|zu wenden|anzurufen)/i,
  /missverständnis/i,
  /ob wir [^.!?]{0,40} (?:überhaupt )?anbieten/i,
  /ohne echte /i,
  /keine? (?:echte|richtige) (?:kanzlei|hausverwaltung|praxis|werkstatt)/i,
];

const RUECKFALL = /einen moment, ich bin gleich wieder/i;

/** Liefert den Grund, warum die Antwort durchfaellt, oder null. */
export function absageBefund(antwort: string): string | null {
  if (!antwort.trim()) return "leere Antwort";
  if (RUECKFALL.test(antwort)) return "Rueckfallantwort (Modell nicht erreichbar?)";
  for (const muster of ABSAGE_MUSTER) {
    const treffer = antwort.match(muster);
    if (treffer) return `winkt ab: "${treffer[0]}"`;
  }
  return null;
}

type Fall = { profil: DemoProfil; nische: string; satz: string };

export function alleFaelle(nurAktive = true): Fall[] {
  return KATEGORIEN.filter((k) => !nurAktive || k.aktiv).flatMap((k) =>
    k.nischen.map((n) => ({ profil: k.demo, nische: n.name, satz: n.beispielFrage })),
  );
}

async function frage(basis: string, f: Fall): Promise<string> {
  const r = await fetch(`${basis}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ verlauf: [{ role: "user", content: f.satz }], profil: f.profil }),
  });
  if (!r.ok) return `HTTP ${r.status}`;
  const d = (await r.json().catch(() => ({}))) as { antwort?: string };
  return d.antwort ?? "";
}

async function main(): Promise<void> {
  const arg = (name: string) =>
    process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  const basis = (arg("url") ?? "https://demo.nio-automation.de").replace(/\/$/, "");
  const runden = Math.max(1, Number(arg("runden") ?? 1));
  const zeigen = process.argv.includes("--zeigen");
  const nur = arg("nur")?.toLowerCase();
  const faelle = alleFaelle().filter((f) => !nur || f.nische.toLowerCase().includes(nur));

  let rot = 0;
  for (const f of faelle) {
    for (let i = 0; i < runden; i++) {
      const antwort = await frage(basis, f).catch((e: Error) => `FEHLER ${e.message}`);
      const befund = antwort.startsWith("HTTP ") || antwort.startsWith("FEHLER ")
        ? antwort
        : absageBefund(antwort);
      if (befund) rot++;
      console.log(`${befund ? "[ROT] " : "[OK]  "} ${f.nische.padEnd(22)} ${f.satz}`);
      if (befund) console.log(`       ${befund}`);
      if (befund || zeigen) console.log(`       ${antwort.replace(/\s+/g, " ").slice(0, zeigen ? 600 : 220)}`);
    }
  }
  const gesamt = faelle.length * runden;
  console.log(`\n${basis}: ${gesamt - rot} von ${gesamt} Antworten gehen auf den Satz ein.`);
  process.exit(rot ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
