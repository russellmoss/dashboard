// Resolve SFDC name + funnel status for the Coaching Usage drill-down.
//
// Four inputs (any or all may be empty):
//   - `whoIds`:        SFDC Lead/Contact Ids from `call_notes.sfdc_who_id`
//   - `whatIds`:       SFDC Opportunity Ids from `call_notes.sfdc_what_id`.
//                      Granola calls linked directly to an Opportunity have
//                      `sfdc_who_id = NULL` and `sfdc_what_id = <Opp.Id>`;
//                      the who-arm misses them entirely and the email
//                      cascade can pick the wrong (Closed Lost) sibling
//                      Lead. The what-arm reads StageName + advisor name
//                      from THIS specific Opp via vw_funnel_master, which
//                      is the only signal that matches what the rep sees
//                      in SFDC.
//   - `emails`:        lowercased non-Savvy invitee emails (Granola fallback)
//   - `kixieTaskIds`:  SFDC Task.Ids from `call_notes.kixie_task_id`. Used as
//                      a self-healing fallback for Kixie rows where
//                      `sfdc_who_id IS NULL`: SFDC↔BQ sync delay can leave
//                      Postgres' baked-in `sfdc_who_id` NULL even after the
//                      WhoId is set on the Task. We re-read Task.WhoId from
//                      BQ at request time so the row resolves as soon as BQ
//                      catches up — no Postgres backfill needed.
//
// Returns:
//   - `whoIdToInfo[id] → AdvisorInfo`              (Lead or Contact match)
//   - `whatIdToInfo[opp_id] → AdvisorInfo`         (Opportunity match — stage
//     and SQL/SQO flags come from THIS specific opp row in vw_funnel_master,
//     NOT the lead's primary opp, so a sibling Closed Lost opp on the same
//     lead can't poison the stage of an active Negotiating opp)
//   - `emailToUniqueInfo[lc_email] → AdvisorInfo`  (only when EXACTLY ONE
//     distinct name across Lead + Contact matches that email; ambiguous
//     matches are intentionally omitted so the caller can fall back to
//     displaying the email itself)
//   - `kixieTaskIdToInfo[task_id] → AdvisorInfo`   (Task.WhoId → Lead/Contact
//     match for the kixie self-healing path)
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
  /** SFDC Lead.Id this person was resolved to (always set when info exists). */
  leadId: string | null;
  /** SFDC Full_Opportunity_ID__c of the primary or most-recent opp on this Lead.
   *  null when the person is lead-only (no opportunity row yet). */
  opportunityId: string | null;
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
  whatIdToInfo: Record<string, AdvisorInfo>;
  emailToUniqueInfo: Record<string, AdvisorInfo>;
  kixieTaskIdToInfo: Record<string, AdvisorInfo>;
}

interface Row {
  kind: 'who' | 'what' | 'email' | 'kixie_task';
  key: string;
  name: string;
  lead_id: string | null;
  opportunity_id: string | null;
  did_sql: number | null;
  did_sqo: number | null;
  current_stage: string | null;
  closed_lost: boolean | null;
}

