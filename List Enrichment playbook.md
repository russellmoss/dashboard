# List Enrichment When You Have Name, LinkedIn, Email and Firm

**Purpose:** A reusable playbook for taking any list of financial advisors (conference attendees, event registrants, purchased lists, etc.) and enriching it with FinTrx data, lead scores, and Salesforce disposition history. Follow these steps in order — each phase builds on the previous one.

---

## What You Start With

A list (CSV, Google Sheet, or export) with some combination of:

- **Name** (first \+ last, or full name)  
- **Company / Firm name**  
- **Title**  
- **Email**  
- **LinkedIn URL**

Not every row will have every field. That's fine — the pipeline is designed to handle gaps.

## What You End With

Every advisor you can confidently identify gets:

- **CRD number** (the unique advisor identifier in FinTrx and FINRA)  
- **FinTrx profile data** — firm AUM, rep AUM, producing advisor status, age range, disclosures, title  
- **Lead scores** — V3 tier and V4 percentile from the scoring pipeline  
- **Exclusion narrative** — if they don't score, exactly why (age, disclosures, title, firm, etc.)  
- **Salesforce history** — whether we've contacted them before, disposition, close lost reason/detail

---

## Tiered Matching Strategy (Tiers 1–4)

Matching is applied in **4 tiers** in order. Once a row gets a CRD from a higher tier, lower tiers skip it. Only rows still unmatched after Tier 1 are considered for Tier 2, and so on.

---

### Tier 1 — LinkedIn

**Goal:** Match rows using LinkedIn URLs. Highest-confidence method.

**Process:**

1. Normalize URLs on both sides: lowercase, strip protocol, `www`, trailing slashes, query params, and fragments.  
2. Match list normalized URL to FinTrx `LINKEDIN_PROFILE_URL` (normalized the same way).  
3. On match: assign CRD for every match.

**URL normalization:** Lowercase; strip `https://` / `http://`, `www.`, trailing slashes, query parameters, fragments. Result: `linkedin.com/in/username`.

**Example:**

```
Input:    https://www.LinkedIn.com/in/JohnSmith/?utm_source=conference
Normalized: linkedin.com/in/johnsmith
```

**Confidence sub-labels** (assign after match):

| Label | What matched |
| :---- | :---- |
| `linkedin_plus_name_plus_firm` | URL, name, and firm all confirmed |
| `linkedin_plus_name` | URL \+ name; firm differs (advisor may have moved) |
| `linkedin_plus_firm` | URL \+ firm; name differs (name variant, maiden name) |
| `linkedin_only` | URL only — name and firm didn't confirm |

**Rule:** Never match on firm alone. Firm is only a supporting signal.

**Result:** Rows with a LinkedIn match get CRD and move to Phase 3\. All others continue to Tier 2\.

---

### Tier 2 — Email

**Goal:** For **unmatched rows only**, match on email. Checking all three FinTrx email fields is critical.

**Process:**

1. Normalize list email: `LOWER(TRIM(email))`.  
2. Match against all three FinTrx fields: `EMAIL`, `ADDITIONAL_EMAIL`, `PERSONAL_EMAIL_ADDRESS` (normalized the same way).  
3. **Single-CRD rule:**  
   - If email maps to **exactly 1 CRD** → assign that CRD.  
   - If email maps to **2+ CRDs** → assign only if exactly one of those CRDs also matches on name \+ (city/state or firm); otherwise flag for manual review.

**Why all three fields:** Exploration showed 6,929 contacts have only `ADDITIONAL_EMAIL` and 12,259 have only `PERSONAL_EMAIL_ADDRESS`. Relying on `EMAIL` alone misses many matches.

**Result:** 99.78% of emails in FinTrx map to exactly one CRD, so this tier has high yield. Rows that get a CRD move to Phase 3; the rest continue to Tier 3\.

---

### Tier 3 — Name \+ City \+ State

**Goal:** For **unmatched rows only**, match on name and location. Only assign when exactly one CRD matches.

**Process:**

1. Parse list: last name (exact), first name (with nickname awareness), city (exact, lowercased), state (see below).  
2. Match last name to `CONTACT_LAST_NAME` (exact) and first name to any of: `CONTACT_FIRST_NAME`, `RIA_CONTACT_FIRST_NAME_OTHER`, `RIA_CONTACT_PREFERRED_NAME`.  
3. Match city (exact, lowercased) and state normalized to **2-letter** (see below).  
4. **Single-match rule:** Only assign if **exactly 1** CRD matches. 0 \= leave unmatched; 2+ \= manual review.

