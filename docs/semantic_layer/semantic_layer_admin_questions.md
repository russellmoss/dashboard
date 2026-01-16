# Semantic Layer Admin Questions

**Date:** 2026-01-26 (Updated after Phase 12)  
**Purpose:** Questions requiring admin/business input for semantic layer enhancements

**Status Update:**  
✅ **Phase 11 Complete** - Four templates (multi_stage_conversion, time_to_convert, pipeline_by_stage, sga_summary) have been added to the semantic layer. Questions 1-4 below are now **RESOLVED**.  
✅ **Phase 12 Complete** - Rolling average template (rolling_average) has been added to the semantic layer. Request 1 below is now **RESOLVED**. Remaining questions focus on future enhancements.

**Current Semantic Layer Status:**
- ✅ **Production Ready** - All critical templates implemented and validated
- ✅ **Conversion Rates** - Always use cohort mode (documented and enforced)
- ✅ **Templates Added** - Multi-stage conversion, time-to-convert, pipeline by stage, SGA summary, rolling average
- ✅ **Rolling Averages** - Fully implemented with configurable windows, dimension grouping, and both output formats
- ⚠️ **Future Enhancements** - Stale pipeline analysis pending admin decision (Question 5)

---

## Business Logic Questions

### Question 1: Multi-Stage Conversion Template Priority

**Status:** ✅ **RESOLVED** - Template added in Phase 11

**Context:**  
During Phase 7 validation, we identified that users might ask questions like "What's our MQL to Joined rate?" This requires calculating conversion rates across multiple stages (MQL→SQL→SQO→Joined).

**Resolution:**
- ✅ **Template Added:** `multi_stage_conversion` template now exists in `query-templates.ts`
- ✅ **Implementation:** Uses direct cohort calculation (more accurate than chaining rates)
- ✅ **Features:** Supports any start/end stage combination (contacted→mql, mql→sql, sql→sqo, sqo→joined, or multi-stage like mql→joined)
- ✅ **Validation:** Added to validation examples and question patterns

**Technical Implementation:**
- Direct cohort calculation: `COUNTIF(startStage AND endStage) / COUNTIF(startStage)`
- Always uses COHORT MODE (resolved records only)
- More accurate than chaining individual rates (avoids compounding errors)
- Supports: "Contacted to Joined", "MQL to Joined", "Prospect to Joined", etc.

**Next Steps:**  
- ✅ Template is ready for AI agent use
- ⚠️ Monitor user feedback on template usage

---

### Question 2: Time-to-Convert Template Priority

**Status:** ✅ **RESOLVED** - Template added in Phase 11

**Context:**  
During Phase 7 validation, we identified that users might ask questions like "How long does it take for an MQL to become SQL?" or "What's the average time from SQL to SQO?"

**Resolution:**
- ✅ **Template Added:** `time_to_convert` template now exists in `query-templates.ts`
- ✅ **Implementation:** Uses `DATE_DIFF()` and `APPROX_QUANTILES()` for statistics
- ✅ **Features:** Supports avg, median, min, max, p25, p75, p90 statistics
- ✅ **Validation:** Added to validation examples and question patterns (velocity pattern)

**Technical Implementation:**
- Uses `DATE_DIFF(DATE(end_date), DATE(start_date), DAY)` for time calculation
- Median: `APPROX_QUANTILES(value, 100)[OFFSET(50)]` (BigQuery-specific syntax)
- Percentiles: `APPROX_QUANTILES(value, 100)[OFFSET(25/75/90)]`
- Works for any stage-to-stage combination (Contacted→MQL, MQL→SQL, SQL→SQO, SQO→Joined, etc.)

**Next Steps:**  
- ✅ Template is ready for AI agent use
- ⚠️ Monitor user feedback on velocity analysis questions

---

### Question 3: Pipeline by Stage Template Priority

**Status:** ✅ **RESOLVED** - Template added in Phase 11

