// Tests für die Nischen-Konfiguration und die Kategorie-Rotation.
// Kein Netzwerk, kein Sheet, kein LLM.
// Ausführen: npx tsx tests/test_nischen.ts
//
// Hintergrund: ab dem 29.07.2026 lief die Nacht-Recherche jede Nacht ins Timeout,
// weil der KFZ-Pool leer war und das Branchen-Vokabular fest im Prompt klebte.
// Diese Tests halten fest, was die Verbreiterung garantieren muss.

import {
  KATEGORIEN,
  aktiveKategorien,
  begriffeDerKategorie,
  nischeZuBegriff,
  waehleKategorie,
} from "../src/trigger/nischen";
import {
  demoLink,
  mailAngles,
  markanterNamensteil,
  nameIstGenannt,
} from "../src/trigger/nacht-recherche";

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

// ─── Konfiguration ───────────────────────────────────────────────────────────

check(KATEGORIEN.length >= 4, `mindestens 4 Kategorien konfiguriert (${KATEGORIEN.length})`);
check(
  new Set(KATEGORIEN.map((k) => k.slug)).size === KATEGORIEN.length,
  "Kategorie-Slugs sind eindeutig",
);

const alleBegriffe = KATEGORIEN.flatMap(begriffeDerKategorie);
check(
  new Set(alleBegriffe).size === alleBegriffe.length,
  `kein Suchbegriff in zwei Nischen (${alleBegriffe.length} Begriffe) — sonst greift nischeZuBegriff den falschen Hook`,
);

check(
  KATEGORIEN.every((k) => k.nischen.every((n) => n.suchbegriffe.length > 0 && n.hook.length > 20 && n.beispielFrage.length > 5)),
  "jede Nische hat Suchbegriffe, einen Hook und eine Beispielfrage",
);

// Der Kern der Verbreiterung: alles ausser KFZ zeigt die neutrale Demo.
check(
  KATEGORIEN.filter((k) => k.slug !== "kfz").every((k) => k.demo === "lokal"),
  "alle Nicht-KFZ-Kategorien zeigen die neutrale Demo",
);
check(
  KATEGORIEN.find((k) => k.slug === "kfz")?.demo === "werkstatt",
  "KFZ zeigt weiter die Werkstatt-Demo",
);

// Der KFZ-Pool ist erschöpft — die Kategorie darf nicht in der Rotation stehen.
check(
  KATEGORIEN.find((k) => k.slug === "kfz")?.aktiv === false,
  "KFZ ist ausserhalb der Rotation (Pool erschöpft seit 29.07.2026)",
);

// Bike-Method Phase 1: neue Kategorien gehen erst nach Sichtprüfung raus.
check(
  aktiveKategorien().every((k) => k.imTest),
  "jede aktive Kategorie steht in Phase 1 (imTest) — Entwürfe gehen nicht ungelesen raus",
);

// ─── Kein KFZ-Vokabular ausserhalb der KFZ-Kategorie ─────────────────────────

const KFZ_WORTE = /(werkstatt|fahrzeug|\bkfz|bremse|reifen|hebebühne|ölwechsel|auto)/i;
for (const k of KATEGORIEN.filter((k) => k.slug !== "kfz")) {
  const text = [
    k.zielgruppe,
    k.demoBeschreibung,
    k.demoFelder,
    k.register.ton,
    k.register.anrede,
    ...k.nischen.flatMap((n) => [n.name, n.hook, n.beispielFrage, ...n.suchbegriffe]),
  ].join(" ");
  check(!KFZ_WORTE.test(text), `${k.slug}: kein KFZ-Vokabular in der Konfiguration`);

  // Und dasselbe für die generierten Mail-Strukturen — dort stand es bis 08.08. fest.
  const strukturen = mailAngles(k, k.nischen[0]!).map((a) => a.struktur).join(" ");
  check(!KFZ_WORTE.test(strukturen), `${k.slug}: kein KFZ-Vokabular in den Mail-Strukturen`);
}

// ─── Register ────────────────────────────────────────────────────────────────

const b2b = KATEGORIEN.find((k) => k.slug === "b2b-kleinbetriebe")!;
check(/sieze/i.test(b2b.register.ton), "B2B-Kategorie siezt (Risiko aus der Build-Spec)");
check(!/Hey/.test(b2b.register.anrede), 'B2B-Anrede ist nicht "Hey"');

const beauty = KATEGORIEN.find((k) => k.slug === "termin-beauty")!;
check(/duze/i.test(beauty.register.ton), "Termin-Handwerk duzt");

