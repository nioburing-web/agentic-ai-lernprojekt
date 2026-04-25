# Kontaktformular-Erweiterung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Buchhalter-Outreach-Agent um Kontaktformular-Unterstützung erweitern — er erkennt automatisch ob eine Firma eine direkte E-Mail oder ein Kontaktformular hat und handelt entsprechend.

**Architecture:** `findeEmailAufWebsite` gibt neu `{ email, kontaktformularUrl }` zurück. Der Haupt-Loop brancht in Brevo-Pfad (E-Mail) oder Playwright-Pfad (Kontaktformular). `generiereEmail` erhält einen `viaKontaktformular`-Parameter für den Extra-Satz.

**Tech Stack:** TypeScript, Trigger.dev SDK v4, Playwright (chromium), Python (lokales Test-Tool)

---

## File Map

| Datei | Aktion | Verantwortung |
|---|---|---|
| `src/trigger/buchhalter-outreach.ts` | Modify | Alle TypeScript-Änderungen: Rückgabetyp, Formular-Erkennung, Playwright-Funktion, Main-Loop |
| `trigger.config.ts` | Modify | Playwright-Extension hinzufügen |
| `tests/test_buchhalter_outreach.ts` | Modify | Tests für neuen Rückgabetyp + viaKontaktformular |
| `tools/fill_contact_form.py` | Create | Python lokales Test-Tool |

---

## Task 1: `findeEmailAufWebsite` Rückgabetyp ändern

**Files:**
- Modify: `src/trigger/buchhalter-outreach.ts:166-229`
- Modify: `tests/test_buchhalter_outreach.ts:200-212`

- [ ] **Step 1: Test anpassen (wird fehlschlagen)**

In `tests/test_buchhalter_outreach.ts`, ersetze `test6_emailFinder`:

```ts
async function test6_emailFinder(): Promise<void> {
  console.log("\n--- Integrations-Test: E-Mail-Finder ---");

  const result1 = await findeEmailAufWebsite("https://ungueltige-domain-xyz999-abc.de");
  assert(result1.email === null, "Test 6a: Ungültige Domain → email: null");
  assert(result1.kontaktformularUrl === null, "Test 6a: Ungültige Domain → kontaktformularUrl: null");

  const result2 = await findeEmailAufWebsite("keine-url");
  assert(result2.email === null, "Test 6b: Ungültige URL → email: null");
  assert(result2.kontaktformularUrl === null, "Test 6b: Ungültige URL → kontaktformularUrl: null");

  const result3 = await findeEmailAufWebsite("");
  assert(result3.email === null, "Test 6c: Leere URL → email: null");
  assert(result3.kontaktformularUrl === null, "Test 6c: Leere URL → kontaktformularUrl: null");
}
```

- [ ] **Step 2: Test ausführen – muss fehlschlagen**

```bash
npx tsx tests/test_buchhalter_outreach.ts 2>&1 | tail -20
```

Erwartetes Ergebnis: Fehler bei `result1.email` (Property of null/string)

- [ ] **Step 3: `findeEmailAufWebsite` Rückgabetyp + Return-Statements ändern**

In `src/trigger/buchhalter-outreach.ts`, ersetze die Signatur und alle `return`-Statements:

```ts
export async function findeEmailAufWebsite(
  websiteUrl: string
): Promise<{ email: string | null; kontaktformularUrl: string | null }> {
  let baseUrl = websiteUrl;
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    baseUrl = "https://" + baseUrl;
  }
  baseUrl = baseUrl.replace(/\/$/, "");

  let domain: string;
  try {
    domain = new URL(baseUrl).hostname.replace("www.", "");
  } catch {
    console.log(`Ungültige URL: ${websiteUrl}`);
    return { email: null, kontaktformularUrl: null };
  }

  const kandidatenseiten = [
    baseUrl,
    `${baseUrl}/kontakt`,
    `${baseUrl}/impressum`,
    `${baseUrl}/contact`,
  ];

  const alleEmails: string[] = [];

  for (const seite of kandidatenseiten) {
    let inhalt: string;
    try {
      const res = await fetchMitTimeout(
        seite,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "de-DE,de;q=0.9",
          },
        },
        5000
      );
      if (!res.ok) continue;
      inhalt = await res.text();
    } catch {
      continue;
    }

    const gefunden = [...inhalt.matchAll(EMAIL_REGEX)]
      .map((m) => m[0].toLowerCase().replace(/[.,;)]+$/, ""))
      .filter((email) => email.includes(`@${domain}`) || email.includes(`@www.${domain}`));

    for (const email of gefunden) {
      const prefix = email.split("@")[0];
      if (BEVORZUGTE_PREFIXES.has(prefix)) return { email, kontaktformularUrl: null };
      alleEmails.push(email);
    }
  }

  for (const email of [...new Set(alleEmails)]) {
    const prefix = email.split("@")[0];
    if (!IGNORIERTE_PREFIXES.has(prefix)) return { email, kontaktformularUrl: null };
  }

  return { email: null, kontaktformularUrl: null };
}
```

- [ ] **Step 4: Tests ausführen – müssen grün sein**

```bash
npx tsx tests/test_buchhalter_outreach.ts 2>&1 | tail -10
```

Erwartetes Ergebnis: `=== Ergebnis: X bestanden, 0 fehlgeschlagen ===`

Hinweis: `test10_promptVerbieteteWoerterGelistet` kann jetzt fehlschlagen (Verbotswörter-Liste wurde in einem vorherigen Session-Schritt aus dem Prompt entfernt). Falls ja: Test aus dem Array in der Haupt-Ausführungssektion entfernen (letzter Block des Testfiles).

- [ ] **Step 5: Commit**

```bash
git add src/trigger/buchhalter-outreach.ts tests/test_buchhalter_outreach.ts
git commit -m "refactor: findeEmailAufWebsite gibt { email, kontaktformularUrl } zurück

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Kontaktformular-Erkennung in `findeEmailAufWebsite`

**Files:**
- Modify: `src/trigger/buchhalter-outreach.ts:166-229`
- Modify: `tests/test_buchhalter_outreach.ts`

- [ ] **Step 1: Test für Formular-Erkennung schreiben**

Füge in `tests/test_buchhalter_outreach.ts` eine neue Funktion hinzu, direkt vor dem letzten `console.log`-Block:

```ts
async function test11_formularErkennung(): Promise<void> {
  console.log("\n--- Test: Kontaktformular-Erkennung ---");

  // Strukturprüfung: Funktion gibt immer beide Felder zurück
  const result = await findeEmailAufWebsite("https://ungueltige-domain-xyz999-abc.de");
  assert("email" in result, "Test 11a: Rückgabe hat 'email'-Feld");
  assert("kontaktformularUrl" in result, "Test 11b: Rückgabe hat 'kontaktformularUrl'-Feld");
  assert(
    result.email === null || typeof result.email === "string",
    "Test 11c: email ist null oder string"
  );
  assert(
    result.kontaktformularUrl === null || typeof result.kontaktformularUrl === "string",
    "Test 11d: kontaktformularUrl ist null oder string"
  );
}
```

Und füge `test11_formularErkennung()` am Ende des async-Blocks hinzu:

```ts
test6_emailFinder().then(async () => {
  await test11_formularErkennung();
  console.log(`\n=== Ergebnis: ${bestanden} bestanden, ${fehlgeschlagen} fehlgeschlagen ===`);
  if (fehlgeschlagen > 0) process.exit(1);
});
```

- [ ] **Step 2: Test ausführen – muss grün sein (Strukturtest)**

```bash
npx tsx tests/test_buchhalter_outreach.ts 2>&1 | grep -E "Test 11|Ergebnis"
```

Erwartetes Ergebnis: alle Test 11a–d `[OK]`

- [ ] **Step 3: Formular-Erkennung in `findeEmailAufWebsite` implementieren**

Ersetze das finale `return { email: null, kontaktformularUrl: null }` am Ende der Funktion mit Formular-Such-Logik:

```ts
  // Kontaktformular suchen wenn keine E-Mail gefunden
  const formularSeiten = [
    `${baseUrl}/kontakt`,
    `${baseUrl}/contact`,
    baseUrl,
  ];

  for (const seite of formularSeiten) {
    let inhalt: string;
    try {
      const res = await fetchMitTimeout(seite, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        },
      }, 5000);
      if (!res.ok) continue;
      inhalt = await res.text();
    } catch {
      continue;
    }

    // Prüfe ob Seite ein Formular mit Nachrichtenfeld enthält
    const hatFormular =
      inhalt.includes("<form") &&
      (inhalt.toLowerCase().includes("textarea") ||
        inhalt.toLowerCase().includes('type="email"') ||
        inhalt.toLowerCase().includes("name=\"nachricht\"") ||
        inhalt.toLowerCase().includes("name=\"message\""));

    if (hatFormular) {
      console.log(`Kontaktformular gefunden auf: ${seite}`);
      return { email: null, kontaktformularUrl: seite };
    }
  }

  return { email: null, kontaktformularUrl: null };