**Context:**  
During Phase 7 validation, we identified that users might ask questions like "How many opportunities are in each stage?" or "Show me the pipeline broken down by stage."

**Resolution:**
- ✅ **Template Added:** `pipeline_by_stage` template now exists in `query-templates.ts`
- ✅ **Implementation:** Groups open pipeline by `StageName` with count and AUM
- ✅ **Features:** Returns `stage`, `opp_count`, `total_aum`, `avg_aum` per stage
- ✅ **Validation:** Added to validation examples and question patterns (pipeline_breakdown pattern)

**Technical Implementation:**
- Filters by `OPEN_PIPELINE_STAGES` (Qualifying, Discovery, Sales Process, Negotiating)
- Uses `COALESCE(Underwritten_AUM__c, Amount, 0)` for AUM calculation (never adds)
- Orders stages in sequence (Qualifying → Discovery → Sales Process → Negotiating)
- Returns: `{ stage: 'Qualifying', opp_count: 10, total_aum: 50000000 }` per stage

**Next Steps:**  
- ✅ Template is ready for AI agent use
- ⚠️ Monitor user feedback on pipeline breakdown questions

---

### Question 4: SGA Performance Summary Template Priority

**Status:** ✅ **RESOLVED** - Template added in Phase 11

**Context:**  
During Phase 8 validation, we identified that users frequently ask "How is [SGA name] doing this quarter?" This requires returning all key metrics (volumes, AUM, conversion rates) for a specific SGA in one query.

**Resolution:**
- ✅ **Template Added:** `sga_summary` template now exists in `query-templates.ts`
- ✅ **Implementation:** Returns all key metrics in one query (volumes, AUM, conversion rates)
- ✅ **Features:** Uses correct SGA filter patterns (lead-level vs opportunity-level with OR logic)
- ✅ **Validation:** Added to validation examples and question patterns (sga_performance pattern)

**Technical Implementation:**
- **Lead-level metrics** (Prospects, Contacted, MQLs, SQLs): Use `SGA_Owner_Name__c` only
- **Opportunity-level metrics** (SQOs, Joined, AUM): Use `(SGA_Owner_Name__c = @sga OR Opp_SGA_Name__c = @sga)`
- **Returns:** All volume metrics, all AUM metrics, all conversion rates (using cohort mode)
- **Why OR Logic:** An SQO can be attributed via either lead-level SGA OR opportunity-level SGA

**Next Steps:**  
- ✅ Template is ready for AI agent use
- ⚠️ Monitor user feedback on SGA summary questions

---

### Question 5: Stale Pipeline Template Feasibility

**Status:** ✅ **RESOLVED** - Implemented as `opportunities_by_age` template in Phase 13

**Context:**  
During Phase 6 gap analysis, we identified that users might ask questions like "Which opportunities haven't moved stages in 30 days?" or "Show me stale pipeline."

**Current State:**
- **Schema Review:** `vw_funnel_master` does NOT have a direct "LastModifiedDate" or "LastActivityDate" field
- **Available Fields:** Stage entry date fields exist:
  - `Stage_Entered_Discovery__c`
  - `Stage_Entered_Sales_Process__c`
  - `Stage_Entered_Negotiating__c`
  - `Stage_Entered_Signed__c`
  - `Stage_Entered_On_Hold__c`
  - `Stage_Entered_Closed__c`
  - `Date_Became_SQO__c`
  - `Opp_CreatedDate`
- **Alternative Approach:** Could use "most recent stage entry date" as proxy for last activity

**Question:**  
Should we add age-based opportunity analysis templates (see Request 2 below for detailed proposal)?

**Context:**  
The term "stale" is difficult to define due to deal size variations, stage-specific durations, and business context. Instead of trying to define "stale", we propose flexible age-based templates that let users define thresholds via parameters.

