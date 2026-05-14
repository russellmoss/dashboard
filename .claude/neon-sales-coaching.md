# Neon Schema Context — sales_coaching

**Project ID:** `falling-hall-15641609`
**Default branch / database:** `main` / `neondb`
**Postgres version:** 17.8
**Endpoint host (pooled):** `ep-summer-leaf-am1isxbk-pooler.c-5.us-east-1.aws.neon.tech`
**Region:** aws-us-east-1
**Last refreshed:** 2026-05-12

> **HARD GATE:** Before writing any SQL against this Neon DB or modifying a query against it, you MUST (a) call `mcp__Neon__describe_table_schema` for the live column list, AND (b) consult the relevant table section in this doc for business purpose, grain, and known traps. Most schema names use snake_case. PKs are uuid. JSONB columns are extensively documented below — **DO NOT GUESS** the shape of `evaluations.dimension_scores`, `evaluations.narrative`, or `notification_outbox.payload`.
>
> **Authoritative upstream context:** The sales-coaching repo at `C:\Users\russe\Documents\sales-coaching` has a hand-curated semantic layer at `docs/db-schema-context.yaml` (1,819 lines) plus auto-gen `docs/_generated/db-schema.md` (42 tables, 527 columns @ 2026-05-11). When this doc is silent or stale, fall back to those.

---

## At a Glance

| Stat | Value |
|---|---|
| Total public tables | 43 |
| `neon_auth.*` tables | 9 (Neon Auth managed — do not modify) |
| Other schemas | `auth`, `pgrst` (PostgREST machinery) |
| Tables with JSONB | 13 with data, 5 with 0 rows, 3 tables with no JSONB at all |
| Hot tables (by usage) | `call_notes` (574 rows, **90 cols**), `evaluations` (431 rows, **44 cols**), `call_transcripts` (538), `ai_usage_log` (607), `notification_outbox` (619) |
| Wide tables (>50 cols) | `call_notes` (90), `evaluations` (44), `ai_feedback` (32) |
| Dormant tables (0 rows / no Dashboard consumer) | `advisor_summaries`, `coaching_briefs`, `content_refinement_requests`, `eval_correction_diff_jobs`, `eval_correction_judgments`, `eval_correction_retrievals`, `evaluation_comments`, `job3_dormancy_alert_state`, `onboarding_assignments`, `rollout_windows`, `salesforce_credentials`, `transcript_comments`, `admin_rate_limits` |
| Extensions | `vector` (pgvector 0.8.0), `pgcrypto`, `pg_session_jwt` |
| Migration authority | Hand-rolled SQL at `src/lib/db/migrations/0NN_*.sql` (001-043) in the **sales-coaching** repo, applied manually via `scripts/apply-migrations.mjs` |
| Owner repo | `C:\Users\russe\Documents\sales-coaching` (Express + raw `pg`, NOT Next.js, NO ORM) |

## How Dashboard Connects (Critical — Two-Tier Split)

> **TRAP: Dashboard is NOT a pure bridge HTTP client.** It has a **direct `pg.Pool` connection** to this DB at `src/lib/coachingDb.ts:13`. The split is intentional:
>
> - **Read-heavy analytics → direct `pg`** via `getCoachingPool()` (`src/lib/coachingDb.ts`). 14 source files, bypassing the bridge to avoid HTTP round-trip latency for the eval queue, Insights tab, coaching usage, knowledge-gap clusters, and dimension heatmap.
> - **Writes / mutations → bridge HTTP** via `salesCoachingClient` (`src/lib/sales-coaching-client/`). 26 methods covering user management, eval edits, rubric CRUD, note review, content refinements, cost analysis. The bridge does OCC versioning, SFDC orchestration, and server-side business rules.
>
> Implication: Dashboard has a **direct schema dependency** on the read-side tables below. Column renames here will break Dashboard at runtime without bridge contract warning. When sales-coaching renames or restructures any of these tables, Dashboard must update in lockstep (or earlier).
>
> Env vars (`.env.example`):
> - `SALES_COACHING_API_URL` — bridge HTTP base URL
> - `DASHBOARD_BRIDGE_SECRET` — HMAC-SHA256 signing key for the bridge JWT (30s TTL)
> - `SALES_COACHING_DATABASE_URL` (pooled) and `SALES_COACHING_DATABASE_URL_UNPOOLED` — direct pg connection

### Tables Dashboard accesses directly via `pg` (read-only)

| Table | Used in (sample) |
|---|---|
| `evaluations` | eval queue, eval detail, Insights tab, coaching usage |
| `call_notes` | all of the above + record-notes feature |
| `call_transcripts` | eval detail, coaching usage per-call route |
| `transcript_comments` | eval detail |
| `reps` | every direct-pg query (visibility + identity) |
| `coaching_teams`, `coaching_team_members`, `coaching_observers` | `getRepIdsVisibleToActor()` — RBAC scope resolution |
| `rep_deferrals` | knowledge-gap clusters CTE |
| `knowledge_base_chunks` | KB chunk lookup by ID, gap clustering |
| `rubrics` | rubric list + eval detail join |
| `content_refinement_requests` | refinement list query |
| `sfdc_write_log` | `pushed_to_sfdc` EXISTS check |
| `slack_review_messages` | coaching usage — `sfdc_suggestion` JSONB read |
| `ai_feedback` | coaching usage — `has_ai_feedback` EXISTS check |
| `evaluation_edit_audit_log` | coaching usage — `has_manager_edit_eval` EXISTS check |
| `objections` | opportunity ai-summary + chat — objection data for calls via `getObjectionsForCalls()` |
| `opportunity_chat_threads` | opportunity chat — thread CRUD (Dashboard-owned, direct pg read+write) |
| `opportunity_chat_messages` | opportunity chat — message CRUD (Dashboard-owned, direct pg read+write) |

### Tables Dashboard owns and writes directly (no bridge, no upstream consumer)