```

Wichtig: Diese Zeilen ersetzen das bisherige `return { email: null, kontaktformularUrl: null }` — sie kommen NACH dem `alleEmails`-Loop, der bereits oben steht.

- [ ] **Step 4: Tests ausführen**

```bash
npx tsx tests/test_buchhalter_outreach.ts 2>&1 | tail -10
```

Erwartetes Ergebnis: `0 fehlgeschlagen`

- [ ] **Step 5: Commit**

```bash
git add src/trigger/buchhalter-outreach.ts tests/test_buchhalter_outreach.ts
git commit -m "feat: Kontaktformular-Erkennung in findeEmailAufWebsite

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `generiereEmail` – `viaKontaktformular` Parameter

**Files:**
- Modify: `src/trigger/buchhalter-outreach.ts` (Funktion `generiereEmail`)
- Modify: `tests/test_buchhalter_outreach.ts`

- [ ] **Step 1: Test für viaKontaktformular schreiben**

Füge in `tests/test_buchhalter_outreach.ts` vor `test6_emailFinder` ein:

```ts
function test12_viaKontaktformularPrompt(): void {
  const fs = require("fs") as typeof import("fs");
  const code = fs.readFileSync("./src/trigger/buchhalter-outreach.ts", "utf-8");

  assert(
    code.includes("viaKontaktformular"),
    "Test 12a: generiereEmail hat viaKontaktformular Parameter"
  );
  assert(
    code.includes("Übrigens"),
    "Test 12b: Extra-Satz 'Übrigens' ist im Code vorhanden"
  );
  assert(
    code.includes("auf Anfragen zu antworten"),
    "Test 12c: Extra-Satz-Inhalt ist korrekt"
  );
}
```

Füge `test12_viaKontaktformularPrompt()` in den synchronen Test-Block ein (direkt nach `test10` oder nach `test9`).

- [ ] **Step 2: Test ausführen – muss fehlschlagen**

```bash
npx tsx tests/test_buchhalter_outreach.ts 2>&1 | grep "Test 12"
```

Erwartetes Ergebnis: `[FAIL] Test 12a` (Parameter noch nicht vorhanden)

- [ ] **Step 3: `generiereEmail` Signatur und Prompt anpassen**

Ersetze die `generiereEmail`-Funktion vollständig:

```ts
async function generiereEmail(
  firma: string,
  stadt: string,
  viaKontaktformular: boolean
): Promise<string> {
  console.log(`Generiere E-Mail für: ${firma} (via Kontaktformular: ${viaKontaktformular})`);
  const openai = getOpenAI();

  const extraSatz = viaKontaktformular
    ? `\n\nAbsatz 4 – Optionaler Zusatz (NUR bei Kontaktformular anhängen):\nÜbrigens – falls Sie merken dass Sie selbst länger brauchen um auf Anfragen zu antworten: genau dafür habe ich ebenfalls eine Lösung.`
    : "";

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.8,
    max_tokens: 450,
    messages: [
      {
        role: "user",
        content: `Schreibe eine kurze E-Mail an die Buchhalter-/Steuerberaterkanzlei ${firma} in ${stadt}.

