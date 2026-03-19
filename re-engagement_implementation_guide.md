# Re-Engagement Eligible List — Implementation Record

> **Status**: Complete (v1 deployed 2026-03-17, patched 2026-03-18; v2 deployed 2026-03-18)
> **Approach**: Salesforce List View + Formula Fields + Account Rollups + Screen Flow Fixes + Record-Triggered Flow + Apex Backfill
> **Execution**: Salesforce CLI (`sf project deploy start`) + Salesforce MCP (`run_soql_query`) + Anonymous Apex (`sf apex run`)
> **SF CLI Alias**: `savvy` (russell.moss@savvywealth.com)
> **Org**: `russell.moss@savvywealth.com` (Production)
> **SFDX Project Root**: `C:\Users\russe\Documents\Dashboard\salesforce`
> **Related docs**: `re-engagement_fix.md` (exploration findings), `re-engagement_fixes_implementation_guide.md` (phase 2 guide), `re-engagement_fix_v2.md` (v2 enhancement guide)

---

## What Was Built

A Salesforce List View ("Re-Engagement Eligible") that surfaces Closed Lost recruiting opportunities eligible for re-engagement. The list is deduplicated to show only the most recent Closed Lost recruiting opp per account, with columns for the original Closed Lost reason/details and re-engagement attempt count. Supporting infrastructure includes formula fields, account rollups, a record-triggered flow for ongoing data capture, a validation rule, bug fixes to the existing Screen Flow, and guards against advisors with active recruiting opportunities.

---

## Decisions

| Question | Decision |
|----------|----------|
| Savvy Declined records? | **Exclude** — filter out all 5 "Savvy Declined" reason values |
| Upper bound on age? | **No cap** — show all eligible records from 30 days onward |
| Time buckets | <1 month, 1–5 months, 6+ months |
| Race condition | **Validation rule** — block if re-engagement opp already exists |
| SGA visibility | **All unassigned/available** — not scoped to "my records" |
| Re-Engagement Opp creation | **Use existing Screen Flow** `Create_Re_Engagement_Opportunity` (with bug fixes) |
| "Was Re-Engaged" logic | Account-level rollup counting ALL re-engagement opps (any stage) → formula IF > 0 then "Yes" else "No" |
| Days Since Closed Lost | Use account-level MAX(Stage_Entered_Closed__c) across all Closed Lost opps (Recruiting + Re-Engagement). Fallback to opp's own dates when rollup is null |
| SGA field visibility | Permission set `Re_Engagement_Fields_Access` assigned to all 28 active Standard User profile users + russell.moss (29 total) |
| Active recruiting opps | **Exclude** — baked into `Is_Latest_Closed_Lost__c` formula (returns false if Account has open recruiting opps) |
| Duplicate rows | **Dedup** — `Is_Latest_Closed_Lost__c` formula + list view filter ensures one row per account |
| Original Closed Lost context | **Two-field approach** on Account: LTA(5000) for full data + Text(255) for formula reference. Record-triggered flow captures on every Closed Lost transition; Apex backfill populated 1,755 existing accounts |
| Original Details truncation | **Accept for list view** — 44 accounts have details > 255 chars. List view shows truncated version; full text preserved on Account record one click away |
| Re-engagement count | **Opp formula** surfacing `Account.Total_Re_Engagement_Opps__c` rollup |

---

## Existing Salesforce Assets (verified via MCP)

| Asset | API Name / ID | Notes |
|-------|--------------|-------|
| Recruiting Record Type | `012Dn000000mrO3IAI` / `Recruiting` | |
| Re-Engagement Record Type | `012VS000009VoxrYAC` / `Re_Engagement` | |
| Re-Engagement Screen Flow | `Create_Re_Engagement_Opportunity` | Now v18 (see bugs found below) |
| Bulk Re-Engagement Flow | `Bulk_Create_Re_Engagement_Opportunity` | Fires on `Create_Re_Engagement__c` checkbox |
| Open Re-Engagement Opps (Account) | `Open_Re_Engagement_Opps__c` | Account rollup — correctly excludes Closed Lost + Re-Engaged |
| Open Re-Engagement Opps (Opportunity) | `Open_Re_Engagement_Opps__c` | Formula: `Account.Open_Re_Engagement_Opps__c` — surfaces the Account rollup for list view use |
| Closed Lost Reason | `Closed_Lost_Reason__c` | Picklist, 14 values |
| Stage Entered Closed | `Stage_Entered_Closed__c` | DateTime — actual closed timestamp. 42.5% null on pre-mid-2024 records |
| SQO | `SQL__c` | Picklist (label: "SQO"). API name is `SQL__c` despite label being "SQO" |

### Savvy Declined Reason Values (excluded from list view)

1. `Savvy Declined - No Book of Business` (hyphen U+002D)
2. `Savvy Declined - Insufficient Revenue` (hyphen U+002D)
3. `Savvy Declined – Book Not Transferable` (**en dash U+2013** — different from the others)
4. `Savvy Declined - Poor Culture Fit` (hyphen U+002D)
5. `Savvy Declined - Compliance` (hyphen U+002D)

---

## Deployment History

### Round 1: Core List View Infrastructure (2026-03-17)

