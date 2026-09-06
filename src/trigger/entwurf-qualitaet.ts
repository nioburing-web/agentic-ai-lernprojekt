/**
 * Zwei Prüfungen am Mail-Entwurf, die beide aus der Freigabe-Runde vom
 * 27.08.2026 stammen und beide dieselbe Bauart haben wie Betreff (17.07.),
 * Firmenname (09.08.) und Hook (13.08.): Der Prompt sagt es seit Wochen, das
 * Ergebnis hat es nie jemand nachgemessen.
 *
 * Die Anrede-Umformung liegt getrennt in `anrede.ts` — die ist reparierbar,
 * diese beiden sind es nicht und brauchen deshalb einen anderen Weg.
 */

import { KATEGORIEN } from "./nischen";

// Generische Bestandteile eines Google-Maps-Titels. Maps liefert nicht den Namen
// des Betriebs, sondern den SEO-Titel.
//
// Zwei Quellen, und das mit Absicht:
//
// 1. Die Branchenwoerter kommen aus `nischen.ts`, nicht aus einer zweiten Liste
//    hier. Der Grund steht in einem eigenen Befund vom 28.08.2026: die
//    handgepflegte Liste war auf Zahnarzt, Friseur und Tierarzt stehen
//    geblieben, waehrend die Nischen-Rotation laengst auf Steuerkanzleien und
//    Hausverwaltungen umgestellt hatte. "Hausverwaltung Wiesbaden - Naspa
//    Immobilien GmbH" blieb deshalb ungekuerzt. Eine neue Nische bringt ihr
//    Vokabular ab jetzt selbst mit; vergessen kann man es nicht mehr.
// 2. Der handgepflegte Rest deckt ab, was keine Nische ist: Rechtsform,
//    Praxis-Woerter, Fuellwoerter.
const NISCHEN_WOERTER = KATEGORIEN.flatMap((k) =>
  k.nischen.flatMap((n) => [n.name, ...n.suchbegriffe]),
)
  .flatMap((begriff) => begriff.toLowerCase().split(/[^a-zäöüß]+/))
  .filter((w) => w.length >= 3);

const GENERISCHE_TITELWOERTER = new Set([
  ...NISCHEN_WOERTER,
  "zahnaerzte", "tieraerztliche", "tierärztliche", "zahnmedizin", "zahnheilkunde",
  "hairdresser", "coiffeur", "fusspflege",
  "praxis", "praxisklinik", "klinik", "studio", "salon", "institut", "zentrum",
  "büro", "buero", "kanzlei",
  "für", "fuer", "und", "der", "die", "das", "ihre", "ihr",
]);

/**
 * Trenner in einem Google-Maps-Titel: die Pipe und der freistehende Strich.
 *
 * Der Strich muss auf beiden Seiten Leerraum haben. Sonst zerlegt die Regel
 * durchgekoppelte Namen, und davon leben ganze Branchen: "Scholze-Kurz",
 * "FNW Haus- und Grundstücksverwaltung", "Unternehmens-Partner".
 */
const TRENNER = /\s*\|\s*|\s+[-–—]\s+/;

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
 * Die Regel wirft nur Segmente weg, die restlos aus Branche und Stadt bestehen.
 * Sie rät nichts: bleibt nichts übrig, gewinnt das erste Segment.
 *
 * Zwei Nachträge aus der Freigabe-Runde vom 28.08.2026, beide an echten Zeilen
 * der Nacht davor gefunden:
 *
 * 1. Getrennt wurde nur an "|". Maps liefert genauso oft " - ", und dann lief
 *    der ganze SEO-Schwanz ungefiltert durch — "DEBUS Immobilien Rüdiger Debus
 *    - Immobilienmakler - Verkauf, Vermietung und Verwaltung von Immobilien".
 *    3 von 30 Entwürfen der Nacht waren betroffen.
 *
 * 2. Bei einer Partnerschaft blieb nur der erste Partner übrig: aus
 *    "HERKERT | SCHULZ | FRICK Rechtsanwälte Steuerberater PartG" wurde
 *    "HERKERT". Das ist derselbe Schaden wie der SEO-Titel, nur andersherum —
 *    die Kanzlei im ersten Satz falsch zu nennen ist nicht besser, als sie zu
 *    lang zu nennen. Siehe `zieheFuehrendeNachnamen`.
 */
