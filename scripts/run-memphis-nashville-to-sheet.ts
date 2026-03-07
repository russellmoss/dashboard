/**
 * Run Memphis & Nashville advisor list SQL (with Phase 5 SFDC enrichment) and load results into a Google Sheet.
 *
 * Prereqs:
 *   - BigQuery: GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_JSON (savvy-gtm-analytics)
 *   - Sheets: GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH or GOOGLE_SHEETS_CREDENTIALS_JSON (or same as BQ if key has spreadsheets scope)
 *
 * Usage:
 *   # Use an existing sheet (create one in Google Drive, share with the service account email, then set ID):
 *   set SPREADSHEET_ID=your_sheet_id_here
 *   npx tsx scripts/run-memphis-nashville-to-sheet.ts
 *
 *   # Optional: override SQL file or sheet tab name
 *   set MEMPHIS_NASHVILLE_SQL_PATH=C:\path\to\memphis_and_nashville_list.sql
 *   set SHEET_TAB_NAME=Advisors
 *   npx tsx scripts/run-memphis-nashville-to-sheet.ts
 *
 * The script writes headers in row 1 and data starting at row 2 on the given sheet tab (default "Sheet1").
 */

import * as fs from 'fs';
import * as path from 'path';
import { getBigQueryClient } from '../src/lib/bigquery';
import { google } from 'googleapis';

const DEFAULT_SHEET_TAB = 'Sheet1';
const SQL_FILENAME = 'memphis_and_nashville_list.sql';

function getSqlPath(): string {
  const fromEnv = process.env.MEMPHIS_NASHVILLE_SQL_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const fromCwd = path.join(process.cwd(), SQL_FILENAME);
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromScriptDir = path.join(__dirname, '..', SQL_FILENAME);
  if (fs.existsSync(fromScriptDir)) return fromScriptDir;
  throw new Error(
    `SQL file "${SQL_FILENAME}" not found. Set MEMPHIS_NASHVILLE_SQL_PATH or run from Dashboard root with file in project.`
  );
}

function getSheetsAuth() {
  if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH) {
    const credPath = path.resolve(process.cwd(), process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH);
    return new google.auth.GoogleAuth({
      keyFile: credPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  if (process.env.GOOGLE_SHEETS_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS_JSON);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  throw new Error(
    'Set GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH, GOOGLE_SHEETS_CREDENTIALS_JSON, or GOOGLE_APPLICATION_CREDENTIALS for Sheets write.'
  );
}

function rowToValues(row: Record<string, unknown>): unknown[] {
  return Object.values(row).map((v) => (v == null ? '' : v));
}

async function main() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    console.error('SPREADSHEET_ID is required. Create a Google Sheet, share it with your service account, and set SPREADSHEET_ID to the sheet ID (from the URL: .../d/<ID>/edit).');
    process.exit(1);
  }

  const sqlPath = getSqlPath();
  const sql = fs.readFileSync(sqlPath, 'utf-8').trim();
  const sheetTabName = process.env.SHEET_TAB_NAME || DEFAULT_SHEET_TAB;

  console.log('Running BigQuery (Memphis & Nashville list with SFDC enrichment)...');
  const client = getBigQueryClient();
  const [rows] = await client.query({ query: sql });
  const dataRows = rows as Record<string, unknown>[];

  if (dataRows.length === 0) {
    console.log('No rows returned. Exiting without writing to Sheets.');
    return;
  }

  const headers = Object.keys(dataRows[0]);
  const values: unknown[][] = [headers, ...dataRows.map(rowToValues)];

  console.log('Got', dataRows.length, 'rows. Writing to Google Sheet...');
  const auth = getSheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const range = `${sheetTabName}!A1`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  console.log('Done. Updated', values.length, 'rows at', range);
  console.log('Sheet URL: https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/edit');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
