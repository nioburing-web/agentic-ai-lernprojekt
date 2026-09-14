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
 * Rechtsformen, die in einem Maps-Titel stehen, im Satz einer Mail aber nichts
 * zu suchen haben. Längere Formen zuerst, sonst bleibt von "GmbH & Co. KG" ein
 * "& Co. KG" übrig.
 *
 * Die Grenzen sind Buchstaben und Ziffern, nicht `\b`: `\b` kennt keine Umlaute,
 * und "haftungsbeschränkt" wäre dafür schon am "ä" zu Ende. Die kurzen
 * Großbuchstaben-Formen (AG, KG, UG, OHG) sind bewusst ohne i-Flag — "AGATHE"
 * und "ug" in einem Wort sind keine Rechtsform.
 */
//
// Vor der Form darf kein Bindestrich stehen: "GEHANN Hausverwaltungs-GmbH" hiess
// nach dem Schneiden "GEHANN Hausverwaltungs" — ein abgeschnittenes Wort ist
// schlimmer als eine Rechtsform. Gefunden im Diff über 1689 echte Namen, nicht
// von der Suite.
const RECHTSFORMEN: RegExp[] = [
  ["(GmbH|mbH|UG|AG)\\s*&\\s*Co\\.?\\s*KG", "giu"],
  ["&\\s*Co\\.?\\s*KG", "giu"],
  ["UG\\s*\\(\\s*haftungsbeschränkt\\s*\\)", "gu"],
  ["\\(\\s*haftungsbeschränkt\\s*\\)", "giu"],
  ["Partnerschaftsgesellschaft\\s+mbB", "giu"],
  ["Partnerschaft\\s+mbB", "giu"],
  ["Part(G)?\\s*mbB", "giu"],
  ["PartG", "gu"],
  ["gGmbH", "gu"],
  ["GmbH", "giu"],
  ["mbH", "giu"],
  ["mbB", "giu"],
  ["e\\.\\s?K(fm|fr)?\\.", "gu"],
  ["[oO]HG", "gu"],
  ["GbR", "giu"],
  ["Ltd\\.?", "giu"],
  ["KG", "gu"],
  ["AG", "gu"],
  ["UG", "gu"],
].map(([kern, flags]) => new RegExp(`(?<![\\p{L}\\p{N}-])${kern}(?![\\p{L}\\p{N}])`, flags));

/** Wörter, auf die ein Name nicht enden darf — sonst hängt der Satz ("Die Anwälte für"). */
const HAENGENDE_WOERTER = new Set([
  "in", "im", "am", "an", "bei", "für", "fuer", "von", "vom", "zum", "zur",
  "der", "die", "das", "und", "u.", "&", "+", "/", ":",
]);

/**
 * Darf die Stadt weg? Nur wenn danach ein Name steht, der ohne sie trägt.
 *
 * Zwei Fälle aus dem Diff vom 14.09.2026: "Versicherungsmakler Köln" wurde
 * "Versicherungsmakler" (kein Name mehr, nur ein Beruf), und "Die Anwälte für
 * München" wurde "Die Anwälte für". Ein Einzelwort bleibt nur ohne Stadt, wenn es
 * nach Marke aussieht — mindestens zwei Großbuchstaben, wie "IMMODO" oder
 * "PhysMed". "Epilacia Hannover" behält die Stadt; das liest sich noch, ein
 * falscher Name nicht.
 */
function ohneStadtTraegt(kandidat: string): boolean {
  const woerter = kandidat.split(/\s+/).filter(Boolean);
  const letztes = (woerter[woerter.length - 1] ?? "").toLowerCase();
  if (HAENGENDE_WOERTER.has(letztes)) return false;
  if (woerter.length === 1 && !/\p{Lu}.*\p{Lu}/u.test(woerter[0] as string)) return false;
  return true;
}

/** Wörter eines Stadtnamens, so zerlegt wie in `saubererBetriebsname`. */
function stadtWoerterAus(stadt: string): Set<string> {
  return new Set(stadt.toLowerCase().split(/[\s,\-]+/).filter((w) => w.length >= 3));
}

/** Besteht der Text nur aus Branche und Stadt? Kürzel wie "JK" zählen nicht als generisch. */
function nurBrancheUndStadt(text: string, stadtWoerter: Set<string>): boolean {
  const woerter = text.toLowerCase().split(/[\s.]+/).filter((w) => w.length >= 3);
  if (woerter.length === 0) return false;
  return woerter.every((w) => GENERISCHE_TITELWOERTER.has(w) || stadtWoerter.has(w));
}

function aufraeumen(text: string): string {
  return text
    // Klammern, die nach dem Schneiden leer sind oder nur "& Co." tragen:
    // "Hinsch & Völckers KG (GmbH & Co.)" ergab sonst "Hinsch & Völckers ( & Co.)".
    .replace(/\(\s*(&\s*Co\.?)?\s*\)/giu, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+([,)])/g, "$1")
    .replace(/^[\s,&|–—-]+|[\s,&|–—-]+$/g, "")
    .trim();
}

