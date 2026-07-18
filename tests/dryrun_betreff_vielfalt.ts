// Dry-Run: erzeugt echte Betreffe über den neuen Prompt und misst die Vielfalt.
// Kostet ein paar Cent (gpt-4o-mini), schreibt NICHTS ins Sheet, sendet NICHTS.
// Ausführen: npx tsx tests/dryrun_betreff_vielfalt.ts
//
// Vergleichsmaßstab ist der echte Lauf vom 17.07.2026:
//   30 Betreffe, 19x "Anruf", 2 exakte Duplikate, 28 einzigartig.

import "dotenv/config";
import { generiereEmailEntwurf, betreffKern, betreffIstBrauchbar } from "../src/trigger/nacht-recherche";

// Erfundene Werkstätten mit realistischem Website-Text. Bewusst keine echten
// Betriebe — das hier ist ein Testlauf, kein Outreach.
const WERKSTAETTEN = [
  {
    name: "Autohaus Lindenweg",
    stadt: "Hamburg",
    text: "Seit 1987 in Barmbek. Wir sind eine Meisterwerkstatt für alle Marken mit Schwerpunkt auf VW und Audi. Unser Team von acht Mechanikern kümmert sich um Inspektion, HU/AU-Abnahme direkt im Haus, Klimaservice, Reifenwechsel und Unfallinstandsetzung. Ein Hol- und Bringservice im Stadtgebiet ist auf Anfrage möglich. Wir arbeiten mit Original-Ersatzteilen und geben zwei Jahre Garantie auf alle Reparaturen. Über 400 Kundenbewertungen mit 4,8 Sternen.",
  },
  {
    name: "KFZ-Technik Sandgrube",
    stadt: "Stuttgart",
    text: "Ihre Werkstatt für Nutzfahrzeuge und Transporter in Stuttgart-Feuerbach. Spezialisiert auf Sprinter, Crafter und Transit. Wir übernehmen Wartung, Bremsenservice, Getriebeinstandsetzung und Motordiagnose. Für Gewerbekunden bieten wir Wartungsverträge mit festen Terminen und Ersatzfahrzeug. Werkstattersatzwagen kostenlos. Abschleppdienst rund um die Uhr im Großraum Stuttgart.",
  },
  {
    name: "Motorwerk Alte Mühle",
    stadt: "Köln",
    text: "Familienbetrieb in dritter Generation im Kölner Süden. Unser Herz schlägt für Oldtimer und Youngtimer. Wir restaurieren Karosserien, machen Lackierarbeiten in eigener Kabine und übernehmen die H-Kennzeichen-Abnahme. Daneben normale Werkstattarbeiten: Ölwechsel, Inspektion, Bremsen, Auspuff. Wir nehmen uns Zeit und erklären jede Rechnung.",
  },
  {
    name: "Fahrzeugservice Kupferkamp",
    stadt: "Leipzig",
    text: "Freie Werkstatt in Leipzig-Plagwitz mit Schwerpunkt Elektro- und Hybridfahrzeuge. Zertifiziert für Hochvolt-Arbeiten. Wir bieten Batteriediagnose, Software-Updates, Reifenservice und Klimaanlagenwartung mit dem neuen Kältemittel. Ladepunkte auf dem Hof für Kunden. Termine online oder telefonisch.",
  },
  {
    name: "Werkstatt Buchenhof",
    stadt: "Dortmund",
    text: "Kleine Meisterwerkstatt in Dortmund-Hörde, zwei Hebebühnen, kurze Wege. Wir machen Inspektionen nach Herstellervorgabe, Bremsen, Stoßdämpfer, Auspuff, Batterie und Reifenwechsel inklusive Einlagerung. Achsvermessung mit moderner Messtechnik. Unfallgutachten vermitteln wir über einen Partner. Kostenvoranschlag immer vorab und verbindlich.",
  },
  {
    name: "Autopflege Rehsteig",
    stadt: "München",
    text: "Werkstatt und Fahrzeugaufbereitung in München-Sendling. Neben klassischen Reparaturen wie Bremsen, Kupplung und Zahnriemen bieten wir professionelle Aufbereitung: Lackpolitur, Keramikversiegelung, Innenraumreinigung und Geruchsneutralisierung. Smart Repair für kleine Diefen und Kratzer ohne Neulackierung. Leasingrückläufer sind unsere Spezialität.",
  },
];

async function main(): Promise<void> {
  console.log(`Erzeuge ${WERKSTAETTEN.length} Betreffe über den neuen Prompt...\n`);

  const betreffe: string[] = [];
  const verbraucht: string[] = [];

  for (let i = 0; i < WERKSTAETTEN.length; i++) {
    const w = WERKSTAETTEN[i]!;
    const entwurf = await generiereEmailEntwurf(
      w.name, w.stadt, "Kfz-Werkstatt", `https://beispiel-${i}.de`, w.text,
      "https://kfz-demo-agent.netlify.app/r/testid", i, verbraucht,
    );
    betreffe.push(entwurf.betreff);
    verbraucht.push(entwurf.betreff);
    const ok = betreffIstBrauchbar(entwurf.betreff);
    console.log(`${ok ? "OK  " : "FEHL"} [${w.stadt.padEnd(9)}] ${entwurf.betreff}`);
  }

  const kerne = betreffe.map(betreffKern);
  const mitAnruf = kerne.filter((k) => /anruf|telefon|verpasst/.test(k)).length;
  const einzigartig = new Set(kerne).size;

  console.log(`\n─── Auswertung ───`);
  console.log(`Betreffe:            ${betreffe.length}`);
  console.log(`mit Anruf/Telefon:   ${mitAnruf}   (17.07. waren es 19 von 30 = 63%)`);
  console.log(`einzigartig:         ${einzigartig}/${betreffe.length}`);
  console.log(`alle gültig:         ${betreffe.every((b) => betreffIstBrauchbar(b))}`);

  const bestanden = mitAnruf === 0 && einzigartig === betreffe.length;
  console.log(bestanden ? "\nBESTANDEN" : "\nDURCHGEFALLEN");
  process.exit(bestanden ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
