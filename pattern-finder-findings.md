# Pattern Finder Findings — Kixie Call Transcription Pipeline

Generated: 2026-04-27. Synthesis from prior /plan research, plus integration-researcher external-docs findings (merged here since /auto-feature has 3 agent slots, not 4).

Source plan: `docs/plans/2026-04-27-001-feat-kixie-call-transcription-pipeline-plan.md`.

## Established Patterns to Follow

### Cloud Run service package shape

Reference: `packages/analyst-bot/`

- Self-contained `package.json`; no workspace linking
- Single-stage `Dockerfile` based on `node:20-slim`
- **Manual cache-bust line** in Dockerfile (line 21): `RUN echo "source-bust-YYYYMMDD-description"` — bump on each deploy
- `cloudbuild.yaml`: two steps — `docker build --no-cache` → `docker push`
- `deploy.sh`: `set -euo pipefail`, `gcloud builds submit`, then `gcloud run deploy --image=...` (image-only deploy preserves secrets)
- Runtime deps in `dependencies`; only typescript + types in `devDependencies`
- CMD: `node dist/index.js`

### Prisma + migrations

- Schema at `prisma/schema.prisma`
- Manual migrations: `prisma/migrations/manual_<description>.sql` — no timestamp folders
- Run manually against Neon (avoid `prisma migrate dev` shadow-DB)
- Json columns: `as unknown as ConcreteType` cast at read
- `@@map("snake_case")` for table aliasing
- Idempotency: `@@unique` + `prisma.x.upsert({ where: { col1_col2: {...} } })` (see weekly-goals.ts:75-80)

### External API client wrapper

Reference: `src/lib/wrike-client.ts:10-130`

```typescript
class WrikeAPIError extends Error {
  statusCode: number;
  isRateLimited: boolean;
  retryAfter?: number;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (attempt === maxRetries - 1) throw e;
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}
```

Lazy singleton init like `packages/analyst-bot/src/claude.ts:19-32`.

### Anthropic SDK call

Reference: `packages/analyst-bot/src/claude.ts`

- Lazy singleton `getClient()` with env var guard
- `anthropic.messages.create(...)` for plain calls
- `anthropic.beta.messages.create(...)` with MCP betas for agent mode
- Retry loop with exponential backoff (lines 71-113)
- **No prompt caching anywhere in repo currently** — we add it. Sonnet 4.6 needs >2048 system tokens to activate.

### BigQuery query style

Reference: `src/lib/queries/record-activity.ts`, `src/lib/semantic-layer/query-templates.ts`

- ALWAYS `@paramName` parameterization
- `cachedQuery()` wrapper for read paths
- snake_case in SQL → camelCase via transform function
- COALESCE for nullable fields with sensible defaults
- `extractDate()` for display, `extractDateValue()` for comparisons

### Polling pattern

Reference: `src/app/dashboard/reports/components/ReportProgress.tsx:27-40`

- `setInterval(pollFn, 3000)` with `resolvedRef = useRef(false)` dual-guard
- For Cloud Run Job context, AssemblyAI SDK polls internally — we configure `pollingInterval` not write the loop

### Empty-state UI

Reference: `src/components/dashboard/ExploreResults.tsx:194-204`

```tsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <Icon className="w-12 h-12 text-gray-400 mb-4" />
  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">Title</h3>
  <p className="text-gray-500 dark:text-gray-400 max-w-md">Body</p>
</div>
```

### Collapsible expand pattern

Reference: `src/components/dashboard/ActivityTimeline.tsx:242-255`

```tsx
const [expanded, setExpanded] = useState(false);

<button onClick={() => setExpanded(!expanded)}>
  {expanded ? <ChevronUp /> : <ChevronDown />}
  Label
</button>
{expanded && (
  <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap">{content}</div>
)}
```

Use SECOND `useState` for Notes expand — independent of SMS preview.

### Prompt templates

Reference: `src/lib/reporting/prompts/*.ts`

- TypeScript template literals, not markdown files
- Named export: `export const PROMPT_NAME = \`...\``
- Versioning: bump `PROMPT_VERSION` constant

## Date / NULL / Type Coercion

- `extractDate()` (`src/lib/utils/date-helpers.ts`) for display
- `extractDateValue()` for comparisons
- `toString(raw.field)` / `toNumber(raw.field)` from `src/lib/utils/bigquery-raw.ts`
- COALESCE with empty string for required strings, NULL for optional