// ─── Rotation ────────────────────────────────────────────────────────────────

const aktive = aktiveKategorien();
check(aktive.length > 0, `mindestens eine aktive Kategorie (${aktive.length})`);
check(
  waehleKategorie(5)?.slug === waehleKategorie(5)?.slug && waehleKategorie(5) !== null,
  "gleicher Tag liefert dieselbe Kategorie (deterministisch)",
);

// Über so viele Tage wie Kategorien muss jede genau einmal drankommen.
const gesehen = new Set<string>();
for (let tag = 0; tag < aktive.length; tag++) gesehen.add(waehleKategorie(tag)!.slug);
check(
  gesehen.size === aktive.length,
  `jede aktive Kategorie kommt binnen ${aktive.length} Nächten dran (gesehen: ${[...gesehen].join(", ")})`,
);

check(waehleKategorie(-3) !== null, "negativer Tagesindex bricht die Rotation nicht");
check(waehleKategorie(0, []) === null, "ohne aktive Kategorie liefert die Rotation null");

// ─── Zuordnung Begriff → Nische ──────────────────────────────────────────────

check(
  nischeZuBegriff(beauty, "Friseur")?.name === "Friseursalon",
  'Suchbegriff "Friseur" führt zurück auf die Nische Friseursalon',
);
check(nischeZuBegriff(beauty, "Kfz-Werkstatt") === null, "fremder Suchbegriff liefert null");
check(
  aktive.every((k) => begriffeDerKategorie(k).every((b) => nischeZuBegriff(k, b) !== null)),
  "jeder Suchbegriff einer aktiven Kategorie findet seine Nische zurück",
);

// ─── Demo-Link ───────────────────────────────────────────────────────────────

check(
  demoLink("abc123", "werkstatt") === "https://kfz-demo-agent.netlify.app/r/abc123",
  "KFZ-Link zeigt unverändert auf /r/<id> — alte Mails dürfen nicht brechen",
);

let laut = false;
try {
  // Ohne DEMO_BASIS_LOKAL muss der Aufruf scheitern, statt einen kaputten Link zu bauen.
  const link = demoLink("abc123", "lokal");
  laut = link.endsWith("/a/abc123") && link.startsWith("http");
} catch {
  laut = true;
}
check(laut, "neutraler Link ist entweder gültig (/a/<id>) oder bricht laut ab — nie halb kaputt");

// ─── Firmenname in der Mail ──────────────────────────────────────────────────
// Der Dry-Run vom 09.08.2026 zeigte: 5 von 6 Mails liessen den Namen aus und
// schrieben "euer Salon". Die Prompt-Regel allein reicht nicht, deshalb prüft
// der Lauf das Ergebnis und fasst einmal gezielt nach.

check(markanterNamensteil("Gasthaus Kupferpfanne") === "Kupferpfanne", "Gattungswort fällt raus");
check(markanterNamensteil("Kanzlei Ahrend & Partner") === "Ahrend", "Rechtsform und Gattung fallen raus");
check(markanterNamensteil("Salon Lindenhof") === "Lindenhof", '"Salon" zählt nicht als Erkennungsmerkmal');
check(markanterNamensteil("Nio GmbH").length > 0, "Name aus nur Füllwörtern liefert trotzdem etwas");

check(
  nameIstGenannt("Hey, bei Gasthaus Kupferpfanne ist mir aufgefallen…", "Gasthaus Kupferpfanne"),
  "voller Name zählt",
);
check(
  nameIstGenannt("Hey, ich finde es cool, dass ihr in der Kupferpfanne braut.", "Gasthaus Kupferpfanne"),
  "markanter Teil allein zählt auch — so schreibt ein Mensch",
);
check(
  !nameIstGenannt("Hey, euer Salon nimmt sich viel Zeit für Kundinnen.", "Salon Lindenhof"),
  '"euer Salon" zählt NICHT — genau der Serienbrief-Fall',
);
check(
  !nameIstGenannt("Guten Tag, Ihre Kanzlei berät Existenzgründer.", "Kanzlei Ahrend & Partner"),
  '"Ihre Kanzlei" zählt NICHT',
);
check(nameIstGenannt("… bei KUPFERPFANNE …", "Gasthaus Kupferpfanne"), "Groß/Kleinschreibung egal");

console.log(`\n${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen`);
process.exit(fehlgeschlagen === 0 ? 0 : 1);
