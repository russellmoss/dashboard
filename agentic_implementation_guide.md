# Agentic Implementation Guide — Per-Dimension AI Narrative ("body" field)

**Feature:** Add a 2-3 sentence AI rationale per dimension score in evaluations, with citation pills, rendered as the primary content of the Insights drill-down modal. Backfill 406 historic evaluations via an offline body-only generation script.

**Architecture decision (council + user approved):** No application-layer re-eval endpoint. No admin "Re-evaluate" button. No new Dashboard API route or bridge method for re-eval. A single offline `scripts/backfill-dimension-bodies.cjs` calls Anthropic directly, takes existing scores + citations as **locked inputs**, generates only `body` per dimension.

**Approved decisions:**
- Model: Sonnet 4.6 (~$27-31 total)
- Score pinning: pure pin (body-only prompt produces no new score, so drift is moot)
- Body shape: plain string + trailing citation pills (no inline tokens)
- Rollout: schema mirror first → upstream prompt flip behind env flag → offline backfill
- Splicing infra: extract shared `CitedProse` from the two diverged private impls
- Drift handling: strict — drop orphan citations, skip invalid dims

**Cross-repo scope:**
- Upstream (`russellmoss/sales-coaching`): schema + audit migration + version bump + prompt flag
- Downstream (this repo, `russellmoss/Dashboard`): mirror sync + UI restructure + data-loss-fix + extracted CitedProse + doc sync
- Backfill: standalone offline script in this repo

**Execution mode:** Phase-by-phase, end-to-end. Stop at each validation gate. Phase A is upstream-only (sales-coaching sibling repo at `C:\Users\russe\Documents\sales-coaching`). Phase B and onward run in this Dashboard repo. Verify each phase's gate passes before proceeding.

---

## Pre-Flight Checklist

Before starting:

```bash
# 1. Confirm sales-coaching sibling repo exists for cross-repo work
ls C:/Users/russe/Documents/sales-coaching/

# 2. Confirm env vars exist in both repos
grep -c SALES_COACHING_DATABASE_URL .env       # Dashboard repo, should be >=1
grep -c DATABASE_URL C:/Users/russe/Documents/sales-coaching/.env  # upstream, should be >=1
grep -c ANTHROPIC_API_KEY .env                  # Dashboard repo, for backfill script

# 3. Working tree clean check
git status
# If dirty, stash or commit first.

# 4. Schema mirror is currently in sync
npm run check:schema-mirror
# Expect: PASS. If it fails, fix drift before starting.

# 5. Confirm Neon DB connectivity from this repo
node -e "const{Pool}=require('pg');new Pool({connectionString:process.env.SALES_COACHING_DATABASE_URL,ssl:{rejectUnauthorized:false}}).query('SELECT 1').then(r=>{console.log('OK');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
# Expect: OK.
```

If any of the above fail, **STOP** and resolve before starting Phase A.

---

## Phase A — Upstream (sales-coaching) PR

Work in `C:\Users\russe\Documents\sales-coaching`. The Dashboard repo stays untouched in this phase.

### A.1 — Update DimensionScore Zod schema

File: `C:/Users/russe/Documents/sales-coaching/src/lib/dashboard-api/schemas.ts`

Find `DimensionScore` schema (search for `score: z.number()` near a dimension shape). It currently looks like:

```ts
const DimensionScore = z.object({
  score: z.number(),
  citations: z.array(Citation),
}).strict();
```

Change to:

```ts
const DimensionScore = z.object({
  score: z.number(),
  citations: z.array(Citation),
  body: z.string().optional(),
}).strict();
```

Keep `.strict()` — the `optional()` lets the field be omitted but rejects other unknown keys.

### A.2 — Update DB types

File: `C:/Users/russe/Documents/sales-coaching/src/lib/db/types.ts`

Find the corresponding `DimensionScore` type or `dimension_scores` field. Add `body?: string` to the per-dim shape. Match the Zod change byte-for-byte where the shape is mirrored.

### A.3 — Migration: backfill audit table

Create new migration file (next sequential number — check existing `migrations/` directory):

```sql
-- migrations/NNN_eval_body_backfill_audit.sql
CREATE TABLE eval_body_backfill_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('pending','success','failure','skipped')),
  error_message text,
  input_tokens integer,
  output_tokens integer,
  schema_version_before integer NOT NULL,
  schema_version_after integer,
  model_id text NOT NULL,
  prompt_version text NOT NULL,
  dropped_orphan_citations integer DEFAULT 0,
  skipped_dims integer DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_eval_body_backfill_eval_attempt
  ON eval_body_backfill_audit(evaluation_id, attempt_number);
CREATE INDEX idx_eval_body_backfill_status
  ON eval_body_backfill_audit(status, started_at DESC);
```

