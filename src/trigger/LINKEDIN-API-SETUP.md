# LinkedIn Nacht-Posting über die offizielle API

Ersetzt das browserbasierte `linkedin-morgen-posting` (scheitert serverseitig an
LinkedIns Bot-Schutz). Postet zuverlässig aus der Cloud, ohne Browser, ohne PC.

## Einmaliges Setup (~10 Min, nur du)

### 1. LinkedIn-App anlegen
- https://www.linkedin.com/developers/apps → **Create app**
- Firmenseite: **NIO Automation** verknüpfen, Logo hochladen, erstellen.

### 2. Produkte aktivieren (Tab "Products")
- **Share on LinkedIn** hinzufügen (gibt Scope `w_member_social`)
- **Sign In with LinkedIn using OpenID Connect** hinzufügen (gibt `openid`, `profile`)
- Beide sind self-serve, sofort verfügbar.

### 3. Redirect-URL eintragen (Tab "Auth")
- Unter **OAuth 2.0 settings** → Redirect URLs:
  `http://localhost:8765/callback`
- **Client ID** und **Client Secret** notieren.

### 4. Token holen (lokal, im Projektordner)
```powershell
$env:LINKEDIN_CLIENT_ID="<deine Client ID>"
$env:LINKEDIN_CLIENT_SECRET="<dein Client Secret>"
node tools/linkedin-oauth.mjs
```
Browser öffnet sich → **Zulassen** klicken. Das Tool gibt aus:
- `LINKEDIN_ACCESS_TOKEN` (60 Tage gültig)
- `LINKEDIN_AUTHOR_URN`  (z.B. `urn:li:person:xxxx`)

### 5. In Trigger.dev eintragen
Trigger.dev → Projekt → **Environment Variables** (prod) → neu:
- `LINKEDIN_ACCESS_TOKEN` = <Token aus Schritt 4>
- `LINKEDIN_AUTHOR_URN`   = <URN aus Schritt 4>

(`GOOGLE_SERVICE_ACCOUNT_JSON`, `BREVO_API_KEY`, `ABSENDER_EMAIL` sind schon gesetzt.)

### 6. Deploy + altes Task entfernen
- `npx trigger.dev@latest deploy` (oder ich mache es)
- Danach läuft `linkedin-api-posting` täglich 08:00 (Di–Sa).
- Altes `linkedin-morgen-posting` entfernen/deaktivieren, damit es nicht doppelt versucht.

## Wartung
- Token läuft nach **60 Tagen** ab → dann Schritt 4 + 5 wiederholen.
  (Programmatische Refresh-Tokens gibt LinkedIn nur für Partner frei.)
- Bei 401 schickt der Task eine Fehler-Mail mit genau diesem Hinweis.

## Aktueller Stand
- Text-Posts: fertig.
- Bild-Posts: brauchen zusätzlich die Images-API (Upload → Image-URN). Nachrüstbar,
  aktuell laufen die Posts text-only (wie der manuelle Post vom 12.06.).
