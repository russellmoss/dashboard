import { BigQuery, Query } from '@google-cloud/bigquery';

let bigqueryClient: BigQuery | null = null;

export function getBigQueryClient(): BigQuery {
  if (bigqueryClient) return bigqueryClient;

  const projectId = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';

  // For Vercel deployment: use JSON credentials from env var
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    bigqueryClient = new BigQuery({
      projectId,
      credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
    });
  } 
  // For local development: use file path
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    bigqueryClient = new BigQuery({
      projectId,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
  } 
  else {
    throw new Error('No BigQuery credentials configured');
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
