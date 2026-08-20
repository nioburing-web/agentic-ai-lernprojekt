// Einmaliger Rueckwaertstest: Adress-Filter gegen die gesamte Outreach-Queue.
// Liest nur, schreibt nichts. Ausfuehren: npx tsx tests/backtest_adresse.ts
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { adresseIstUnbrauchbar } from "../src/trigger/nacht-recherche";

async function main() {
  const auth = new GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = googleSheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID as string,
    range: "Outreach Queue!A:F",
  });
  const rows = res.data.values ?? [];
  let geprueft = 0;
  const treffer: { zeile: number; email: string; status: string; grund: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r[0] !== "EMAIL") continue;
    const email = String(r[3] ?? "");
    if (!email) continue;
    geprueft++;
    const grund = adresseIstUnbrauchbar(email);
    if (grund) treffer.push({ zeile: i + 1, email, status: String(r[5] ?? ""), grund });
  }
  console.log(`Geprueft: ${geprueft} EMAIL-Zeilen`);
  console.log(`Wuerde verworfen: ${treffer.length} (${((treffer.length / geprueft) * 100).toFixed(1)} %)\n`);
  for (const t of treffer) {
    console.log(`Z${t.zeile}\t${t.status.padEnd(14)}\t${t.email.padEnd(42)}\t${t.grund}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
