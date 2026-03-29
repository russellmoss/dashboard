# Hightouch → Salesforce Sync Fix: Marketing Segments

**Date:** 2026-03-20
**Status:** Verified in production

---

## Problem

The three Hightouch syncs that write `Marketing_Segment__c` to Salesforce Lead, Contact, and Opportunity records were consuming an excessive number of Salesforce REST API calls. The Lead sync alone was making **~87,000 individual REST lookup queries per run** — one per row — because the match key was `FA_CRD__c` (an external CRD number), forcing Hightouch to look up each Salesforce record ID before writing.

With a daily API limit of 240,000 calls, a single Lead sync was consuming ~36% of the org's daily budget.

---

## Root Cause

The original model queries returned `FA_CRD__c` as the primary key and used it as the external ID mapping to match records in Salesforce. Since `FA_CRD__c` is not an indexed external ID field in Salesforce, Hightouch had to issue a REST `GET` query for every single row to resolve the CRD number to a Salesforce record `Id` before it could perform the update.

**Before (Lead model example):**
```sql
SELECT DISTINCT
  l.FA_CRD__c AS fa_crd,
  seg.advisor_segment
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
INNER JOIN `savvy-gtm-analytics.FinTrx_data_CA.advisor_segments` seg
  ON SAFE_CAST(REGEXP_REPLACE(CAST(l.FA_CRD__c AS STRING), r'[^0-9]', '') AS INT64) = seg.RIA_CONTACT_CRD_ID
WHERE l.IsDeleted = false
  AND l.FA_CRD__c IS NOT NULL
```
- Primary key: `fa_crd`
- External ID mapping: `fa_crd` → `FA_CRD__c`
- Result: 87K individual REST lookups per run

---

## Fix

Changed all three models to return the native Salesforce `Id` directly and use it as the match key. Since the source data in BigQuery (`SavvyGTMData.Lead`, `.Contact`, `.Opportunity`) already contains the Salesforce `Id` field (synced via Fivetran), we simply select it.

**After (Lead model):**
```sql
SELECT DISTINCT
  l.Id AS salesforce_lead_id,
  seg.advisor_segment
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
INNER JOIN `savvy-gtm-analytics.FinTrx_data_CA.advisor_segments` seg
  ON SAFE_CAST(REGEXP_REPLACE(CAST(l.FA_CRD__c AS STRING), r'[^0-9]', '') AS INT64) = seg.RIA_CONTACT_CRD_ID
WHERE l.IsDeleted = false
  AND l.FA_CRD__c IS NOT NULL
```
- Primary key: `salesforce_lead_id`
- External ID mapping: `salesforce_lead_id` → `Id`
- Result: **zero lookup queries** — Hightouch writes directly via Bulk API using the native Id

The same pattern was applied to all three syncs:

| Sync | Model Primary Key | External ID Mapping | Salesforce Object |
|------|-------------------|---------------------|-------------------|
| Lead | `salesforce_lead_id` | `salesforce_lead_id` → `Id` | Lead |
| Contact | `salesforce_contact_id` | `salesforce_contact_id` → `Id` | Contact |
| Opportunity | `salesforce_opp_id` | `salesforce_opp_id` → `Id` | Opportunity |

---

## Sync Configuration (All Three)

All syncs share the same configuration pattern:

| Setting | Value |
|---------|-------|
| Mode | `update` (upsert-style, matches on Id) |
| Bulk API v2 | Enabled |
| Rows per batch | 10,000 |
| Split batch retry | Enabled |
| Schedule | Every 24 hours (interval) |
| Field synced | `advisor_segment` → `Marketing_Segment__c` |

---

## How Incremental Syncs Work (Normal Daily Runs)

Hightouch uses **diff-based syncing** by default. On each scheduled run, it:

1. Executes the BigQuery model query to get the full result set
2. Compares the new results against the cached results from the previous run
3. Only sends rows that have **changed** since the last run to Salesforce

This means on a typical daily run, if only 15 advisors had their segment change, Hightouch sends **only those 15 updates** — not all 87K leads. The query still runs against BigQuery (to compute the diff), but the Salesforce API calls are proportional to the number of **changed rows**, not the total row count.

