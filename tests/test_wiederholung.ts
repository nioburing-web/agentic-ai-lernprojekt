// Tests für die Wiederholung bei voruebergehenden Google-Fehlern.
// Ausfuehren: npx tsx tests/test_wiederholung.ts
//
// Warum es das Modul gibt: `nacht-recherche` ist am 17.08.2026 in
// `sicherQueueTab` gescheitert, mit "The service is currently unavailable."
// aus der Google-Auth. Ein einziger Aussetzer von wenigen Sekunden hat eine
// komplette Akquise-Nacht gekostet — 30 Entwuerfe, die es nie gab, und einen
// Versandtag, der auf 0/0 stand.
//
// Der Punkt dieser Tests ist nicht, dass wiederholt wird. Der Punkt ist, dass
// NICHT wiederholt wird, wo es nichts bringt: ein 403 wird durch drei Versuche
// nicht besser, er verdreifacht nur die Zeit bis zur Fehlermeldung.

import { istVoruebergehend, mitWiederholung, _test } from "../src/trigger/wiederholung";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}
function gleich(ist: unknown, soll: unknown, nachricht: string): void {
  if (ist === soll) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}\n        ist : ${String(ist)}\n        soll: ${String(soll)}`); fehlgeschlagen++; }
}

// Fehler bauen, wie die googleapis-Bibliothek sie wirft.
function googleFehler(code: number, nachricht = "Fehler"): Error & { code: number } {
  return Object.assign(new Error(nachricht), { code });
}
function netzFehler(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

// ─── istVoruebergehend: was wiederholt werden DARF ───────────────────────────

check(istVoruebergehend(new Error("The service is currently unavailable.")),
  "echter Fund 17.08.: 'The service is currently unavailable.' ist voruebergehend");
check(istVoruebergehend(googleFehler(503)), "503 ist voruebergehend");
check(istVoruebergehend(googleFehler(500)), "500 ist voruebergehend");
check(istVoruebergehend(googleFehler(502)), "502 ist voruebergehend");
check(istVoruebergehend(googleFehler(504)), "504 ist voruebergehend");
check(istVoruebergehend(googleFehler(429)), "429 (Rate Limit) ist voruebergehend");
check(istVoruebergehend(netzFehler("ECONNRESET")), "ECONNRESET ist voruebergehend");
check(istVoruebergehend(netzFehler("ETIMEDOUT")), "ETIMEDOUT ist voruebergehend");
check(istVoruebergehend(netzFehler("EAI_AGAIN")), "EAI_AGAIN (DNS) ist voruebergehend");
check(istVoruebergehend(new Error("socket hang up")), "'socket hang up' ist voruebergehend");
check(istVoruebergehend({ response: { status: 503 } }),
  "Status auch aus response.status gelesen, nicht nur aus code");

// ─── istVoruebergehend: was NICHT wiederholt werden darf ─────────────────────

check(!istVoruebergehend(googleFehler(403, "The caller does not have permission")),
  "403 ist dauerhaft — drei Versuche machen keine Rechte");
check(!istVoruebergehend(googleFehler(404, "Requested entity was not found")),
  "404 ist dauerhaft");
check(!istVoruebergehend(googleFehler(400, "Unable to parse range")),
  "400 ist dauerhaft — ein kaputter Bereich bleibt kaputt");
check(!istVoruebergehend(new Error("invalid_grant: Invalid JWT Signature")),
  "invalid_grant ist ein kaputter Schluessel, kein Aussetzer");
check(!istVoruebergehend(googleFehler(401)), "401 ist dauerhaft");
check(!istVoruebergehend(new Error("GOOGLE_SHEET_ID fehlt")),
  "ein gewoehnlicher Fehler ohne Kennzeichen gilt als dauerhaft");
check(!istVoruebergehend(null), "null wirft nicht und gilt als dauerhaft");

// ─── mitWiederholung ─────────────────────────────────────────────────────────

async function laeufe(): Promise<void> {
  {
    let versuche = 0;
    const ergebnis = await mitWiederholung("Testfall", async () => { versuche++; return "fertig"; }, _test.sofort);
    gleich(ergebnis, "fertig", "Erfolg wird durchgereicht");
    gleich(versuche, 1, "Erfolg beim ersten Versuch wiederholt nicht");
  }

  {
    let versuche = 0;
    const ergebnis = await mitWiederholung("Testfall", async () => {
      versuche++;
      if (versuche < 3) throw new Error("The service is currently unavailable.");
      return "endlich";
    }, _test.sofort);
    gleich(ergebnis, "endlich", "nach zwei Aussetzern kommt das echte Ergebnis");
    gleich(versuche, 3, "genau so oft versucht, wie noetig war");
  }

  {
    let versuche = 0;
    let gefangen = "";
    try {
      await mitWiederholung("Testfall", async () => {
        versuche++;
        throw googleFehler(503, "dauerhaft kaputt");
      }, _test.sofort);
    } catch (fehler) { gefangen = (fehler as Error).message; }
    gleich(versuche, 3, "gibt nach drei Versuchen auf statt ewig zu laufen");
    gleich(gefangen, "dauerhaft kaputt", "der letzte echte Fehler kommt durch, nicht ein Ersatztext");
  }

  {
    let versuche = 0;
    let gefangen = "";
    try {
      await mitWiederholung("Testfall", async () => {
        versuche++;
        throw googleFehler(403, "The caller does not have permission");
      }, _test.sofort);
    } catch (fehler) { gefangen = (fehler as Error).message; }
    gleich(versuche, 1, "dauerhafter Fehler wird SOFORT durchgereicht, kein zweiter Versuch");
    gleich(gefangen, "The caller does not have permission", "und zwar unveraendert");
  }

  {
    // Die Wartezeit muss wachsen. Dreimal sofort hintereinander gegen einen
    // ueberlasteten Dienst zu laufen ist keine Wiederholung, das ist Nachtreten.
    const wartezeiten = [1, 2, 3].map((v) => _test.wartezeit(v));
    check(wartezeiten[0]! < wartezeiten[1]! && wartezeiten[1]! < wartezeiten[2]!,
      "die Wartezeit waechst von Versuch zu Versuch");
    check(wartezeiten[0]! >= 500, "der erste Versuch wartet mindestens eine halbe Sekunde");
  }
}

laeufe().then(() => {
  console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
  process.exit(fehlgeschlagen > 0 ? 1 : 0);
});
