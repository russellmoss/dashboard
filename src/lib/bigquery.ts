import { BigQuery, Query } from '@google-cloud/bigquery';

let bigqueryClient: BigQuery | null = null;

export function getBigQueryClient(): BigQuery {
  if (bigqueryClient) return bigqueryClient;

  const projectId = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';

  // OAuth scopes needed for accessing Google Drive external tables
  const scopes = [
    'https://www.googleapis.com/auth/bigquery',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/drive.readonly',
  ];

  // For Vercel deployment: use JSON credentials from env var
  // IMPORTANT: GOOGLE_APPLICATION_CREDENTIALS must NOT be set in Vercel
  // because Google Cloud libraries will try to use it as a file path
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
      // Temporarily unset GOOGLE_APPLICATION_CREDENTIALS to prevent auto-detection
      const originalCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      
      // Parse the JSON string (it should be a single-line JSON string)
      let jsonString = typeof process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON === 'string'
        ? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
        : JSON.stringify(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
      
      // Fix common issues: replace actual newlines in private_key with \n
      // This handles cases where JSON was copied with real newlines instead of escaped ones
      // Use a more robust regex that handles multi-line private_key values
      jsonString = jsonString.replace(/"private_key"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/gs, (match) => {
        // Extract the key content (everything between the quotes)
        const keyMatch = match.match(/"private_key"\s*:\s*"([\s\S]*?)"/);
        if (keyMatch && keyMatch[1]) {
          // Replace actual newlines and carriage returns with \n escape sequences
          const fixedKey = keyMatch[1]
            .replace(/\r\n/g, '\\n')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\n');
          return `"private_key":"${fixedKey}"`;
        }
        return match;
      });
      
      const credentials = JSON.parse(jsonString);
      
      // Ensure private_key has proper newlines for PEM format
      if (credentials.private_key && typeof credentials.private_key === 'string') {
        credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
      }
      
      bigqueryClient = new BigQuery({
        projectId,
        credentials,
        scopes,
      });
      
      // Restore original if it existed (for local dev compatibility)
      if (originalCredentials) {
        process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCredentials;
      }
    } catch (error) {
      console.error('[BigQuery] Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON format: ${errorMessage}. Ensure the JSON is valid and private_key uses \\n for newlines.`);
    }
  } 
  // For local development: use file path
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    bigqueryClient = new BigQuery({
      projectId,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes,
    });
  } 
  else {
    throw new Error('No BigQuery credentials configured. Set GOOGLE_APPLICATION_CREDENTIALS_JSON (Vercel) or GOOGLE_APPLICATION_CREDENTIALS (local).');
  }

  return bigqueryClient;
}

export async function runQuery<T>(query: string, params?: Record<string, any>): Promise<T[]> {
  const client = getBigQueryClient();
  const options: Query = { query, params: params || {} };
  const [rows] = await client.query(options);
  return rows as T[];
}

export interface QueryParams {
  conditions: string[];
  params: Record<string, any>;
}

export function buildQueryParams(filters: {
  startDate?: string;
  endDate?: string;
  channel?: string | null;
  source?: string | null;
  sga?: string | null;
  sgm?: string | null;
}): QueryParams {
  const conditions: string[] = [];
  const params: Record<string, any> = {};

  if (filters.startDate) {
    conditions.push('FilterDate >= TIMESTAMP(@startDate)');
    params.startDate = filters.startDate;
  }

  if (filters.endDate) {
    conditions.push('FilterDate <= TIMESTAMP(@endDate)');
    params.endDate = filters.endDate + ' 23:59:59';
  }

  if (filters.channel) {
    conditions.push('Channel_Grouping_Name = @channel');
    params.channel = filters.channel;
  }

  if (filters.source) {
    conditions.push('Original_source = @source');
    params.source = filters.source;
  }

  if (filters.sga) {
    conditions.push('SGA_Owner_Name__c = @sga');
    params.sga = filters.sga;
  }

  if (filters.sgm) {
    conditions.push('SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }

  return { conditions, params };
}
