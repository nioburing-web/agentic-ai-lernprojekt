// Tests für die Absage-Erkennung der Demo-Probe (tools/demo-probe.ts), 02.10.2026.
// Kein Netzwerk, kein LLM.
// Ausführen: npx tsx tests/test_demo_probe.ts
//
// Die Absage-Fälle sind wörtliche Antworten der Live-Demo vom 29.09. und 02.10.
// Die Gegenfälle sind echte Antworten, auf die die Demo gut einging — schlägt
// die Erkennung dort an, meldet die Probe Rot bei einer gesunden Demo und
// niemand traut ihr.

import { absageBefund, alleFaelle } from "../tools/demo-probe";

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) { console.log(`[OK]   ${nachricht}`); bestanden++; }
  else { console.log(`[FEHL] ${nachricht}`); fehlgeschlagen++; }
}

const absagen: [string, string][] = [
  ["Heizung", "Oh, das tut mir leid! Allerdings bin ich der Assistent vom Demo-Betrieb in Musterstadt, und wir sind hier leider nicht für Heizungsreparaturen zuständig. Du brauchst einen Klempner oder Heizungstechniker vor Ort."],
  ["Wohnung", "Es sieht so aus, als ob du nach einer Wohnung fragst – das ist aber nicht unser Thema. Wir sind ein anderer Betrieb und können dir da leider nicht weiterhelfen."],
  ["Tierarzt", "Das klingt besorgniserregend, aber wir sind hier kein Tierarzt. Bitte wende dich an eine Tierarztpraxis."],
  ["Restaurant", "Ich kläre, ob wir Tischreservierungen überhaupt anbieten."],
  ["Fahrstunde", "Allerdings bin ich der Assistent vom Demo-Betrieb in Musterstadt, und das ist ein Beispiel-Betrieb ohne echte Fahrstunden."],
  ["Restaurant 02.10. a", "Gerne helfe ich dir weiter! Allerdings bin ich der Assistent vom Demo-Betrieb in Musterstadt – das ist hier ein Beispiel-Betrieb, und ich glaube, da gibt es ein Missverständnis. Wir sind kein Restaurant, sondern ein Dienstleistungsbetrieb."],
  ["Restaurant 02.10. b", "Ich bin der Terminassistent vom Demo-Betrieb in Musterstadt, und wir sind kein Restaurant. Wir bieten Termine und Beratungen an."],
  ["Tierarzt 02.10.", "Allerdings bin ich der Assistent vom Demo-Betrieb in Musterstadt und kann dir bei tiermedizinischen Fragen leider nicht helfen. Für dein Anliegen brauchst du einen Tierarzt."],
  ["Tierarzt empfehlen", "Bei Fütterungsproblemen bei Ihrem Hund würde ich Ihnen empfehlen, schnell einen Tierarzt aufzusuchen."],
  ["Rückfall", "Einen Moment, ich bin gleich wieder für dich da."],
  ["leer", "   "],
];
for (const [fall, text] of absagen) {
  check(absageBefund(text) !== null, `Absage erkannt: ${fall}`);
}

const gute: [string, string][] = [
  ["Samstag", "Gerne helfe ich dir weiter! Ja, wir haben auch samstags geöffnet – von 10:00 bis 14:00 Uhr. Um zu schauen, ob wir an einem bestimmten Samstag noch einen Termin für dich haben, brauche ich ein paar Infos von dir."],
  ["Erstgespräch", "Gerne helfe ich dir weiter! Bei uns läuft ein Erstgespräch so ab: Das kostenfreie Erstgespräch dauert etwa 20 Minuten."],
  ["Kontrolltermin", "Gerne! Ich helfe dir, einen Kontrolltermin zu vereinbaren. Dafür brauche ich von dir ein paar Angaben: 1. Wie heißt du?"],
  ["Rezept", "Gerne helfe ich dir weiter! Um einen Termin zu vereinbaren, brauche ich ein paar Angaben von dir. Das kläre ich kurz mit dem Team und melde mich."],
  ["Fahrschule 02.10.", "Das kläre ich kurz mit dem Team und melde mich. Ich muss ehrlich sagen: Das ist hier eine Beispiel-Demo, und ich kenne die genauen Kurstermine des Betriebs noch nicht. Im echten Einsatz hätte ich diese Informationen für Sie parat. Gerne nehme ich Ihre Anfrage trotzdem auf. Dafür brauche ich nur: - Ihren Namen"],
  // Nach dem Fix 02.10.: die Demo spricht als Praxis und nennt den Notdienst nur
  // für den akuten Fall. Das ist gewollt, keine Absage.
  ["Tierarzt nach Fix", "Wenn Ihr Hund seit gestern nicht frisst, sollten wir das zeitnah abklären. Falls ja, würde ich Ihnen empfehlen, direkt den Notdienst zu kontaktieren oder uns anzurufen. Gerne nehme ich aber auch eine Terminanfrage auf."],
  ["Tierarzt nach Fix b", "Bei akuten Problemen wie diesem würde ich Ihnen empfehlen, direkt anzurufen oder im Notfall den Notdienst zu nutzen. Gerne nehme ich aber auch eine Terminanfrage auf."],
  ["Kosmetik Preis", "Für diesen Demo-Betrieb sind keine Preise hinterlegt. Im echten Einsatz würde ich dir die genauen Preise nennen. Gerne kann ich aber trotzdem eine Anfrage für dich aufnehmen."],
  // "Im echten Einsatz" ist der gewollte Satz aus LOKAL_FAKTEN, keine Absage.
  ["Demo-Hinweis", "Dies ist eine Demo-Version des Assistenten. Im echten Einsatz hätte ich alle Informationen zu den Theoriekursen direkt für Sie parat. Kann ich Ihnen trotzdem helfen?"],
];
for (const [fall, text] of gute) {
  check(absageBefund(text) === null, `keine Absage: ${fall}`);
}

// Die Probe muss alle aktiven Sätze aus nischen.ts nehmen, nicht eine Auswahl.
const faelle = alleFaelle();
check(faelle.length >= 12, `alle aktiven Nischen dabei (${faelle.length})`);
check(faelle.some((f) => f.satz.includes("Heizung")), "Hausverwaltung-Satz dabei");
check(faelle.every((f) => f.satz.trim().length > 0), "kein leerer Beispielsatz");
check(!faelle.some((f) => f.profil === "werkstatt"), "inaktive KFZ-Kategorie nicht dabei");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen ? 1 : 0);
