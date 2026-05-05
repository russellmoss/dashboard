// Resolve SFDC name + funnel status for the Coaching Usage drill-down.
//
// Two inputs (either or both may be empty):
//   - `whoIds`: array of 18-char SFDC Lead/Contact Ids from `call_notes.sfdc_who_id`
//   - `emails`: array of lowercased non-Savvy invitee emails (Granola fallback path)
//
// Returns:
//   - `whoIdToInfo[id] → AdvisorInfo`        (any matching Lead OR Contact row)
//   - `emailToUniqueInfo[lc_email] → AdvisorInfo` (only when EXACTLY ONE distinct
//     name across Lead + Contact matches that email; ambiguous matches are
//     intentionally omitted so the caller can fall back to displaying the
//     email itself)
//
// AdvisorInfo combines the SFDC name with funnel status pulled from
// vw_funnel_master, joined on Lead.Id (Full_prospect_id__c). Contact-side
// matches reverse-resolve to Lead via Lead.ConvertedContactId.
//
// One BigQuery round-trip; safe to call with empty inputs (returns empty maps
// without hitting BQ).

import { runQuery } from '@/lib/bigquery';

export interface AdvisorInfo {
  name: string;
  /** Has this person ever converted to an opportunity (vw_funnel_master.is_sql)? */
  didSql: boolean;
  /** Has this person ever had an SQO-qualified opportunity (vw_funnel_master.is_sqo)? */
  didSqo: boolean;
  /** Current/most-recent OPPORTUNITY StageName. null when the person has no
   *  opportunity yet (lead-only) or isn't in the funnel at all. Per-spec:
   *  this is opportunity stage only — no lead-stage fallbacks. */
  currentStage: string | null;
  /** True if the most-recent opp StageName = 'Closed Lost', OR (no opp at all
   *  AND lead_closed_date IS NOT NULL — i.e. the lead itself died). */
  closedLost: boolean;
}

export interface ResolvedAdvisorInfo {
  whoIdToInfo: Record<string, AdvisorInfo>;
  emailToUniqueInfo: Record<string, AdvisorInfo>;
}

interface Row {
  kind: 'who' | 'email';
  key: string;
  name: string;
  did_sql: number | null;
  did_sqo: number | null;
  current_stage: string | null;
  closed_lost: boolean | null;
}

