import { createHash } from 'crypto';
import { getCoachingPool } from '@/lib/coachingDb';

// ---------------------------------------------------------------------------
// Raw row interfaces
// ---------------------------------------------------------------------------

interface CallSummaryRaw {
  id: string;
  summary: string | null;
  call_started_at: Date | string;
  looking_at_competitors: unknown;
  competitor_extraction_status: string;
}

interface ObjectionRaw {
  call_note_id: string;
  objection_text: string;
  objection_type: string;
  objection_subtype: string | null;
  handling_assessment: string;
}

interface CacheRow {
  sfdc_opportunity_id: string;
  call_note_ids_hash: string;
  contributing_call_ids: string[];
  pain_points: unknown;
  competitors_in_mix: unknown;
  next_steps: unknown;
  compensation_discussions: unknown;
  advisor_concerns: unknown;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  generated_at: Date | string;
}

// ---------------------------------------------------------------------------
// Competitor normalization
// ---------------------------------------------------------------------------

export interface CompetitorItem {
  canonicalBrand: string;
  rawMention: string;
  relationshipType: string;
  confidence: string;
}

const RELEVANT_RELATIONSHIP_TYPES = new Set([
  'employer',
  'considering',
  'evaluated',
  'platform_ibd',
]);

function normalizeCompetitors(raw: unknown): CompetitorItem[] {
  if (!raw || !Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .filter((c) => {
      if (c.relationship_type) {
        return RELEVANT_RELATIONSHIP_TYPES.has(String(c.relationship_type));
      }
      return true;
    })
    .map((c) => ({
      canonicalBrand: String(c.canonical_brand ?? c.canonicalBrand ?? ''),
      rawMention: String(c.raw_mention ?? c.rawMention ?? ''),
      relationshipType: String(c.relationship_type ?? 'unknown'),
      confidence: String(c.confidence ?? 'unknown'),
    }));
}

// ---------------------------------------------------------------------------
// Mapped output types
// ---------------------------------------------------------------------------

export interface CallSummaryMapped {
  id: string;
  summary: string;
  callDate: string;
  competitors: CompetitorItem[];
  competitorStatus: string;
}

export interface ObjectionMapped {
  callNoteId: string;
  objectionText: string;
  objectionType: string;
  objectionSubtype: string | null;
  handlingAssessment: string;
}

// ---------------------------------------------------------------------------
// Data-gathering queries
// ---------------------------------------------------------------------------

export async function getCallSummariesForOpportunity(
  oppId: string,
  leadId: string | null,
  contactId: string | null,
  repIds: string[],
): Promise<CallSummaryMapped[]> {
  if (!oppId || repIds.length === 0) return [];

  const pool = getCoachingPool();

  const { rows } = await pool.query<CallSummaryRaw>(
    `WITH linked_calls AS (
      SELECT cn.id, cn.call_started_at,
             COALESCE(NULLIF(TRIM(cn.summary_markdown_edited), ''), cn.summary_markdown) AS summary,
             cn.looking_at_competitors,
             cn.competitor_extraction_status
      FROM call_notes cn
      WHERE cn.source_deleted_at IS NULL
        AND cn.rep_id = ANY($4::uuid[])
        AND (
          cn.sfdc_what_id = $1
          OR (cn.sfdc_record_id = $2 AND $2 IS NOT NULL
              AND (cn.sfdc_what_id IS NULL OR cn.sfdc_what_id = $1))
          OR (cn.sfdc_record_id = $3 AND $3 IS NOT NULL
              AND (cn.sfdc_what_id IS NULL OR cn.sfdc_what_id = $1))
          OR (cn.sfdc_who_id = $2 AND cn.sfdc_what_id IS NULL AND $2 IS NOT NULL)
          OR (cn.sfdc_who_id = $3 AND cn.sfdc_what_id IS NULL AND $3 IS NOT NULL)
        )
    ),
    likely_unlinked AS (
      SELECT DISTINCT ON (cn.id)
             cn.id, cn.call_started_at,
             COALESCE(NULLIF(TRIM(cn.summary_markdown_edited), ''), cn.summary_markdown) AS summary,
             cn.looking_at_competitors,
             cn.competitor_extraction_status
      FROM call_notes cn
      JOIN slack_review_messages srm ON srm.call_note_id = cn.id AND srm.surface = 'dm'
      CROSS JOIN LATERAL jsonb_array_elements(srm.sfdc_suggestion->'candidates') AS cand
      WHERE cn.source_deleted_at IS NULL
        AND cn.rep_id = ANY($4::uuid[])
        AND cn.sfdc_what_id IS NULL
        AND cn.sfdc_record_id IS NULL
        AND srm.sfdc_suggestion IS NOT NULL
        AND jsonb_typeof(srm.sfdc_suggestion->'candidates') = 'array'
        AND (cand->>'confidence_tier') = 'likely'
        AND (
          ((cand->>'what_id') = $1 AND (cand->>'what_record_type') = 'Opportunity')
          OR ((cand->>'who_id') = $2 AND (cand->>'primary_record_type') = 'Lead' AND $2 IS NOT NULL)
          OR ((cand->>'who_id') = $3 AND (cand->>'primary_record_type') = 'Contact' AND $3 IS NOT NULL)
        )
        AND cn.id NOT IN (SELECT id FROM linked_calls)
      ORDER BY cn.id, cn.call_started_at
    )
    SELECT id, call_started_at, summary, looking_at_competitors, competitor_extraction_status
    FROM (
      SELECT * FROM linked_calls
      UNION ALL
      SELECT * FROM likely_unlinked
    ) combined
    ORDER BY call_started_at DESC`,
    [oppId, leadId, contactId, repIds],
  );

  return rows
    .filter((r) => r.summary)
    .map((r) => ({
      id: r.id,
      summary: r.summary!,
      callDate:
        r.call_started_at instanceof Date
          ? r.call_started_at.toISOString()
          : String(r.call_started_at),
      competitors: normalizeCompetitors(r.looking_at_competitors),
      competitorStatus: r.competitor_extraction_status ?? 'pending',
    }));
}

export async function getObjectionsForCalls(
  callNoteIds: string[],
): Promise<ObjectionMapped[]> {
  if (callNoteIds.length === 0) return [];

  const pool = getCoachingPool();

  const { rows } = await pool.query<ObjectionRaw>(
    `SELECT call_note_id, objection_text, objection_type, objection_subtype,
            handling_assessment
     FROM objections
     WHERE call_note_id = ANY($1::uuid[])
       AND is_synthetic_test_data = FALSE
     ORDER BY created_at ASC`,
    [callNoteIds],
  );

  return rows.map((r) => ({
    callNoteId: r.call_note_id,
    objectionText: r.objection_text,
    objectionType: r.objection_type,
    objectionSubtype: r.objection_subtype ?? null,
    handlingAssessment: r.handling_assessment,
  }));
}

// ---------------------------------------------------------------------------
// Cache read / write
// ---------------------------------------------------------------------------

export interface CachedSummaryResult {
  hash: string;
  generatedAt: string;
  painPoints: string[];
  competitorsInMix: string[];
  nextSteps: string[];
  compensationDiscussions: string[];
  advisorConcerns: string[];
  contributingCallIds: string[];
  model: string;
}

export async function getCachedSummary(
  oppId: string,
): Promise<CachedSummaryResult | null> {
  const pool = getCoachingPool();

  const { rows } = await pool.query<CacheRow>(
    `SELECT sfdc_opportunity_id, call_note_ids_hash, contributing_call_ids,
            pain_points, competitors_in_mix, next_steps,
            compensation_discussions, advisor_concerns,
            model, prompt_tokens, completion_tokens, generated_at
     FROM opportunity_ai_summaries
     WHERE sfdc_opportunity_id = $1`,
    [oppId],
  );

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    hash: r.call_note_ids_hash,
    generatedAt:
      r.generated_at instanceof Date
        ? r.generated_at.toISOString()
        : String(r.generated_at),
    painPoints: r.pain_points as string[],
    competitorsInMix: r.competitors_in_mix as string[],
    nextSteps: r.next_steps as string[],
    compensationDiscussions: r.compensation_discussions as string[],
    advisorConcerns: r.advisor_concerns as string[],
    contributingCallIds: r.contributing_call_ids ?? [],
    model: r.model,
  };
}

