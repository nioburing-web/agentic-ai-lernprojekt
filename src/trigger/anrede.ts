/**
 * Vereinheitlicht die Anrede in einem Mail-Entwurf auf "ihr".
 *
 * Warum es diese Datei gibt (27.08.2026): Das Modell mischt in jedem Lauf einen
 * Teil der Entwürfe — "bei X bietest du ..." im ersten Satz, "wäre das für euch
 * einen Blick wert?" im letzten. In der Freigabe-Runde am 27.08. waren es
 * 17 von 60. Der Prompt sagt seit Wochen "ihr". Eine Prompt-Regel ist keine
 * Garantie, das ist die Lehre vom 17.07.
 *
 * Warum deterministisch statt Nachfass-Prompt wie bei Betreff, Firmenname und
 * Hook: die Anrede ist keine schöpferische Entscheidung, sondern eine
 * mechanische Umformung. Zwei Läufe kämen zum selben Ergebnis — dann gehört sie
 * in Code. Ein zweiter LLM-Aufruf kostet Geld, dauert, und hält laut Messung
 * vom 25.08. ohnehin nur bei rund zwei Dritteln.
 */

// Deutsche Kleinbuchstaben inklusive Umlaute. Ohne die Umlaute würde "kümmerst"
// nicht getroffen, und genau solche Verben stehen in den Reibungssätzen.
const WORT = "[a-zäöüß]";

/**
 * Die Reihenfolge ist Teil der Regel, nicht Geschmack:
 *  1. zusammenhängende Paare ("du kannst")
 *  2. getrennte Stellungen ("du ... kannst")
 *  3. übrige Pronomen ("dich", "dein")
 *  4. Imperativ Singular
 *
 * Wer 3 vor 1 zieht, ersetzt "du" durch "ihr" und lässt das Verb in der
 * 2. Person Singular stehen — "ihr kannst". Das wäre schlimmer als vorher.
 */
const ANREDE_REGELN: Array<[RegExp, string]> = [
  // 1a. Verb vorne (Frage, Inversion) — unregelmäßige Verben zuerst
  [/\bkannst du\b/gi, "könnt ihr"],
  [/\bkönntest du\b/gi, "könntet ihr"],
  [/\bmusst du\b/gi, "müsst ihr"],
  [/\bhast du\b/gi, "habt ihr"],
  [/\bbist du\b/gi, "seid ihr"],
  [/\bwillst du\b/gi, "wollt ihr"],
  [/\bwirst du\b/gi, "werdet ihr"],
  [/\bweißt du\b/gi, "wisst ihr"],
  [/\bnimmst du\b/gi, "nehmt ihr"],
  [/\bgibst du\b/gi, "gebt ihr"],
  [/\bsiehst du\b/gi, "seht ihr"],

  // 1b. Pronomen vorne
  [/\bdu kannst\b/gi, "ihr könnt"],
  [/\bdu könntest\b/gi, "ihr könntet"],
  [/\bdu musst\b/gi, "ihr müsst"],
  [/\bdu hast\b/gi, "ihr habt"],
  [/\bdu bist\b/gi, "ihr seid"],
  [/\bdu willst\b/gi, "ihr wollt"],
  [/\bdu wirst\b/gi, "ihr werdet"],
  [/\bdu weißt\b/gi, "ihr wisst"],
  [/\bdu nimmst\b/gi, "ihr nehmt"],
  [/\bdu gibst\b/gi, "ihr gebt"],
  [/\bdu siehst\b/gi, "ihr seht"],

  // 1c. Regelmäßige Verben, direkt benachbart: "du bietest" / "bietest du".
  // Läuft nach den unregelmäßigen, damit "kannst" nicht zu "kannt" wird.
  [new RegExp(`\\bdu (${WORT}+)st\\b`, "gi"), "ihr $1t"],
  [new RegExp(`\\b(${WORT}+)st du\\b`, "gi"), "$1t ihr"],

  // 2. Getrennte Stellung: "den du direkt ausprobieren kannst".
  // Bewusst auf 60 Zeichen und einen Satz begrenzt — ohne Grenze würde die
  // Regel über einen Punkt hinweg ein Verb aus dem nächsten Satz einfangen.
  [/\bdu\b([^.!?;:\n]{0,60}?)\bkannst\b/gi, "ihr$1könnt"],
  [/\bdu\b([^.!?;:\n]{0,60}?)\bkönntest\b/gi, "ihr$1könntet"],
  [/\bdu\b([^.!?;:\n]{0,60}?)\bmusst\b/gi, "ihr$1müsst"],
  [new RegExp(`\\bdu\\b([^.!?;:\\n]{0,60}?)\\b(${WORT}{2,})st\\b`, "gi"), "ihr$1$2t"],

  // 3. Übrige Pronomen. "deinen/deinem/deiner/deines" vor "deine" vor "dein",
  // sonst frisst die kürzere Regel die Endung weg.
  [/\bdich\b/gi, "euch"],
  [/\bdir\b/gi, "euch"],
  [/\bdeine([nmrs])\b/gi, "eure$1"],
  [/\bdeine\b/gi, "eure"],
  [/\bdein\b/gi, "euer"],
  [/\bdu\b/gi, "ihr"],

  // 4. Imperativ Singular → Plural. Nur Verben, die in den Entwürfen wirklich
  // vorkommen. Kein "test"/"tipp" — das sind auch Substantive.
  [/\bschreib\b/gi, "schreibt"],
  [/\bprobier\b/gi, "probiert"],
  [/\bklick\b/gi, "klickt"],
  [/\bschau\b/gi, "schaut"],
  [/\bfrag\b/gi, "fragt"],
  [/\bnimm\b/gi, "nehmt"],
  [/\bmach\b/gi, "macht"],
];