`opportunity_chat_threads`, `opportunity_chat_messages` — created by Dashboard migration, no sales-coaching service code reads or writes them. Direct pg via `getCoachingPool()`. Columns: threads has `id UUID PK, sfdc_opportunity_id TEXT, user_email TEXT, call_note_ids_hash TEXT, title TEXT, last_message_at TIMESTAMPTZ, created_at TIMESTAMPTZ`; messages has `id UUID PK, thread_id UUID FK CASCADE, role TEXT CHECK (user/assistant/system), content TEXT, cited_chunk_ids UUID[], created_at TIMESTAMPTZ`. Multiple threads per (opp, user) allowed — no UNIQUE constraint.

### Tables Dashboard mutates via bridge only (no direct pg writes)

`evaluations`, `reps`, `call_notes`, `transcript_comments`, `rubrics`, `content_refinement_requests`, `sfdc_write_log` (via `submitNoteReview`).

### Tables Dashboard never touches (~22 tables)

All `neon_auth.*`, all `kb_vocab_*`, `evaluation_comments`, `eval_correction_*` (3 tables — features not yet active), `eval_body_backfill_audit`, `kb_corrections_log`, `call_note_enrichments`, `email_enrichments`, `coaching_briefs`, `coaching_doc_outbox`, `notification_outbox`, `salesforce_credentials`, `admin_audit_log`, `admin_rate_limits`, `advisor_summaries`, `job3_dormancy_alert_state`, `long_note_alert_state`, `onboarding_assignments`, `rollout_windows`, `sync_state`. These are sales-coaching internals.

---

## Domain Map

| Domain | Purpose | Key tables |
|---|---|---|
| **Evaluation Pipeline** | Claude-evaluated coaching scoring per call_note. Citation-driven. Version-aware. The core domain. | `evaluations`, `evaluation_comments`, `evaluation_edit_audit_log`, `eval_body_backfill_audit`, `eval_correction_*` (3) |
| **Knowledge Base** | RAG corpus for the evaluator. 768-dim Vertex embeddings + HNSW index. Controlled vocab via `kb_vocab_*`. | `knowledge_base_chunks`, `kb_corrections_log`, `kb_vocab_*` (5), `content_refinement_requests` |
| **Call Surface** | Ingested calls (Granola + Kixie sources) and their transcripts. | `call_notes`, `call_note_enrichments`, `call_transcripts`, `transcript_comments`, `email_enrichments` |
| **Coaching Org** | Pods, observers, team memberships. RBAC scope resolution. | `coaching_briefs`, `coaching_doc_outbox`, `coaching_observers`, `coaching_team_members`, `coaching_teams` |
| **Outbox / Integrations** | Durable Slack dispatch + SFDC writes + OAuth credentials. | `notification_outbox`, `sfdc_write_log`, `salesforce_credentials`, `slack_review_messages` |
| **Internal / Audit / Misc** | Admin endpoints, rate limits, cost log, dormancy alerts, etc. | `admin_audit_log`, `admin_rate_limits`, `advisor_summaries`, `ai_feedback`, `ai_usage_log`, `job3_dormancy_alert_state`, `long_note_alert_state`, `objections`, `onboarding_assignments`, `rep_deferrals`, `reps`, `rollout_windows`, `rubrics`, `sync_state` |
| **Neon Auth (managed)** | sales-coaching's auth layer. Do not modify. | `neon_auth.*` (9 tables) |

---

## Per-Table Detail

For each table: purpose, grain, lifecycle, and Dashboard's access pattern. Live columns/FKs are NOT duplicated here — call `mcp__Neon__describe_table_schema` for current truth. Upstream-only domain detail lives in `sales-coaching/docs/db-schema-context.yaml`.

### Evaluation Pipeline

#### `evaluations` (Dashboard: direct-pg read + bridge write)
**Purpose:** Claude rubric evaluation per `call_notes` row. Citation-driven — every AI claim cites a transcript utterance and/or KB chunk.
**Grain:** one row per (call_note, rubric_run). Multiple evaluations per call_note allowed (re-score).
**Lifecycle:** mutable on `dimension_scores` / `narrative` / `strengths` / etc. via manager edits (OCC via `edit_version`). `ai_original` JSONB is **trigger-enforced immutable** (`trg_prevent_ai_original_update`). `rep_deferrals` JSONB is also immutable post-eval — corrections route through `ai_feedback`.
**JSONB columns (10 of them):** `narrative`, `dimension_scores`, `additional_observations`, `ai_original`, `compliance_flags`, `eval_input_receipt`, `knowledge_gaps`, `rep_deferrals`, `strengths`, `weaknesses`. Plus 2 zero-data columns: `ai_baseline_shadow` (reserved for A/B shadow capture) and `coaching_nudge` (reserved). See JSONB Shapes section.
**Schema versions:** v1→v6 (v3=coachingNudge, v4=additional_observations, v5=rep_deferrals JSONB, v6=per-dim `body` rationale). **TRAP:** dimension keys vary by rubric version — v1 has 15 dimensions, v2 has 7. Never assume a fixed key set.
**Bridge mutations:** `salesCoachingClient.editEvaluation()`, `setRevealScheduling()`, `manualReveal()`, `bulkReassignPendingEvals()`.
**Direct-pg reads:** `src/lib/queries/call-intelligence-evaluations.ts`, `src/lib/queries/call-intelligence/insights-evals-list.ts`, `src/lib/queries/call-intelligence/knowledge-gap-clusters.ts`, `src/lib/queries/call-intelligence/dimension-heatmap.ts`, `src/app/api/admin/coaching-usage/route.ts`.

#### `evaluation_comments` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Evaluation-level threaded coaching conversation (manager ↔ rep). Distinct from `transcript_comments` (utterance-pinned).
**Status:** 0 rows currently; Dashboard does not read or write this table.