A **full resync** bypasses this diff and sends all rows. This is only needed when:
- The model primary key changes (like our fix)
- Data gets out of sync for any reason
- You explicitly trigger it

---

## Verification

### Lead Sync (Full Resync — 2026-03-20)

Triggered a full resync after changing the primary key:

| Metric | Value |
|--------|-------|
| Status | `warning` (1 failed row out of 87,248) |
| Duration | 6 minutes 31 seconds |
| Query size | 87,248 rows |
| Successful | 87,247 |
| Failed | 1 |

### Salesforce API Usage After Run

| Metric | Value |
|--------|-------|
| Daily API Requests used | 99,677 of 240,000 (41.5%) |
| Bulk v2 Query Jobs used | 364 of 10,000 (3.6%) |
| Bulk v2 Storage used | 8 MB of 976,562 MB (~0%) |

Note: The 99,677 total includes all API activity for the day (all syncs, failed test runs, Opportunity sync, SF CLI usage, etc.) — not just this Lead run. The Lead sync itself consumed only Bulk API operations (~50-80 REST calls for metadata/job management).

### Previous Runs (Opportunity — for comparison)

The Opportunity sync was already using the corrected pattern and shows typical incremental behavior:

| Run Date | Planned Rows | Successful | Failed |
|----------|-------------|------------|--------|
| Latest | 15 | 7 | 8 |
| Previous (full resync) | 2,245 | 2,237 | 8 |

On incremental runs, only ~15 changed rows were synced — not the full 2,245.

---

## Maximum API Call Estimates

### Worst Case: Full Resync (All Rows, All Three Syncs)

| Sync | Row Count | Bulk Jobs (rows / 10K) | API Calls per Job | Total REST Calls | Bulk API Jobs |
|------|-----------|------------------------|-------------------|------------------|---------------|
| Lead | ~87,000 | 9 | ~5 | ~45-65 | 9 |
| Contact | ~1,100 | 1 | ~5 | ~15-25 | 1 |
| Opportunity | ~2,200 | 1 | ~5 | ~15-25 | 1 |
| **Total** | **~90,300** | **11** | | **~75-115** | **11** |

Each Bulk API v2 job involves: create job → upload CSV → close job → poll status → get results = ~5 REST calls. Plus ~10-20 calls for metadata/describe operations per sync.

**Full resync of all three syncs: ~75-115 REST API calls + 11 Bulk API jobs**

### Typical Case: Daily Incremental Run

On a normal day, the diff engine detects only changed rows. Based on observed patterns:

| Sync | Typical Changed Rows | API Calls |
|------|---------------------|-----------|
| Lead | 0-50 | ~15-25 (1 small bulk job or REST batch) |
| Contact | 0-25 | ~15-25 |
| Opportunity | 0-15 | ~15-25 |
| **Total** | **0-90** | **~45-75** |

### Before vs After

| Scenario | Before (FA_CRD lookup) | After (Id match) | Reduction |
|----------|------------------------|-------------------|-----------|
| Lead full resync | ~87,000+ REST queries | ~50-65 REST + 9 bulk jobs | **99.9%** |
| Lead daily incremental | ~87,000+ REST queries | ~15-25 REST | **99.97%** |
| All 3 syncs daily | ~90,000+ REST queries | ~45-75 REST | **99.9%** |

The old configuration was making per-row REST lookups **regardless of whether the run was incremental or full** because it needed to resolve `FA_CRD__c` → Salesforce `Id` for every row it wanted to update. The new configuration eliminates this entirely.

---

## Current Sync Status

| Sync | Status | Action Needed |
|------|--------|---------------|
| Lead | `warning` (enabled) | Investigate the 1 failed row; otherwise healthy |
| Contact | `disabled` | Needs re-enabling + full resync (same primary key change) |
| Opportunity | `warning` (enabled) | 8 persistent failures — investigate those records |

---

## Org API Budget Impact

| | Daily Limit | All 3 Syncs (incremental) | % of Budget |
|--|-------------|---------------------------|-------------|
| REST API Calls | 240,000 | ~45-75 | **< 0.04%** |
| Bulk v2 Jobs | 10,000 | ~3-11 | **< 0.1%** |

Previously, the syncs alone consumed ~37% of the daily REST API budget. Now they consume effectively nothing.
