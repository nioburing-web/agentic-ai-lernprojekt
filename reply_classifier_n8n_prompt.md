# n8n Reply-Classifier Workflow – Prompt für JSON-Generator

Erstelle einen vollständigen n8n Workflow als JSON mit exakt folgenden Nodes in dieser Reihenfolge.
Das JSON muss direkt in n8n importierbar sein (Format: `{ "name": "...", "nodes": [...], "connections": {...} }`).

---

## Workflow-Name
`Reply Classifier – Bauträger Antworten`

---

## Node 1: Schedule Trigger
- **Typ:** `n8n-nodes-base.scheduleTrigger`
- **Name:** `Täglich 10:00 Uhr`
- **Cron:** `0 10 * * *` (jeden Tag um 10:00 Uhr)
- **Position:** [250, 300]

---

## Node 2: Gmail – Ungelesene Antworten lesen
- **Typ:** `n8n-nodes-base.gmail`
- **Name:** `Gmail – Antworten lesen`
- **Operation:** `getAll`
- **Resource:** `message`
- **Filter:** `q: "is:unread subject:Re:"`
- **Limit:** 50
- **Position:** [500, 300]

---

## Node 3: IF – Keine E-Mails vorhanden
- **Typ:** `n8n-nodes-base.if`
- **Name:** `IF – E-Mails vorhanden?`
- **Bedingung:** `{{ $json.id }}` ist nicht leer (`isNotEmpty`)
- **True-Pfad:** weiter zu Node 4
- **False-Pfad:** STOP (kein weiterer Node)
- **Position:** [750, 300]

---

## Node 4: Split Out – Jede E-Mail einzeln verarbeiten
- **Typ:** `n8n-nodes-base.splitOut`
- **Name:** `Split Out – Einzelne E-Mails`
- **Field To Split Out:** leer (Standard – jedes Item einzeln)
- **Position:** [1000, 300]

---

## Node 5: Edit Fields – Felder extrahieren
- **Typ:** `n8n-nodes-base.set`
- **Name:** `Edit Fields – Firma, Snippet, ID`
- **Felder:**
  - `firma`: `{{ $json.payload.headers.find(h => h.name === 'Subject')?.value?.split('–')[1]?.trim() ?? $json.payload.headers.find(h => h.name === 'Subject')?.value }}`
  - `snippet`: `{{ $json.snippet }}`
  - `messageId`: `{{ $json.id }}`
- **Mode:** `keepAllExistingFields: false` (nur diese drei Felder ausgeben)
- **Position:** [1250, 300]

---

## Node 6: OpenAI – E-Mail klassifizieren
- **Typ:** `@n8n/n8n-nodes-langchain.openAi`
- **Name:** `OpenAI – Klassifizieren`
- **Resource:** `text`
- **Operation:** `complete` (Chat Completion)
- **Model:** `gpt-4o-mini`
- **Max Tokens:** 10
- **Temperature:** 0
- **System Prompt:** (leer)
- **User Message:**
```
Klassifiziere diese E-Mail-Antwort in genau ein Wort: INTERESSIERT / ABGELEHNT / RÜCKFRAGE / ABWESEND
Fokussiere dich nur auf den ersten Absatz.
Text: {{ $json.snippet }}
```
- **API Key:** `OPENAI_API_KEY` (als Credential-Platzhalter)
- **Position:** [1500, 300]

---

## Node 7: Switch – Nach Kategorie verzweigen
- **Typ:** `n8n-nodes-base.switch`
- **Name:** `Switch – Kategorie`
- **Value:** `{{ $json.message.content.trim() }}`
- **Regeln (4 Outputs):**
  - Output 0: `equals` → `INTERESSIERT`
  - Output 1: `equals` → `ABGELEHNT`
  - Output 2: `equals` → `RÜCKFRAGE`
  - Output 3: `equals` → `ABWESEND`
- **Fallback:** letzten Output verwenden
- **Position:** [1750, 300]

---

## Node 8a: Google Sheets – Update bei INTERESSIERT
- **Typ:** `n8n-nodes-base.googleSheets`
- **Name:** `Sheets – INTERESSIERT`
- **Operation:** `update`
- **Sheet ID:** `GOOGLE_SHEET_ID`
- **Sheet Name:** `Bauträger`
- **Column to Match On:** `Firma`
- **Felder:**
  - `Firma`: `{{ $('Edit Fields – Firma, Snippet, ID').item.json.firma.trim() }}`
  - `Status`: `INTERESSIERT`
  - `Datum`: `{{ new Date().toISOString().split('T')[0] }}`
- **Position:** [2000, 100]

---

## Node 8b: Google Sheets – Update bei ABGELEHNT
- **Typ:** `n8n-nodes-base.googleSheets`
- **Name:** `Sheets – ABGELEHNT`
- **Operation:** `update`
- **Sheet ID:** `GOOGLE_SHEET_ID`
- **Sheet Name:** `Bauträger`
- **Column to Match On:** `Firma`
- **Felder:**
  - `Firma`: `{{ $('Edit Fields – Firma, Snippet, ID').item.json.firma.trim() }}`
  - `Status`: `ABGELEHNT`
  - `Datum`: `{{ new Date().toISOString().split('T')[0] }}`
- **Position:** [2000, 300]

---

