/**
 * Wiederholung bei voruebergehenden Fehlern der Google-APIs.
 *
 * Warum es das gibt (28.08.2026): `nacht-recherche` ist am 17.08. in
 * `sicherQueueTab` gescheitert — der allererste Sheets-Aufruf des Laufs, mit
 * "The service is currently unavailable." aus der Google-Auth. Kein Bug im
 * Code, kein kaputter Schluessel, ein Aussetzer von Sekunden. Gekostet hat er
 * eine komplette Akquise-Nacht: 30 Entwuerfe, die es nie gab, und einen
 * Versandtag auf 0/0. Der Health-Monitor hat den Ausfall gemeldet, aber
 * gemeldet ist nicht verhindert — und der naechste Aussetzer kommt.
 *
 * Der Kern ist nicht, dass wiederholt wird. Der Kern ist, dass **nicht**
 * wiederholt wird, wo es nichts bringt: ein 403 wird durch drei Versuche nicht
 * besser, er verdreifacht nur die Zeit bis zur Fehlermeldung — und in einem
 * Lauf mit `maxDuration: 900` ist Zeit das knappe Gut.
 *
 * Sicher wiederholbar ist das hier nur, weil kein Schreibweg anhaengt, der
 * doppelt wirken koennte: `speichereDraft` bestimmt die Zielzeile selbst und
 * schreibt per `update` auf einen festen Bereich, nicht per `append`. Ein
 * zweiter Versuch schreibt dieselbe Zeile an dieselbe Stelle. Waere es noch
 * `append`, wuerde jede Wiederholung eine Dublette erzeugen — der Grund, warum
 * dieser Kommentar hier steht und nicht nur im Commit.
 */

/** Netzwerk-Kennzeichen, die fuer sich genommen einen Aussetzer bedeuten. */
const VORUEBERGEHENDE_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "EPIPE", "ENOTFOUND",
]);

/** HTTP-Antworten, bei denen ein zweiter Versuch eine echte Chance hat. */
const VORUEBERGEHENDE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Textformen desselben Aussetzers. Google liefert den Fehler je nach Schicht
 * mal mit Status, mal nur als Satz — der 17.08.-Fall kam ohne Status durch.
 */
const VORUEBERGEHENDE_TEXTE = [
  "currently unavailable",
  "socket hang up",
  "temporarily unavailable",
  "backend error",
  "internal error",
  "rate limit",
  "quota exceeded",
  "timeout",
];

function statusVon(fehler: unknown): number | null {
  if (typeof fehler !== "object" || fehler === null) return null;
  const f = fehler as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  for (const wert of [f.code, f.status, f.response?.status]) {
    if (typeof wert === "number") return wert;
  }
  return null;
}

/**
 * Lohnt sich ein zweiter Versuch?
 *
 * Der Vorgabewert ist bewusst **nein**. Was hier nicht als Aussetzer erkannt
 * wird, faellt sofort durch — lieber ein Lauf, der schnell und deutlich
 * scheitert, als einer, der drei Minuten lang gegen eine Wand laeuft und die
 * Ursache hinter Wiederholungen versteckt.
 */
export function istVoruebergehend(fehler: unknown): boolean {
  if (typeof fehler !== "object" || fehler === null) return false;

  const f = fehler as { code?: unknown; message?: unknown };
  if (typeof f.code === "string" && VORUEBERGEHENDE_CODES.has(f.code)) return true;

  const status = statusVon(fehler);
  if (status !== null) return VORUEBERGEHENDE_STATUS.has(status);

  const text = typeof f.message === "string" ? f.message.toLowerCase() : "";
  // Ein kaputter oder abgelaufener Schluessel sieht in der Auth-Schicht aus wie
  // ein Serverfehler, ist aber keiner. Drei Versuche verschleiern ihn nur.
  if (text.includes("invalid_grant") || text.includes("invalid jwt")) return false;
  return VORUEBERGEHENDE_TEXTE.some((muster) => text.includes(muster));
}

const VERSUCHE = 3;

/** Wachsende Wartezeit mit etwas Streuung, damit nicht alles im Gleichtakt wiederkommt. */
function wartezeit(versuch: number): number {
  return 1000 * 2 ** (versuch - 1) + Math.floor(Math.random() * 400);
}

function schlafe(ms: number): Promise<void> {
  return new Promise((fertig) => setTimeout(fertig, ms));
}

/**
 * Fuehrt `aufgabe` aus und wiederholt sie bei einem Aussetzer.
 *
 * `was` landet im Log und ist keine Zierde: ohne den Namen steht in den Trace-
 * Zeilen nur "Versuch 2 von 3", und beim naechsten Ausfall faengt die Suche
 * wieder bei null an.
 */
export async function mitWiederholung<T>(
  was: string,
  aufgabe: () => Promise<T>,
  optionen: { versuche?: number; wartezeit?: (versuch: number) => number } = {},
): Promise<T> {
  const maximal = optionen.versuche ?? VERSUCHE;
  const warten = optionen.wartezeit ?? wartezeit;

  let letzter: unknown;
  for (let versuch = 1; versuch <= maximal; versuch++) {
    try {
      return await aufgabe();
    } catch (fehler) {
      letzter = fehler;
      if (!istVoruebergehend(fehler) || versuch === maximal) break;
      const ms = warten(versuch);
      const text = fehler instanceof Error ? fehler.message : String(fehler);
      console.log(`${was}: Aussetzer (${text}) — Versuch ${versuch + 1} von ${maximal} in ${ms} ms`);
      await schlafe(ms);
    }
  }
  throw letzter;
}

export const _test = {
  wartezeit,
  /** Ohne echtes Warten, damit die Tests nicht sieben Sekunden schlafen. */
  sofort: { wartezeit: () => 0 },
};
