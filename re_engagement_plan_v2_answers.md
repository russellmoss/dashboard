# Re-Engagement Plan v2 — Finalization Answers

**Purpose:** Codebase inspection answers so the implementation plan is fully executable by an agent. No BQ queries — codebase-only.

---

## Question 1: Exact column order of Lead_Base SELECT

**Source:** `views/vw_funnel_master.sql`, Lead_Base CTE (lines 1–34).

Ordered list of column **aliases** as they appear in the SELECT (left-to-right, top-to-bottom):

1. `Full_prospect_id__c`
2. `Prospect_Name`
3. `converted_oppty_id`
4. `CreatedDate`
5. `Lead_OwnerId`
6. `Lead_Original_Source`
7. `Final_Source`
8. `Lead_Finance_View__c`
9. `stage_entered_contacting__c`
10. `mql_stage_entered_ts`
11. `converted_date_raw`
12. `IsConverted`
13. `Disposition__c`
14. `DoNotCall`
15. `stage_entered_new__c`
16. `Lead_Experimentation_Tag__c`
17. `Lead_Campaign_Id__c`
18. `Lead_Score_Tier__c`
19. `Lead_External_Agency__c`
20. `Lead_SGA_Owner_Name__c`
21. `Lead_Next_Steps__c`
22. `Initial_Call_Scheduled_Date__c`
23. `lead_closed_date`
24. `Lead_FilterDate`

