import { runQuery } from '../bigquery';
import { toNumber, toString } from '@/types/bigquery-raw';

export type DateConfidence = 'High' | 'Medium' | 'Low';

export interface DateRevisionInfo {
  revisionCount: number;
  firstDateSet: string | null;
  dateConfidence: DateConfidence;
}

interface RawDateRevisionRow {
  opp_id: string;
  revision_count: number;
  first_date_set: string | null;
  date_confidence: string;
}

/**
 * Fetch date revision history for all opportunities that have ever had
 * Earliest_Anticipated_Start_Date__c tracked in OpportunityFieldHistory.
 * Returns a Map keyed by OpportunityId.
 */
export async function getDateRevisionMap(): Promise<Map<string, DateRevisionInfo>> {
  const query = `
    WITH first_records AS (
      SELECT
        OpportunityId,
        OldValue,
        NewValue,
        CreatedDate,
        ROW_NUMBER() OVER (PARTITION BY OpportunityId ORDER BY CreatedDate ASC) AS rn
      FROM \`savvy-gtm-analytics.SavvyGTMData.OpportunityFieldHistory\`
      WHERE Field = 'Earliest_Anticipated_Start_Date__c'
        AND IsDeleted = false
    ),
    rev_counts AS (
      SELECT
        OpportunityId,
        COUNT(*) AS revision_count
      FROM \`savvy-gtm-analytics.SavvyGTMData.OpportunityFieldHistory\`
      WHERE Field = 'Earliest_Anticipated_Start_Date__c'
        AND IsDeleted = false
      GROUP BY OpportunityId
    )
    SELECT
      rc.OpportunityId AS opp_id,
      rc.revision_count,
      CAST(COALESCE(
        SAFE_CAST(fr.OldValue AS DATE),
        SAFE_CAST(fr.NewValue AS DATE)
      ) AS STRING) AS first_date_set,
      CASE
        WHEN rc.revision_count <= 1 THEN 'High'
        WHEN rc.revision_count = 2 THEN 'Medium'
        ELSE 'Low'
      END AS date_confidence
    FROM rev_counts rc
    JOIN first_records fr ON rc.OpportunityId = fr.OpportunityId AND fr.rn = 1
  `;

  const results = await runQuery<RawDateRevisionRow>(query);

  const map = new Map<string, DateRevisionInfo>();
  for (const row of results) {
    const oppId = toString(row.opp_id);
    if (!oppId) continue;
    map.set(oppId, {
      revisionCount: toNumber(row.revision_count) || 0,
      firstDateSet: row.first_date_set || null,
      dateConfidence: (row.date_confidence as DateConfidence) || 'High',
    });
  }
  return map;
}
