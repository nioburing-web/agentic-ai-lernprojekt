/**
 * Die Zielnischen der Nacht-Recherche.
 *
 * Bis zum 08.08.2026 stand hier faktisch nur "Kfz-Werkstatt", und das
 * Branchen-Vokabular klebte im Mail-Prompt fest ("unter dem Auto", "Fahrzeug,
 * Wunschzeit"). Ergebnis: als der KFZ-Pool in 24 Städten leer war, lief die
 * Recherche ab dem 29.07. jede Nacht ins Timeout und die Neu-Akquise stand.
 *
 * Deshalb liegt das Vokabular jetzt hier — Suchbegriffe, Reibungssatz, Register,
 * Beispielsatz für die Demo — und der Prompt liest es als Parameter.
 *
 * Eine neue Nische aufmachen heisst: Eintrag ergänzen, nicht Prompt umschreiben.
 */

/** Welche Demo ein Lead dieser Kategorie zu sehen bekommt. */
export type DemoProfil = "werkstatt" | "lokal";

export type Nische = {
  /** Wie die Branche im Mail-Prompt heisst, z.B. "Friseursalon" */
  name: string;
  /** Suchbegriffe für Google Maps. Überlappen bewusst wenig. */
  suchbegriffe: string[];
  /** Ein Satz echter Reibung im Alltag dieser Branche. Kontext, nie wörtlich in die Mail. */
  hook: string;
  /** Satz, den der Empfänger in die Demo tippen kann, um sie in Gang zu bringen. */
  beispielFrage: string;
};

export type Register = {
  /** Anrede-Vorgabe für den Mail-Prompt */
  anrede: string;
  /** Zusätzliche Ton-Anweisung, geht als eigener Absatz in den Prompt */
  ton: string;
};

export type Kategorie = {
  slug: string;
  label: string;
  demo: DemoProfil;
  register: Register;
  /**
   * Für wen der Assistent gebaut wurde, im Plural — geht als "Assistent für ..."
   * in die Mail. Ersetzt das alte feste "Assistent für Werkstätten".
   */
  zielgruppe: string;
  /** Was der Assistent in dieser Kategorie kann — geht in den Demo-Absatz der Mail. */
  demoBeschreibung: string;
  /** Welche Angaben der Assistent aufnimmt. Muss zur Demo unter `demo` passen. */
  demoFelder: string;
  /**
   * Bike-Method Phase 1: solange true, landen Entwürfe als PRUEFEN im Sheet und
   * morgen-versand rührt sie nicht an (der filtert hart auf Status "DRAFT").
   * Nio liest die erste Woche gegen, dann hier auf false ziehen.
   */
  imTest: boolean;
  /** Nur aktive Kategorien kommen in die Nacht-Rotation. */
  aktiv: boolean;
  nischen: Nische[];
};

const LOCKER: Register = {
  anrede: 'Beginne mit "Hey," (oder einer ähnlich lockeren Anrede)',
  ton: "Duze den Empfänger. Kleine Betriebe, lockerer Ton, so wie man einem Handwerker schreibt.",
};

const SACHLICH: Register = {
  anrede: 'Beginne mit "Guten Tag," (oder einer ähnlich sachlichen Anrede)',
  ton: "Sieze den Empfänger durchgehend. Nüchtern und knapp, ohne steif zu werden — das ist ein Berufsstand, der Seriosität erwartet. Keine Umgangssprache, keine Abkürzungen.",
};