export async function resolveAdvisorNames(args: {
  whoIds: string[];
  emails: string[];
  whatIds?: string[];
  kixieTaskIds?: string[];
}): Promise<ResolvedAdvisorInfo> {
  const whoIds = Array.from(new Set(args.whoIds.filter((s) => !!s && s.trim().length > 0)));
  const lcEmails = Array.from(
    new Set(args.emails.map((s) => s?.toLowerCase().trim()).filter((s): s is string => !!s)),
  );
  const whatIds = Array.from(
    new Set((args.whatIds ?? []).filter((s) => !!s && s.trim().length > 0)),
  );
  const kixieTaskIds = Array.from(
    new Set((args.kixieTaskIds ?? []).filter((s) => !!s && s.trim().length > 0)),
  );

  if (
    whoIds.length === 0 && lcEmails.length === 0 &&
    whatIds.length === 0 && kixieTaskIds.length === 0
  ) {
    return { whoIdToInfo: {}, whatIdToInfo: {}, emailToUniqueInfo: {}, kixieTaskIdToInfo: {} };
  }

  // Single query — four logical layers:
  //   (1) Lookup arms: (a) who_id (direct Lead or Contact→Lead), (b) email
  //       (direct Lead.Email or Contact.Email→ConvertedContactId→Lead), and
  //       (c) kixie_task_id → Task.WhoId → Lead/Contact (self-healing path
  //       for Kixie rows whose sfdc_who_id was NULL at write-time but whose
  //       SFDC Task has since had its WhoId associated). Email arm uses a
  //       subquery + WHERE distinct_names = 1 (NOT a HAVING with mixed
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
    -- Opportunity arm: resolve a granola call linked directly to an Opp
    -- (sfdc_what_id set). vw_funnel_master holds one row per opp, so we
    -- read THIS opp's StageName + is_sql/is_sqo here — NOT the lead's
    -- primary-opp stage (which can be a sibling Closed Lost opp on the
    -- same lead and silently lie about whether the deal is alive).
    -- Person name falls back to Account.Name (Opportunity.AccountId →
    -- Account) when present, otherwise the opp's advisor_name from
    -- vw_funnel_master. lead_id is NOT propagated here: in this org
    -- vw_funnel_master.Full_prospect_id__c is sometimes an Opportunity
    -- Id (006-prefixed), so building a /Lead/<id>/view URL from it
    -- would 404. The callsite uses opportunityId for the deep-link.
    what_to_opp AS (
      SELECT
        vfm.Full_Opportunity_ID__c AS what_id,
        vfm.Full_prospect_id__c    AS lead_id,
        COALESCE(acc.Name, vfm.advisor_name) AS person_name,
        vfm.StageName               AS specific_stage,
        COALESCE(vfm.is_sql, 0)     AS did_sql_specific,
        COALESCE(vfm.is_sqo, 0)     AS did_sqo_specific
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` vfm
      LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` opp
        ON opp.Id = vfm.Full_Opportunity_ID__c AND opp.IsDeleted = FALSE
      LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Account\` acc
        ON acc.Id = opp.AccountId AND acc.IsDeleted = FALSE
      WHERE vfm.Full_Opportunity_ID__c IN UNNEST(@whatIds)
    ),
    -- Kixie self-healing arm: resolve SFDC Task.Id → WhoId → Lead/Contact name.
    -- Only includes rows whose Task has a non-null, non-deleted WhoId pointing
    -- to a non-deleted Lead or Contact. A task whose WhoId hasn't been
    -- associated yet (or is null in BQ due to sync lag) simply doesn't
    -- appear here — the caller falls through to email or Unknown.
    kixie_task_to_who AS (
      SELECT Id AS kixie_task_id, WhoId
      FROM \`savvy-gtm-analytics.SavvyGTMData.Task\`
      WHERE Id IN UNNEST(@kixieTaskIds)
        AND IsDeleted = FALSE
        AND WhoId IS NOT NULL
    ),
    kixie_to_lead AS (
      -- Direct: Task.WhoId is a Lead.
      SELECT k.kixie_task_id, l.Id AS lead_id, l.Name AS person_name
      FROM kixie_task_to_who k
      JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
        ON l.Id = k.WhoId
      WHERE l.IsDeleted = FALSE AND l.Name IS NOT NULL
      UNION ALL
      -- Indirect: Task.WhoId is a Contact, reverse-lookup to Lead via
      -- ConvertedContactId. One Contact may map to multiple converted Leads;
      -- the funnel CTEs handle that via per-lead aggregation.
      SELECT k.kixie_task_id, l.Id AS lead_id, c.Name AS person_name
      FROM kixie_task_to_who k
      JOIN \`savvy-gtm-analytics.SavvyGTMData.Contact\` c
        ON c.Id = k.WhoId
      JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
        ON l.ConvertedContactId = c.Id
      WHERE c.IsDeleted = FALSE AND l.IsDeleted = FALSE AND c.Name IS NOT NULL
    ),
    all_lookups AS (
      SELECT 'who' AS kind, who_id AS key, person_name, lead_id FROM who_to_lead
      UNION ALL
      SELECT 'what' AS kind, what_id AS key, person_name, lead_id FROM what_to_opp
      UNION ALL
      SELECT 'email' AS kind, lc_email AS key, person_name, lead_id FROM email_unique
      UNION ALL
      SELECT 'kixie_task' AS kind, kixie_task_id AS key, person_name, lead_id FROM kixie_to_lead
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
      SELECT lead_id, opp_id, StageName
      FROM (
        SELECT
          Full_prospect_id__c AS lead_id,
          Full_Opportunity_ID__c AS opp_id,
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
      -- For kind='what', leave lead_id null on the wire so the caller
      -- doesn't try to build /Lead/<id>/view from a 006-prefixed value.
      -- Funnel flags below still join on al.lead_id internally.
      CASE WHEN al.kind = 'what' THEN NULL ELSE al.lead_id END AS lead_id,
      -- kind='what' carries its own opp_id (the linked Opp itself).
      -- Other arms inherit the lead's primary/most-recent opp via pos.
      CASE WHEN al.kind = 'what' THEN al.key ELSE pos.opp_id END AS opportunity_id,
      -- kind='what' uses THIS opp's is_sql/is_sqo so a sibling Closed Lost
      -- opp on the same lead can't downgrade the active opp's stats.
      CASE WHEN al.kind = 'what'
           THEN COALESCE(wto.did_sql_specific, 0)
           ELSE COALESCE(ff.did_sql, 0)
      END AS did_sql,
      CASE WHEN al.kind = 'what'
           THEN COALESCE(wto.did_sqo_specific, 0)
           ELSE COALESCE(ff.did_sqo, 0)
      END AS did_sqo,
      CASE WHEN al.kind = 'what' THEN wto.specific_stage
           ELSE pos.StageName
      END AS current_stage,
      CASE WHEN al.kind = 'what' THEN (wto.specific_stage = 'Closed Lost')
           ELSE (
             pos.StageName = 'Closed Lost'
             OR (COALESCE(ff.has_lead_only, 0) = 1 AND COALESCE(ff.lead_closed, 0) = 1)
           )
      END AS closed_lost
    FROM all_lookups al
    LEFT JOIN funnel_flags ff ON ff.lead_id = al.lead_id
    LEFT JOIN primary_opp_stage pos ON pos.lead_id = al.lead_id
    LEFT JOIN what_to_opp wto ON wto.what_id = al.key AND al.kind = 'what'
  `;

  // Declare types for the four array params so BQ accepts empty arrays.
  // Any one (or several) may be [] for a given range — the empty-array
  // typing requirement bites whenever a param is unused.
  const rows = await runQuery<Row>(
    sql,
    { whoIds, whatIds, lcEmails, kixieTaskIds },
    { whoIds: ['STRING'], whatIds: ['STRING'], lcEmails: ['STRING'], kixieTaskIds: ['STRING'] },
  );

  const whoIdToInfo: Record<string, AdvisorInfo> = {};
  const whatIdToInfo: Record<string, AdvisorInfo> = {};
  const emailToUniqueInfo: Record<string, AdvisorInfo> = {};
  const kixieTaskIdToInfo: Record<string, AdvisorInfo> = {};
  for (const r of rows) {
    if (!r?.key || !r?.name) continue;
    const info: AdvisorInfo = {
      name: r.name,
      leadId: r.lead_id && r.lead_id.trim() ? r.lead_id : null,
      opportunityId: r.opportunity_id && r.opportunity_id.trim() ? r.opportunity_id : null,
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
    } else if (r.kind === 'what') {
      if (!whatIdToInfo[r.key]) whatIdToInfo[r.key] = info;
    } else if (r.kind === 'email') {
      emailToUniqueInfo[r.key] = info;
    } else if (r.kind === 'kixie_task') {
      // Same first-seen-wins rule as who_to_lead — Lead arm of the UNION ALL
      // hits before the Contact arm by table order.
      if (!kixieTaskIdToInfo[r.key]) kixieTaskIdToInfo[r.key] = info;
    }
  }
  return { whoIdToInfo, whatIdToInfo, emailToUniqueInfo, kixieTaskIdToInfo };
}
