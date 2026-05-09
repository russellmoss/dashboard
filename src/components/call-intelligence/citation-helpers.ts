import type { Citation } from '@/types/call-intelligence';

/**
 * Defensive citation extractor. ai_original shape varies by version (v2-v5 in prod);
 * each field independently may be `string[]` (v2) OR `Array<{text, citations}>` (v3+).
 * Always returns `{text, citations}` shape; missing citations → empty array.
 */
export function readCitedItems(
  raw: unknown,
): Array<{ text: string; citations: Citation[]; expected_source?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return { text: item, citations: [] as Citation[] };
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const text = typeof obj.text === 'string' ? obj.text : '';
        const citations = Array.isArray(obj.citations) ? (obj.citations as Citation[]) : [];
        const expected_source =
          typeof obj.expected_source === 'string' ? obj.expected_source : undefined;
        return { text, citations, expected_source };
      }
      return null;
    })
    .filter(
      (x): x is { text: string; citations: Citation[]; expected_source?: string } =>
        x !== null && x.text !== '',
    );
}

/**
 * v2-v5 schema field availability map. Used by AuditToggle and the canonical
 * EvalDetailClient renderer to hide unavailable sections rather than render
 * empty boxes.
 */
export function isFieldSupportedByAiOriginalVersion(
  version: number | null,
  field: 'coachingNudge' | 'additionalObservations' | 'repDeferrals',
): boolean {
  if (version === null) return false;
  if (field === 'coachingNudge') return version >= 3;
  if (field === 'additionalObservations') return version >= 4;
  if (field === 'repDeferrals') return version >= 5;
  return true;
}

/**
 * Pre-migration-024 fallback: canonical `evaluations.coaching_nudge` is NULL for
 * older rows. Read from `ai_original.coachingNudge` (immutable). Used in the
 * API route handler to compute `coaching_nudge_effective`.
 */
export function readAiOriginalCoachingNudge(
  aiOriginal: unknown,
): { text: string; citations?: Citation[] } | null {
  if (!aiOriginal || typeof aiOriginal !== 'object') return null;
  const cn = (aiOriginal as Record<string, unknown>).coachingNudge;
  if (!cn || typeof cn !== 'object') return null;
  const obj = cn as Record<string, unknown>;
  const text = typeof obj.text === 'string' ? obj.text : null;
  if (!text) return null;
  const citations = Array.isArray(obj.citations) ? (obj.citations as Citation[]) : undefined;
  return citations ? { text, citations } : { text };
}
