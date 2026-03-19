# Re-Engagement Eligible List in Salesforce

## Objective

Replicate the "Closed Lost Follow-Up" tab from the SGA Hub dashboard natively in Salesforce so SGAs can:
1. See a list of re-engagement eligible advisors
2. Click into records to review details
3. Claim a record (assign to themselves)
4. Create a Re-Engagement Opportunity from the list
5. Have the record automatically disappear from the list once a Re-Engagement Opportunity exists

---

## Current Dashboard Columns (to replicate)

| # | Column | Source Field | Notes |
|---|--------|-------------|-------|
| 1 | Opportunity Name | `Opportunity.Name` | Linked to SF Opportunity record |
| 2 | SGA | `Lead.SGA_Owner_Name__c` / `User.Name` | Falls back from Lead → Opportunity Owner if "Savvy Marketing" |
| 3 | Closed Lost Date | `Opportunity.CloseDate` (where StageName = 'Closed Lost') | |
| 4 | Days Since Closed Lost | `DATE_DIFF(CURRENT_DATE, CloseDate)` | Computed |
| 5 | Closed Lost Reason | `Opportunity.Closed_Lost_Reason__c` | 97.3% populated |
| 6 | Closed Lost Details | `Opportunity.Closed_Lost_Details__c` | 86.5% populated, up to 585 chars |
| 7 | Days Since Closed Lost Bucket | Computed from Days Since Closed Lost | Color-coded: 1mo, 2mo, 3mo, 4mo, 5mo, 6mo+ |
| 8 | Actions | Links to Lead + Opportunity | Native in SF — just click the record |

---

## Current Eligibility Logic (from dashboard)

A record appears in the list when ALL of the following are true:

1. **Opportunity Stage** = `Closed Lost`
2. **Opportunity Record Type** = Recruiting (`012Dn000000mrO3IAI`)
3. **Days since Closed Lost** >= 30 days (not too fresh)
4. **No existing Re-Engagement Opportunity** for the same advisor (matched on `FA_CRD__c`, Record Type `012VS000009VoxrYAC`)

The dashboard splits this into two query ranges:
- **30–179 days**: Uses `savvy_analytics.vw_sga_closed_lost_sql_followup` view
- **180+ days**: Queries raw Salesforce tables directly (Lead + Opportunity + User)

---

## Is This Possible in Native Salesforce?

**Yes — with caveats.** Here are the options ranked by feasibility:

---

### Option A: Salesforce Report + Report Action Buttons (Simplest)

**Feasibility: HIGH — No code required**

**How it works:**
1. Create a custom Report Type on Opportunities (Recruiting Record Type)
2. Filter: `StageName = 'Closed Lost'` AND `CloseDate <= TODAY - 30`
3. Use a **Cross-Filter** to exclude Opportunities where `FA_CRD__c` matches any Re-Engagement Opportunity's `FA_CRD__c`
4. Add columns: Opp Name, Owner, CloseDate, Closed Lost Reason, Closed Lost Details
5. Add a **Formula Column** for "Days Since Closed Lost" (`TODAY() - CloseDate`)
6. Pin the report to an SGA-facing Lightning App or Home Page

**Claiming workflow:**
- Add a **Quick Action** button ("Create Re-Engagement Opp") on the Opportunity page layout
- The Quick Action launches a Flow that:
  - Creates a new Opportunity with Record Type = Re-Engagement (`012VS000009VoxrYAC`)
  - Copies `FA_CRD__c` from the closed lost Opportunity
  - Sets Owner to the current user (the SGA claiming it)
  - Sets a default Stage (e.g., "Prospecting" or whatever your re-engagement stages use)
- Once the Re-Engagement Opp exists, the Cross-Filter automatically removes the record from the report on next refresh

**Limitations:**
- Cross-filters on the same object (Opportunity → Opportunity by FA_CRD__c) can be tricky — may need a helper field or related lookup
- No real-time removal — report refreshes on load
- "Days Since Closed Lost Bucket" would need a formula field on Opportunity (not hard)
- Cannot prevent two SGAs from claiming the same record simultaneously (race condition)

