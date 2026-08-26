// ─────────────────────────────────────────────────────────────────────────────
// bike-method-phase: 1  → Erst manuell test-triggern und einen echten Lauf
//                          bestätigen, bevor man sich auf den Cron verlässt.
// ─────────────────────────────────────────────────────────────────────────────
//
// Täglicher Aufräum-Lauf für die body-&-soul-Website
//
// WARUM DIESE TASK IN DIESEM REPO LIEGT UND NICHT BEI DER WEBSITE:
// Die Website hatte den Lauf als Netlify Scheduled Function. Netlify hat den
// Zeitplan seit dem 17.08.2026 sauber registriert und die Funktion in sieben
// Tagen KEIN EINZIGES MAL aufgerufen (gemessen am 26.08.2026: Logabfrage leer,
// während dieselbe Abfrage für `termine` Aufrufe lieferte; ein Eintrag mit
// Eingang vor 200 Tagen überlebte fünf Auslösezeitpunkte bei Testzeitplan
// `*/5`). In den Netlify-Foren stehen 2026 mehrere Fälle mit demselben Bild.
//
// § 10 Abs. 3 des AVV mit dem Studio sagt tägliche automatische Löschung zu.
// Eine Vertragszusage darf nicht an einem Scheduler hängen, der still nichts
// tut. Trigger.dev läuft hier seit Monaten zuverlässig und wird vom
// agent-health-monitor überwacht — ein ausbleibender Lauf fällt hier auf, ein
// ausbleibender Netlify-Lauf fiel nirgends auf. Genau das war das Problem.
//
// Autonomie: L1 — löscht nach fester Frist, trifft keine Entscheidung.

import { schedules, logger } from "@trigger.dev/sdk";

const URL = "https://vorschau-5a1030.netlify.app/.netlify/functions/aufraeumen";

// Zwei Geheimnisse, absichtlich. ZUGANG_SCHLUESSEL ist der Türsteher vor der
// ganzen Demo (ohne ihn liefert die Edge Function 404, auch für uns).
// AUFRAEUM_SCHLUESSEL schützt speziell diesen Endpunkt, damit nicht jeder mit
// Demo-Zugang Kundendaten löschen kann.
//
// ⚠️ Wird ZUGANG_SCHLUESSEL auf der Website rotiert, schlägt diese Task fehl.
// Das ist gewollt: ein lautes Fehlschlagen ist besser als eine stille
// Vertragsverletzung. Der Health-Monitor meldet es.

type Ergebnis = { entfernt: number; behalten: number };

export const bodyAndSoulAufraeumen = schedules.task({
  id: "body-and-soul-aufraeumen",
  cron: {
    pattern: "30 3 * * *", // täglich 03:30, außerhalb jeder Betriebszeit
    timezone: "Europe/Berlin",
  },
  maxDuration: 120,
  run: async (): Promise<Ergebnis & { status: number }> => {
    const zugang = process.env.BODY_SOUL_ZUGANG_SCHLUESSEL;
    const geheim = process.env.BODY_SOUL_AUFRAEUM_SCHLUESSEL;

    // Fehlende Variablen sind ein Fehler, kein stiller Nulllauf. Ein Lauf, der
    // "ging durch" meldet ohne etwas getan zu haben, ist derselbe blinde Fleck,
    // der diese Task überhaupt nötig gemacht hat.
    if (!zugang || !geheim) {
      throw new Error(
        "BODY_SOUL_ZUGANG_SCHLUESSEL oder BODY_SOUL_AUFRAEUM_SCHLUESSEL fehlt in den Umgebungsvariablen"
      );
    }

    const antwort = await fetch(URL, {
      headers: {
        Cookie: `zugang=${zugang}`,
        "x-aufraeum-schluessel": geheim,
      },
    });

    // 404 heißt hier fast immer: einer der beiden Schlüssel stimmt nicht mehr.
    // Der Endpunkt antwortet absichtlich mit 404 statt 401, damit er sich
    // Fremden gegenüber nicht zu erkennen gibt.
    if (!antwort.ok) {
      throw new Error(
        `Aufraeum-Lauf abgelehnt: HTTP ${antwort.status}. ` +
          "Verdacht: ZUGANG_SCHLUESSEL auf der Website rotiert, oder AUFRAEUM_SCHLUESSEL stimmt nicht."
      );
    }

    const ergebnis = (await antwort.json()) as Ergebnis;
    logger.log("body & soul aufgeraeumt", ergebnis);

    // Ergebnis zurückgeben, damit der agent-health-monitor Leerlauf von echter
    // Arbeit unterscheiden kann (er liest runs.retrieve().output).
    return { ...ergebnis, status: antwort.status };
  },
});
