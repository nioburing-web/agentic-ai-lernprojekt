/**
 * Prüfer für die Freigabe-Runde: feste Regeln zuerst, dann zwei Modell-Durchgänge.
 *
 * bike-method-phase: 1 — nur im Backtest (tools/pruefer-eval.ts), nichts verdrahtet.
 * Adapted from The Three Ms of AI™ © 2026 Nate Herk.
 *
 * Warum drei Schichten (27.09.2026): Ein einzelner Modell-Aufruf "frei oder
 * verwerfen" lag im Backtest bei 58 % Übereinstimmung mit Nio und liess 8 von 77
 * Verworfenen durch, fast alle wegen kleiner Beugungsfehler ("wie fängt ihr",
 * "wenn ihr Zeit hat"). Zugleich verwarf er Details, die schlicht von der
 * Website stammen. Also getrennt:
 *
 *  1. Feste Regeln für die Fehler, die der Schreiber immer wieder gleich macht.
 *     Gratis, exakt, und jeder Treffer zeigt die Stelle.
 *  2. Ein Grammatik-Durchgang, der jeden Fehler wörtlich zitieren muss. Ein Zitat,
 *     das nicht im Text steht, zählt nicht — so kann das Modell keinen Fehler
 *     erfinden, und ein gefundener ist für Nio in einer Sekunde nachprüfbar.
 *  3. Ein Fit-Durchgang für das, was sich nicht am Wortlaut entscheiden lässt.
 *
 * Diese Regeln sind neu, keine davon steckt in regelBefunde(): alle Fälle im
 * Backtest hatten die bestehenden Prüfungen schon passiert.
 */

import Anthropic from "@anthropic-ai/sdk";
import { anredeIstGemischt } from "../src/trigger/anrede";

export type PruefFall = {
  name: string; stadt: string; kontakt: string; betreff: string; entwurf: string; nische: string;
};

// ── 1. Feste Regeln ─────────────────────────────────────────────────────────

// Dritte Person Singular dort, wo "ihr" ein Verb in der 2. Person Plural braucht.
// Nur Formen, die sich von der ihr-Form unterscheiden (bietet/arbeitet sind für
// beide gleich und fehlen deshalb bewusst).
const SG3 = "fängt|läuft|hält|trägt|lässt|weiß|nimmt|gibt|sieht|liest|spricht|hilft|hat|ist|kann|will|muss|darf|soll|mag|wird";

const REGELN: Array<{ name: string; muster: RegExp }> = [
  { name: "Verb passt nicht zu ihr", muster: new RegExp(`\\b(${SG3})\\s+ihr\\b`, "i") },
  { name: "Verb passt nicht zu ihr", muster: new RegExp(`\\bihr\\s+(${SG3})\\b`, "i") },
  // "wenn ihr Zeit hat." — das Verb am Satzende, ohne Komma dazwischen.
  { name: "Verb passt nicht zu ihr", muster: new RegExp(`\\b(wenn|ob|dass|weil|wie)\\s+ihr\\b[^.,;!?\\n]{0,40}\\b(${SG3})(?=\\s*[.,;!?\\n])`, "i") },
  // Kleines "sie" als Anrede in einer ihr-Mail: "den sie reinschreiben können".
  { name: "kleines sie als Anrede", muster: /\b(könnt|können|könnten|dürft|dürfen)\s+sie\b|\bsie\s+(rein\w+|ausprobieren|fragen|schreiben)\b/ },
  // Wiederkehrende Brüche im Schlussformel-Baukasten des Schreibers.
  { name: "Formel kaputt", muster: /gibt\s+(es\s+)?keine\s+Anmeldung\s+nötig|\bFür\s+keine\s+Anmeldung|\bHätte\s+das\b[^?.]{0,40}\bwert\b|\bnicht\s+euer\b/i },
  // Maps ersetzt "|" im Titel gern durch ein grosses I: "Von Malottki I Medizinische
  // Fußpflege". Ein allein stehendes I gibt es im Deutschen nicht.
  { name: "Maps-Trenner im Text", muster: /[a-zäöüß]\s+I\s+[A-ZÄÖÜ]|\S\s·\s\S/ },
  // Rechtsform hinter einem Namen. Nicht "für meine GmbH" — das ist der Beispielsatz
  // der Kanzlei-Demo und gehört in die Mail.
  { name: "Rechtsform im Text", muster: /(?<!\b(meine|eine|Ihre|eure|deine)\s)\b[A-ZÄÖÜ][\wäöüß&.-]*\s+(GmbH|mbH|e\.\s?K\.|GbR|eGbR|eG|UG|KG|PartG|Ltd\.?)(?![\wäöü])/ },
];

