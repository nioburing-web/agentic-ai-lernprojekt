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
  vorlageIstAbgeschrieben,
  vorlagenFuer,
} from "../src/trigger/nacht-recherche";
import { oeffnerIstFloskel, betreffzeileImText, nameFuerMail } from "../src/trigger/entwurf-qualitaet";
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
 * Die Blickwinkel-Vorlagen zu einer Nische, ohne den Hook — der hat seine
 * eigene Prüfung, sonst meldet ein Hook-Verstoß hier ein zweites Mal.
 * Welcher Blickwinkel gezogen wurde, steht nirgends im Sheet, also alle.
 */
export function strukturenZurNische(nischenName: string): string[] {
  for (const k of KATEGORIEN) {
    for (const n of k.nischen) {
      if (n.name === nischenName) return vorlagenFuer(k, n);
    }
  }
  return [];
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
  zeile: { name: string; entwurf: string; betreff: string; nische: string; stadt?: string },
  verbrauchteBetreffe: string[]
): string[] {
  const out: string[] = [];
  // Gegen den Namen, der im Prompt stand, nicht gegen den rohen Maps-Titel aus
  // Spalte B. Sonst verlangt die Prüfung dessen längstes Wort, und das ist oft
  // die Rechtsform (Freigabe-Runde 14.09.2026).
  if (!nameIstGenannt(zeile.entwurf, nameFuerMail(zeile.name, zeile.stadt ?? ""))) out.push("Firmenname fehlt im Entwurf");

  const hook = hookZurNische(zeile.nische);
  if (hook === null) out.push(`Nische "${zeile.nische}" unbekannt — Hook-Regel ungeprüft`);
  else if (hookIstAbgeschrieben(zeile.entwurf, hook)) out.push("Branchen-Hook wörtlich übernommen");

  // Zweite Vorlage neben dem Hook (Befund 08.09.2026): 7 von 24 Entwürfen
  // trugen denselben Satz aus mailAngles(). Gemessen über 160 echte Entwürfe
  // liegt zwischen normaler Sprachüberschneidung (≤5 Wörter) und Abschreiben
  // (≥8 Wörter) eine leere Zone — die Schwelle 7 sitzt darin.
  const strukturen = strukturenZurNische(zeile.nische);
  if (strukturen.length && vorlageIstAbgeschrieben(zeile.entwurf, strukturen)) {
    out.push("Blickwinkel-Vorlage wörtlich übernommen");
  }

  // Betreffzeile IM Text (Befund 09.09.2026): das Modell wiederholt den Betreff
  // gelegentlich als erste Zeile des Mailtextes. Der Betreff steht aber schon in
  // Spalte I und wird von morgen-versand separat gesetzt — im Text gelesen wirkt
  // er wie die Kopfzeile eines Formbriefs. Keine der bestehenden Regeln sah das:
  // an diesem Tag trugen 7 von 41 freigabereifen Entwürfen die Zeile, und
  // --freigeben hätte sie mitgenommen.
  //
  // Seit dem 10.09.2026 liegt die Regel in `entwurf-qualitaet.ts` und wird von
  // dort importiert, nicht mehr hier nachgebaut: der Erzeuger braucht dieselbe
  // Prüfung, und zwei Fassungen laufen auseinander. Die Ursache saß ohnehin
  // eine Stufe früher — `zerlegeAntwort` nahm ohne `EMAIL:`-Marker die ganze
  // Rohausgabe und schob die Betreffzeile selbst in den Mailtext.
  if (betreffzeileImText(zeile.entwurf)) {
    const ersteZeile = zeile.entwurf.split(/\r?\n/).find((z) => z.trim().length > 0) ?? "";
    out.push(`Betreffzeile steht im Mailtext: "${ersteZeile.trim().slice(0, 60)}"`);
  }

  if (oeffnerIstFloskel(zeile.entwurf)) out.push("Floskel-Einstieg");
  if (!betreffIstBrauchbar(zeile.betreff, verbrauchteBetreffe)) {
    out.push(`Betreff unbrauchbar oder doppelt: "${zeile.betreff}"`);
  }
  return out;
}