#### `evaluation_edit_audit_log` (Dashboard: direct-pg read only)
**Purpose:** Append-only audit of every eval-narrative edit (Slack feedback flow + dashboard PATCH). Captures whole-column snapshot before/after as JSONB.
**Grain:** one row per modified field per edit operation.
**Lifecycle:** append-only. No UPDATE/DELETE.
**`edit_source` enum:** `slack_dm_single_claim` / `slack_dm_edit_eval` / `slack_dm_edit_eval_text` / `web_app` / `admin_api` / `dashboard_api`. Dashboard writes go to `dashboard_api` source via the bridge.
**Dashboard reads:** `src/app/api/admin/coaching-usage/route.ts` — `has_manager_edit_eval` EXISTS check.

#### `eval_body_backfill_audit` (Dashboard: NOT ACCESSED at runtime — but **written by Dashboard's offline backfill script**)
**Purpose:** Tracks the one-time offline backfill of per-dimension `body` field (the 2-3 sentence AI rationale) across ~406 historical evaluations pre-dating schema v6.
**Authoring side:** `C:\Users\russe\Documents\Dashboard\scripts\backfill-dimension-bodies.cjs` — written by Dashboard but populates a sales-coaching table directly.
**Grain:** one row per (evaluation_id, attempt_number).
**Status enum:** `pending | success | failure | skipped`.

#### `eval_correction_diff_jobs`, `eval_correction_judgments`, `eval_correction_retrievals` (Dashboard: NOT ACCESSED)
**Purpose:** Phase 2 evaluator correction pipeline — RAG-retrieved approved `ai_feedback` injected into eval prompts; outbox-based diff-job pattern; Haiku judge verdicts gated by `rollout_windows`.
**Status:** 0 rows currently (Phase 2 not yet activated). Dashboard does not surface these — Phase 2.5+ may add a Dashboard observability view, but not yet.

---

### Knowledge Base

#### `knowledge_base_chunks` (Dashboard: direct-pg read only)
**Purpose:** Drive-sync RAG corpus. 768-dim Vertex `text-embedding-004` embeddings + HNSW cosine index + GIN indexes on `topics` / `call_stages` / `rubric_dimensions` arrays.
**Grain:** one chunk per `(drive_file_id, chunk_index)`. UNIQUE.
> **TRAP — schema names:** PK is `id` (uuid), body column is `body_text`. There is **NO `chunk_id` column**. `chunk_index` exists but it is the within-doc ordinal (part of the UNIQUE constraint), not a chunk-identity field. See [[feedback-coaching-db-schema-traps]].
**Lifecycle:** Stable across re-syncs (chunk UUID immutable; `drive_revision_id` bumps). Soft-delete via `is_active=false` + `deleted_at` tombstone.
**Vocab dependency:** `topics`, `call_stages`, `rubric_dimensions` array values are validated against `kb_vocab_*` at Drive-sync time.
**Dashboard reads:** `src/lib/queries/call-intelligence-evaluations.ts` — `getKbChunksByIds()`; `src/lib/queries/call-intelligence/knowledge-gap-clusters.ts` — LATERAL join for topics.

#### `kb_corrections_log` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Audit trail for `/kb-fix` interactive corrections (terminal CLI tool in sales-coaching).
**Grain:** one row per concern per diagnose-cycle.
**Status lifecycle:** `diagnosed → applied | abandoned → reverted`.
**JSONB column:** `change_payload` — see JSONB Shapes section.

#### `kb_vocab_call_stages`, `kb_vocab_objection_types`, `kb_vocab_owners`, `kb_vocab_rubric_dimensions`, `kb_vocab_topics` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Controlled vocabularies. Counts (as of 2026-05-12): 11 call stages, 18 objection types, 3 owners, 22 rubric dimensions (15 SGA + 7 SGM), 31 topics.
**Append-only.** Deprecate-don't-delete policy. Changing/adding values requires migration + (for some) matching playbook doc.

#### `content_refinement_requests` (Dashboard: direct-pg read + bridge write)
**Purpose:** Manager-flagged KB content edits — surfaces problems with KB chunks discovered while reviewing evals.
**Grain:** one open request per `(requested_by, evaluation_id, doc_id, MD5(excerpt))` — partial UNIQUE WHERE open.
**Lifecycle:** `open → addressed | declined`.
**Bridge mutations:** `submitContentRefinement()`, `resolveContentRefinement()`, `listMyContentRefinements()`.
**Direct-pg reads:** `src/lib/queries/call-intelligence-refinements.ts`.

---

### Call Surface

#### `call_notes` (Dashboard: direct-pg read + bridge write) — 90 COLUMNS — THE WIDEST TABLE
**Purpose:** Canonical record of every ingested call. Source-discriminated.
**Grain:** one row per ingested call.
**Source enum:** `granola` (rep-attended discovery calls, polled per-user) or `kixie` (outbound > 5min recorded + inbound). Source identity check enforced via `call_notes_source_identity_check`:
- Granola → `granola_note_id` + `granola_web_url` NOT NULL
- Kixie → `kixie_task_id` + `kixie_recording_url` NOT NULL
> **TRAP — FK target:** `call_notes.id` (UUID) is the **canonical FK target**. `granola_note_id` and `kixie_task_id` are ingest-idempotency keys ONLY — never use them as join keys.
**Lifecycle:** Frozen at ingest (no production read path re-fetches). Soft-delete via `source_deleted_at` tombstone — the ONLY soft-delete mechanism.
**State machines (parallel):** `status`, `pipeline_status` (Kixie only), `eval_status`, `competitor_extraction_status`, `rep_deferral_extraction_status`, `objection_extraction_status`, `enrichment_state`.
**Cascade behavior:** Heavy — deleting a `call_notes` row cascades to `evaluations`, `call_transcripts`, `transcript_comments`, `rep_deferrals`, `objections`, etc.
**Bridge mutations:** `editCallNote()`, `setSfdcLink()`, `submitNoteReview()`, `rejectNoteReview()`, `searchSfdcForNote()`.
**Direct-pg reads:** `src/lib/queries/call-intelligence-evaluations.ts`, `src/lib/queries/record-notes.ts`, every insights-tab query, coaching-usage routes, eval-detail RBAC check.

