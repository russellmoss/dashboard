# Exploration Results — Kixie Call Transcription Pipeline

Generated: 2026-04-27.

## Pre-Flight Summary

We're building a 3-phase pipeline that takes Kixie call recordings (mp3 URLs already sitting in Salesforce Task descriptions), transcribes them with speaker diarization via AssemblyAI, generates a structured 9-section "Advisor Note Doc" with Claude Sonnet 4.6, and surfaces those notes in the dashboard's activity tab — eventually pushing them back to a new Salesforce Task field. There are 6,222 candidate calls in the last 18 months (53% are <60s and get skipped). Total backfill cost ~$290; ongoing ~$60-100/month. The code lives in three places: a Postgres table + dashboard UI changes (Phase 1), a new Cloud Run Job in `packages/call-transcriber/` (Phase 2), and Salesforce field metadata + REST PATCH writeback (Phase 3). The seed plan is `docs/plans/2026-04-27-001-feat-kixie-call-transcription-pipeline-plan.md` — that's the artifact council reviews and refinements get applied to. **The /plan skill already ran full parallel exploration before this auto-feature run** — exploration was not re-executed. The findings files in this directory are syntheses from that prior research.

## BigQuery Status

✅ **All required fields exist and are populated.**

| Field | Status |
|---|---|
| `SavvyGTMData.Task.Subject` | OK — used as the "answered outbound" filter (`LIKE 'answered:%'`) |
| `SavvyGTMData.Task.Description` | OK — 100% kixie URL coverage on answered outbound calls (last 30d sample) |
| `SavvyGTMData.Task.CallDurationInSeconds` | OK — used to filter <60s voicemails |
| `SavvyGTMData.Task.Type / TaskSubtype` | OK — `'Call'` value |
| `SavvyGTMData.Task.WhoId` | 93.3% populated — join to vw_funnel_master |

❌ **Critical gotcha caught:** `CallDisposition` is NULL on 100% of rows. The user's seed assumption was wrong. Plan filter is now `LOWER(Subject) LIKE 'answered:%'` — verified, 100% kixie-URL coverage.

⚠️ **Unverified risk:** Kixie's claimed 18-month archive cutoff could not be confirmed from public docs (help center pages returned empty). Plan Unit 2.10 includes an empirical HEAD-request spot-check before backfill commits.

⚠️ **Funnel match rate is 73%, not 95%+.** Doesn't block transcription (transcripts key on Task.Id, not funnel record), but limits analytics enrichment.

**No view modifications needed.**

## Files to Modify / Create

### Phase 1 (dashboard surface)
- `prisma/schema.prisma` — add `CallTranscript` + `TranscriptionCostDaily` models
- `prisma/migrations/manual_add_call_transcripts.sql` (NEW)
- `prisma/migrations/manual_add_transcription_costs.sql` (NEW)
- `src/lib/queries/record-activity.ts` — Description + regex extract
- `src/lib/queries/call-transcripts.ts` (NEW)
- `src/types/record-activity.ts` — extend ActivityRecord
- `src/app/api/dashboard/record-detail/[id]/activity/route.ts` — merge Postgres
- `src/components/dashboard/ActivityTimeline.tsx` — collapsible Notes section
- `src/components/dashboard/MarkdownNote.tsx` (NEW)
- `package.json` — `react-markdown` + `remark-gfm`

### Phase 2 (Cloud Run Job — new package)
- `packages/call-transcriber/{package.json, tsconfig.json, Dockerfile, cloudbuild.yaml, deploy.sh, .env.example, README.md}` (all NEW)
- `packages/call-transcriber/src/{index, bq-poller, gcs, assemblyai-client, claude-client, notes-generator, db-writer, cost-guard, logger}.ts` (NEW)
- `packages/call-transcriber/src/prompts/{classifier, discovery-notes, general-notes}.ts` (NEW)
- `packages/call-transcriber/scripts/spot-check-archive.ts` (NEW)
- `packages/call-transcriber/queries/daily-health.sql` (NEW)

### Phase 3 (SFDC writeback)
- `sfdc/objects/Task/fields/AI_Call_Notes__c.field-meta.xml` (NEW)
- `sfdc/profiles/Sales_Growth_Associate.profile-meta.xml` (modify)
- `sfdc/profiles/SystemAdministrator.profile-meta.xml` (modify if needed)
- `packages/call-transcriber/src/sfdc-writeback.ts` (NEW)
- `packages/call-transcriber/src/index.ts` — extend with optional writeback call
- `src/app/api/dashboard/admin/push-call-notes-to-sfdc/route.ts` (NEW)
- `src/components/dashboard/ActivityTimeline.tsx` — admin "Push to SFDC" button