| Phase | Asset | Object | Type | Status |
|-------|-------|--------|------|--------|
| 1 | SFDX project scaffold | — | `sfdx-project.json` + directory structure | Created |
| 2 | `Days_Since_Closed_Lost__c` | Opportunity | Formula Field (Number) | Created, then updated in Round 2 |
| 2 | `Closed_Lost_Time_Bucket__c` | Opportunity | Formula Field (Text) | Created, then patched (BlankAsBlank) |
| 3 | `Block_Re_Engagement_If_One_Exists` | Opportunity | Validation Rule | Created |
| 4 | `Re_Engagement_Eligible` | Opportunity | List View (11 columns) | Created, updated in Rounds 2, 3 & 4 |
| — | `Re_Engagement_Fields_Access` | — | Permission Set | Created for FLS |

### Round 2: Flow Fixes + Re-Engagement Enhancements (2026-03-17)

| Phase | Asset | Object | Type | Status |
|-------|-------|--------|------|--------|
| 1 | `Create_Re_Engagement_Opportunity` | Flow | v17: Added `StageName != 'Closed Lost'` to re-engagement lookup | Deployed + activated |
| 1 | `Create_Re_Engagement_Opportunity` | Flow | v18: Fixed recruiting lookup to use `Get_Triggering_Opp.Account.Id` | Deployed + activated |
| 2 | `Total_Re_Engagement_Opps__c` | Account | Rollup Summary (COUNT) | Created |
| 3 | `Most_Recent_Closed_Date__c` | Account | Rollup Summary (MAX DateTime) | Created |
| 4 | `Was_Re_Engaged__c` | Opportunity | Formula Field (Text) | Created |
| 4 | `Days_Since_Closed_Lost__c` | Opportunity | Formula Field (Number) — updated | Updated to use account-level rollup |
| 5 | `Re_Engagement_Eligible` | Opportunity | List View — added `Was_Re_Engaged__c` column | Updated |
| 5 | `Re_Engagement_Fields_Access` | — | Permission Set — 6 field permissions | Updated + assigned to 29 users |

### Round 3: Open Recruiting Opp Guard (2026-03-18)

**Bug 5**: Successfully re-engaged advisors with open recruiting opps still appeared as eligible.

**Root cause**: The list view filtered on `Open_Re_Engagement_Opps__c = 0` to prevent duplicate re-engagement. But when a re-engagement opp reaches "Re-Engaged" stage and spawns a new Recruiting opp, the rollup excludes "Re-Engaged" (by design — it counts *open* re-engagement opps). The result: `Open_Re_Engagement_Opps__c = 0` even though the advisor is actively being recruited via the new opp.

**Example**: Jeremy Dunlop, CFP® (`006VS00000D5GkcYAF`)
- Original recruiting opp: Closed Lost (Dec 2024)
- Re-engagement opp (`006VS00000SAU2CYAX`): Reached "Re-Engaged" stage
- New recruiting opp (`006VS00000XDky6YAD`): Currently in "Discovery"
- `Open_Re_Engagement_Opps__c = 0` (correctly — no *open* re-engagement opp)
- But original Closed Lost opp still appeared in the eligible list

**Fix**: New Account rollup `Open_Recruiting_Opps__c` (COUNT of Recruiting opps where stage != Closed Lost and != Joined) + Opportunity formula field to surface it + list view filter.

**Bug 6 (during Round 3)**: List view filter `Open_Recruiting_Opps__c equals 0` caused the entire list to show 0 records, despite SOQL returning 403 matching records. Root cause unclear — likely a Salesforce list view rendering issue with `equals 0` on newly created cross-object formula fields. **Fix**: Changed filter operation from `equals 0` to `lessThan 1`. List immediately recovered.

| Phase | Asset | Object | Type | Status |
|-------|-------|--------|------|--------|
| 1 | `Open_Recruiting_Opps__c` | Account | Rollup Summary (COUNT) | Created |
| 2 | `Open_Recruiting_Opps__c` | Opportunity | Formula Field (Number) — surfaces Account rollup | Created |
| 3 | `Re_Engagement_Eligible` | Opportunity | List View — added filter (`lessThan 1`) + column | Updated |
| 3 | `Re_Engagement_Fields_Access` | — | Permission Set — added 2 field permissions (Account + Opportunity) | Updated |

**Result**: Jeremy Dunlop now shows `Open_Recruiting_Opps__c = 1` and is excluded from the list. Eligible count dropped from 429 → **403** (26 records had active recruiting opps).

### Round 4: V2 — Dedup, Original Context, Re-Engagement Count (2026-03-18)

Three problems solved:

1. **Duplicate rows**: 14 accounts with multiple Closed Lost recruiting opps showed one row per opp (15 extra rows). Fixed with `Is_Latest_Closed_Lost__c` formula + list view filter.
2. **Missing original context**: Re-engaged advisors lost their original Closed Lost reason/details. Fixed with Account-level text fields + Record-Triggered Flow + Apex backfill + Opportunity formula fields.
3. **Missing re-engagement count**: No column showing attempt count. Fixed with `Re_Engagement_Opp_Count__c` formula surfacing `Account.Total_Re_Engagement_Opps__c`.