**State normalization:** List states are often full names ("Texas", "California"); FinTrx is consistently 2-letter. Use a US state name → 2-letter mapping. For international entries (e.g. Canadian provinces, "London"), set state to NULL so the row skips this tier.

**Name parsing:** First word \= first name, rest \= last name (e.g. `Wayne Anderman` → first: `Wayne`, last: `Anderman`). Nickname fields in FinTrx handle Bob/Robert, Liz/Elizabeth, etc.

**Result:** Adding city+state resolves 168,454 previously-ambiguous name combos to exactly one CRD. Rows that get a CRD move to Phase 3; the rest continue to Tier 4\.

---

### Tier 4 — Name \+ Firm

**Goal:** For **unmatched rows only**, match on name and firm. Lowest-confidence automated tier.

**Process:**

1. Use same name matching as Tier 3 (last name \+ first name with nickname awareness).  
2. Match firm using **substring matching in both directions** (list firm in FinTrx firm name, and FinTrx firm name in list firm), since firm names are noisy.  
3. **Single-match rule only:** Assign only if exactly one CRD matches. 0 \= unmatched; 2+ \= manual review.

**Recommendation:** Spot-check 100% of Tier 4 matches before outreach.

---

### What gets backfilled on any tier match

- `CRD` — the advisor's CRD number  
- `LINKEDIN_PROFILE_URL` — from FinTrx (if available)  
- `PRIMARY_FIRM_TOTAL_AUM`, `REP_AUM`, `PRODUCING_ADVISOR` — for enrichment

---

### Do not use: Tier 5 — Name only

We tested matching when a first+last name combo existed **only once** in all of FinTrx (globally unique name). This produced too many false positives (non-advisors matching to random unique names). **Do not use name-only matching without at least one confirmatory signal** (location, firm, email, or LinkedIn).

---

## Phase 3: FinTrx Enrichment

**Goal:** Now that you have CRDs, pull the full advisor and firm profile from FinTrx.

### Data sources

| Table | Key field | What you get |
| :---- | :---- | :---- |
| `FinTrx_data_CA.ria_contacts_current` | `RIA_CONTACT_CRD_ID` | Advisor-level data: name, title, age range, disclosures, LinkedIn URL, rep AUM, firm affiliation |
| `FinTrx_data_CA.ria_firms_current` | `CRD_ID` (join via `PRIMARY_FIRM`) | Firm-level data: total AUM, discretionary AUM, number of advisors, firm type |

### Key fields to extract

**From `ria_contacts_current` (advisor level):**

- `CONTACT_FIRST_NAME`, `CONTACT_LAST_NAME` — canonical name  
- `TITLE_NAME` — current title  
- `PRIMARY_FIRM_NAME` — firm they're registered with  
- `PRIMARY_FIRM` — firm CRD (used to join to firm table)  
- `AGE_RANGE` — age bracket  
- `REP_AUM` — individual AUM  
- `PRODUCING_ADVISOR` — whether they're a producing advisor  
- `LINKEDIN_PROFILE_URL` — their LinkedIn  
- `CONTACT_HAS_DISCLOSED_*` — disclosure flags (criminal, regulatory, termination, investigation, customer dispute, civil, bond)

**From `ria_firms_current` (firm level):**

- `TOTAL_AUM` — firm total AUM  
- `DISCRETIONARY_AUM` — firm discretionary AUM (used to calculate discretionary ratio)  
- Firm metadata (type, registration status, etc.)

### CRD type casting

FinTrx stores CRDs inconsistently (sometimes as strings, floats, or integers). Always normalize with this pattern in SQL:

```sql
SAFE_CAST(ROUND(SAFE_CAST(RIA_CONTACT_CRD_ID AS FLOAT64), 0) AS INT64)
```

Use this same pattern everywhere you join on CRD — in FinTrx queries, scoring queries, and Salesforce lookups.

---

## Phase 4: Lead Scoring

**Goal:** Run every matched CRD through the V3+V4 scoring pipeline to get a tier and percentile.

### How it works

1. Upload all unique CRDs to a BigQuery staging table  
2. Run the lead list scoring SQL (e.g., `January_2026_Lead_List_V3_V4_Hybrid.sql`) restricted to your CRD list  
3. The query injects an `input_crds` CTE to filter `base_prospects` to only your list  
4. Scores are merged back into your CSV

