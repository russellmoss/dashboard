---
title: Kixie Call Transcription + AI Notes Pipeline
type: feat
status: refined-post-council
date: 2026-04-27
branch: feat/kixie-call-transcription
depth: deep
units: 17
---

> **POST-COUNCIL REFINEMENT (2026-04-27):** This plan was reviewed adversarially by Codex (gpt-5.4) and Gemini (gemini-3.1-pro-preview) via /auto-feature. Both flagged convergent issues: broken idempotency, hallucination risk, dead-UI rollout, missing HITL, compliance gaps, freeform `errorState`. Bucket 1 fixes have been applied below (in-place edits to Key Decisions, Requirements, Unit 1.1 schema, Unit 2.5 Claude design, Unit 2.7 orchestration, Unit 3.3 writeback gate, plus a NEW Phase 0 compliance gate and unit renumbering). The authoritative refinement spec — Bucket 1 changes plus Bucket 2 user decisions — is in **`## Refinement Log (Council Triage Output)`** at the bottom of this file. **Read the Refinement Log before executing — it overrides any conflicting language in the original units above.** Council artifacts: `docs/council-reviews/2026-04-27-{codex,gemini}-kixie-transcription.md`. Triage details: `triage-results.md`. Merged feedback: `council-feedback.md`.
>
> **POST-USER-DECISION REVISION (2026-04-27, after smoke test):** The data-storage strategy moved from a new `CallTranscript` Prisma model in the dashboard's own Neon DB to **extending the sales-coaching project's existing `call_notes` table** (with `source='kixie'`). Rationale: the sales-coaching app already has the UI, evaluations, manager review, sfdc_write_log retry/audit, and notification_outbox infrastructure — Kixie data lives where the rep sees it. See `## Refinement Log section G — Sales-Coaching DB Integration` at the bottom for the full design. Migration: `C:/Users/russe/Documents/sales-coaching/src/lib/db/migrations/009_extend_call_notes_for_kixie.sql`. Connection vars: `SALES_COACHING_*` in dashboard `.env`. **Section G overrides Unit 1.1's Prisma schema definition.**

## Overview

Every answered outbound sales call from Kixie carries a public mp3 URL in `Task.Description`. We pull the recording, transcribe with speaker diarization (AssemblyAI), classify the call type, and generate a structured 9-section "Advisor Note Doc" (≤2200 chars) via Claude Sonnet 4.6. Notes show up as a collapsible section per call in the dashboard activity tab. Eventually the same notes get written back to a custom Salesforce field on the Task. The user is the SGA running discovery calls and the SGM receiving the handoff. Job: kill the 15–30 min/call manual note-taking burden and standardize the handoff doc.

## Problem Frame

SGAs spend significant time after each call writing handoff notes for the SGM. Quality varies. The 9-section note schema (ICP metrics, transferable AUM dig-ins, client origin, move mindset, catalyst & pain, what-to-sell, where-to-dig, disclosure check, unprompted questions) is a documented playbook output but compliance is uneven. AI-generated notes from the recording capture verbatim numbers (which the playbook explicitly requires) and surface unprompted advisor questions (purer signal than solicited motivators).

**Doing nothing:** SGAs keep writing notes manually with variable quality. SGMs catch fewer discrepancies. The 18-month Kixie archive cutoff means historical recordings are silently rolling out of reach — every month of delay loses ~900–1,300 calls of recoverable training data.

**Pressure-test:** Could we ship a transcript-only view (no AI notes) for 80% of the value? Possibly, but the user's specific ask is the structured note doc that feeds the SGM handoff. Raw transcripts are 5,000+ words per 25-min call — unreadable on a modal. The structuring step is load-bearing.

## Requirements