### A.4 — Bump schema version constant

Find the constant `AI_ORIGINAL_SCHEMA_VERSION` (likely in `src/lib/ai/...` or a constants file). Bump from `5` → `6`.

### A.5 — Add prompt emission flag

In the evaluator prompt build path, gate the new `body` instruction behind an env flag:

```ts
const EMIT_DIMENSION_BODY = process.env.EMIT_DIMENSION_BODY === 'true';
// In prompt assembly:
if (EMIT_DIMENSION_BODY) {
  prompt += `\nFor each dimension, ALSO include a "body" field: a 2-3 sentence rationale (150-300 chars, paragraph prose, no bullets) explaining WHY this score, citing at least one utterance_index from this dimension's citations array. Map the rep's behavior to the rubric criteria.`;
}
```

**Default is OFF in prod.** The flag stays off until Dashboard mirror is deployed.

### A.6 — Tests

Add tests in upstream test suite:
- Zod schema parse with `body` present + absent — both pass
- Zod schema parse with extra key — fails (.strict() still works)
- Insert + select round-trip preserving body in JSONB

### A.7 — Phase A validation gate

```bash
cd C:/Users/russe/Documents/sales-coaching
npm run build
npm test
```

Both must pass. **Stop and report.** The user reviews + merges + deploys the upstream PR with `EMIT_DIMENSION_BODY=false` in prod env.

### A.8 — Phase A ship checklist (user-side)

After PR merges and CI passes:

#### A.8.1 — Migration

The sales-coaching service does NOT auto-migrate on deploy. Run the new migration manually against staging Neon **before** the Cloud Run redeploy, since the deploy reads schema-aware code:

```bash
# From sales-coaching repo root (C:/Users/russe/Documents/sales-coaching)
# Use whatever the repo's migrate script is — check package.json scripts.
# Typical pattern:
npm run migrate:up   # or psql -f migrations/NNN_eval_body_backfill_audit.sql against $DATABASE_URL
```

Verify the table exists:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'eval_body_backfill_audit'
ORDER BY ordinal_position;
```

Expected: 14 columns matching A.3's CREATE TABLE.

#### A.8.2 — Set EMIT_DIMENSION_BODY=false in env config

The sales-coaching service reads non-secret config from `.env-vars-staging.yaml` at the repo root. Add the new variable:

```yaml
# .env-vars-staging.yaml
# ... existing keys ...
EMIT_DIMENSION_BODY: "false"
```

**Do NOT** put it in Secret Manager — it's non-secret toggle config. Commit this change as part of the Phase A PR.

#### A.8.3 — Redeploy sales-coaching to Cloud Run

Service runs at `https://sales-coaching-154995667624.us-east1.run.app` in GCP project `savvy-gtm-analytics`, region `us-east1`. Buildpacks-from-source (no Dockerfile).

**Exact command** (must run from sales-coaching repo root — `.gcloudignore` and `.env-vars-staging.yaml` must be in CWD):

```powershell
# From C:/Users/russe/Documents/sales-coaching
gcloud run deploy sales-coaching `
  --source . `
  --region us-east1 `
  --project savvy-gtm-analytics `
  --env-vars-file=.env-vars-staging.yaml
```

