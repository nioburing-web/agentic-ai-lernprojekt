# Design: Kontaktformular-Erweiterung

**Datum:** 2026-04-26
**Primäre Datei:** `src/trigger/buchhalter-outreach.ts`
**Neue Datei:** `tools/fill_contact_form.py`
**Geänderte Datei:** `trigger.config.ts`

## Ziel

Der Buchhalter-Outreach-Agent soll Firmen kontaktieren können, die keine direkte E-Mail-Adresse auf ihrer Website haben, aber ein Kontaktformular. Die Entscheidung (E-Mail vs. Formular) trifft der Haupt-Loop automatisch. Bei Kontaktformular-Nachrichten enthält der generierte Text einen zusätzlichen Satz der das Produkt mit der Situation verbindet.

## Architektur-Überblick

```
findeEmailAufWebsite()
  → { email: string | null, kontaktformularUrl: string | null }

Haupt-Loop:
  email vorhanden     → sendeEmail() via Brevo      | viaKontaktformular = false
  formular vorhanden  → fuellKontaktformular()       | viaKontaktformular = true
  beides nicht        → skip + log

generiereEmail(firma, stadt, viaKontaktformular)
  → viaKontaktformular = true: Extra-Satz nach CTA
```

## Komponenten

### 1. `findeEmailAufWebsite` — Rückgabetyp-Änderung

**Vorher:** `Promise<string | null>`
**Nachher:** `Promise<{ email: string | null; kontaktformularUrl: string | null }>`

**Erkennungslogik:**
- Direkte E-Mail: bestehende Logik (Priorität)
- Kontaktformular: Seiten `/kontakt`, `/contact`, Basis-URL werden auf `<form>`-Tags geprüft
- Priorität: E-Mail > Kontaktformular > null
- Wenn E-Mail gefunden → `kontaktformularUrl: null` (kein weiteres Scannen nötig)

### 2. `generiereEmail` — neuer Parameter

```ts
async function generiereEmail(
  firma: string,
  stadt: string,
  viaKontaktformular: boolean
): Promise<string>
```

**Extra-Satz (nur bei `viaKontaktformular = true`):**
> Übrigens – falls Sie merken dass Sie selbst länger brauchen um auf Anfragen zu antworten: genau dafür habe ich ebenfalls eine Lösung.

Der Satz wird im Prompt als separater Absatz nach dem CTA angewiesen, mit der Regel: "Nur anhängen wenn `viaKontaktformular = true`".

### 3. Neue Funktion `fuellKontaktformular` (TypeScript)

```ts
async function fuellKontaktformular(
  firma: string,
  kontaktformularUrl: string,
  betreff: string,
  emailInhalt: string
): Promise<boolean>
```

**Ablauf:**
1. Playwright Chromium öffnen (headless)
2. Zur Formular-URL navigieren (Timeout: 30s)
3. Felder erkennen und ausfüllen:
   - Name: `input[name*="name"], input[placeholder*="Name"]`
   - E-Mail: `input[type="email"], input[name*="email"], input[name*="mail"]`
   - Betreff: `input[name*="subject"], input[name*="betreff"], input[placeholder*="Betreff"]`
   - Nachricht: `textarea, input[name*="message"], input[name*="nachricht"]`
4. Absende-Button klicken: `button[type="submit"], input[type="submit"]`
5. Erfolgsprüfung: Timeout 5s auf URL-Wechsel oder Erfolgs-Text ("Vielen Dank", "wurde gesendet", "erfolgreich", "thank you", "message sent")
6. Browser schließen
7. CAPTCHA erkannt (`.g-recaptcha`, `[class*="captcha"]`, `iframe[src*="recaptcha"]`) → `false` zurückgeben + loggen

**Fehlerfälle:** Timeout, kein Formular gefunden, CAPTCHA → alle loggen, `false` zurückgeben, Loop läuft weiter.

**Absender-Daten aus Env-Vars:**
- Name: `process.env.ABSENDER_NAME`
- E-Mail: `process.env.ABSENDER_EMAIL`

### 4. Haupt-Loop — Branch-Logik

```ts
// Vorher:
const firmaEmail = await findeEmailAufWebsite(website);
if (!firmaEmail) { skip; continue; }

// Nachher:
const { email: firmaEmail, kontaktformularUrl } = await findeEmailAufWebsite(website);
const viaKontaktformular = !firmaEmail && !!kontaktformularUrl;

if (!firmaEmail && !kontaktformularUrl) {
  console.log(`Keine E-Mail und kein Formular – überspringe: ${firma.name}`);
  skipKeineEmail++;
  continue;
}

const emailInhalt = await generiereEmail(firma.name, zielstadt, viaKontaktformular);

if (viaKontaktformular) {
  // Playwright-Pfad
  const gesendet = await fuellKontaktformular(firma.name, kontaktformularUrl!, betreff, emailInhalt);
} else {
  // Brevo-Pfad (bestehend)
  const gesendet = await sendeEmail(firma.name, betreff, emailInhalt, firmaEmail!);
}
```

**Neuer Skip-Counter:** `skipKontaktformularFehler` für fehlgeschlagene Formular-Ausfüllungen.

### 5. `trigger.config.ts` — Playwright Extension

```ts
import { playwright } from "@trigger.dev/build/extensions/playwright";

build: {
  extensions: [
    playwright({ browsers: ["chromium"] }),
  ],
}
```

### 6. `tools/fill_contact_form.py` — Lokales Test-Tool

Python + `playwright-python`. Gleiche Logik wie TypeScript-Pendant. Verwendung:
```bash
python tools/fill_contact_form.py --url "https://..." --firma "Mustermann GmbH"
```

Gibt JSON-Output aus: `{ "success": true/false, "grund": "..." }`

## Env-Vars (alle bereits vorhanden)

| Variable | Verwendung |
|---|---|
| `ABSENDER_NAME` | Name im Kontaktformular |
| `ABSENDER_EMAIL` | E-Mail im Kontaktformular |
| `GOOGLE_MAPS_API_KEY` | Bereits vorhanden |

Keine neuen Env-Vars nötig.

## Entscheidungen

- **Playwright TypeScript** (nicht Python) für Production — einfachere Trigger.dev-Integration
- `fill_contact_form.py` nur für lokales Testen (WAT-Pattern)
- E-Mail hat Priorität über Kontaktformular — verhindert doppeltes Kontaktieren
- CAPTCHA → überspringen (kein Lösen), loggen
- `viaKontaktformular` wird automatisch gesetzt — kein manueller Parameter

## Bekannte Einschränkungen

- Nicht alle Formulare haben erkennbare Felder-Namen — unbekannte Formulare werden übersprungen
- CAPTCHAs werden nicht gelöst
- Formular-Erfolgserkennung ist heuristisch (URL-Wechsel oder Text-Match)