function registerDesTexts(t: string): "sie" | "ihr" | null {
  // "Sie" am Satzanfang kann auch "sie" (Plural) sein — gezählt wird nur mitten im Satz.
  const sie = /[a-zäöüß,]\s+(Sie|Ihnen|Ihre?[nmrs]?)\b/.test(t) || /^\s*Guten Tag/.test(t);
  const ihr = /\b(ihr|euch|euer|eure[nmrs]?)\b/.test(t);
  if (sie && !ihr) return "sie";
  if (ihr && !sie) return "ihr";
  return null;
}

// Zeichen, an denen man einen Maps-Titel erkennt, den so niemand schreiben würde.
const MAPS_MARKER = /\s[-–|·]\s?|\s-|,\s|\b(GmbH|mbH|e\.\s?K\.|KG|UG|AG|GbR|PartG)\b|^med\.\s/;

export function regelTreffer(f: PruefFall): string[] {
  const t = f.entwurf ?? "";
  const treffer: string[] = [];
  for (const r of REGELN) {
    const m = t.match(r.muster);
    if (m) treffer.push(`${r.name}: „${m[0].trim()}“`);
  }
  if (anredeIstGemischt(t)) treffer.push("Anrede gemischt du/ihr");

  const reg = registerDesTexts(t);
  const betreffIhr = /\b(ihr|euch|euer|eure[nmrs]?)\b/i.test(f.betreff ?? "");
  if (reg === "sie" && betreffIhr) treffer.push(`Betreff duzt, Text siezt: „${f.betreff}“`);

  if (!/^\s*(Hey|Hallo|Hi|Moin|Guten\s+(Tag|Morgen)|Liebe[rs]?|Sehr geehrte)/i.test(t)) {
    treffer.push("keine Begrüßung am Anfang");
  }

  // Der Maps-Titel steht wörtlich im Text — mit Rechtsform, Bindestrich-Zusatz o. ä.
  const name = (f.name ?? "").trim();
  if (name && MAPS_MARKER.test(name) && t.includes(name)) treffer.push(`Maps-Name wörtlich im Text: „${name}“`);
  return treffer;
}

// ── 2./3. Modell-Durchgänge ─────────────────────────────────────────────────

export const PROMPT_VERSION = "v2";

const GRAMMATIK_SYSTEM = `Du bist Korrektor für kurze deutsche Geschäfts-E-Mails. Melde nur echte Fehler, bei denen du sicher bist, dass ein Muttersprachler stolpert:
- Verbform passt nicht zum Subjekt: "ihr fängt" statt "ihr fangt", "wenn ihr Zeit hat" statt "habt", "ihr ... herangehst" statt "herangeht", "steht die Fußgesundheit und das Wohlbefinden" statt "stehen".
- Pronomen oder Artikel falsch: "nicht euer" statt "nicht eurer", "Sie können es ausprobieren", wenn "den Assistenten" gemeint ist ("ihn"), falscher Kasus oder falsches Genus.
- Satz ergibt keinen Sinn oder ein Wort fehlt: "Für keine Anmeldung, es passiert nichts", "Der Link ist ein erfundener Beispiel-Betrieb", "Könntet ihr zum Beispiel reinschreiben:" als Aussage.
- Anrede wechselt im Text zwischen ihr und Sie, oder ein kleines "sie" meint den Leser.
- Tippfehler.

Nicht melden: Anrede "Hey,", kleingeschriebene Betreffzeile, Gedankenstriche, Aufzählungen mit Komma statt "und", umgangssprachliche Kürzel ("hab", "mal", "wenn's"), Stil, Wiederholungen, Geschmack. Die Betreffzeile prüfst du nicht.

Zitiere jeden Fehler wörtlich und exakt so, wie er im Text steht (3 bis 10 Wörter), und nenne die Korrektur. Findest du beim Nachdenken, dass eine Stelle doch richtig ist, lass sie weg. Ohne Fehler: leere Liste.

Antworte nur mit JSON, ohne Codeblock: {"fehler":[{"zitat":"...","korrektur":"..."}]}`;

const FIT_SYSTEM = `Du prüfst, ob eine Kaltakquise-Mail von NIO Automation an diesen Empfänger passt. NIO baut kleinen, inhabergeführten Betrieben einen Chat-Assistenten für die Website, der Fragen beantwortet und Terminanfragen aufnimmt. Die Mail verlinkt eine Demo mit einem erfundenen Beispiel-Betrieb — der Satz "das ist ein erfundener Beispiel-Betrieb" ist Absicht. Die Mail nennt einen Beispielsatz, den man in die Demo schreiben kann.

Konkrete Details über den Betrieb (Stadtteil, Lage, Behandlungen, Geräte, Spezialitäten, Angebote wie "kostenlose Wertermittlung") stammen von dessen Website. Das ist gewollt und KEIN Grund zu verwerfen.

Verwirf nur, wenn eins klar zutrifft:
- Der Empfänger ist keine kleine, inhabergeführte Firma: Filiale einer Kette oder großen Marke, Franchise, Konzern, Bank-Tochter, überregionale Kanzlei, Klinik.
- Die E-Mail-Adresse gehört erkennbar nicht zu diesem Betrieb (andere Firma, Kammer, Verband) oder ist ein Datenschutz-, Compliance-, IT- oder Bewerbungspostfach.
- Der Aufhänger passt nicht zu einem Chat-Assistenten auf der Website (No-Show-Problem, Telefonanlage, ein Notdienst oder eine Online-Sprechstunde, die sie schon haben) oder widerspricht sich.
- Der Beispielsatz passt nicht zu diesem Betrieb (z. B. "Bei mir tropft die Heizung" an einen Makler, der nur verkauft).
- Der Betreff spricht von etwas anderem als der Text oder ist irreführend.
- Der Einstieg gibt ein Heil- oder Gesundheitsversprechen des Betriebs als eigene Beobachtung wieder.

Antworte nur mit JSON, ohne Codeblock: {"urteil":"frei"|"verwerfen","grund":"<ein Satz>"}`;

