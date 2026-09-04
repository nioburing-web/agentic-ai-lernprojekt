// Read-Only Dry-Run des Reply-Agents gegen das ECHTE Postfach.
// Liest ungelesene Mails (BODY.PEEK → markiert NICHTS), lässt den Agenten
// entscheiden und zeigt nur, was er TUN WÜRDE. Kein Senden, kein Entwurf,
// kein Sheet-Schreiben, kein \Seen.
//
// Ausführen: npx tsx -r dotenv/config tests/dryrun_reply_agent.ts

import {
  leseUngeleseneEmails,
  ladeOutreachQueue,
  entscheideEmail,
  entscheideAktion,
  findeLeadRow,
  extrahiereEmailAdresse,
} from "../src/trigger/reply-classifier";

const SCHWELLE = 90;

async function main() {
  console.log("=== Reply-Agent DRY-RUN (read-only, keine Seiteneffekte) ===\n");

  // Seit dem 04.09.2026 entscheidet die Queue, welche Mails ueberhaupt geholt
  // werden — sie muss deshalb vor dem Postfach geladen sein.
  const { rows } = await ladeOutreachQueue();
  console.log(`Outreach-Queue-Zeilen geladen: ${rows.length}`);

  const bekannteKontakte = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const k = (rows[i]?.[3] ?? "").toLowerCase().trim();
    if (k) bekannteKontakte.add(k);
  }

  const posteingang = await leseUngeleseneEmails((a) => bekannteKontakte.has(a));
  const emails = posteingang.emails;
  console.log(
    `Ungelesen gesamt: ${posteingang.ungelesenGesamt} | ` +
      `Lead-Antworten: ${posteingang.leadsGesamt} | ` +
      `Massenpost (wuerde \\Seen bekommen): ${posteingang.massenpost.length} | ` +
      `bleibt ungelesen: ${posteingang.unberuehrt}\n`
  );
  if (emails.length === 0) {
    console.log("Keine Lead-Antworten. (Sauberer No-Op-Test.)");
    return;
  }

  let termine = 0, entwuerfe = 0, status = 0, unbekannt = 0;

  for (const email of emails) {
    const sender = extrahiereEmailAdresse(email.from);
    const lead = findeLeadRow(rows, sender);

    if (!lead) {
      console.log(`- [SKIP] ${sender} — kein Lead in der Queue, würde NICHT angefasst`);
      unbekannt++;
      continue;
    }

    const e = await entscheideEmail(email);
    const aktion = entscheideAktion(e);

    const plan =
      aktion === "CALENDLY_SENDEN"
        ? "WÜRDE CALENDLY-TERMIN SELBST SENDEN"
        : aktion === "ENTWURF"
        ? "WÜRDE GMAIL-ENTWURF ANLEGEN (Freigabe durch Nio)"
        : "WÜRDE NUR SHEET-STATUS SETZEN";

    if (aktion === "CALENDLY_SENDEN") termine++;
    else if (aktion === "ENTWURF") entwuerfe++;
    else status++;

    console.log(`- ${lead.name} <${sender}>`);
    console.log(`    Betreff:    ${email.subject}`);
    console.log(`    Entscheid:  ${e.kategorie} @ ${e.confidence}% (Schwelle ${SCHWELLE})`);
    console.log(`    Grund:      ${e.grund}`);
    console.log(`    PLAN:       ${plan}`);
    if (e.antwort) console.log(`    Antwort-Vorschau: ${e.antwort.slice(0, 140)}${e.antwort.length > 140 ? "…" : ""}`);
    console.log("");
  }

  console.log("=== Zusammenfassung (geplant, nichts ausgeführt) ===");
  console.log(`  Auto-Termine:            ${termine}`);
  console.log(`  Entwürfe zur Freigabe:   ${entwuerfe}`);
  console.log(`  Nur Status:              ${status}`);
  console.log(`  Übersprungen (kein Lead):${unbekannt}`);
}

main().catch((err) => {
  console.error("Dry-Run Fehler:", err);
  process.exit(1);
});
