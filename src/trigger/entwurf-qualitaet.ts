/**
 * Zwei Prüfungen am Mail-Entwurf, die beide aus der Freigabe-Runde vom
 * 27.08.2026 stammen und beide dieselbe Bauart haben wie Betreff (17.07.),
 * Firmenname (09.08.) und Hook (13.08.): Der Prompt sagt es seit Wochen, das
 * Ergebnis hat es nie jemand nachgemessen.
 *
 * Die Anrede-Umformung liegt getrennt in `anrede.ts` — die ist reparierbar,
 * diese beiden sind es nicht und brauchen deshalb einen anderen Weg.
 */

// Generische Bestandteile eines Google-Maps-Titels. Maps liefert nicht den Namen
// des Betriebs, sondern den SEO-Titel.
const GENERISCHE_TITELWOERTER = new Set([
  "zahnarzt", "zahnärzte", "zahnaerzte", "zahnarztpraxis", "zahnmedizin", "zahnheilkunde",
  "tierarzt", "tierarztpraxis", "tierärztliche", "tieraerztliche", "tierklinik",
  "friseur", "friseursalon", "hairdresser", "coiffeur",
  "kosmetik", "kosmetikstudio", "fußpflege", "fusspflege", "podologie", "fahrschule",
  "praxis", "praxisklinik", "klinik", "studio", "salon", "institut", "zentrum",
  "für", "fuer", "und", "der", "die", "das",
]);

/**
 * Holt aus einem Google-Maps-Titel den Teil, den ein Mensch als Namen des
 * Betriebs erkennen würde.
 *
 * Warum (27.08.2026): Der Prompt bekommt den Maps-Titel als `firma`, und das
 * Modell setzt ihn pflichtschuldig in den ersten Satz — weil `nameIstGenannt()`
 * genau das verlangt und sonst einen Neuversuch auslöst. Ergebnis an dem Tag:
 *
 *   "Hey, bei dentimea | Zahnarzt Augsburg | Praxisklinik für Zahnheilkunde und
 *    Implantologie | Dr. Dr. Alexander Mai bietet ihr Implantate ohne Skalpell an"
 *
 * Das ist die teuerste Zeile der Mail, und sie war verbrannt. Bemerkenswert:
 * Die Namensprüfung hat hier korrekt gearbeitet. Der Fehler saß eine Stufe
 * davor, in dem, was ihr als "Name" übergeben wurde.
 *
 * Die Regel schneidet nur an `|` und wirft nur Segmente weg, die restlos aus
 * Branche und Stadt bestehen. Sie rät nichts: bleibt nichts übrig, gewinnt der
 * Originaltitel.
 */
export function saubererBetriebsname(titel: string, stadt = ""): string {
  const roh = (titel ?? "").trim();
  if (!roh.includes("|")) return roh;

  const stadtWoerter = new Set(
    stadt.toLowerCase().split(/[\s,\-]+/).filter((w) => w.length >= 3),
  );

  const segmente = roh.split("|").map((t) => t.trim()).filter(Boolean);

  const istGenerisch = (segment: string): boolean => {
    const woerter = segment.toLowerCase().split(/[\s.]+/).filter((w) => w.length >= 3);
    if (woerter.length === 0) return true;
    return woerter.every((w) => GENERISCHE_TITELWOERTER.has(w) || stadtWoerter.has(w));
  };

  const echte = segmente.filter((seg) => !istGenerisch(seg));
  if (echte.length === 0) return segmente[0] ?? roh;
  return echte[0] as string;
}

// Eröffnungen, die der Prompt ausdrücklich verbietet, weil sie den Serienbrief
// verraten. Am 27.08.2026 standen sie trotzdem in 2 von 60 Entwürfen.
const VERBOTENE_OEFFNER = [
  /^ich habe gesehen/i,
  /^ich habe entdeckt/i,
  /^ich habe bemerkt/i,
  /^mir ist aufgefallen/i,
  /^ich bin auf euch gestoßen/i,
  /^ich bin über euch gestoßen/i,
];

/**
 * Fängt die Mail nach der Anrede mit einer verbotenen Beobachtungs-Floskel an?
 *
 * Geprüft wird nur der erste inhaltliche Satz, nicht der ganze Text: "ich habe
 * gesehen" mitten in der Mail ist harmlos, als Einstieg ist es der klassische
 * Serienbrief-Auftakt. Die Anrede wird vorher abgeschnitten, weil jede Mail mit
 * "Hey," beginnt und der Satz danach der eigentliche Einstieg ist.
 */
export function oeffnerIstFloskel(inhalt: string): boolean {
  const ohneAnrede = (inhalt ?? "")
    .trim()
    .replace(/^(hey|hallo|guten tag|moin|servus)[^,]{0,40},\s*/i, "");
  const ersterSatz = (ohneAnrede.split(/(?<=[.!?])\s/)[0] ?? "").trim();
  return VERBOTENE_OEFFNER.some((muster) => muster.test(ersterSatz));
}
