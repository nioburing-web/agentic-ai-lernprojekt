// Tests für die Domain-Passung: gehört die gefundene Adresse zu der Website,
// auf der sie gefunden wurde?
// Kein Netzwerk, kein Sheet, kein LLM — nur die Prüffunktion.
// Ausführen: npx tsx tests/test_adress_fit.ts
//
// Warum es diese Prüfung gibt: bei der Freigabe von 92 Queue-Zeilen am 25.08.2026
// fielen 4 durch, alle aus derselben Klasse — die Adresse war formal einwandfrei,
// gehörte aber einem Dritten:
//   - info@dasministerium.com  → Werbeagentur, die die Zahnarzt-Website gebaut hat
//   - kontakt@newgen.ag        → Marketing-Agentur FÜR Steuerkanzleien, also Wettbewerb
//   - dpo@wordpress.org        → Datenschutzbeauftragter aus dem WordPress-Hinweis
//   - office@familie-bauer-consulting.de → Dritter im Impressum der Hausverwaltung
// `adresseIstUnbrauchbar` kann diese Klasse nicht sehen: die Adressen sind
// syntaktisch sauber und stehen auf keiner Sperrliste. Der einzige Unterschied
// zu einer echten Adresse ist, dass die Domain nicht zur Website passt.
//
// Der Gegenfall ist genauso wichtig: kleine Betriebe nutzen echte Freemail-Adressen
// (t-online, gmx). Die dürfen NICHT durchfallen, sonst kostet der Filter mehr
// Leads als er rettet.

import { emailPasstZurWebsite } from "../src/trigger/nacht-recherche";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) {
    console.log(`[OK]   ${nachricht}`);
    bestanden++;
  } else {
    console.log(`[FEHL] ${nachricht}`);
    fehlgeschlagen++;
  }
}

function verwirft(email: string, website: string, was: string): void {
  const grund = emailPasstZurWebsite(email, website);
  check(grund !== null, `verwirft ${was}: ${email} auf ${website}${grund ? ` (${grund})` : ""}`);
}

function behaelt(email: string, website: string, was: string): void {
  const grund = emailPasstZurWebsite(email, website);
  check(grund === null, `behält ${was}: ${email} auf ${website}${grund ? ` — FÄLSCHLICH verworfen: ${grund}` : ""}`);
}

console.log("\n=== Die vier echten Fälle vom 25.08.2026 ===");
verwirft("info@dasministerium.com", "https://www.mangold-dentists.de", "Werbeagentur aus dem Impressum (Z1186)");
verwirft("kontakt@newgen.ag", "https://www.helm-partner-stb.de", "Marketing-Agentur für Kanzleien (Z1241)");
verwirft("dpo@wordpress.org", "https://www.fahrschule-muenster-drive.de", "WordPress-Datenschutzbeauftragter (Z1229)");
verwirft("office@familie-bauer-consulting.de", "https://domicilia.de", "Dritter im Impressum (Z1266)");

console.log("\n=== Freemail von echten Kleinbetrieben bleibt drin ===");
behaelt("green-light-muenster@t-online.de", "https://www.green-light-fahrschule.de", "t-online (Z1228)");
behaelt("beautydentpruss@gmx.de", "https://www.zahnarztpraxis-pruss.de", "gmx (Z1190)");
behaelt("praxis@web.de", "https://www.irgendeine-praxis.de", "web.de");
behaelt("kanzlei@gmail.com", "https://www.kanzlei-mueller.de", "gmail");
behaelt("info@outlook.de", "https://www.betrieb-xy.de", "outlook");

console.log("\n=== Eigene Domain, in allen Schreibweisen ===");
behaelt("webteam@p-claassen.de", "https://www.p-claassen.de", "www vor der Domain (Z1136)");
behaelt("info@taxlenz.de", "https://taxlenz.de", "ohne www (Z1143)");
behaelt("info@zahnarzt-xy.de", "https://www.zahnarzt-xy.de/kontakt", "URL mit Pfad");
behaelt("info@zahnarzt-xy.de", "www.zahnarzt-xy.de", "URL ohne Protokoll");
behaelt("praxis@mail.zahnarzt-xy.de", "https://www.zahnarzt-xy.de", "Mail-Subdomain");
behaelt("info@zahnarzt-xy.de", "https://praxis.zahnarzt-xy.de", "Website auf Subdomain");
behaelt("INFO@Zahnarzt-XY.de", "https://www.ZAHNARZT-xy.de", "Großschreibung");

console.log("\n=== Fremde Geschäfts-Domains fallen durch, auch wenn sie ähnlich aussehen ===");
verwirft("info@zahnarzt-xy.com", "https://www.zahnarzt-xy.de", "gleiche Marke, andere TLD");
verwirft("info@meinzahnarzt-xy.de", "https://www.zahnarzt-xy.de", "Domain enthält die andere als Teilstring");
verwirft("info@agentur-webdesign.de", "https://www.fahrschule-nord.de", "Webdesign-Agentur");

console.log("\n=== Kaputte Eingaben stürzen nicht ab ===");
verwirft("", "https://www.betrieb.de", "leere Adresse");
verwirft("keinatzeichen.de", "https://www.betrieb.de", "Adresse ohne @");
check(emailPasstZurWebsite("info@betrieb.de", "") === null, "leere Website: nicht prüfbar, also nicht verwerfen");
check(emailPasstZurWebsite("info@betrieb.de", "kein url text") === null, "unlesbare Website: nicht prüfbar, also nicht verwerfen");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen > 0 ? 1 : 0);
