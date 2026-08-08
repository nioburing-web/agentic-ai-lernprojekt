# Design: Buchhalter Outreach E-Mail Prompt

**Datum:** 2026-04-25
**Datei:** `src/trigger/buchhalter-outreach.ts` → Funktion `generiereEmail()`

## Ziel

Den OpenAI-Prompt so umschreiben, dass die generierte E-Mail locker und menschlich klingt,
nach Nate Herks Prinzipien aufgebaut ist (ROI zeigen, Arzt-Prinzip, Value-Based CTA) und
wie eine einzelne Person schreibt – nicht wie ein Unternehmen.

## E-Mail-Struktur

```
Guten Tag [Firma] Team,         ← Anrede (zählt nicht zu den 5 Sätzen)

[Satz 1] Problem: Mandantengewinnung kostet Zeit           ┐ Absatz 1
[Satz 2] Konsequenz: diese Zeit haben Buchhalter nicht     ┘ (2 Sätze)

[Satz 3] Was ich mache – Ich-Perspektive, neuer Mandant ohne Aufwand  ┐ Absatz 2
[Satz 4] Konkretisierung – klingt wie Freund-Empfehlung               ┘ (2 Sätze)

[Satz 5] CTA: "Ich zeige Ihnen live wie es funktioniert –             Absatz 3
          Sie entscheiden dann selbst ob es passt."                    (1 Satz)

[Signatur – wird separat in sendeEmail() angehängt]
```

## Prompt-Regeln

- Satz-Verteilung **explizit**: 2 + 2 + 1 (Absatz 1 + 2 + 3)
- **Ich-Perspektive** durchgehend – kein Firmenname (NIO Automation nur in Signatur)
- Ton: locker, freundlich, menschlich – wie ein Freund der etwas Gutes empfiehlt
- Marketing-Sprache vermeiden – aber Wörter wie KI, automatisch dürfen verwendet werden wenn sie natürlich passen
- Keine Anführungszeichen im Text
- Keine Aufzählungszeichen oder Sonderzeichen
- Kein Betreff, keine Verabschiedung, keine Signatur

## Technische Parameter

- `model`: gpt-4o-mini
- `temperature`: 0.8
- `max_tokens`: 400

## Entscheidungen

- **Ansatz A (strikte Satz-Verteilung)** gewählt: konsistente Länge wichtiger als kreative Freiheit
- Keine harte Verbotsliste: Wörter dürfen verwendet werden wenn sie im Kontext natürlich klingen
- Anrede zählt nicht zu den 5 Sätzen
