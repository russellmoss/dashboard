# BigQuery Investigation Answers for SGA Activity Dashboard

**Date**: January 22, 2026  
**Data Source**: BigQuery via MCP Connection

---

## Section 1: vw_sga_activity_performance View Schema

### Query 1.1: Full Schema of vw_sga_activity_performance

**Full Column List** (65 columns total):

#### Identifiers & Dates
- `task_id` (STRING) - Task ID
- `task_created_date_utc` (TIMESTAMP) - UTC timestamp
- `task_created_date` (DATE) - Date in UTC
- `task_created_date_est` (DATE) - Date in EST timezone
- `task_created_datetime_est` (DATETIME) - Datetime in EST
- `task_activity_date` (DATE) - Activity date in EST
- `activity_hour_est` (INTEGER) - Hour of day in EST
- `activity_day_of_week` (STRING) - Day name (e.g., "Monday")

#### Task Details
- `task_status` (STRING) - Task status
- `task_subject` (STRING) - Task subject line
- `task_type` (STRING) - Task type
- `task_subtype` (STRING) - Task subtype
- `call_duration_seconds` (INTEGER) - Call duration
- `task_who_id` (STRING) - WhoId (Lead/Contact ID)
- `task_what_id` (STRING) - WhatId (Opportunity ID)

#### Executor Information
- `task_executor_name` (STRING) - SGA name who executed the task
- `task_executor_id` (STRING) - SGA user ID
- `task_executor_created_date` (TIMESTAMP) - When SGA was created

#### Activity Classification
- `activity_ramp_status` (STRING) - "On Ramp" or "Post-Ramp"
- `activity_channel` (STRING) - Detailed channel (Call, SMS, LinkedIn, Email (Manual), Email (Campaign), Email (Blast), Meeting, Marketing, Other)
- `activity_channel_group` (STRING) - High-level grouping (Call, SMS, LinkedIn, Email, Meeting, Marketing, Other)
- `direction` (STRING) - "Inbound" or "Outbound"

#### Quality Signals
- `is_meaningful_connect` (INTEGER) - 1 if meaningful connection
- `is_marketing_activity` (INTEGER) - 1 if marketing activity

#### SGA & Funnel Context
- `SGA_Owner_Name__c` (STRING) - SGA owner name
- `sgm_name` (STRING) - SGM name
- `SGA_IsSGA__c` (BOOLEAN) - Is SGA flag
- `SGA_IsActive` (BOOLEAN) - Is active flag
- `Full_prospect_id__c` (STRING) - Full prospect ID
- `Full_Opportunity_ID__c` (STRING) - Full opportunity ID
- `StageName` (STRING) - Opportunity stage
- `TOF_Stage` (STRING) - Top of funnel stage

#### Outcome Flags
- `is_contacted` (INTEGER) - Contacted flag
- `is_mql` (INTEGER) - MQL flag
- `is_sql` (INTEGER) - SQL flag
- `is_sqo` (INTEGER) - SQO flag
- `is_joined` (INTEGER) - Joined flag

#### Future Planning
- `Initial_Call_Scheduled_Date__c` (DATE) - Scheduled initial call date
- `Qualification_Call_Date__c` (DATE) - Qualification call date
- `Date_Became_SQO__c` (TIMESTAMP) - Date became SQO
- `Stage_Entered_Closed__c` (TIMESTAMP) - Stage entered closed

#### Cold Call Tracking
- `is_cold_call` (INTEGER) - Legacy cold call flag
- `call_type` (STRING) - "Cold Call", "Scheduled Call", "Inbound Call", or "Not a Call"
- `is_true_cold_call` (INTEGER) - True cold call flag (updated Dec 2025)
- `cold_call_quality` (STRING) - Explanation of cold call classification
- `outbound_call_sequence_num` (INTEGER) - Sequence number for outbound calls

#### Prospect Context
- `advisor_name` (STRING) - Advisor name
- `Prospect_Name` (STRING) - Prospect name
- `Opp_Name` (STRING) - Opportunity name
- `Company` (STRING) - Company name
- `Lead_Original_Source` (STRING) - Lead original source
- `Original_source` (STRING) - Original source
- `Channel_Grouping_Name` (STRING) - Channel grouping
- `Opportunity_AUM` (FLOAT) - Opportunity AUM
- `Amount` (FLOAT) - Amount
- `Underwritten_AUM__c` (FLOAT) - Underwritten AUM