#### `call_note_enrichments` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Many-to-many between `call_notes` and `email_enrichments`. One call_note can wait on N pending emails; one canonical enrichment row can be attached to M call_notes.
**Cross-table invariant:** `call_notes.enrichment_state='waiting'` iff `EXISTS(... WHERE resolved_at IS NULL)`.

#### `call_transcripts` (Dashboard: direct-pg read)
**Purpose:** Normalized transcripts, 1:1 with `call_notes`. Stored separately so list/detail queries don't pull 50-200KB JSON.
**Grain:** one row per call_note (1:1). PK + FK is `call_note_id`.
**JSONB column:** `transcript` — array of `TranscriptUtterance`.
> **TRAP — shape:** `transcript` uses `speaker_role` + seconds offsets, NOT speaker name + absolute timestamps. Element shape: `{ utterance_index, speaker_role, text, start_seconds, end_seconds }`. See [[feedback-coaching-db-schema-traps]]. Originally created as `evaluation_transcripts` in migration 001, then **renamed + re-keyed to `call_note_id`** in migration 004 ("invariant wins over schema shape").
**Dashboard reads:** `src/lib/queries/call-intelligence-evaluations.ts:getEvaluationDetail()` — LEFT JOIN; `src/app/api/admin/coaching-usage/call/[id]/route.ts`.

#### `transcript_comments` (Dashboard: direct-pg read + bridge write)
**Purpose:** Utterance-level manager/rep/admin notes pinned to specific transcript lines (sidebar pins on eval-detail UI).
**Grain:** one row per utterance pin per author.
**`author_role` enum:** `manager | rep | admin` (admin added in migration 037).
**`utterance_index`** is the index into `call_transcripts.transcript[]`.
**Status:** 0 rows currently.
**Bridge mutations:** `createTranscriptComment()`, `deleteTranscriptComment()`.
**Direct-pg reads:** `src/lib/queries/call-intelligence-evaluations.ts:getTranscriptComments()`.

#### `email_enrichments` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Clay email→name enrichment cache. Powers SFDC name-SOQL fallback for the waterfall.
**Grain:** one row per `LOWER(email)` (case-insensitive UNIQUE).
**State machine:** `pending → resolved | unresolvable | failed_permanent | expired`. TTL-bounded.

---

### Coaching Org

#### `coaching_briefs` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** AI coaching intelligence outputs (Step 7) — weekly team brief, rep trajectory summary, pattern-detection alerts.
**Grain:** one row per (brief_type, target, period). `brief_type ∈ {weekly_team | rep_trajectory | pattern_alert}`.
**Status:** 0 rows currently. Aggregate output — references `evaluation_id`s in metadata rather than carrying per-claim citations.

#### `coaching_doc_outbox` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Outbox for SGA→SGM Advisor Notes Doc creation. Sequenced producer pattern.
**Grain:** one row per SGA Kixie call_note (UNIQUE).
**State columns:** `google_file_id`, `acl_applied_at`, `sfdc_enqueued_at`. Status `pending → claimed → succeeded | failed_permanent`.

#### `coaching_observers` (Dashboard: direct-pg read only)
**Purpose:** Coaching DM observer subscriptions. Combined with admin-implicit-all (every active admin is an implicit observer with no row required).
**Grain:** one row per (rep, scope) where scope = `all_sga | all_sgm | team`. Partial UNIQUE on `is_active=true`.
**Constraint:** `team_id NOT NULL iff scope='team'`.
**Dashboard reads:** `src/lib/queries/call-intelligence/visible-reps.ts:getRepIdsVisibleToActor()` — scope=all_sgm and scope=all_sga branches.

#### `coaching_team_members` (Dashboard: direct-pg read only)
**Purpose:** Many-to-many mapping of reps to `coaching_teams`.
**Grain:** composite PK `(team_id, rep_id)`.
**Dashboard reads:** all visibility queries (`getRepIdsVisibleToActor`, `getVisibleRepsDetail`, `getActivePodsVisibleToActor`), and every Insights tab query.

#### `coaching_teams` (Dashboard: direct-pg read only)
**Purpose:** Named groups of reps. Two orthogonal roles: (1) coaching-observer routing (`scope='team'` subscriptions auto-pick-up membership churn); (2) pod-director org structure via `lead_rep_id` (added in migration 040).
**Grain:** one row per team. Soft-delete via `is_active`. Case-insensitive UNIQUE on `name` when active.
**Powers:** Step 5c-1 Team Insights pod-axis queries.
**Dashboard reads:** all visibility queries, all Insights tab queries.

---

### Outbox / Integrations

#### `notification_outbox` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Durable Slack dispatch with at-least-once + idempotency. Producers INSERT inside their writer tx; drainer cron sends exactly once.
**Grain:** one row per notification. Scope CHECK: at-least-one of `(evaluation_id, call_note_id)` non-null. Two partial UNIQUE indexes prevent duplicate notifications per scope.
**State machine:** `pending → sent | failed_retryable → sent | failed_dead`. Also `pending → pending_long_note_review` (parked indefinitely).
**JSONB column:** `payload` — polymorphic by `notification_kind`. 6 observed kinds — see JSONB Shapes section.

