# Savvy Analyst Bot — Data Accuracy and Correctness Audit

Date: 2026-04-11

---

## CRITICAL FINDING 1: System Prompt References Tools That Don't Exist

The system prompt instructs Claude to call `describe_view`, `get_metric`, and `lint_query` before every query. The MCP server exposes none of these tools.

Tools the system prompt tells Claude to call:
- `describe_view` — does not exist
- `get_metric` — does not exist
- `lint_query` — does not exist

Tools the MCP server actually exposes:
- `schema_context` — returns the raw YAML config (with optional term filter)
- `execute_sql`
- `describe_table`
- `list_tables`
- `list_datasets`

Audit confirmation: across 124 interactions, `lint_query` was called 0 times and `describe_view` was called 0 times. Claude silently skips pre-query validation because the tools don't exist. What Claude actually does is call `schema_context` and `describe_table` as rough substitutes.

Impact: The `lint_query` tool is described as "MANDATORY" with "No exceptions" language. Because it doesn't exist, every query executes without linting. The rules in schema-config.yaml are never programmatically enforced.

---

## CRITICAL FINDING 2: sql_executed Audit Field Is Always Empty

`packages/analyst-bot/src/claude.ts` line 164 extracts SQL:

```typescript
if (block.name === 'execute_sql' && block.input?.sql) {
  sqlExecuted.push(block.input.sql);
}
```

The MCP server's `execute_sql` tool uses `query` as the parameter name, not `sql`. So `block.input?.sql` is always undefined.

Audit confirmation: all 124 records have `sql_executed = "[]"`, even for interactions with 3-7 `execute_sql` invocations with full SQL in `input.query`.

Fix: Change `block.input?.sql` to `block.input?.query`.

---

## CRITICAL FINDING 3: Active SGA Filter Not Reliably Applied

The MQL-to-SQO SGA leaderboard query from 2026-04-11 02:36 used `COALESCE(SGA_Owner_Name__c, Opp_SGA_Name__c)` but did NOT join to the User table.

Quantified impact:
- Without User join: 30 "SGA" rows, team average MQL-to-SQO = 43.6%
- With User join: 17 active SGA rows, team average MQL-to-SQO = 30.2%
- Delta: 13.4 percentage point overstatement

Root cause: The system prompt rule triggers on "groups by SGA" and gives `task_executor_name` as the join key example. Claude treats it as a `task_executor_name`-specific rule rather than applying it to any SGA name column.

---

## FINDING 4: Dedup Flags — No Inflation Risk This Quarter

Q2 2026 ground truth: `is_sqo_unique` + `recordtypeid` → 22 SQOs. Same result without dedup. No measurable inflation for current early-quarter period. Risk remains for historical/high-volume analysis.

---

## FINDING 5: Won Deal Definition Correctly Enforced

System prompt correctly defines "Won = Joined ONLY, not Signed." The `won_deal_joined_only` rule in schema config bans `StageName IN ('Joined', 'Signed')`. Both controls in place.

---

## FINDING 6: Cohort Rate Computation Correct

Q1 2026 SQL-to-SQO cohort rate: 181/240 = 75.4%. Period mode gives 73.3%. Schema config has full cohort-mode fields documented. Claude applies correctly in most interactions.

---

## FINDING 7: schema_context Tool Has Fragile Search

When a `term` parameter is provided, the tool does line-level substring matching against raw YAML. Returns individual lines out of context. Claude compensates by calling `schema_context` without a term ~40% of the time for full context. The term-search path is unreliable for rule discovery.

---

## FINDING 8: LIMIT Injection Is Safe

`mcp-server/src/query-validator.ts` injects `LIMIT 1000` on queries without LIMIT. Safe for aggregates. Claude's explicit LIMITs are preserved.

---

## FINDING 9: Audit Trail Operational But Missing SQL Forensics

124 records spanning 2026-04-10 to 2026-04-11:
- 0 application-level errors
- 44 charts (35.5%)
- 15 XLSX exports (12.1%)
- 25 issue reports (20.2%)

`sql_executed` always empty (Finding 2). SQL CAN be reconstructed from `tool_calls[].input.query` but not directly from the dedicated field.

`bytes_scanned` also broken: MCP returns `bytesProcessed` but claude.ts parses for `"bytes_scanned"`.

---

## FINDING 10: SGA Attribution Complexity Partially Addressed

Three SGA name columns exist. `dual_sga_attribution` rule correctly says to use COALESCE. Gap: User join enforcement only applies when Claude uses `task_executor_name`, not other SGA columns.

---

## Summary: What Needs To Be Fixed

### P0 — Data correctness bugs:

1. `claude.ts` line 164: `block.input?.sql` → `block.input?.query` (fixes empty sql_executed)
2. System prompt SGA filter rule: explicitly enumerate ALL SGA name columns requiring User join

### P1 — Structural gap:

3. System prompt: remove references to nonexistent tools (`describe_view`, `get_metric`, `lint_query`). Replace with guidance to call `schema_context` without term param for full context.
4. MCP server: term search returns single lines without context. Needs block-aware search.

### P2 — Observability:

5. `claude.ts`: fix bytes_scanned extraction — MCP returns `bytesProcessed` not `bytes_scanned`

### Already working correctly:

- Won deal definition (Joined only)
- Cohort vs period mode
- Dedup flags
- AUM calculation
- Date type handling
- Query safety controls (read-only, 1GB cap, 120s timeout, LIMIT injection)
- Audit trail infrastructure (tool_calls JSON fully populated)