export function saubererBetriebsname(titel: string, stadt = ""): string {
  const roh = (titel ?? "").trim();
  if (!TRENNER.test(roh)) return roh;

  const stadtWoerter = new Set(
    stadt.toLowerCase().split(/[\s,\-]+/).filter((w) => w.length >= 3),
  );

  const segmente = roh.split(TRENNER).map((t) => t.trim()).filter(Boolean);

  const istGenerisch = (segment: string): boolean => {
    const woerter = segment.toLowerCase().split(/[\s.]+/).filter((w) => w.length >= 3);
    // Bleibt nach dem Raster nichts uebrig, besteht das Segment nur aus kurzen
    // Kuerzeln — "JK", "F80", "1a". Das ist eine Marke und nie eine Branche.
    // Vor dem 28.08. galt so ein Segment als generisch; solange nur an "|"
    // getrennt wurde, fiel das nicht auf. Mit dem Bindestrich als Trenner wurde
    // daraus sofort ein Schaden: aus "JK - Bueroservice" wurde "Bueroservice",
    // also die Branche statt des Namens.
    if (woerter.length === 0) return false;
    return woerter.every((w) => GENERISCHE_TITELWOERTER.has(w) || stadtWoerter.has(w));
  };

  const zusammengezogen = zieheFuehrendeNachnamen(segmente, istGenerisch);

  const echte = zusammengezogen.filter((seg) => !istGenerisch(seg));
  if (echte.length === 0) return zusammengezogen[0] ?? roh;
  return echte[0] as string;
}

/**
 * Zieht führende Einzelwort-Segmente mit dem Segment dahinter zusammen.
 *
 * Warum das genau der Partner-Fall ist und nicht der SEO-Fall: Eine Kanzlei
 * heißt "HERKERT | SCHULZ | FRICK Rechtsanwälte Steuerberater PartG" — drei
 * nackte Nachnamen hintereinander, dann die Rechtsform. Ein SEO-Titel heißt
 * "dentimea | Zahnarzt Augsburg | ..." — nach der Marke kommt sofort
 * Branche+Stadt. Die Kette bricht deshalb am ersten generischen Segment ab,
 * und nur dort. Ein mehrwortiges erstes Segment ("Hair Deluxe", "Gladigau
 * Immobilien Hamburg") ist kein Nachname und startet die Kette gar nicht.
 *
 * Zusammengefügt wird mit Leerzeichen, nicht mit dem Original-Trenner: der Name
 * landet in einem Fließtext, und "bei HERKERT | SCHULZ | FRICK" liest sich dort
 * wie ein Datenbankfeld.
 */
function zieheFuehrendeNachnamen(
  segmente: string[],
  istGenerisch: (s: string) => boolean,
): string[] {
  const istNachname = (seg: string) => seg.split(/\s+/).length === 1 && !istGenerisch(seg);

  let k = 0;
  while (k < segmente.length && istNachname(segmente[k] as string)) k++;
  if (k < 2) return segmente; // ein einzelnes Wort ist eine Marke, keine Partnerschaft

  // Das Segment hinter der Kette gehört dazu, solange es nicht generisch ist —
  // es trägt die Rechtsform ("FRICK Rechtsanwälte Steuerberater PartG").
  const nimmDanach = k < segmente.length && !istGenerisch(segmente[k] as string);
  const bis = nimmDanach ? k + 1 : k;
  return [segmente.slice(0, bis).join(" "), ...segmente.slice(bis)];
}

/**
 * Ist das ein Name, den man in einem Satz an einen Fremden schreiben kann?
 *
 * Warum das eine eigene Prüfung ist und nicht Teil von `saubererBetriebsname`
 * (Fund 06.09.2026): Am 04.09. trug eine Queue-Zeile den Firmennamen `lz`, und
 * er leckte in den Mailtext ("Wäre das für lz einen Blick wert?"). Notiert
 * wurde daraufhin, die Schneideregel schneide zu viel — **das war die falsche
 * Diagnose.** Die Gegenprobe über alle 1509 Namen der Queue zeigt: `lz` stand
 * schon so in Spalte B, also genau so, wie Google Maps den Betrieb betitelt
 * hat. `saubererBetriebsname("lz")` gibt `lz` zurück, weil es nichts zu
 * schneiden gibt. Die Schneideregel ist unschuldig, sie hat den Fall nur nicht
 * aufgehalten.
 *
 * Der echte Fehler ist eine fehlende Untergrenze: Es gab keine Stelle, die
 * fragt, ob der Name überhaupt einer ist. `nameIstGenannt()` verlangt danach,
 * dass er in der Mail vorkommt, und erzwingt so die Peinlichkeit sogar noch.
 *
 * Zwei Zeichen sind nie ein Betriebsname. Wer nicht weiß, wie der Laden heißt,
 * schreibt ihn nicht an — eine Kaltakquise-Mail mit falschem Namen ist
 * schlechter als keine. Deshalb überspringen und nicht raten: aus der Domain
 * einen Namen zu basteln wäre wieder eine erfundene Aussage über die Welt.
 *
 * Das Kaufmanns-Und zählt als Zeichen des Namens, nicht als Satzzeichen: "K&L"
 * ist eine echte Kanzlei und muss durchkommen. Ohne diese Ausnahme lag die
 * Regel bei zwei Zeichen und hätte einen gültigen Namen weggeworfen — gefunden
 * vom eigenen Test, nicht vom Bestand, weil so ein Name dort noch nicht vorkam.
 */
export function nameIstBrauchbar(name: string): boolean {
  const zeichen = (name ?? "").replace(/[^\p{L}\p{N}&]/gu, "");
  return zeichen.length >= 3;
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