**Options:**
- **A:** Yes, implement flexible age-based templates (`opportunities_by_age`, `stage_age_analysis`) - Recommended approach
- **B:** No, wait for true LastModifiedDate field to be added to view - Don't add templates yet
- **C:** No, age-based pipeline analysis not needed - Don't add templates

**Impact:**  
- If A: AI agents can answer questions like "What open opportunities are more than 180 days old?" or "What on hold opportunities are more than 200 days old? and who is the owning SGM?" using flexible age thresholds
- If B: Templates added when LastModifiedDate field is available in view
- If C: Age-based pipeline analysis not available

**Technical Notes:**
- **Age Calculation:** Can use `Opp_CreatedDate` (creation age) or stage entry dates (time in stage)
- **Query Pattern:** `WHERE DATE_DIFF(CURRENT_DATE(), DATE(age_field), DAY) > @ageThreshold`
- **Flexibility:** Users define thresholds via parameters (no hardcoded "stale" definition)
- **AUM-Aware:** Can filter/group by AUM tier to account for larger deals taking longer
- **Stage-Aware:** Can filter by specific stages (On Hold, Open Pipeline, etc.)

**See Request 2 below for detailed proposal with three implementation options (A, B, C).**

**Business Logic Clarification Needed:**
- **Age calculation method:** Should we use creation date (`Opp_CreatedDate`) or stage entry date (time in current stage)?
- **Default thresholds:** Should we provide default age thresholds? (e.g., 180 days for open opportunities, 200 days for On Hold)
- **AUM-tier-specific thresholds:** Should larger deals (Tier 4 >$150M) have different thresholds than smaller deals? (e.g., 300 days vs 180 days)
- **Stage-specific thresholds:** Should different stages have different default thresholds? (e.g., On Hold might have 200 days, Discovery might have 90 days)
- **Which template option(s)?** Should we implement Option A (flexible age-based), Option B (stage-specific), Option C (multi-dimensional breakdown), or a combination?

**Resolution:**
- ✅ **Template Implemented:** `opportunities_by_age` template added in Phase 13
- ✅ **Approach:** Option A (flexible age-based template) - no default thresholds, user-defined age thresholds
- ✅ **Age Calculation:** Supports both `from_creation` (Opp_CreatedDate) and `from_stage_entry` (most recent stage entry date)
- ✅ **Filtering:** Supports stage, AUM tier, SGA, SGM, Channel, Source filtering
- ✅ **Grouping:** Supports grouping by dimensions (SGA, SGM, Channel, AUM tier, Source)
- ✅ **No AUM-tier-specific thresholds:** As requested

**See Request 2 below for complete implementation details.**

---

## Metric Definition Confirmations

### Confirmation 1: Open Pipeline Stages Definition

**Current Definition:**  
Open Pipeline = Opportunities in: Qualifying, Discovery, Sales Process, Negotiating  
Excluded: On Hold, Signed, Planned Nurture, Closed Lost, Joined

**Status:** ✅ **CONFIRMED** - Updated during Phase 1 validation based on user clarification

**Please Confirm:**  
- ✅ This definition is correct and matches business requirements
- ✅ On Hold, Signed, and Planned Nurture should NOT be considered "open pipeline"

---

### Confirmation 2: AUM Calculation Pattern

**Current Pattern:**  
Always use: `COALESCE(Underwritten_AUM__c, Amount, 0)`  
Never use: `Underwritten_AUM__c + Amount` (adding them is incorrect)

**Status:** ✅ **CONFIRMED** - Validated across all AUM metrics in codebase

**Please Confirm:**  
- ✅ This pattern is correct and matches business requirements
- ✅ We should never add `Underwritten_AUM__c` and `Amount` together

---

### Confirmation 3: SGA Filter OR Logic

**Current Pattern:**  
- Lead-level metrics: Use `SGA_Owner_Name__c` only
- Opportunity-level metrics: Use `(SGA_Owner_Name__c = @sga OR Opp_SGA_Name__c = @sga)`