### Output columns

| Column | Description |
| :---- | :---- |
| `score_tier` | V3 tier (e.g., Tier 1, Tier 2, Tier 3). Only populated if the advisor passes all pipeline filters. |
| `v4_score` | Raw V4 model score |
| `v4_percentile` | V4 percentile rank (higher \= better fit for Savvy) |
| `narrative` | V3 scoring narrative OR a specific exclusion reason |

### Exclusion diagnostics

For any advisor who doesn't receive a `score_tier`, the narrative tells you exactly which filter excluded them, checked in this order:

1. **Not in FinTrx** — CRD doesn't exist in `ria_contacts_current`  
2. **Age over 70** — age range is 70+  
3. **Disclosures** — criminal, regulatory, termination, investigation, customer dispute, civil, or bond  
4. **Title excluded** — paraplanner, operations, wholesaler, compliance, assistant, insurance agent, CFO, CIO, VP, etc.  
5. **Firm excluded** — wirehouse/BD/insurance name pattern match, or specific firm CRD on exclusion list  
6. **Base exclusion** — not a producing advisor, missing required fields  
7. **Turnover ≥ 100%** — firm has full advisor turnover  
8. **Low discretionary AUM** — firm discretionary ratio below 50%  
9. **Recent promotee** — less than 5 years tenure with mid/senior title  
10. **No V4 score** — not in the V4 prospect universe  
11. **V4 bottom 20%** — deprioritized due to low V4 percentile

If the advisor has a V4 score but was excluded for a different reason, the narrative includes both (e.g., `"Title excluded. Has V4 score (percentile 72)."`).

---

## Phase 5: Salesforce History Lookup

**Goal:** Check whether we've already contacted, qualified, or lost each advisor — and if so, why.

### How the CRD maps to Salesforce

The CRD number links to Salesforce via the **`FA_CRD__c`** custom field (in BigQuery the column name is `FA_CRD__c`), which exists on both the **Lead** and **Opportunity** objects.

### BigQuery tables (Salesforce synced)

Salesforce data is synced to BigQuery at:

| Object | Full table path |
| :---- | :---- |
| Lead | `savvy-gtm-analytics.SavvyGTMData.Lead` |
| Opportunity | `savvy-gtm-analytics.SavvyGTMData.Opportunity` |

### BigQuery schema reference

**Lead** — columns relevant to CRD history lookup:

| Column | Data type | Populated (sample) | Notes |
| :---- | :---- | :---- | :---- |
| `Id` | STRING | Yes | Salesforce record ID, 18 chars (e.g. `00QDn000007DMRQMA4`) |
| `FA_CRD__c` | STRING | Yes | Advisor CRD — **join key**; stored as string (e.g. `"7774903"`) |
| `Status` | STRING | Yes | Lead status (e.g. New, Working, Qualified, Disqualified, Closed) |
| `Disposition__c` | STRING | Yes | Disposition outcome (e.g. Interested, Not Interested, No Answer, Bad Data, Other) |

**Opportunity** — columns relevant to CRD history lookup:

| Column | Data type | Populated (sample) | Notes |
| :---- | :---- | :---- | :---- |
| `Id` | STRING | Yes | Salesforce record ID, 18 chars (e.g. `006Dn000008S4coIAC`) |
| `FA_CRD__c` | STRING | Yes | Advisor CRD — **join key**; stored as string (e.g. `"4572427"`) |
| `StageName` | STRING | Yes | Opportunity stage (e.g. Closed Lost, Joined) |
| `IsClosed` | BOOLEAN | Yes | Whether the opportunity is closed |
| `IsWon` | BOOLEAN | Yes | Whether it was won |
| `Closed_Lost_Reason__c` | STRING | Yes | Why we lost (e.g. Savvy Declined \- Insufficient Revenue, Timing, Compensation) |
| `Closed_Lost_Details__c` | STRING | Yes | Free-text detail on the loss reason (nullable) |

**Column name corrections (vs generic SOQL):** In BigQuery the close-lost fields are **`Closed_Lost_Reason__c`** and **`Closed_Lost_Details__c`** (not `Close_Lost_Reason__c` / `Close_Lost_Detail__c`). The Opportunity table in BQ does **not** have a `Disposition__c` column; use Lead for disposition when needed.

### CRD join and type casting

