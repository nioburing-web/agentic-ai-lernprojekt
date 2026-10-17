// ─────────────────────────────────────────────────────────────────────────────
// bike-method-phase: 1  → Phase 1, Training-Wheels. Erst MANUELL test-triggern
//                          (via Trigger.dev test/MCP) und einen echten Failure
//                          bestätigen, BEVOR man sich auf den Cron verlässt.
// three-ms-attribution:    Adapted from The Three Ms of AI™ © 2026 Nate Herk.
// ─────────────────────────────────────────────────────────────────────────────
//
// Agent-Ausfall-Frühwarnung
// Zweck: Erkennt Ausfälle der Live-Agenten (Sofort-Antwort, Neukunden, Reporting,
//        LinkedIn, …) innerhalb von ~1h — statt erst zu merken dass keine Mails
//        kommen. Detection-Problem, nicht Debug-Problem.
//
// KPI: Less cost (Nios Zeit). Metrik: Time-to-Detection von Stunden → Minuten.
// Autonomie: L2 — meldet + ordnet ein, der Fix bleibt bei Nio.

import { schedules, runs, logger } from "@trigger.dev/sdk";
import axios from "axios";

// ─── Config ───────────────────────────────────────────────────────────────────

// Statuses die einen echten Ausfall bedeuten (nicht: CANCELED = Nutzer, INTERRUPTED = dev)
const FEHLER_STATUS = ["FAILED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT"] as const;

// Eigene Task-ID — nie über sich selbst alarmieren
const EIGENE_TASK_ID = "agent-health-monitor";

// Frueher stand hier `type MonitorPayload = { lookbackMin?: number } | undefined`
// und run() nahm sie entgegen. Das war Wunschdenken: `schedules.task` uebergibt
// immer den Zeitplan-Payload, nie ein eigenes Objekt — `payload?.lookbackMin`
// war seit dem ersten Tag garantiert undefined (Typecheck 28.08.2026).
// Danach war das Fenster eine Konstante von 65 Minuten ab "jetzt" und ueberlappte
// sich mit dem naechsten Lauf (Doppelmails). Seit 17.10.2026 kommt es aus genau
// diesem Zeitplan-Payload: lastTimestamp bis timestamp, siehe pruefFenster().

// Was runs.retrieve() im error-Feld liefert (@trigger.dev/core 4.4.4).
// runs.list() liefert dieses Feld NICHT — siehe fehlertextAus().
type RunFehlerDetail = { message?: string; name?: string; stackTrace?: string } | undefined;

const KEIN_FEHLERTEXT = "Kein Fehlertext im Run";