export async function upsertCachedSummary(data: {
  oppId: string;
  hash: string;
  callIds: string[];
  painPoints: string[];
  competitorsInMix: string[];
  nextSteps: string[];
  compensationDiscussions: string[];
  advisorConcerns: string[];
  model: string;
  promptTokens: number;
  completionTokens: number;
}): Promise<void> {
  const pool = getCoachingPool();

  await pool.query(
    `INSERT INTO opportunity_ai_summaries
       (sfdc_opportunity_id, call_note_ids_hash, contributing_call_ids,
        pain_points, competitors_in_mix, next_steps,
        compensation_discussions, advisor_concerns,
        model, prompt_tokens, completion_tokens, generated_at)
     VALUES ($1, $2, $3::uuid[], $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (sfdc_opportunity_id)
     DO UPDATE SET
       call_note_ids_hash = EXCLUDED.call_note_ids_hash,
       contributing_call_ids = EXCLUDED.contributing_call_ids,
       pain_points = EXCLUDED.pain_points,
       competitors_in_mix = EXCLUDED.competitors_in_mix,
       next_steps = EXCLUDED.next_steps,
       compensation_discussions = EXCLUDED.compensation_discussions,
       advisor_concerns = EXCLUDED.advisor_concerns,
       model = EXCLUDED.model,
       prompt_tokens = EXCLUDED.prompt_tokens,
       completion_tokens = EXCLUDED.completion_tokens,
       generated_at = NOW()`,
    [
      data.oppId,
      data.hash,
      data.callIds,
      JSON.stringify(data.painPoints),
      JSON.stringify(data.competitorsInMix),
      JSON.stringify(data.nextSteps),
      JSON.stringify(data.compensationDiscussions),
      JSON.stringify(data.advisorConcerns),
      data.model,
      data.promptTokens,
      data.completionTokens,
    ],
  );
}

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

export function computeCallNoteIdsHash(ids: string[]): string {
  return createHash('sha256').update([...ids].sort().join(',')).digest('hex');
}