---

### Option B: Salesforce List View + Flow Quick Action (Recommended)

**Feasibility: HIGH — Minimal config, best UX for SGAs**

**Setup:**

#### Step 1: Add a Formula Field to Opportunity
- **Field**: `Days_Since_Closed_Lost__c` (Formula, Number)
- **Formula**: `IF(StageName = 'Closed Lost', TODAY() - DATEVALUE(CloseDate), NULL)`

#### Step 2: Add a Bucket Formula Field
- **Field**: `Closed_Lost_Time_Bucket__c` (Formula, Text)
- **Formula**:
  ```
  IF(Days_Since_Closed_Lost__c >= 180, "6+ months",
  IF(Days_Since_Closed_Lost__c >= 150, "5 months",
  IF(Days_Since_Closed_Lost__c >= 120, "4 months",
  IF(Days_Since_Closed_Lost__c >= 90, "3 months",
  IF(Days_Since_Closed_Lost__c >= 60, "2 months",
  IF(Days_Since_Closed_Lost__c >= 30, "1 month",
  "Too Recent"))))))
  ```

#### Step 3: Add a Checkbox Field
- **Field**: `Has_Re_Engagement_Opp__c` (Checkbox, default false)
- Updated by a **Record-Triggered Flow** on Opportunity: when a Re-Engagement Opportunity is created with a matching `FA_CRD__c`, find all Closed Lost Opportunities with the same `FA_CRD__c` and set this to `true`

#### Step 4: Create the List View
- **Object**: Opportunity
- **Name**: "Re-Engagement Eligible"
- **Filters**:
  - `Record Type = Recruiting`
  - `Stage = Closed Lost`
  - `Days_Since_Closed_Lost__c >= 30`
  - `Has_Re_Engagement_Opp__c = false`
- **Columns**: Opportunity Name, Owner, CloseDate, Days_Since_Closed_Lost__c, Closed_Lost_Time_Bucket__c, Closed_Lost_Reason__c, Closed_Lost_Details__c
- **Visibility**: Visible to all SGAs (or specific public group)

#### Step 5: Create "Claim & Create Re-Engagement" Flow (Screen Flow as Quick Action)
- **Trigger**: Quick Action button on Opportunity ("Claim for Re-Engagement")
- **Flow logic**:
  1. Show confirmation screen: "You are about to create a Re-Engagement Opportunity for [Advisor Name]. This will assign you as the owner."
  2. Create new Opportunity:
     - Record Type = Re-Engagement (`012VS000009VoxrYAC`)
     - Name = original Opp Name + " - Re-Engagement"
     - `FA_CRD__c` = source Opportunity's `FA_CRD__c`
     - Owner = `$User.Id` (current SGA)
     - Stage = initial re-engagement stage
  3. Update source Opportunity: `Has_Re_Engagement_Opp__c = true`
  4. Show success screen with link to new Opportunity

**Result**: Record disappears from the List View immediately after claiming.

**Advantages:**
- SGAs see the list directly in Salesforce (no dashboard needed)
- Inline search, sort, and filter on every column natively
- One-click claiming via Quick Action
- Immediate removal from list (checkbox flip)
- Works on mobile (Salesforce Mobile App)
- No code, no LWC, no Apex

---

### Option C: Custom LWC (Lightning Web Component)

**Feasibility: MEDIUM — Requires developer, most powerful**

**How it works:**
- Build a custom Lightning component that queries Opportunities matching the eligibility criteria
- Render a table with exact same columns and styling as the dashboard
- Include a "Claim" button per row
- Claim action creates the Re-Engagement Opp and removes the row in real-time
- Can include de-duplication logic to prevent race conditions (e.g., lock the record)

**Advantages:**
- Pixel-perfect match to dashboard UX
- Real-time row removal (no refresh needed)
- Can add locking to prevent double-claims
- Can embed anywhere: Home Page, App Page, Record Page