**Status:** ✅ **CONFIRMED** - Validated during Phase 8

**Please Confirm:**  
- ✅ OR logic for opportunity-level metrics is correct
- ✅ An SQO can be attributed via either lead-level SGA OR opportunity-level SGA

---

## Missing Functionality Requests

### Request 1: Rolling Average Metrics

**Status:** ✅ **RESOLVED** - Template added in Phase 12

**User Need:**  
Users might ask "What's our 30-day rolling average for SQOs?" or "Show me trailing 90-day MQL volume"

**Resolution:**
- ✅ **Template Added:** `rolling_average` template now exists in `query-templates.ts`
- ✅ **Implementation:** Uses BigQuery window functions with daily aggregation
- ✅ **Features:** 
  - Supports all metrics (volumes, AUM, conversion rates)
  - Configurable window sizes (1-365 days)
  - Supports grouping by dimensions (channel, source, SGA, etc.)
  - Both time series and single value outputs
  - Returns both raw value and rolling average for comparison
  - Tracks data availability (days_in_window)
- ✅ **Integration:** Added `includeRollingAverage` parameter to `metric_trend` template
- ✅ **Validation:** All test queries validated via BigQuery MCP

**Technical Implementation:**
- Always uses daily aggregation first, then applies rolling window
- Window function: `AVG(metric_value) OVER (ORDER BY date ROWS BETWEEN windowDays-1 PRECEDING AND CURRENT ROW)`
- Dimension grouping: Uses `PARTITION BY dimension` for independent rolling averages per group
- Calendar-based windows (not business days)
- Handles insufficient data gracefully (shows actual days available)

**Next Steps:**  
- ✅ Template is ready for AI agent use
- ⚠️ Monitor user feedback on rolling average questions

---

### Request 2: Stale Pipeline Analysis

**Status:** ✅ **RESOLVED** - Template added in Phase 13

**User Need:**  
Users might ask questions like:
- "What open opportunities are more than 180 days old?"
- "What on hold opportunities are more than 200 days old? and who is the owning SGM?"
- "Which opportunities haven't moved stages in 30 days?"
- "Show me stale pipeline"

**Current Gap:**  
The term "stale" is difficult to define due to complexities:
- Different deal sizes (AUM) take different amounts of time (larger deals take longer)
- Different stages have different typical durations
- Median and average time-to-close varies by AUM tier
- "Stale" could mean different things in different contexts

**Available Fields (Verified via BigQuery MCP):**
- ✅ `Opp_CreatedDate` (TIMESTAMP) - When opportunity was created
- ✅ `Stage_Entered_Discovery__c` (TIMESTAMP) - When entered Discovery stage
- ✅ `Stage_Entered_Sales_Process__c` (TIMESTAMP) - When entered Sales Process stage
- ✅ `Stage_Entered_Negotiating__c` (TIMESTAMP) - When entered Negotiating stage
- ✅ `Stage_Entered_On_Hold__c` (TIMESTAMP) - When entered On Hold stage
- ✅ `Stage_Entered_Signed__c` (TIMESTAMP) - When entered Signed stage
- ✅ `StageName` (STRING) - Current stage
- ✅ `Opportunity_AUM` (FLOAT) - Deal size
- ✅ `aum_tier` (STRING) - AUM tier classification
- ✅ `SGM_Owner_Name__c` (STRING) - Owning SGM
- ❌ **No direct "LastModifiedDate" or "LastActivityDate" field**

**Proposed Solution - Flexible Age-Based Templates:**

Instead of trying to define "stale", create flexible templates that let users define age thresholds via parameters:

#### Option A: Age-Based Opportunity Analysis (Recommended)
Create `opportunities_by_age` template that allows users to specify:
- **Age calculation method:** 
  - `from_creation` - Age from `Opp_CreatedDate`
  - `from_stage_entry` - Age from most recent stage entry date (for specific stage)
