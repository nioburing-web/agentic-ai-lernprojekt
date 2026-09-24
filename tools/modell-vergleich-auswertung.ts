/**
 * Die reinen Teile des Modellvergleichs: Blindzuordnung und Auswertung.
 * Ohne Netz und ohne Sheet, damit Tests sie aufrufen können, ohne dass beim
 * Import ein bezahlter Lauf losgeht (gleiche Trennung wie freigabe-pruefung.ts).
 *
 * Warum blind (24.09.2026): Wer weiß, welches Modell welchen Entwurf geschrieben
 * hat, liest den Favoriten gnädiger. Der Vergleich soll die Frage "welches
 * Modell macht weniger Grammatikfehler?" beantworten, nicht bestätigen.
 */

export type Urteil = "frei" | "grammatik" | "anderes" | "offen";

/** Eine Zeile der Lesefassung, wie Nio sie ankreuzt. */
export const URTEIL_ZEILE = "Urteil: [ ] frei  [ ] grammatik  [ ] anderes";

/**
 * Welche Variante bekommt an dieser Zeile welchen Buchstaben?
 *
 * Deterministisch aus der Zeilennummer, damit ein zweiter Lauf dieselbe
 * Zuordnung ergibt, aber pro Zeile verschieden. Sonst stünde Modell A immer
 * oben, und nach drei Zeilen wüsste man, wer A ist.
 */
export function blindeReihenfolge(zeile: number, anzahl: number): number[] {
  const idx = Array.from({ length: anzahl }, (_, i) => i);
  let s = (zeile * 2654435761) >>> 0;
  for (let i = idx.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) >>> 0;
    const j = s % (i + 1);
    [idx[i], idx[j]] = [idx[j] as number, idx[i] as number];
  }
  return idx;
}

export function buchstabe(position: number): string {
  return String.fromCharCode(65 + position);
}

/**
 * Liest die angekreuzte Lesefassung. Ein Block beginnt mit "### <zeile>-<X>",
 * das Kreuz ist ein x oder X in einer der drei Klammern. Genau ein Kreuz zählt,
 * null oder mehrere gelten als "offen" — ein Doppelkreuz ist kein Urteil.
 */
export function leseUrteile(markdown: string): Map<string, Urteil> {
  const out = new Map<string, Urteil>();
  const bloecke = markdown.split(/^### /m).slice(1);
  for (const block of bloecke) {
    const id = (block.split(/\r?\n/)[0] ?? "").trim();
    const zeile = block.split(/\r?\n/).find((z) => z.trim().startsWith("Urteil:")) ?? "";
    const kreuze = [...zeile.matchAll(/\[\s*[xX]\s*\]\s*(frei|grammatik|anderes)/g)].map((m) => m[1] as Urteil);
    out.set(id, kreuze.length === 1 ? (kreuze[0] as Urteil) : "offen");
  }
  return out;
}

export type Schluesseleintrag = { id: string; modell: string; befunde: string[] };

export type Zaehlung = { frei: number; grammatik: number; anderes: number; offen: number; regelbefund: number };

/** Zählt pro Modell. `regelBefund` kommt aus der Prüfstrecke, nicht vom Lesen. */
export function zaehleProModell(
  schluessel: Schluesseleintrag[],
  urteile: Map<string, Urteil>
): Map<string, Zaehlung> {
  const out = new Map<string, Zaehlung>();
  for (const e of schluessel) {
    const z = out.get(e.modell) ?? { frei: 0, grammatik: 0, anderes: 0, offen: 0, regelbefund: 0 };
    z[urteile.get(e.id) ?? "offen"]++;
    if (e.befunde.length > 0) z.regelbefund++;
    out.set(e.modell, z);
  }
  return out;
}