| Phase | Asset | Object | Type | Status |
|-------|-------|--------|------|--------|
| 1 | `Most_Recent_Recruiting_Closed_Date__c` | Account | Rollup Summary (MAX) — Recruiting Closed Lost only | Created |
| 1 | `Original_Closed_Lost_Reason__c` | Account | Text(255) — earliest recruiting opp's reason | Created |
| 1 | `Original_Closed_Lost_Details__c` | Account | Long Text Area(5000) — earliest recruiting opp's full details | Created |
| 1 | `Original_Closed_Lost_Details_Short__c` | Account | Text(255) — truncated copy for formula reference | Created |
| 2 | `Populate_Original_Closed_Lost` | Flow | Record-Triggered (After Save on Opportunity) — v2 active | Created + activated |
| 3 | Backfill script | Apex | One-time — populated 1,755 accounts (9 iterations × 200 + tail) | Executed |
| 3 | Short field backfill | Apex | One-time — populated Short field from LTA for all accounts | Executed |
| 4 | `Is_Latest_Closed_Lost__c` | Opportunity | Formula (Checkbox) — dedup + open recruiting guard | Created |
| 4 | `Re_Engagement_Opp_Count__c` | Opportunity | Formula (Number) — surfaces Account rollup | Created |
| 4 | `Original_Closed_Lost_Reason__c` | Opportunity | Formula (Text) — surfaces Account field | Created |
| 4 | `Original_Closed_Lost_Details__c` | Opportunity | Formula (Text) — surfaces Account Short field | Created |
| 5 | `Re_Engagement_Eligible` | Opportunity | List View — replaced `Open_Recruiting_Opps < 1` with `Is_Latest_Closed_Lost = 1`, added 3 columns | Updated |
| 5 | `Re_Engagement_Fields_Access` | — | Permission Set — added 8 field permissions | Updated |

**Key design decisions in Round 4**:

- **`Is_Latest_Closed_Lost__c` formula consolidates two checks**: (1) dedup by comparing opp's `Stage_Entered_Closed__c` to account's `Most_Recent_Recruiting_Closed_Date__c`, and (2) open recruiting opp guard (`Account.Open_Recruiting_Opps__c > 0` → false). This allowed replacing the `Open_Recruiting_Opps__c < 1` filter with `Is_Latest_Closed_Lost__c = 1`, staying within the 10-filter limit.

- **Two-field approach for Original Details**: Salesforce formula fields cannot reference Long Text Area fields. Solution: `Original_Closed_Lost_Details__c` (LTA, 5000 chars) preserves full data on Account; `Original_Closed_Lost_Details_Short__c` (Text, 255 chars) provides a formula-friendly truncated copy. The Opportunity formula references the Short field. 44 accounts have details > 255 chars — truncated in list view, full text on Account record.

- **Metadata API FLS requirement**: Deploying custom fields via Metadata API does NOT auto-grant visibility. Admin profile FLS must be deployed separately for fields to be queryable via SOQL/Apex.

- **Flow deploys as Draft**: `sf project deploy start` deploys Record-Triggered Flows as Draft. Activation requires a Tooling API PATCH: `PATCH /services/data/v66.0/tooling/sobjects/FlowDefinition/{id}` with body `{"Metadata":{"activeVersionNumber":N}}`.

- **Backfill null-reason accounts**: 12 accounts had null `Closed_Lost_Reason__c` on their earliest opp. These were set to `(none)` as a sentinel to prevent infinite re-selection in the backfill loop.

- **Backfill Short field empty string → null**: Salesforce converts empty string `''` to null on Text fields. Accounts with null Details were set to `(none)` sentinel in Short field to prevent infinite re-selection.

**Result**: List count dropped from 403 → **393** (10 duplicate rows removed). Dustin Granger appears once with Original Reason = "Other" and # of Re-Engagement Opps = 1.

---

## Bugs Found & Fixed During Implementation

### Bug 1: `Closed_Lost_Time_Bucket__c` returning "<1 month" for non-Closed-Lost opps

**Root cause**: Original guide specified `<formulaTreatBlanksAs>BlankAsZero</formulaTreatBlanksAs>`. When `Days_Since_Closed_Lost__c` is null (non-Closed-Lost opps), BlankAsZero treats it as 0, so `ISBLANK()` returns false and `0 < 30` matches the "<1 month" bucket.

**Fix**: Changed to `<formulaTreatBlanksAs>BlankAsBlank</formulaTreatBlanksAs>`. Now returns null for non-Closed-Lost opps.

### Bug 2: "Savvy Declined – Book Not Transferable" en dash mismatch

**Root cause**: The original guide used a hyphen (`-`, U+002D) in all 5 Savvy Declined filter values. However, the actual Salesforce picklist value for "Book Not Transferable" uses an **en dash** (`–`, U+2013). The list view filter didn't match, so 161 records leaked through.

**Fix**: Updated the list view XML filter and all SOQL queries to use the en dash character. Count dropped from 619 to 472 (then to 447 after the Days formula update shifted some records below 30 days).

### Bug 3: Screen Flow — Closed Lost re-engagement opps blocking repeat re-engagement (205 records)

**Root cause**: The `Get_Open_ReEngagement_Opportunities` Record Lookup in the Screen Flow only excluded `StageName != 'Re-Engaged'`. It was missing `StageName != 'Closed Lost'`, causing 205 Closed Lost re-engagement opps to be treated as "open" and blocking new re-engagement creation.

The Account rollup `Open_Re_Engagement_Opps__c` was correctly configured (excludes both Closed Lost and Re-Engaged), but the flow didn't use it — it ran its own SOQL query with the incomplete filter.

**Fix**: Added `StageName != 'Closed Lost'` filter to `Get_Open_ReEngagement_Opportunities` (deployed as v17).

### Bug 4: Screen Flow — Recruiting lookup using null AccountLookup.recordId (blocked ALL records)

