// src/lib/sheets/gc-sheets-reader.ts
import { google, sheets_v4 } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@/lib/logger';

// Simple rate limiter: max 50 requests per 60 seconds (leaving headroom below 60 limit)
const REQUEST_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 50;
let requestTimestamps: number[] = [];

async function rateLimit(): Promise<void> {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(t => now - t < REQUEST_WINDOW_MS);
  if (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldestInWindow = requestTimestamps[0];
    const waitMs = REQUEST_WINDOW_MS - (now - oldestInWindow) + 100;
    logger.warn(`[GC Sheets] Rate limit approaching, waiting ${waitMs}ms`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  requestTimestamps.push(Date.now());
}

function getAuthClient() {
  let credentials: any;

  // Try environment variable first (Vercel deployment)
  if (process.env.GOOGLE_SHEETS_CREDENTIALS_JSON) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS_JSON);
    } catch (error) {
      throw new Error(
        'Failed to parse GOOGLE_SHEETS_CREDENTIALS_JSON: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    }
  }
  // Fall back to file (local development)
  else if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH) {
    const credPath = path.resolve(
      process.cwd(),
      process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH
    );
    if (fs.existsSync(credPath)) {
      try {
        credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      } catch (error) {
        throw new Error(
          `Failed to read credentials from ${credPath}: ` +
            (error instanceof Error ? error.message : 'Unknown error')
        );
      }
    } else {
      throw new Error(`Credentials file not found at: ${credPath}`);
    }
  } else {
    throw new Error(
      'Google Sheets credentials not found. Set GOOGLE_SHEETS_CREDENTIALS_JSON (Vercel) or GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH (local)'
    );
  }

  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error('Invalid credentials: missing client_email or private_key');
  }

  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

let sheetsClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (!sheetsClient) {
    const auth = getAuthClient();
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

export type ValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';

/**
 * Read values from a single range in a Google Sheet.
 */
export async function getValues(
  spreadsheetId: string,
  range: string,
  valueRenderOption: ValueRenderOption = 'UNFORMATTED_VALUE'
): Promise<any[][] | null> {
  await rateLimit();
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption,
    });
    return response.data.values || null;
  } catch (error: any) {
    logger.error(`[GC Sheets] getValues failed for ${range}:`, error.message);
    throw error;
  }
}

/**
 * Read values from multiple ranges in a single API call.
 */
export async function batchGetValues(
  spreadsheetId: string,
  ranges: string[],
  valueRenderOption: ValueRenderOption = 'UNFORMATTED_VALUE'
): Promise<Map<string, any[][] | null>> {
  await rateLimit();
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
      valueRenderOption,
    });
    const result = new Map<string, any[][] | null>();
    response.data.valueRanges?.forEach((vr, i) => {
      result.set(ranges[i], vr.values || null);
    });
    return result;
  } catch (error: any) {
    logger.error(`[GC Sheets] batchGetValues failed:`, error.message);
    throw error;
  }
}

/**
 * Get spreadsheet metadata (tab names, sheet IDs, etc.)
 */
export async function getMetadata(
  spreadsheetId: string
): Promise<{ title: string; sheets: { title: string; sheetId: number; rowCount: number; colCount: number }[] }> {
  await rateLimit();
  try {
    const sheets = getSheetsClient();
    const response = await sheets.spreadsheets.get({ spreadsheetId });
    return {
      title: response.data.properties?.title || 'Unknown',
      sheets:
        response.data.sheets?.map(s => ({
          title: s.properties?.title || 'Unknown',
          sheetId: s.properties?.sheetId || 0,
          rowCount: s.properties?.gridProperties?.rowCount || 0,
          colCount: s.properties?.gridProperties?.columnCount || 0,
        })) || [],
    };
  } catch (error: any) {
    logger.error(`[GC Sheets] getMetadata failed:`, error.message);
    throw error;
  }
}
