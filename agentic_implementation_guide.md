# Agentic Implementation Guide — Kixie Call Transcription Pipeline

**Canonical plan:** `docs/plans/2026-04-27-001-feat-kixie-call-transcription-pipeline-plan.md`

This guide is a thin execution mapping over the plan file. The plan file contains the full unit specs (Goal / Files / Approach / Tests / Depends on / Patterns to follow / Verification). This guide adds the validation-gate framing /auto-feature expects: pre-flight checks, stop-and-report checkpoints, doc sync gate, and UI validation.

**Execution rule:** When this guide and the plan disagree, the **plan wins.** This guide is a sequencing aid.

---

## Pre-Flight (run before starting any phase)

```bash
npm run build 2>&1 | tee /tmp/preflight-build.log     # baseline green
npm test 2>&1 | tee /tmp/preflight-test.log
npx tsc --noEmit 2>&1 | tee /tmp/preflight-types.log
test ! -d packages/call-transcriber && echo "OK: not yet created"
ls node_modules/.prisma/client/index.d.ts && echo "OK: prisma client generated"
```

**STOP AND REPORT** if any fail. A red baseline blocks everything downstream.

---

## PHASE 1 — Dashboard Surface (UI-First Stub)

Maps to plan units 1.1 → 1.6.

### 1.A Prisma model + migration (Unit 1.1)

```bash
npx prisma generate
psql $DATABASE_URL -c "\d call_transcripts"
psql $DATABASE_URL -c "\d transcription_cost_daily"
npm run gen:models
```

**STOP AND REPORT** the `\d` outputs for both tables.

### 1.B BigQuery query update (Unit 1.2)

Schema-context MCP gate: call `describe_view` on `SavvyGTMData.Task` BEFORE writing SQL.

```bash
npx tsc --noEmit 2>&1 | grep -E "record-activity|ActivityRecord" || echo "OK"
npm test -- src/lib/queries/__tests__/record-activity.test.ts
```

Use `REGEXP_EXTRACT` and `@paramName` — never string interpolation. `Description` parsed but NOT returned to client (PII, payload size).

**STOP AND REPORT** sample API response showing `mp3RecordingUrl` populated for a known call.

### 1.C Activity API merge (Unit 1.3)

```bash
npx tsc --noEmit
npm test -- src/lib/queries/__tests__
curl http://localhost:3000/api/dashboard/record-detail/<id>/activity | jq '.activities[] | select(.mp3RecordingUrl != null) | .transcriptStatus'
# Expected: 'pending' for all (table empty in Phase 1)
```

### 1.D Markdown rendering (Unit 1.4)

```bash
npm install react-markdown remark-gfm
npx tsc --noEmit
npm test -- src/components/dashboard/__tests__/MarkdownNote.test.tsx
```

### 1.E Notes UI (Unit 1.5)

```bash
npx tsc --noEmit
npm test -- src/components/dashboard/__tests__/ActivityTimeline.test.tsx
npm run dev
```

**STOP AND REPORT — Manual UI check:**
- Open lead modal with answered outbound calls; rows show "AI notes not yet generated"
- Insert synthetic transcript via psql with realistic markdown
- Refresh; verify markdown renders headings + bullets in light + dark mode

### 1.F Doc sync (Unit 1.6)

```bash
npm run gen:all
npx agent-guard sync
git diff docs/
```

### Phase 1 ship gate
- [ ] `npm run build` exits 0
- [ ] `npm test` exits 0
- [ ] Manual UI check passed
- [ ] `agent-guard sync` clean
- [ ] No regressions in non-call activity rendering

---

## PHASE 2 — Backend Pipeline (Cloud Run Job)

Maps to plan units 2.1 → 2.11.

### 2.A Service skeleton (Unit 2.1)

```bash
mkdir -p packages/call-transcriber/src/prompts packages/call-transcriber/scripts packages/call-transcriber/queries
# mirror packages/analyst-bot/ shape
cd packages/call-transcriber && npm install && npm run build
docker build -t test-call-transcriber .
docker run --rm test-call-transcriber  # prints "starting", exits 0
```

### 2.B BQ poller (Unit 2.2)

Schema-context MCP gate.

```bash
npm test -- src/__tests__/bq-poller.test.ts
node dist/scripts/poll-test.js  # Print first 10 candidate task IDs
```

### 2.C GCS streaming (Unit 2.3)

```bash
npm test -- src/__tests__/gcs.test.ts
GCS_BUCKET=savvy-call-recordings-dev node dist/scripts/gcs-test.js
gsutil ls gs://savvy-call-recordings-dev/recordings/2026/04/<task-id>.mp3
```

### 2.D AssemblyAI client (Unit 2.4)

```bash
npm test -- src/__tests__/assemblyai-client.test.ts
ASSEMBLYAI_API_KEY=$(...) node dist/scripts/transcribe-test.js
# Output: diarized utterances with Speaker A / B labels
```

### 2.E Claude classifier + notes (Unit 2.5)

**Critical pre-step:** Verify discovery-notes prompt > 2048 tokens (Sonnet 4.6 caching threshold).

```bash
node -e "console.log('approx tokens:', (require('./dist/prompts/discovery-notes.js').DISCOVERY_NOTES_PROMPT.length / 4))"
npm test -- src/__tests__/notes-generator.test.ts
```