**Root cause**: The `Get_Open_Recruiting_Opportunities` Record Lookup used `AccountLookup.recordId` as the AccountId filter. `AccountLookup` is a screen component that hasn't rendered yet when the lookups execute (they run before the screen). This caused `AccountLookup.recordId` to be null, and the query `AccountId = null` matched 2 orphaned Recruiting opps (B. Brandon Mackie and Steven Sivak, both "Planned Nurture" with no Account).

This bug was always present but hidden — the re-engagement check (Bug 3) fired first in the Decision, so users always saw that error instead.

**Fix**: Changed `AccountLookup.recordId` → `Get_Triggering_Opp.Account.Id` (which is reliably populated from the initial Record Lookup). This matches the pattern already used by the re-engagement lookup. Deployed as v18.

### Bug 5: Successfully re-engaged advisors with open recruiting opps still appear as eligible

See Round 3 above for full details.

### Bug 6: List view filter `equals 0` on new cross-object formula field shows 0 records

**Root cause**: Unknown — possibly a Salesforce list view rendering issue with `equals 0` on newly deployed cross-object formula fields. The SOQL query returned 403 records, the Account rollup was fully populated (2,283 accounts, 0 nulls), and the field definitions were identical to the working `Open_Re_Engagement_Opps__c` pattern.

**Fix**: Changed list view filter from `<operation>equals</operation><value>0</value>` to `<operation>lessThan</operation><value>1</value>`. List immediately recovered. This is a known workaround pattern for Salesforce list view filter issues.

### Bug 7 (Round 4): Salesforce formula fields cannot reference Long Text Area fields

**Root cause**: `Opportunity.Original_Closed_Lost_Details__c` formula referenced `Account.Original_Closed_Lost_Details__c` (LTA 5000). Salesforce rejects this with "You referenced an unsupported field type called 'Long Text Area'". Text(1300) was attempted but Salesforce Text max is 255.

**Fix**: Two-field approach — keep LTA for full data, add `Original_Closed_Lost_Details_Short__c` (Text 255) as formula-friendly copy. Opportunity formula references the Short field. 44 accounts have truncated details in the list view; full text preserved on Account.

### Bug 8 (Round 4): Metadata API deploy does not auto-grant field-level security

**Root cause**: Unlike Setup UI, deploying custom fields via Metadata API does not automatically add them to any profile. Fields exist in the org but are invisible to all users until FLS is explicitly granted.

**Fix**: Deploy an Admin profile XML with `<fieldPermissions>` for each new field. Must be deployed as a separate step after the field deploy succeeds.

### Bug 9 (Round 4): Metadata API deploy rolls back all components on partial failure

**Root cause**: When deploying 4 Opportunity formula fields, 1 failed (Bug 7). The deploy status showed "Components: 3/4" but the final "Status: Failed" meant all 4 were rolled back — not just the failing one.

**Fix**: After fixing the failing field, all 4 had to be redeployed (the 3 "successful" ones were never actually committed).

---

## Metadata Corrections from Original Guide

The original guide's XML templates required several corrections during deployment:

1. **Formula field `<length>` attribute**: Salesforce doesn't allow `<length>` on formula fields. Removed `<length>25</length>` from `Closed_Lost_Time_Bucket__c`.

2. **List view field reference format**: The guide used `Opportunity.Field__c` for custom field columns and `OPPORTUNITY.RECORD_TYPE` for the record type filter. The correct formats (verified by retrieving existing list views) are:
   - Standard field columns: `OPPORTUNITY.NAME`, `OPPORTUNITY.STAGE_NAME`
   - Custom field columns: bare API names (e.g., `SQL__c`, not `Opportunity.SQL__c`)
   - Custom field filters: bare API names (e.g., `Days_Since_Closed_Lost__c`)
   - Record type filter field: `OPPORTUNITY.RECORDTYPE` (no underscore, not `OPPORTUNITY.RECORD_TYPE`)

3. **FLS for new fields**: Newly deployed custom fields are not automatically visible to any profile. A permission set (`Re_Engagement_Fields_Access`) was required for field-level security. Additionally, an Admin profile deploy is needed to make fields visible to the deploying user for Apex/SOQL access.

4. **Flow activation**: `sf project deploy start` deploys flows as Draft, not Active. Activation requires a separate Tooling API PATCH to `FlowDefinition` setting `activeVersionNumber`.

5. **List view filter on formula fields**: Using `equals 0` on a newly deployed cross-object formula field can cause the list view to show 0 records. Use `lessThan 1` as a workaround.

6. **Account rollup → Opportunity proxy pattern**: Salesforce list views cannot filter directly on Account (parent) fields. To use an Account rollup in a list view filter, create a pass-through formula field on Opportunity (`Account.RollupField__c`) and filter on that.

7. **LTA fields cannot be referenced in formulas**: Salesforce formula fields cannot reference Long Text Area fields. Use a two-field pattern: LTA for full storage + Text(255) for formula reference.

8. **LTA fields cannot be filtered in SOQL WHERE clauses**: Even in Apex, `WHERE LongTextField != null` fails. Use a related Text field in the WHERE clause as a proxy.

9. **Salesforce converts empty string to null on Text fields**: Setting a Text field to `''` stores null, which breaks `WHERE field = null` loop termination in backfill scripts. Use a sentinel value like `(none)`.

---

## Current Deployed State (as of 2026-03-18)

### Opportunity Formula Fields