**Insert position for the three new columns:** To keep the same order as `ReEngagement_As_Lead`, insert the three new columns **after** `lead_closed_date` and **before** `Lead_FilterDate` (i.e. after alias #23, before #24):

- `CAST(NULL AS STRING) AS Previous_Recruiting_Opportunity_ID__c`
- `CAST(NULL AS STRING) AS ContactId`
- `'Lead' AS lead_record_source`

So the `ReEngagement_As_Lead` CTE must use this exact column order (with the same 27 aliases), with these three in the same positions.

---

## Question 2: DetailRecord and RawDetailRecordResult types + mapping

**Sources:**  
- `src/types/dashboard.ts` — `DetailRecord`  
- `src/types/bigquery-raw.ts` — `RawDetailRecordResult`  
- `src/lib/queries/detail-records.ts` — SELECT list and mapping `return { ... }`

### Full DetailRecord interface

**File:** `src/types/dashboard.ts` (lines 118–155)

```ts
export interface DetailRecord {
  id: string;
  advisorName: string;
  source: string;
  channel: string;
  stage: string;
  sga: string | null;
  sgm: string | null;
  campaignId: string | null;
  campaignName: string | null;
  leadScoreTier: string | null;
  aum: number;
  aumFormatted: string;
  salesforceUrl: string;
  relevantDate: string; // FilterDate (fallback)
  contactedDate: string | null; // stage_entered_contacting__c
  mqlDate: string | null; // mql_stage_entered_ts
  sqlDate: string | null; // converted_date_raw
  sqoDate: string | null; // Date_Became_SQO__c
  joinedDate: string | null; // advisor_join_date__c
  signedDate: string | null; // Stage_Entered_Signed__c
  discoveryDate: string | null; // Stage_Entered_Discovery__c
  salesProcessDate: string | null; // Stage_Entered_Sales_Process__c
  negotiatingDate: string | null; // Stage_Entered_Negotiating__c
  onHoldDate: string | null; // Stage_Entered_On_Hold__c
  closedDate: string | null; // Stage_Entered_Closed__c
  initialCallScheduledDate: string | null;
  qualificationCallDate: string | null;
  isContacted: boolean;
  isMql: boolean;
  isSql: boolean;
  isSqo: boolean;
  isJoined: boolean;
  isOpenPipeline: boolean;
  recordTypeId: string | null; // For filtering SQOs by recruiting record type
  isPrimaryOppRecord: boolean; // For deduplicating opportunities with multiple leads
  opportunityId: string | null; // For deduplicating opportunities with multiple leads
}
```

**Fields to add for Phase 3.2:**

- `prospectSourceType: string | null;`   // 'Lead' | 'Re-Engagement'
- `originRecruitingOppId: string | null;` // Previous_Recruiting_Opportunity_ID__c
- `originOpportunityUrl: string | null;`  // URL to original closed-lost opp

---

### Full RawDetailRecordResult interface

**File:** `src/types/bigquery-raw.ts` (lines 62–98)

```ts
export interface RawDetailRecordResult {
  id: string;
  advisor_name: string | null;
  source: string | null;
  channel: string | null;
  stage: string | null;
  sga: string | null;
  sgm: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  lead_score_tier?: string | null;
  aum: number | null;
  salesforce_url: string | null;
  filter_date?: string | { value: string } | null;
  contacted_date?: string | { value: string } | null;
  mql_date?: string | { value: string } | null;
  sql_date?: string | { value: string } | null;
  sqo_date?: string | { value: string } | null;
  joined_date?: string | { value: string } | null;
  signed_date?: string | { value: string } | null;
  discovery_date?: string | { value: string } | null;
  sales_process_date?: string | { value: string } | null;
  negotiating_date?: string | { value: string } | null;
  on_hold_date?: string | { value: string } | null;
  closed_date?: string | { value: string } | null;
  relevant_date?: string | { value: string } | null;
  initial_call_scheduled_date?: string | { value: string } | null;
  qualification_call_date?: string | { value: string } | null;
  is_contacted: number;
  is_mql: number;
  is_sql: number;
  is_sqo: number;
  is_joined: number;
  recordtypeid?: string | null;
  is_primary_opp_record?: number | null;
  opportunity_id?: string | null;
}
```

**Fields to add for Phase 3.2 (snake_case to match BQ SELECT aliases):**

- `prospect_source_type?: string | null;`
- `origin_recruiting_opp_id?: string | null;`
- `origin_opportunity_url?: string | null;`

---

### Mapping (return block) in detail-records.ts

**File:** `src/lib/queries/detail-records.ts` — the `return { ... }` inside `results.map(r => { ... })` (lines 310–346):

```ts
return {
  id: toString(r.id),
  advisorName: toString(r.advisor_name) || 'Unknown',
  source: toString(r.source) || 'Unknown',
  channel: toString(r.channel) || 'Unknown',
  stage: toString(r.stage) || 'Unknown',
  sga: r.sga ? toString(r.sga) : null,
  sgm: r.sgm ? toString(r.sgm) : null,
  campaignId: r.campaign_id ? toString(r.campaign_id) : null,
  campaignName: r.campaign_name ? toString(r.campaign_name) : null,
  leadScoreTier: r.lead_score_tier ? toString(r.lead_score_tier) : null,
  aum: toNumber(r.aum),
  aumFormatted: formatCurrency(r.aum),
  salesforceUrl: toString(r.salesforce_url) || '',
  relevantDate: filterDate,
  contactedDate: contactedDate,
  mqlDate: mqlDate,
  sqlDate: sqlDate,
  sqoDate: sqoDate,
  joinedDate: joinedDate,
  signedDate: signedDate,
  discoveryDate: discoveryDate,
  salesProcessDate: salesProcessDate,
  negotiatingDate: negotiatingDate,
  onHoldDate: onHoldDate,
  closedDate: closedDate,
  initialCallScheduledDate: initialCallDate,
  qualificationCallDate: qualCallDate,
  isContacted: r.is_contacted === 1,
  isMql: r.is_mql === 1,
  isSql: r.is_sql === 1,
  isSqo: r.is_sqo === 1,
  isJoined: r.is_joined === 1,
  isOpenPipeline: OPEN_PIPELINE_STAGES.includes(toString(r.stage)),
  recordTypeId: r.recordtypeid ? toString(r.recordtypeid) : null,
  isPrimaryOppRecord: (r.is_primary_opp_record ?? 0) === 1,
  opportunityId: r.opportunity_id ? toString(r.opportunity_id) : null,
};
```

**Add to the SELECT in the same file** (around lines 219–252, with other `v.*` columns):

- `v.lead_record_source AS prospect_source_type` (or `v.prospect_source_type` if the view exposes that name)
- `v.Previous_Recruiting_Opportunity_ID__c AS origin_recruiting_opp_id`
- `v.origin_opportunity_url`

**Add to the return block (mapping):**

- `prospectSourceType: r.prospect_source_type ? toString(r.prospect_source_type) : null,`
- `originRecruitingOppId: r.origin_recruiting_opp_id ? toString(r.origin_recruiting_opp_id) : null,`
- `originOpportunityUrl: r.origin_opportunity_url ? toString(r.origin_opportunity_url) : null,`

---

## Question 3: RecordDetailModal.tsx — data flow and props

**File:** `src/components/dashboard/RecordDetailModal.tsx`

### Props

- `isOpen: boolean`
- `onClose: () => void`
- `recordId: string | null` — primary_key from vw_funnel_master (Lead Id or Opportunity Id)
- `initialRecord?: RecordDetailFull | null` — optional pre-fetched record
- `showBackButton?: boolean`
- `onBack?: () => void`
- `backButtonLabel?: string`

**Record type:** The modal’s record state is `RecordDetailFull` (from `@/types/record-detail`). It is **not** `DetailRecord`. So the modal gets its data from the **record-detail API** (`getRecordDetail(recordId)`), which returns `RecordDetailFull`. For the Re-Engagement badge and “View Original Opportunity” link to work, `RecordDetailFull` and the record-detail query/API must also include the new fields (e.g. `prospectSourceType`, `originOpportunityUrl`).

### Data flow

- If `initialRecord` is passed (e.g. from ExploreResults after a fetch), the modal uses it.
- Otherwise it fetches when opened: `dashboardApi.getRecordDetail(recordId)` and sets the result as `record`.
- So the modal does **not** receive the table row’s `DetailRecord`; it always works with `RecordDetailFull` from the record-detail API.

### Where to put the Re-Engagement UI

- **“Re-Engagement” badge:** In the **header**, in the same row as the existing record-type badges (lines 219–228). There is already a `recordType` badge and an optional `recordTypeName` (e.g. “Recruiting”). Add a conditional badge when `record.prospectSourceType === 'Re-Engagement'` (or equivalent field on `RecordDetailFull`), next to or near the existing record type / record type name badges.
- **“View Original Opportunity” link:** In the **footer** (lines 396–423), with the other Salesforce links (“View Lead in Salesforce”, “View Opportunity in Salesforce”). Add a conditional link when `record.originOpportunityUrl` (or equivalent) is non-null: e.g. “View Original Opportunity” opening that URL. Same pattern as the existing `record.leadUrl` / `record.opportunityUrl` links.

---

## Question 4: Detail records table — which component renders it?

### Where the detail records table is rendered

1. **Main dashboard** — `src/app/dashboard/page.tsx`  
   - Renders `DetailRecordsTable` with `records` from `dashboardApi.getDetailRecords(currentFilters, 50000)` (and for volume drilldown, `dashboardApi.getDetailRecords(drillDownFilters, 50000)`).  
   - So the **main dashboard** detail table is fed by the **detail-records** API (`getDetailRecords` → `src/lib/queries/detail-records.ts`).

2. **Explore (ExploreResults)** — `src/components/dashboard/ExploreResults.tsx`  
   - Renders `DetailRecordsTable` with `records={drillDownRecords}`.  
   - `drillDownRecords` is `DetailRecord[]` produced by **mapping** the Explore/semantic-layer drilldown result (`detailData.result.rows`) into `DetailRecord` shape (see ~line 840: `const records: DetailRecord[] = detailData.result.rows.map(...)`).  
   - So Explore uses the **same** `DetailRecord` type but a **different data source** (semantic layer drilldown, not `getDetailRecords`). The table component is the same; only the origin of the rows differs.

3. **Volume drill-down modal** — `src/components/dashboard/VolumeDrillDownModal.tsx`  
   - Renders `DetailRecordsTable`; the parent (dashboard page) passes records from `getDetailRecords(drillDownFilters, 50000)` and `onRecordClick={handleVolumeDrillDownRecordClick}`. So again same type and same detail-records API.

### Row click → opening RecordDetailModal

- **DetailRecordsTable:** Row click calls `onRecordClick?.(record.id)` (line 568). So it only passes `record.id` (primary_key).
- **Main dashboard:** `handleRecordClick` sets `selectedRecordId`; `RecordDetailModal` receives `recordId={selectedRecordId}` and **no** `initialRecord` — so it fetches via `getRecordDetail(recordId)`.
- **ExploreResults:** Same: `handleRecordClick(recordId)` sets `selectedRecordId` and then fetches `getRecordDetail(recordId)` and passes the result as `initialRecord` to `RecordDetailModal`. So the modal still displays `RecordDetailFull` from the API (or that same shape when passed as `initialRecord`).

### Same type vs multiple types

- **DetailRecordsTable** always receives `DetailRecord[]` and uses `record.id` for the click. So the **table** is always `DetailRecord`.
- **RecordDetailModal** always displays `RecordDetailFull` (from the record-detail API or passed as `initialRecord`).
- **Phase 3.2:**  
  - **One place for the table:** Extend `DetailRecord`, `RawDetailRecordResult`, the detail-records SELECT, and the mapping in `src/lib/queries/detail-records.ts`. That covers the main dashboard table and the Volume drill-down table (both use `getDetailRecords`).  
  - **ExploreResults** uses the same `DetailRecord` type for its drilldown table, but the rows come from the semantic layer; to show the new columns there, the semantic layer drilldown query (e.g. `generic_detail_list` / detail-list template) must also return the same three columns and be mapped into `DetailRecord` in ExploreResults.  
  - **Modal:** For the badge and “View Original Opportunity” link, extend **record-detail** (e.g. `RecordDetailFull` and `RecordDetailRaw` in `src/types/record-detail.ts`, and the query in `src/lib/queries/record-detail.ts` + API route) so the modal receives `prospectSourceType` and `originOpportunityUrl` (and optionally `originRecruitingOppId`).

**Summary:** Detail table = one type (`DetailRecord`) and one main query path (detail-records). Modal = different type and API (`RecordDetailFull` from record-detail). Phase 3.2 should extend both (detail-records for table columns and Explore mapping; record-detail for modal UI).