#### `sfdc_write_log` (Dashboard: direct-pg read + bridge-triggered write)
**Purpose:** Every SFDC write attempt — for retry, audit, idempotency. Granola flow = CREATE Task; Kixie flow = APPEND.
**Grain:** one row per (call_note_id, kind) live attempt. Partial UNIQUE `(call_note_id, COALESCE(request_body->>'kind','create'))`.
**State machine:** `pending → success | failed | failed_permanent | lead_conversion_sweep`.
**TRAP:** `request_body.kind` is a JSONB discriminator, NOT a column.
**Dashboard reads:** `pushed_to_sfdc` EXISTS check (record-notes fetch, coaching-usage).
**Bridge-triggered write:** `salesCoachingClient.submitNoteReview()` returns the new `sfdc_write_log_id`.

#### `salesforce_credentials` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Single-row integration-user OAuth ciphertext (AES-256-GCM via `SFDC_ENCRYPTION_KEY`).
**Grain:** SINGLETON — `idx_salesforce_credentials_singleton UNIQUE INDEX ON ((true))` enforces 1-row.

#### `slack_review_messages` (Dashboard: direct-pg read only)
**Purpose:** 1:1 with `call_notes` — tracks Slack DM/modal/web review surface state.
**Grain:** one row per call_note per surface. `surface ∈ {dm | modal | web | preview}`.
**JSONB columns:** `sfdc_suggestion` (BridgeSfdcSuggestion shape — `.passthrough()` in Zod for forward-compat).
**Dashboard reads:** `src/app/api/admin/coaching-usage/route.ts` — pre-push granola stage resolution.

---

### Internal / Audit / Misc

#### `admin_audit_log` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Generic audit log for admin endpoint actions (originally Step 4b doc regen; extended to dashboard_api).
**Grain:** one row per admin invocation. `actor_present` CHECK: either `requested_by_admin_secret_hash` OR (`dashboard_user_email` AND `acting_rep_id`).

#### `admin_rate_limits` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Postgres-backed rate-limit state for `/api/admin/sync-kb-now` and `/sync-kb-now/all`. Avoids in-memory unsafe under Cloud Run horizontal scaling.
**Grain:** one row per (key). Atomic INSERT...ON CONFLICT DO UPDATE.

#### `advisor_summaries` (Dashboard: NOT ACCESSED — upstream-only, dormant)
**Purpose:** Cached three-section AI overview per advisor (Step 5d).
**Grain:** UNIQUE on `advisor_sfdc_id`.
**Status:** 0 rows — feature not yet active.

#### `ai_feedback` (Dashboard: direct-pg read only)
**Purpose:** Manager corrections of AI evaluation claims. **Manager-only, never rep-visible** (Q5 invariant, locked by `COMMENT ON TABLE`). Drives KB correction RAG via pgvector cosine waterfall.
**Grain:** one row per claim correction. Partial UNIQUE on `(evaluation_id, claim_type, COALESCE(claim_index,-1)) WHERE status IN ('approved','pending_review')`.
**Status enum:** `pending_review → approved | rejected | superseded | endorsed`.
**Embedding state:** `embedded | pending_backfill | failed`.
**`claim_type` enum:** 7 values incl. `coaching_nudge`, `dimension_score`, `rep_deferral`.
**`validity_type` enum (Phase 2):** `evergreen | always_inject | time_bounded | contextual`.
**Has pgvector embedding column** + HNSW index.
**Dashboard reads:** `src/app/api/admin/coaching-usage/route.ts` — `has_ai_feedback` EXISTS check.

#### `ai_usage_log` (Dashboard: bridge read only)
**Purpose:** Single denormalized log of every Anthropic `messages.create` call. Source of truth for the Cost Analysis tab.
**Grain:** one row per Anthropic API call. Retry attempts log separately.
**Lifecycle:** append-only.
**JSONB column:** `metadata` — see JSONB Shapes (two variants).
**Cost field:** `cost_micro_usd BIGINT` (µUSD — be careful with scale).
**Bridge access:** `salesCoachingClient.getCostAnalysis()` (admin/revops_admin only).

#### `job3_dormancy_alert_state` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Daily-dedup state for `phase_2_dormant_for_rubric_version_<N>_<scope>` Sentry alerts.
**Grain:** PK `(rubric_version, role_scope, alerted_on)` — natively daily-dedup.

#### `long_note_alert_state` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** SINGLETON row holding threshold-ladder state for long-note backlog alert.
**CHECK:** `(id = 1)` — exactly one row.

#### `objections` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** V1 capture of advisor objections + 2-4 sentence handling_assessment narrative.
**Grain:** one row per advisor-raised concern per call. UNIQUE `(evaluation_id, utterance_index, objection_type)`.
**Status:** IMMUTABLE post-write. Hallucinated `objection_type` values forced to `'other'`; raw label preserved in `objection_subtype` for RevOps gap discovery.

#### `onboarding_assignments` (Dashboard: NOT ACCESSED — upstream-only, dormant)
**Purpose:** OM (Onboarding Manager) coaches reps via **explicit assigned-rep list, NOT via `reps.manager_id`**. Authority is additive — ramping rep keeps regular manager in parallel.
**Grain:** one active assignment per `(om_rep_id, ramping_rep_id)`. Partial UNIQUE on `ended_at IS NULL`.
**Status:** 0 rows currently; not yet consumed by `canApprove`.

#### `rep_deferrals` (Dashboard: direct-pg read only)
**Purpose:** Materialized one-row-per-deferral mirror of `evaluations.rep_deferrals` JSONB. Powers SQL aggregation (per-rep deferral frequency by topic; KB-content-backlog).
**Grain:** one row per non-empty entry in the JSONB. UNIQUE `(evaluation_id, COALESCE(utterance_index,-1), topic)`.
**Lifecycle:** append-only via ON CONFLICT DO NOTHING. Populated by post-eval sweep (RAG cosine threshold; no Anthropic call). JSONB source is immutable post-eval.
**`kb_coverage` CHECK:** `covered | partial | missing`.
**Dashboard reads:** `src/lib/queries/call-intelligence/knowledge-gap-clusters.ts` — `deferral_hits` CTE.