**`Days_Since_Closed_Lost__c`** (Number):
```
IF(
  ISPICKVAL(StageName, "Closed Lost"),
  TODAY() - DATEVALUE(
    IF(
      NOT(ISBLANK(Account.Most_Recent_Closed_Date__c)),
      Account.Most_Recent_Closed_Date__c,
      IF(
        ISBLANK(Stage_Entered_Closed__c),
        DATETIMEVALUE(TEXT(CloseDate) + " 00:00:00"),
        Stage_Entered_Closed__c
      )
    )
  ),
  NULL
)
```
- Priority: (1) Account rollup `Most_Recent_Closed_Date__c`, (2) opp's own `Stage_Entered_Closed__c`, (3) opp's own `CloseDate`
- `formulaTreatBlanksAs`: BlankAsZero

**`Closed_Lost_Time_Bucket__c`** (Text):
- Buckets: <1 month, 1–5 months, 6+ months
- `formulaTreatBlanksAs`: **BlankAsBlank** (critical — BlankAsZero causes "<1 month" for non-Closed-Lost opps)

**`Was_Re_Engaged__c`** (Text):
```
IF(Account.Total_Re_Engagement_Opps__c > 0, "Yes", "No")
```
- `formulaTreatBlanksAs`: BlankAsZero (null rollup → 0 → "No", which is correct)

**`Open_Re_Engagement_Opps__c`** (Number):
```
Account.Open_Re_Engagement_Opps__c
```
- Pass-through formula surfacing the Account rollup for list view use
- `formulaTreatBlanksAs`: BlankAsZero
- Pre-existing on both Account (rollup) and Opportunity (formula) before this project

**`Open_Recruiting_Opps__c`** (Number):
```
Account.Open_Recruiting_Opps__c
```
- Pass-through formula surfacing the Account rollup for list view use
- `formulaTreatBlanksAs`: BlankAsZero
- Added in Round 3 (2026-03-18)

**`Is_Latest_Closed_Lost__c`** (Checkbox):
```
IF(
  NOT(ISPICKVAL(StageName, "Closed Lost")),
  false,
  IF(
    Account.Open_Recruiting_Opps__c > 0,
    false,
    IF(
      ISBLANK(Stage_Entered_Closed__c),
      true,
      Stage_Entered_Closed__c = Account.Most_Recent_Recruiting_Closed_Date__c
    )
  )
)
```
- TRUE only for the most recent Closed Lost recruiting opp per account, AND only if no open recruiting opps exist
- Non-Closed-Lost opps → always false
- Account has open recruiting opps → always false (subsumes the old `Open_Recruiting_Opps < 1` filter)
- Null `Stage_Entered_Closed__c` → true (96 legacy records, all single-opp accounts)
- Otherwise → true only if opp's close date matches account's MAX recruiting close date
- `formulaTreatBlanksAs`: BlankAsZero
- Added in Round 4 (2026-03-18)

**`Re_Engagement_Opp_Count__c`** (Number):
```
Account.Total_Re_Engagement_Opps__c
```
- Surfaces the Account-level Total Re-Engagement Opps count
- `formulaTreatBlanksAs`: BlankAsZero
- Added in Round 4 (2026-03-18)

**`Original_Closed_Lost_Reason__c`** (Text):
```
Account.Original_Closed_Lost_Reason__c
```
- Surfaces the Account-level original Closed Lost reason from the earliest recruiting opp
- `formulaTreatBlanksAs`: BlankAsBlank
- Added in Round 4 (2026-03-18)

**`Original_Closed_Lost_Details__c`** (Text):
```
Account.Original_Closed_Lost_Details_Short__c
```
- Surfaces the Account-level truncated original details (first 255 chars)
- References the Short field, NOT the LTA field (formulas cannot reference LTA)
- `formulaTreatBlanksAs`: BlankAsBlank
- Added in Round 4 (2026-03-18)

### Account Rollup Fields

**`Total_Re_Engagement_Opps__c`** (Rollup Summary, COUNT):
- Counts ALL Re-Engagement opps on the Account (any stage)
- Filter: `RecordTypeId = Re-Engagement`

**`Most_Recent_Closed_Date__c`** (Rollup Summary, MAX DateTime):
- MAX of `Stage_Entered_Closed__c` across ALL Closed Lost opps (both Recruiting and Re-Engagement)
- Filter: `StageName = 'Closed Lost'` (no RecordType filter)

**`Open_Recruiting_Opps__c`** (Rollup Summary, COUNT):
- Counts Recruiting opps where stage is NOT Closed Lost and NOT Joined
- Filters: `RecordTypeId = Recruiting` AND `StageName != 'Closed Lost'` AND `StageName != 'Joined'`
- Added in Round 3 (2026-03-18)

**`Most_Recent_Recruiting_Closed_Date__c`** (Rollup Summary, MAX DateTime):
- MAX of `Stage_Entered_Closed__c` across **Recruiting** Closed Lost opps only
- Filters: `RecordTypeId = Recruiting` AND `StageName = 'Closed Lost'`
- Used by `Is_Latest_Closed_Lost__c` formula for dedup comparison
- Key difference from `Most_Recent_Closed_Date__c`: scoped to Recruiting only (excludes Re-Engagement opps)
- Added in Round 4 (2026-03-18)

### Account Text Fields (Original Closed Lost Context)

**`Original_Closed_Lost_Reason__c`** (Text 255):
- The Closed Lost Reason from the earliest Recruiting opp on this account
- Populated by `Populate_Original_Closed_Lost` flow (ongoing) + Apex backfill (historical)
- Added in Round 4 (2026-03-18)