- **Age threshold:** Configurable days (e.g., 180, 200)
- **Stage filter:** Optional (e.g., "On Hold", "Open Pipeline", specific stages)
- **AUM tier filter:** Optional (to account for larger deals taking longer)
- **Dimension grouping:** Optional (SGA, SGM, Channel, Source)
- **Output:** List of opportunities with age, stage, AUM, owner, etc.

**Example Queries Supported:**
- "What open opportunities are more than 180 days old?" → `opportunities_by_age` with `ageMethod='from_creation'`, `ageThreshold=180`, `stageFilter='open_pipeline'`
- "What on hold opportunities are more than 200 days old? and who is the owning SGM?" → `opportunities_by_age` with `ageMethod='from_stage_entry'`, `ageThreshold=200`, `stageFilter='On Hold'`, `includeDimensions=['sgm']`

#### Option B: Stage-Specific Age Analysis
Create `stage_age_analysis` template for opportunities in specific stage(s) older than threshold:
- **Stage(s):** Single stage or array of stages
- **Age threshold:** Days since stage entry
- **Age calculation:** From stage entry date (e.g., `Stage_Entered_On_Hold__c`)
- **Grouping:** Optional (SGA, SGM, AUM tier)

**Example Queries Supported:**
- "What opportunities in Discovery are more than 90 days old?" → `stage_age_analysis` with `stage='Discovery'`, `ageThreshold=90`

#### Option C: Multi-Dimensional Stale Analysis
Create `pipeline_age_breakdown` template that breaks down opportunities by:
- **Age buckets:** e.g., 0-30, 31-60, 61-90, 91-180, 181+ days
- **Stage:** Current stage
- **AUM tier:** To show that larger deals naturally take longer
- **Grouping:** Optional (SGA, SGM, Channel)

**Example Queries Supported:**
- "Show me pipeline breakdown by age and AUM tier" → `pipeline_age_breakdown` with `groupBy=['aum_tier']`

**Recommendation:**
- ✅ **Implement Option A** (`opportunities_by_age`) - Most flexible, covers all use cases
- ✅ **Consider Option B** (`stage_age_analysis`) - Useful for stage-specific analysis
- ⚠️ **Option C** (`pipeline_age_breakdown`) - Nice-to-have for visualization

**Why This Approach:**
1. **No "stale" definition needed** - Users define thresholds via parameters
2. **Flexible** - Supports all the example questions you provided
3. **AUM-aware** - Can filter/group by AUM tier to account for deal size
4. **Stage-aware** - Can filter by specific stages (On Hold, Open Pipeline, etc.)
5. **Dimension-aware** - Can group by SGA, SGM, Channel, Source

**Resolution:**
- ✅ **Template Added:** `opportunities_by_age` template now exists in `query-templates.ts`
- ✅ **Implementation:** Option A (flexible age-based template) implemented
- ✅ **Features:**
  - User-defined age thresholds (no defaults)
  - Two age calculation methods: `from_creation` (Opp_CreatedDate) and `from_stage_entry` (most recent stage entry)
  - Supports filtering by stage, AUM tier, SGA, SGM, Channel, Source
  - Supports grouping by dimensions (SGA, SGM, Channel, AUM tier, Source)
  - No AUM-tier-specific thresholds (as requested)
- ✅ **Validation:** All test queries validated via BigQuery MCP

**Technical Implementation:**
- Age from creation: `DATE_DIFF(CURRENT_DATE(), DATE(Opp_CreatedDate), DAY)`
- Age from stage entry: `DATE_DIFF(CURRENT_DATE(), DATE(GREATEST(Stage_Entered_Discovery__c, Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_On_Hold__c, Stage_Entered_Signed__c)), DAY)`
- Stage filtering: Supports "open_pipeline" (uses OPEN_PIPELINE_STAGES constant) or specific stage names
- Date field handling: All TIMESTAMP fields use DATE() casting for age calculation

