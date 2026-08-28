/**
 * Zaehlt, wie oft `nacht-recherche` beim Modell nachfassen musste.
 *
 * Warum es das gibt (28.08.2026): Im Fokus steht seit dem 23.08. der Satz
 * "Ob die 60-%-Retry-Quote faellt, ist nachzuzaehlen, nicht zu vermuten."
 * Nachgezaehlt wurde sie nie — und der Grund ist banal: Nachzaehlen hiess,
 * einen 611-Zeilen-Trace im Dashboard von Hand durchzugehen. Eine Messung, die
 * so teuer ist, findet nicht statt. Dann bleibt die Vermutung stehen, und beim
 * naechsten Mal steht derselbe Satz wieder im Fokus.
 *
 * Also misst der Lauf sich selbst und gibt die Zahl dort zurueck, wo ohnehin
 * schon gelesen wird: im Run-Output. Derselbe Schritt wie am 25.08. beim
 * Leerlauf — nicht besser hinsehen, sondern das Ergebnis zurueckgeben.
 *
 * Was die Zahl bedeutet: Jeder Nachfass ist ein **zweiter** LLM-Aufruf fuer
 * denselben Entwurf. Bei 30 Entwuerfen pro Nacht und 0,033 $ pro Lauf ist das
 * heute kein Kostenproblem. Bei `imTest: false` und taeglichem Vollbetrieb wird
 * es eins — und dann ist es schwerer zu aendern als jetzt.
 */

/** Die vier Pruefungen, die einen zweiten Aufruf ausloesen koennen. */
export type Nachfassgrund = "betreff" | "name" | "hook" | "einstieg";

export type Nachfasszaehler = {
  entwuerfe: number;
  ausgeloest: Partial<Record<Nachfassgrund, number>>;
  gescheitert: Partial<Record<Nachfassgrund, number>>;
};

export function neuerNachfasszaehler(): Nachfasszaehler {
  return { entwuerfe: 0, ausgeloest: {}, gescheitert: {} };
}

/**
 * Ein Entwurf ist entstanden.
 *
 * Bewusst erst hier und nicht schon beim Lead: wer uebersprungen wird (zu wenig
 * Website-Text, Dublette, unbrauchbare Adresse), hat nie einen LLM-Aufruf
 * ausgeloest und gehoert nicht in den Nenner. Sonst verduennt sich die Quote
 * genauso still wie die Reply-Rate durch die sieben toten Adressen am 20.08.
 */
export function zaehleEntwurf(zaehler?: Nachfasszaehler): void {
  if (zaehler) zaehler.entwuerfe++;
}

/**
 * Ein Nachfass wurde ausgeloest.
 *
 * `geloest` trennt die beiden Faelle, die sich sehr unterschiedlich anfuehlen:
 * ein Nachfass, der das Problem behebt, hat sich gelohnt. Einer, der es nicht
 * behebt, hat nur Geld gekostet und das Problem steht trotzdem im Entwurf —
 * das ist die Sorte, die eine Regel ueberfaellig macht statt sie zu belegen.
 */
export function zaehleNachfass(
  zaehler: Nachfasszaehler | undefined,
  grund: Nachfassgrund,
  geloest: boolean,
): void {
  if (!zaehler) return;
  zaehler.ausgeloest[grund] = (zaehler.ausgeloest[grund] ?? 0) + 1;
  if (!geloest) zaehler.gescheitert[grund] = (zaehler.gescheitert[grund] ?? 0) + 1;
}

export type Nachfassbericht = {
  entwuerfe: number;
  nachgefasst: number;
  /** Zusatzaufrufe je Entwurf. Kann ueber 1 gehen — ein Entwurf kann mehrfach nachfassen. */
  quote: number;
  ausgeloest: Partial<Record<Nachfassgrund, number>>;
  gescheitert: Partial<Record<Nachfassgrund, number>>;
};

export function nachfassBericht(zaehler: Nachfasszaehler): Nachfassbericht {
  const nachgefasst = Object.values(zaehler.ausgeloest).reduce((a, b) => a + b, 0);
  const quote = zaehler.entwuerfe === 0 ? 0 : Math.round((nachgefasst / zaehler.entwuerfe) * 100) / 100;
  return {
    entwuerfe: zaehler.entwuerfe,
    nachgefasst,
    quote,
    ausgeloest: zaehler.ausgeloest,
    gescheitert: zaehler.gescheitert,
  };
}