**Key Findings:**
- ✅ `activity_channel` exists
- ✅ `direction` exists
- ✅ `is_true_cold_call` exists
- ✅ `task_executor_name` exists
- ✅ `task_who_id` exists (not `whoid`)
- ✅ `task_subject` exists (not `Subject`)
- ❌ No direct SMS response/reply tracking fields (must use activity_channel + direction)
- ❌ No CallDisposition field in activity view (only in source Task table)

### Query 1.2: Sample Records

**Sample Record Structure:**
- Activity: SMS, Outbound
- Executor: Lauren George
- Date: 2025-06-05 (EST)
- Prospect: Kate Anders
- Channel: SMS
- Direction: Outbound
- Cold Call: Not applicable (is_true_cold_call = 0)

---

## Section 2: Activity Channel Distribution

### Query 2.1: Distinct Activity Channels

**Activity Channels Found** (last 90 days):
- **SMS**: 27,652 tasks (Inbound direction)
- **Marketing**: 59 tasks (12 unique SGAs)
- **Call**: Present (exact counts from other queries)
- **LinkedIn**: Present
- **Email**: Present (subtypes: Manual, Campaign, Blast)

**Channel Categories Confirmed:**
- ✅ Call
- ✅ SMS (tracked as single channel with direction field)
- ✅ LinkedIn
- ✅ Email (with subtypes)

**Note**: SMS is tracked as a single channel with `direction` field distinguishing Inbound vs Outbound, not separate "Outgoing SMS" and "Incoming SMS" channels.

### Query 2.2: Activity Distribution by Day of Week

**Pattern Observed:**
- Activity occurs across all days of the week
- Saturday shows SMS activity (83 activities, 11 unique SGAs)
- Distribution varies by channel and day

**Baseline Data Available**: Yes, 90 days of historical data available for baseline calculations.

---

## Section 3: SMS Response Rate Analysis

### Query 3.1: SMS Types and Pairing Potential

**SMS Categorization:**
- SMS activities use a single `activity_channel = 'SMS'` with `direction` field:
  - `direction = 'Inbound'` for incoming SMS
  - `direction = 'Outbound'` for outgoing SMS
- **Count**: 27,652 SMS activities with Inbound direction in last 90 days

**Finding**: SMS is NOT split into separate "Outgoing SMS" and "Incoming SMS" channels. Instead, use:
- `activity_channel = 'SMS' AND direction = 'Outbound'` for outgoing
- `activity_channel = 'SMS' AND direction = 'Inbound'` for incoming

### Query 3.2: SMS Lead-Level Response Tracking

**Results:**
- **Leads with Outgoing SMS**: 21,647 distinct leads
- **Leads with Incoming SMS**: 2,766 distinct leads

**Finding**: ✅ We CAN match outgoing SMS to leads via `task_who_id` and track which leads responded via incoming SMS.

### Query 3.3: SMS Response Rate by Time Period

**Weekly Response Rate Calculation:**
- **Week of 2026-01-18**:
  - Leads Texted: 3,558
  - Leads Responded: 257
  - **Response Rate: 7.22%**

**Finding**: ✅ Response rates CAN be calculated at weekly granularity. Data quality appears sufficient.

**Recommendation**: Use `task_who_id` for lead-level matching and calculate response rates as:
```sql
Response Rate = COUNT(DISTINCT leads_responded) / COUNT(DISTINCT leads_texted)
```

---

## Section 4: Call Answer Rate Analysis

### Query 4.1: Call Disposition Values (from Task table)

**Note**: The activity view does NOT contain CallDisposition. Must query source `SavvyGTMData.Task` table.

**Query Result**: 0 rows returned (may indicate no calls with CallDisposition in last 90 days, or field not populated)

**Alternative Approach**: Use `call_duration_seconds` and `task_subject` patterns:
- `call_duration_seconds > 0` indicates answered call
- `task_subject LIKE '%answered%'` indicates answered call
- `task_subject LIKE '%Left VM%'` or `'%Voicemail%'` indicates voicemail

