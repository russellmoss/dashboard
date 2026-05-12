import { getKnowledgeGapClusters } from '../knowledge-gap-clusters';

const mockQuery = jest.fn();
jest.mock('@/lib/coachingDb', () => ({
  getCoachingPool: () => ({ query: mockQuery }),
}));

beforeEach(() => mockQuery.mockReset());

describe('getKnowledgeGapClusters', () => {
  it('returns empty when visibleRepIds is empty', async () => {
    const result = await getKnowledgeGapClusters({
      dateRange: { kind: '30d' }, role: 'both', podIds: [], repIds: [],
      sourceFilter: 'all', visibleRepIds: [],
    });
    expect(result).toEqual([]);
  });

  it('binds includeGaps + includeDeferrals as booleans (sourceFilter=all)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await getKnowledgeGapClusters({
      dateRange: { kind: '30d' }, role: 'both', podIds: [], repIds: [],
      sourceFilter: 'all', visibleRepIds: ['rep-a'],
    });
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toHaveLength(8);   // no more $9 synonyms
    expect(params[5]).toBe(true);     // includeGaps
    expect(params[6]).toBe(true);     // includeDeferrals
    expect(params[7]).toBeNull();     // coverageFilter
  });

  it('binds coverage filter parameter for deferrals_kb_missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await getKnowledgeGapClusters({
      dateRange: { kind: '30d' }, role: 'both', podIds: [], repIds: [],
      sourceFilter: 'deferrals_kb_missing', visibleRepIds: ['rep-a'],
    });
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[5]).toBe(false);     // includeGaps disabled
    expect(params[6]).toBe(true);      // includeDeferrals
    expect(params[7]).toBe('missing'); // coverage filter
    expect(mockQuery.mock.calls[0][0]).toMatch(/d\.kb_coverage = \$8/);
  });

  it('drops the synonyms map param entirely (KB_VOCAB_SYNONYMS retired)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await getKnowledgeGapClusters({
      dateRange: { kind: '30d' }, role: 'both', podIds: [], repIds: [],
      sourceFilter: 'all', visibleRepIds: ['rep-a'],
    });
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toHaveLength(8);
    expect(params[8]).toBeUndefined();
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain('$9');
    expect(sql).not.toContain('kb_vocab_topics');
  });

  describe('SQL structure (new bucket-by-structured-field design)', () => {
    beforeEach(() => mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }));

    const baseArgs = {
      dateRange: { kind: '30d' as const }, role: 'both' as const,
      podIds: [], repIds: [], sourceFilter: 'all' as const,
      visibleRepIds: ['rep-a'],
    };

    it('uses CASE on expected_source with position(/) = 0 single-segment guard (council C3)', async () => {
      await getKnowledgeGapClusters(baseArgs);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("position('/' IN kg.item->>'expected_source') = 0");
      expect(sql).toContain("split_part(kg.item->>'expected_source','/',1)");
      expect(sql).toContain("split_part(kg.item->>'expected_source','/',2)");
    });

    it('uses LEFT JOIN LATERAL with deterministic chunk_index, id tie-breaker (council C4)', async () => {
      await getKnowledgeGapClusters(baseArgs);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toMatch(/LEFT JOIN LATERAL/);
      expect(sql).toContain('ORDER BY chunk_index, id');
      expect(sql).toContain('AND is_active = true');
    });

    it('uses ROW_NUMBER() window function for evidence sampling (council C5)', async () => {
      await getKnowledgeGapClusters(baseArgs);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('ROW_NUMBER() OVER');
      expect(sql).toContain('PARTITION BY bucket');
    });

    it('uses sliceCap = 5 in team mode (default)', async () => {
      await getKnowledgeGapClusters(baseArgs);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('rn <= 5');
      expect(sql).not.toContain('rn <= 200');
    });

    it('uses sliceCap = 200 in rep_focus mode', async () => {
      await getKnowledgeGapClusters({ ...baseArgs, mode: 'rep_focus' });
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('rn <= 200');
      expect(sql).not.toContain('rn <= 5');
    });

    it('aggregates with HAVING SUM > 0 and orders by total_occurrences DESC, bucket ASC', async () => {
      await getKnowledgeGapClusters(baseArgs);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('HAVING SUM(gap_count + deferral_count) > 0');
      expect(sql).toContain('ORDER BY total_occurrences DESC, bucket ASC');
    });

    it('synthetic test-data filter preserved on deferral side', async () => {
      await getKnowledgeGapClusters(baseArgs);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('d.is_synthetic_test_data = false');
    });

    it('advisor-eligible call filter preserved verbatim', async () => {
      await getKnowledgeGapClusters(baseArgs);
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain("cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call'");
    });
  });

  describe('row constructor', () => {
    it('shapes a row with bucket / bucketKind / sampleEvidence', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          bucket: 'profile/ideal-candidate-profile',
          bucket_kind: 'kb_path',
          total_occurrences: '5',
          gap_count: '4',
          deferral_count: '1',
          deferral_covered: '0',
          deferral_partial: '1',
          deferral_missing: '0',
          reps_arr: [{ repId: 'r1', repName: 'Alice' }],
          sample_eval_ids: ['e1', 'e2'],
          sample_evidence: [{
            evaluationId: 'e1',
            repId: 'r1',
            repName: 'Alice',
            kind: 'gap',
            text: 'missing ICP doc',
            callStartedAt: '2026-05-10T15:00:00Z',
            citations: [{ utterance_index: 12 }],
            expectedSource: 'profile/ideal-candidate-profile/age-bands',
            kbCoverage: null,
          }],
          rep_gap_map: { 'r1|gap': 4 },
          rep_def_map: { 'r1|def': 1 },
        }],
        rowCount: 1,
      });
      const rows = await getKnowledgeGapClusters({
        dateRange: { kind: '30d' }, role: 'both', podIds: [], repIds: [],
        sourceFilter: 'all', visibleRepIds: ['r1'],
      });
      expect(rows).toHaveLength(1);
      const r = rows[0];
      expect(r.bucket).toBe('profile/ideal-candidate-profile');
      expect(r.bucketKind).toBe('kb_path');
      expect(r.totalOccurrences).toBe(5);
      expect(r.sampleEvalIds).toEqual(['e1', 'e2']);
      expect(r.sampleEvidence).toHaveLength(1);
      const ev = r.sampleEvidence[0];
      expect(ev.evaluationId).toBe('e1');
      expect(ev.kind).toBe('gap');
      expect(ev.expectedSource).toBe('profile/ideal-candidate-profile/age-bands');
      expect(ev.citations).toEqual([{ utterance_index: 12 }]);
    });

    it('drops citation entries when neither utterance_index nor kb_source is populated (council S1)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          bucket: 'X', bucket_kind: 'kb_path', total_occurrences: '1',
          gap_count: '1', deferral_count: '0',
          deferral_covered: '0', deferral_partial: '0', deferral_missing: '0',
          reps_arr: [{ repId: 'r1', repName: 'A' }],
          sample_eval_ids: ['e1'],
          sample_evidence: [{
            evaluationId: 'e1', repId: 'r1', repName: 'A', kind: 'gap',
            text: 't', callStartedAt: null,
            citations: [
              { utterance_index: 3 },
              {},                       // empty — must be dropped
              { kb_source: {} },        // partial kb_source — also dropped (no chunk_id/doc_id)
            ],
            expectedSource: null, kbCoverage: null,
          }],
          rep_gap_map: { 'r1|gap': 1 }, rep_def_map: null,
        }],
        rowCount: 1,
      });
      const rows = await getKnowledgeGapClusters({
        dateRange: { kind: '30d' }, role: 'both', podIds: [], repIds: [],
        sourceFilter: 'all', visibleRepIds: ['r1'],
      });
      const cit = rows[0].sampleEvidence[0].citations;
      expect(cit).toHaveLength(1);
      expect(cit[0]).toEqual({ utterance_index: 3 });
    });
  });
});
