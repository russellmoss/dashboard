#!/usr/bin/env node
/**
 * scripts/backfill-dimension-bodies.cjs
 * --------------------------------------------------------------------------
 * Offline backfill of the per-dimension `body` field (2-3 sentence AI
 * rationale, schema v6) across the ~406 historical evaluations that pre-date
 * the EMIT_DIMENSION_BODY=true upstream prompt flip.
 *
 *   Defaults to DRY RUN. Pass --commit to actually write to Neon.
 *   --limit N (optional)  — process at most N evaluations
 *
 * Architecture (council-approved 2026-05-11):
 *   - Locked inputs: existing score + citations (per dim) + transcript +
 *     rubric. The model NEVER produces a new score; body is the only output.
 *   - One Anthropic call per evaluation (NOT per dim). Generates body for
 *     ALL dims in one shot. ~7× cheaper than per-dim calls.
 *   - Strict drift handling: drop orphan citations the model invents; skip
 *     dims whose existing citations can't be matched to the transcript.
 *   - JSONB partial updates via jsonb_set per (eval, dim) — never the full
 *     dimension_scores blob (avoids clobbering concurrent manager edits).
 *   - Audit row per eval in eval_body_backfill_audit (migration 043) so
 *     re-runs resume from the last successful attempt.
 *
 *   Resumable: WHERE NOT EXISTS (audit row with status='success' for this
 *   eval) so a partial run picks up where it left off.
 *
 * Cost: ~$27-31 (Sonnet 4.6, 406 evals, ~19K input + ~700 output tokens each).
 * Wall: ~30-60 min with 200ms inter-call sleep + 429 exponential backoff.
 */

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
const SCHEMA_VERSION_AFTER = 6;
const SLEEP_MS = 200;
const RATE_LIMIT_BACKOFF_MS = 30000;
const MAX_OUTPUT_TOKENS = 4000; // ~150-300 chars × 15 dims = ~7K chars ≈ 2K tokens; headroom