export const KATEGORIEN: Kategorie[] = [
  {
    slug: "kfz",
    label: "KFZ-Werkstätten",
    demo: "werkstatt",
    register: LOCKER,
    zielgruppe: "Werkstätten",
    demoBeschreibung:
      "Er beantwortet Fragen zu Leistungen, Öffnungszeiten und groben Preisrahmen und nimmt Terminanfragen auf.",
    demoFelder: "Name, Fahrzeug, Anliegen, Wunschzeit",
    imTest: false,
    // Pool erschöpft (24 Städte weitgehend kontaktiert, siehe Timeout ab 29.07.2026).
    // Bleibt als Konfiguration stehen, damit die alten Leads und /r/<id>-Links
    // erklärbar bleiben — aber ausserhalb der Rotation.
    aktiv: false,
    nischen: [
      {
        name: "Kfz-Werkstatt",
        suchbegriffe: ["Kfz-Werkstatt", "Autowerkstatt", "Kfz-Meisterbetrieb", "Autoservice"],
        hook: "Die meisten Anrufe kommen, wenn gerade niemand rangehen kann — jemand liegt unter dem Auto, der Kunde probiert es einmal und ruft dann die nächste Werkstatt an.",
        beispielFrage: "Meine Bremsen quietschen.",
      },
    ],
  },

  {
    slug: "termin-beauty",
    label: "Termin-Handwerk & Beauty",
    demo: "lokal",
    register: LOCKER,
    zielgruppe: "lokale Betriebe",
    demoBeschreibung:
      "Er beantwortet Fragen zu Leistungen und Öffnungszeiten und nimmt Terminanfragen auf.",
    demoFelder: "Name, Anliegen, Wunschzeit, Rückrufnummer",
    imTest: true,
    aktiv: true,
    nischen: [
      {
        name: "Friseursalon",
        suchbegriffe: ["Friseur", "Friseursalon"],
        hook: "Während jemand am Stuhl sitzt, klingelt das Telefon — rangehen heisst den Kunden stehen lassen, nicht rangehen heisst den Termin verlieren.",
        beispielFrage: "Habt ihr Samstag noch was frei?",
      },
      {
        name: "Kosmetikstudio",
        suchbegriffe: ["Kosmetikstudio", "Kosmetikinstitut"],
        hook: "Während einer Behandlung kann niemand ans Telefon — die Anfragen kommen aber genau dann, und abends nach Feierabend.",
        beispielFrage: "Was kostet eine Gesichtsbehandlung?",
      },
      {
        name: "Physiotherapie-Praxis",
        suchbegriffe: ["Physiotherapie", "Physiotherapiepraxis"],
        hook: "Patienten buchen bei der Praxis, die zuerst antwortet — Wartelisten entstehen oft nicht aus Auslastung, sondern aus Reaktionszeit.",
        beispielFrage: "Ich brauche einen Termin mit Rezept.",
      },
      {
        name: "Heilpraktiker-Praxis",
        suchbegriffe: ["Heilpraktiker", "Naturheilpraxis"],
        hook: "Ohne Erinnerung erscheint ein Teil der Patienten nicht zum Termin — jeder Ausfall ist eine Stunde, die niemand bezahlt.",
        beispielFrage: "Wie läuft ein Erstgespräch ab?",
      },
      {
        name: "Fußpflege-Praxis",
        suchbegriffe: ["Fußpflege", "Podologie"],
        hook: "Die Terminplanung läuft am Telefon, während gearbeitet wird — Rückrufe stapeln sich und werden abends nachgeholt.",
        beispielFrage: "Habt ihr nächste Woche einen Termin frei?",
      },
    ],
  },

  {
    slug: "lokale-dienstleister",
    label: "Lokale Dienstleister",
    demo: "lokal",
    register: LOCKER,
    zielgruppe: "lokale Betriebe",
    demoBeschreibung:
      "Er beantwortet Fragen zu Leistungen und Öffnungszeiten und nimmt Anfragen auf.",
    demoFelder: "Name, Anliegen, Wunschzeit, Rückrufnummer",
    imTest: true,
    aktiv: true,
    nischen: [
      {
        name: "Restaurant",
        suchbegriffe: ["Restaurant"],
        hook: "Reservierungsanfragen kommen mitten im Service — wer nicht rangeht, verliert den Tisch an das Lokal nebenan.",
        beispielFrage: "Habt ihr Freitag einen Tisch für vier?",
      },
      {
        name: "Fahrschule",
        suchbegriffe: ["Fahrschule"],
        hook: "Fahrschüler buchen kurzfristig um, und das läuft alles über Telefon und WhatsApp — die Verwaltung frisst die Zeit, die fürs Unterrichten fehlt.",
        beispielFrage: "Wann startet der nächste Theoriekurs?",
      },
      {
        name: "Tierarztpraxis",
        suchbegriffe: ["Tierarzt", "Tierarztpraxis"],
        hook: "Viele Tierbesitzer rufen abends oder am Wochenende an und erreichen niemanden — die erste Praxis, die reagiert, bekommt den Termin.",
        beispielFrage: "Mein Hund frisst seit gestern nicht.",
      },
      {
        name: "Zahnarztpraxis",
        suchbegriffe: ["Zahnarzt", "Zahnarztpraxis"],
        hook: "Ein grosser Teil der Terminanfragen kommt abends oder am Wochenende — und landet bei der Praxis, die als erste reagiert.",
        beispielFrage: "Ich hätte gern einen Kontrolltermin.",
      },
    ],
  },

  {
    slug: "b2b-kleinbetriebe",
    label: "B2B-Kleinbetriebe",
    demo: "lokal",
    register: SACHLICH,
    zielgruppe: "Kanzleien und Büros",
    demoBeschreibung:
      "Er beantwortet Fragen zu Leistungen und Erreichbarkeit und nimmt Anfragen strukturiert auf.",
    demoFelder: "Name, Anliegen, Wunschzeit, Rückrufnummer",
    imTest: true,
    aktiv: true,
    nischen: [
      {
        name: "Steuerkanzlei",
        suchbegriffe: ["Steuerberater", "Steuerkanzlei"],
        hook: "Mandantenanfragen gehen häufig an die Kanzlei, die als erste antwortet — nicht an die fachlich beste.",
        beispielFrage: "Ich suche eine Kanzlei für meine GmbH.",
      },
      {
        name: "Immobilienmakler-Büro",
        suchbegriffe: ["Immobilienmakler"],
        hook: "Interessenten schreiben mehrere Makler gleichzeitig an — wer zuerst zurückmeldet, führt das Gespräch.",
        beispielFrage: "Ist die Wohnung noch verfügbar?",
      },
      {
        name: "Hausverwaltung",
        suchbegriffe: ["Hausverwaltung"],
        hook: "Mieter erwarten Antworten innerhalb von Stunden — verspätete Rückmeldungen eskalieren und landen in Bewertungen.",
        beispielFrage: "Bei mir tropft die Heizung.",
      },
    ],
  },
];