**`Original_Closed_Lost_Details__c`** (Long Text Area 5000):
- The Closed Lost Details from the earliest Recruiting opp — full text, never truncated
- Populated by `Populate_Original_Closed_Lost` flow (ongoing) + Apex backfill (historical)
- Added in Round 4 (2026-03-18)

**`Original_Closed_Lost_Details_Short__c`** (Text 255):
- Truncated copy of `Original_Closed_Lost_Details__c` for formula field reference
- Salesforce formula fields cannot reference Long Text Area fields, so this Text(255) field serves as the formula-friendly proxy
- 44 accounts have details > 255 chars — truncated here, full text in LTA field
- Populated by `Populate_Original_Closed_Lost` flow (ongoing, SF auto-truncates Text(255) on write) + Apex backfill (historical, explicit substring)
- Added in Round 4 (2026-03-18)

### Record-Triggered Flow

**`Populate_Original_Closed_Lost`** (v2, Active):
- **Trigger**: After Save on Opportunity (Create and Update)
- **Entry conditions**: RecordTypeId = Recruiting AND StageName = 'Closed Lost' AND AccountId IS NOT NULL AND StageName IsChanged = true
- **Logic**: Queries the earliest Recruiting Closed Lost opp on the Account (sorted by CreatedDate ASC, first record only), then updates the Account's three original fields (Reason, Details LTA, Details Short)
- **IsChanged guard**: Prevents unnecessary re-runs when editing non-stage fields on an already-closed opp
- **Timing dependency**: The `Opportunity_Stage_Entered_Closed_Update` flow (Before Save) sets `Stage_Entered_Closed__c` before this After Save flow queries it — verified safe
- Added in Round 4 (2026-03-18)

### Validation Rule

**`Block_Re_Engagement_If_One_Exists`** (Active):
- Fires when `Create_Re_Engagement__c` checkbox is checked AND `Open_Re_Engagement_Opps__c > 0`
- Protects against the bulk flow bypassing the Screen Flow's validation

### List View: Re-Engagement Eligible

**Columns** (14, in order):
1. `OPPORTUNITY.NAME`
2. `SGA__c`
3. `Was_Re_Engaged__c`
4. `Re_Engagement_Opp_Count__c` *(added Round 4)*
5. `Original_Closed_Lost_Reason__c` *(added Round 4)*
6. `Original_Closed_Lost_Details__c` *(added Round 4)*
7. `Stage_Entered_Closed__c`
8. `Days_Since_Closed_Lost__c`
9. `Closed_Lost_Time_Bucket__c`
10. `SQL__c`
11. `Closed_Lost_Reason__c`
12. `Closed_Lost_Details__c`
13. `Open_Re_Engagement_Opps__c`
14. `FA_CRD__c`

**Filters** (10 total — Salesforce list view maximum):
1. Record Type = Recruiting
2. Stage = Closed Lost
3. Days Since Closed Lost >= 30
4. Open Re-Engagement Opps equals 0
5. **Is Latest Closed Lost equals 1** *(replaced `Open Recruiting Opps lessThan 1` in Round 4 — formula already includes the open recruiting opps guard)*
6. Closed Lost Reason != Savvy Declined - No Book of Business
7. Closed Lost Reason != Savvy Declined - Insufficient Revenue
8. Closed Lost Reason != Savvy Declined – Book Not Transferable (en dash U+2013)
9. Closed Lost Reason != Savvy Declined - Poor Culture Fit
10. Closed Lost Reason != Savvy Declined - Compliance

**Visibility**: `filterScope=Everything`, `sharedTo > allInternalUsers`

### Screen Flow: Create_Re_Engagement_Opportunity (v18)

Two bugs fixed from v16:

**v17** — `Get_Open_ReEngagement_Opportunities` filters:
1. `AccountId` = `Get_Triggering_Opp.Account.Id`
2. `RecordTypeId` = Re-Engagement
3. `StageName` != `Re-Engaged`
4. **`StageName` != `Closed Lost`** (added — Bug 3 fix)

**v18** — `Get_Open_Recruiting_Opportunities` filters:
1. **`AccountId` = `Get_Triggering_Opp.Account.Id`** (changed from `AccountLookup.recordId` — Bug 4 fix)
2. `RecordTypeId` = Recruiting
3. `StageName` != `Closed Lost`
4. `StageName` != `Joined`

### Permission Set: Re_Engagement_Fields_Access

**Field permissions** (16 fields, all read-only):
- `Opportunity.Days_Since_Closed_Lost__c`
- `Opportunity.Closed_Lost_Time_Bucket__c`
- `Opportunity.Was_Re_Engaged__c`
- `Opportunity.Open_Recruiting_Opps__c`
- `Opportunity.Is_Latest_Closed_Lost__c` *(added Round 4)*
- `Opportunity.Re_Engagement_Opp_Count__c` *(added Round 4)*
- `Opportunity.Original_Closed_Lost_Reason__c` *(added Round 4)*
- `Opportunity.Original_Closed_Lost_Details__c` *(added Round 4)*
- `Account.Total_Re_Engagement_Opps__c`
- `Account.Most_Recent_Closed_Date__c`
- `Account.Open_Recruiting_Opps__c`
- `Account.Most_Recent_Recruiting_Closed_Date__c` *(added Round 4)*
- `Account.Original_Closed_Lost_Reason__c` *(added Round 4)*
- `Account.Original_Closed_Lost_Details__c` *(added Round 4)*
- `Account.Original_Closed_Lost_Details_Short__c` *(added Round 4)*

