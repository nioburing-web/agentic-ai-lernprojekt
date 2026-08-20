// Tests für die Adress-Prüfung der Nacht-Recherche.
// Kein Netzwerk, kein Sheet, kein LLM — nur die Prüffunktion.
// Ausführen: npx tsx tests/test_adresse.ts
//
// Warum es diese Prüfung gibt: bei der Freigabe von 72 Queue-Zeilen am 17.08.2026
// fielen 4 durch, alle wegen der Adresse und nicht wegen des Textes. Der
// Quality-Gate prüfte Betreff, Firmenname und Hook — die Adresse nie. Rund 6 %
// gingen an Empfänger, die nie antworten konnten, und zählten trotzdem als
// GESENDET. Aufgefallen ist es nur, weil ein Mensch 72 Zeilen von Hand ansah.

import { adresseIstUnbrauchbar } from "../src/trigger/nacht-recherche";

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

function verwirft(email: string, was: string): void {
  const grund = adresseIstUnbrauchbar(email);
  check(grund !== null, `verwirft ${was}: ${email}${grund ? ` (${grund})` : ""}`);
}

function behaelt(email: string, was: string): void {
  const grund = adresseIstUnbrauchbar(email);
  check(grund === null, `behält ${was}: ${email}${grund ? ` — FÄLSCHLICH verworfen: ${grund}` : ""}`);
}

console.log("\n=== Die vier echten Fälle vom 17.08.2026 ===");
verwirft("de-de@2x.png", "Bilddateiname (Z1020)");
verwirft("job@alpha-physiotherapie.de", "Bewerbungspostfach (Z1069)");
verwirft("service@studiolution.com", "Salon-Software statt Salon (Z1084)");
console.log("[INFO] Fall 4 (Sportverein ohne Terminannahme) ist bewusst NICHT abgedeckt — braucht ein Urteil.");

console.log("\n=== Dateiendungen als Domain ===");
verwirft("logo@sprite.svg", "SVG");
verwirft("bild@header.jpg", "JPG");
verwirft("style@main.css", "CSS");
verwirft("datei@flyer.pdf", "PDF");

console.log("\n=== Postfächer, die kein Entscheider liest ===");
verwirft("bewerbung@kanzlei-mueller.de", "bewerbung@");
verwirft("karriere@physio-nord.de", "karriere@");
verwirft("noreply@studio-schmidt.de", "noreply@");
verwirft("no-reply@salon-berlin.de", "no-reply@");
verwirft("job.mueller@praxis-nord.de", "job als erster Namensteil");

console.log("\n=== Fremde Plattformen ===");
verwirft("kontakt@treatwell.de", "Buchungsplattform");
verwirft("info@shore.com", "Salon-Software");
verwirft("support@doctolib.de", "Terminplattform");
verwirft("hallo@mail.studiolution.com", "Subdomain einer fremden Plattform");

console.log("\n=== Syntaktisch kaputt ===");
verwirft("", "leer");
verwirft("keinatzeichen.de", "kein @");
verwirft("a@b@c.de", "zwei @");
verwirft("info@localhost", "Domain ohne Punkt");
verwirft("info @praxis.de", "Leerzeichen");

console.log("\n=== Muss durchkommen (Fehlalarm wäre teurer als eine verschwendete Mail) ===");
behaelt("info@physiotherapie-sachs.de", "Standard info@");
behaelt("kontakt@bwt-kanzlei.de", "kontakt@");
behaelt("praxis@physio-am-kunstmuseum.de", "praxis@");
behaelt("kanzlei@ingenerf.com", "kanzlei@");
behaelt("beratung@stb-otto.de", "beratung@");
behaelt("heinrich@dieckmann-immobilien.de", "Vorname als Postfach");
behaelt("guelperi.seker@web.de", "Freemail eines kleinen Studios");
behaelt("andhaus@googlemail.com", "Freemail einer Praxis");
behaelt("schwertfeger-duisburg@etl.de", "Kanzlei unter Verbund-Domain");
behaelt("smalke@physiotherapiemalke.info", "TLD .info");
behaelt("jobst@steuerkanzlei-jobst.de", "jobst@ ist kein job@");
behaelt("personalberatung@kanzlei-x.de", "personalberatung ist kein personal@");
behaelt("INFO@Praxis-Nord.DE", "Großschreibung");
behaelt("  info@salon-mitte.de  ", "Leerzeichen aussen");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
