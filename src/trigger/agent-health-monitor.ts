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

// Lookback etwas größer als das Cron-Intervall (1h), damit kein Failure durchrutscht.
// Über den Payload überschreibbar (z.B. für manuelle Tests gegen historische Failures).
const LOOKBACK_MIN_DEFAULT = 65;

type MonitorPayload = { lookbackMin?: number } | undefined;

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

  const eigene = zeilen.find((z) => !z.includes("node_modules") && z.includes("/src/")) ?? zeilen[0];

  // "at sicherQueueTab (file:///src/trigger/nacht-recherche.ts:70:20)"
  //   → "sicherQueueTab (nacht-recherche.ts:70)"
  const teile = eigene.match(/^at\s+(.+?)\s+\((.*)\)$/);
  if (!teile) return eigene.replace(/^at\s+/, "").slice(0, 120);

  const ort = teile[2]
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
      return "0 freigegebene Entwuerfe in der Queue — es ging keine einzige Mail raus. Queue auf DRAFT pruefen.";
    }
    if (gesendet === 0) {
      return `${gefunden} Entwuerfe gefunden, aber 0 gesendet — jeder Sendeversuch ist gescheitert (Brevo?).`;
    }
    return null;
  }

  if (taskId === "nacht-recherche") {
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

export type LeerlaufRun = {
  taskId: string;
  runId: string;
  zeit: string;
  befund: string;
};

export type FehlerRun = {
  taskId: string;
  status: string;
  runId: string;
  zeit: string;
  fehler: string;
};

// ─── Schritt 1: Fehlgeschlagene Runs sammeln ──────────────────────────────────

async function sammleFehler(lookbackMin: number): Promise<FehlerRun[]> {
  const seit = new Date(Date.now() - lookbackMin * 60_000);
  const treffer: FehlerRun[] = [];

  for await (const run of runs.list({
    status: [...FEHLER_STATUS],
    from: seit,
    limit: 50,
  })) {
    if (run.taskIdentifier === EIGENE_TASK_ID) continue; // Selbstreferenz ausschließen

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

async function sammleLeerlauf(lookbackMin: number): Promise<LeerlaufRun[]> {
  const seit = new Date(Date.now() - lookbackMin * 60_000);
  const treffer: LeerlaufRun[] = [];

  for await (const run of runs.list({ status: ["COMPLETED"], from: seit, limit: 50 })) {
    if (!(UEBERWACHTE_TASKS as readonly string[]).includes(run.taskIdentifier)) continue;

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
  const teile: string[] = [];
  if (fehler.length > 0) teile.push(`${fehler.length} Task${fehler.length === 1 ? "" : "s"} down`);
  if (leerlauf.length > 0) teile.push(`${leerlauf.length}x Leerlauf`);
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
  run: async (payload: MonitorPayload) => {
    const lookbackMin = payload?.lookbackMin ?? LOOKBACK_MIN_DEFAULT;
    logger.log("Agent-Health-Monitor gestartet", { lookbackMin });

    const fehler = await sammleFehler(lookbackMin);
    const leerlauf = await sammleLeerlauf(lookbackMin);

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