const pool = new Pool({
  connectionString:
    process.env.SALES_COACHING_DATABASE_URL_UNPOOLED
    ?? process.env.SALES_COACHING_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Data layer ────────────────────────────────────────────────────────────

async function fetchTargets() {
  const { rows } = await pool.query(`
    SELECT
      e.id              AS evaluation_id,
      e.dimension_scores,
      e.ai_original_schema_version,
      e.rubric_id,
      ct.transcript,
      r.dimensions      AS rubric_dimensions
    FROM evaluations e
    LEFT JOIN call_transcripts ct ON ct.call_note_id = e.call_note_id
    LEFT JOIN rubrics r           ON r.id            = e.rubric_id
    WHERE e.dimension_scores IS NOT NULL
      AND e.dimension_scores <> '{}'::jsonb
      AND EXISTS (
        SELECT 1 FROM jsonb_each(e.dimension_scores) ds
        WHERE NOT (ds.value ? 'body')
           OR (ds.value->>'body') = ''
           OR (ds.value->>'body') IS NULL
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

// ─── Prompt builder ────────────────────────────────────────────────────────

function buildPrompt({ dimsForPrompt, citedUtterances, rubricLevelsByDim }) {
  const dimSpec = dimsForPrompt
    .map(({ name, score, citationIdxs }) => {
      const levels = rubricLevelsByDim[name];
      const levelText = levels
        ? `\n      Rubric levels:\n        1 (Did not demonstrate): ${levels[1]}\n        2 (Partial): ${levels[2]}\n        3 (Competent): ${levels[3]}\n        4 (Exemplary): ${levels[4]}`
        : '';
      return `    - "${name}": score=${score}, cited_utterance_indexes=[${citationIdxs.join(', ')}]${levelText}`;
    })
    .join('\n');

  const uttText = citedUtterances
    .map((u) => `[${u.utterance_index}] (${u.speaker_role}): ${u.text.replace(/"/g, '\\"')}`)
    .join('\n');

  return `You are writing per-dimension rationales for a SALES CALL EVALUATION at Savvy Wealth (RIA recruiting financial advisors as 1099 contractors).

LOCKED INPUTS — do NOT regrade. Score + cited_utterance_indexes are pinned; you ONLY produce the prose "body" rationale per dimension.

Dimensions in scope:
${dimSpec}

Transcript utterances (use ONLY indexes from each dimension's cited_utterance_indexes — do NOT invent indexes):
${uttText}

For EACH dimension above, write a 2-3 sentence rationale (150-300 characters) that:
  - Explains WHY this dimension received this exact score on THIS call.
  - Maps the rep's observed behavior (referenced inline as [N] for utterance_index) to the rubric level descriptions.
  - Cites at least one utterance_index inline using bracket notation, e.g. "...at [47] the rep pivoted to fees...".
  - Reads like a coach explaining the grade to the rep — direct on substance, warm in delivery. No em dashes. No bullets.
  - References ONLY indexes from THIS dimension's cited_utterance_indexes — never invent.

If the cited utterances do not fully justify the score (rare), name the gap explicitly rather than fabricating.

Respond as a single JSON object. No preamble, no markdown fencing.

Schema:
{
  "dimensions": {
    "<dimension_name>": {
      "body": "<150-300 char prose rationale, 2-3 sentences>",
      "cited_utterance_indexes": [<integer>, ...]
    },
    ...
  }
}`;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getCitedUtterances(transcript, citationsByDim) {
  if (!Array.isArray(transcript)) return [];
  const wantedIdxs = new Set();
  for (const cits of Object.values(citationsByDim)) {
    for (const c of cits) {
      if (typeof c.utterance_index === 'number') wantedIdxs.add(c.utterance_index);
    }
  }
  return transcript
    .filter((u) => wantedIdxs.has(u.utterance_index))
    .sort((a, b) => a.utterance_index - b.utterance_index);
}

function getRubricLevelsByDim(rubricDimensions) {
  if (!Array.isArray(rubricDimensions)) return {};
  const out = {};
  for (const d of rubricDimensions) {
    if (d && typeof d.name === 'string' && d.levels) {
      out[d.name] = d.levels;
    }
  }
  return out;
}

// Extract first JSON object from model text (model may add stray prose).
function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model response');
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function callAnthropic(prompt) {
  const resp = await anthropic.messages.create({
    model: MODEL_ID,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = resp.content.find((b) => b.type === 'text');
  if (!block) throw new Error('No text block in model response');
  return {
    text: block.text,
    inputTokens: resp.usage?.input_tokens ?? 0,
    outputTokens: resp.usage?.output_tokens ?? 0,
  };
}

// ─── DB writers ────────────────────────────────────────────────────────────

async function writeBody(evaluationId, dimName, body) {
  if (!COMMIT) return;
  // jsonb_set per-dim — does NOT clobber other dims' citations / body, AND
  // does not race with concurrent manager edits on OTHER dims. The 4th arg
  // create_missing=true (default) is required to insert body when the key
  // doesn't already exist on this dim — with false, Postgres silently
  // returns the blob unchanged when the path is missing.
  await pool.query(
    `UPDATE evaluations
     SET dimension_scores = jsonb_set(dimension_scores, $1::text[], $2::jsonb, true)
     WHERE id = $3`,
    [[dimName, 'body'], JSON.stringify(body), evaluationId],
  );
}

async function bumpSchemaVersion(evaluationId) {
  if (!COMMIT) return;
  // Mark the row as schema v6 after a successful backfill — gates the
  // Dashboard's renderer + audit toggle on the new shape.
  await pool.query(
    `UPDATE evaluations SET ai_original_schema_version = $1 WHERE id = $2`,
    [SCHEMA_VERSION_AFTER, evaluationId],
  );
}

async function recordAudit(evaluationId, status, opts) {
  if (!COMMIT) return;
  // Next attempt_number for this eval (handles re-runs).
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next
     FROM eval_body_backfill_audit WHERE evaluation_id = $1`,
    [evaluationId],
  );
  const attempt = rows[0].next;
  await pool.query(
    `INSERT INTO eval_body_backfill_audit
     (evaluation_id, attempt_number, status, error_message,
      input_tokens, output_tokens, schema_version_before, schema_version_after,
      model_id, prompt_version, dropped_orphan_citations, skipped_dims, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())`,
    [
      evaluationId, attempt, status, opts.error ?? null,
      opts.inputTokens ?? null, opts.outputTokens ?? null,
      opts.schemaVersionBefore,
      status === 'success' ? SCHEMA_VERSION_AFTER : null,
      MODEL_ID, PROMPT_VERSION,
      opts.droppedOrphans ?? 0, opts.skippedDims ?? 0,
    ],
  );
}

// ─── Per-eval driver ───────────────────────────────────────────────────────

async function processEval(row) {
  const {
    evaluation_id,
    dimension_scores,
    ai_original_schema_version,
    transcript,
    rubric_dimensions,
  } = row;

  // 1. Decide which dims need body. Skip dims with empty citations
  //    (strict — body MUST anchor to ≥1 utterance) and dims that already
  //    have a non-empty body (partial-resume safety).
  const allDims = Object.entries(dimension_scores);
  const dimsForPrompt = [];
  let skippedDims = 0;
  for (const [name, entry] of allDims) {
    const existingBody = entry.body;
    if (typeof existingBody === 'string' && existingBody.trim().length > 0) continue;
    const citations = Array.isArray(entry.citations) ? entry.citations : [];
    const utteranceCits = citations.filter(
      (c) => typeof c.utterance_index === 'number',
    );
    if (utteranceCits.length === 0) {
      skippedDims++;
      console.log(`  SKIP ${name} (no utterance citations to anchor body)`);
      continue;
    }
    dimsForPrompt.push({
      name,
      score: entry.score,
      citationIdxs: utteranceCits.map((c) => c.utterance_index),
    });
  }
  if (dimsForPrompt.length === 0) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      droppedOrphans: 0,
      skippedDims,
      schemaVersionBefore: ai_original_schema_version,
      dimWrites: 0,
    };
  }

  // 2. Build prompt inputs.
  const citationsByDim = Object.fromEntries(
    dimsForPrompt.map((d) => [d.name, d.citationIdxs.map((i) => ({ utterance_index: i }))]),
  );
  const citedUtterances = getCitedUtterances(transcript, citationsByDim);
  if (citedUtterances.length === 0) {
    // No utterances found for ANY dim — likely transcript-utterance mismatch.
    // Skip the whole eval.
    return {
      inputTokens: 0,
      outputTokens: 0,
      droppedOrphans: 0,
      skippedDims: dimsForPrompt.length,
      schemaVersionBefore: ai_original_schema_version,
      dimWrites: 0,
    };
  }
  const rubricLevelsByDim = getRubricLevelsByDim(rubric_dimensions);
  const prompt = buildPrompt({ dimsForPrompt, citedUtterances, rubricLevelsByDim });

  // 3. Call Anthropic — one shot for all dims. Single retry on 429.
  let result;
  try {
    result = await callAnthropic(prompt);
  } catch (e) {
    if (e?.status === 429) {
      console.warn(`  429 rate-limited; sleeping ${RATE_LIMIT_BACKOFF_MS}ms before retry`);
      await sleep(RATE_LIMIT_BACKOFF_MS);
      result = await callAnthropic(prompt);
    } else {
      throw e;
    }
  }

  // 4. Parse model output. Strict drift handling on citations.
  const parsed = extractJson(result.text);
  if (!parsed || typeof parsed.dimensions !== 'object' || parsed.dimensions === null) {
    throw new Error('Model output missing dimensions object');
  }

  // 5. Write each dim. Strict: drop orphan citations (model invented an
  //    utterance_index not in the locked input set for that dim).
  let droppedOrphans = 0;
  let dimWrites = 0;
  for (const { name, citationIdxs } of dimsForPrompt) {
    const dimOut = parsed.dimensions[name];
    if (!dimOut || typeof dimOut.body !== 'string') {
      skippedDims++;
      console.log(`  SKIP ${name} (model returned no body)`);
      continue;
    }
    const allowed = new Set(citationIdxs);
    const claimedIdxs = Array.isArray(dimOut.cited_utterance_indexes)
      ? dimOut.cited_utterance_indexes
      : [];
    const orphans = claimedIdxs.filter((i) => !allowed.has(i)).length;
    droppedOrphans += orphans;
    const body = dimOut.body.trim();
    if (body.length === 0) {
      skippedDims++;
      console.log(`  SKIP ${name} (body empty after trim)`);
      continue;
    }
    console.log(
      `  ${COMMIT ? 'WRITE' : 'DRY  '} ${name}: "${body.slice(0, 70).replace(/\n/g, ' ')}..."`,
    );
    await writeBody(evaluation_id, name, body);
    dimWrites++;
  }

  // 6. Bump schema_version on the row if we wrote at least one body.
  if (dimWrites > 0) {
    await bumpSchemaVersion(evaluation_id);
  }

  return {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    droppedOrphans,
    skippedDims,
    schemaVersionBefore: ai_original_schema_version,
    dimWrites,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`);
  console.log(`Model: ${MODEL_ID}`);
  console.log(`Prompt version: ${PROMPT_VERSION}`);
  if (LIMIT) console.log(`Limit: ${LIMIT}`);
  console.log();

  const targets = await fetchTargets();
  console.log(`Found ${targets.length} evaluations needing body backfill\n`);
  if (targets.length === 0) {
    await pool.end();
    return;
  }

  let successes = 0;
  let failures = 0;
  let totalIn = 0;
  let totalOut = 0;
  let totalOrphans = 0;

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    console.log(
      `[${i + 1}/${targets.length}] eval ${row.evaluation_id} (v${row.ai_original_schema_version})`,
    );
    try {
      const stats = await processEval(row);
      totalIn += stats.inputTokens;
      totalOut += stats.outputTokens;
      totalOrphans += stats.droppedOrphans;
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
    await sleep(SLEEP_MS);
  }

  // Sonnet 4.6 pricing: $3/MTok input, $15/MTok output (no cache assumed here).
  const inCost = (totalIn / 1_000_000) * 3.0;
  const outCost = (totalOut / 1_000_000) * 15.0;

  console.log();
  console.log(`Done.`);
  console.log(`  successes: ${successes}`);
  console.log(`  failures:  ${failures}`);
  console.log(`  tokens:    in=${totalIn}, out=${totalOut}`);
  console.log(`  orphans:   ${totalOrphans} citation indexes dropped`);
  console.log(`  cost:      $${(inCost + outCost).toFixed(2)} (Sonnet 4.6)`);
  if (!COMMIT) {
    console.log();
    console.log(`(dry run — no DB writes; re-run with --commit to persist)`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  pool.end().catch(() => {});
  process.exit(1);
});
