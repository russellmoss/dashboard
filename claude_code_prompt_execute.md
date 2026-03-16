# Claude Code Prompt — Paste This

```
Read the file `C:\Users\russe\Documents\Dashboard\execute_full_deployment.md` in full. This is the final execution plan for deploying fixed BQ views and restructuring the Google Sheet source-detail sections.

Execute each phase in order. STOP at every gate and report results.

**Context:**

All decisions have been made and are documented in the "Approved Decisions" section at the top of the file. Do NOT ask for additional decisions — everything is specified.

**Files to read before starting:**
1. `C:\Users\russe\Documents\Dashboard\deploy_vw_channel_funnel_volume_by_month.sql` — current volume view SQL (to modify)
2. `C:\Users\russe\Documents\Dashboard\deploy_vw_channel_conversion_rates_pivoted.sql` — current rate view SQL (to modify)
3. `C:\Users\russe\Documents\Dashboard\views\vw_funnel_master.sql` — source view definition (for field names)
4. `C:\Users\russe\Documents\Dashboard\current_sheet_structure.md` — current sheet layout (row numbers, formula patterns)
5. `C:\Users\russe\Documents\Dashboard\sheet_restructure_plan.md` — migration map

**Tools:**
- BigQuery MCP (deploy views, run validation queries)
- Google Sheets MCP (read and write sheet cells/formulas)

**Google Sheet ID**: `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`
**Tab**: `Q2 forecast`

**Critical rules:**
1. Execute phases in order: Phase 1 (BQ views) → Phase 2 (Sheet restructure) → Phase 3 (Verification)
2. STOP at every gate — do NOT proceed without human approval
3. When rewriting SQL files, overwrite the existing files at their current paths
4. When modifying the sheet, work BOTTOM-TO-TOP (Other → Advisor Referrals → ... → Outbound) so row deletions don't affect unprocessed groups
5. When deleting source blocks from the sheet, delete entire rows (shift up) — do NOT just clear content
6. When creating new source blocks (Fintrx), copy the SUMPRODUCT formula pattern from an existing block in the same group
7. When promoting SUB → PRIMARY, add column G/H/J/L formula structure but leave H/J/L VALUES blank
8. Do NOT touch the summary section (rows 1–105) — only modify rows 106+
9. Do NOT modify vw_funnel_master or any dashboard application code
10. Track cumulative row offsets as you delete rows — log the offset after each group

Start with Phase 1 (rewrite and deploy BQ views).
```