### Documentation
- `docs/ARCHITECTURE.md` — Database Models entry + Cloud Run service entry
- `CLAUDE.md` — call-transcriber row in GCP services table
- `docs/_generated/{prisma-models, api-routes}.md` (regen)

## Type Changes

### `src/types/record-activity.ts`

Add to `ActivityRecord`:
```ts
mp3RecordingUrl?: string | null;
notesMarkdown?: string | null;
notesGeneratedAt?: string | null;
callTypeClassification?: string | null;
transcriptStatus?: 'none' | 'pending' | 'completed' | 'error';
```

Add to `ActivityRecordRaw`:
```ts
mp3_recording_url?: string | null;  // from BQ REGEXP_EXTRACT
```

### `prisma/schema.prisma`

Add `CallTranscript` + `TranscriptionCostDaily` models — see plan Unit 1.1 for full field list.

## Construction Site Inventory

**ActivityRecord:** 1 site
- `src/lib/queries/record-activity.ts:278` — `transformActivityRecord()`

**CallTranscript:** Prisma-managed
- `prisma.callTranscript.upsert()` in `packages/call-transcriber/src/db-writer.ts` (NEW)
- `prisma.callTranscript.findMany()` in `src/lib/queries/call-transcripts.ts` (NEW, read only)
- `prisma.callTranscript.update()` in `packages/call-transcriber/src/sfdc-writeback.ts` (NEW)

Postgres-merge in API route is intentionally a mutation post-construction, not a second construction site.

## Recommended Phase Order

Phase 1 → Phase 2 → Phase 3 (sequential, each independently shippable).

**Within Phase 1:** Unit 1.1 (Prisma) ‖ 1.2 (BQ) → 1.3 (API merge depends on 1.1) → 1.4 (markdown dep) → 1.5 (UI) → 1.6 (doc sync).

**Within Phase 2:** Unit 2.1 (skeleton) → 2.2-2.6 in parallel → 2.7 orchestration → 2.8-2.11 ops + observability.

**Phase 3:** Sequential — small phase, no parallelism worth noting.

## Risks and Blockers

| # | Risk | Severity | Plan Mitigation |
|---|---|---|---|
| R1 | Kixie 18-month archive policy unverified | MEDIUM-HIGH | Spot-check (Unit 2.10) before backfill |
| R2 | Generated notes hallucinate verbatim numbers | HIGH | Prompt instructs "verbatim only"; snapshot tests |
| R3 | AssemblyAI SDK warns against scale >5K/mo | MEDIUM | Below threshold today; swap to direct REST if grows |
| R4 | Claude prompt cache silently no-ops <2048 tokens | MEDIUM | Verify token count; pad with detailed schema |
| R5 | SFDC profile FLS blocks writeback | MEDIUM | Phase 3 modifies profiles; verify before declaring done |
| R6 | Cost overrun on backfill | LOW | Cost guard aborts on daily cap |
| R7 | Funnel match rate 73% — analytics gap | LOW | Doesn't block; flag in observability |
| R8 | Concurrent runs double-process | LOW | Postgres unique constraint + upsert |
| R9 | No existing pattern for SFDC unattended auth | MEDIUM | Phase 3 — JWT bearer flow recommended |

## Open Questions (carried from /plan)

1. Min-duration threshold (60s default proposed)
2. SFDC field name (`AI_Call_Notes__c` proposed)
3. Daily cost caps ($50 daily / $300 backfill proposed)
4. Backfill scope (full 18 months, or shorter?)
5. Cloud Scheduler timing (07:00 UTC = 02:00 EST proposed)
6. GCS recording retention (indefinite, or auto-delete after N months?)

These are surfaced to council for opinion in Phase 3.

## Note on /auto-feature scope fit

The /auto-feature skill was originally designed for dashboard features that fit a single-package, TypeScript-types-and-construction-sites mental model. This feature spans **3 packages** (root dashboard, packages/call-transcriber, sfdc/) and includes infrastructure work (Cloud Run Job, GCS bucket, SFDC custom field). The skill's Phase 7 "construction sites" framing applies cleanly to Phase 1 only.

The plan file is the canonical artifact. The `agentic_implementation_guide.md` produced in /auto-feature Phase 2 is a thin pointer to the plan (not a re-derivation of it). All council feedback and refinements get applied to the plan file directly.
