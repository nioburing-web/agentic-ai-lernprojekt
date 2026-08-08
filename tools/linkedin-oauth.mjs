// Einmaliges OAuth-Tool: holt einen LinkedIn-Member-Access-Token (Scope
// w_member_social) + die Author-URN für die offizielle Posts-API.
//
// Voraussetzung (im LinkedIn Developer Portal, App "Auth"-Tab):
//   - Produkte aktiviert: "Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect"
//   - Redirect-URL eingetragen:  http://localhost:8765/callback
//
// Aufruf (PowerShell, im Projektordner):
//   $env:LINKEDIN_CLIENT_ID="xxxx"; $env:LINKEDIN_CLIENT_SECRET="yyyy"; node tools/linkedin-oauth.mjs
//
// Das Tool öffnet den Browser, du klickst "Zulassen", und es gibt
// ACCESS_TOKEN + AUTHOR_URN aus (und speichert sie in .linkedin-token.json).
// Diese zwei Werte dann in Trigger.dev als LINKEDIN_ACCESS_TOKEN und
// LINKEDIN_AUTHOR_URN eintragen.

import http from "node:http";
import { exec } from "node:child_process";
import fs from "node:fs";
import { randomBytes } from "node:crypto";

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const PORT = Number(process.env.LINKEDIN_OAUTH_PORT ?? 8765);
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI ?? `http://localhost:${PORT}/callback`;
const SCOPE = "openid profile w_member_social";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("FEHLER: LINKEDIN_CLIENT_ID und LINKEDIN_CLIENT_SECRET als Env-Vars setzen.");
  process.exit(1);
}

const state = randomBytes(8).toString("hex");
const authUrl =
  "https://www.linkedin.com/oauth/v2/authorization?" +
  new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state,
    scope: SCOPE,
  }).toString();

async function exchangeCode(code) {
  const resp = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Token-Exchange ${resp.status}: ${JSON.stringify(data)}`);
  return data;
}

async function fetchAuthorUrn(accessToken) {
  const resp = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`userinfo ${resp.status}: ${JSON.stringify(data)}`);
  return { urn: `urn:li:person:${data.sub}`, name: data.name };
}

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/callback")) {
    res.writeHead(404).end();
    return;
  }
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`OAuth-Fehler: ${error} — ${url.searchParams.get("error_description")}`);
    console.error("OAuth abgebrochen:", error);
    server.close();
    return;
  }
  if (returnedState !== state) {
    res.writeHead(400).end("State stimmt nicht (CSRF-Schutz).");
    server.close();
    return;
  }

  try {
    const token = await exchangeCode(code);
    const author = await fetchAuthorUrn(token.access_token);
    const out = {
      access_token: token.access_token,
      expires_in_days: Math.round((token.expires_in ?? 0) / 86400),
      refresh_token: token.refresh_token ?? null,
      author_urn: author.urn,
      name: author.name,
      scope: token.scope,
      created_at: new Date().toISOString(),
    };
    fs.writeFileSync(".linkedin-token.json", JSON.stringify(out, null, 2));

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>Fertig. Du kannst dieses Fenster schließen und zum Terminal zurück.</h2>");

    console.log("\n=== ERFOLG ===");
    console.log("Name:        ", author.name);
    console.log("AUTHOR_URN:  ", author.urn);
    console.log("Token gültig:", out.expires_in_days, "Tage");
    console.log("Scope:       ", token.scope);
    console.log("\nIn Trigger.dev als Environment Variables eintragen:");
    console.log("  LINKEDIN_ACCESS_TOKEN =", token.access_token);
    console.log("  LINKEDIN_AUTHOR_URN   =", author.urn);
    console.log("\n(auch gespeichert in .linkedin-token.json — NICHT committen)");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Fehler beim Token-Austausch: " + String(e));
    console.error(e);
  } finally {
    setTimeout(() => server.close(), 500);
  }
});

server.listen(PORT, () => {
  console.log(`Lokaler OAuth-Server läuft auf ${REDIRECT_URI}`);
  console.log("Öffne Browser für LinkedIn-Login...\n");
  console.log("Falls der Browser nicht aufgeht, öffne manuell:\n" + authUrl + "\n");
  exec(`start "" "${authUrl}"`, (err) => {
    if (err) console.log("(Browser konnte nicht automatisch geöffnet werden — URL oben manuell öffnen.)");
  });
});