**Disadvantages:**
- Requires Apex + LWC development
- Needs deployment, testing, and maintenance
- Overkill if Option B works

---

## Recommendation: Option B (List View + Flow)

Option B gives you 90% of the functionality with zero code:

| Requirement | Option B Coverage |
|-------------|------------------|
| SGAs see eligible list | List View on Opportunity |
| Same columns as dashboard | Formula fields + List View columns |
| Click into records | Native Salesforce record navigation |
| Claim / assign to self | Screen Flow Quick Action |
| Create Re-Engagement Opp | Flow creates it automatically |
| Remove from list after claim | Checkbox flip removes from filtered view |
| Filter by time bucket | List View filter or column sort |
| Filter by Closed Lost Reason | List View filter or column sort |
| Admin sees all, SGA sees own | List View filter on Owner |
| Mobile access | Salesforce Mobile App |

---

## Implementation Steps (Option B)

### Phase 1: Schema (Salesforce Admin — Setup)
1. [ ] Create formula field `Days_Since_Closed_Lost__c` on Opportunity
2. [ ] Create formula field `Closed_Lost_Time_Bucket__c` on Opportunity
3. [ ] Create checkbox field `Has_Re_Engagement_Opp__c` on Opportunity (default: false)
4. [ ] Backfill `Has_Re_Engagement_Opp__c` for existing Closed Lost records that already have a Re-Engagement Opp (one-time data update matching on `FA_CRD__c`)

### Phase 2: Automation (Salesforce Admin — Flow Builder)
5. [ ] Create Record-Triggered Flow on Opportunity (After Create): when a Re-Engagement Opp is created, find and update all Closed Lost Opps with matching `FA_CRD__c` → set `Has_Re_Engagement_Opp__c = true`
6. [ ] Create Screen Flow "Claim for Re-Engagement" that creates the Re-Engagement Opp and flips the checkbox
7. [ ] Add the Screen Flow as a Quick Action on the Opportunity page layout (Recruiting Record Type only)

### Phase 3: List View (Salesforce Admin)
8. [ ] Create List View "Re-Engagement Eligible" on Opportunity with filters above
9. [ ] Configure visible columns to match dashboard
10. [ ] Set visibility to appropriate user group (all SGAs)

### Phase 4: Validation
11. [ ] Verify row count matches dashboard (~222 records currently in 30-179 day range, plus 180+ day records)
12. [ ] Test claim flow end-to-end: SGA claims → Re-Engagement Opp created → record disappears from list
13. [ ] Test edge case: two SGAs viewing same record simultaneously
14. [ ] Verify mobile access works

---

## Data Volume Context

- Current eligible records (30-179 days): **222 records** across 18 SGAs
- Average per SGA: ~12 records
- The list is dynamic — records age in (hit 30 days) and age out (180+ days shift to direct query) daily
- Top SGA (Lauren George): 41 records
- 22.5% of records are "Savvy Declined" reasons — consider whether these should be excluded from re-engagement eligibility

---

## Open Questions

1. **Should "Savvy Declined" records be eligible for re-engagement?** Currently 50 of 222 records (22.5%) are Savvy-rejected (Book Not Transferable, Insufficient Revenue, Poor Culture Fit, Compliance). These may not be appropriate for SGAs to re-engage.

2. **Should there be an upper bound?** The dashboard shows 30-179 days in one view and 180+ in another. Should the Salesforce list combine both, or cap at a certain age?

3. **Race condition handling**: If two SGAs try to claim the same record, the second Flow execution will create a duplicate Re-Engagement Opp. Options:
   - Accept it (unlikely given ~12 records per SGA)
   - Add a validation rule: if `Has_Re_Engagement_Opp__c = true`, block the Quick Action
   - Add a record lock in the Flow (check checkbox before creating)

4. **SGA visibility**: Should SGAs only see their own Closed Lost records, or all unassigned/available ones? The dashboard shows "My Records" by default with an admin toggle for "All Records."

5. **Re-Engagement Opportunity defaults**: What Stage, Close Date, and other field defaults should the Flow set when creating the new Opp?
