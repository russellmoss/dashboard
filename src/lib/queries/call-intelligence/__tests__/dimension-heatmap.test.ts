import { getDimensionHeatmap } from '../dimension-heatmap';

const mockQuery = jest.fn();
jest.mock('@/lib/coachingDb', () => ({
  getCoachingPool: () => ({ query: mockQuery }),
}));

beforeEach(() => mockQuery.mockReset());

describe('getDimensionHeatmap', () => {
  it('returns empty when visibleRepIds is empty', async () => {
    const result = await getDimensionHeatmap({
      dateRange: { kind: '30d' }, role: 'both', podIds: [], repIds: [],
      rubricVersion: null, visibleRepIds: [],
    });
    expect(result).toEqual({ rowBlocks: [], sparklines: null });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('groups by (role, rubric_version, pod) and emits per-block cell arrays', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { role: 'SGM', rubric_version: 1, pod_label: "Nick's SGM Pod", pod_id: 'nick-pod',
          lead_full_name: 'Nick Hampson', dimension_name: 'intro_call_framing',
          avg_score: '3.4', n: '8' },
        { role: 'SGM', rubric_version: 1, pod_label: "Nick's SGM Pod", pod_id: 'nick-pod',
          lead_full_name: 'Nick Hampson', dimension_name: 'qualification',
          avg_score: '2.1', n: '8' },
        { role: 'SGA', rubric_version: 1, pod_label: '__SGA__', pod_id: null,
          lead_full_name: null, dimension_name: 'discovery_call_structure',
          avg_score: '3.8', n: '15' },
      ],
      rowCount: 3,
    });
    const result = await getDimensionHeatmap({
      dateRange: { kind: '7d' }, role: 'both', podIds: [], repIds: [],
      rubricVersion: null, visibleRepIds: ['rep-a', 'rep-b'],
    });
    expect(result.rowBlocks).toHaveLength(2);
    expect(result.rowBlocks[0].cells).toHaveLength(2);
    expect(result.sparklines).toBeNull();
  });

  it('issues trend-comparison query when repIds.length === 1', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // grid query
      .mockResolvedValueOnce({                            // trend-comparison query
        rows: [
          { dimension_name: 'intro_call_framing', current_avg: '3.4', prior_avg: '2.9', current_n: '5', prior_n: '4' },
          { dimension_name: 'kicker_introduction_timing', current_avg: '2.1', prior_avg: null, current_n: '3', prior_n: '0' },
        ], rowCount: 2,
      });
    const result = await getDimensionHeatmap({
      dateRange: { kind: '30d' }, role: 'both', podIds: [], repIds: ['rep-x'],
      rubricVersion: null, visibleRepIds: ['rep-x'],
    });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(result.sparklines).toHaveLength(2);
    expect(result.sparklines![0]).toMatchObject({
      dimensionName: 'intro_call_framing',
      currentAvg: 3.4, currentN: 5, priorAvg: 2.9, priorN: 4,
    });
    expect(result.sparklines![0].delta).toBeCloseTo(0.5, 5);
    // Null-prior row: delta must be null, not NaN
    expect(result.sparklines![1].priorAvg).toBeNull();
    expect(result.sparklines![1].delta).toBeNull();
  });
});