**Example Queries Supported:**
- "What open opportunities are more than 180 days old?" → `opportunities_by_age` with `ageMethod='from_creation'`, `ageThreshold=180`, `stageFilter='open_pipeline'`
- "What on hold opportunities are more than 200 days old? and who is the owning SGM?" → `opportunities_by_age` with `ageMethod='from_stage_entry'`, `ageThreshold=200`, `stageFilter='On Hold'`, `groupBy=['sgm']`

**Next Steps:**  
- ✅ Template is ready for AI agent use
- ⚠️ Monitor user feedback on age-based opportunity questions

**Technical Implementation Notes:**
- Use `DATE_DIFF(CURRENT_DATE(), DATE(Opp_CreatedDate), DAY)` for creation age
- Use `GREATEST(Stage_Entered_Discovery__c, Stage_Entered_Sales_Process__c, ...)` for most recent stage entry
- Use `DATE()` casting for TIMESTAMP fields
- Filter by `StageName` for stage-specific queries
- Use `aum_tier` for AUM-based filtering/grouping

---

## Data Quality Observations

### Observation 1: DATE Field Comparison Pattern Inconsistency

**Finding:**  
The codebase uses multiple patterns for DATE field comparisons:
- Pattern 1: Direct comparison `field >= @date` (most efficient)
- Pattern 2: DATE wrapping `DATE(field) >= DATE(@startDate)`
- Pattern 3: TIMESTAMP wrapping `TIMESTAMP(field) >= TIMESTAMP(@startDate)`

**Question:**  
Should we standardize on one pattern for consistency?

**Options:**
- **A:** Standardize on direct comparison (most efficient)
- **B:** Standardize on DATE wrapping (explicit type casting)
- **C:** Standardize on TIMESTAMP wrapping (consistent with TIMESTAMP fields)
- **D:** Keep current patterns (all work, no change needed)

**Potential Impact:**  
- If A/B/C: Improved code maintainability and consistency
- If D: No change, but patterns remain inconsistent

**Recommendation:**  
- ⚠️ **Low Priority** - All patterns work correctly
- Consider standardizing in future refactor if time permits

---

### Observation 2: Semantic Layer Template Coverage

**Finding:**  
The semantic layer covers all critical dashboard functionality. Some advanced analytics patterns are missing but not blocking.

**Question:**  
Should we prioritize adding advanced templates now, or wait for user demand?

**Current Coverage:**
- ✅ All critical metrics (volumes, AUM, conversion rates)
- ✅ All critical dimensions (channel, source, SGA, SGM, etc.)
- ✅ All critical query patterns (single metric, by dimension, trends, comparisons)
- ⚠️ Some advanced patterns missing (multi-stage conversion, time-to-convert, etc.)

**Recommendation:**  
- ✅ **Semantic layer is production-ready** for AI agent use
- ⚠️ Advanced templates can be added incrementally based on user feedback

---

## Summary

**Total Questions:** 5 (4 resolved, 1 pending)  
**Total Confirmations:** 3 (all confirmed)  
**Total Requests:** 2 (pending priority decisions)  
**Total Observations:** 2 (low priority)

**Resolved in Phase 11:**
- ✅ Question 1: Multi-Stage Conversion Template - **ADDED**
- ✅ Question 2: Time-to-Convert Template - **ADDED**
- ✅ Question 3: Pipeline by Stage Template - **ADDED**
- ✅ Question 4: SGA Performance Summary Template - **ADDED**

**Resolved in Phase 12:**
- ✅ Request 1: Rolling Average Metrics - **ADDED**

**Resolved in Phase 13:**
- ✅ Request 2: Stale Pipeline Analysis - **ADDED** (implemented as flexible age-based template)

**Pending:**
- ⚠️ Question 5: Stale Pipeline Template Feasibility - **RESOLVED** (implemented as opportunities_by_age template)

