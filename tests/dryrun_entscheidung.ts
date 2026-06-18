// Prüft die LIVE-Entscheidung (echtes LLM) mit synthetischen Lead-Antworten.
// Nur OpenAI-Calls, kein Postfach, kein Sheet, kein Versand.
// Ausführen: npx tsx -r dotenv/config tests/dryrun_entscheidung.ts

import { entscheideEmail, entscheideAktion } from "../src/trigger/reply-classifier";

const beispiele = [
  {
    label: "Klares Interesse + Termin",
    from: "Ferdag Karadeniz <info@kfz-klinik.de>",
    subject: "Re: Kurze Frage, KFZ Klinik München",
    body: "Hallo, ja das klingt gut. Lassen Sie uns gerne telefonieren, wann passt es Ihnen?",
    erwartet: "CALENDLY_SENDEN",
  },
  {
    label: "Rückfrage zu Kosten",
    from: "M. Wagner <kanzlei@wagner-stb.de>",
    subject: "Re: Kurze Frage, Steuerberater Wagner",
    body: "Klingt interessant. Was würde so ein Agent denn ungefähr im Monat kosten und wie lange dauert die Einrichtung?",
    erwartet: "ENTWURF",
  },
  {
    label: "Klare Absage",
    from: "Schmidt <info@schmidt-bau.de>",
    subject: "Re: Kurze Frage, Schmidt Bau",
    body: "Kein Interesse, bitte keine weiteren E-Mails. Danke.",
    erwartet: "NUR_STATUS",
  },
];

async function main() {
  console.log("=== LIVE-Entscheidungstest (echtes LLM, synthetische Mails) ===\n");
  for (const b of beispiele) {
    const e = await entscheideEmail({
      uid: 0,
      subject: b.subject,
      from: b.from,
      body: b.body,
      messageId: "<test@local>",
    });
    const aktion = entscheideAktion(e);
    const ok = aktion === b.erwartet ? "OK" : "ABWEICHUNG";
    console.log(`[${ok}] ${b.label}`);
    console.log(`    "${b.body}"`);
    console.log(`    → ${e.kategorie} @ ${e.confidence}%  → Aktion: ${aktion} (erwartet: ${b.erwartet})`);
    console.log(`    Grund: ${e.grund}`);
    if (e.antwort) console.log(`    Antwort: ${e.antwort.slice(0, 160)}${e.antwort.length > 160 ? "…" : ""}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error("Fehler:", err);
  process.exit(1);
});