/** Überträgt die Groß-/Kleinschreibung des Originals auf den Ersatz. */
function wieGeschrieben(original: string, ersatz: string): string {
  if (!original || !ersatz) return ersatz;
  const erster = original[0] as string;
  if (erster === erster.toUpperCase() && erster !== erster.toLowerCase()) {
    return (ersatz[0] as string).toUpperCase() + ersatz.slice(1);
  }
  return ersatz;
}

export function vereinheitlicheAnrede(text: string): string {
  let ergebnis = text ?? "";
  for (const [muster, ersatz] of ANREDE_REGELN) {
    ergebnis = ergebnis.replace(muster, (treffer: string, ...rest: unknown[]) => {
      // replace() hängt offset und den ganzen String hinten an — die zwei
      // gehören nicht zu den Gruppen.
      const gruppen = rest.slice(0, Math.max(0, rest.length - 2)) as Array<string | undefined>;
      const gefuellt = ersatz.replace(/\$(\d)/g, (_m, n: string) => gruppen[Number(n) - 1] ?? "");
      return wieGeschrieben(treffer, gefuellt);
    });
  }
  return ergebnis;
}

/**
 * Steht nach der Umformung noch eine Du-Form neben einer Ihr-Form? Dann hat eine
 * Formulierung die Regeln umgangen.
 *
 * Der Detektor ist der eigentliche Wert dieser Datei: die Umformung darüber
 * repariert, was sie kennt — der Detektor sagt, wann sie es nicht mehr tut.
 * Ohne ihn würde die nächste unbekannte Formulierung still durchgehen, genau
 * wie die Anrede selbst es monatelang getan hat.
 */
export function anredeIstGemischt(text: string): boolean {
  const t = text ?? "";
  const du = /\b(du|dich|dir|dein|deine[nmrs]?)\b/i.test(t);
  const ihr = /\b(ihr|euch|euer|eure[nmrs]?)\b/i.test(t);
  return du && ihr;
}
