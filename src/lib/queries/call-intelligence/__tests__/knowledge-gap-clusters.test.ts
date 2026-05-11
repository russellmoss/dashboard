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
    expect(params[5]).toBe(true);   // includeGaps
    expect(params[6]).toBe(true);   // includeDeferrals
    expect(params[7]).toBeNull();   // coverageFilter
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
    // No SQL injection — the d.kb_coverage filter uses the $8 placeholder, not the raw value.
    expect(mockQuery.mock.calls[0][0]).toMatch(/d\.kb_coverage = \$8/);
  });

  it('passes synonyms map as $9 jsonb parameter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await getKnowledgeGapClusters({
      dateRange: { kind: '30d' }, role: 'both', podIds: [], repIds: [],
      sourceFilter: 'all', visibleRepIds: ['rep-a'],
    });
    const params = mockQuery.mock.calls[0][1] as unknown[];
    const synonymsJson = params[8] as string;
    expect(typeof synonymsJson).toBe('string');
    const parsed = JSON.parse(synonymsJson);
    expect(parsed.annuity).toEqual(['annuity', 'annuities']);
  });
});