export function aktiveKategorien(): Kategorie[] {
  return KATEGORIEN.filter((k) => k.aktiv);
}

/**
 * Eine Kategorie pro Nacht, rotierend über den Jahrestag.
 *
 * Bewusst nicht "alle Kategorien gemischt": die Reply-Rate wird je Kategorie
 * getrennt gemessen (Lehre aus der Betreff-Monokultur — aggregierte Raten
 * verstecken den Ausreisser), und Nio prüft die Entwürfe in Phase 1 pro
 * Kategorie. Ein Batch = eine Kategorie = eine Bewertungseinheit.
 */
export function waehleKategorie(tagImJahr: number, kategorien: Kategorie[] = aktiveKategorien()): Kategorie | null {
  if (kategorien.length === 0) return null;
  const i = ((tagImJahr % kategorien.length) + kategorien.length) % kategorien.length;
  return kategorien[i]!;
}

/** Findet die Nische zu einem Suchbegriff zurück — für Hook und Beispielsatz. */
export function nischeZuBegriff(kategorie: Kategorie, begriff: string): Nische | null {
  return kategorie.nischen.find((n) => n.suchbegriffe.includes(begriff)) ?? null;
}

/** Alle Suchbegriffe einer Kategorie, flach. */
export function begriffeDerKategorie(kategorie: Kategorie): string[] {
  return kategorie.nischen.flatMap((n) => n.suchbegriffe);
}
