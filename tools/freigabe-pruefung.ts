/**
 * Die Urteile der Freigabe-Runde als reine Funktionen — ohne Sheet, ohne Netz.
 *
 * Getrennt von freigabe-runde.ts, damit Tests sie aufrufen können, ohne dass
 * beim Import die ganze Runde losläuft.
 */

import {
  nameIstGenannt,
  hookIstAbgeschrieben,
  betreffIstBrauchbar,
} from "../src/trigger/nacht-recherche";
import { oeffnerIstFloskel } from "../src/trigger/entwurf-qualitaet";
import { KATEGORIEN } from "../src/trigger/nischen";

export type Befund =
  | { art: "verworfen"; grund: string }
  | { art: "repariert"; was: string }
  | { art: "prüfen"; hinweis: string };

/** Der Branchen-Hook zu einem Nischennamen aus Spalte T. Unbekannt → null. */
export function hookZurNische(nischenName: string): string | null {
  for (const k of KATEGORIEN) {
    for (const n of k.nischen) if (n.name === nischenName) return n.hook;
  }
  return null;
}

/**
 * Lässt die echten Regelprüfungen aus nacht-recherche noch einmal über eine
 * fertige Zeile laufen.
 *
 * Warum es das braucht (Befund 08.09.2026): nacht-recherche schreibt den Mangel
 * — "Regel riss auch im 2. Versuch" — nur ins Run-Log, nie ins Sheet. Die
 * Freigabe-Runde konnte ihn deshalb nicht sehen und meldete an diesem Tag null
 * Befunde bei 60 Zeilen, von denen 23 einen hatten: 11 mit wörtlich
 * abgeschriebenem Branchen-Hook, 10 ohne Firmennamen. Ein `--freigeben` hätte
 * sie alle in den Versand gelegt, mit demselben Satz an dutzende Betriebe
 * derselben Branche.
 *
 * Die Prüfungen werden bewusst importiert statt nachgebaut. Ein Nachbau driftet
 * — am selben Tag liess das nachgebaute Muster in neu-generieren.ts einen
 * Entwurf durch, weil ihm gegenüber dem Original nur das i-Flag fehlte.
 */
export function regelBefunde(
  zeile: { name: string; entwurf: string; betreff: string; nische: string },
  verbrauchteBetreffe: string[]
): string[] {
  const out: string[] = [];
  if (!nameIstGenannt(zeile.entwurf, zeile.name)) out.push("Firmenname fehlt im Entwurf");

  const hook = hookZurNische(zeile.nische);
  if (hook === null) out.push(`Nische "${zeile.nische}" unbekannt — Hook-Regel ungeprüft`);
  else if (hookIstAbgeschrieben(zeile.entwurf, hook)) out.push("Branchen-Hook wörtlich übernommen");

  if (oeffnerIstFloskel(zeile.entwurf)) out.push("Floskel-Einstieg");
  if (!betreffIstBrauchbar(zeile.betreff, verbrauchteBetreffe)) {
    out.push(`Betreff unbrauchbar oder doppelt: "${zeile.betreff}"`);
  }
  return out;
}

/**
 * Welche Zeilen dürfen NICHT freigegeben werden. Eine "repariert"-Zeile darf
 * raus — die Reparatur ist ja erledigt. "verworfen" und "prüfen" halten auf.
 */
export function gesperrteZeilen(befunde: Map<number, Befund[]>): Set<number> {
  return new Set(
    [...befunde]
      .filter(([, l]) => l.some((b) => b.art === "verworfen" || b.art === "prüfen"))
      .map(([nr]) => nr)
  );
}