- **MUST**: Surface generated notes in the dashboard `ActivityTimeline` modal as a collapsible section, reusing the existing ChevronDown/ChevronUp expand pattern.
- **MUST**: Process every answered outbound call where `Subject = 'answered: Outbound call.'` and Description contains a `calls.kixie.com/<uuid>.mp3` URL.
- **MUST**: Use Claude Sonnet 4.6 with prompt caching for note generation (system prompt > 2048 tokens to qualify).
- **MUST**: Speaker diarization in transcription (capturing what the advisor said unprompted requires speaker labels).
- **MUST**: Idempotent processing via explicit state machine (`status` enum + `retryCount` + `nextRetryAt`); retryable failures must be re-attempted, not skipped because a partial row exists. **[Refined 2026-04-27 per council convergence #1]**
- **MUST**: Per-call cost cap and a daily spend ceiling using a transactional reservation model (reserve estimated cents → spend → reconcile actual → release unused). NOT a simple read-decide-spend pre-check (which is not concurrency-safe). **[Refined 2026-04-27 per Codex C2]**
- **MUST**: Skip calls under 60 seconds (53% of population, mostly voicemails — verified).
- **MUST**: Backfill mode that processes oldest-first (race against the unverified Kixie archive cutoff).
- **MUST**: Pre-backfill spot-check: HEAD-request 3 recordings of varying ages to verify the archive cutoff before committing to backfill scope.
- **MUST**: Single Claude call (NOT two-step). Output structure: `<quotes>` XML block (verbatim sentences containing numbers), then JSON-structured fields per the call-type schema. Markdown rendered server-side from JSON. **[Refined 2026-04-27 per Codex C8 + convergence #2]**
- **MUST**: Speaker-identification step in prompt — explicitly map AssemblyAI Speaker A/B to SGA-vs-Advisor before generating notes. **[Added 2026-04-27 per Gemini G3]**
- **MUST**: Numeric-verification post-processor — extract numbers from transcript and notes via regex; flag any number in notes absent from transcript with `status = LOW_CONFIDENCE_REVIEW_REQUIRED`. **[Added 2026-04-27 per convergence #2]**
- **MUST**: Human-in-the-loop edit/approval before SFDC writeback. SGA must explicitly approve (and optionally edit) generated notes via the dashboard. Auto-push to production CRM is forbidden in v1. **[Added 2026-04-27 per convergence #4]**
- **MUST**: Phase 0 compliance gate — verified Anthropic Enterprise/ZDR agreement, AssemblyAI DPA, Kixie two-party consent posture, GCS bucket security baseline — BEFORE any pipeline code lands. **[Added 2026-04-27 per convergence #5]**
- **MUST**: Phase 1 + Phase 2 ship together behind feature flag `FEATURE_AI_CALL_NOTES`. The Notes UI does not render to users until the pipeline has produced its first transcript. **[Refined 2026-04-27 per convergence #3]**
- **SHOULD**: Daily Cloud Scheduler trigger so new calls are processed within 24 hours of being logged.
- **SHOULD**: Phase 1 ships UI even when no transcripts exist (graceful "Notes not yet generated" empty state).
- **NICE**: Admin-only "Regenerate Notes" button when prompts are improved.
- **NICE**: Phase 3 dashboard "Push to SFDC" button (admin-gated).

## Scope Boundaries

**In scope:**
- Phase 1: Postgres `CallTranscript` model, BigQuery query update to extract Description + parse mp3 URL, activity API merge, dashboard UI.
- Phase 2: Cloud Run Job in `packages/call-transcriber/`, AssemblyAI + Claude integration, GCS bucket for recording retention, prompt template versioning, cost guards, observability.
- Phase 3: Salesforce `Task.AI_Call_Notes__c` custom field, REST PATCH writeback worker, idempotency tracking, optional dashboard "Push to SFDC" admin button.

**Out of scope:**
- Inbound call transcription (different volume profile, different note schema needed).
- SMS / email AI summarization (separate feature; this is calls-only).
- Real-time / live-call transcription. Strictly post-call batch.
- Replacing the existing `vw_sga_activity_performance` view. We add a companion table; the view is unchanged.
- Webhook-based AssemblyAI completion notifications. Polling is correct for batch jobs (no inbound HTTP listener on Cloud Run Jobs).
- Encryption-at-rest beyond GCS/Postgres defaults (financial PII discussion, not data-loss-prevention).
- Multi-language transcription. English-only assumption (US sales calls).

## Research Summary

### Codebase Patterns (with file:line citations)

- **Service-package shape**: `packages/analyst-bot/` is the reference. Self-contained `package.json` (`packages/analyst-bot/package.json`), single-stage `node:20-slim` Dockerfile with manual `source-bust-YYYYMMDD-*` cache-bust line (`packages/analyst-bot/Dockerfile:21`), two-step `cloudbuild.yaml` (`docker build --no-cache` → `docker push`), `deploy.sh` does `gcloud builds submit` then `gcloud run deploy --image=...` to preserve secrets. Root `package.json` has no workspaces — `packages/*` are independent.
- **Activity surface**: API at `src/app/api/dashboard/record-detail/[id]/activity/route.ts`, query at `src/lib/queries/record-activity.ts:156-263` (BigQuery SQL block), type at `src/types/record-activity.ts`, UI at `src/components/dashboard/ActivityTimeline.tsx:180-261` (the existing ChevronDown/ChevronUp expand pattern at lines 242-255 is the exact pattern to extend).
- **Anthropic SDK pattern**: Lazy singleton in `packages/analyst-bot/src/claude.ts:19-32`, retry loop with exponential backoff at `:71-113`. No prompt caching anywhere in repo today — we add it.
- **Retry helper**: `src/lib/wrike-client.ts:98-130` has the cleanest `withRetry<T>(fn, maxRetries=3)` generic. Copy it.
- **Polling pattern**: `src/app/dashboard/reports/components/ReportProgress.tsx:27-40` shows the dual-guard `resolvedRef` + `setInterval(3000)` polling style. Useful reference for `waitUntilReady` style polling, though the Cloud Run Job uses the AssemblyAI SDK's own polling.
- **Prisma JSON columns**: Read with `as unknown as ConcreteType` cast (e.g., `src/app/dashboard/reports/[id]/page.tsx:60`). Optional Zod parse at write time (`src/lib/reporting/schema.ts`).
- **Manual migrations**: `prisma/migrations/manual_<description>.sql` convention (no auto-generated timestamp folders). Run manually against Neon.
- **Idempotency**: Prisma `upsert` on composite `@@unique` keys, e.g., `src/lib/queries/weekly-goals.ts:75-80` and the `@@unique([userEmail, weekStartDate])` on `WeeklyGoal`.
- **Cost guard precedent**: Only existing pattern is `maximumBytesBilled: 1_073_741_824` on BigQuery jobs in `packages/analyst-bot/src/bq-query.ts`. No external-API spend cap pattern exists — we build one.
- **Prompt template files**: `src/lib/reporting/prompts/*.ts` exports named `const PROMPT_NAME = \`...\`` template literals (e.g., `analyze-wins.ts`). Same pattern for the new transcriber.
- **Empty-state UI**: `src/components/dashboard/ExploreResults.tsx:194-204` is the best icon-+-heading-+-body centered empty state. Match it.
- **Vercel cron route pattern**: `vercel.json:12-49` defines existing `/api/cron/*` schedules — useful structural reference, but the new transcriber is **not** Vercel cron (Vercel timeout is too short).

### Prior Learnings

- **Schema-context first**: Hard gate in CLAUDE.md. Confirmed during research; CallDisposition was assumed wrong because nobody checked schema-context first. The plan's Phase 2 BigQuery query goes through schema-context.
- **Won deal = Joined**: Not directly relevant here — but if the SGM-handoff notes ever get tied to win analysis, we use the right outcome field.
- **TOF_Stage ≠ current state**: The activity feed already correctly uses `lead_closed_date IS NULL` etc. Notes feature does not interact with stage logic.

### External Research

- **AssemblyAI**: package `assemblyai@4.32.1`. `client.transcripts.transcribe({ audio: <url>, speaker_labels: true })` is the canonical call. Universal-2 model: $0.15/hr base + $0.02/hr diarization = **$0.17/hr** = ~$0.07 per 25-min call. Submit-by-URL works directly against the public Kixie URL — AssemblyAI fetches the audio. SDK README warns against production scale; for >500 calls/run we may want direct REST. Not a Phase 2 v1 concern.
- **AssemblyAI LeMUR**: deprecated, shutdown March 31, 2026. Do not use. Use Claude API for note generation.
- **Cloud Run Jobs**: 7-day max task timeout (not 24h). Free tier (240K vCPU-sec/mo) easily covers projected volume of ~1,300 calls/mo at ~10 min wall time each. Cloud Scheduler triggers via cron syntax; same pattern as existing GCP services.
- **Polling vs webhook**: Polling is correct for Cloud Run Jobs (no inbound HTTP listener). SDK `waitUntilReady(id, { pollingInterval: 5000 })` is the call.
- **Claude prompt caching**: Sonnet 4.6 has a **2048-token minimum** — caches silently no-op below this. The 9-section schema prompt should easily exceed this. Use `cache_control: { type: "ephemeral" }` on the system block. 5-min TTL covers a single batch run; 1-hour TTL costs 2x write but matches longer batch durations. Cache reads are 0.1x base — ~90% reduction over uncached for repeated system prompts.
- **GCS streaming**: `@google-cloud/storage@7.19.0`, `pipeline(response.body, file.createWriteStream({ contentType: "audio/mpeg" }))` from `stream/promises`. ADC auth on Cloud Run, no key file.
- **Salesforce REST PATCH**: `PATCH /services/data/v66.0/sobjects/Task/<id>` with `{"AI_Call_Notes__c": "..."}` body. Returns 204. Token from `sf org display --target-org savvy --json` (the `sf data query` CLI bug doesn't affect this path).
- **Kixie 18-month archive**: **UNVERIFIED.** Research could not load Kixie's help center pages. Phase 2 includes a pre-backfill HEAD-request spot-check (Unit 2.10).

## Key Decisions

| Decision | Choice | Alternatives | Rationale |
|---|---|---|---|
| "Answered outbound call" filter | `LOWER(Subject) LIKE 'answered:%'` AND `Type='Call' OR TaskSubtype='Call'` | `CallDisposition IN (...)` | Verified: `CallDisposition` is NULL on all rows; Kixie does not write it. `Subject` filter has 100% kixie-URL coverage in last 30 days. |
| Worker host | Cloud Run Job + Cloud Scheduler | Cloud Run Service / Vercel Cron | 7-day timeout, free tier covers volume, batch fits the workload, mirrors existing `analyst-bot` deploy pattern. Vercel Cron Pro caps at 800s — too short. |
| Transcription provider | AssemblyAI Universal-2 + diarization | OpenAI Whisper / Deepgram | Cheapest with diarization at $0.17/hr; best diarization for 2-party calls per published benchmarks. |
| Notes generator | Claude Sonnet 4.6 (separate from transcription) | AssemblyAI LeMUR (deprecated) / single combined call | LeMUR is being shut down; reusing `ANTHROPIC_API_KEY` keeps integration in the existing Anthropic surface; tighter prompt control + prompt caching savings. |
| Classification + notes | **Single combined Claude call** with conditional schema selection inline. Output: `<quotes>` XML + JSON-structured fields. **[REVISED 2026-04-27]** | Two-step (classifier → notes) | Council Codex C8: at $0.005 + $0.02/call and ~30% non-discovery skip, savings are ~$7.80/mo at projected 1,300 calls/mo. Engineering cost (extra retries, latency, error surface) dwarfs that. Single call also enables `<quotes>` extraction in the same context. |
| AssemblyAI flow | Polling via SDK `waitUntilReady` | Webhooks | Cloud Run Job has no inbound HTTP listener; webhooks would force a separate Service. Polling is documented batch pattern. |
| Audio submission | Submit-by-URL (Kixie public) + parallel GCS retention copy | Stream-and-upload to GCS first, then submit GCS URL | Submit-by-URL is faster (skip middleman). GCS copy is for retention/audit, not for AssemblyAI. Run them in parallel. |
| Min duration filter | Skip calls < 60s | Process all | 53.4% of calls are <60s; mostly voicemails or hang-ups. Saves ~$330 backfill. Configurable via env var. |
| Backfill order | Oldest first (CreatedDate ASC) | Newest first | Race against the (unverified) Kixie 18-month archive cutoff. Older recordings are at risk. |
| Pre-backfill spot-check | HEAD 3 URLs of varying ages | Trust the 18-month claim | Research could not verify Kixie's policy. Cheap to validate empirically. |
| SFDC writeback target | New custom field `Task.AI_Call_Notes__c` (Long Text Area, 32KB) | Append to `Description` | `Description` already has the Kixie URL + call metadata; isolation is cleaner for compliance, FLS gating, and future toggling. |
| Markdown renderer | `react-markdown` + `remark-gfm` + Tailwind `prose prose-sm` | `whitespace-pre-line` | Headings + bullets need real parsing. `prose` gives consistent styling. |
| Migration style | `prisma/migrations/manual_add_call_transcripts.sql` + `prisma db push` | Auto-generate via `prisma migrate dev` | Repo convention; Neon connection deliberately avoids migrate's shadow DB. |
| Idempotency | **Explicit state machine** on `CallTranscript` row: `status` enum + `retryCount` + `nextRetryAt` + `lastSuccessfulStage`. Eligibility logic: process rows where `status IN ('PENDING', 'FAILED_RETRYABLE') AND nextRetryAt <= NOW() AND retryCount < @maxRetries`. **[REVISED 2026-04-27]** | "Row exists in `call_transcripts`" as dedup key | Council convergence #1: the original "row exists = skip" model permanently strands partial rows (transcript yes, notes no after Claude 5xx). State machine is the only correct primitive for resumable async work. |
| Cost cap | **Transactional reservation model**: SELECT FOR UPDATE on aggregate row → reserve estimated cents → spend → reconcile actual → release unused. Aggregated via SUM query on `CallTranscript.costCents` (no separate `TranscriptionCostDaily` table). **[REVISED 2026-04-27]** | Pre-check-then-spend on a separate aggregate table | Council Codex C2: read-decide-spend isn't atomic; concurrent runs can both pass the check and overspend. Reservation model + SUM aggregate is concurrency-safe and drops a table. |
| GCS bucket | `gs://savvy-call-recordings` (new), region `us-east1` | Reuse existing bucket | None of the existing buckets fit; clean isolation per service is the GCP norm in this project. |
| Prompt versioning | Template literals in `packages/call-transcriber/src/prompts/*.ts` exporting named consts; bump `PROMPT_VERSION` constant | Markdown files / DB-stored prompts | Mirrors `src/lib/reporting/prompts/` exactly. Prompt version stored on `CallTranscript` row enables backfill regeneration when prompt changes. |
| Phase 1 stub data | **Phase 1 + Phase 2 ship together behind `FEATURE_AI_CALL_NOTES` flag.** Notes UI does not render to users until pipeline has produced its first transcript. **[REVISED 2026-04-27]** | Standalone Phase 1 with empty UI / Mock data | Council convergence #3: empty UI for weeks creates trust debt; users assume the feature is broken. Feature-flagged dual-phase ship eliminates dead chrome. |
| HITL editing & approval | SGAs view AI-generated notes in dashboard, can edit (`notesMarkdownEdited` column), and must explicitly approve (`humanApprovedAt`) before any SFDC writeback. **[ADDED 2026-04-27]** | Auto-push to SFDC on generation | Council convergence #4: SGAs reject AI tools that publish errors to production CRM with no human gate. Edit + approve is the trust-building MVP. |
| Speaker mapping | Claude prompt explicitly identifies SGA vs Advisor from transcript context BEFORE generating notes. Speaker A/B from AssemblyAI never appears verbatim in notes. **[ADDED 2026-04-27]** | Trust AssemblyAI Speaker A/B labels | Council Gemini G3: AssemblyAI doesn't know which side is the SGA. Without explicit identification, an SGA can be credited with $25M AUM. |
| Verbatim number enforcement | Claude outputs `<quotes>` XML block (verbatim sentences containing numbers) BEFORE structured note. Numeric-verification post-processor extracts numbers from transcript + notes; mismatches → `status=LOW_CONFIDENCE_REVIEW_REQUIRED`. **[ADDED 2026-04-27]** | Prompt instruction "verbatim only" alone | Council convergence #2: prompts are not enforcement mechanisms for financial data. Two-stage output + regex check is the cheapest reliable guard. |
| Compliance pre-flight | New **Phase 0** with formal STOP-AND-CONFIRM gate: Anthropic Enterprise/ZDR, AssemblyAI DPA, Kixie consent, GCS bucket security policy. **[ADDED 2026-04-27]** | Trust default vendor terms | Council convergence #5: shipping prospect financial PII to AI vendors without verified zero-retention agreements is FINRA/SEC risk. |
| GCS bucket security | Dedicated service account + UBLA enforced + public-access prevention + CMEK with KMS + lifecycle rule (default 1 year, configurable per Bucket 2 Q2) + Cloud Audit Logs. **[ADDED 2026-04-27]** | "GCS defaults" | Council Codex C6: duplicating call recordings into a second PII store with no security spec is operational debt. |
| MP3 backfill timing | **Decoupled mp3-only download script runs IMMEDIATELY** (independent of pipeline build). Downloads all 2,902 backfill mp3s into GCS before transcription pipeline is built. **[ADDED 2026-04-27]** | Backfill happens after Phase 2 deploy | Council Gemini G4: 18-month archive cliff means delay = data loss. Decoupling preserves recordings while pipeline is being built. |
| Output format | JSON-structured (`notesJson`) is canonical; markdown (`notesMarkdown`) rendered from JSON for display + SFDC. **[REVISED 2026-04-27]** | Markdown is canonical, JSON optional | Council Codex Q8: SFDC is the system of record; structured JSON is safer for validation and analytics; markdown is presentation. |

## Implementation Units

### Phase 1 — Dashboard Surface (UI-First Stub)

#### Unit 1.1: Prisma `CallTranscript` model + manual migration

**Goal:** Add the Postgres table that holds transcripts and notes, keyed on Salesforce `Task.Id`.

**Files:**
- `prisma/schema.prisma` (modify)
- `prisma/migrations/manual_add_call_transcripts.sql` (create)
- `prisma/migrations/manual_add_transcription_costs.sql` (create — daily spend aggregate, used in Phase 2 but defined now to avoid double-migration churn)

**Approach [REVISED 2026-04-27 post council]:** Add `model CallTranscript` with explicit state machine + quality + HITL fields:

```prisma
model CallTranscript {
  taskId                       String   @id
  fullProspectId               String?
  mp3Url                       String
  mp3DownloadedAt              DateTime?
  gcsPath                      String?
  gcsStatus                    String?  // 'PENDING' | 'COMPLETED' | 'FAILED'

  // Transcript
  transcriptText               String?  @db.Text
  transcriptDiarizedJson       Json?
  transcriptConfidence         Float?
  transcriptWordCount          Int?
  transcriptActualDurationSec  Int?

  // Notes (JSON canonical, markdown derived)
  notesJson                    Json?
  notesMarkdown                String?  @db.Text
  callTypeClassification       String?
  promptVersion                String?
  modelId                      String?  // e.g. "claude-sonnet-4-6"

  // Costs
  transcriptionService         String?  // e.g. "assemblyai-universal-2"
  transcriptionCostCents       Int?
  notesCostCents               Int?

  // State machine — replaces freeform errorState
  status                       String   @default("PENDING")
  // values: PENDING | DOWNLOADING | TRANSCRIBING | GENERATING_NOTES |
  //         COMPLETED | FAILED_RETRYABLE | FAILED_TERMINAL |
  //         KIXIE_ARCHIVED | LOW_DURATION_SKIPPED | COST_CAP_SKIPPED |
  //         LOW_CONFIDENCE_REVIEW_REQUIRED | HUMAN_APPROVED
  processingStartedAt          DateTime?
  lastAttemptAt                DateTime?
  lastSuccessfulStage          String?
  retryCount                   Int      @default(0)
  nextRetryAt                  DateTime?
  errorDetail                  String?  @db.Text  // free-text context for the current error

  // HITL (Human-in-the-loop)
  notesMarkdownEdited          String?  @db.Text  // SGA-edited override
  humanApprovedAt              DateTime?
  humanApprovedBy              String?

  // SFDC writeback
  pushedToSfdcAt               DateTime?
  pushedToSfdcVersion          String?  // hash of (notesMarkdownEdited ?? notesMarkdown) at push time

  // Lifecycle
  generatedAt                  DateTime?
  createdAt                    DateTime @default(now())
  updatedAt                    DateTime @updatedAt

  @@map("call_transcripts")
  @@index([fullProspectId])
  @@index([status, nextRetryAt])  // poller eligibility query
  @@index([createdAt])             // cost-cap SUM aggregate
}
```

**`TranscriptionCostDaily` table is REMOVED.** Replaced with SUM aggregate query on `CallTranscript`:
```sql
SELECT COALESCE(SUM(transcription_cost_cents + COALESCE(notes_cost_cents, 0)), 0)
FROM call_transcripts
WHERE created_at::date = CURRENT_DATE;
```
For the reservation model (B1.7), use Postgres advisory locks: `SELECT pg_advisory_xact_lock(hashtext('cost-cap-daily'))` before SUM-and-decide. Atomic across concurrent Cloud Run Job tasks.

Manual migration SQL mirrors the new model fields. **Verify** the existing `prisma/migrations/manual_*.sql` convention by reading one example before writing the migration.

**Tests:** Smoke test that `prisma generate` succeeds. No unit tests at the model layer — Prisma is the contract.

**Depends on:** none

**Patterns to follow:** `prisma/schema.prisma:65` (`McpApiKey` `@@map` style), `prisma/migrations/manual_*.sql` naming.

**Verification:** `npx prisma generate` exits 0; `psql $DATABASE_URL -f prisma/migrations/manual_add_call_transcripts.sql` runs cleanly against a dev DB; `\d call_transcripts` in psql shows the columns.

---

#### Unit 1.2: BigQuery query — extract `Description` + parse mp3 URL

**Goal:** Update the activity query to return a `mp3RecordingUrl` field for outbound call rows.

**Files:**
- `src/lib/queries/record-activity.ts` (modify the SELECT block at lines 156-263)
- `src/types/record-activity.ts` (extend `ActivityRecord` and `ActivityRecordRaw`)

**Approach:** Add `Description` to the SELECT. In the query, use `REGEXP_EXTRACT(Description, r'https://calls\.kixie\.com/[0-9a-f-]+\.mp3') AS mp3_recording_url`. Populate only when `Subject LIKE 'answered:%'` and `(Type = 'Call' OR TaskSubtype = 'Call')` — otherwise NULL. `transformActivityRecord` at line 278 maps `mp3_recording_url` → `mp3RecordingUrl: string | null` on the ActivityRecord type. **Do not** return raw `Description` to the client (PII, large payload).

**Tests:** A lightweight unit test fixture: feed the transform a synthetic raw row with a known Description, assert the extracted URL matches the expected UUID. Place in `src/lib/queries/__tests__/record-activity.test.ts` (new file).

**Depends on:** none (BigQuery and Prisma layers are independent for now)

**Execution note:** Schema-context MCP must be consulted (`describe_view` on `SavvyGTMData.Task`) before writing the SQL, per CLAUDE.md hard gate.

**Patterns to follow:** Existing CASE patterns in `record-activity.ts:140-260`; the snake_case → camelCase transform at line 278.

**Verification:** Curl the activity API for a known lead with an answered outbound call (use an example from the data-verifier sample); confirm response has `mp3RecordingUrl` populated for that row.

---

#### Unit 1.3: Activity API — merge Postgres `CallTranscript` into response

**Goal:** When the activity feed is fetched, batch-look-up transcripts in Postgres and merge `notesMarkdown`, `notesGeneratedAt`, `callTypeClassification`, `errorState` into the response per Task.

**Files:**
- `src/app/api/dashboard/record-detail/[id]/activity/route.ts` (modify)
- `src/types/record-activity.ts` (extend `ActivityRecord` with the merged fields, all optional)
- `src/lib/queries/call-transcripts.ts` (new — `getTranscriptsByTaskIds(taskIds: string[])` returning a Map)

**Approach:** After `getRecordActivity()` returns, collect distinct `taskId` values, single Prisma query `findMany({ where: { taskId: { in: taskIds } } })`, build a Map, attach fields to each ActivityRecord. Only attach for rows where `mp3RecordingUrl` is non-null (skip the lookup overhead otherwise — reduces N for the IN query). The merged ActivityRecord type gains: `notesMarkdown?: string | null`, `notesGeneratedAt?: string | null`, `callTypeClassification?: string | null`, `transcriptStatus?: 'none' | 'pending' | 'completed' | 'error'`. `transcriptStatus` is derived: no `mp3RecordingUrl` → `'none'`; URL but no DB row → `'pending'`; row exists with `notesMarkdown` → `'completed'`; row with `errorState` → `'error'`.

**Tests:** Mock Prisma + the BQ getter; test the merge logic with 4 cases (no URL, URL no row, URL with row, URL with error row).

**Depends on:** Unit 1.1, Unit 1.2

**Patterns to follow:** Existing API route style — `getServerSession` + permission-gated response, `cachedQuery` for BQ wrapping.

**Verification:** Curl the activity API for a lead known to have answered calls; with the table empty, `transcriptStatus: 'pending'` for all answered calls. Insert one synthetic row via psql with `notesMarkdown`, refetch, confirm that single row returns `transcriptStatus: 'completed'` and the markdown.

---

#### Unit 1.4: Markdown renderer dependency + shared component

**Goal:** Install markdown rendering and create a reusable `<MarkdownNote />` component.

**Files:**
- `package.json` (add `react-markdown`, `remark-gfm`)
- `src/components/dashboard/MarkdownNote.tsx` (new)

**Approach:** `<MarkdownNote text={string} />`. Renders inside a `<div className="prose prose-sm dark:prose-invert max-w-none">`. Uses `remark-gfm` for GitHub-flavored bullets. Configure to disable raw HTML (`skipHtml`). Only used for AI-generated notes — bounded markdown subset.

**Tests:** Snapshot test on a sample 9-section note. Place at `src/components/dashboard/__tests__/MarkdownNote.test.tsx`.

**Depends on:** none

**Patterns to follow:** Empty-state styling from `src/components/dashboard/ExploreResults.tsx:194-204` (for paired empty-state component if needed).

**Verification:** Storybook-style smoke: render `<MarkdownNote text="### Hello\n- bullet" />` in a test; assert `<h3>` and `<li>` appear in the rendered output. Type checking passes.

---

#### Unit 1.5: ActivityTimeline UI — collapsible Notes section

**Goal:** Extend `ActivityItem` so call rows with `mp3RecordingUrl` show a collapsible Notes section.

**Files:**
- `src/components/dashboard/ActivityTimeline.tsx` (modify ActivityItem at lines 180-261)

**Approach:** Add a second expandable section below the existing message-preview section. Conditional render: if `transcriptStatus === 'completed'` show a `<button>` "AI Notes" (with the existing ChevronDown icon style); on expand, render `<MarkdownNote text={notesMarkdown} />` plus a small footer line with `callTypeClassification` and `notesGeneratedAt`. For other statuses: `'none'` → don't render anything; `'pending'` → small italic `"AI notes not yet generated"`; `'error'` → small red text `"Note generation failed"` (admin-only — gate behind permission). Use a separate `useState` (`notesExpanded`) for this section so SMS preview and Notes can be expanded independently.

**Tests:** Component test with React Testing Library: mount with each `transcriptStatus` value, assert correct UI appears / hides correctly on click. Place at `src/components/dashboard/__tests__/ActivityTimeline.test.tsx` (new).

**Depends on:** Unit 1.3, Unit 1.4

**Patterns to follow:** Existing expand pattern at `ActivityTimeline.tsx:242-255`. Mirror it exactly for the notes section.

**Verification:** Manual UI check via `npm run dev`. Open a lead modal known to have answered outbound calls; with empty `call_transcripts` table, all answered call rows show "AI notes not yet generated". Insert one row via psql with realistic markdown; refetch; expand; verify markdown renders with proper headings/bullets, dark/light mode both work.

---

#### Unit 1.6: Doc sync + Phase 1 cutover

**Goal:** Update generated docs and architecture narrative to reflect new model + API change.

**Files:**
- `docs/_generated/prisma-models.md` (regen)
- `docs/_generated/api-routes.md` (regen)
- `docs/ARCHITECTURE.md` (Database Models section)
- `.cursorrules` if needed

**Approach:** `npm run gen:all`. Then add a one-paragraph note to the ARCHITECTURE.md Database Models section about the new `CallTranscript` model and its purpose (read-by-dashboard, written-by-Phase-2). Add the activity API route's new return fields to the API documentation section.

**Tests:** none (doc sync)

**Depends on:** Units 1.1–1.5 complete

**Verification:** `npx agent-guard sync` exits clean. `git diff docs/` shows the regen output; `docs/ARCHITECTURE.md` has a coherent paragraph about the new model.

---

### Phase 2 — Backend Pipeline (Cloud Run Job)

#### Unit 2.1: `packages/call-transcriber/` skeleton

**Goal:** Self-contained service package mirroring `packages/analyst-bot/` shape, deployable to Cloud Run Jobs.

**Files:**
- `packages/call-transcriber/package.json` (new — `@savvy/call-transcriber`, deps: `@anthropic-ai/sdk`, `@google-cloud/bigquery`, `@google-cloud/storage`, `assemblyai`, `@prisma/client`, `dotenv`. devDeps: `typescript`, `@types/node`, `jest`, `ts-jest`)
- `packages/call-transcriber/tsconfig.json` (new — copy from `analyst-bot`)
- `packages/call-transcriber/Dockerfile` (new — copy from `analyst-bot`, change CMD to `node dist/index.js`, bump source-bust line)
- `packages/call-transcriber/cloudbuild.yaml` (new — image tag `gcr.io/savvy-gtm-analytics/call-transcriber:latest`)
- `packages/call-transcriber/deploy.sh` (new — `gcloud builds submit` + `gcloud run jobs deploy call-transcriber --image=...` with `--region=us-east1`, `--task-timeout=3600`, `--memory=1Gi`, `--cpu=1`, `--max-retries=1`, `--set-env-vars` and `--set-secrets`)
- `packages/call-transcriber/.env.example` (list all required env vars: `ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`, `BIGQUERY_PROJECT`, `DATABASE_URL`, `GCS_BUCKET`, `MIN_DURATION_SECONDS`, `MAX_DURATION_SECONDS`, `DAILY_COST_CAP_CENTS`, `PER_CALL_COST_CAP_CENTS`, `BACKFILL_MODE`, `MAX_CALLS_PER_RUN`, `PROMPT_VERSION`)
- `packages/call-transcriber/README.md` (operations notes: deploy command, env vars, log query, manual run command, mirroring `packages/analyst-bot/savvy_analyst_bot.md` style)
- `packages/call-transcriber/src/index.ts` (stub — logs "starting", exits 0; full pipeline lands in 2.7)

**Approach:** Standalone package, no workspace linking. The package's `Dockerfile` builds with its own `node_modules`. Prisma client is generated at build time inside the container. (Note: Prisma client needs the schema — either copy `prisma/schema.prisma` into the build context via a copy step in cloudbuild, or use the generated client by `import { PrismaClient } from '@prisma/client'` from the package's own install. Test what works during the build; this is a known GCP-Cloud-Run gotcha.)

**Tests:** Build the Docker image locally (`docker build .`); confirm it runs and exits 0.

**Depends on:** Unit 1.1 (Prisma model exists in the shared schema)

**Patterns to follow:** `packages/analyst-bot/Dockerfile`, `packages/analyst-bot/cloudbuild.yaml`, `mcp-server/deploy.sh`.

**Verification:** `docker build packages/call-transcriber` succeeds. `bash packages/call-transcriber/deploy.sh` (with env vars set) creates the Cloud Run Job. `gcloud run jobs execute call-transcriber --region=us-east1` runs the stub and exits cleanly.

---

#### Unit 2.2: BigQuery polling — find unprocessed answered outbound calls

**Goal:** Query function that returns a batch of Tasks needing transcription.

**Files:**
- `packages/call-transcriber/src/bq-poller.ts` (new)

**Approach:** Use `@google-cloud/bigquery` directly. Query joins `SavvyGTMData.Task` LEFT JOIN against the `call_transcripts` Postgres table — wait, can't JOIN Postgres in BQ. Alternate approach: BQ query returns candidate Task IDs; in Node, batch-check Postgres for which already exist; filter the list. Filter SQL:
```
WHERE IsDeleted = FALSE
  AND (Type = 'Call' OR TaskSubtype = 'Call')
  AND LOWER(Subject) LIKE 'answered:%'
  AND CallDurationInSeconds >= @minDuration
  AND (CallDurationInSeconds <= @maxDuration OR @maxDuration IS NULL)
  AND REGEXP_CONTAINS(Description, r'https://calls\.kixie\.com/[0-9a-f-]+\.mp3')
ORDER BY CreatedDate {ASC for backfill, DESC for daily}
LIMIT @batchSize
```
Returns: `taskId, whoId (fullProspectId), createdDate, callDurationSeconds, mp3Url`.

**Tests:** Unit test with a mocked BigQuery client. Verify SQL parameter binding (`@minDuration` etc.) — never string-interpolate (per project convention).

**Depends on:** Unit 2.1

**Execution note:** Schema-context MCP gate — describe `SavvyGTMData.Task` before writing.

**Patterns to follow:** `@paramName` parameterization style from the existing semantic layer (`src/lib/semantic-layer/query-templates.ts`).

**Verification:** Local run with real credentials: log first 10 candidates; spot-check that all have valid kixie URLs and reasonable durations.

---

#### Unit 2.3: Kixie download + GCS upload (parallel)

**Goal:** For a given mp3 URL, fetch from Kixie and upload to GCS with streaming. Handle 403 (archived) gracefully.

**Files:**
- `packages/call-transcriber/src/gcs.ts` (new)

**Approach:** `streamKixieToGcs(mp3Url, taskId)` returns `{ gcsPath, sizeBytes }` or throws a typed `KixieArchivedError` on 403. Use native fetch (Node 18+) → `pipeline(response.body, file.createWriteStream({ contentType: "audio/mpeg" }))`. ADC auth on Cloud Run. Bucket from env. GCS path: `recordings/<YYYY>/<MM>/<taskId>.mp3` for sane partitioning. **Run this in parallel** with the AssemblyAI submit (since AssemblyAI fetches the URL directly — not from GCS — GCS is retention/audit only).

**Tests:** Mock fetch with 200 / 403 / 500 responses; verify error mapping.

**Depends on:** Unit 2.1

**Patterns to follow:** GCS sample at `samples/streamFileUpload.js` (cited in research). Typed error class style from `src/lib/wrike-client.ts:10-19`.

**Verification:** Local run: download one known recording, confirm `gs://savvy-call-recordings/recordings/<YYYY>/<MM>/<taskId>.mp3` exists and size matches.

---

#### Unit 2.4: AssemblyAI client wrapper

**Goal:** Submit transcription, poll until ready, return diarized transcript JSON.

**Files:**
- `packages/call-transcriber/src/assemblyai-client.ts` (new)

**Approach:** Lazy-singleton `AssemblyAI` client (env: `ASSEMBLYAI_API_KEY`). Function `transcribeFromUrl(mp3Url, taskId)` calls `client.transcripts.transcribe({ audio: mp3Url, speaker_labels: true, pollingInterval: 5000 })`. Returns `{ transcriptText, utterances, durationSeconds, costCents }`. `costCents = Math.ceil((durationSeconds / 3600) * 17)` ($0.17/hr — base + diarization). Wrap in `withRetry(fn, 3)` from the wrike-client pattern. On `Transcript.status === 'error'`, throw a typed `TranscriptionError`.

**Tests:** Mock the SDK (`jest.mock('assemblyai')`) — submit, poll-until-ready, success, error. Verify cost calculation against known durations.

**Depends on:** Unit 2.1

**Patterns to follow:** Lazy singleton + retry from `packages/analyst-bot/src/claude.ts:19-113`.

**Verification:** Test against one known recording locally; log diarized utterances to confirm `Speaker A` / `Speaker B` labels appear. Confirm cost calculation matches AssemblyAI's billing dashboard within rounding.

---

#### Unit 2.5: Claude classifier + notes generator

**Goal:** Two-step Claude pipeline: (1) classify call type, (2) generate notes per matching schema.

**Files:**
- `packages/call-transcriber/src/claude-client.ts` (new — Anthropic SDK wrapper with prompt caching)
- `packages/call-transcriber/src/prompts/classifier.ts` (new — call-type classifier prompt)
- `packages/call-transcriber/src/prompts/discovery-notes.ts` (new — full 9-section schema, including the user's example template)
- `packages/call-transcriber/src/prompts/general-notes.ts` (new — lighter schema for non-discovery calls: summary, action items, advisor questions, follow-up flags)
- `packages/call-transcriber/src/notes-generator.ts` (new — orchestrates the two-step call)

**Approach:** Lazy `Anthropic` client. `classifyCallType(diarizedTranscript)` returns `'discovery' | 'follow-up' | 'scheduling' | 'other'` (single Claude call, ~200 tokens). Then `generateNotes(diarizedTranscript, callType)` picks the matching prompt template, calls Claude Sonnet 4.6 with `system: [{ type: 'text', text: PROMPT_TEMPLATE, cache_control: { type: 'ephemeral' } }]` (5-min TTL). User message: the diarized transcript. `max_tokens: 2000`. Output: markdown text. Include `PROMPT_VERSION` constant in the file (e.g. `'2026-04-27-v1'`); persist on the row so we can identify which prompt produced which notes for future regeneration. Verify the discovery-notes prompt exceeds 2048 tokens (pad with detailed schema definitions if needed) so caching activates. Cost calc: input tokens × $3/MTok (or $0.30/MTok cached) + output tokens × $15/MTok.

**Tests:** Snapshot tests on 2-3 canonical transcripts (manually crafted) → assert generated notes contain expected section headings and stay under 2200 chars. Place at `packages/call-transcriber/src/__tests__/notes-generator.test.ts`. Use real Claude API in tests gated behind `ANTHROPIC_API_KEY` env presence (fixture-replay otherwise).

**Depends on:** Unit 2.1

**Patterns to follow:** Anthropic SDK lazy client at `packages/analyst-bot/src/claude.ts:19-32`. Prompt template style from `src/lib/reporting/prompts/*.ts`.

**Verification:** Run end-to-end on one real transcribed call locally; confirm: classification is reasonable, notes are ≤2200 chars, headings + bullets render, numbers from the transcript appear verbatim in the notes (per the playbook rule).

---

#### Unit 2.6: Postgres writer with upsert

**Goal:** Idempotent write of transcript + notes to Postgres.

**Files:**
- `packages/call-transcriber/src/db-writer.ts` (new)

**Approach:** `upsertCallTranscript(input: CallTranscriptInput)` calls `prisma.callTranscript.upsert({ where: { taskId }, create: {...}, update: {...} })`. On any error in the pipeline, write a partial row with `errorState` populated (the task is still recorded as attempted). Track per-day cost via `prisma.transcriptionCostDaily.upsert({ where: { date: today }, update: { costCents: { increment: ... } }, create: {...} })`.

**Tests:** Integration test against a local Postgres or test DB; verify upsert idempotency (run twice, expect one row, second call updates).

**Depends on:** Unit 1.1, Unit 2.1

**Patterns to follow:** `src/lib/queries/weekly-goals.ts:75-80` upsert pattern.

**Verification:** Manual run + psql query confirming row exists and matches input.

---

#### Unit 2.7: Pipeline orchestration + cost guard

**Goal:** Top-level loop that consumes the BQ batch and runs each call through the pipeline, with cost-cap aborts.

**Files:**
- `packages/call-transcriber/src/index.ts` (replace stub)
- `packages/call-transcriber/src/cost-guard.ts` (new — checks daily aggregate before each call, throws `CostCapExceededError` to abort the run)

**Approach:** `main()`:
1. Read env: `MIN_DURATION_SECONDS`, `MAX_CALLS_PER_RUN`, `BACKFILL_MODE`, `DAILY_COST_CAP_CENTS`, `PER_CALL_COST_CAP_CENTS`.
2. Pre-flight cost check: if today's spend ≥ daily cap, log + exit 0 (success, just nothing to do).
3. Fetch batch from `bq-poller`.
4. For each task, in series (parallelism deferred to a later iteration — series is simpler to reason about for v1):
   - Estimate cost = `(durationSeconds / 3600) * 17` cents + Claude cost estimate (~$0.02 cap).
   - If estimate > per-call cap, skip with `errorState: 'CALL_OVER_COST_CAP'`.
   - If running total + estimate would exceed daily cap, log + exit cleanly.
   - Run: parallel(GCS upload, AssemblyAI transcribe). Then classify → notes → upsert.
   - Update daily cost aggregate after each successful call.
5. Log summary at end.

Error handling: each call is wrapped in a try/catch. On `KixieArchivedError`, write row with `errorState: 'KIXIE_ARCHIVED'`. On `TranscriptionError`, write row with `errorState: 'TRANSCRIPTION_FAILED'`. On Claude failure, leave transcript persisted but `errorState: 'NOTES_FAILED'` (next run can retry the notes step only — stretch goal, not v1).

**Tests:** End-to-end integration test with mocked BQ + mocked AssemblyAI + mocked Claude — verify the cost guard aborts at the right threshold, the cost aggregate updates correctly, errors don't crash the loop.

**Depends on:** Units 2.2, 2.3, 2.4, 2.5, 2.6

**Patterns to follow:** Sequential processing pattern (no existing precedent for this exact shape; design from scratch but mirror the `withRetry` style for atomic operations).

**Verification:** Local run with `MAX_CALLS_PER_RUN=3` against real APIs; verify 3 rows appear in `call_transcripts` with full data and cost numbers; verify the daily cost aggregate increments by the sum.

---

#### Unit 2.8: Observability — structured logs + spend dashboard query

**Goal:** Logs the operator can grep + a SQL query that summarizes daily transcription health.

**Files:**
- `packages/call-transcriber/src/logger.ts` (new — JSON-line structured logging via `console.log(JSON.stringify(...))`; Cloud Logging picks it up automatically)
- `packages/call-transcriber/queries/daily-health.sql` (new — Postgres query: counts of completed/error/cost-aborted by day, average note length, classification distribution)
- `packages/call-transcriber/README.md` (extend with log query examples)

**Approach:** Every log line: `{ts, level, event, taskId, durationSec, costCents, errorState, ...}`. Cloud Logging filter examples in the README: `resource.type="cloud_run_job" AND resource.labels.job_name="call-transcriber" AND severity>=ERROR`.

**Tests:** none (logger smoke).

**Depends on:** Unit 2.7

**Patterns to follow:** Existing structured logging in `packages/analyst-bot` (search for `console.log(JSON.stringify` to find).

**Verification:** Run the daily-health query in psql after a real run; numbers match the run's actual outcomes.

---

#### Unit 2.9: Cloud Scheduler trigger + secret config

**Goal:** Daily scheduled trigger that runs the Job in normal (newest-first) mode.

**Files:**
- `packages/call-transcriber/deploy.sh` (extend — add `gcloud scheduler jobs create http call-transcriber-daily ...`)
- `packages/call-transcriber/cloud-scheduler-config.yaml` (new — config for human reference; not consumed automatically)

**Approach:** Cloud Scheduler invokes the Job via the Cloud Run Jobs Admin API. Service account: dedicated `call-transcriber-runner@savvy-gtm-analytics.iam` with `roles/run.invoker`. Schedule: `0 7 * * *` (07:00 UTC daily). Env: `BACKFILL_MODE=false`, `MAX_CALLS_PER_RUN=200`, `MIN_DURATION_SECONDS=60`. Secrets via `--set-secrets ASSEMBLYAI_API_KEY=projects/.../secrets/assemblyai-api-key:latest`. Add `ASSEMBLYAI_API_KEY` and `ANTHROPIC_API_KEY` (reuse existing) to GCP Secret Manager via console (manual step — document in README).

**Tests:** none (operations).

**Depends on:** Unit 2.7

**Patterns to follow:** Existing `--set-secrets` style on Cloud Run Service deploys (search `--set-secrets` in `packages/`).

**Verification:** `gcloud scheduler jobs run call-transcriber-daily --location=us-east1` triggers an immediate run; `gcloud run jobs executions list --job=call-transcriber` shows the new execution; logs show successful processing.

---

#### Unit 2.10: Backfill mode + 18-month spot-check

**Goal:** One-time backfill execution path that processes oldest calls first, gated by an empirical archive cutoff check.

**Files:**
- `packages/call-transcriber/scripts/spot-check-archive.ts` (new — HEAD requests to 3 sample URLs of varying ages; logs response codes; the operator decides backfill cutoff date based on results)
- `packages/call-transcriber/README.md` (document the backfill SOP: run spot-check first, then run with `BACKFILL_MODE=true` and `MIN_CREATED_DATE=<spot-check-derived-cutoff>`)
- `packages/call-transcriber/src/bq-poller.ts` (extend — accept `MIN_CREATED_DATE` env when in backfill mode)

**Approach:** Spot-check script: `ts-node spot-check-archive.ts` queries BQ for 3 sample kixie URLs from 6, 15, and 20 months old; runs HEAD requests; prints status codes. Operator picks a safe cutoff (e.g., if 20-month is 403 and 15-month is 200, set cutoff to 14 months). Backfill mode runs as a one-shot manual `gcloud run jobs execute` (not scheduled), with `MAX_CALLS_PER_RUN=500` and a generous `DAILY_COST_CAP_CENTS=100000` ($1000) — adjusted per the verified count from data-verifier (currently 6,222 total, 2,902 after 60s filter, ~$290 expected cost).

**Tests:** none (script is an operations tool).

**Depends on:** Unit 2.7

**Patterns to follow:** N/A — this is novel.

**Verification:** Spot-check script returns status codes for the three URLs. Backfill execution processes calls and stays under cost cap.

---

#### Unit 2.11: Doc sync + Phase 2 cutover

**Goal:** Capture the new service in the architecture documentation.

**Files:**
- `docs/ARCHITECTURE.md` (add a "Call Transcription Pipeline" section — what it does, how it deploys, where the secrets live, how to read logs)
- `CLAUDE.md` (extend the GCP services table at the top with `call-transcriber` row)

**Approach:** ~30 lines in ARCHITECTURE.md mirroring the analyst-bot section structure. CLAUDE.md gets one row added to the existing services table.

**Tests:** none.

**Depends on:** Units 2.1–2.10

**Verification:** `npx agent-guard sync` exits clean. The diff makes sense to a future engineer with no context.

---

### Phase 3 — SFDC Writeback

#### Unit 3.1: Salesforce custom field — `Task.AI_Call_Notes__c`

**Goal:** Create the field in the Salesforce org and confirm FLS for SGA + admin profiles.

**Files:**
- `sfdc/objects/Task/fields/AI_Call_Notes__c.field-meta.xml` (new — Salesforce metadata for the field; deployed via `sf project deploy start` or the existing `sfdx/` workflow visible in git status)
- `sfdc/profiles/Sales_Growth_Associate.profile-meta.xml` (modify — add edit permission)
- `sfdc/profiles/SystemAdministrator.profile-meta.xml` (modify — add edit permission, though usually inherited)

**Approach:** Long Text Area, length 32768. Help text: "AI-generated notes from call recording transcription. Updated automatically by the call-transcriber service." External ID = false. The field is deployed once; the writeback worker fills it.

**Tests:** none (Salesforce metadata).

**Depends on:** none (independent track from Phase 2; can land in parallel)

**Patterns to follow:** Existing `sfdx/` retrievals from the repo. The `Sales_Growth_Associate` PSG memory note flags that profile permissions are sensitive — verify by retrieving current profile state before modifying.

**Verification:** Deploy via `sf project deploy start --source-dir sfdc/objects/Task/fields/AI_Call_Notes__c.field-meta.xml --target-org savvy`. Confirm field exists via `curl ${INSTANCE}/services/data/v66.0/sobjects/Task/describe -H "Authorization: Bearer ${TOKEN}" | grep AI_Call_Notes__c`.

---

#### Unit 3.2: SFDC REST writeback helper

**Goal:** A function that PATCHes a single Task with the generated notes.

**Files:**
- `packages/call-transcriber/src/sfdc-writeback.ts` (new)

**Approach:** Token + instance from environment (set at deploy time via Secret Manager — use a long-lived OAuth refresh token via JWT bearer flow, OR a stored access token refreshed on 401; recommend JWT bearer flow for unattended workflows). PATCH `/services/data/v66.0/sobjects/Task/<id>` with body `{"AI_Call_Notes__c": notesMarkdown}`. On 204, mark `pushedToSfdcAt: now()` in the local DB. On error, log + retry via `withRetry(fn, 3)`. Idempotency: check `pushedToSfdcAt IS NULL` before pushing.

**Tests:** Mock fetch; verify PATCH endpoint, headers, body shape, 204 success path, 401 retry path, 5xx backoff.

**Depends on:** Unit 2.6 (the `pushedToSfdcAt` column exists)

**Execution note:** The repo's `sf data query` CLI bug does not affect REST PATCH, so direct curl/fetch is fine.

**Patterns to follow:** typed-error style from `src/lib/wrike-client.ts:10-19`; `withRetry` wrapper.

**Verification:** Test PATCH against a sandbox Task; confirm field updates; check `pushedToSfdcAt` populated after.

---

#### Unit 3.3: Writeback worker logic — auto-trigger after note generation

**Goal:** When a call's notes are generated successfully, automatically push to SFDC.

**Files:**
- `packages/call-transcriber/src/index.ts` (modify — after `db-writer.upsert` for completed notes, call `sfdc-writeback.push` if env `ENABLE_SFDC_WRITEBACK=true`)

**Approach:** Feature-flagged via env var so we can deploy Phase 2 first without writeback. Idempotency check is in `sfdc-writeback.push`. On writeback failure, log + continue (don't block the next call's processing).

**Tests:** Integration test with `ENABLE_SFDC_WRITEBACK=true` and mocked Salesforce — verify the call sequence and that idempotency kicks in on the second run.

**Depends on:** Unit 3.2

**Verification:** Run on one call; verify Salesforce Task shows the field populated; rerun the job; verify no duplicate write.

---

#### Unit 3.4: Optional dashboard "Push to SFDC" admin button

**Goal:** Manual trigger from the dashboard (admin-only) to retry a failed writeback or to push notes from a not-yet-pushed call.

**Files:**
- `src/app/api/dashboard/admin/push-call-notes-to-sfdc/route.ts` (new — admin-gated POST `{taskId}`)
- `src/components/dashboard/ActivityTimeline.tsx` (extend the Notes section with a small "Push to SFDC" button gated on user role + `pushedToSfdcAt IS NULL`)

**Approach:** API route checks role (`admin` / `revops_admin` only), looks up the `CallTranscript` row, calls a thin RPC to the call-transcriber service (or duplicates `sfdc-writeback.push` logic in the dashboard). Update `pushedToSfdcAt`. Return success.

**Tests:** API route test with admin and non-admin sessions.

**Depends on:** Unit 3.2 (or duplicate the function in dashboard)

**Patterns to follow:** Existing admin-gated routes (search `roles.includes('admin')` in `src/app/api/`).

**Verification:** Admin clicks the button, sees a success toast; non-admin doesn't see the button.

---

#### Unit 3.5: Doc sync + Phase 3 cutover

**Goal:** Final docs sync after Phase 3.

**Files:**
- `docs/ARCHITECTURE.md` (extend the call-transcription section with the SFDC writeback flow)
- `docs/_generated/api-routes.md` (regen for the new admin route)

**Verification:** `npx agent-guard sync`. Diff makes sense.

---

## Test Strategy

**Unit tests** (Jest + ts-jest):
- `src/lib/queries/__tests__/record-activity.test.ts` — kixie URL extraction logic.
- `src/components/dashboard/__tests__/ActivityTimeline.test.tsx` — collapsible Notes states.
- `src/components/dashboard/__tests__/MarkdownNote.test.tsx` — markdown rendering snapshot.
- `packages/call-transcriber/src/__tests__/bq-poller.test.ts` — SQL parameter binding.
- `packages/call-transcriber/src/__tests__/gcs.test.ts` — error mapping.
- `packages/call-transcriber/src/__tests__/assemblyai-client.test.ts` — submit + poll + cost calc.
- `packages/call-transcriber/src/__tests__/notes-generator.test.ts` — snapshot tests on 2-3 canonical transcripts (real Claude calls if `ANTHROPIC_API_KEY` set; fixtures otherwise).
- `packages/call-transcriber/src/__tests__/sfdc-writeback.test.ts` — PATCH endpoint + idempotency.

**Integration tests:**
- End-to-end pipeline test (Unit 2.7) with all external services mocked — verify cost guard, error handling, idempotency.
- Activity API merge test (Unit 1.3) with mocked Prisma + mocked BQ.

**Manual verification:**
- Phase 1 cutover: open a known lead modal, see the empty-state Notes section render correctly.
- Phase 2 cutover: trigger Cloud Run Job manually for 5 calls, verify rows in `call_transcripts` with realistic notes, refresh dashboard, see notes render.
- Phase 3 cutover: verify Salesforce Task shows `AI_Call_Notes__c` populated, idempotency holds on rerun.
- Pre-backfill: run spot-check script, document results, decide cutoff date.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Kixie 18-month archive is real and recordings are silently rolling out of reach | MEDIUM | HIGH | Pre-backfill spot-check script (Unit 2.10); run backfill within days of Phase 2 cutover. Document the cutoff date observed. |
| AssemblyAI SDK README warns against production use at scale | MEDIUM | MEDIUM | At ~1,300 calls/month projected, we're well under "scale." If volume grows, swap SDK for direct REST calls — interface in `assemblyai-client.ts` is small. |
| Claude prompt cache silently no-ops if system prompt < 2048 tokens | MEDIUM | MEDIUM | Verify token count of `discovery-notes.ts` template; pad with detailed schema definitions. Log cache hit rate from API responses to confirm caching is active. |
| Cost overrun on backfill | LOW | MEDIUM | Cost guard aborts on daily cap. Conservative `DAILY_COST_CAP_CENTS` for first run (e.g., $50). |
| Generated notes hallucinate numbers not in transcript | MEDIUM | HIGH | Prompt explicitly instructs "verbatim only — do not paraphrase numbers"; snapshot tests assert exact numbers from canonical transcripts appear in output; add a post-hoc validator that flags suspicious hallucinated dollar amounts (regex extract from transcript vs notes). Stretch goal for v2. |
| Salesforce profile FLS blocks the writeback for non-admin users | MEDIUM | MEDIUM | Phase 3 Unit 3.1 explicitly modifies profiles. Verify with a test PATCH from a non-admin token before declaring done. |
| WhoId join rate to vw_funnel_master is only 73% | LOW | LOW | Doesn't block transcription — transcripts are keyed on Task, not on funnel record. Flag in observability that 27% of transcripts have no funnel context. |
| Cost calc estimates differ from actual AssemblyAI billing | LOW | LOW | Reconcile monthly against AssemblyAI dashboard. Adjust the cost-cents constant if drift is observed. |
| Prompt-template change invalidates existing notes (drift between prompt versions) | LOW | LOW | `promptVersion` column persisted on every row. Future "Regenerate Notes" feature can scope by prompt version. |
| Cloud Run Job cold-start adds latency per execution | LOW | LOW | One-shot batch job, cold start is negligible vs the 5-10 min AssemblyAI polling. |
| Concurrent runs (manual + scheduled) double-process calls | LOW | LOW | Postgres unique constraint on `taskId` is the safety net; upsert is idempotent. Operationally: don't manually trigger during the scheduled window. |

## Open Questions for the User

1. **Min-duration threshold**: 60 seconds is the default proposal (filters voicemails, saves ~$330 backfill). Do you want to confirm or pick a different threshold (90s? 120s?)?
2. **SFDC field name**: Going with `AI_Call_Notes__c`. Acceptable, or prefer something else (e.g., `Discovery_Note_Doc__c`)?
3. **Daily cost cap**: Proposing $50/day for daily runs and $300/day for backfill. Comfortable, or different?
4. **Backfill scope**: Whole 18 months, or limit to last N months for Phase 2 v1?
5. **Cloud Scheduler timing**: 07:00 UTC = 02:00 EST (off-hours). Acceptable?
6. **GCS bucket retention**: Indefinite, or set a lifecycle rule (e.g., delete recordings after 1 year, transcripts retained in Postgres)?

## Confidence Check

| Section | Confidence | Notes |
|---|---|---|
| Problem Frame | HIGH | Verified user need, 6,222 candidate calls confirmed in BQ. |
| Scope Boundaries | HIGH | Three-phase split is clean; Phase 1 ships independently of Phase 2. |
| Implementation Units | HIGH for Phases 1+2, MEDIUM for Phase 3 | Phase 3 SFDC writeback is the only piece without an existing repo precedent (no SFDC writeback code exists). PATCH pattern is verified, but the unattended-auth approach (JWT bearer vs stored token) needs an operations decision. |
| Test Strategy | MEDIUM | Snapshot testing AI-generated notes is inherently noisy — accept that tests will need occasional regeneration. Real-Claude tests gated on env var is the pragmatic compromise. |
| Risk Assessment | HIGH | The Kixie archive risk is the only unknown; spot-check before backfill resolves it. |

## Success Criteria

- [ ] Phase 1: Dashboard shows "AI notes not yet generated" / "Note generation failed" / rendered markdown notes correctly per `transcriptStatus`. Activity API responds with notes within 200ms when present.
- [ ] Phase 2: Cloud Run Job processes 50+ calls in a single execution under cost cap, writes complete rows to Postgres, logs structured events to GCP, daily Cloud Scheduler trigger fires successfully for 7 consecutive days.
- [ ] Phase 2: Backfill completes for the verified date range (per spot-check) with <5% error rate.
- [ ] Phase 3: SFDC `AI_Call_Notes__c` field is populated on processed calls; rerunning the writeback does not duplicate; admin button works; non-admin button is hidden.
- [ ] All tests pass.
- [ ] No regressions in the existing activity API or modal UI for non-call activities.
- [ ] Generated notes for canonical transcripts: contain all 9 sections (when discovery), capture verbatim numbers, stay under 2200 chars.
- [ ] `npx agent-guard sync` passes after each phase.
- [ ] Cost reconciliation: actual AssemblyAI bill ± 5% of cost calc.

---

# Refinement Log (Council Triage Output)

**Date:** 2026-04-27. **Reviewers:** Codex (gpt-5.4) + Gemini (gemini-3.1-pro-preview) via /auto-feature pipeline. **Raw responses:** `docs/council-reviews/2026-04-27-{codex,gemini}-kixie-transcription.md`. **Merged feedback:** `council-feedback.md`. **Triage detail:** `triage-results.md`.

This section is **authoritative** for everything it covers. Where the original units above conflict with the Refinement Log, **the Refinement Log wins.** /work and human readers should read this section first.

## A. Phase Restructuring

**Original:** Phase 1 (dashboard) → Phase 2 (pipeline) → Phase 3 (SFDC writeback). Three sequential, independently shippable phases.

**Refined:** Phase 0 (compliance gates) → Phase 1+2 merged behind feature flag → Phase 3 (gated on humanApprovedAt).

### NEW Phase 0 — Compliance & Pre-Flight (4 units, blocks all subsequent code)

**Unit 0.1 — Anthropic Enterprise/ZDR verification.** Confirm Savvy's Anthropic account is on Enterprise with zero data retention (no model training on prospect data). Document the agreement reference. **STOP-AND-CONFIRM: legal/compliance sign-off required before Phase 1+2 ships.**

**Unit 0.2 — AssemblyAI DPA + zero-retention configuration.** Verify AssemblyAI Data Processing Agreement signed; configure account for zero retention (transcripts not stored beyond processing window). Document settings in `packages/call-transcriber/README.md`.

**Unit 0.3 — Kixie consent posture audit.** Verify Kixie call recordings carry appropriate two-party consent for the states where Savvy operates AND that recordings are permitted to be processed by AI services per the original consent. Document in `docs/compliance/kixie-consent-posture.md`. If gap, work with legal to add disclosure.

**Unit 0.4 — GCS bucket security policy.** Decide retention period (depends on Bucket 2 Q2). Spec the bucket: dedicated service account with minimal IAM, UBLA enforced, public-access prevention, CMEK with Cloud KMS key, lifecycle rule, Cloud Audit Logs enabled. Document in `docs/compliance/gcs-call-recordings-policy.md`.

**Phase 0 ship gate:** Documented sign-offs on 0.1, 0.2, 0.3, 0.4 from a designated approver (legal or COO). No engineering work proceeds until gate passes.

### Phase 1+2 (merged) — Feature-Flagged Combined Ship

All units from original Phase 1 and Phase 2 land together behind feature flag `FEATURE_AI_CALL_NOTES`. UI does not render the Notes section in `ActivityTimeline.tsx` to end-users until:
- The pipeline has produced its first transcript for the relevant lead, AND
- The feature flag is enabled for the user's role.

The flag is implemented as a server-side check in the activity API route (return `transcriptStatus: 'feature-disabled'` if flag off; UI hides section). Use the existing GrowthBook/feature-flag pattern if one exists; otherwise a simple env-var check.

Unit numbering changes:
- Original 1.1 → **1.1** (schema, expanded)
- Original 1.2 → **1.2** (BQ query)
- Original 1.3 → **1.3** (API merge, with feature-flag check)
- Original 1.4 → **1.4** (markdown dep)
- Original 1.5 → **1.5** (UI; **+ HITL edit affordance**, see Section B.4 below)
- NEW **1.6** — Backfill mp3 download (decoupled, runs immediately, see Section B.6 below)
- Original 2.1 → **1.7** (service skeleton)
- Original 2.2 → **1.8** (BQ poller; **with state-machine eligibility**, see Section B.1)
- Original 2.3 → **1.9** (GCS streaming; **+ security baseline**, see Section B.5)
- Original 2.4 → **1.10** (AssemblyAI client)
- Original 2.5 → **1.11** (Claude single-call generator with `<quotes>` + speaker mapping; see Section B.2)
- NEW **1.12** — Numeric-verification post-processor (see Section B.3)
- Original 2.6 → **1.13** (Postgres writer)
- Original 2.7 → **1.14** (orchestration; **with `Promise.allSettled` + reservation cost-cap**, see Section B.7)
- Original 2.8 → **1.15** (observability)
- Original 2.9 → **1.16** (Cloud Scheduler)
- Original 2.10 → **1.17** (backfill mode + spot-check)
- Original 1.6 + 2.11 → **1.18** (doc sync, single pass after merge)

**Phase 1+2 ship gate:** Existing gates from original Phase 1 and Phase 2, AND feature flag is enabled for at least one admin user, AND end-to-end smoke test on a single real call passes.

### Phase 3 — SFDC Writeback (gated on humanApprovedAt)

**Refined behavior:** No automatic writeback. Pushes only happen when `humanApprovedAt IS NOT NULL` (set via dashboard "Approve & Push" button — gated to admin/SGM roles). Auto-trigger removed.

NEW Unit 3.0 — JWT bearer cert setup. Generate self-signed cert, register Connected App in SFDC, store private key in GCP Secret Manager, document procedure. **This was a footnote in the original plan; council surfaced it as an unstated dependency.**

Original 3.1 → 3.1 (custom field; **verify Long Text Area vs Rich Text rendering for markdown**, see Section B.10).
Original 3.2 → 3.2 (REST PATCH helper; **+ provenance marker in field body**, see Section B.9).
Original 3.3 → 3.3 (writeback worker; **gated on humanApprovedAt**).
Original 3.4 → 3.4 (admin button; now the primary trigger, not a fallback).
Original 3.5 → 3.5 (doc sync).

## B. Bucket 1 Detailed Changes (apply alongside the unit numbering above)

### B.1 — State machine on `CallTranscript`
Replaces freeform `errorState`. See revised schema in Unit 1.1 above. Eligibility query in Unit 1.8 (formerly 2.2):
```sql
WHERE status IN ('PENDING', 'FAILED_RETRYABLE')
  AND (next_retry_at IS NULL OR next_retry_at <= NOW())
  AND retry_count < @maxRetries
ORDER BY created_at ASC
LIMIT @batchSize;
```
Status transitions documented in `packages/call-transcriber/src/state-machine.ts` (NEW). Each stage of the pipeline updates `lastSuccessfulStage` on success; on failure, sets `status = 'FAILED_RETRYABLE'` if retryable (5xx / 429 / network) or `'FAILED_TERMINAL'` if not (4xx / unrecoverable). Retry policy: exponential backoff `nextRetryAt = NOW() + INTERVAL '2^retryCount minutes'`, max 3 retries.

### B.2 — Single Claude call (drops two-step) + `<quotes>` + speaker mapping
Replaces original Unit 2.5 two-step design. New prompt structure (system block, > 2048 tokens for Sonnet 4.6 caching):

```
<role>You are an AI assistant generating structured note documents from sales call transcripts...</role>

<step_1_speaker_identification>
Identify which speaker is the SGA (Savvy Wealth, asks recruiting/sales questions, represents the firm)
and which is the Advisor (the prospect, answers with their book metrics).
Output:
<speaker_map>
  <sga>Speaker A|B</sga>
  <advisor>Speaker A|B</advisor>
</speaker_map>
</step_1_speaker_identification>

<step_2_quote_extraction>
Extract verbatim sentences from the transcript that contain numbers (AUM, fees, client counts, percentages, dates).
DO NOT paraphrase. DO NOT round. DO NOT change units.
Output: <quotes>...</quotes>
</step_2_quote_extraction>

<step_3_call_type_classification>
Classify: discovery | follow-up | scheduling | other
</step_3_call_type_classification>

<step_4_structured_notes>
Based on call type, produce JSON-structured fields per the matching schema.
Numbers in any field MUST appear in <quotes> verbatim. If a number is approximate ("around 25"), capture it as "around 25" — not "25".
</step_4_structured_notes>
```

Output is a single JSON object: `{ speakerMap, quotes, callType, sections: {...}, hallucinationFlags: [...] }`.

Server-side renderer converts `sections` JSON → markdown for `notesMarkdown`. Cap rendered markdown at 2200 chars (if exceeded, log warning + truncate sections proportionally).

System prompt versioned at `PROMPT_VERSION = '2026-04-27-v1'` constant in `packages/call-transcriber/src/prompts/notes-generator.ts`.

### B.3 — Numeric-verification post-processor (NEW Unit 1.12)
After the Claude call, before persisting:
1. Extract all numeric tokens from transcript using regex: `/\$?\d+(?:[,.]\d+)*\s*(?:[KMB]|million|billion|thousand|k|m|b)?/gi`. Normalize (strip commas, lowercase suffixes).
2. Extract same from generated notes (all sections concatenated).
3. Set membership check: every number in notes must have a normalized match in the transcript number set.
4. Mismatches → push to `hallucinationFlags` array. If non-empty, set `status = 'LOW_CONFIDENCE_REVIEW_REQUIRED'` and write the flagged tokens to `errorDetail`.
5. Test fixture: 3 canonical transcripts with known numbers; assert verification passes for accurate notes and fails for synthetic-hallucinated notes.

### B.4 — HITL editing in dashboard (Unit 1.5 expansion)
Notes section in `ActivityTimeline.tsx` shows:
- AI-generated markdown (rendered)
- "Edit Notes" button (always visible to SGA + admin roles)
- "Approve & Push to SFDC" button (visible to admin/SGM roles only)

Edit modal: simple `<textarea>` with markdown preview pane (split view). Submit calls new API route `POST /api/dashboard/call-transcripts/:taskId/edit` which sets `notesMarkdownEdited`. Approve calls new API route `POST /api/dashboard/call-transcripts/:taskId/approve` which sets `humanApprovedAt`, `humanApprovedBy`. Both routes role-gated.

The "Edit" UI is intentionally simple in v1. No rich editor. No section-by-section structured edit. No diff view between AI and edited. These are deferred per Bucket 3.

### B.5 — GCS bucket security baseline (Unit 1.9 expansion)
Concrete spec for `gs://savvy-call-recordings`:
- Service account: `call-transcriber-runner@savvy-gtm-analytics.iam.gserviceaccount.com` with `roles/storage.objectAdmin` ONLY on this bucket.
- Bucket-level: `iam.uniformBucketLevelAccess.enabled = true`, `iam.publicAccessPrevention = "enforced"`.
- Encryption: CMEK referencing key `projects/savvy-gtm-analytics/locations/us-east1/keyRings/call-recordings/cryptoKeys/default`.
- Lifecycle: default 365-day delete (configurable per Bucket 2 Q2).
- Audit logs: Cloud Audit Logs `DATA_READ`, `DATA_WRITE`, `ADMIN_READ` enabled at project level for this bucket.
- Path: `gs://savvy-call-recordings/recordings/{YYYY}/{MM}/{taskId}.mp3`.
- Bucket creation script: `packages/call-transcriber/scripts/setup-gcs-bucket.sh` (NEW). Idempotent.

### B.6 — Decoupled mp3 backfill (NEW Unit 1.6, runs immediately)
Goal: mitigate the unverified Kixie 18-month archive risk by downloading mp3s into GCS BEFORE the pipeline is built. Then the pipeline reads from GCS, not Kixie.

Script: `packages/call-transcriber/scripts/backfill-mp3-download.ts` (NEW). Runs as a one-shot Cloud Run Job execution (or local, with credentials). Input: BQ query for all 6,222 candidate Tasks (or filtered set per Bucket 2 Q1 + Q7). Action: HEAD-check the kixie URL; if 200, stream-pipe to GCS; if 403, write a placeholder Postgres row with `status = 'KIXIE_ARCHIVED'`. Concurrency: 10 parallel via `p-limit`.

This unit ships BEFORE the rest of Phase 1+2 to start preserving recordings immediately. Cost: GCS storage only, no AssemblyAI/Anthropic spend.

### B.7 — `Promise.allSettled` + cost-cap reservation (Unit 1.14 details)
**Promise.allSettled:** Replace any `Promise.all([gcsUpload, assemblyaiSubmit])` with `Promise.allSettled`. Persist each leg's outcome separately (`gcsStatus`, error stored on row). If GCS fails but AssemblyAI succeeds: log warning, continue (transcript was the goal; GCS retention is best-effort retention).

**Cost-cap reservation:**
```typescript
async function reserveCost(estimatedCents: number): Promise<{ release: (actualCents: number) => Promise<void> }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('cost-cap-daily'))`;
    const today = await tx.$queryRaw<[{ sum: bigint }]>`
      SELECT COALESCE(SUM(transcription_cost_cents + COALESCE(notes_cost_cents, 0)), 0)::bigint as sum
      FROM call_transcripts WHERE created_at::date = CURRENT_DATE`;
    const spent = Number(today[0].sum);
    if (spent + estimatedCents > DAILY_COST_CAP_CENTS) {
      throw new CostCapExceededError(`would exceed daily cap: ${spent} + ${estimatedCents} > ${DAILY_COST_CAP_CENTS}`);
    }
    return {
      release: async (actualCents: number) => {
        await prisma.callTranscript.update({
          where: { taskId },
          data: { transcriptionCostCents: actualCents }
        });
      }
    };
  });
}
```

The advisory lock is xact-scoped — released on COMMIT. Concurrent runs serialize on this critical section.

### B.8 — Don't retry 400 in API client wrappers (code-comment enforcement)
In `packages/call-transcriber/src/{claude-client,assemblyai-client}.ts`, the retry helper must explicitly enumerate retryable codes:

```typescript
const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504, 529]);
function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
  return typeof status === 'number' && RETRYABLE_CODES.has(status);
}
```

Code comment above the retry function: `// DO NOT add 400 to RETRYABLE_CODES. analyst-bot retries 400 (claude.ts:71-113); we deliberately don't.`

### B.9 — Provenance marker in SFDC field body (Unit 3.2)
Every push to `AI_Call_Notes__c` ends with a footer:
```
---
AI-generated by claude-sonnet-4-6 (prompt v2026-04-27-v1) on {generatedAt}.
{Edited|Approved as-is} by {humanApprovedBy} at {humanApprovedAt}.
Numeric-verified: {pass|fail-with-flags}.
```

This makes the AI-vs-human distinction visible inside SFDC at all times. Compliance and audit-trail benefit.

### B.10 — Markdown→SFDC field type verification (Unit 3.1)
Add to Unit 3.1 verification step: deploy field as Long Text Area first, render a sample 9-section note in the SFDC UI, judge readability. If markdown headings + bullets render as raw `### Heading` / `- bullet` text, switch field type to Rich Text Area and convert markdown → HTML server-side before PATCH (use `marked` package; sanitize via `dompurify`). Document the chosen path in `docs/compliance/sfdc-field-spec.md`.

### B.11 — Timezone correction
"07:00 UTC = 02:00 EST" was wrong. Correct interpretation: scheduler is set in UTC. `0 7 * * *` UTC = `03:00 EDT` (April-November) / `02:00 EST` (November-March). Document in `cloud-scheduler-config.yaml` comment. No runtime change needed; the schedule itself is correct as UTC.

### B.12 — Drop "monthly ceiling" wording from Requirements
Original requirement said "daily/monthly spend ceiling". Design only ever had daily aggregate. Refined Requirements above already reflects "daily spend ceiling" only. No monthly aggregate added.

### B.13 — Transcript quality fields
Already added to schema in Unit 1.1 above (`transcriptConfidence`, `transcriptWordCount`, `transcriptActualDurationSec`). Threshold logic in Unit 1.11 (Claude generator): if `confidence < 0.7` OR `wordCount < 50` OR (`actualDurationSec - durationFromBQ` > 60s drift), set `status = 'LOW_CONFIDENCE_REVIEW_REQUIRED'` and skip notes generation (transcript persists, notes block deferred to human).

### B.14 — Silence/hold-music handling instruction
Add to system prompt (B.2): `"Ignore extended silence, hold music, automated phone tree menus, ringback tones, and pre-call/post-call dead air. Focus exclusively on substantive conversation between the SGA and the Advisor."`

### B.15 — `modelId` tracked on every row
Already in revised schema. Set at write time from `process.env.CLAUDE_MODEL_ID || 'claude-sonnet-4-6'`. Future model migrations can scope regeneration by `modelId`.

## C. Bucket 2 — User Decisions (RESOLVED 2026-04-27)

| # | Question | Decision | Notes |
|---|---|---|---|
| 1 | Discovery-only or all answered outbound calls? | **All answered outbound ≥60s; single Claude call decides schema (classifier inline)** | Per B.2. ~$60-100/mo. |
| 2 | GCS retention period for raw audio? | **1 year auto-delete (lifecycle rule)** | Per B.5. Storage ~$13/yr per 1000 calls. |
| 3 | Cloud Run Job vs Service+Tasks for resumability? | **Cloud Run Job** | Default applied; user did not override. State machine (B.1) mitigates resumability concern. |
| 4 | SFDC writeback policy? | **Manual approval only** | Per B.4. SGA must explicitly approve via dashboard "Approve & Push" before any push to SFDC. No auto-write in v1. |
| 5 | Add Section 10 "Next Steps / Action Items" to discovery schema? | **Yes, add Section 10** | Per Gemini suggestion. Update prompt template in Unit 1.11; tighten other sections to stay under 2200 chars. Schema becomes 10 sections, "Unprompted Questions" stays as separate section 9. |
| 6 | HITL edit scope? | **Simple textarea + markdown preview (no rich editor in v1)** | Default applied. Section-by-section structured edit + diff view deferred to Bucket 3. |
| 7 | <60s skip threshold? | **60s** | Verified data: 53.4% of calls are <60s, mostly voicemails. Configurable via `MIN_DURATION_SECONDS` env var. |
| 8 | Original /plan questions | **All defaults accepted:** SFDC field name `AI_Call_Notes__c`; daily caps $50/run + $300/backfill-day; full 18-month backfill scope; scheduler 07:00 UTC (= 03:00 EDT / 02:00 EST); GCS retention 1 year (per Q2). | User chose "Recommended" path on the 4 highest-blast-radius questions; remaining defaults stand unless overridden later. |

## D. Bucket 3 — Deferred to Phase 4+ or Out of Scope

- **Prompt regression evaluation framework** (Promptfoo / Braintrust) — high value, defer to v2 once we have ground-truth corpus.
- **"Unmapped Prospects" UI bucket** for the 27% no-funnel-match — Phase 4+.
- **Auto-write to SFDC rollout** — defer until 90 days of HITL-only data shows quality is high.
- **Conflict resolution UX (SGA vs SGM vs AI)** — process question, not engineering.
- **Claude inferred `CallType` and `CallDisposition` as separate analytics fields** — already implicit in `callTypeClassification`; richer disposition deferred.
- **Backup procedure for multi-hour Anthropic outage** — accept transient; state machine retries handle it.
- **"Transferable AUM" definition tightness, Catalyst/Pain truncation, compensation-deck-tracking** — prompt iteration topics, defer to first prompt-tuning cycle.

## E. Risks Table — Updated

The original Risks table (above) is superseded for the affected rows by:

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Idempotency hole (partial rows skipped) | WAS HIGH | HIGH | **MITIGATED** by B.1 state machine |
| Cost overrun via concurrent runs / retry storm | WAS MEDIUM | HIGH | **MITIGATED** by B.7 reservation model |
| Hallucinated verbatim numbers | HIGH | HIGH | **MITIGATED** by B.2 `<quotes>` + B.3 numeric verification + B.4 HITL approval |
| Speaker inversion (SGA labeled as advisor) | HIGH | HIGH | **MITIGATED** by B.2 speaker identification step |
| Compliance gap (vendor PII handling) | MEDIUM | CRITICAL | **MITIGATED** by Phase 0 gate |
| GCS retention security gap | MEDIUM | HIGH | **MITIGATED** by B.5 baseline |
| Trust debt from empty Phase 1 UI | HIGH | MEDIUM | **MITIGATED** by feature-flagged combined ship |
| Auto-push of AI text to SFDC | HIGH | HIGH | **MITIGATED** by B.4 HITL gate + B.9 provenance |
| 18-month Kixie archive cliff | MEDIUM-HIGH | HIGH | **MITIGATED** by B.6 decoupled mp3 backfill |
| Claude prompt cache silently no-ops | MEDIUM | MEDIUM | (Carry forward) Verify token count >2048 in Unit 1.11; log cache hit rate |
| AssemblyAI SDK production-scale warning | MEDIUM | MEDIUM | (Carry forward) Below 5K threshold today; instrument for fallback to direct REST |
| SFDC profile FLS blocks writeback | MEDIUM | MEDIUM | (Carry forward) Phase 3 Unit 3.1 verifies with non-admin token |
| Funnel match rate 73% — analytics gap | LOW | LOW | (Carry forward) Doesn't block transcription; flag in observability |

## F. Convergence Summary

Both Codex and Gemini independently flagged 6 issues. These had the highest signal in the review and got priority Bucket 1 treatment:

1. Idempotency / state machine → B.1
2. Hallucinated verbatim numbers → B.2 + B.3
3. Phase 1 dead UI → Phase merge under feature flag
4. No HITL edit → B.4
5. Compliance / data-security blindspot → Phase 0
6. `errorState` freeform string → B.1 (state enum)

When two independent adversarial reviews converge, the issue is real. None were dismissed or deferred.

---

## G. Sales-Coaching DB Integration (REVISION 2026-04-27, post smoke-test)

> **This section supersedes Unit 1.1's Prisma `CallTranscript` model spec.** The data does not live in a new dashboard Postgres model. It lives in the sales-coaching project's existing `call_notes` table, extended to be source-agnostic via migration `009_extend_call_notes_for_kixie.sql`. Migration file: `C:/Users/russe/Documents/sales-coaching/src/lib/db/migrations/009_extend_call_notes_for_kixie.sql` (already written).

### G.1 — Why this changed

The smoke test (`scripts/smoke-test-kixie-transcription.cjs`) validated that the AssemblyAI + Claude pipeline produces high-quality structured notes. With the architecture proven, the user reframed the data-location question: **Kixie call notes serve the same downstream user (reps in the sales-coaching app) as Granola notes do.** Forking the schema means forking the UI, the manager-review workflow, the SFDC writeback retry/audit (`sfdc_write_log`), the tombstoning logic, and the evaluations rubric path. Wrong tradeoff.

The right tradeoff: **extend `call_notes` so it's source-agnostic.** Granola rows untouched. Kixie rows populate a new set of nullable columns. Both surface in the same UI.

The architectural win the user identified: Kixie's mp3 lives on a Salesforce Task that already has `WhoId`/`WhatId`. The Granola pipeline runs a 4-step waterfall (`crd_prefix` → `attendee_email` → `calendar_title` → `manual_entry`) to backfill SFDC linkage. Kixie skips all of that with `linkage_strategy='kixie_task_link'` — the SFDC IDs come pre-populated from the BQ Task row.

### G.2 — Schema changes (full migration in `009_extend_call_notes_for_kixie.sql`)

**Added to `call_notes`:**

- `source TEXT NOT NULL DEFAULT 'granola' CHECK (source IN ('granola','kixie'))`
- `kixie_task_id TEXT NULL UNIQUE` — Salesforce Task.Id, the natural Kixie identity
- `kixie_recording_url TEXT NULL` — separate from `granola_web_url` so source-aware UI actions ("View in Granola" vs "Play recording") stay clean
- `pipeline_status TEXT NULL` (Kixie state machine, parallel to existing `status` lifecycle)
- `processing_started_at`, `last_attempt_at`, `retry_count INT DEFAULT 0`, `next_retry_at`, `last_successful_stage`
- `transcription_cost_cents`, `notes_cost_cents`, `transcription_service`, `prompt_version`, `model_id`
- `transcript_confidence`, `transcript_word_count`, `transcript_actual_duration_sec`
- `summary_markdown_edited` (HITL override), `human_approved_at` (approved_by already exists)
- `gcs_path`, `gcs_status`, `mp3_downloaded_at`
- `pushed_to_sfdc_at`, `pushed_to_sfdc_version` (idempotency hash)
- `pipeline_error_detail`

**Relaxed (Granola rows unaffected, Kixie rows leave NULL):**

- `granola_note_id` — `DROP NOT NULL` (UNIQUE preserved; multi-NULL is allowed by Postgres default)
- `raw_granola_payload` — `DROP NOT NULL`

**Extended CHECK constraints:**

- `linkage_strategy` — added `'kixie_task_link'` value
- `pipeline_status` — new check covers all Kixie operational states
- New constraint `call_notes_source_identity_check`: granola rows must have `granola_note_id`, kixie rows must have `kixie_task_id`

**New indexes:**

- `idx_call_notes_kixie_eligible` — partial on `(pipeline_status, next_retry_at)` for the poller
- `idx_call_notes_kixie_task_id` — partial unique-ish for Phase 3 writeback lookup
- `idx_call_notes_source_started` — source-aware `/my-calls` listing
- `idx_call_notes_kixie_cost_by_day` — partial on `(created_at)` for the cost-cap SUM aggregate

### G.3 — Connection from dashboard to sales-coaching DB

**Env vars added to dashboard `.env`** (sourced from `C:/Users/russe/Documents/sales-coaching/.env`, prefixed with `SALES_COACHING_`):

```
SALES_COACHING_DATABASE_URL              # pooled URL — used at runtime by call-transcriber + dashboard
SALES_COACHING_DATABASE_URL_UNPOOLED     # direct URL — used to apply migrations
SALES_COACHING_PGHOST
SALES_COACHING_PGHOST_UNPOOLED
SALES_COACHING_PGUSER
SALES_COACHING_PGDATABASE
SALES_COACHING_PGPASSWORD
```

`.env.example` updated with placeholders + documentation header. Real values are in `.env` (gitignored).

**Two databases from the dashboard, no Prisma for the second:**

- The dashboard's existing `DATABASE_URL` → existing Prisma client → existing 17 models. **Unchanged.**
- The new `SALES_COACHING_DATABASE_URL` → raw `pg.Pool` client. No Prisma. Schema lives in sales-coaching repo.

This means the dashboard's `prisma/schema.prisma` does NOT get a `CallTranscript` model. Unit 1.1 (Prisma model + migrations) in the original plan body is **DELETED** for this rev. Replaced by:

### G.4 — Unit Renumbering (Phase 1+2 merged ship, sales-coaching variant)

**Pre-Phase-1 (NEW):** Apply migration to sales-coaching DB.

```bash
cd C:/Users/russe/Documents/sales-coaching
psql $DATABASE_URL_UNPOOLED -f src/lib/db/migrations/009_extend_call_notes_for_kixie.sql
# Verify
psql $DATABASE_URL -c "\d call_notes" | grep -E "source|kixie|pipeline_status|retry_count"
```

This is gated on Phase 0 sign-off. Run once.

**Unit 1.1 → DELETED.** Replaced by the migration above.

**Unit 1.2 (BigQuery query):** Unchanged. Still extracts `Description` + regex for kixie URL.

**Unit 1.3 (Activity API merge):** Now reads from sales-coaching DB via `SALES_COACHING_DATABASE_URL`.

```typescript
// src/lib/queries/call-transcripts.ts (NEW)
import { Pool } from 'pg';
const salesCoachingPool = new Pool({ connectionString: process.env.SALES_COACHING_DATABASE_URL });

export async function getKixieTranscriptsByTaskIds(taskIds: string[]): Promise<Map<string, KixieTranscriptRow>> {
  if (taskIds.length === 0) return new Map();
  const { rows } = await salesCoachingPool.query(
    `SELECT kixie_task_id, source, pipeline_status, status,
            summary_markdown, summary_markdown_edited,
            human_approved_at, pushed_to_sfdc_at,
            call_started_at, transcription_cost_cents, notes_cost_cents
     FROM call_notes
     WHERE source = 'kixie' AND kixie_task_id = ANY($1::text[])`,
    [taskIds]
  );
  return new Map(rows.map(r => [r.kixie_task_id, r]));
}
```

The Activity API merges the resulting Map into the BQ-derived ActivityRecord rows. `transcriptStatus` is derived from `pipeline_status` + `status`:

| pipeline_status | status | transcriptStatus |
|---|---|---|
| (no row) | — | `'pending'` (URL exists, transcript not yet) |
| `'completed'` | `'pending'` | `'completed'` (notes generated, awaiting SGA approval) |
| `'completed'` | `'approved'` | `'completed'` |
| `'completed'` | `'sent_to_sfdc'` | `'completed'` |
| `'failed_retryable'` / `'failed_terminal'` | — | `'error'` |
| `'kixie_archived'` | — | `'error'` (with specific message: "Recording archived by Kixie") |
| `'low_duration_skipped'` | — | `'none'` (treat like no recording) |
| (no kixie URL) | — | `'none'` |

**Unit 1.4 (markdown rendering):** Unchanged.

**Unit 1.5 (UI: collapsible Notes + HITL edit affordance):** Unchanged in design, but the data shape now reflects `summary_markdown_edited` overriding `summary_markdown` when present. The "Approve & Push to SFDC" button calls a new dashboard API route that PATCHes `humanApprovedAt` directly in sales-coaching DB.

**Unit 1.7 (call-transcriber service skeleton):** Add `pg` dep alongside `assemblyai`/`@anthropic-ai/sdk`/`@google-cloud/storage`/`@google-cloud/bigquery`. Drop `@prisma/client` from this package's deps — we don't need Prisma; raw `pg` client is sufficient for the call-transcriber's narrow surface.

**Unit 1.8 (BQ poller eligibility):** Now joins against sales-coaching `call_notes` instead of dashboard Postgres. Eligibility logic in pseudo-SQL:

```typescript
// 1. BQ: candidate Task IDs from SavvyGTMData.Task
const candidates = await bq.query(...); // returns task IDs with kixie URLs, ≥60s, etc.

// 2. Postgres (sales-coaching): filter to eligible
const { rows: eligible } = await salesCoachingPool.query(
  `WITH input(task_id) AS (SELECT unnest($1::text[]))
   SELECT i.task_id
   FROM input i
   LEFT JOIN call_notes c
     ON c.source = 'kixie' AND c.kixie_task_id = i.task_id
   WHERE c.id IS NULL  -- never seen
      OR (c.pipeline_status IN ('pending', 'failed_retryable')
          AND (c.next_retry_at IS NULL OR c.next_retry_at <= NOW())
          AND c.retry_count < $2)
   LIMIT $3`,
  [candidates.map(c => c.taskId), MAX_RETRIES, BATCH_SIZE]
);
```

**Unit 1.13 (writer):** INSERT or UPDATE on `call_notes` keyed by `kixie_task_id`. The first write happens at the start of processing (`pipeline_status='downloading'`, `processing_started_at=NOW()`); subsequent stage transitions are UPDATE statements; final write sets `pipeline_status='completed'` + `summary_markdown` + `summary_text` + `transcript JSONB` + costs.

The required NOT NULL columns (`title`, `granola_web_url`, `summary_text`, `summary_markdown`, `linkage_strategy`, `note_char_count`) are populated like this for Kixie rows:

| Column | Kixie value |
|---|---|
| `rep_id` | resolved by looking up SGA from `Task.OwnerId` → `reps.email` lookup |
| `title` | constructed: `"Kixie Outbound — {advisor_name or to_phone}"` |
| `granola_web_url` | NULL (not applicable — Kixie URL lives in `kixie_recording_url`). Migration drops the NOT NULL constraint and the source-identity check enforces `granola_web_url IS NOT NULL` only for granola rows. |
| `invitee_emails` | `[]` (no calendar invite) |
| `attendees` | best-effort: SFDC lookup of `WhoId` + `OwnerId` → name + role |
| `summary_text` | plain-text version of generated notes |
| `summary_markdown` | markdown version of generated notes |
| `transcript` | AssemblyAI `utterances` array as JSONB |
| `linkage_strategy` | `'kixie_task_link'` |
| `note_char_count` | `LENGTH(summary_text)` |

**Unit 1.14 (orchestration + cost guard):** Cost guard now SUMs over sales-coaching `call_notes` for daily cap:

```sql
SELECT pg_advisory_xact_lock(hashtext('cost-cap-daily'));
SELECT COALESCE(SUM(transcription_cost_cents + COALESCE(notes_cost_cents, 0)), 0)::bigint AS spent_today
FROM call_notes
WHERE source = 'kixie' AND created_at::date = CURRENT_DATE;
-- if spent_today + estimated > cap, abort
```

**Unit 3.x (SFDC writeback) — MAJOR SIMPLIFICATION:**

Phase 3 originally had 5 units (custom field, REST helper, auto-trigger, admin button, doc sync) and required building from-scratch SFDC writeback infrastructure. **The existing sales-coaching `sfdc_write_log` table already does this.** Phase 3 now reuses it directly:

- **3.1 (custom field):** Unchanged. Deploy `Task.AI_Call_Notes__c` Long Text Area via `sfdc/objects/Task/fields/`.
- **3.2 (REST helper):** Look at the sales-coaching repo's existing `src/sfdc/` module. It already has the JWT bearer auth pattern, retry logic, error mapping, and `sfdc_write_log` integration. The dashboard's call-transcriber either (a) calls the sales-coaching app's existing writeback helper as a library import (if their package is publishable), or (b) reimplements the same pattern using their migration's logic as reference. **Decision:** import from sales-coaching as a library. Adds a workspace-link dependency from dashboard `packages/call-transcriber/` to `../../../sales-coaching/dist/sfdc/`. If that's not feasible, vendor-copy the writeback module.
- **3.3 (writeback worker):** Triggered when `human_approved_at IS NOT NULL AND pushed_to_sfdc_at IS NULL`. Worker is a Postgres LISTEN/NOTIFY consumer or a polling cron — keep it simple, poll. Writes to `sfdc_write_log` per attempt; on success, sets `pushed_to_sfdc_at` + `pushed_to_sfdc_version`.
- **3.4 (admin button):** Dashboard "Approve & Push" button calls a new API route `POST /api/dashboard/call-notes/:kixieTaskId/approve-and-push` which: (a) sets `human_approved_at` in sales-coaching DB, (b) inserts a row into `sfdc_write_log` with status='pending', (c) the worker picks it up. **Or simpler:** PATCH `human_approved_at` only — let the worker poll for `human_approved_at IS NOT NULL AND pushed_to_sfdc_at IS NULL` rows. Single dashboard side effect; worker handles SFDC. Recommend the simpler version.
- **3.5 (doc sync):** Unchanged.

### G.5 — Updated env var checklist (for `.env`)

| Var | Source | Purpose |
|---|---|---|
| `ASSEMBLYAI_API_KEY` | (already added) | AssemblyAI transcription |
| `ANTHROPIC_API_KEY` | (already in repo) | Claude notes generation |
| `SALES_COACHING_DATABASE_URL` | sales-coaching `.env` | call-transcriber + dashboard writes/reads |
| `SALES_COACHING_DATABASE_URL_UNPOOLED` | sales-coaching `.env` | applying migrations |
| `SALES_COACHING_PGHOST` | sales-coaching `.env` | individual conn fields if needed |
| `SALES_COACHING_PGHOST_UNPOOLED` | sales-coaching `.env` | individual conn fields |
| `SALES_COACHING_PGUSER` | sales-coaching `.env` | |
| `SALES_COACHING_PGDATABASE` | sales-coaching `.env` | |
| `SALES_COACHING_PGPASSWORD` | sales-coaching `.env` | |
| `GCS_BUCKET` | (set during Phase 0.4 sign-off) | `savvy-call-recordings` |
| `MIN_DURATION_SECONDS` | env-driven config | default 60 |
| `DAILY_COST_CAP_CENTS` | env-driven config | default 5000 ($50) |
| `PER_CALL_COST_CAP_CENTS` | env-driven config | default 50 ($0.50) |

### G.6 — Cross-repo coupling notes

**The dashboard now depends on sales-coaching's schema being stable.** Specifically:

- `call_notes` table existence + the columns this migration adds
- `reps` table for `rep_id` FK
- `sfdc_write_log` table for Phase 3 audit trail (writes, not just reads)

**Risk mitigation:**

1. Document the contract in BOTH repos' CLAUDE.md (dashboard + sales-coaching) — what columns the dashboard reads/writes from sales-coaching DB.
2. The migration file `009_extend_call_notes_for_kixie.sql` **lives in the sales-coaching repo** (correct ownership — they own their schema). The dashboard repo references it by path in this plan + in the call-transcriber package README.
3. Foreign key enforcement is one-directional: sales-coaching enforces FK from `call_notes.rep_id → reps.id`. The dashboard relies on this app-layer guarantee when looking up SGA names.

**Migration is ready to apply as written.** It drops NOT NULL on `granola_note_id`, `raw_granola_payload`, and `granola_web_url` (the Granola-required columns that don't apply to Kixie). The `call_notes_source_identity_check` constraint enforces source-appropriate non-null requirements for both rows: granola rows must have `granola_note_id` + `granola_web_url`; kixie rows must have `kixie_task_id` + `kixie_recording_url`. Existing Granola rows are unaffected because they already have those fields populated.

### G.7 — What `/work` should do differently because of this

When `/work` consumes this plan, the unit-level execution changes:

1. **Pre-flight:** apply migration `009_extend_call_notes_for_kixie.sql` in sales-coaching repo (one-time), gated on Phase 0 sign-off.
2. **Skip Unit 1.1 entirely.** Don't touch `prisma/schema.prisma` or write a `prisma/migrations/manual_*.sql`. The dashboard's Prisma stays as-is.
3. **In Unit 1.7 (call-transcriber package),** install `pg` not `@prisma/client`. The package's `node_modules` doesn't need the dashboard's Prisma generated client.
4. **In Unit 1.13 (writer),** use raw parameterized SQL via `pg.Pool`. Schema validation lives in TypeScript types written by hand from the migration's column list.
5. **In Phase 3,** import or vendor-copy the sales-coaching SFDC writeback module instead of building from scratch.

### G.8 — Smoke test artifact retention

`scripts/smoke-test-kixie-transcription.cjs` validated the architecture. Keep it in the repo as a **reproducible verification script** — useful for testing prompt changes, model migrations, and AssemblyAI provider swaps without spinning up the full pipeline. Document its usage in `packages/call-transcriber/README.md` once that package exists.

`tmp/smoke-test-*.{json,txt,md}` and `eleni-call-test.md` are gitignored / can be deleted at any time.


