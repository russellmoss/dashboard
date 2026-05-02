# Code Inspector Findings — Kixie Call Transcription Pipeline

Generated: 2026-04-27. Synthesis from prior /plan research, not a fresh agent run. Per user instruction, parallel exploration was not re-executed during /auto-feature.

Source plan: `docs/plans/2026-04-27-001-feat-kixie-call-transcription-pipeline-plan.md`.

## Files That Need New Fields or Modification

### TypeScript types
- `src/types/record-activity.ts` — extend `ActivityRecord` and `ActivityRecordRaw` with new optional fields: `mp3RecordingUrl`, `notesMarkdown`, `notesGeneratedAt`, `callTypeClassification`, `transcriptStatus`.

### Construction sites for ActivityRecord
- `src/lib/queries/record-activity.ts:278` — `transformActivityRecord()` — single construction site. Plan adds new fields here.

### Query layer
- `src/lib/queries/record-activity.ts:140-263` — BQ SQL block; add `Description` to SELECT and `REGEXP_EXTRACT` for kixie URL.
- `src/lib/queries/call-transcripts.ts` — NEW; `getTranscriptsByTaskIds(taskIds)` returning a Map.

### API routes
- `src/app/api/dashboard/record-detail/[id]/activity/route.ts` — merge Postgres CallTranscript data into BQ activity response.
- `src/app/api/dashboard/admin/push-call-notes-to-sfdc/route.ts` — NEW (Phase 3 admin endpoint).

### Components
- `src/components/dashboard/ActivityTimeline.tsx:180-261` — extend ActivityItem with second collapsible Notes section. Reuse ChevronDown/Up pattern at lines 242-255.
- `src/components/dashboard/MarkdownNote.tsx` — NEW.

### Prisma + migrations
- `prisma/schema.prisma` — add `CallTranscript` model + `TranscriptionCostDaily` model.
- `prisma/migrations/manual_add_call_transcripts.sql` — NEW.
- `prisma/migrations/manual_add_transcription_costs.sql` — NEW.

### New service package (Phase 2)
- `packages/call-transcriber/` — NEW; mirrors `packages/analyst-bot/`.
- Source files: `index.ts`, `bq-poller.ts`, `gcs.ts`, `assemblyai-client.ts`, `claude-client.ts`, `notes-generator.ts`, `db-writer.ts`, `cost-guard.ts`, `sfdc-writeback.ts`, `logger.ts`, `prompts/*.ts`.
- Config: `package.json`, `tsconfig.json`, `Dockerfile`, `cloudbuild.yaml`, `deploy.sh`, `.env.example`, `README.md`.

### SFDC metadata (Phase 3)
- `sfdc/objects/Task/fields/AI_Call_Notes__c.field-meta.xml` — NEW field (Long Text Area, 32768).
- `sfdc/profiles/Sales_Growth_Associate.profile-meta.xml` — modify (add edit FLS).
- `sfdc/profiles/SystemAdministrator.profile-meta.xml` — modify if needed.

## Construction Site Completeness

Only one TypeScript construction site for ActivityRecord exists (record-activity.ts:278). Postgres-merge happens in the API route as a mutation, intentionally avoiding a second construction site. CallTranscript is Prisma-managed — type safety enforced by the generated client.

## Existing Patterns to Reuse

| Pattern | Location | Use For |
|---|---|---|
| Lazy singleton SDK client | `packages/analyst-bot/src/claude.ts:19-32` | AssemblyAI + Claude clients |
| `withRetry<T>(fn, 3)` | `src/lib/wrike-client.ts:98-130` | All external API calls |
| Typed error class | `src/lib/wrike-client.ts:10-19` | KixieArchivedError, TranscriptionError |
| Prisma upsert on `@@unique` | `src/lib/queries/weekly-goals.ts:75-80` | Idempotent CallTranscript writes |
| ChevronDown/Up expand | `src/components/dashboard/ActivityTimeline.tsx:242-255` | Notes UI |
| Empty-state UI | `src/components/dashboard/ExploreResults.tsx:194-204` | "Notes not yet generated" |
| Prompt template literals | `src/lib/reporting/prompts/*.ts` | discovery-notes.ts, classifier.ts |

## Gaps (No Repo Precedent)

| Gap | Plan Strategy |
|---|---|
| `@google-cloud/storage` | Build from scratch using official `pipeline()` pattern |
| `@google-cloud/secret-manager` | Use Cloud Run native `--set-secrets` instead — no client needed |
| External API spend cap | Build first one in repo (cost-guard.ts) |
| SFDC writeback (REST PATCH) | Build from scratch; reuse `sf org display` token pattern |
| `react-markdown` | Install + new shared component |
| Long-running async job (>5 min) | Cloud Run Job (no Vercel route can hold it) |
| Prompt caching | Add to new code; existing repo doesn't use it |

## Test Patterns

- Jest 30 + ts-jest 29.
- No BigQuery mocking infrastructure — tests mock `@google-cloud/bigquery` directly.
- Existing tests in `src/lib/__tests__/` and `src/lib/semantic-layer/__tests__/`.

## Monorepo Structure

Root `package.json` has NO `workspaces` field. `packages/analyst-bot/` and `mcp-server/` are independent packages with their own `node_modules`, deployed via their own `cloudbuild.yaml`. New `packages/call-transcriber/` follows the same pattern.

Prisma schema is at the repo root — the new service package needs to either copy `prisma/schema.prisma` into its build context or generate the client from a relative path. Document in the new package's README.