#### `reps` (Dashboard: direct-pg read + bridge write)
**Purpose:** Every authenticated user (SGA, SGM, manager, admin, csa, system). **Single source of truth for role-based access — read `role` + `is_active` LIVE on every request, never trust JWT role claims.**
**Grain:** one row per human user + System Admin placeholder (`is_system=true`).
**Lifecycle:** mutable via `scripts/manage-rep.ts` (canonical CLI in sales-coaching) or admin endpoints. Soft-delete via `is_active=false` (idx allows rehire).
**Encrypted columns:** `granola_api_key_encrypted` BYTEA AES-256-GCM. `granola_key_version` OCC.
**Self-FK:** `manager_id` (rep is managed by another rep).
**Bridge mutations:** `createUser()`, `updateUser()`, `deactivateUser()`, `updateRevealPolicy()`.
**Direct-pg reads:** every visibility / identity query.

#### `rollout_windows` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Phase 2.3 staged-rollout window discriminator for correction-injection A/B. Each row = one `(injection_percent, period)` tuple.
**Grain:** Partial UNIQUE `(injection_percent) WHERE ended_at IS NULL` — at most one active per percent.
**Lifecycle:** advanced via `POST /api/admin/rollout-window-advance` (operator pre-deploy ritual). No auto-rollback on RED gate verdict — kill-switch env exists for emergency.
**Status:** 0 rows currently.

#### `rubrics` (Dashboard: direct-pg read + bridge write)
**Purpose:** Versioned scoring rubrics per role (SGA/SGM). Active rubric loaded **deterministically** by role/version — NEVER via RAG.
**Grain:** one row per `(role, version)`. UNIQUE.
**Status enum:** `draft → active → archived`. Active+archived immutable (only drafts editable). `idx_rubrics_active_role` enforces at most one active per role.
**OCC:** `edit_version`. **Lineage:** `version` is immutable.
**JSONB column:** `dimensions` — array of `{ name, order, levels: {"1","2","3","4"} }`. See JSONB Shapes.
**Bridge mutations:** `createRubric()`, `updateDraftRubric()`, `activateRubric()`, `deleteRubric()`.
**Direct-pg reads:** `src/lib/queries/call-intelligence-rubrics.ts`.

#### `sync_state` (Dashboard: NOT ACCESSED — upstream-only)
**Purpose:** Generic cron watermarks. Drive-sync uses this; Granola uses `reps.granola_last_polled_at` instead.
**Lease convention:** `metadata` JSONB with `lease_holder` + `lease_expires_at` (15 min). Atomic UPDATE `WHERE (no holder) OR (lease expired)`. rowCount=1 = "you hold the lease".

---

### Neon Auth (managed surface — do NOT modify)

`neon_auth.user`, `session`, `account`, `member`, `organization`, `invitation`, `jwks`, `verification`, `project_config`. These are managed by Neon Auth for the sales-coaching app's session/identity layer. **Dashboard does not access these.** Dashboard uses its own NextAuth flow against `savvy-dashboard-db.User`.

---

## JSONB Shapes

Sampled 2026-05-12. Re-sample on schema change.