- **FinTrx** CRD is normalized as **INT64** (e.g. `SAFE_CAST(ROUND(SAFE_CAST(RIA_CONTACT_CRD_ID AS FLOAT64), 0) AS INT64)`).  
- **BigQuery Lead/Opportunity** `FA_CRD__c` is **STRING** (e.g. `"7774903"`).  
- When joining enrichment CRDs to Lead/Opportunity, either:  
  - Cast FinTrx CRD to STRING: `CAST(normalized_crd AS STRING) = l.FA_CRD__c`, or  
  - Cast BQ to INT64: `SAFE_CAST(l.FA_CRD__c AS INT64) = normalized_crd`.

Use one side consistently in all joins.

### Salesforce URL patterns (clickable links)

Output **clickable Salesforce URLs** so the team can open the record directly. Construct them from the record `Id`:

| Object | URL pattern | SQL (BigQuery) |
| :---- | :---- | :---- |
| Lead | `https://savvywealth.lightning.force.com/lightning/r/Lead/{Id}/view` | `CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', Id, '/view') AS lead_url` |
| Opportunity | `https://savvywealth.lightning.force.com/lightning/r/Opportunity/{Id}/view` | `CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', Id, '/view') AS opp_url` |

The final output columns the team sees should be `lead_url` and `opp_url` (full clickable URLs), not raw `Id` values.

**When a CRD has multiple Leads or Opportunities:** Take the **most recent** one per CRD (order by `CreatedDate DESC`, take row 1). That surfaces the latest Salesforce interaction, not the oldest.

### What to extract

**From Lead** — output columns for the list:

| Output column | What it is |
| :---- | :---- |
| `lead_url` | Clickable URL: `CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', Id, '/view')` — use most recent Lead per CRD |
| `Status` | Current lead status (e.g., New, Working, Qualified, Disqualified) |
| `Disposition__c` | The disposition outcome (e.g., Interested, Not Interested, No Answer, Bad Data) |

**From Opportunity** — output columns for the list:

| Output column | What it is |
| :---- | :---- |
| `opp_url` | Clickable URL: `CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', Id, '/view')` — use most recent Opportunity per CRD |
| `StageName` | Current opportunity stage |
| `IsClosed` | Whether the opportunity is closed |
| `IsWon` | Whether it was won |
| `Closed_Lost_Reason__c` | Why we lost (e.g., Timing, Compensation, Technology, Compliance) |
| `Closed_Lost_Details__c` | Free-text detail on the loss reason (nullable) |

### Query approach

**Option A: SOQL (direct Salesforce query)** — build URLs in your app or export step; for "most recent" per CRD, order by `CreatedDate DESC` and take one row per CRD.

**Option B: BigQuery (Salesforce data synced)** — output `lead_url` and `opp_url` using CONCAT; take most recent record per CRD.

Example: one row per CRD with clickable URLs (most recent Lead and Opportunity per CRD):

```sql
-- Lead: most recent per CRD, output lead_url
SELECT
  FA_CRD__c,
  CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', Id, '/view') AS lead_url,
  Status,
  Disposition__c
FROM (
  SELECT Id, FA_CRD__c, Status, Disposition__c, CreatedDate,
         ROW_NUMBER() OVER (PARTITION BY FA_CRD__c ORDER BY CreatedDate DESC) AS rn
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE FA_CRD__c IS NOT NULL AND FA_CRD__c IN UNNEST(@crd_list)
)
WHERE rn = 1
```

```sql
-- Opportunity: most recent per CRD, output opp_url
SELECT
  FA_CRD__c,
  CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', Id, '/view') AS opp_url,
  StageName,
  IsClosed,
  IsWon,
  Closed_Lost_Reason__c,
  Closed_Lost_Details__c
FROM (
  SELECT Id, FA_CRD__c, StageName, IsClosed, IsWon, Closed_Lost_Reason__c, Closed_Lost_Details__c, CreatedDate,
         ROW_NUMBER() OVER (PARTITION BY FA_CRD__c ORDER BY CreatedDate DESC) AS rn
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE FA_CRD__c IS NOT NULL AND FA_CRD__c IN UNNEST(@crd_list)
)
WHERE rn = 1
```

Remember: `FA_CRD__c` in BQ is STRING; cast your CRD list to STRING when joining, or cast `FA_CRD__c` to INT64 to match FinTrx-normalized CRDs.

### How to use the Salesforce data

This lookup tells you:

