/**
 * Enrich LA Advisor List CSV with Lead and Opportunity data from BigQuery.
 * Matches CRD (column E) to FA_CRD__c on Lead and Opportunity.
 *
 * Run: npx tsx scripts/enrich-la-advisors-lead-opp.ts
 * Input: LA Advisor List - Advisor Contacts - LA - All Other.csv
 * Output: same file with added columns (Lead Owner, Lead Stage, Lead Disposition, etc.)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getBigQueryClient } from '../src/lib/bigquery';

const CSV_PATH = path.join(
  process.cwd(),
  'LA Advisor List - Advisor Contacts - LA - All Other.csv'
);
const CSV_OUT = CSV_PATH;

interface LeadOppRow {
  crd: string;
  lead_owner: string | null;
  lead_stage: string | null;
  lead_disposition: string | null;
  lead_stage_date: string | null;
  opp_owner: string | null;
  opp_stage: string | null;
  opp_stage_date: string | null;
  opp_closed_lost_reason: string | null;
  opp_closed_lost_details: string | null;
}

function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(parseCSVLine);
  return { headers, rows };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      current += c;
    } else if (c === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

function escapeCSV(val: string | null | undefined): string {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function main() {
  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const { headers, rows } = parseCSV(content);

  // CRD is column index 4 (0-based) = column E
  const crdIndex = headers.findIndex((h) => h.toLowerCase() === 'crd');
  if (crdIndex === -1) {
    throw new Error('CSV must have a CRD column');
  }

  const crds = [...new Set(rows.map((r) => String(r[crdIndex] || '').trim()).filter(Boolean))];
  if (crds.length === 0) {
    throw new Error('No CRD values found in CSV');
  }

  const client = getBigQueryClient();

  // One row per CRD: latest Lead and latest Opportunity (filter by our CRD list)
  const leadQuery = `
    WITH lead_ranked AS (
      SELECT
        CAST(FA_CRD__c AS STRING) AS crd,
        SGA_Owner_Name__c AS lead_owner,
        Status AS lead_stage,
        Disposition__c AS lead_disposition,
        COALESCE(
          Stage_Entered_Closed__c,
          Stage_Entered_Call_Scheduled__c,
          Stage_Entered_Contacting__c,
          Stage_Entered_New__c,
          LastModifiedDate
        ) AS lead_stage_date,
        ROW_NUMBER() OVER (PARTITION BY CAST(FA_CRD__c AS STRING) ORDER BY LastModifiedDate DESC) AS rn
      FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\`
      WHERE IsDeleted = FALSE AND FA_CRD__c IS NOT NULL
        AND CAST(FA_CRD__c AS STRING) IN UNNEST(@crds)
    )
    SELECT crd, lead_owner, lead_stage, lead_disposition,
      FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', lead_stage_date) AS lead_stage_date
    FROM lead_ranked WHERE rn = 1
  `;

  const oppQuery = `
    WITH opp_ranked AS (
      SELECT
        CAST(FA_CRD__c AS STRING) AS crd,
        Opportunity_Owner_Name__c AS opp_owner,
        StageName AS opp_stage,
        LastStageChangeDate AS opp_stage_date,
        Closed_Lost_Reason__c AS opp_closed_lost_reason,
        Closed_Lost_Details__c AS opp_closed_lost_details,
        ROW_NUMBER() OVER (PARTITION BY CAST(FA_CRD__c AS STRING) ORDER BY LastStageChangeDate DESC NULLS LAST) AS rn
      FROM \`savvy-gtm-analytics.SavvyGTMData.Opportunity\`
      WHERE IsDeleted = FALSE AND FA_CRD__c IS NOT NULL
        AND CAST(FA_CRD__c AS STRING) IN UNNEST(@crds)
    )
    SELECT crd, opp_owner, opp_stage,
      FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', opp_stage_date) AS opp_stage_date,
      opp_closed_lost_reason, opp_closed_lost_details
    FROM opp_ranked WHERE rn = 1
  `;

  const [leadRows] = await client.query({
    query: leadQuery,
    params: { crds: crds },
  });
  const [oppRows] = await client.query({
    query: oppQuery,
    params: { crds: crds },
  });

  const leadByCrd = new Map<string, Record<string, any>>();
  for (const r of leadRows as any[]) {
    const crd = String(r.crd ?? '');
    if (crd) leadByCrd.set(crd, r);
  }
  const oppByCrd = new Map<string, Record<string, any>>();
  for (const r of oppRows as any[]) {
    const crd = String(r.crd ?? '');
    if (crd) oppByCrd.set(crd, r);
  }

  const newHeaders = [
    ...headers,
    'Lead Owner',
    'Lead Stage',
    'Lead Disposition',
    'Lead Stage Date',
    'Opportunity Owner',
    'Opportunity Stage',
    'Opp Stage Date',
    'Opp Closed Lost Reason',
    'Opp Closed Lost Details',
  ];

  const outRows = rows.map((row) => {
    const crd = String(row[crdIndex] ?? '').trim();
    const lead = crd ? leadByCrd.get(crd) : null;
    const opp = crd ? oppByCrd.get(crd) : null;
    return [
      ...row,
      lead?.lead_owner ?? '',
      lead?.lead_stage ?? '',
      lead?.lead_disposition ?? '',
      lead?.lead_stage_date ?? '',
      opp?.opp_owner ?? '',
      opp?.opp_stage ?? '',
      opp?.opp_stage_date ?? '',
      opp?.opp_closed_lost_reason ?? '',
      opp?.opp_closed_lost_details ?? '',
    ];
  });

  const csvLines = [
    newHeaders.map(escapeCSV).join(','),
    ...outRows.map((r) => r.map(escapeCSV).join(',')),
  ];
  fs.writeFileSync(CSV_OUT, csvLines.join('\n'), 'utf-8');
  console.log('Wrote', CSV_OUT);
  console.log('Enriched', outRows.length, 'rows with', leadByCrd.size, 'lead matches and', oppByCrd.size, 'opp matches.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
