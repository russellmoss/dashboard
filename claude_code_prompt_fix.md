# Claude Code Prompt — Paste This

```
Read the file `C:\Users\russe\Documents\Dashboard\fix_and_deploy_prompt.md` in full. This is a multi-phase implementation plan for fixing two BQ views and updating Google Sheet formulas.

Execute each phase in order. STOP at every "STOP" gate and report your findings before proceeding.

**Key context you need:**

1. Two BQ views were recently deployed but have bugs:
   - `savvy-gtm-analytics.Tableau_Views.vw_channel_funnel_volume_by_month`
   - `savvy-gtm-analytics.Tableau_Views.vw_channel_conversion_rates_pivoted`

2. The SQL source files are at:
   - `C:\Users\russe\Documents\Dashboard\deploy_vw_channel_funnel_volume_by_month.sql`
   - `C:\Users\russe\Documents\Dashboard\deploy_vw_channel_conversion_rates_pivoted.sql`

3. Both views query `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` as their source.
   Read the vw_funnel_master definition at `C:\Users\russe\Documents\Dashboard\views\vw_funnel_master.sql` to understand the available fields — especially the eligibility/progression flags.

4. The Google Sheet ID is `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`, tab `Q2 forecast`.

5. You have MCP access to both BigQuery and Google Sheets.

**The two bugs to fix:**

Bug 1 — Multi-Finance_View inflation: 4 Original_source values (LinkedIn Self Sourced, Fintrx Self-Sourced, Direct Traffic, Re-Engagement) span multiple Finance_View groups. Sheet SUMPRODUCT formulas sum rates across all matching rows → rates exceed 100%. Fix by enforcing a 1:1 Original_source → Finance_View mapping.

Bug 2 — Source name mismatches: Several sources were renamed when we switched from LeadSource to Final_Source__c. Sheet formulas still reference old names → return 0. Fix by updating the formula strings.

**Methodology change (conversion rates only):**

Switch from same-period progression to COHORTED resolution-based conversion rates:
- Numerators: use `contacted_to_mql_progression`, `mql_to_sql_progression`, `sql_to_sqo_progression`, `sqo_to_joined_progression` from vw_funnel_master
- Denominators: use `eligible_for_contacted_conversions_30d` (30-day timeout), `eligible_for_mql_conversions`, `eligible_for_sql_conversions`, `eligible_for_sqo_conversions` from vw_funnel_master
- Created→Contacted: use all-prospects denominator (no resolution gating — just eventual contact rate)

**Execution rules:**
- Execute phases in order: 1 → 2 → 3 → 4 → 5
- STOP at every gate and wait for human approval
- When modifying SQL files, overwrite the existing files
- When modifying Google Sheet formulas, change ONLY the source name string — do not alter formula structure
- Run all verification queries and report results clearly
- Do NOT modify vw_funnel_master or any dashboard application code

Start with Phase 1.
```