- **Has this advisor been contacted before?** If their CRD appears in Lead or Opportunity, yes.  
- **What happened?** The disposition and close lost reason tell you why it didn't convert.  
- **Should we re-engage?** An advisor who was "Not Interested — Timing" a year ago may be worth re-contacting. An advisor who was "Not Interested — Not an RIA" is probably not.

Merge this data into your scored CSV so the outreach team has full context before making calls.

---

## General Workflow Checklist

Use this checklist every time you run this pipeline on a new list.

### Preparation

- [ ] Source list exported as CSV or Google Sheet  
- [ ] Columns identified: name, LinkedIn URL, firm, title (not all required)  
- [ ] `gcloud auth application-default login` is active  
- [ ] Dependencies installed (`google-cloud-bigquery`, `pandas`)  
- [ ] Lead list scoring SQL is current in `pipeline/sql/`

### Tiers 1–4 — Matching (in order)

- [ ] **Tier 1:** Normalize LinkedIn URLs; query FinTrx by normalized URL; assign CRDs; record confidence sub-label (`linkedin_plus_name_plus_firm`, `linkedin_plus_name`, etc.)  
- [ ] **Tier 2:** For unmatched rows, match list email to FinTrx `EMAIL`, `ADDITIONAL_EMAIL`, `PERSONAL_EMAIL_ADDRESS`; apply single-CRD rule (or name+location/firm tiebreaker)  
- [ ] **Tier 3:** For unmatched rows, match name \+ city \+ state (state 2-letter); apply single-match rule only  
- [ ] **Tier 4:** For unmatched rows, match name \+ firm (substring both ways); apply single-match rule; plan spot-check of Tier 4 matches before outreach

### Phase 3 — FinTrx enrichment

- [ ] Pull advisor data from `ria_contacts_current` by CRD  
- [ ] Pull firm data from `ria_firms_current` by firm CRD  
- [ ] Merge AUM, title, age, disclosure flags, etc. into the list

### Phase 4 — Lead scoring

- [ ] Upload CRDs to BigQuery staging table  
- [ ] Run V3+V4 scoring pipeline restricted to your CRDs  
- [ ] Merge `score_tier`, `v4_score`, `v4_percentile`, `narrative` into the list  
- [ ] Review exclusion narratives for excluded advisors

### Phase 5 — Salesforce history

- [ ] Query Lead by `FA_CRD__c`; output `lead_url` (CONCAT with Id) and Status, Disposition; take **most recent** Lead per CRD (`CreatedDate DESC`)  
- [ ] Query Opportunity by `FA_CRD__c`; output `opp_url` (CONCAT with Id), stage, close lost reason/detail; take **most recent** Opportunity per CRD  
- [ ] Merge Salesforce history (with clickable URLs) into the list  
- [ ] Flag previously contacted advisors for the outreach team

### Final output

- [ ] Import scored \+ enriched CSV back to Google Sheets  
- [ ] Sort by `score_tier` and `v4_percentile` for outreach prioritization  
- [ ] Share with outreach team with context on match confidence and Salesforce history

---

## Tips & Gotchas

**CRD type casting:** FinTrx stores CRDs inconsistently. Always use `SAFE_CAST(ROUND(SAFE_CAST(x AS FLOAT64), 0) AS INT64)` in every join. This handles strings, floats, and integers.

**Duplicate columns:** If your CSV already has empty score columns from a prior run, the scoring script appends new ones. Delete the empty originals first, or clean up after.

**Path sensitivity:** Run scripts from the project root (`lead_scoring_production/`). Running from a subdirectory doubles up relative paths.

**BigQuery MCP limitation:** The BQ MCP tool in Cursor only returns one row per query. Always run multi-row BQ queries in BigQuery Console and export results.

**Name parsing edge cases:** The first-word/rest split doesn't handle suffixes (Jr., III) or hyphenated first names well. For high-value lists, manually review unmatched names.

**Firm name normalization:** Firm names in attendee lists rarely match FinTrx exactly (`"Merrill Lynch"` vs `"Merrill Lynch, Pierce, Fenner & Smith"`). This is why firm is never used as a primary match — only as a confidence signal.

**Re-running on updated lists:** If the attendee list grows (e.g., late registrations), you can re-run the full pipeline. Tiers 1–4 skip rows that already have CRDs, so only new rows get processed.

**Name-only matching (Tier 5):** We tested matching when a first+last name existed only once in all of FinTrx. It produced too many false positives (non-advisors matching to random unique names). Do not use name-only matching without at least one confirmatory signal (location, firm, email, or LinkedIn).  