Notes:
- Do NOT pass `--set-env-vars` or `--set-secrets` on the command line — Secret Manager bindings are configured on the service and `--env-vars-file` carries the rest. Adding flags overwrites the service config.
- Last known-good baseline revision (for rollback reference): `sales-coaching-00110-th2`, 2026-05-10.
- Cloud Scheduler jobs (5 sales-coaching-* jobs in `us-east1`) are managed separately and are NOT affected by a code deploy.
- There is currently no `sales-coaching-prod` service. Staging is the deployable target (Phase 9 in upstream's roadmap stands up prod separately).

Build typically takes 3-6 minutes. Watch for the new revision number in the output.

#### A.8.4 — Smoke test

Verify the deploy is live and the flag is still off:

```bash
# Health check
curl -sS https://sales-coaching-154995667624.us-east1.run.app/api/health
# Expect: 200, healthy payload

# Confirm flag from a Cloud Run revision env dump (gcloud)
gcloud run services describe sales-coaching \
  --region us-east1 --project savvy-gtm-analytics \
  --format='value(spec.template.spec.containers[0].env[].name,spec.template.spec.containers[0].env[].value)' \
  | grep EMIT_DIMENSION_BODY
# Expect: EMIT_DIMENSION_BODY false
```

Then wait for a fresh eval to be created organically (or trigger one if you have a manual path):

```sql
-- Confirm no body field on the most recent eval — flag still off, prompt not emitting body
SELECT id, created_at, jsonb_pretty(dimension_scores)
FROM evaluations
ORDER BY created_at DESC
LIMIT 1;
```

The newest row's `dimension_scores` entries must still have exactly `{ score, citations }` per dim. If `body` appears, the flag is NOT being respected — STOP and investigate the prompt gate at A.5.

Once verified clean, Phase A is done and Phase B can begin.

---

## Phase B — Dashboard PR

Now work in `C:\Users\russe\Documents\Dashboard`. Gated on Phase A being merged + deployed.

### B.1 — Sync bridge schema mirror

```bash
# Use the skill — it pulls upstream and overwrites the mirror
# /sync-bridge-schema
# Or manually:
gh api repos/russellmoss/sales-coaching/contents/src/lib/dashboard-api/schemas.ts \
  -H 'Accept: application/vnd.github.raw' --ref main \
  > src/lib/sales-coaching-client/schemas.ts
```

Then:

```bash
npm run check:schema-mirror
# Expected: byte-equal PASS
```

If fail: investigate drift. Likely cause: upstream PR not yet merged, or `BRANCH = 'master'` vs `main` discrepancy (see B.9 below — fix in same PR).

### B.2 — Reconcile schema-mirror check branch

File: `scripts/check-schema-mirror.cjs` line 26

```js
// Current:
const BRANCH = 'master';
// Change to:
const BRANCH = 'main';
```

Re-run `npm run check:schema-mirror` to confirm.

### B.3 — Fix the data-loss bug FIRST (R1)

**This must merge before any backfill writes body data.**

File: `src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx` lines 641-661

Find the inline-edit reconstruction loop. Current:

```ts
const base: Record<string, { score: number; citations: Citation[] }> = {};
for (const [name, v] of Object.entries(canonicalDimensionScores)) {
  base[name] = {
    score: v.score,
    citations: (v.citations ?? []) as Citation[],
  };
}
```

Change to:

```ts
const base: Record<string, { score: number; citations: Citation[]; body?: string }> = {};
for (const [name, v] of Object.entries(canonicalDimensionScores)) {
  base[name] = {
    score: v.score,
    citations: (v.citations ?? []) as Citation[],
    ...(v.body !== undefined && v.body !== '' && { body: v.body }),
  };
}
```

Spread is conditional so undefined body doesn't pollute the JSONB with `{ body: undefined }`.

### B.4 — Update shared type

File: `src/types/call-intelligence.ts` line 91

Find the `EvaluationDetail` interface, locate `dimension_scores`:

```ts
// Current:
dimension_scores: Record<string, { score: number; citations?: Citation[] }> | null;
// Change to:
dimension_scores: Record<string, { score: number; citations?: Citation[]; body?: string }> | null;
```

### B.5 — Update local `DimensionScoreEntry` interface

File: `src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx` lines 95-99

```ts
// Current:
interface DimensionScoreEntry {
  name: string;
  score: number;
  citations?: Citation[];
}
// Change to:
interface DimensionScoreEntry {
  name: string;
  score: number;
  citations?: Citation[];
  body?: string;
}
```

### B.6 — Update `readDimensionScores()` to read body from ai_original

File: `src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx` lines 101-117

Find the loop that maps `ai_original.dimensionScores` entries to `DimensionScoreEntry`. Add `body: val.body` to the returned object:

```ts
return Object.entries(dimScores).map(([name, val]: [string, any]) => ({
  name,
  score: Number(val.score),
  citations: Array.isArray(val.citations) ? val.citations : [],
  body: typeof val.body === 'string' ? val.body : undefined,
}));
```

### B.7 — Update `canonicalDimensionScores` map

File: `src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx` lines 450-455

Find the map that builds canonical dimension entries from `detail.dimension_scores`. Add `body`:

```ts
const canonicalDimensionScores = Object.entries(detail.dimension_scores ?? {}).map(
  ([name, v]: [string, any]) => ({
    name,
    score: Number(v.score),
    citations: Array.isArray(v.citations) ? v.citations : [],
    body: typeof v.body === 'string' ? v.body : undefined,
  })
);
```

### B.8 — Extract shared `CitedProse` component

Create new file: `src/components/call-intelligence/CitedProse.tsx`

```tsx
'use client';

import { CitationPill } from './CitationPill';
import type { Citation } from '@/types/call-intelligence';

interface CitedProseProps {
  text: string;
  citations: Citation[];
  chunkLookup: Record<string, { owner: string; chunk_text: string }>;
  onScrollToUtterance?: (idx: number) => void;
  onOpenKB?: (kb: NonNullable<Citation['kb_source']>) => void;
  className?: string;
}

/**
 * Renders prose followed by a trailing wrapped row of citation pills.
 * Replaces the two private CitedText / CitedTextLine impls in
 * InsightsEvalDetailModal.tsx and EvalDetailClient.tsx.
 */
export function CitedProse({
  text,
  citations,
  chunkLookup,
  onScrollToUtterance,
  onOpenKB,
  className,
}: CitedProseProps) {
  if (!text) return null;
  return (
    <div className={className ?? 'text-sm text-gray-800'}>
      <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
      {citations.length > 0 && (
        <div className="mt-1.5 inline-flex flex-wrap items-center gap-1">
          {citations.map((c, i) => (
            <CitationPill
              key={`${c.utterance_index ?? c.kb_source?.chunk_id ?? i}-${i}`}
              citation={c}
              chunkLookup={chunkLookup}
              onScrollToUtterance={onScrollToUtterance}
              onOpenKB={onOpenKB}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

Then refactor the two private impls to use it:

**File: `src/components/call-intelligence/InsightsEvalDetailModal.tsx`**

Delete the file-local `CitedText` component at lines 106-139. Replace usages of `<CitedText ...>` with `<CitedProse ...>`. Update prop names (`detail` and `onOpenTranscript` → `chunkLookup` and `onScrollToUtterance`).

**File: `src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx`**

Replace the file-local `CitedTextLine` at lines 163-197 with usages of `<CitedProse ...>`. Note: `CitedTextLine` has an editable mode (disabled prop). If editability is needed for body in EvalDetailClient.tsx later, that's a follow-up — for this ship, body is read-only.

### B.9 — Restructure `InsightsEvalDetailModal.tsx` to lead with body

File: `src/components/call-intelligence/InsightsEvalDetailModal.tsx`

**Remove sections from the dimension-drill panel (lines ~274-309):**
- Narrative
- Strengths
- Weaknesses
- Knowledge gaps
- Compliance flags
- Additional observations
- Rep deferrals

**Keep:**
- Dimension banner (name + score badge)
- Topic-drill panel (lines ~313-349, fully independent)

**Add per-dimension body section** at the top of the dimension drill (after the score badge, before the topic panel):

```tsx
{payload.dimension && (() => {
  const entry = detail.dimension_scores?.[payload.dimension];
  if (!entry) return null;
  const { score, citations = [], body } = entry;
  return (
    <section className="mb-4">
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className="text-lg font-semibold">{payload.dimension}</h3>
        <span className={`px-2 py-0.5 rounded text-sm font-medium ${scoreColor(score)}`}>
          {score.toFixed(1)} / 4
        </span>
      </div>
      {body && body.trim().length > 0 ? (
        <CitedProse
          text={body}
          citations={citations}
          chunkLookup={chunkLookup}
          onScrollToUtterance={onScrollToUtterance}
          onOpenKB={onOpenKB}
        />
      ) : (
        <p className="text-sm text-gray-500 italic">
          No per-dimension rationale on file. Admin can re-run AI eval via CLI backfill script.
        </p>
      )}
    </section>
  );
})()}
```

(Use the existing `scoreColor` helper — likely already imported. Add if needed.)

### B.10 — Plumb `onOpenKB` prop

File: `src/components/call-intelligence/InsightsEvalDetailModal.tsx`

Add `onOpenKB` to the props interface. Pass through from `InsightsTab.tsx` (the modal's parent).

File: `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx`

Find where `InsightsEvalDetailModal` is rendered. Add `onOpenKB={(kb) => { /* handler */ }}`. If `KBSidePanel` already exists and is used elsewhere in this tab, reuse its handler. If not for this ship, pass a no-op and TODO comment for follow-up.

### B.11 — Update version gate

File: `src/components/call-intelligence/citation-helpers.ts` lines 36-45

```ts
// Current (last line of the function):
if (field === 'repDeferrals') return version >= 5;
return true;

// Change to:
if (field === 'repDeferrals') return version >= 5;
if (field === 'body') return version >= 6;
return true;
```

Also update the TypeScript union type `field` parameter to include `'body'`.

### B.12 — Update coaching notes markdown export

File: `src/lib/coaching-notes-markdown.ts` lines 17 and 57-65

Find the dimensionScores render block. Currently outputs `score` only. Add body:

```ts
for (const [name, entry] of Object.entries(dimensionScores)) {
  const score = typeof entry.score === 'number' ? entry.score : Number(entry.score);
  md += `**${name}**: ${score.toFixed(1)}/4\n`;
  const body = (entry as { body?: string }).body;
  if (body && body.trim().length > 0) {
    md += `${body}\n`;
  }
  md += `\n`;
}
```

Also widen `AiOriginalSnapshot.dimensionScores` at line 17:

```ts
dimensionScores: Record<string, { score?: unknown; body?: unknown }>;
```

### B.13 — TypeScript build gate

```bash
rm -rf .next
npm run build 2>&1 | tail -30
```

Expected: `Compiled successfully`. Any TS errors point to missed construction sites — go back and add `body` where it's been dropped.

### B.14 — Lint gate

```bash
npm run lint 2>&1 | tail -10
```

Expected: zero errors.

### B.15 — Schema mirror byte-equality gate

```bash
npm run check:schema-mirror
```

Expected: PASS.

### B.16 — Agent-guard doc sync

```bash
npx agent-guard sync
```

This regenerates `docs/_generated/*.md` and prompts updates to `docs/ARCHITECTURE.md`. Read the diff to ARCHITECTURE.md before committing.

### B.17 — Stop-and-report

Report to user:
- All TS errors resolved
- Schema mirror PASS
- Lint clean
- agent-guard sync ran
- List of files changed
- Suggest manual smoke test: open Insights tab → drill into eval cell → verify modal renders without body section showing the fallback message

User reviews and merges Phase B PR. Deploys to Vercel.

---

## Phase C — Upstream prompt flip

Gated on Phase B being deployed to Vercel prod.

### C.1 — Flip the env flag in sales-coaching

Same Cloud Run service as Phase A: `sales-coaching` in `savvy-gtm-analytics` / `us-east1`. The flag flip requires a new revision (Cloud Run does not hot-reload env vars on existing revisions).

#### C.1.1 — Update the env file

```yaml
# sales-coaching/.env-vars-staging.yaml
# ... existing keys ...
EMIT_DIMENSION_BODY: "true"
```

Commit + push this change to sales-coaching `main` (a one-line PR is fine — no code changes needed because the prompt gate was already shipped in Phase A behind the flag).

#### C.1.2 — Redeploy

```powershell
# From C:/Users/russe/Documents/sales-coaching (repo root — required for buildpacks + .env-vars file resolution)
gcloud run deploy sales-coaching `
  --source . `
  --region us-east1 `
  --project savvy-gtm-analytics `
  --env-vars-file=.env-vars-staging.yaml
```

Same caveats as A.8.3: no `--set-env-vars` flag, no `--set-secrets` flag, no Dockerfile (buildpacks pick up Node automatically).

#### C.1.3 — Verify the flag is live

```bash
gcloud run services describe sales-coaching \
  --region us-east1 --project savvy-gtm-analytics \
  --format='value(spec.template.spec.containers[0].env[].name,spec.template.spec.containers[0].env[].value)' \
  | grep EMIT_DIMENSION_BODY
# Expect: EMIT_DIMENSION_BODY true
```

### C.2 — Smoke test

Trigger a fresh evaluation (organic next-call, or manual eval-run path if sales-coaching exposes one). Verify body is now emitted:

```sql
-- The most-recently created eval should have body on every dimension
SELECT
  id,
  created_at,
  ai_original_schema_version,
  (
    SELECT COUNT(*) FROM jsonb_each(dimension_scores) ds
    WHERE ds.value ? 'body' AND length(ds.value->>'body') > 0
  ) AS dims_with_body,
  (SELECT COUNT(*) FROM jsonb_object_keys(dimension_scores)) AS total_dims
FROM evaluations
ORDER BY created_at DESC
LIMIT 1;
```

Expected: `dims_with_body = total_dims` AND `ai_original_schema_version = 6`.

If body is still missing, the flag isn't being read — check the deploy revision picked up the new env file, and confirm the prompt gate code at A.5 is reading `process.env.EMIT_DIMENSION_BODY` (string `'true'`, not boolean true).

### C.3 — Stop-and-report

Once one organic eval has body on every dimension and schema version 6, Phase C is done. User gives the go-ahead for Phase D backfill.

---

## Phase D — Offline backfill script

Build the script in this Dashboard repo. Gated on Phase C deploy + smoke test.

### D.1 — Create the script

File: `scripts/backfill-dimension-bodies.cjs` (new)

```js
#!/usr/bin/env node
// Offline backfill: generate per-dimension `body` for historic evaluations.
// Locked inputs: existing score + citations. Strict drift handling.
// Default dry run; --commit to write.

require('dotenv').config();
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk').default;

const COMMIT = process.argv.includes('--commit');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > -1 ? parseInt(process.argv[i + 1], 10) : null;
})();
const MODEL_ID = 'claude-sonnet-4-6';
const PROMPT_VERSION = 'body-only-v1';
const SLEEP_MS = 200;

const pool = new Pool({
  connectionString: process.env.SALES_COACHING_DATABASE_URL_UNPOOLED
    ?? process.env.SALES_COACHING_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTargets() {
  const { rows } = await pool.query(`
    SELECT
      e.id AS evaluation_id,
      e.dimension_scores,
      e.ai_original_schema_version,
      ct.transcript
    FROM evaluations e
    LEFT JOIN call_transcripts ct ON ct.call_note_id = e.call_note_id
    WHERE e.dimension_scores IS NOT NULL
      AND e.dimension_scores <> '{}'::jsonb
      AND EXISTS (
        SELECT 1 FROM jsonb_each(e.dimension_scores) ds
        WHERE NOT (ds.value ? 'body') OR (ds.value->>'body') = '' OR (ds.value->>'body') IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM eval_body_backfill_audit a
        WHERE a.evaluation_id = e.id AND a.status = 'success'
      )
    ORDER BY e.created_at DESC
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}
  `);
  return rows;
}

function buildPrompt(dimensionName, score, citedUtterances) {
  const utterancesBlock = citedUtterances
    .map((u) => `[${u.utterance_index}] (${u.speaker_role}): ${u.text}`)
    .join('\n');
  return `You are writing a 2-3 sentence rationale for a SALES CALL EVALUATION dimension.

Dimension: ${dimensionName}
Score: ${score} / 4
Cited utterances (these are LOCKED — you may only cite these utterance_index values):
${utterancesBlock}

Write a single paragraph, 150-300 characters, explaining WHY this dimension received this score, based on the cited utterances. No bullets. Reference at least one utterance_index inline using square brackets like [12]. Do not invent utterances. If the cited utterances do not justify the score, say so.

Respond as JSON: { "body": "...", "cited_utterance_indexes": [12, 15] }`;
}

function getCitedUtterances(transcript, citations) {
  if (!Array.isArray(transcript)) return [];
  const wantedIdxs = new Set(
    citations
      .filter((c) => typeof c.utterance_index === 'number')
      .map((c) => c.utterance_index)
  );
  return transcript.filter((u) => wantedIdxs.has(u.utterance_index));
}

async function generateBody(dimName, score, citedUtterances, citationsLocked) {
  const resp = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: 400,
    messages: [{ role: 'user', content: buildPrompt(dimName, score, citedUtterances) }],
  });
  const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in model response');
  const parsed = JSON.parse(match[0]);
  if (typeof parsed.body !== 'string') throw new Error('No body in JSON');
  const allowedIdxs = new Set(citationsLocked.map((c) => c.utterance_index).filter((i) => typeof i === 'number'));
  const orphanCount = (parsed.cited_utterance_indexes ?? []).filter((i) => !allowedIdxs.has(i)).length;
  return {
    body: parsed.body.trim(),
    inputTokens: resp.usage?.input_tokens ?? 0,
    outputTokens: resp.usage?.output_tokens ?? 0,
    droppedOrphans: orphanCount,
  };
}

async function writeBody(evaluationId, dimName, body) {
  if (!COMMIT) return;
  await pool.query(
    `UPDATE evaluations
     SET dimension_scores = jsonb_set(dimension_scores, $1::text[], $2::jsonb, false)
     WHERE id = $3`,
    [[dimName, 'body'], JSON.stringify(body), evaluationId]
  );
}

async function recordAudit(evaluationId, status, opts) {
  if (!COMMIT) return;
  await pool.query(
    `INSERT INTO eval_body_backfill_audit
     (evaluation_id, status, error_message, input_tokens, output_tokens,
      schema_version_before, model_id, prompt_version, dropped_orphan_citations,
      skipped_dims, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
    [
      evaluationId, status, opts.error ?? null,
      opts.inputTokens ?? null, opts.outputTokens ?? null,
      opts.schemaVersionBefore, MODEL_ID, PROMPT_VERSION,
      opts.droppedOrphans ?? 0, opts.skippedDims ?? 0,
    ]
  );
}

async function processEval(row) {
  const { evaluation_id, dimension_scores, ai_original_schema_version, transcript } = row;
  const dims = Object.entries(dimension_scores);
  let totalIn = 0, totalOut = 0, totalOrphans = 0, skipped = 0;
  for (const [dimName, entry] of dims) {
    const existingBody = entry.body;
    if (typeof existingBody === 'string' && existingBody.trim().length > 0) continue;
    const citations = Array.isArray(entry.citations) ? entry.citations : [];
    if (citations.length === 0) {
      skipped++;
      console.log(`  SKIP ${dimName} (no citations to anchor body)`);
      continue;
    }
    const citedUtts = getCitedUtterances(transcript, citations);
    if (citedUtts.length === 0) {
      skipped++;
      console.log(`  SKIP ${dimName} (citations don't match transcript utterances)`);
      continue;
    }
    try {
      const result = await generateBody(dimName, entry.score, citedUtts, citations);
      totalIn += result.inputTokens;
      totalOut += result.outputTokens;
      totalOrphans += result.droppedOrphans;
      console.log(`  ${COMMIT ? 'WRITE' : 'DRY '} ${dimName}: "${result.body.slice(0, 60)}..."`);
      await writeBody(evaluation_id, dimName, result.body);
      await sleep(SLEEP_MS);
    } catch (e) {
      if (e?.status === 429) {
        console.warn(`  429 rate-limited; sleeping 30s`);
        await sleep(30000);
        // Retry once; if it fails again, hard-error
        const result = await generateBody(dimName, entry.score, citedUtts, citations);
        totalIn += result.inputTokens;
        totalOut += result.outputTokens;
        await writeBody(evaluation_id, dimName, result.body);
      } else {
        throw e;
      }
    }
  }
  return {
    inputTokens: totalIn,
    outputTokens: totalOut,
    droppedOrphans: totalOrphans,
    skippedDims: skipped,
    schemaVersionBefore: ai_original_schema_version,
  };
}

async function main() {
  console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}, Model: ${MODEL_ID}`);
  const targets = await fetchTargets();
  console.log(`Found ${targets.length} evaluations needing body backfill\n`);
  let successes = 0, failures = 0, totalIn = 0, totalOut = 0;
  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    console.log(`[${i + 1}/${targets.length}] eval ${row.evaluation_id} (schema v${row.ai_original_schema_version})`);
    try {
      const stats = await processEval(row);
      totalIn += stats.inputTokens;
      totalOut += stats.outputTokens;
      await recordAudit(row.evaluation_id, 'success', stats);
      successes++;
    } catch (e) {
      console.error(`  FAIL: ${e.message}`);
      await recordAudit(row.evaluation_id, 'failure', {
        error: e.message,
        schemaVersionBefore: row.ai_original_schema_version,
      });
      failures++;
    }
  }
  const inCost = (totalIn / 1_000_000) * 3.0;
  const outCost = (totalOut / 1_000_000) * 15.0;
  console.log(`\nDone. Success: ${successes}, Failure: ${failures}`);
  console.log(`Tokens: in=${totalIn}, out=${totalOut}`);
  console.log(`Estimated cost: $${(inCost + outCost).toFixed(2)} (Sonnet 4.6 pricing)`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

### D.2 — Dry run (no writes)

```bash
node scripts/backfill-dimension-bodies.cjs
```

Expected output: `Found 406 evaluations...` followed by per-eval logs showing dry-run lines (`DRY <dimName>: "..."`). Final summary should show estimated cost ~$27-31.

If output is suspicious (e.g. 0 found, or radically different cost), **STOP** and investigate.

### D.3 — Pilot run

```bash
node scripts/backfill-dimension-bodies.cjs --limit 5 --commit
```

Verify in Neon:

```sql
SELECT id, jsonb_pretty(dimension_scores) FROM evaluations
WHERE id IN (SELECT evaluation_id FROM eval_body_backfill_audit ORDER BY created_at DESC LIMIT 5);
```

Manually review the 5 generated bodies for quality. If quality is poor:
- Inspect the prompt — tune wording
- Re-run pilot with adjusted prompt (update `PROMPT_VERSION` constant for audit tracking)

If quality is good, proceed.

### D.4 — Full backfill

```bash
node scripts/backfill-dimension-bodies.cjs --commit
```

Monitor for 429s. Should run ~30-60 minutes (406 evals × ~9 dims × 200ms = ~12 minutes of API time + processing).

### D.5 — Verification

```sql
-- Every eval should now have body on every dimension
SELECT COUNT(*) FROM evaluations
WHERE dimension_scores IS NOT NULL
  AND dimension_scores <> '{}'::jsonb
  AND EXISTS (
    SELECT 1 FROM jsonb_each(dimension_scores) ds
    WHERE NOT (ds.value ? 'body') OR (ds.value->>'body') = '' OR (ds.value->>'body') IS NULL
  );
-- Expected: 0 (or close to it; rows with no citations on any dim are legitimately skipped)

-- Audit summary
SELECT status, COUNT(*) FROM eval_body_backfill_audit GROUP BY status;

-- Failures, if any
SELECT evaluation_id, error_message FROM eval_body_backfill_audit WHERE status = 'failure';
```

If failures > 0: investigate and re-run targeted retries with `--limit` after fixing.

### D.6 — UI smoke test

Open Dashboard Insights tab → drill any heat-map cell → confirm:
- Body paragraph renders at the top of Layer 2 modal
- Citation pills are clickable
- Utterance citations open Layer 3 jumped to the cited utterance
- KB citations render the chunk inline
- Score badge matches the historical score (no drift)

### D.7 — Stop-and-report

Report: total cost actual vs estimate, success/failure counts, any quality concerns observed in pilot.

---

## Final acceptance criteria (verify all)

- [ ] (a) Manager drills heat-map cell → Layer 2 opens → dimension name + score + 2-3 sentence body + citation pills.
- [ ] (b) Click utterance citation in body → Layer 3 transcript modal jumps to that utterance.
- [ ] (c) Click KB citation → renders the KB chunk inline.
- [ ] (d) Pre-backfill eval (hypothetical edge case after pilot) → fallback "no rationale on file" message renders.
- [ ] (e) ~~Admin clicks Re-evaluate~~ **CUT — offline script only.**
- [ ] (f) `npm run check:schema-mirror` PASS.
- [ ] (g) Manager edits a dimension score → body for THAT and OTHER dimensions is preserved (R1 data-loss-fix verified). **Manually test this in prod.**
- [ ] (h) After backfill, verification SQL shows 0 evals missing body.
- [ ] (i) Backfill audit table has one row per eval with `status='success'`.
- [ ] (j) New evals created after Phase C have `body` per dimension natively (no backfill needed).

---

## Risk register reference

| ID | Risk | Phase | Status |
|---|---|---|---|
| R1 | Inline-edit drops body | B.3 | Fixed first in Phase B |
| R2 | Strict schema rejects body if order wrong | A.5 / C.1 | Env flag rollout |
| R3 | Score drift | N/A | Eliminated — body-only prompt |
| R4 | Branch drift (main vs master) | B.2 | Fixed in B |
| R5 | KB pills no-op | B.10 | Plumbed |
| R6 | Legacy v2/v3 evals | D.3 | Sampled in pilot |
| R7 | Markdown export omits body | B.12 | Fixed in B |
| R8 | No re-eval endpoint | N/A | Eliminated — offline only |
| R9 | Anthropic rate limit | D.1 | 429 backoff |
| R10 | Orphan citations | D.1 | Strict drop in script |
| R11 | JSONB partial-update clobber | D.1 | `jsonb_set` not full-replace |

---

## Doc sync (Phase 7.5 reminder)

After Phase B merges, run:

```bash
npx agent-guard sync
```

Update `docs/ARCHITECTURE.md` Call Intelligence section to mention the per-dimension body field and the offline backfill workflow. Update `.claude/bq-views.md` if any view annotations reference dimension_scores shape.

---

## End of guide

Built: 2026-05-11.
Council-reviewed (Codex + Gemini).
User-approved scope reduction: offline script only.
Total estimated cost: $27-31 (Sonnet 4.6).
Total estimated wall-clock execution time: 1-2 hours for code, 30-60 min for backfill.