**STOP AND REPORT** generated notes for one canonical transcript. Verify:
- 9 sections present (when discovery)
- ≤2200 chars
- Verbatim numbers from transcript appear in notes
- Cache hit reported on second call (`cache_read_input_tokens > 0` in API response)

### 2.F Postgres writer (Unit 2.6)

```bash
npm test -- src/__tests__/db-writer.test.ts
# Idempotency: run twice, confirm one row, second call updates
```

### 2.G Orchestration + cost guard (Unit 2.7)

```bash
npm test -- src/__tests__/orchestration.test.ts
MAX_CALLS_PER_RUN=3 DAILY_COST_CAP_CENTS=100 PER_CALL_COST_CAP_CENTS=50 \
  node dist/index.js
# Expected: 3 rows in call_transcripts, daily cost aggregate increments
```

### 2.H Observability (Unit 2.8)

```bash
psql $DATABASE_URL -f packages/call-transcriber/queries/daily-health.sql
```

### 2.I Cloud Scheduler (Unit 2.9)

```bash
bash packages/call-transcriber/deploy.sh
gcloud scheduler jobs run call-transcriber-daily --location=us-east1
gcloud run jobs executions list --job=call-transcriber --region=us-east1 --limit=5
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="call-transcriber"' --limit=50
```

### 2.J Backfill + spot-check (Unit 2.10)

```bash
ts-node packages/call-transcriber/scripts/spot-check-archive.ts
# Output: status codes for 6mo / 15mo / 20mo URLs
# Operator picks cutoff, sets MIN_CREATED_DATE, runs backfill
gcloud run jobs execute call-transcriber --region=us-east1 \
  --set-env-vars BACKFILL_MODE=true,MAX_CALLS_PER_RUN=500,MIN_CREATED_DATE=<cutoff>,DAILY_COST_CAP_CENTS=10000
```

### 2.K Doc sync (Unit 2.11)

```bash
npx agent-guard sync
git diff docs/ CLAUDE.md
```

### Phase 2 ship gate
- [ ] Cloud Run Job deploys cleanly
- [ ] Cloud Scheduler triggers successfully 7 consecutive days
- [ ] >95% of attempted calls produce complete rows (excluding KIXIE_ARCHIVED)
- [ ] Daily cost stays under cap
- [ ] Backfill completes for verified date range with <5% error rate
- [ ] Generated notes appear in dashboard

---

## PHASE 3 — SFDC Writeback

Maps to plan units 3.1 → 3.5.

### 3.A SFDC custom field (Unit 3.1)

```bash
sf project deploy start --source-dir sfdc/objects/Task/fields/AI_Call_Notes__c.field-meta.xml --target-org savvy
TOKEN=$(sf org display --target-org savvy --json | jq -r '.result.accessToken')
INSTANCE=$(sf org display --target-org savvy --json | jq -r '.result.instanceUrl')
curl "${INSTANCE}/services/data/v66.0/sobjects/Task/describe" -H "Authorization: Bearer ${TOKEN}" | jq '.fields[] | select(.name == "AI_Call_Notes__c")'
```

### 3.B Writeback helper (Unit 3.2)

```bash
npm test -- packages/call-transcriber/src/__tests__/sfdc-writeback.test.ts
node dist/scripts/sfdc-test.js <task-id>
```

### 3.C Auto-trigger (Unit 3.3)

```bash
ENABLE_SFDC_WRITEBACK=true MAX_CALLS_PER_RUN=1 node dist/index.js
# Verify SFDC field populated; pushedToSfdcAt timestamp set
# Rerun confirms idempotency
```

### 3.D Admin button (Unit 3.4)

```bash
npx tsc --noEmit
npm test -- src/app/api/dashboard/admin/__tests__
```

### 3.E Doc sync (Unit 3.5)

```bash
npx agent-guard sync
git diff docs/
```

### Phase 3 ship gate
- [ ] `AI_Call_Notes__c` exists in SFDC
- [ ] Writeback worker populates field on new transcripts
- [ ] Idempotency verified
- [ ] Admin button works; non-admin button hidden
- [ ] FLS verified for SGA profile (test PATCH from non-admin token)

---

## Rules That Apply Throughout

- Schema-context MCP first before any BigQuery SQL change (CLAUDE.md hard gate)
- `@paramName` parameterization only — never string interpolation
- Manual migrations as `prisma/migrations/manual_<description>.sql`
- Import merge — never add second import from same module
- Construction sites — add new required fields to all of them
- Doc sync before each commit
- `.ai-session-context.md` written before every commit (CLAUDE.md Wrike rule)
- No retroactive prompt caching on existing code; only new transcriber package adopts it

---

## Failure Modes

- Prisma client not regenerating: `rm -rf node_modules/.prisma && npm install`
- AssemblyAI 401: secret not in Cloud Run Job — re-run `deploy.sh` with `--set-secrets`
- Claude 429: retry helper handles; if persistent, lower `MAX_CALLS_PER_RUN`
- GCS OOM: confirm `pipeline()` streaming, not `response.buffer()`
- Kixie 403: expected for archived recordings; row written with `KIXIE_ARCHIVED` error state, pipeline continues
- Daily cost cap exceeded mid-run: job logs the abort cleanly and exits 0 (guardrail, not failure)

---

## Refinement Log

(Populated by /auto-feature Phase 4 after council triage.)
