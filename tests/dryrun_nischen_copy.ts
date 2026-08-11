// Dry-Run: erzeugt echte Mails über den nische-neutralen Prompt und prüft, ob
// Ton und Vokabular zur Kategorie passen.
// Kostet ein paar Cent (gpt-4o-mini), schreibt NICHTS ins Sheet, sendet NICHTS.
// Ausführen: npx tsx tests/dryrun_nischen_copy.ts
//
// Das ist der Test für das Risiko aus der Build-Spec vom 08.08.2026:
// "Neutraler Prompt kann für seriöse B2B-Nischen zu locker klingen ('Hey,')."
// Register wird geprüft, nicht gehofft.

import "dotenv/config";
import {
  generiereEmailEntwurf,
  betreffKern,
  betreffIstBrauchbar,
  nameIstGenannt,
} from "../src/trigger/nacht-recherche";
import { aktiveKategorien, type Kategorie, type Nische } from "../src/trigger/nischen";

// Erfundene Betriebe mit realistischem Website-Text. Bewusst keine echten
// Firmen — das hier ist ein Testlauf, kein Outreach.
const BEISPIEL_TEXTE: Record<string, { name: string; stadt: string; text: string }> = {
  Friseursalon: {
    name: "Salon Lindenhof",
    stadt: "Hamburg",
    text: "Salon im Herzen von Eimsbüttel, seit 2011. Wir arbeiten mit Naturkosmetik und ammoniakfreien Farben. Schwerpunkt auf Balayage, Curly Cuts und Haarverdichtung. Vier Stühle, kleines Team, wir nehmen uns pro Kundin eine Stunde Zeit. Beratung vor jedem Farbtermin ist bei uns Standard, nicht Aufpreis. Termine nur nach Vereinbarung, telefonisch oder per WhatsApp.",
  },
  Kosmetikstudio: {
    name: "Studio Rosenwerk",
    stadt: "Leipzig",
    text: "Kosmetikstudio in Leipzig-Plagwitz. Klassische Gesichtsbehandlung, Microneedling, Fruchtsäurepeeling und apparative Kosmetik. Wir arbeiten ohne Verkaufsdruck und ohne Abo-Verträge. Jede Behandlung startet mit einer Hautanalyse. Zwei Kabinen, Terminvergabe persönlich. Ruhige Atmosphäre, keine Laufkundschaft.",
  },
  Restaurant: {
    name: "Gasthaus Kupferpfanne",
    stadt: "Nürnberg",
    text: "Fränkische Küche in der Nürnberger Altstadt, geführt in zweiter Generation. Wechselnde Mittagskarte, abends Schäufele, Karpfen in der Saison und ein grosser Biergarten mit 80 Plätzen. Wir kochen mit Zutaten aus der Region und haben eine eigene Hausbrauerei-Partnerschaft. Für Gruppen ab acht Personen bitten wir um Voranmeldung.",
  },
  Fahrschule: {
    name: "Fahrschule Ankerweg",
    stadt: "Bremen",
    text: "Fahrschule in Bremen-Neustadt mit Klasse B, BE, A und Automatik. Theorieunterricht dienstags und donnerstags, Intensivkurse in den Ferien. Fahrzeugflotte aus VW Golf und einem Automatikwagen für Umsteiger. Wir bieten Angstpatienten gesonderte Einzelstunden an. Anmeldung im Büro oder telefonisch.",
  },
  Steuerkanzlei: {
    name: "Kanzlei Ahrend & Partner",
    stadt: "Düsseldorf",
    text: "Steuerberatungskanzlei in Düsseldorf-Oberkassel mit sieben Mitarbeitern. Schwerpunkte: Jahresabschlüsse für kleine und mittlere Kapitalgesellschaften, Lohnbuchhaltung, Existenzgründungsberatung und Betriebsprüfungsbegleitung. Wir arbeiten vollständig digital mit DATEV Unternehmen online. Mandate aus Handwerk, Handel und freien Berufen.",
  },
  Hausverwaltung: {
    name: "Verwaltung Brückenkontor",
    stadt: "Dortmund",
    text: "Hausverwaltung für WEG und Mietobjekte im Ruhrgebiet, aktuell rund 1400 Einheiten. Leistungen: WEG-Verwaltung inklusive Eigentümerversammlung, Mietverwaltung, technisches Objektmanagement und Nebenkostenabrechnung. Feste Ansprechpartner je Objekt, keine Ticketnummern. Sprechzeiten Montag bis Donnerstag.",
  },
};