**Assigned to**: russell.moss@savvywealth.com + all 28 active Standard User profile users (29 total)

---

## Validation Results

### Round 1+2 (2026-03-17)

- **447** eligible records in list view
- Distribution: 129 (1 month), 32 (2 months), 53 (3 months), 84 (4 months), 39 (5 months), 110 (6+ months)

**Key Verification: Alejandro Rubinstein (`006VS000005janeYAA`)**
- Original recruiting opp closed 2024-07-18 (607 days ago)
- Re-engagement opp also closed lost 2026-02-09 (36 days ago)
- **Before fix**: Days = 607, Bucket = "6+ months since lost", flow blocked
- **After fix**: Days = 36, Bucket = "1 month since lost", Was Re-Engaged = "Yes", flow allows re-engagement

### Round 3 (2026-03-18)

- **403** eligible records in list view (down from 429 before Open Recruiting Opps filter; 447 on 3/17)
- Savvy Declined excluded: 557 correctly filtered out, 0 leaking
- 23 re-engagement opps created since initial deploy — list is actively being used
- BlankAsBlank fix confirmed: 0 non-Closed-Lost records have a `Closed_Lost_Time_Bucket__c` value
- Flow v18 confirmed active: `ActiveVersionId = LatestVersionId`

**Key Verification: Jeremy Dunlop, CFP® (`006VS00000D5GkcYAF`)**
- `Open_Recruiting_Opps__c = 1` (Discovery opp exists)
- Correctly **excluded** from the list

### Round 4 — V2 (2026-03-18)

- **393** eligible records in list view (down from 403 — 10 duplicate rows removed by `Is_Latest_Closed_Lost__c` filter)
- 1,755 accounts backfilled with original Closed Lost reason/details (9 iterations × 200 + 155 tail)
- 12 accounts had null `Closed_Lost_Reason__c` on earliest opp — stored as `(none)` sentinel
- 44 accounts have `Original_Closed_Lost_Details__c` > 255 chars — truncated in Short field, full text in LTA
- All null-timestamp opps with no open recruiting opps correctly show `Is_Latest_Closed_Lost__c = true`
- 10 null-timestamp opps show `Is_Latest_Closed_Lost__c = false` — all have `Open_Recruiting_Opps__c = 1` (correctly excluded by formula guard)

**Key Verification: Dustin Granger (Account `001VS00000GoeCLYAZ`)**

| Field | CkdXJ (original opp) | WP4HJ (latest opp) |
|-------|----------------------|---------------------|
| Is_Latest_Closed_Lost | **false** | **true** |
| Re_Engagement_Opp_Count | 1 | 1 |
| Original_Closed_Lost_Reason | Other | Other |
| Original_Closed_Lost_Details | (JE creating...) | (JE creating...) |
| Closed_Lost_Reason | Other | Candidate Declined - Operational Constraints |
| Was_Re_Engaged | Yes | Yes |
| Open_Recruiting_Opps | 0 | 0 |

Only WP4HJ appears in the list (Is_Latest = true). Dustin Granger now shows **one** row with both his current reason ("Candidate Declined") and original reason ("Other").

**Key Verification: Jeremy Dunlop, CFP® (`006VS00000D5GkcYAF`)**
- `Is_Latest_Closed_Lost__c = false` (Open_Recruiting_Opps = 1)
- Correctly **excluded** from the list via the formula guard baked into `Is_Latest_Closed_Lost__c`

### Data Notes
- 2 orphaned Recruiting opps with null AccountId exist (B. Brandon Mackie, Steven Sivak) — caused Bug 4
- Records where `Most_Recent_Closed_Date__c` is null (all `Stage_Entered_Closed__c` values null on older records) fall back to the opp's own date logic — no behavior change for those records
- 96 opps have null `Stage_Entered_Closed__c` — all are single-opp accounts, so `Is_Latest_Closed_Lost__c` defaults to true (ISBLANK fallback)

---

## Known Limitations

1. **Original Details truncation in list view**: 44 accounts have original Closed Lost details longer than 255 characters. The list view column shows the first 255 chars via the Short field. Full details are preserved in the Account-level LTA field (`Original_Closed_Lost_Details__c`) and accessible on the Account record.

2. **10-filter limit**: The list view uses all 10 allowed Salesforce filter conditions. Any new filter requires consolidating an existing one into a formula.

3. **Two opps closing at the exact same second**: Both would show `Is_Latest_Closed_Lost__c = true`, creating a duplicate row. Extremely unlikely; cosmetic issue only if it occurs.

4. **`Is_Latest_Closed_Lost__c` semantic scope**: The formula returns true for any Closed Lost opp (including Re-Engagement record type) that matches the account's MAX close date. No functional impact — the list view already filters on RecordType = Recruiting before evaluating this formula.

5. **Backfill sentinel values**: 12 accounts with null `Closed_Lost_Reason__c` have `Original_Closed_Lost_Reason__c = '(none)'`. Accounts with null details have `Original_Closed_Lost_Details_Short__c = '(none)'`. These render as literal text in the list view.

---

## Rollback Plan

**Dependency order** (remove in reverse):

