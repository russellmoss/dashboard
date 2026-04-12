# Triage Results: Council Feedback

## Bucket 1 — Applied Autonomously (9 fixes)

| # | Issue | Fix Applied | Source | Phase |
|---|-------|-------------|--------|-------|
| 1 | `googleapis` not installed | Already in Phase 0 | Codex | 0 |
| 2 | Concurrent processMessage threadIds | Already uses synthetic IDs | Codex | 3b |
| 3 | Frozen SQL is JSON array not string | Parse JSON, take last element in confirm_schedule handler | Codex | 4 |
| 4 | Cron route HTTP-only | Added documentation comment | Codex | 4 |
| 5 | New env vars not validated at startup | Added CRON_SECRET to optional validation | Codex | 4 |
| 6 | Schedule This button on zero-query responses | Gate on provenanceQueryCount > 0 | Codex | 4 |
| 7 | Failed schedules advance forever | Add failure_count column, auto-disable after 3 | Both | 2b,3a |
| 8 | Pool duplication | Create shared src/db.ts | Both | 2b |
| 9 | Docs API 429/500 retry | Add exponential backoff wrapper | Gemini | 2c |

## Bucket 2 — Needs Human Input (3 questions)

### Q1: Cloud Run memory — how much?
Current: 512MB. Council recommends 1GB-2GB for concurrent section processing.
**Options:** (a) 1GB — sufficient for most queries, low cost, (b) 2GB — headroom for large reports, moderate cost

### Q2: Temporary public chart files acceptable?
Charts uploaded to Drive with `anyone/reader` permission for ~5 seconds during Doc embedding, then deleted.
**Options:** (a) Accept for v1 with cleanup (low risk — aggregated data, not PII), (b) Defer chart embedding entirely, (c) Implement GCS signed URLs now (adds complexity)

### Q3: BQ streaming buffer race — how to handle frozen SQL retrieval?
If user clicks "Schedule This" immediately, BQ audit record may not be queryable yet.
**Options:** (a) Add a 5-second delay before querying BQ, (b) Pass sql_executed through the action button value (already available in the response), (c) Store frozen SQL in Neon alongside the thread

## Bucket 3 — Noted but Deferred (4 items)

| # | Item | Why Deferred |
|---|------|-------------|
| 1 | GCS signed URLs for chart embedding | Adds GCS dependency + complexity. Current approach works with cleanup. |
| 2 | Shared Drive for doc ownership | Requires Google Workspace admin setup. SA-owned docs are fine for v1. |
| 3 | Claude tool calling for report intent | Adds latency/cost to every message. Regex is instant and sufficient. |
| 4 | Sequential section processing | Concurrent is fine with 1GB+ RAM. |