```ts
// ===== Shared types — reused across 7+ columns =====

interface Citation {
  utterance_index: number; // 0-based index into call_transcripts.transcript[]
}

interface CitedItem {
  text: string;          // LLM prose. PII risk — may contain advisor/prospect names.
  citations: Citation[]; // Always present; may be [].
}

// ===== evaluations.* (10 JSONB columns) =====

// evaluations.narrative — 431/431 populated; shape 100% consistent.
interface EvaluationNarrative {
  text: string;          // Full LLM prose narrative. PII risk.
  citations: Citation[]; // Length 1-5+ observed.
}

// evaluations.dimension_scores — 431/431 populated.
// KEY SET VARIES BY RUBRIC VERSION — always check rubric_version before accessing a key.
// v1 (83 rows, 15 dims): next_steps_control, factual_accuracy, compliance_adherence,
//   aum_qualification_rigor, soft_close_quality, pers_handling, handoff_completeness,
//   objection_response_quality, client_origin_diligence, defer_discipline, timeline_pacing,
//   pitch_to_pain_match, mindset_assessment, call_setup_quality, firm_type_recognition
// v2 (347 rows, 7 dims): partner_team_handling, offer_tied_to_expectations,
//   kicker_introduction_timing, intro_call_framing, negotiation_within_authority,
//   live_calculator_use, meeting_sequencing
interface DimensionEntry {
  score: number;         // Integer 1-4. 1=Did not demonstrate, 4=Exemplary. NO 5 EXISTS.
  body?: string;         // LLM prose rationale. ~98% populated post-schema-v6.
  citations: Citation[]; // Always present; may be [].
  // confidence: NEVER present despite older docs implying it.
}
interface DimensionScores {
  [dimensionKey: string]: DimensionEntry;
}

// evaluations.ai_original — FROZEN snapshot of LLM original output. Trigger-immutable.
interface AiOriginal {
  overallScore: number;                  // Decimal 1.0-3.0 (NOT integer). avg ~1.48.
  dimensionScores?: DimensionScores;     // Same shape as live.
  complianceFlags?: CitedItem[];
  narrative?: EvaluationNarrative;
  knowledgeGaps?: KnowledgeGap[];
  weaknesses?: CitedItem[];
  strengths?: CitedItem[];
  coachingNudge?: null;                  // Key present in ~98.6% but value is JSON null.
  additionalObservations?: CitedItem[];
  repDeferrals?: RepDeferral[];          // Present only when deferrals detected.
}

// evaluations.additional_observations — array, length 0-4.
type AdditionalObservations = CitedItem[];

// evaluations.compliance_flags — array, length 0-4. Empty = no issues.
type ComplianceFlags = CitedItem[];

// evaluations.knowledge_gaps — array, length 0-5.
interface KnowledgeGap {
  text: string;
  citations: Citation[];
  expected_source?: string; // KB/playbook slug, e.g. "playbook/sga-discovery/set-the-stage-for-sgm-call"
}

// evaluations.rep_deferrals — array, length 0-7. Materialized into rep_deferrals table by sweep.
interface RepDeferral {
  topic: string;          // Short label. Observed: "book-wide tax loss harvesting capability", etc.
  deferral_text: string;  // Near-verbatim advisor quote. PII risk.
  citations: Citation[];
}

// evaluations.strengths / .weaknesses — CitedItem arrays.
type Strengths = CitedItem[];
type Weaknesses = CitedItem[];

// evaluations.eval_input_receipt — reproducibility audit.
interface EvalInputReceipt {
  transcript_token_count: number;
  rubric_version: string;     // e.g. "1"
  rubric_id: string;          // UUID
  model: string;              // e.g. "claude-sonnet-4-6" (most), "claude-sonnet-4-20250514" (2 rows)
  kb_version_hash: string;
  evaluated_at: string;       // ISO 8601
  granola_note_id: string;    // PII-adjacent
  // Extended (132/428 rows, when corrections RAG active):
  prompt_tokens?: number;
  corrections_retrieved?: number;
  output_tokens?: number;
  corrections_injected?: boolean;
  // Test-only:
  smoke_test?: boolean;
  smoke_test_longnote?: boolean;
}

// evaluations.ai_baseline_shadow — 0 rows. Reserved for A/B shadow capture.
// evaluations.coaching_nudge — 0 rows. Reserved.

// ===== notification_outbox.payload — polymorphic by notification_kind =====

// rep_review_dm (424 rows) — advisor review Slack DM
interface RepReviewDmPayload {
  call_note_id: string;
  rep_id: string;          // PII: advisor identifier
  evaluation_id?: string;
}

// granola_manager_monitor (109) / kixie_manager_monitor (72)
interface ManagerMonitorPayload {
  call_note_id: string;
  rep_id?: string;
}

// kixie_low_confidence_review (7)
interface KixieLowConfidencePayload {
  call_note_id: string;
  flag_reason: "speaker_mapping" | "numeric_verifier";
}

// rep_sfdc_write_failed (2)
interface SfdcWriteFailedPayload {
  call_note_id?: string;
  error_code: string;
  rep_facing_message: string; // PII risk — text shown to advisor
}

// resume_waterfall (5) — partial sample
interface ResumeWaterfallPayload {
  enrichment_request_id: string;
}

// ===== kb_corrections_log.change_payload — only drive_doc_edit shape observed =====
interface KbChangePayload {
  old_text: string;
  new_text: string;
  revision_before: string;
  revision_after: string;
  drive_file_id: string;
  occurrences_count: number;
  post_edit_resync: {
    ok: string;              // BOOLEAN-AS-STRING: "true" | "false"
    kind: string;            // e.g. "ingested"
  };
}

// ===== ai_usage_log.metadata — orthogonal variants =====

// Variant A — provenance/backfill rows (~95% of non-null)
interface AiUsageMetadataProvenance {
  source: string;   // format: "table.column", e.g. "call_notes.competitor_extraction_cost_micro_usd"
  backfill: boolean;
  note?: string;
  unit?: string;    // "cents_legacy" = pre-micro-USD scale (78 rows)
}

// Variant B — evaluator experiment rows (~5%)
interface AiUsageMetadataExperiment {
  attempt: number;
  corrections_injected: boolean;
  arm: string;      // observed: "treatment"
}

// ===== rubrics.dimensions — array of dim definitions =====
interface RubricDimension {
  name: string;     // display name e.g. "Intro Call Framing"
  order: number;
  levels: {         // 4-point behavioral anchor scale; keys are score integers as strings
    "1": string;    // "Did not demonstrate: ..."
    "2": string;
    "3": string;
    "4": string;
  };
}
type RubricsDimensions = RubricDimension[];

// ===== Tables with no JSONB columns (despite some having "object" feel) =====
// eval_correction_judgments, eval_correction_retrievals, eval_correction_diff_jobs,
// call_note_enrichments, email_enrichments — ALL SCALAR.
```

---

## Business Glossary