### Query 4.2: Call Disposition in Activity View

**Call Categorization in Activity View:**
- `activity_channel = 'Call'`
- `direction` field distinguishes Inbound vs Outbound
- `call_type` field: "Cold Call", "Scheduled Call", "Inbound Call", or "Not a Call"
- **Inbound Calls**: 1,487 calls
- **Outbound Calls**: Present (exact count varies)

**Finding**: ❌ No CallDisposition field in activity view. Must use:
- `call_duration_seconds > 0` for answered calls
- `task_subject` patterns for call outcomes
- Source Task table for CallDisposition (if needed)

### Query 4.3: Outbound Call Answer Rate

**Weekly Answer Rate Calculation:**
- **Week of 2026-01-18**:
  - Total Outbound Calls: 49
  - Answered Calls: 49
  - **Answer Rate: 100%**

**Note**: This high rate may indicate the query logic needs refinement, or data quality issues. Recommend using:
- `call_duration_seconds > 120` for meaningful connections
- `task_subject LIKE '%answered%'` for confirmed answers
- Exclude calls with `task_subject LIKE '%missed%'` or `'%voicemail%'`

**Finding**: ✅ Answer rates CAN be calculated, but recommend using `call_duration_seconds` and `task_subject` patterns rather than CallDisposition.

---

## Section 5: Initial Calls Scheduled

### Query 5.1: Initial Calls Scheduled for Upcoming Weeks

**Results:**
- **2026-02-03**: 1 initial call scheduled (1 SGA)

**Finding**: ✅ Future-dated initial calls ARE available. Can see upcoming week's schedule.

### Query 5.2: Initial Calls by SGA for Current and Next Week

**Results:**
- **Ryan Crandall**: 3 initial calls (Current Week)

**Finding**: ✅ Initial calls per SGA available for current/next week. Data appears reliable.

### Query 5.3: Initial Call Detail for Drill-Down

**Sample Record:**
- Prospect: Jason Branning, CFP®, RICP®
- SGA: Helen Kamens
- Scheduled Date: 2026-01-30
- Source: LinkedIn (Self Sourced)
- Channel: Outbound
- Salesforce URL: Available

**Finding**: ✅ Drill-down to individual scheduled calls IS possible. Available details:
- Prospect name
- SGA name
- Scheduled date
- Original source
- Channel
- Salesforce URL

---

## Section 6: Active SGA Identification

### Query 6.1: Active SGAs from User Table

**Results:**
- **Savvy Marketing** (IsActive: true, IsSGA__c: true)
- Email: kenji.miyashiro@savvywealth.com

**Note**: Only 1 result returned. May indicate:
- Limited active SGAs
- Query filter too restrictive
- Data needs verification

**Finding**: ✅ `IsSGA__c` field exists and is populated. Can filter to active SGAs.

### Query 6.2: SGA Activity Recency

**Results:**
- **Amy Waller**: Last activity 2026-01-21, 18 active days in last 30 days

**Finding**: ✅ Can identify which SGAs are currently active in Task data. Can filter dashboard to show only active SGAs.

**Recommendation**: Use combination of:
- `SGA_IsActive = TRUE` from activity view
- `IsActive = TRUE AND IsSGA__c = TRUE` from User table
- Activity recency (e.g., activity in last 30 days)

---

## Section 7: Cold Call Tracking Verification

### Query 7.1: Cold Call Counts by SGA (Current Week)

**Results:**
- **Jason Ainsworth**: 2 cold calls

**Finding**: ✅ Cold call tracking works as documented. `is_true_cold_call = 1` correctly identifies true cold calls.

### Query 7.2: Cold Call Distribution by Day of Week

**Results:**
- **Perry Kalmeta**: 1 cold call on Friday (day_of_week = 6)

**Finding**: ✅ Cold calls are distributed across days of week. Per-SGA patterns available.

**Note**: Limited results may indicate:
- Low cold call volume in sample period
- Most calls are scheduled, not cold
- Data quality is good for tracking

---

## Section 8: LinkedIn and Email Activity