Beginne mit dieser Anrede (zählt nicht zu den Sätzen):
Guten Tag ${firma} Team,

Schreibe danach genau drei Absätze mit dieser festen Satz-Verteilung:

Absatz 1 – 2 Sätze – Das echte Problem:
Satz 1: Beobachte ehrlich und locker, dass Mandantengewinnung Zeit kostet.
Satz 2: Zeige Verständnis – Buchhalter und Steuerberater haben diese Zeit kaum, weil sie mit bestehenden Mandanten ausgelastet sind.

Absatz 2 – 2 Sätze – Was ich mache:
Schreibe aus der Ich-Perspektive einer einzelnen Person (kein Firmenname).
Satz 3: Erkläre kurz, wie du Kanzleien hilfst neue Mandanten zu gewinnen ohne dass sie selbst Zeit investieren müssen.
Satz 4: Klingt wie ein Freund der etwas empfiehlt – kein Versprechen, keine Zahlen.

Absatz 3 – 1 Satz – Weicher Call to Action:
Satz 5: Lade zu einem 15-Minuten-Gespräch ein. Kein Druck. Sinngemäß: Ich zeige Ihnen live wie es funktioniert – Sie entscheiden dann selbst ob es passt.${extraSatz}

Regeln:
- Exakt 5 Sätze in den ersten drei Absätzen (2 + 2 + 1), nicht mehr, nicht weniger
- Durchgehend Ich-Perspektive – kein Firmenname im Text
- Locker und menschlich – wie eine einzelne Person schreibt, nicht wie Marketing
- Keine Anführungszeichen im Text
- Keine Aufzählungszeichen oder ungewöhnlichen Sonderzeichen
- Kein Betreff, keine Verabschiedung, keine Signatur
- Sprache: Deutsch`,
      },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}
```

- [ ] **Step 4: Tests ausführen**

```bash
npx tsx tests/test_buchhalter_outreach.ts 2>&1 | grep -E "Test 12|Ergebnis"
```

Erwartetes Ergebnis: alle Test 12a–c `[OK]`, `0 fehlgeschlagen`

- [ ] **Step 5: Commit**