## CSV Export Patterns

- **ExportButton** auto-includes via `Object.keys()`
- **ExportMenu / MetricDrillDownModal** explicit column mappings, manual update needed

For this feature: new fields are modal-only, no CSV export touched. Flag if council disagrees.

## External SDK Versions (verified during /plan)

| Package | Version | Use |
|---|---|---|
| `assemblyai` | 4.32.1 | Transcription |
| `@anthropic-ai/sdk` | 0.71.2 (in repo) | Notes generation |
| `@google-cloud/storage` | 7.19.0 | GCS upload |
| `@google-cloud/bigquery` | (in repo) | BQ poll |
| `@prisma/client` | (in repo) | Postgres |

## External API Notes

### AssemblyAI

- `client.transcripts.transcribe({ audio: <url>, speaker_labels: true })` — submit-by-URL works against public Kixie URLs
- Diarization returns `utterances[]` with `speaker: 'A'|'B'|...`, `text`, `start` (ms), `end` (ms), `confidence`
- Cost: $0.17/hr Universal-2 + diarization
- File limits: 5GB, 10hr URL-based; 2.2GB upload-based
- Concurrent: 5 free, 200+ paid
- **LeMUR deprecated March 31, 2026** — DO NOT USE
- SDK README warns against scale (>5K calls/run); below threshold today

### Claude prompt caching (Sonnet 4.6)

```typescript
system: [{
  type: "text",
  text: LONG_SYSTEM_PROMPT,
  cache_control: { type: "ephemeral" }  // 5-min, free refresh; or { ttl: "1h" } at 2x write cost
}]
```

- Min 2048 tokens for caching to activate (silently no-op below)
- Cache reads: 0.1× base price (90% reduction)

### GCS streaming upload

```typescript
import { pipeline } from "stream/promises";
const file = storage.bucket(BUCKET).file(`recordings/${callId}.mp3`);
const response = await fetch(kixieUrl);
await pipeline(response.body, file.createWriteStream({ contentType: "audio/mpeg" }));
```

ADC auth on Cloud Run; no key file. Pattern from `@google-cloud/storage` samples.

### Salesforce REST PATCH (Phase 3)

```bash
curl -X PATCH "${INSTANCE}/services/data/v66.0/sobjects/Task/${ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"AI_Call_Notes__c": "..."}'
```

Returns 204. The `sf data query` CLI bug doesn't affect REST PATCH.

For unattended writes: **JWT bearer flow** (signed JWT with cert key) recommended over stored access tokens. Phase 3 design decision.

## Cloud Run Job vs Service vs Vercel Cron — Decision

| Option | Max Timeout | Verdict |
|---|---|---|
| **Cloud Run Job** | 7 days/task | **CHOSEN** — batch, scheduled, no inbound HTTP needed |
| Cloud Run Service | 1 hour/request | Rejected — overkill (Pub/Sub, push complexity) |
| Vercel Cron Hobby | 5 min | Rejected — too short |
| Vercel Cron Pro | ~13 min (800s) | Rejected — too short for batch |

Cloud Run Job free tier (240K vCPU-sec/mo) covers 1,300 calls/mo at ~10 min wall time = 130K vCPU-sec/mo.

## Idempotency Pattern

```typescript
await prisma.callTranscript.upsert({
  where: { taskId },
  create: { taskId, ... },
  update: { ... }
});
```

Mirrors `weekly-goals.ts:75-80`. Phase 3 SFDC writeback adds `pushedToSfdcAt IS NULL` pre-check.

## Cost Cap Pattern (NEW — no precedent)

`cost-guard.ts`:
- `getDailyCostCents()`: read aggregate
- `canAffordCall(estimatedCents)`: pre-check
- `recordCall(actualCents)`: atomic increment via Prisma
- Throws `CostCapExceededError` to abort cleanly

Mirrors BQ `maximumBytesBilled: 1_073_741_824` pattern but for external API spend.

## Inconsistencies / Gaps

- No prompt caching today — opportunity for new code, not a regression
- No spend cap pattern today — building first one
- No GCS code today — designing from scratch
- No SFDC writeback today — designing from scratch
- No markdown rendering today — adding `react-markdown` for Phase 1
- BQ-touching code has light test coverage — accept, don't retrofit mocks

None block the plan. Flagged for council to weigh in on whether they imply additional risk.