function inhalt(f: PruefFall): string {
  return [
    `Betrieb: ${f.name} (${f.stadt}), Nische: ${f.nische}`,
    `Empfänger: ${f.kontakt}`,
    `Betreff: ${f.betreff}`,
    `Entwurf:\n${f.entwurf}`,
  ].join("\n");
}

function jsonAus(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function frage(client: Anthropic, modell: string, system: string, f: PruefFall): Promise<any | null> {
  for (let versuch = 0; versuch < 2; versuch++) {
    const r = await client.messages.create({
      model: modell,
      // Sonnet 5 / Opus denken standardmäßig mit, das zählt gegen max_tokens.
      // Mit 300 kamen am 27.09. 58 von 161 Antworten abgeschnitten zurück.
      max_tokens: 4000,
      ...(modell.includes("haiku") ? { temperature: 0 } : { output_config: { effort: "medium" } }),
      system,
      messages: [{ role: "user", content: inhalt(f) }],
    } as Anthropic.MessageCreateParamsNonStreaming);
    const j = jsonAus(r.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
    if (j) return j;
  }
  return null;
}

// Zitat gilt nur, wenn es im Text steht. Leerraum und Anführungszeichen werden
// angeglichen, sonst scheitert ein echtes Zitat an einem geschützten Leerzeichen.
function normal(s: string): string {
  return s.replace(/[„“”"'’]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Eine "Korrektur", die das Zitat unverändert enthält oder sich selbst widerruft,
// ist keine. Am 27.09. waren das 5 von 38 Meldungen bei freigegebenen Mails, meist
// „Wäre das für euch einen Blick wert?“ → dieselbe Zeile mit Kommentar.
export function istKeineKorrektur(zitat: string, korrektur: string): boolean {
  const ohneZeichen = (s: string) => normal(s).replace(/[?.!,:;]+$/, "").trim();
  // Manchmal steht "alt → neu" in der Korrektur selbst — dann zählt der letzte Teil.
  const teile = korrektur.split(/→|->/);
  const neu = teile[teile.length - 1] ?? "";
  const z = ohneZeichen(zitat);
  const k = ohneZeichen(neu.replace(/\([^)]*\)/g, ""));
  return k === z || /kein(en)?\s+(klaren\s+)?fehler|ist\s+(grammatisch\s+)?(richtig|korrekt)|\(korrekt/i.test(korrektur);
}

export async function grammatikBefunde(client: Anthropic, modell: string, f: PruefFall): Promise<{ belegt: string[]; unbelegt: number } | null> {
  const j = await frage(client, modell, GRAMMATIK_SYSTEM, f);
  if (!j || !Array.isArray(j.fehler)) return null;
  // Nur der Mailtext: der Betreff hat eigene Regeln, sonst meldet ein
  // Register-Wechsel im Betreff sich hier ein zweites Mal.
  const text = normal(f.entwurf);
  const belegt: string[] = [];
  let unbelegt = 0;
  for (const e of j.fehler) {
    const z = String(e?.zitat ?? "");
    const k = String(e?.korrektur ?? "");
    // Das Modell meldet gelegentlich eine Stelle und schreibt als Korrektur "kein
    // Fehler" (27.09.: 5 von 38 Meldungen). Die zählen nicht.
    if (!z || istKeineKorrektur(z, k)) continue;
    if (text.includes(normal(z))) belegt.push(`„${z}“ → „${k}“`);
    else unbelegt++;
  }
  return { belegt, unbelegt };
}

export async function fitUrteil(client: Anthropic, modell: string, f: PruefFall): Promise<{ urteil: "frei" | "verwerfen"; grund: string } | null> {
  const j = await frage(client, modell, FIT_SYSTEM, f);
  if (!j || (j.urteil !== "frei" && j.urteil !== "verwerfen")) return null;
  return { urteil: j.urteil, grund: String(j.grund ?? "") };
}
