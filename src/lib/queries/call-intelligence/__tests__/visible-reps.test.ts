import { getRepIdsVisibleToActor } from '../visible-reps';

const mockQuery = jest.fn();
jest.mock('@/lib/coachingDb', () => ({
  getCoachingPool: () => ({ query: mockQuery }),
}));

beforeEach(() => mockQuery.mockReset());

describe('getRepIdsVisibleToActor', () => {
  it('admin gets all active non-system reps via short-circuit SQL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a' }, { id: 'b' }], rowCount: 2 });
    const result = await getRepIdsVisibleToActor({
      repId: 'admin-1', role: 'admin', email: 'a@b.com',
    });
    expect(result).toEqual(['a', 'b']);
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE is_active = true AND is_system = false/);
  });

  it('revops_admin uses admin short-circuit too', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'x' }], rowCount: 1 });
    const result = await getRepIdsVisibleToActor({
      repId: 'r-1', role: 'revops_admin', email: 'r@b.com',
    });
    expect(result).toEqual(['x']);
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/coaching_team_members/);
  });

  it('manager triggers UNION query with all 3 branches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }, { id: 'p2' }], rowCount: 2 });
    const result = await getRepIdsVisibleToActor({
      repId: 'nick-uuid', role: 'manager', email: 'nick@savvy.com',
    });
    expect(result).toEqual(['p1', 'p2']);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/r\.manager_id = \$1/);
    expect(sql).toMatch(/coaching_team_members/);
    expect(sql).toMatch(/coaching_observers/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['nick-uuid']);
  });
});