export async function resolveAdvisorNames(args: {
  whoIds: string[];
  emails: string[];
}): Promise<ResolvedAdvisorInfo> {
  const whoIds = Array.from(new Set(args.whoIds.filter((s) => !!s && s.trim().length > 0)));
  const lcEmails = Array.from(
    new Set(args.emails.map((s) => s?.toLowerCase().trim()).filter((s): s is string => !!s)),
  );

  if (whoIds.length === 0 && lcEmails.length === 0) {
    return { whoIdToInfo: {}, emailToUniqueInfo: {} };
  }

  // Single query — four logical layers:
  //   (1) Lookup arm: who_id (direct Lead or Contact→Lead) and email (direct
  //       Lead.Email or Contact.Email→ConvertedContactId→Lead). Email arm
  //       uses a subquery + WHERE distinct_names = 1 (NOT a HAVING with mixed
  //       aggregates — BigQuery rejects ANY_VALUE + COUNT(DISTINCT) co-mingled
  //       in HAVING with "Aggregations of aggregations are not allowed").
  //   (2) funnel_flags: simple MAX/COUNT-style aggregates per Lead.
  //   (3) primary_opp_stage: ROW_NUMBER() picks the primary or most-recent opp's
  //       StageName per Lead. Only opp rows (Full_Opportunity_ID__c IS NOT NULL)
  //       contribute — per-spec, current_stage is opportunity stage only.
  //   (4) Outer SELECT: glue lookup + flags + stage.
  const sql = `
    WITH
    who_to_lead AS (
      -- Direct Lead match by Id.
      SELECT Id AS who_id, Id AS lead_id, Name AS person_name
      FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\`
      WHERE Id IN UNNEST(@whoIds) AND IsDeleted = FALSE AND Name IS NOT NULL
      UNION ALL
      -- Contact match → reverse-lookup to Lead via ConvertedContactId.
      -- One Contact may have multiple converted Leads; the funnel CTE handles
      -- that via per-lead aggregation.
      SELECT c.Id AS who_id, l.Id AS lead_id, c.Name AS person_name
      FROM \`savvy-gtm-analytics.SavvyGTMData.Contact\` c
      JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
        ON l.ConvertedContactId = c.Id
      WHERE c.Id IN UNNEST(@whoIds)
        AND c.IsDeleted = FALSE AND l.IsDeleted = FALSE
        AND c.Name IS NOT NULL
    ),
    email_candidates AS (
      SELECT LOWER(Email) AS lc_email, Name AS person_name, Id AS lead_id
      FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\`
      WHERE LOWER(Email) IN UNNEST(@lcEmails)
        AND IsDeleted = FALSE AND Email IS NOT NULL AND Email <> '' AND Name IS NOT NULL
      UNION ALL
      SELECT LOWER(c.Email) AS lc_email, c.Name AS person_name, l.Id AS lead_id
      FROM \`savvy-gtm-analytics.SavvyGTMData.Contact\` c
      JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
        ON l.ConvertedContactId = c.Id
      WHERE LOWER(c.Email) IN UNNEST(@lcEmails)
        AND c.IsDeleted = FALSE AND l.IsDeleted = FALSE
        AND c.Email IS NOT NULL AND c.Email <> '' AND c.Name IS NOT NULL
    ),
    email_grouped AS (
      SELECT
        lc_email,
        ANY_VALUE(person_name) AS person_name,
        ANY_VALUE(lead_id)     AS lead_id,
        COUNT(DISTINCT person_name) AS distinct_names
      FROM email_candidates
      GROUP BY lc_email
    ),
    email_unique AS (
      SELECT lc_email, person_name, lead_id
      FROM email_grouped
      WHERE distinct_names = 1
    ),
    all_lookups AS (
      SELECT 'who' AS kind, who_id AS key, person_name, lead_id FROM who_to_lead
      UNION ALL
      SELECT 'email' AS kind, lc_email AS key, person_name, lead_id FROM email_unique
    ),
    -- Boolean flags per Lead via simple MAX aggregates. is_sql/is_sqo are
    -- MAX'd because the lead-only row in vw_funnel_master has is_sql=0 even
    -- when an opp row exists with is_sql=1; we want the "ever true" answer.
    funnel_flags AS (
      SELECT
        Full_prospect_id__c AS lead_id,
        MAX(is_sql) AS did_sql,
        MAX(is_sqo) AS did_sqo,
        MAX(IF(Full_Opportunity_ID__c IS NULL, 1, 0)) AS has_lead_only,
        MAX(IF(lead_closed_date IS NOT NULL, 1, 0))   AS lead_closed
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
      WHERE Full_prospect_id__c IN (SELECT lead_id FROM all_lookups WHERE lead_id IS NOT NULL)
      GROUP BY 1
    ),
    -- Primary or most-recent opp StageName per Lead. ROW_NUMBER over the
    -- opp rows only, sorted: primary first, then by Opp_CreatedDate DESC.
    -- Lead-only people drop out (no opp row at all → no stage).
    primary_opp_stage AS (
      SELECT lead_id, StageName
      FROM (
        SELECT
          Full_prospect_id__c AS lead_id,
          StageName,
          ROW_NUMBER() OVER (
            PARTITION BY Full_prospect_id__c
            ORDER BY
              CASE WHEN is_primary_opp_record = 1 THEN 0 ELSE 1 END,
              Opp_CreatedDate DESC NULLS LAST
          ) AS rn
        FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
        WHERE Full_prospect_id__c IN (SELECT lead_id FROM all_lookups WHERE lead_id IS NOT NULL)
          AND Full_Opportunity_ID__c IS NOT NULL
      )
      WHERE rn = 1
    )
    SELECT
      al.kind,
      al.key,
      al.person_name AS name,
      COALESCE(ff.did_sql, 0) AS did_sql,
      COALESCE(ff.did_sqo, 0) AS did_sqo,
      pos.StageName AS current_stage,
      (
        pos.StageName = 'Closed Lost'
        OR (COALESCE(ff.has_lead_only, 0) = 1 AND COALESCE(ff.lead_closed, 0) = 1)
      ) AS closed_lost
    FROM all_lookups al
    LEFT JOIN funnel_flags ff ON ff.lead_id = al.lead_id
    LEFT JOIN primary_opp_stage pos ON pos.lead_id = al.lead_id
  `;

  const rows = await runQuery<Row>(sql, { whoIds, lcEmails });

  const whoIdToInfo: Record<string, AdvisorInfo> = {};
  const emailToUniqueInfo: Record<string, AdvisorInfo> = {};
  for (const r of rows) {
    if (!r?.key || !r?.name) continue;
    const info: AdvisorInfo = {
      name: r.name,
      didSql: Number(r.did_sql ?? 0) === 1,
      didSqo: Number(r.did_sqo ?? 0) === 1,
      currentStage: r.current_stage && r.current_stage.trim() ? r.current_stage : null,
      closedLost: r.closed_lost === true,
    };
    if (r.kind === 'who') {
      // First-seen wins; UNION ALL means a who_id matching both Lead AND
      // Contact (rare — usually pre/post conversion) lands the Lead row first
      // by table order. Either name is correct identity, take the first.
      if (!whoIdToInfo[r.key]) whoIdToInfo[r.key] = info;
    } else if (r.kind === 'email') {
      emailToUniqueInfo[r.key] = info;
    }
  }
  return { whoIdToInfo, emailToUniqueInfo };
}