/**
 * Liest eine Zeilenliste wie "1526,1555,1559" aus einem Kommandozeilen-Argument.
 *
 * Warum es das gibt (09.09.2026): die Runde trennt Mechanik von Urteil, aber das
 * Urteil hatte keinen Ort. `--freigeben` nimmt jede Zeile ohne Befund mit, also
 * auch die, die ein Mensch beim Lesen als unpassend erkannt hat — englischer
 * Maps-Name mitten im Satz, Adresse einer fremden Domain, eine erfundene Aussage
 * über die Website des Empfängers. Wer das sah, musste bisher das Sheet von Hand
 * anfassen. Damit war die Runde nur zur Hälfte durchführbar, und der Rest lag
 * ausserhalb jeder Prüfung.
 *
 * Bewusst streng: was keine positive ganze Zahl ist, fällt raus. Ein Vertipper
 * soll keine fremde Zeile verwerfen.
 */
export function zeilenAusArgument(arg: string): Set<number> {
  const out = new Set<number>();
  for (const teil of (arg ?? "").split(",")) {
    const roh = teil.trim();
    if (!/^\d+$/.test(roh)) continue;
    const n = Number.parseInt(roh, 10);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return out;
}

/**
 * Welche PRUEFEN-Zeilen neu-generieren.ts anfassen darf.
 *
 * Warum es das gibt (17.09.2026): am 09.09. sollte der Lauf 18 defekte Entwürfe
 * reparieren und schrieb stattdessen jede PRUEFEN-Zeile neu. Unentdeckte Defekte
 * stiegen von 1 auf 7, gute Betreffe wurden ersetzt. Seitdem blieben Befund-Zeilen
 * liegen — am 17.09. waren es 29.
 *
 * Ohne Liste: nur Zeilen mit Regel-Befund. Eine saubere Zeile neu zu würfeln ist
 * bei temperature 0.9 keine Reparatur, sondern ein Risiko.
 * Mit Liste: genau die genannten Zeilen, sofern sie Kandidaten sind. Was genannt,
 * aber nicht auf PRUEFEN ist, wird gemeldet statt still übergangen.
 */
export function zeilenZumNeuSchreiben(
  kandidaten: Array<{ nummer: number; befunde: string[] }>,
  explizit: Set<number>
): { nehmen: Set<number>; unbekannt: number[] } {
  const bekannt = new Set(kandidaten.map((k) => k.nummer));
  if (explizit.size > 0) {
    return {
      nehmen: new Set([...explizit].filter((n) => bekannt.has(n))),
      unbekannt: [...explizit].filter((n) => !bekannt.has(n)),
    };
  }
  return {
    nehmen: new Set(kandidaten.filter((k) => k.befunde.length > 0).map((k) => k.nummer)),
    unbekannt: [],
  };
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

/**
 * Baut aus einer rohen Sheet-Zeile die Eingabe fuer regelBefunde().
 *
 * Warum es das gibt (18.09.2026): lesefassung.ts und freigabe-runde.ts bauten
 * diese Eingabe getrennt, und der Lesefassung fehlte `stadt`. Ohne Stadt prueft
 * nameFuerMail gegen den rohen Maps-Titel samt Ortszusatz und meldet
 * "Firmenname fehlt". Die Lesefassung versteckte so eine Zeile, die --freigeben
 * mitgenommen haette: sie waere ungelesen rausgegangen. Aufgefallen nur, weil
 * der Trockenlauf 15 statt 14 zeigte. Eine Stelle statt zwei.
 */
export function pruefEingabeAusZeile(r: readonly unknown[]): {
  name: string; stadt: string; entwurf: string; betreff: string; nische: string;
} {
  const feld = (i: number): string => String(r[i] ?? "");
  return { name: feld(1), stadt: feld(2), entwurf: feld(4), betreff: feld(8), nische: feld(19) };
}