/**
 * Der Name, der in den Satz einer Mail kommt — und gegen den geprüft wird, ob er
 * dort steht. Eine Funktion für beides, damit Prompt und Prüfung nie
 * verschiedene Namen meinen.
 *
 * Warum (Freigabe-Runde 14.09.2026): 21 von 53 verworfenen Entwürfen trugen den
 * Maps-Namen im Fließtext — "ADVA GmbH Steuerberatungsgesellschaft kümmert sich",
 * "bei der Fahrschule Tiger UG (haftungsbeschränkt)". `saubererBetriebsname`
 * schneidet SEO-Segmente ab; was im Namenssegment selbst steht, lässt es stehen.
 * Und die Namensprüfung verlangte notfalls das längste Wort des rohen Titels,
 * bei der Fahrschule also "haftungsbeschränkt". Der Neuversuch lieferte genau das.
 * Im Lauf vom 13.09. löste die Namensregel 19 von 30 Neuversuchen aus.
 *
 * Drei Schritte, jeder mit derselben Untergrenze: bleibt danach kein brauchbarer
 * Name übrig oder nur Branche plus Stadt, gilt der Schritt nicht. Lieber
 * "Fahrschule Nürnberg" als "Fahrschule".
 *
 * Bewusst nicht angefasst: Kommas. "Müller, Schmidt & Partner" ist ein Name.
 */
export function nameFuerMail(titel: string, stadt = ""): string {
  const stadtWoerter = stadtWoerterAus(stadt);
  const traegt = (kandidat: string) =>
    nameIstBrauchbar(kandidat) && !nurBrancheUndStadt(kandidat, stadtWoerter);

  let name = saubererBetriebsname(titel, stadt);

  // 1. Rechtsform raus.
  const ohneRechtsform = aufraeumen(RECHTSFORMEN.reduce((t, re) => t.replace(re, " "), name));
  if (ohneRechtsform !== name && traegt(ohneRechtsform)) name = ohneRechtsform;

  // 2. "in <Stadt>" am Ende raus. Groß und klein: "KOSMETIK IN MANNHEIM".
  const inStadt = name.match(/^(.*\S)\s+in\s+(\S.*)$/iu);
  if (inStadt) {
    const rest = (inStadt[2] as string).toLowerCase().split(/[\s,\-]+/).filter((w) => w.length >= 3);
    const kandidat = aufraeumen(inStadt[1] as string);
    if (
      rest.length > 0 && rest.every((w) => stadtWoerter.has(w)) &&
      traegt(kandidat) && ohneStadtTraegt(kandidat)
    ) name = kandidat;
  }

  // 3. Stadt als letztes Wort raus, auch mehrteilig ("Bad Homburg").
  let woerter = name.split(/\s+/);
  while (woerter.length > 1 && stadtWoerter.has((woerter[woerter.length - 1] as string).toLowerCase())) {
    const kandidat = aufraeumen(woerter.slice(0, -1).join(" "));
    if (!traegt(kandidat) || !ohneStadtTraegt(kandidat)) break;
    name = kandidat;
    woerter = name.split(/\s+/);
  }

  return name;
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

/**
 * Steht die Betreffzeile als Kopfzeile im Mailtext?
 *
 * Lag bis zum 10.09.2026 nur in `tools/freigabe-pruefung.ts`, also allein im
 * Prüfer. Hier, weil beide Seiten dieselbe Regel brauchen und eine Regel an
 * zwei Stellen auseinanderläuft — am 08.09. reichte ein fehlendes `i`-Flag in
 * einem Nachbau, damit ein Entwurf mit Floskel-Einstieg als sauber durchging.
 *
 * Nur die ERSTE nicht-leere Zeile zählt. Sonst meldet jeder Satz, in dem das
 * Wort "Betreff:" vorkommt, einen Befund.
 */
export function betreffzeileImText(inhalt: string): boolean {
  const ersteZeile = (inhalt ?? "").split(/\r?\n/).find((z) => z.trim().length > 0) ?? "";
  return /^\s*betreff\s*:/i.test(ersteZeile);
}

/**
 * Die Kopfzeile weg, der Rest unverändert.
 *
 * Erfindet nichts: der Betreff steht bereits in Spalte I, im Mailtext ist er
 * eine Dopplung. Deshalb darf das mechanisch passieren, so wie die Anrede in
 * `vereinheitlicheAnrede` — und anders als der Betreff selbst, der nur gemeldet
 * und nie stillschweigend umgeschrieben wird.
 */
export function ohneBetreffKopfzeile(inhalt: string): string {
  if (!betreffzeileImText(inhalt)) return inhalt;
  return (inhalt ?? "").replace(/^\s*betreff\s*:.*(?:\r?\n)+/i, "").trim();
}

/**
 * Bricht der Betreff die Kleinschreibung, die der Prompt verlangt?
 *
 * Der Prompt sagt seit Wochen "Max 6 Wörter, klein geschrieben wie von einem
 * Menschen getippt". Geprüft wurde das bis zum 10.09.2026 nur in
 * `tools/freigabe-runde.ts`, also erst im Prüfer — der Erzeuger konnte eine
 * Regel gar nicht erfüllen, die erst nach ihm angelegt wurde. An diesem Tag
 * hielt sie 8 von 53 offenen Zeilen auf.
 *
 * Sechster Fall derselben Bauart nach Betreff (17.07.), Firmenname (09.08.),
 * Hook (13.08.), Einstieg (27.08.) und Vorlage (08.09.): die Regel stand im
 * Prompt, aber nichts hat das Ergebnis nachgemessen.
 *
 * Bewusst NICHT automatisch kleingeschrieben: im Deutschen trägt die
 * Großschreibung Bedeutung. `toLowerCase()` macht aus "Frage zur
 * Unternehmensnachfolge" ein "frage zur unternehmensnachfolge" und aus dem
 * höflichen "Sie" ein "sie". Also erkennen und einmal gezielt nachfassen, so
 * wie bei den fünf Regeln davor.
 */
export function betreffBrichtKleinschreibung(betreff: string): boolean {
  const b = (betreff ?? "").trim();
  if (b.length === 0) return false;
  return b !== b.toLowerCase();
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