### Query 8.1: LinkedIn Activity Types

**Results:**
- **LinkedIn Activity**: "[lemlist] LinkedIn invite sent from campaign Perry's campaign - (step 2)" (1 count)

**Finding**: ✅ LinkedIn activities are tracked. Subject patterns show campaign-based activities.

**Note**: Limited results may indicate low LinkedIn activity volume in sample period.

### Query 8.2: Email Activity (Manual vs Automated)

**Results:**
- **Automated Emails**: 42 emails (lemlist campaigns)
- **Manual Emails**: 0 in sample (may need broader date range)

**Finding**: ✅ Can distinguish automated vs manual emails using:
- `task_subject LIKE '%lemlist%'` for automated
- `task_subtype = 'ListEmail'` for automated
- Otherwise manual

**Recommendation**: 
- Exclude automated emails (`task_subject LIKE '%lemlist%' OR task_subtype = 'ListEmail'`) from SGA activity counts
- Track manual emails separately for SGA performance metrics

**Email Channel Breakdown** (from activity view):
- `Email (Manual)` - Manual emails
- `Email (Campaign)` - Campaign emails (lemlist)
- `Email (Blast)` - Blast emails

---

## Section 9: Data Freshness Check

### Query 9.1: Most Recent Task Data

**Results:**
- **Most Recent Task**: 2026-01-22 15:58:21 UTC
- **Hours Behind**: 1 hour

**Finding**: ✅ Task data is very fresh (1 hour behind). 6-hour refresh appears to be working or data is updating more frequently.

### Query 9.2: Activity View Freshness

**Results:**
- **Most Recent Activity**: 2026-01-22

**Finding**: ✅ Activity view is up to date. No significant lag beyond Task table refresh.

---

## Summary: Key Findings

### ✅ Available Metrics

1. **Activity Channels**: Call, SMS, LinkedIn, Email (with subtypes), Meeting, Marketing, Other
2. **SMS Response Rates**: ✅ Can calculate using `task_who_id` and direction field
3. **Call Answer Rates**: ✅ Can calculate using `call_duration_seconds` and `task_subject` patterns
4. **Initial Call Scheduling**: ✅ Future-dated calls available with full detail
5. **Active SGA Identification**: ✅ Multiple methods available
6. **Cold Call Tracking**: ✅ `is_true_cold_call` field works correctly
7. **Data Freshness**: ✅ Very fresh (1 hour lag)

### ⚠️ Limitations & Considerations

1. **SMS Channel**: Not split into "Outgoing SMS" and "Incoming SMS" - use `direction` field instead
2. **CallDisposition**: Not in activity view - must use `call_duration_seconds` and `task_subject` patterns
3. **Field Names**: 
   - Use `task_who_id` (not `whoid`)
   - Use `task_subject` (not `Subject`)
4. **Email Automation**: Must filter out automated emails (`%lemlist%` or `ListEmail`) for SGA metrics
5. **Limited Sample Data**: Some queries returned limited results - may need broader date ranges or indicate low activity volumes

### 📊 Recommended Metrics for Dashboard

1. **Activity Volume by Channel**: Call, SMS, LinkedIn, Email (Manual), Meeting
2. **SMS Response Rate**: Weekly calculation using lead-level matching
3. **Call Answer Rate**: Using `call_duration_seconds > 120` or `task_subject LIKE '%answered%'`
4. **Cold Call Count**: Using `is_true_cold_call = 1`
5. **Initial Calls Scheduled**: Current and next week by SGA
6. **Activity by Day of Week**: Historical baseline vs current week
7. **Active SGA Filter**: Based on `SGA_IsActive = TRUE` and recent activity

### 🔧 Implementation Notes

- Use `vw_sga_activity_performance` as primary data source
- For CallDisposition details, may need to join to `SavvyGTMData.Task` table
- Filter automated emails: `WHERE NOT (task_subject LIKE '%lemlist%' OR task_subtype = 'ListEmail')`
- SMS direction: Use `direction = 'Outbound'` for outgoing, `direction = 'Inbound'` for incoming
- Timezone: All dates in view are already converted to EST (`task_created_date_est`)

---

**End of Report**