// Erste Zeile im Stacktrace, die auf EIGENEN Code zeigt. Ohne das nennt die
// Alarm-Mail gaxios oder google-auth-library als Fundort — technisch richtig
// und zum Handeln nutzlos.
function ersteCodeStelle(stackTrace?: string): string | null {
  if (!stackTrace) return null;
  const zeilen = stackTrace
    .split(/\r?\n/)
    .map((z) => z.trim())
    .filter((z) => z.startsWith("at "));
  if (zeilen.length === 0) return null;

  // zeilen ist hier garantiert nicht leer, siehe die Pruefung darueber.
  const eigene: string = zeilen.find((z) => !z.includes("node_modules") && z.includes("/src/")) ?? (zeilen[0] as string);

  // "at sicherQueueTab (file:///src/trigger/nacht-recherche.ts:70:20)"
  //   → "sicherQueueTab (nacht-recherche.ts:70)"
  const teile = eigene.match(/^at\s+(.+?)\s+\((.*)\)$/);
  if (!teile) return eigene.replace(/^at\s+/, "").slice(0, 120);

  const ort = (teile[2] as string)
    .replace(/^file:\/\/\//, "")
    .replace(/^.*\//, "")
    .replace(/:(\d+):\d+$/, ":$1");
  return `${teile[1]} (${ort})`;
}

// Baut aus dem error-Objekt eines Runs eine Zeile, die allein zum Einordnen
// reicht — ohne dass man das Dashboard öffnen muss.
//
// Exportiert, damit tests/test_health_monitor.ts sie ohne Netzwerk prüfen kann.
export function fehlertextAus(error: RunFehlerDetail): string {
  const message = error?.message?.trim() ?? "";
  const name = error?.name?.trim() ?? "";

  let basis = message || name;
  if (!basis) return KEIN_FEHLERTEXT;

  // "Error" trägt nichts bei, ein "QuotaError" schon.
  if (name && name !== "Error" && basis !== name && !basis.startsWith(name)) {
    basis = `${name}: ${basis}`;
  }
  basis = basis.replace(/\s+/g, " ").slice(0, 300);

  const stelle = ersteCodeStelle(error?.stackTrace);
  return stelle ? `${basis} | bei ${stelle}` : basis;
}

// ─── Leerlauf: grün gelaufen, nichts getan ────────────────────────────────────
//
// Warum es das gibt (25.08.2026): `morgen-versand` lief um 09:00 durch, meldete
// `completed` nach 1,5 Sekunden und sendete 0 von 0 Mails. Kein Fehler, kein
// Alarm, kein Outreach. `sammleFehler` kann das nicht sehen — ein Lauf, der
// nichts zu tun findet, endet per Definition mit Erfolg.
//
// Dasselbe Muster gab es schon zweimal: Maps-Billing aus (06.07.), Sheets-
// Spalten-Bug (16.07.). Beide Male stand die Zahl im Log, beide Male hat sie
// niemand gelesen. Die Tasks WISSEN, dass sie leerliefen — `nacht-recherche`
// schreibt sogar "WARNUNG: 0 Entwürfe". Nur gab `run()` `undefined` zurück,
// also verliess das Wissen den Lauf nie. Deshalb geben die ueberwachten Tasks
// jetzt ein Ergebnis zurueck, und hier wird es gelesen.
//
// Bewusst NICHT ueberwacht: `nachfass-versand` (0 faellige Leads ist ein
// normaler Tag) und `linkedin-api-posting` (Stub ohne Token, gewollt still).
// Ein Waechter, der an ruhigen Tagen schreit, wird genauso ignoriert wie einer,
// der schweigt.

const UEBERWACHTE_TASKS = ["morgen-versand", "nacht-recherche"] as const;

function zahl(ausgabe: unknown, feld: string): number | null {
  if (typeof ausgabe !== "object" || ausgabe === null) return null;
  const wert = (ausgabe as Record<string, unknown>)[feld];
  return typeof wert === "number" && Number.isFinite(wert) ? wert : null;
}

/**
 * Urteilt ueber die Ausgabe eines erfolgreich beendeten Laufs: hat er
 * tatsaechlich etwas getan? Gibt den Befund zurueck, wenn nicht, sonst `null`.
 *
 * Eine fehlende oder unerwartete Ausgabe wird **gemeldet**, nicht verschluckt.
 * Sonst waere ausgerechnet der Fall unsichtbar, in dem jemand das `return` aus
 * einer Task entfernt — also genau der Fehler, den diese Pruefung abfangen soll.
 *
 * Exportiert, damit tests/test_leerlauf.ts sie ohne Netzwerk pruefen kann.
 */
export function leerlaufBefund(taskId: string, ausgabe: unknown): string | null {
  if (!(UEBERWACHTE_TASKS as readonly string[]).includes(taskId)) return null;

  if (taskId === "morgen-versand") {
    const gefunden = zahl(ausgabe, "gefunden");
    const gesendet = zahl(ausgabe, "gesendet");
    if (gefunden === null || gesendet === null) {
      return "Lauf meldet kein verwertbares Ergebnis (gefunden/gesendet fehlen) — laeuft hier noch eine alte Version?";
    }
    if (gefunden === 0) {
      const wartet = zahl(ausgabe, "wartetAufFreigabe");
      if (wartet !== null && wartet > 0) {
        return `0 freigegebene Entwuerfe, aber ${wartet} warten auf PRUEFEN — Freigabe-Runde faellig, kein Ausfall.`;
      }
      return "0 freigegebene Entwuerfe und nichts auf PRUEFEN — es ging keine Mail raus und es kommt keine nach. Nacht-Recherche und Queue pruefen.";
    }
    if (gesendet === 0) {
      return `${gefunden} Entwuerfe gefunden, aber 0 gesendet — jeder Sendeversuch ist gescheitert (Brevo?).`;
    }
    return null;
  }

  if (taskId === "nacht-recherche") {
    // Ein absichtlich uebersprungener Lauf ist kein Leerlauf. Seit 27.08.2026
    // bremst `nacht-recherche` selbst, wenn zu viele Entwuerfe unbearbeitet auf
    // PRUEFEN liegen, und legt den Grund in `uebersprungen` ab. Ohne diese
    // Unterscheidung meldete der Monitor jede gebremste Nacht als "Pool
    // erschoepft" — also genau dann Alarm, wenn alles richtig laeuft.
    const uebersprungen = (ausgabe as Record<string, unknown> | null)?.["uebersprungen"];
    if (typeof uebersprungen === "string" && uebersprungen.trim() !== "") return null;

    const entwuerfe = zahl(ausgabe, "entwuerfe");
    if (entwuerfe === null) {
      return "Lauf meldet kein verwertbares Ergebnis (entwuerfe fehlt) — laeuft hier noch eine alte Version?";
    }
    if (entwuerfe === 0) {
      return "0 neue Entwuerfe — Pool erschoepft, Maps-Billing aus oder Quality-Gate zu streng.";
    }
    return null;
  }

  return null;
}

/**
 * Unterscheidet die Freigabe-Pause vom echten Leerlauf (Audit AIOS-20261017-01).
 * 28.09.–16.10.2026 kamen acht "Leerlauf"-Alarme, alle acht waren Tage, an denen
 * die Entwuerfe noch auf PRUEFEN lagen. Ein echter Ausfall sah im Postfach genauso
 * aus. "freigabe" nur, wenn morgen-versand 0 gefunden hat UND selbst meldet, dass
 * Entwuerfe warten — fehlt das Feld (alte Version), bleibt es Leerlauf.
 */
export function leerlaufArt(taskId: string, ausgabe: unknown): "freigabe" | "leerlauf" {
  if (taskId !== "morgen-versand") return "leerlauf";
  const wartet = zahl(ausgabe, "wartetAufFreigabe");
  return zahl(ausgabe, "gefunden") === 0 && wartet !== null && wartet > 0 ? "freigabe" : "leerlauf";
}

export type LeerlaufRun = {
  taskId: string;
  runId: string;
  zeit: string;
  befund: string;
  art?: "freigabe" | "leerlauf";
};

/**
 * Pruef-Fenster eines Monitor-Laufs: von der letzten bis zur aktuellen
 * Planzeit. Vorher hiess es "65 Minuten ab jetzt", und ein Lauf, der vor dem
 * naechsten Monitor-Lauf fertig war, lag in zwei Fenstern — Doppelmails am
 * 30.09., 06.10. und 15.10. Mit aneinanderstossenden Fenstern faellt jedes
 * Lauf-Ende in genau eines.
 */
export function pruefFenster(p: { timestamp: Date; lastTimestamp?: Date }): { von: Date; bis: Date } {
  const bis = new Date(p.timestamp);
  const von = p.lastTimestamp ? new Date(p.lastTimestamp) : new Date(bis.getTime() - 60 * 60_000);
  return { von, bis };
}

export function imFenster(fertig: Date | null | undefined, f: { von: Date; bis: Date }): boolean {
  if (!fertig) return false;
  const t = new Date(fertig).getTime();
  return t >= f.von.getTime() && t < f.bis.getTime();
}

// runs.list filtert nach Startzeit, das Fenster nach Endzeit. Ein langer Lauf
// (nacht-recherche bis 11 Min., maxDuration bis 10 Min.) startet vor dem
// Fenster und endet darin — deshalb so weit zurueck listen.
const LISTE_VORLAUF_MIN = 120;

export type FehlerRun = {
  taskId: string;
  status: string;
  runId: string;
  zeit: string;
  fehler: string;
};

// ─── Schritt 1: Fehlgeschlagene Runs sammeln ──────────────────────────────────

async function sammleFehler(fenster: { von: Date; bis: Date }): Promise<FehlerRun[]> {
  const seit = new Date(fenster.von.getTime() - LISTE_VORLAUF_MIN * 60_000);
  const treffer: FehlerRun[] = [];

  for await (const run of runs.list({
    status: [...FEHLER_STATUS],
    from: seit,
    limit: 50,
  })) {
    if (run.taskIdentifier === EIGENE_TASK_ID) continue; // Selbstreferenz ausschließen
    if (!imFenster(run.finishedAt ?? run.updatedAt, fenster)) continue; // schon gemeldet oder naechstes Fenster

    const zeit = (run.finishedAt ?? run.createdAt ?? new Date()).toLocaleString("de-DE", {
      timeZone: "Europe/Berlin",
    });
    // runs.list() liefert kein error-Feld — die Details muss man nachladen.
    // Fail-open: schlägt das Nachladen fehl, geht der Alarm trotzdem raus.
    let detail: RunFehlerDetail;
    try {
      detail = (await runs.retrieve(run.id)).error;
    } catch (e) {
      logger.warn("Fehlerdetails nicht abrufbar — Alarm geht trotzdem raus", {
        runId: run.id,
        grund: String(e).slice(0, 200),
      });
    }
    const fehler = fehlertextAus(detail);

    treffer.push({
      taskId: run.taskIdentifier,
      status: run.status,
      runId: run.id,
      zeit,
      fehler,
    });
  }

  logger.log("Schritt 1 abgeschlossen", { gefundeneFehler: treffer.length, seit: seit.toISOString() });
  return treffer;
}

// ─── Schritt 1b: Leerlauf sammeln ─────────────────────────────────────────────

async function sammleLeerlauf(fenster: { von: Date; bis: Date }): Promise<LeerlaufRun[]> {
  const seit = new Date(fenster.von.getTime() - LISTE_VORLAUF_MIN * 60_000);
  const treffer: LeerlaufRun[] = [];

  for await (const run of runs.list({ status: ["COMPLETED"], from: seit, limit: 50 })) {
    if (!(UEBERWACHTE_TASKS as readonly string[]).includes(run.taskIdentifier)) continue;
    if (!imFenster(run.finishedAt, fenster)) continue; // schon gemeldet oder naechstes Fenster

    let ausgabe: unknown;
    try {
      ausgabe = (await runs.retrieve(run.id)).output;
    } catch (e) {
      // Ohne Ausgabe gibt es kein Urteil. Melden statt raten — sonst ist die
      // Pruefung genau dann still, wenn die API klemmt.
      logger.warn("Ausgabe nicht abrufbar — Lauf nicht beurteilt", {
        runId: run.id,
        taskId: run.taskIdentifier,
        grund: String(e).slice(0, 200),
      });
      continue;
    }

    const befund = leerlaufBefund(run.taskIdentifier, ausgabe);
    if (!befund) continue;

    treffer.push({
      taskId: run.taskIdentifier,
      runId: run.id,
      zeit: (run.finishedAt ?? run.createdAt ?? new Date()).toLocaleString("de-DE", {
        timeZone: "Europe/Berlin",
      }),
      befund,
      art: leerlaufArt(run.taskIdentifier, ausgabe),
    });
  }

  logger.log("Schritt 1b abgeschlossen", { gefundenerLeerlauf: treffer.length });
  return treffer;
}

// ─── Schritt 2: Alarm-Mail bauen ──────────────────────────────────────────────

// Exportiert, damit tests/test_leerlauf.ts den fertigen Mail-Text pruefen kann.
// Der Text IST das Produkt dieser Task — ein gruener Unit-Test ueber der
// Urteilsfunktion belegt nichts ueber die Mail, die am Ende ankommt.
export function baueAlarm(
  fehler: FehlerRun[],
  leerlauf: LeerlaufRun[],
  lookbackMin: number
): { betreff: string; text: string } {
  // Der Betreff muss allein schon sagen, was los ist — die Mail wird sonst
  // aufgeschoben. Belegt: drei Alarm-Mails in vierzehn Tagen blieben ungelesen.
  // Reine Freigabe-Pause bekommt einen eigenen Betreff: Nio soll am Postfach
  // sehen, ob er handeln muss oder ob etwas kaputt ist. Sobald ein Fehler oder
  // ein echter Leerlauf dabei ist, gewinnt der Alarm.
  const pausen = leerlauf.filter((l) => l.art === "freigabe");
  const echterLeerlauf = leerlauf.filter((l) => l.art !== "freigabe");
  if (fehler.length === 0 && echterLeerlauf.length === 0 && pausen.length > 0) {
    const bloecke = pausen
      .map((l) => `▸ ${l.taskId}\n  Zeit:  ${l.zeit}\n  Run:   ${l.runId}\n  Stand: ${l.befund}`)
      .join("\n\n");
    return {
      betreff: "📝 Freigabe fällig: Versand pausiert, Entwürfe warten auf PRUEFEN",
      text:
        `=== FREIGABE FAELLIG ===\n\n` +
        `Kein Ausfall. Der Versand ist gelaufen, aber nichts war freigegeben:\n\n${bloecke}\n\n` +
        `Naechster Schritt: Freigabe-Runde (tools/freigabe-runde.ts), dann geht es am naechsten Versandtag raus.`,
    };
  }

  const teile: string[] = [];
  if (fehler.length > 0) teile.push(`${fehler.length} Task${fehler.length === 1 ? "" : "s"} down`);
  if (echterLeerlauf.length > 0) teile.push(`${echterLeerlauf.length}x Leerlauf`);
  if (pausen.length > 0) teile.push(`${pausen.length}x Freigabe fällig`);
  const betreff = `⚠️ Agent-Alarm: ${teile.join(", ")}`;

  const abschnitte: string[] = [];

  if (fehler.length > 0) {
    const bloecke = fehler
      .map(
        (f) =>
          `▸ ${f.taskId}  [${f.status}]\n` +
          `  Zeit:  ${f.zeit}\n` +
          `  Run:   ${f.runId}\n` +
          `  Fehler: ${f.fehler}`
      )
      .join("\n\n");
    abschnitte.push(
      `${fehler.length} fehlgeschlagene${fehler.length === 1 ? "r Run" : " Runs"} in den letzten ${lookbackMin} Minuten:\n\n${bloecke}`
    );
  }

  if (leerlauf.length > 0) {
    const bloecke = leerlauf
      .map(
        (l) =>
          `▸ ${l.taskId}  [gruen gelaufen, nichts getan]\n` +
          `  Zeit:  ${l.zeit}\n` +
          `  Run:   ${l.runId}\n` +
          `  Befund: ${l.befund}`
      )
      .join("\n\n");
    abschnitte.push(
      `${leerlauf.length} Lauf${leerlauf.length === 1 ? "" : "e"} mit Erfolg beendet, aber ohne Wirkung:\n\n${bloecke}\n\n` +
        `Diese Klasse faellt NICHT als Fehler auf. Genau so blieben der Maps-Billing-\n` +
        `Ausfall (06.07.) und der Sheets-Spalten-Bug (16.07.) tagelang unbemerkt.`
    );
  }

  const text =
    `=== AGENT-ALARM ===\n\n` +
    `${abschnitte.join("\n\n---\n\n")}\n\n` +
    `Im Trigger.dev-Dashboard oeffnen → Run-ID suchen → Logs pruefen.`;

  return { betreff, text };
}

// ─── Schritt 3: Senden (Brevo, wie reporting.ts) ──────────────────────────────

async function sendeAlarm(betreff: string, text: string): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) { logger.error("BREVO_API_KEY nicht gesetzt — Alarm nicht gesendet"); return false; }

  const absenderName = process.env.ABSENDER_NAME ?? "NIO Automation";
  const absenderEmail = process.env.ABSENDER_EMAIL ?? "anfragen@nio-automation.de";
  const empfaenger = process.env.ALERT_EMAIL ?? "nioburing@gmail.com";

  const response = await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: { name: absenderName, email: absenderEmail },
      to: [{ email: empfaenger }],
      subject: betreff,
      textContent: text,
    },
    { headers: { "api-key": apiKey, "Content-Type": "application/json" } }
  );

  const erfolg = response.status === 201;
  logger.log("Schritt 3 abgeschlossen", { gesendet: erfolg, empfaenger });
  return erfolg;
}

