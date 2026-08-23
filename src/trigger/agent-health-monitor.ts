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

type FehlerRun = {
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

// ─── Schritt 2: Alarm-Mail bauen ──────────────────────────────────────────────

function baueAlarm(fehler: FehlerRun[], lookbackMin: number): { betreff: string; text: string } {
  const betreff = `⚠️ Agent-Ausfall: ${fehler.length} Task${fehler.length === 1 ? "" : "s"} down`;

  const bloecke = fehler
    .map(
      (f) =>
        `▸ ${f.taskId}  [${f.status}]\n` +
        `  Zeit:  ${f.zeit}\n` +
        `  Run:   ${f.runId}\n` +
        `  Fehler: ${f.fehler}`
    )
    .join("\n\n");

  const text =
    `=== AGENT-AUSFALL-FRÜHWARNUNG ===\n\n` +
    `${fehler.length} fehlgeschlagene${fehler.length === 1 ? "r Run" : " Runs"} in den letzten ${lookbackMin} Minuten:\n\n` +
    `${bloecke}\n\n` +
    `Im Trigger.dev-Dashboard öffnen → Run-ID suchen → Logs prüfen.`;

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

    // Decision Point: keine Fehler → still bleiben, kein Lärm
    if (fehler.length === 0) {
      logger.log("Alles grün — kein Alarm");
      return { status: "ok", fehler: 0 };
    }

    const { betreff, text } = baueAlarm(fehler, lookbackMin);
    await sendeAlarm(betreff, text);

    logger.log("Agent-Health-Monitor abgeschlossen", { gemeldet: fehler.length });
    return { status: "alert", fehler: fehler.length, tasks: fehler.map((f) => f.taskId) };
  },
});
