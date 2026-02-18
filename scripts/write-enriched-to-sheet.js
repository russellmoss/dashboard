/**
 * Write enriched E-I data to Google Sheet using service account.
 * Requires: GOOGLE_SHEETS_CREDENTIALS_JSON or GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH
 *
 * Usage:
 *   From project root:  node scripts/write-enriched-to-sheet.js
 *   From scripts folder: node write-enriched-to-sheet.js
 */
const path = require('path');
const fs = require('fs');

async function main() {
  const { google } = require('googleapis');
  let auth;
  if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH) {
    const credPath = path.resolve(process.cwd(), process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH);
    auth = new google.auth.GoogleAuth({
      keyFile: credPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else if (process.env.GOOGLE_SHEETS_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS_JSON);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    console.error('Set GOOGLE_SHEETS_CREDENTIALS_JSON or GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH');
    process.exit(1);
  }
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = '12G9ogzalMDtJBVhOGqi4_zv9CrPLUodYe_3cNDowgx8';
  const sheetName = 'futureproof_FINAL_2056_participants';
  const enrichedPath = path.join(__dirname, 'enriched-eh.json');
  const data = JSON.parse(fs.readFileSync(enrichedPath, 'utf8'));
  const values = data.values;
  const range = `${sheetName}!E1`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
  console.log('Updated', values.length, 'rows at', range);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