// ─── Trigger.dev Cron Task ────────────────────────────────────────────────────

export const agentHealthMonitor = schedules.task({
  id: EIGENE_TASK_ID,
  cron: {
    pattern: "0 * * * *", // stündlich
    timezone: "Europe/Berlin",
  },
  maxDuration: 60,
  run: async (payload) => {
    const fenster = pruefFenster(payload);
    const lookbackMin = Math.round((fenster.bis.getTime() - fenster.von.getTime()) / 60_000);
    logger.log("Agent-Health-Monitor gestartet", {
      von: fenster.von.toISOString(),
      bis: fenster.bis.toISOString(),
    });

    const fehler = await sammleFehler(fenster);
    const leerlauf = await sammleLeerlauf(fenster);

    // Decision Point: nichts gefunden → still bleiben, kein Lärm
    if (fehler.length === 0 && leerlauf.length === 0) {
      logger.log("Alles grün — kein Alarm");
      return { status: "ok", fehler: 0, leerlauf: 0 };
    }

    const { betreff, text } = baueAlarm(fehler, leerlauf, lookbackMin);
    await sendeAlarm(betreff, text);

    logger.log("Agent-Health-Monitor abgeschlossen", {
      gemeldeteFehler: fehler.length,
      gemeldeterLeerlauf: leerlauf.length,
    });
    return {
      status: "alert",
      fehler: fehler.length,
      leerlauf: leerlauf.length,
      tasks: [...fehler.map((f) => f.taskId), ...leerlauf.map((l) => l.taskId)],
    };
  },
});