### Round 4 rollback (v2 enhancements)
1. **List view**: Redeploy with `Open_Recruiting_Opps__c lessThan 1` filter restored, `Is_Latest_Closed_Lost__c` filter removed, 3 new columns removed
2. **Opportunity formulas**: Delete `Is_Latest_Closed_Lost__c`, `Re_Engagement_Opp_Count__c`, `Original_Closed_Lost_Reason__c`, `Original_Closed_Lost_Details__c` via Setup → Object Manager
3. **Flow**: Deactivate `Populate_Original_Closed_Lost` via Setup → Flows
4. **Account text fields**: Delete `Original_Closed_Lost_Reason__c`, `Original_Closed_Lost_Details__c`, `Original_Closed_Lost_Details_Short__c` via Setup (must remove Opportunity formula references first)
5. **Account rollup**: Delete `Most_Recent_Recruiting_Closed_Date__c` via Setup (must remove Opportunity formula references first)
6. **Permission set**: Redeploy without the 8 new field permissions (extra permissions are non-breaking, but clean up is nice)

### Round 3 rollback
1. **List view**: Redeploy without `Open_Recruiting_Opps__c` filter and column
2. **Opportunity formula**: Delete `Open_Recruiting_Opps__c` via Setup → Object Manager → Opportunity → Fields
3. **Account rollup**: Delete `Open_Recruiting_Opps__c` via Setup → Object Manager → Account → Fields
4. **Permission set**: Redeploy without the 2 Round 3 field permissions

### Full rollback (all rounds)
1. **List view**: Redeploy without custom columns, or delete via UI
2. **Opportunity formulas**: Delete all custom formula fields
3. **Account rollups**: Delete all custom rollup fields (must remove formula references first)
4. **Flows**: Deactivate `Populate_Original_Closed_Lost`; reactivate Screen Flow v16 via Setup → Flows
5. **Validation rule**: Deactivate via Setup → Object Manager → Opportunity → Validation Rules
6. **Permission set**: No rollback needed (additional permissions are non-breaking)

Backup of original `Days_Since_Closed_Lost__c` formula: `force-app/main/default/objects/Opportunity/fields/Days_Since_Closed_Lost__c.field-meta.xml.bak`
Backup of original flow XML: `force-app/main/default/flows/Create_Re_Engagement_Opportunity.flow-meta.xml.bak`

---

## SFDX Project Structure (current)

```
C:\Users\russe\Documents\Dashboard\salesforce\
├── sfdx-project.json
├── backfill_original_closed_lost.apex (one-time, can delete)
├── backfill_null_reason.apex (one-time, can delete)
├── backfill_short_details.apex (one-time, can delete)
├── check_long_details.apex (one-time, can delete)
└── force-app/
    └── main/
        └── default/
            ├── flows/
            │   ├── Bulk_Create_Re_Engagement_Opportunity.flow-meta.xml
            │   ├── Create_Re_Engagement_Opportunity.flow-meta.xml (v18)
            │   ├── Create_Re_Engagement_Opportunity.flow-meta.xml.bak (v16 backup)
            │   └── Populate_Original_Closed_Lost.flow-meta.xml (v2, Round 4)
            ├── objects/
            │   ├── Account/
            │   │   └── fields/
            │   │       ├── Most_Recent_Closed_Date__c.field-meta.xml
            │   │       ├── Most_Recent_Recruiting_Closed_Date__c.field-meta.xml (Round 4)
            │   │       ├── Open_Recruiting_Opps__c.field-meta.xml (Round 3)
            │   │       ├── Original_Closed_Lost_Details__c.field-meta.xml (Round 4, LTA 5000)
            │   │       ├── Original_Closed_Lost_Details_Short__c.field-meta.xml (Round 4, Text 255)
            │   │       ├── Original_Closed_Lost_Reason__c.field-meta.xml (Round 4)
            │   │       └── Total_Re_Engagement_Opps__c.field-meta.xml
            │   └── Opportunity/
            │       ├── Opportunity.object-meta.xml (retrieved reference)
            │       ├── fields/
            │       │   ├── Closed_Lost_Time_Bucket__c.field-meta.xml
            │       │   ├── Days_Since_Closed_Lost__c.field-meta.xml
            │       │   ├── Days_Since_Closed_Lost__c.field-meta.xml.bak (original backup)
            │       │   ├── Is_Latest_Closed_Lost__c.field-meta.xml (Round 4)
            │       │   ├── Open_Re_Engagement_Opps__c.field-meta.xml (retrieved reference)
            │       │   ├── Open_Recruiting_Opps__c.field-meta.xml (Round 3)
            │       │   ├── Original_Closed_Lost_Details__c.field-meta.xml (Round 4, refs Short field)
            │       │   ├── Original_Closed_Lost_Reason__c.field-meta.xml (Round 4)
            │       │   ├── Re_Engagement_Opp_Count__c.field-meta.xml (Round 4)
            │       │   └── Was_Re_Engaged__c.field-meta.xml
            │       ├── listViews/
            │       │   ├── AllOpportunities.listView-meta.xml (retrieved reference)
            │       │   ├── DH_Re_Engagement.listView-meta.xml (retrieved reference)
            │       │   └── Re_Engagement_Eligible.listView-meta.xml
            │       └── validationRules/
            │           └── Block_Re_Engagement_If_One_Exists.validationRule-meta.xml
            ├── permissionsets/
            │   └── Re_Engagement_Fields_Access.permissionset-meta.xml
            └── profiles/
                └── Admin.profile-meta.xml (FLS for new fields)
```