const DUZ_MARKER = /\b(du|dir|dich|dein|deine|deinem|deinen|euch|euer|eure|ihr habt|habt ihr)\b/i;
const SIEZ_MARKER = /\b(Sie|Ihnen|Ihre|Ihrem|Ihren)\b/;
const KFZ_MARKER = /\b(Werkstatt|Werkstätten|Fahrzeug|Kfz|Bremsen|Reifen|Hebebühne|unter dem Auto)\b/i;

let bestanden = 0;
let fehlgeschlagen = 0;
function check(bedingung: boolean, nachricht: string): void {
  if (bedingung) {
    console.log(`  [OK]   ${nachricht}`);
    bestanden++;
  } else {
    console.log(`  [FEHL] ${nachricht}`);
    fehlgeschlagen++;
  }
}

function ersteNischeMitText(k: Kategorie): Nische | null {
  return k.nischen.find((n) => BEISPIEL_TEXTE[n.name]) ?? null;
}

async function main(): Promise<void> {
  const kategorien = aktiveKategorien();
  console.log(`Prüfe ${kategorien.length} aktive Kategorien über den neuen Prompt.\n`);

  const alleBetreffe: string[] = [];
  const verbraucht: string[] = [];
  let i = 0;

  for (const kategorie of kategorien) {
    // Pro Kategorie zwei Nischen durchspielen, damit der Ton nicht an einem
    // Einzelfall gemessen wird.
    const nischen = kategorie.nischen.filter((n) => BEISPIEL_TEXTE[n.name]).slice(0, 2);
    if (nischen.length === 0) {
      console.log(`${kategorie.label}: kein Beispieltext hinterlegt — übersprungen\n`);
      continue;
    }

    console.log(`─── ${kategorie.label} (Register: ${kategorie.register.ton.slice(0, 30)}…)`);

    for (const nische of nischen) {
      const b = BEISPIEL_TEXTE[nische.name]!;
      const entwurf = await generiereEmailEntwurf({
        firma: b.name,
        stadt: b.stadt,
        kategorie,
        nische,
        websiteText: b.text,
        link: "https://beispiel.invalid/a/testid",
        betreffIndex: i++,
        verbrauchteBetreffe: verbraucht,
      });
      verbraucht.push(entwurf.betreff);
      alleBetreffe.push(entwurf.betreff);

      console.log(`\n  ${nische.name} — "${entwurf.betreff}"`);
      console.log(entwurf.inhalt.split("\n").map((z) => `    ${z}`).join("\n"));
      console.log("");

      check(betreffIstBrauchbar(entwurf.betreff), "Betreff ohne Anruf/Telefon/verpasst");
      check(entwurf.inhalt.includes("testid"), "Demo-Link steht vollständig in der Mail");
      check(!KFZ_MARKER.test(entwurf.inhalt), "kein KFZ-Vokabular in der Mail");
      check(nameIstGenannt(entwurf.inhalt, b.name), "Betrieb wird beim Namen genannt");

      if (kategorie.slug === "b2b-kleinbetriebe") {
        check(SIEZ_MARKER.test(entwurf.inhalt), "B2B: siezt");
        check(!DUZ_MARKER.test(entwurf.inhalt), "B2B: duzt nicht");
        check(!/^Hey/i.test(entwurf.inhalt.trim()), 'B2B: startet nicht mit "Hey"');
      } else {
        check(DUZ_MARKER.test(entwurf.inhalt), "lokal: duzt");
      }
    }
    console.log("");
  }

  const kerne = alleBetreffe.map(betreffKern);
  console.log("─── Auswertung ───");
  console.log(`Mails erzeugt:     ${alleBetreffe.length}`);
  console.log(`Betreffe einzigartig: ${new Set(kerne).size}/${alleBetreffe.length}`);
  console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);

  const alleEinzigartig = new Set(kerne).size === alleBetreffe.length;
  check(alleEinzigartig, "keine zwei Betreffe identisch");

  process.exit(fehlgeschlagen === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
