/**
 * Trockenlauf der Posteingang-Auswahl. Aendert nichts — kein \Seen, kein Sheet.
 *
 * Warum es das gibt (04.09.2026): Der Reply-Agent holte die 50 *aeltesten*
 * ungelesenen Mails aus einem Posteingang mit 580 ungelesenen und liess alles
 * ungelesen liegen, was er keinem Lead zuordnen konnte. Damit las er jeden
 * Werktag dieselben 50 alten Newsletter, waehrend echte Lead-Antworten nie
 * geholt wurden. Bevor die neue Auswahl scharf geschaltet wird, muss sie an
 * echten Zahlen belegt sein — nicht an einem Unit-Test mit erfundenen Adressen.
 *
 * Aufruf: npx tsx tools/dryrun-posteingang.ts
 */

import { ImapFlow } from "imapflow";
import { readFileSync } from "node:fs";
import {
  ladeOutreachQueue,
  waehlePosteingang,
  istMassenAbsender,
  extrahiereEmailAdresse,
  type PosteingangKandidat,
} from "../src/trigger/reply-classifier";

function ladeEnv(): void {
  if (process.env.GMAIL_USER && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return;
  const roh = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const zeile of roh.split(/\r?\n/)) {
    const t = zeile.match(/^([A-Z0-9_]+)=(.*)$/);
    if (t) process.env[t[1] as string] ??= t[2] as string;
  }
}

async function main(): Promise<void> {
  ladeEnv();

  const { rows } = await ladeOutreachQueue();
  const kontakte = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const k = (rows[i]?.[3] ?? "").toLowerCase().trim();
    if (k) kontakte.add(k);
  }
  console.log(`Queue: ${kontakte.size} eindeutige Kontaktadressen\n`);

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER as string,
      pass: process.env.GMAIL_APP_PASSWORD as string,
    },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  const kandidaten: PosteingangKandidat[] = [];
  try {
    const uids = await client.search({ seen: false }, { uid: true });
    if (uids === false) throw new Error("IMAP-Suche fehlgeschlagen");
    console.log(`Ungelesen gesamt: ${uids.length}`);

    // Nur Umschlaege, kein `source` — das ist der Grund, warum wir uns alle
    // ansehen koennen statt nur 50.
    for await (const m of client.fetch(uids, { envelope: true }, { uid: true })) {
      const f = m.envelope?.from?.[0];
      const roh = f ? `${f.name ?? ""} <${f.address ?? ""}>`.trim() : "";
      kandidaten.push({ uid: m.uid, absender: extrahiereEmailAdresse(roh) });
    }
  } finally {
    lock.release();
    await client.logout();
  }

  const a = waehlePosteingang(kandidaten, (x) => kontakte.has(x), 50);

  console.log(`Umschlaege gelesen: ${kandidaten.length}\n`);
  console.log("AUFTEILUNG");
  console.log(`  Lead-Antworten:        ${a.leadsGesamt}  (davon verarbeitet: ${a.zuLesen.length})`);
  console.log(`  Massenpost → \\Seen:    ${a.massenpost.length}`);
  console.log(`  bleibt ungelesen:      ${a.unberuehrt.length}`);

  const zaehle = (uids: number[]) => {
    const m = new Map<string, number>();
    const nach = new Map<number, string>(kandidaten.map((k) => [k.uid, k.absender]));
    for (const u of uids) {
      const abs = nach.get(u) ?? "?";
      m.set(abs, (m.get(abs) ?? 0) + 1);
    }
    return [...m].sort((x, y) => y[1] - x[1]);
  };

  const leadUids = kandidaten.filter((k) => kontakte.has(k.absender)).map((k) => k.uid);
  console.log("\nLEAD-ANTWORTEN (alle, auch die ueber dem Deckel)");
  for (const [abs, n] of zaehle(leadUids)) console.log(`  ${n}x  ${abs}`);
  if (leadUids.length === 0) console.log("  (keine)");

  console.log("\nBLEIBT UNGELESEN — Top 15 Absender");
  console.log("  Hier gehoert hingesehen: was hier oft auftaucht und trotzdem");
  console.log("  Massenpost ist, gehoert in MASSEN_LOKALTEILE ergaenzt.");
  for (const [abs, n] of zaehle(a.unberuehrt).slice(0, 15)) {
    console.log(`  ${String(n).padStart(3)}x  ${abs}`);
  }

  console.log("\nGegenprobe: keiner der \\Seen-Kandidaten ist ein Lead —",
    a.massenpost.every((u) => {
      const abs = kandidaten.find((k) => k.uid === u)?.absender ?? "";
      return !kontakte.has(abs) && istMassenAbsender(abs);
    }) ? "ok" : "VERLETZT");

  console.log("\nTrockenlauf. Nichts geaendert, nichts als gelesen markiert.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
