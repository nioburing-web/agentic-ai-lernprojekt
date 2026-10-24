/**
 * KI-Aufrufe mit OpenRouter als Ausweichroute.
 *
 * Warum es das gibt (24.10.2026): Alle produktiven Agenten hängen an genau
 * einem Schlüssel, OPENAI_API_KEY. Ist er gesperrt, rotiert oder das Guthaben
 * leer, stehen in derselben Nacht Recherche, Antworten auf Leads und Nachfass
 * still — der Health-Monitor meldet das, verhindert es aber nicht. Am 27.09.
 * hat genau so ein leeres Guthaben (damals Anthropic) beide Demo-Chats stumm
 * gemacht.
 *
 * Der Kern ist nicht, dass umgeschaltet wird. Der Kern ist, dass nur bei
 * Ausfällen umgeschaltet wird: Ein 400 heißt "die Anfrage ist kaputt", und die
 * wird über OpenRouter nicht heiler, sie wird nur doppelt bezahlt und der Bug
 * versteckt. Und dass dasselbe Modell antwortet — die Prüfer und Regeln sind auf
 * genau diese Modelle eingestellt.
 *
 * OpenRouter läuft nur über OpenAI selbst (`provider.only`), ohne Rückfall auf
 * Azure oder Dritte. Bewusst ohne `zdr`: OpenRouter sperrt mit ZDR genau die
 * First-Party-Endpunkte von OpenAI (Entscheidung 24.10., Spec
 * AIS-OS/docs/superpowers/specs/2026-10-24-openrouter-ausweichroute-design.md).
 *
 * Der Zustand gilt pro Lauf. Trigger.dev kann einen Prozess für den nächsten
 * Lauf wiederverwenden — deshalb ruft jeder Task am Anfang von run()
 * setzeAusweichZurueck(), sonst schickt der Vorlauf einen gesunden Lauf direkt
 * zu OpenRouter.
 */

import OpenAI from "openai";
import { logger } from "@trigger.dev/sdk";
import { statusVon } from "./wiederholung";

export type KiParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
export type KiKlient = {
  chat: { completions: { create(p: any): Promise<OpenAI.Chat.Completions.ChatCompletion> } };
};
export type AusweichStand = { umgeschaltet: number; gruende: string[]; beideTot: number };

const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const PROVIDER = { only: ["openai"], allow_fallbacks: false };

/** Netzwerk-Kennzeichen eines Ausfalls. */
const AUSFALL_CODES = new Set([
  "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "EPIPE", "ENOTFOUND",
]);
/** Fehlerklassen des openai-SDK, die keinen Status tragen. */
const AUSFALL_NAMEN = new Set(["APIConnectionError", "APIConnectionTimeoutError"]);

let umgeschaltet = 0;
let gruende: string[] = [];
let beideTot = 0;
let klebt = false;

/**
 * Zeigt der Fehler auf einen kaputten Weg statt auf eine kaputte Anfrage?
 * 401/403: Schlüssel. 429: Guthaben oder Limit. 5xx, Timeout, Netzwerk: Anbieter.
 * Anders als wiederholung.ts zählen 401/403 hier ausdrücklich dazu — wiederholen
 * hilft dort nicht, ein anderer Weg schon.
 */
export function istAusfall(fehler: unknown): boolean {
  const status = statusVon(fehler);
  if (status !== null) return status === 401 || status === 403 || status === 429 || status >= 500;
  if (typeof fehler !== "object" || fehler === null) return false;
  const f = fehler as { code?: unknown; name?: unknown; message?: unknown };
  if (typeof f.code === "string" && AUSFALL_CODES.has(f.code)) return true;
  if (typeof f.name === "string" && AUSFALL_NAMEN.has(f.name)) return true;
  return typeof f.message === "string" && /timed? ?out/i.test(f.message);
}

export function ausweichGrund(fehler: unknown): string {
  const status = statusVon(fehler);
  if (status !== null) return String(status);
  const f = (fehler ?? {}) as { code?: unknown; message?: unknown };
  if (typeof f.message === "string" && /timed? ?out/i.test(f.message)) return "timeout";
  if (f.code === "ETIMEDOUT") return "timeout";
  return "netzwerk";
}

export function fuerOpenRouter(params: KiParams): KiParams & { provider: typeof PROVIDER } {
  return { ...params, model: `openai/${params.model}`, provider: { ...PROVIDER, only: [...PROVIDER.only] } };
}

function standardDirekt(timeoutMs: number): KiKlient {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: timeoutMs });
}

function standardAusweich(timeoutMs: number): KiKlient | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, baseURL: OPENROUTER_URL, timeout: timeoutMs });
}

/**
 * Ein Chat-Aufruf: erst OpenAI direkt, bei Ausfall dieselbe Anfrage über
 * OpenRouter. Scheitern beide, fliegt der ursprüngliche OpenAI-Fehler — die
 * catch-Blöcke der Tasks verhalten sich dadurch genau wie vor der Ausweichroute.
 * `ausweich: null` heißt ausdrücklich "keine Ausweiche".
 */
export async function kiChat(
  params: KiParams,
  opt: { timeoutMs?: number; direkt?: KiKlient; ausweich?: KiKlient | null } = {},
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const timeoutMs = opt.timeoutMs ?? 30000;
  const ausweich = opt.ausweich === undefined ? standardAusweich(timeoutMs) : opt.ausweich;

  if (klebt && ausweich) {
    try {
      const antwort = await ausweich.chat.completions.create(fuerOpenRouter(params));
      umgeschaltet++;
      return antwort;
    } catch (fehler) {
      beideTot++;
      logger.error("Ausweichroute ausgefallen, Direktweg war schon tot", { grund: ausweichGrund(fehler), modell: params.model });
      throw fehler;
    }
  }

  const direkt = opt.direkt ?? standardDirekt(timeoutMs);
  try {
    return await direkt.chat.completions.create(params);
  } catch (fehler) {
    if (!ausweich || !istAusfall(fehler)) throw fehler;
    const grund = ausweichGrund(fehler);
    logger.warn("Ausweichroute aktiv", { grund, modell: params.model });
    try {
      const antwort = await ausweich.chat.completions.create(fuerOpenRouter(params));
      umgeschaltet++;
      gruende.push(grund);
      klebt = true;
      return antwort;
    } catch (zweiter) {
      beideTot++;
      logger.error("OpenAI und Ausweichroute ausgefallen", { grund, ausweichGrund: ausweichGrund(zweiter), modell: params.model });
      throw fehler;
    }
  }
}

export function ausweichStand(): AusweichStand {
  return { umgeschaltet, gruende: [...gruende], beideTot };
}

export function setzeAusweichZurueck(): void {
  umgeschaltet = 0;
  gruende = [];
  beideTot = 0;
  klebt = false;
}
