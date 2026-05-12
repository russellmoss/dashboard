# DB Router Decision

```yaml
feature: "Add a 'Needs Linking' sub-tab to the Coaching Usage view at /dashboard/call-intelligence — surfaces call_notes not confidently attached to a Salesforce record, using sales-coaching confidence tiering (status='pending' OR linkage_strategy IN calendar_title/lead_contact_name/summary_name/manual_entry with confidence_tier IN possible/unlikely). Columns: call date, source, advisor hint, rep, manager, linkage_strategy, confidence_tier, days since call. RBAC: admins global, SGMs coachees only. Existing Coaching Usage view preserved byte-for-byte."
databases:
  bigquery:
    in_scope: false
    reason: "Feature queries call_notes linkage/confidence fields which live in sales-coaching Neon, not in any BigQuery view. No funnel, forecast, or activity data needed."
  neon_savvy_dashboard:
    in_scope: false
    reason: "Feature does not read or write any savvy-dashboard table. RBAC scope resolution uses coaching_teams/coaching_team_members/coaching_observers in the sales-coaching DB, not the Dashboard User table."
  neon_sales_coaching:
    in_scope: true
    reason: "call_notes table has linkage_strategy, confidence_tier, and status columns needed for the orphan filter. reps + coaching_teams/coaching_team_members/coaching_observers power getRepIdsVisibleToActor() RBAC."
preread_paths:
  neon_sales_coaching:
    - .claude/neon-sales-coaching.md
mcp_tools:
  neon_sales_coaching:
    - mcp__Neon__describe_table_schema
```