**Next Steps:**
1. ✅ **COMPLETE:** Four templates added in Phase 11 (multi_stage_conversion, time_to_convert, pipeline_by_stage, sga_summary)
2. ✅ **COMPLETE:** Rolling average template added in Phase 12 (rolling_average)
3. ✅ **COMPLETE:** Age-based opportunity analysis template added in Phase 13 (opportunities_by_age)

**Current Status:**
- ✅ **Semantic layer is production-ready** for AI agent use
- ✅ **All critical templates implemented** (multi-stage conversion, time-to-convert, pipeline by stage, SGA summary, rolling average, opportunities by age)
- ✅ **Conversion rates always use cohort mode** (documented and enforced)
- ✅ **Rolling averages implemented** (supports all metrics, configurable windows, dimension grouping)
- ✅ **Age-based opportunity analysis implemented** (flexible age thresholds, no defaults, supports creation and stage entry age calculation)
- ⚠️ **Future enhancements** can be added based on user feedback and admin priorities

---

**Document Status:** ✅ Updated after Phase 12 - Ready for admin review of remaining questions

---

## Implementation Summary

### Templates Added

**Phase 11 (2026-01-26):**
1. ✅ `multi_stage_conversion` - Direct cohort conversion rates across multiple stages
2. ✅ `time_to_convert` - Average/median/min/max/percentile days between stages
3. ✅ `pipeline_by_stage` - Open pipeline breakdown by stage (count and AUM)
4. ✅ `sga_summary` - Complete performance summary for a specific SGA

**Phase 12 (2026-01-26):**
5. ✅ `rolling_average` - Rolling average of metrics over configurable time windows
   - Supports all metrics (volumes, AUM, conversion rates)
   - Configurable window sizes (1-365 days)
   - Always uses daily aggregation first, then rolling window
   - Supports grouping by dimensions (channel, source, SGA, etc.)
   - Returns both raw value and rolling average for comparison
   - Includes data availability tracking
   - Supports both time series and single value outputs
   - Calendar-based windows (not business days)
6. ✅ `metric_trend` (updated) - Added `includeRollingAverage` parameter for rolling averages of period aggregates

**Phase 13 (2026-01-26):**
7. ✅ `opportunities_by_age` - Flexible age-based opportunity analysis
   - User-defined age thresholds (no defaults)
   - Two age calculation methods: `from_creation` (Opp_CreatedDate) and `from_stage_entry` (most recent stage entry)
   - Supports filtering by stage, AUM tier, SGA, SGM, Channel, Source
   - Supports grouping by dimensions (SGA, SGM, Channel, AUM tier, Source)
   - No AUM-tier-specific thresholds

### Key Features Implemented

- ✅ **Multi-stage conversion rates** - Direct cohort calculation (more accurate than chaining)
- ✅ **Time-to-convert metrics** - Average/median/min/max/percentile days between stages
- ✅ **Pipeline breakdown** - Open pipeline by stage with count and AUM
- ✅ **SGA performance summaries** - Complete metrics in one query
- ✅ **Rolling averages** - Configurable windows with dimension grouping
- ✅ **Period aggregate rolling averages** - Rolling averages of monthly/quarterly totals
- ✅ **Age-based opportunity analysis** - Flexible age thresholds with creation and stage entry age calculation

### Validation Status

- ✅ All templates validated via BigQuery MCP dry-run
- ✅ All templates have validation examples
- ✅ All templates added to question patterns
- ✅ All templates documented in semantic_layer_corrections.md

---

## Implementation Summary by Phase

### Phase 11 (2026-01-26)
- Multi-stage conversion, time-to-convert, pipeline by stage, SGA summary templates

### Phase 12 (2026-01-26)
- Rolling average template with configurable windows and dimension grouping
- Metric trend template updated with rolling average support

### Phase 13 (2026-01-26)
- Opportunities by age template with flexible age thresholds and multiple calculation methods