- **"evaluation"** — a Claude-graded rubric score for one `call_notes` row. Has 10 JSONB columns. Dimension keys vary by rubric version.
- **"rep"** — a `reps` row. Includes SGAs, SGMs, managers, admins, and one system placeholder. **Role IS DECIDED LIVE — never trust JWT claims.**
- **"manager"** — a `reps.role='manager'` row. Coaching authority over a rep through either `reps.manager_id` (direct report) OR `onboarding_assignments` (additive, parallel — currently 0 rows).
- **"SGM"** — Sales Growth Manager. NOT a manager of SGAs — it's a **qualification gate** (SQO approver). See [[feedback-sgm-role]].
- **"pod"** — informal name for a `coaching_teams` row with a `lead_rep_id`. Used in Insights team-axis queries.
- **"call note"** — a `call_notes` row. Two sources: Granola (rep-attended) and Kixie (>5min recorded). FK target is `call_notes.id`, NOT `granola_note_id` / `kixie_task_id`.
- **"reveal"** — making an evaluation visible to the rep (it's manager-only by default). Surfaced via `setRevealScheduling()` and `manualReveal()` bridge methods on `evaluations`.
- **"correction"** — manager-submitted disagreement with an AI claim, written to `ai_feedback`. Embedded with pgvector; RAG-retrieved at next eval as "Job-3 injection" when applicable.
- **"won deal"** — NOT a concept in this DB. Defined in BigQuery. See `.claude/bq-views.md`.

---

## Known Anti-Patterns & Traps

- **`knowledge_base_chunks` schema** — PK is `id` (uuid), body is `body_text`. NO `chunk_id`. `chunk_index` is the within-doc ordinal, not chunk identity. See [[feedback-coaching-db-schema-traps]].
- **`call_transcripts.transcript` shape** — array of `{ utterance_index, speaker_role, text, start_seconds, end_seconds }`. Uses speaker_role + seconds, NOT speaker name + absolute timestamps. See [[feedback-coaching-db-schema-traps]].
- **`evaluations.dimension_scores` and `narrative` are JSONB objects, not joinable.** Cast with `->` / `->>` first; never JOIN on dimension keys.
- **Dimension keys vary by rubric version.** v1 has 15 dims; v2 has 7. Always read `eval_input_receipt.rubric_version` (or `rubrics.version` via `rubric_id` FK) before accessing a key. Cross-version aggregation requires explicit mapping.
- **`evaluations.ai_original` is trigger-immutable.** Any UPDATE attempt is blocked by `trg_prevent_ai_original_update`. Manager edits land in sibling columns (`dimension_scores`, `narrative`, etc.) and an `edit_version` OCC counter.
- **`evaluations.rep_deferrals` JSONB is also immutable post-eval.** Corrections flow through `ai_feedback.claim_type='rep_deferral'`, not direct edits.
- **`call_notes.id` is the canonical FK target.** `granola_note_id` and `kixie_task_id` are ingest-idempotency only — never use them as join keys.
- **`call_notes` has 90 columns and 7 parallel state machines.** Don't try to grok it all at once — work from the column you need.
- **`call_notes` soft-delete via `source_deleted_at`** is the ONLY soft-delete mechanism. Cascades from `call_notes` are heavy.
- **Dashboard has direct `pg` access** at `src/lib/coachingDb.ts`. Schema changes upstream break Dashboard at runtime, not just at the bridge boundary. When tables in the "direct-pg read" list above change shape, Dashboard must update.
- **`reps.role` is read LIVE on every request — never cache.** JWT may say `manager`; live row may say `admin`. Authority decided by live `role` + `is_active`.
- **`ai_feedback` is manager-only, never rep-visible.** Locked via `COMMENT ON TABLE`. If you're displaying eval claims to a rep, do NOT join to ai_feedback rows.
- **`sfdc_write_log.request_body.kind` is a JSONB discriminator, NOT a column.** Use `request_body->>'kind'` for filtering.
- **`overallScore` in `ai_original` is decimal, not integer.** Range 1.0-3.0. Don't `::int` it for display — preserve precision or round explicitly.
- **`notification_outbox.payload` shape is determined by `notification_kind`.** Always query both columns together; do not assume the same shape across kinds.
- **`kb_corrections_log.change_payload.post_edit_resync.ok` is `"true"` or `"false"` (string).** Not a boolean. Bug-prone — comparing `=== true` will always fail.
- **`ai_usage_log.cost_micro_usd` is micro-USD (BIGINT).** Divide by 1_000_000 to get dollars. Don't store µUSD as `numeric` or you'll get scale drift.
- **`ai_usage_log.metadata.unit='cents_legacy'`** rows are pre-µUSD. They need scale conversion before mixing in aggregates.
- **`evaluations.dimension_scores.<key>.confidence` does NOT exist** despite some older sales-coaching docs implying it might. Don't try to read it.
- **`salesforce_credentials` is a SINGLETON.** Don't `INSERT` without `ON CONFLICT` — `idx_salesforce_credentials_singleton UNIQUE ON ((true))` will reject.

---

## Migration & Schema Authority

**Schema authority:** the **sales-coaching repo** at `C:\Users\russe\Documents\sales-coaching`. Raw SQL migrations at `src/lib/db/migrations/0NN_*.sql` (currently 001-043). No ORM schema file. Each `src/lib/db/<table>.ts` is a typed repo.
**Migration tool:** bespoke `scripts/apply-migrations.mjs` — reads `*.sql` lex-sorted, executes each against `DATABASE_URL_UNPOOLED`. Manual / human-run, NOT CI.
**Doc gen:** `npm run gen:db-schema` regenerates `docs/_generated/db-schema.md` from a live connection. Hand-curated semantic layer at `docs/db-schema-context.yaml` (1,819 lines). Pre-commit hook flags doc staleness.
**Drift detection:** structurally prevented by the pre-commit hook + the `gen:db-schema` regeneration. The two docs match what migrations declare.
**Idempotency convention:** `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS; ADD CONSTRAINT`. Migration 026 is the one non-idempotent outlier (called out in upstream CLAUDE.md).
**Dashboard side — bridge schema mirror:** `src/lib/sales-coaching-client/schemas.ts` is a byte-for-byte mirror of `sales-coaching@main:src/lib/dashboard-api/schemas.ts`. CI runs `npm run check:schema-mirror` to detect drift. Run `/sync-bridge-schema` to repair. See [[feedback-coaching-db-schema-traps]] for related schema gotchas.

---

## Cross-References

- **Live introspection:** `mcp__Neon__describe_table_schema`, `mcp__Neon__get_database_tables`, `mcp__Neon__describe_project`
- **Schema diff between branches:** `mcp__Neon__compare_database_schema`
- **Slow queries:** `mcp__Neon__list_slow_queries`
- **Refresh this doc:** `/document-neon-schema sales-coaching`
- **Authoritative upstream context:** `sales-coaching/docs/db-schema-context.yaml`, `sales-coaching/docs/_generated/db-schema.md`
- **Bridge schema mirror:** `src/lib/sales-coaching-client/schemas.ts` (Zod). Repair with `/sync-bridge-schema`.
- **Direct-pg client:** `src/lib/coachingDb.ts` — `getCoachingPool()` factory
- **Related memory:** [[reference-neon-projects]], [[feedback-coaching-db-schema-traps]], [[feedback-sgm-role]]
- **Related docs:** `prisma/schema.prisma` (other Neon DB), `docs/ARCHITECTURE.md`, sister doc `.claude/neon-savvy-dashboard.md`, BigQuery context at `.claude/bq-*.md`