## Node 8c: Google Sheets – Update bei RÜCKFRAGE
- **Typ:** `n8n-nodes-base.googleSheets`
- **Name:** `Sheets – RÜCKFRAGE`
- **Operation:** `update`
- **Sheet ID:** `GOOGLE_SHEET_ID`
- **Sheet Name:** `Bauträger`
- **Column to Match On:** `Firma`
- **Felder:**
  - `Firma`: `{{ $('Edit Fields – Firma, Snippet, ID').item.json.firma.trim() }}`
  - `Status`: `RÜCKFRAGE`
  - `Datum`: `{{ new Date().toISOString().split('T')[0] }}`
- **Position:** [2000, 500]

---

## Node 8d: Google Sheets – Update bei ABWESEND
- **Typ:** `n8n-nodes-base.googleSheets`
- **Name:** `Sheets – ABWESEND`
- **Operation:** `update`
- **Sheet ID:** `GOOGLE_SHEET_ID`
- **Sheet Name:** `Bauträger`
- **Column to Match On:** `Firma`
- **Felder:**
  - `Firma`: `{{ $('Edit Fields – Firma, Snippet, ID').item.json.firma.trim() }}`
  - `Status`: `ABWESEND`
  - `Datum`: `{{ new Date().toISOString().split('T')[0] }}`
- **Position:** [2000, 700]

---

## Node 9: Brevo HTTP Request – Nur bei INTERESSIERT
- **Typ:** `n8n-nodes-base.httpRequest`
- **Name:** `Brevo – Benachrichtigung senden`
- **Methode:** `POST`
- **URL:** `https://api.brevo.com/v3/smtp/email`
- **Headers:**
  - `api-key`: `BREVO_API_KEY`
  - `Content-Type`: `application/json`
- **Body (JSON.stringify):**
```json
{
  "sender": { "name": "NIO Automation", "email": "anfragen@nio-automation.de" },
  "to": [{ "email": "nioburing@gmail.com" }],
  "subject": "Bauträger zeigt Interesse – manuelle Aktion nötig",
  "textContent": "Firma: {{ $('Edit Fields – Firma, Snippet, ID').item.json.firma.trim() }}\n\nAntwort:\n{{ $('Edit Fields – Firma, Snippet, ID').item.json.snippet }}\n\nBitte manuell prüfen und Termin vereinbaren."
}
```
- **Body Type:** `raw` mit `JSON.stringify(...)` wrapper
- **Kommt nach:** Node 8a (INTERESSIERT-Pfad)
- **Position:** [2250, 100]

---

## Node 10: Gmail – Als gelesen markieren
- **Typ:** `n8n-nodes-base.gmail`
- **Name:** `Gmail – Als gelesen markieren`
- **Operation:** `markAsRead`
- **Resource:** `message`
- **Message ID:** `{{ $('Edit Fields – Firma, Snippet, ID').item.json.messageId }}`
- **Nach jedem Sheets-Update-Node verbinden** (alle 4 Pfade münden hier)
- **Position:** [2500, 400]

---

## Verbindungen (connections)

```
Täglich 10:00 Uhr           → Gmail – Antworten lesen
Gmail – Antworten lesen     → IF – E-Mails vorhanden?
IF (true)                   → Split Out – Einzelne E-Mails
Split Out                   → Edit Fields – Firma, Snippet, ID
Edit Fields                 → OpenAI – Klassifizieren
OpenAI                      → Switch – Kategorie
Switch Output 0 (INTERESSIERT) → Sheets – INTERESSIERT
Switch Output 1 (ABGELEHNT)    → Sheets – ABGELEHNT
Switch Output 2 (RÜCKFRAGE)    → Sheets – RÜCKFRAGE
Switch Output 3 (ABWESEND)     → Sheets – ABWESEND
Sheets – INTERESSIERT       → Brevo – Benachrichtigung senden
Brevo                       → Gmail – Als gelesen markieren
Sheets – ABGELEHNT          → Gmail – Als gelesen markieren
Sheets – RÜCKFRAGE          → Gmail – Als gelesen markieren
Sheets – ABWESEND           → Gmail – Als gelesen markieren
```

---

## Wichtige Regeln für die JSON-Generierung

1. **API Keys als Platzhalter-Strings:** `BREVO_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_SHEET_ID` – nie echte Werte
2. **Brevo Body:** Immer mit `JSON.stringify()` wrappen im `body`-Feld des HTTP-Request-Nodes
3. **Switch Rule:** `$json.message.content.trim()` – nicht `$json.message.content` direkt (ohne trim schlägt der Vergleich fehl)
4. **Firma immer mit `.trim()`:** `$('Edit Fields – Firma, Snippet, ID').item.json.firma.trim()`
5. **Node-IDs:** Eindeutige UUIDs für jeden Node (`"id": "uuid-..."`)
6. **typeVersion:** Aktuelle n8n-Versionen verwenden (scheduleTrigger: 1.1, gmail: 2.1, set: 3.4, googleSheets: 4.4, httpRequest: 4.2, switch: 3.2, splitOut: 1.0, if: 2.2)
7. **Kategorie-Labels im Python-Code heißen anders** – die n8n-Version verwendet die deutschen Varianten: `INTERESSIERT` (nicht INTERESSE), `ABGELEHNT` (nicht ABLEHNUNG), `RÜCKFRAGE` (nicht FRAGE), `ABWESEND` (nicht ABWESENHEIT)
