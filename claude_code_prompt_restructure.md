# Claude Code Prompt — Paste This

```
Read the file `C:\Users\russe\Documents\Dashboard\sheet_restructure_plan_prompt.md` in full. This is a multi-phase planning document for restructuring the Google Sheet forecast's source-detail sections to match the new Final_Source__c taxonomy.

Execute phases in order. STOP at every gate.

**Context:**

We're NOT deploying anything yet. This phase is purely planning — mapping the old sheet structure, designing the new structure, and getting approval before touching anything.

The two BQ view SQL files exist but are NOT being deployed until the full plan (views + sheet restructure) is approved together:
- `C:\Users\russe\Documents\Dashboard\deploy_vw_channel_funnel_volume_by_month.sql`
- `C:\Users\russe\Documents\Dashboard\deploy_vw_channel_conversion_rates_pivoted.sql`

Reference files already created by previous phases:
- `C:\Users\russe\Documents\Dashboard\source_inventory.md` — complete Original_source × Finance_View__c cross-reference with proposed CASE mapping
- `C:\Users\russe\Documents\Dashboard\source_name_mapping.md` — current sheet↔BQ source name mapping

**Tools available:**
- BigQuery MCP (for querying vw_funnel_master volumes)
- Google Sheets MCP (for reading the sheet structure and formulas)

**Google Sheet ID**: `1JjmBA-z4yzD-iGLhrf_XTuHdBSgtQjeU1ih9c5-ujFc`
**Tab**: `Q2 forecast`

**Rules:**
- DO NOT deploy any BQ views
- DO NOT modify the Google Sheet
- DO NOT modify any dashboard code
- Only READ from BQ and Google Sheets
- Write all planning output to markdown files in `C:\Users\russe\Documents\Dashboard\`

Start with Phase 1.
```