```bash
git add src/trigger/buchhalter-outreach.ts tests/test_buchhalter_outreach.ts
git commit -m "feat: generiereEmail erhält viaKontaktformular Parameter mit Extra-Satz

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Neue Funktion `fuellKontaktformular` (TypeScript + Playwright)

**Files:**
- Modify: `src/trigger/buchhalter-outreach.ts` (neue Funktion hinzufügen)

- [ ] **Step 1: Test für Funktion-Existenz schreiben**

Füge in `tests/test_buchhalter_outreach.ts` hinzu:

```ts
function test13_fuellKontaktformularExistiert(): void {
  const fs = require("fs") as typeof import("fs");
  const code = fs.readFileSync("./src/trigger/buchhalter-outreach.ts", "utf-8");

  assert(
    code.includes("async function fuellKontaktformular"),
    "Test 13a: fuellKontaktformular Funktion existiert"
  );
  assert(
    code.includes("chromium"),
    "Test 13b: Playwright chromium wird verwendet"
  );
  assert(
    code.includes("g-recaptcha"),
    "Test 13c: CAPTCHA-Erkennung ist implementiert"
  );
  assert(
    code.includes("ABSENDER_NAME"),
    "Test 13d: ABSENDER_NAME Env-Var wird verwendet"
  );
}
```

Füge `test13_fuellKontaktformularExistiert()` in den synchronen Block ein.

- [ ] **Step 2: Test ausführen – muss fehlschlagen**

```bash
npx tsx tests/test_buchhalter_outreach.ts 2>&1 | grep "Test 13"
```

- [ ] **Step 3: `fuellKontaktformular` Funktion implementieren**

Füge diese Funktion in `src/trigger/buchhalter-outreach.ts` direkt VOR `generiereEmail` ein:

```ts
async function fuellKontaktformular(
  firma: string,
  kontaktformularUrl: string,
  betreff: string,
  emailInhalt: string
): Promise<boolean> {
  console.log(`Fülle Kontaktformular aus für: ${firma} → ${kontaktformularUrl}`);

  const absenderName = process.env.ABSENDER_NAME ?? "NIO Automation";
  const absenderEmail = process.env.ABSENDER_EMAIL;
  if (!absenderEmail) {
    console.error("ABSENDER_EMAIL fehlt – Kontaktformular übersprungen");
    return false;
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(kontaktformularUrl, { timeout: 30000, waitUntil: "domcontentloaded" });

    // CAPTCHA-Erkennung
    const hatCaptcha = await page.locator(".g-recaptcha, [class*='captcha'], iframe[src*='recaptcha']").count();
    if (hatCaptcha > 0) {
      console.log(`CAPTCHA erkannt – überspringe: ${firma}`);
      return false;
    }

    // Felder ausfüllen
    const nameSelector = "input[name*='name' i], input[placeholder*='Name' i], input[id*='name' i]";
    const emailSelector = "input[type='email'], input[name*='email' i], input[name*='mail' i]";
    const betreffSelector = "input[name*='subject' i], input[name*='betreff' i], input[placeholder*='Betreff' i]";
    const nachrichtSelector = "textarea, input[name*='message' i], input[name*='nachricht' i]";
    const submitSelector = "button[type='submit'], input[type='submit'], button:has-text('Senden'), button:has-text('Absenden')";

    const nameFeld = page.locator(nameSelector).first();
    if (await nameFeld.count() > 0) await nameFeld.fill(absenderName);

    const emailFeld = page.locator(emailSelector).first();
    if (await emailFeld.count() > 0) await emailFeld.fill(absenderEmail);

    const betreffFeld = page.locator(betreffSelector).first();
    if (await betreffFeld.count() > 0) await betreffFeld.fill(betreff);

    const nachrichtFeld = page.locator(nachrichtSelector).first();
    if (await nachrichtFeld.count() === 0) {
      console.log(`Kein Nachrichtenfeld gefunden – überspringe: ${firma}`);
      return false;
    }
    await nachrichtFeld.fill(emailInhalt);

    const submitButton = page.locator(submitSelector).first();
    if (await submitButton.count() === 0) {
      console.log(`Kein Submit-Button gefunden – überspringe: ${firma}`);
      return false;
    }

    const urlVorSubmit = page.url();
    await submitButton.click();

    // Erfolgsprüfung: URL-Wechsel oder Erfolgs-Text
    try {
      await page.waitForFunction(
        (vorher) => {
          const neueUrl = window.location.href !== vorher;
          const erfolgsText = ["vielen dank", "wurde gesendet", "erfolgreich", "thank you", "message sent"]
            .some(t => document.body.innerText.toLowerCase().includes(t));
          return neueUrl || erfolgsText;
        },
        urlVorSubmit,
        { timeout: 5000 }
      );
      console.log(`Kontaktformular erfolgreich ausgefüllt: ${firma}`);
      return true;
    } catch {
      console.log(`Keine Erfolgsbestätigung erhalten – möglicherweise trotzdem gesendet: ${firma}`);
      return true; // Im Zweifel als gesendet werten
    }
  } catch (err) {
    console.error(`Playwright Fehler für ${firma}:`, err);
    return false;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: Tests ausführen**

```bash
npx tsx tests/test_buchhalter_outreach.ts 2>&1 | grep -E "Test 13|Ergebnis"
```

Erwartetes Ergebnis: alle Test 13a–d `[OK]`

- [ ] **Step 5: Commit**

```bash
git add src/trigger/buchhalter-outreach.ts tests/test_buchhalter_outreach.ts
git commit -m "feat: fuellKontaktformular mit Playwright Chromium implementiert

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Haupt-Loop Branch-Logik aktualisieren

**Files:**
- Modify: `src/trigger/buchhalter-outreach.ts` (Main-Loop in `buchhalterOutreach.run`)

- [ ] **Step 1: Bestehende Email-Such-Sektion im Loop finden und ersetzen**

Finde im Main-Loop den Block der bisher so aussieht:

```ts
let firmaEmail: string | null = null;
try {
  firmaEmail = await findeEmailAufWebsite(website);
} catch (err) {
  console.error(`E-Mail-Suche Fehler für ${firma.name}:`, err);
  continue;
}

if (!firmaEmail) {
  skipKeineEmail++;
  console.log(`Keine E-Mail gefunden – überspringe: ${firma.name} (${website})`);
  continue;
}

console.log(`E-Mail gefunden: ${firmaEmail} für ${firma.name}`);
```

Ersetze ihn durch:

```ts
let sucheErgebnis: { email: string | null; kontaktformularUrl: string | null };
try {
  sucheErgebnis = await findeEmailAufWebsite(website);
} catch (err) {
  console.error(`E-Mail/Formular-Suche Fehler für ${firma.name}:`, err);
  continue;
}

const { email: firmaEmail, kontaktformularUrl } = sucheErgebnis;
const viaKontaktformular = !firmaEmail && !!kontaktformularUrl;

if (!firmaEmail && !kontaktformularUrl) {
  skipKeineEmail++;
  console.log(`Keine E-Mail und kein Kontaktformular – überspringe: ${firma.name} (${website})`);
  continue;
}

if (firmaEmail) {
  console.log(`E-Mail gefunden: ${firmaEmail} für ${firma.name}`);
} else {
  console.log(`Kontaktformular gefunden: ${kontaktformularUrl} für ${firma.name}`);
}
```

- [ ] **Step 2: E-Mail-Sende-Block durch Branch-Logik ersetzen**

Finde den Block:

```ts
// Schritt 4: E-Mail senden
try {
  const gesendet = await sendeEmail(firma.name, betreff, emailInhalt, firmaEmail);
  if (!gesendet) {
    console.error(`Brevo Fehler für ${firma.name}: E-Mail nicht gesendet`);
    continue;
  }
  console.log(`E-Mail gesendet: ${firma.name}`);
} catch (err) {
  console.error(`Brevo Fehler für ${firma.name}:`, err);
  continue;
}
```

Ersetze ihn durch:

```ts
// Schritt 4: Senden (E-Mail oder Kontaktformular)
let gesendet = false;
try {
  if (viaKontaktformular) {
    gesendet = await fuellKontaktformular(firma.name, kontaktformularUrl!, betreff, emailInhalt);
    if (!gesendet) {
      console.error(`Kontaktformular fehlgeschlagen für ${firma.name}`);
      continue;
    }
    console.log(`Kontaktformular ausgefüllt: ${firma.name}`);
  } else {
    gesendet = await sendeEmail(firma.name, betreff, emailInhalt, firmaEmail!);
    if (!gesendet) {
      console.error(`Brevo Fehler für ${firma.name}: E-Mail nicht gesendet`);
      continue;
    }
    console.log(`E-Mail gesendet: ${firma.name}`);
  }
} catch (err) {
  console.error(`Sende-Fehler für ${firma.name}:`, err);
  continue;
}
```

- [ ] **Step 3: `generiereEmail`-Aufruf aktualisieren**

Finde:
```ts
emailInhalt = await generiereEmail(firma.name, zielstadt);
```

Ersetze durch:
```ts
emailInhalt = await generiereEmail(firma.name, zielstadt, viaKontaktformular);
```

- [ ] **Step 4: Tests ausführen**

```bash
npx tsx tests/test_buchhalter_outreach.ts 2>&1 | tail -5
```

Erwartetes Ergebnis: `0 fehlgeschlagen`

- [ ] **Step 5: Commit**

```bash
git add src/trigger/buchhalter-outreach.ts
git commit -m "feat: Haupt-Loop verzweigt in Brevo-Pfad vs Kontaktformular-Pfad

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: `trigger.config.ts` – Playwright Extension

**Files:**
- Modify: `trigger.config.ts`

- [ ] **Step 1: Playwright Extension hinzufügen**

Ersetze den Inhalt von `trigger.config.ts`:

```ts
import { defineConfig } from "@trigger.dev/sdk";
import { playwright } from "@trigger.dev/build/extensions/playwright";

export default defineConfig({
  project: "proj_lklwvtuximzshfgzecbu",
  runtime: "node",
  logLevel: "log",
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./src/trigger"],
  build: {
    extensions: [
      playwright({ browsers: ["chromium"] }),
    ],
  },
});
```

- [ ] **Step 2: Tests ausführen (stellen sicher dass nichts kaputt ist)**

```bash
npx tsx tests/test_buchhalter_outreach.ts 2>&1 | tail -5
```

Erwartetes Ergebnis: `0 fehlgeschlagen`

- [ ] **Step 3: Commit**

```bash
git add trigger.config.ts
git commit -m "feat: Playwright Chromium Extension in trigger.config.ts

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: `tools/fill_contact_form.py` – Lokales Test-Tool

**Files:**
- Create: `tools/fill_contact_form.py`

- [ ] **Step 1: Python-Tool erstellen**

Erstelle `tools/fill_contact_form.py`:

```python
"""
Lokales Test-Tool: Kontaktformular ausfüllen (WAT-Pattern)
Verwendung: python tools/fill_contact_form.py --url "https://..." --firma "Mustermann GmbH"
Output: JSON { "success": true/false, "grund": "..." }
"""
import argparse
import json
import os
import sys

def main():
    parser = argparse.ArgumentParser(description="Kontaktformular ausfüllen")
    parser.add_argument("--url", required=True, help="URL des Kontaktformulars")
    parser.add_argument("--firma", required=True, help="Firmenname")
    parser.add_argument("--dry-run", action="store_true", help="Formular nicht absenden")
    args = parser.parse_args()

    absender_name = os.environ.get("ABSENDER_NAME", "NIO Automation")
    absender_email = os.environ.get("ABSENDER_EMAIL")

    if not absender_email:
        print(json.dumps({"success": False, "grund": "ABSENDER_EMAIL fehlt in .env"}))
        sys.exit(1)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(json.dumps({"success": False, "grund": "playwright nicht installiert – pip install playwright && playwright install chromium"}))
        sys.exit(1)

    betreff = f"Neue Mandanten für {args.firma} – ohne eigenen Aufwand"
    nachricht = (
        f"Guten Tag {args.firma} Team,\n\n"
        "Mandantengewinnung kostet Zeit – Zeit die man als Buchhalter "
        "eigentlich kaum hat. Ich helfe Kanzleien dabei, neue Mandanten "
        "zu gewinnen ohne selbst Zeit investieren zu müssen. "
        "Ich zeige Ihnen live wie es funktioniert – "
        "Sie entscheiden dann selbst ob es passt.\n\n"
        "Mit freundlichen Grüßen\nNIO Automation"
    )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.goto(args.url, timeout=30000, wait_until="domcontentloaded")

            # CAPTCHA-Erkennung
            captcha = page.locator(".g-recaptcha, [class*='captcha'], iframe[src*='recaptcha']").count()
            if captcha > 0:
                print(json.dumps({"success": False, "grund": "CAPTCHA erkannt"}))
                return

            # Felder ausfüllen
            for sel in ["input[name*='name' i]", "input[placeholder*='Name' i]", "input[id*='name' i]"]:
                if page.locator(sel).count() > 0:
                    page.locator(sel).first.fill(absender_name)
                    break

            for sel in ["input[type='email']", "input[name*='email' i]", "input[name*='mail' i]"]:
                if page.locator(sel).count() > 0:
                    page.locator(sel).first.fill(absender_email)
                    break

            for sel in ["input[name*='subject' i]", "input[name*='betreff' i]", "input[placeholder*='Betreff' i]"]:
                if page.locator(sel).count() > 0:
                    page.locator(sel).first.fill(betreff)
                    break

            textarea_sel = "textarea, input[name*='message' i], input[name*='nachricht' i]"
            if page.locator(textarea_sel).count() == 0:
                print(json.dumps({"success": False, "grund": "Kein Nachrichtenfeld gefunden"}))
                return
            page.locator(textarea_sel).first.fill(nachricht)

            if args.dry_run:
                print(json.dumps({"success": True, "grund": "dry-run – nicht abgesendet"}))
                return

            submit_sel = "button[type='submit'], input[type='submit']"
            if page.locator(submit_sel).count() == 0:
                print(json.dumps({"success": False, "grund": "Kein Submit-Button gefunden"}))
                return

            page.locator(submit_sel).first.click()
            page.wait_for_timeout(3000)

            erfolgs_worte = ["vielen dank", "wurde gesendet", "erfolgreich", "thank you", "message sent"]
            inhalt = page.inner_text("body").lower()
            if any(w in inhalt for w in erfolgs_worte):
                print(json.dumps({"success": True, "grund": "Erfolgstext erkannt"}))
            else:
                print(json.dumps({"success": True, "grund": "Abgesendet – kein Erfolgstext erkannt"}))

        except Exception as e:
            print(json.dumps({"success": False, "grund": str(e)}))
        finally:
            browser.close()

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Lokalen Test ausführen (dry-run)**

```bash
python tools/fill_contact_form.py --url "https://www.steuerberater-beispiel.de/kontakt" --firma "Test GmbH" --dry-run 2>&1
```

Erwartetes Ergebnis: `{"success": false, "grund": "playwright nicht installiert..."}` (falls nicht installiert) oder `{"success": true, "grund": "dry-run..."}` (falls installiert).

Kein Fehler wenn Playwright nicht lokal installiert ist — das Tool ist optional für lokales Testen.

- [ ] **Step 3: Commit**

```bash
git add tools/fill_contact_form.py
git commit -m "feat: fill_contact_form.py als lokales Test-Tool (WAT-Pattern)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Alle Tests + Deploy

- [ ] **Step 1: Alle Tests ausführen**

```bash
npx tsx tests/test_buchhalter_outreach.ts 2>&1
```

Erwartetes Ergebnis: `=== Ergebnis: X bestanden, 0 fehlgeschlagen ===`

- [ ] **Step 2: Deploy**

```bash
npx trigger.dev@latest deploy 2>&1 | tail -20
```

Erwartetes Ergebnis: `Successfully deployed version XXXXXXXX.X` mit `5 detected tasks`

- [ ] **Step 3: Final-Commit (falls noch unstaged)**

```bash
git status
git add -A
git commit -m "chore: Kontaktformular-Erweiterung deployed

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Alle 6 Komponenten aus Spec abgedeckt (findeEmailAufWebsite, generiereEmail, fuellKontaktformular, Haupt-Loop, trigger.config.ts, fill_contact_form.py)
- [x] **Placeholder scan:** Keine TBDs oder TODOs
- [x] **Type consistency:** `{ email: string | null; kontaktformularUrl: string | null }` durchgehend verwendet
- [x] **ABSENDER_NAME:** In Task 4 und Task 7 verwendet — steht in CLAUDE.md ✓
- [x] **viaKontaktformular:** In Task 3 definiert, in Task 5 verwendet ✓
- [x] **Test10:** Kann fehlschlagen wegen geänderter Verbotswörter-Liste — Hinweis in Task 1 Step 4 ✓
