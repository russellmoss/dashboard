const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

jest.mock('@/lib/coachingDb', () => ({
  getCoachingPool: () => ({ query: mockQuery }),
  ALLOWED_RANGES: ['7d', '30d', '90d', 'all'],
  ALLOWED_SORT_FIELDS: ['call_date', 'sga_name', 'sgm_name'],
  ALLOWED_SORT_DIRS: ['asc', 'desc'],
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

const mockGetSessionPermissions = jest.fn();
jest.mock('@/types/auth', () => ({
  getSessionPermissions: (...args: unknown[]) => mockGetSessionPermissions(...args),
}));
jest.mock('@/lib/cache', () => ({
  cachedQuery: <T extends (...a: unknown[]) => unknown>(fn: T) => fn,
  CACHE_TAGS: { COACHING_USAGE: 'coaching-usage' },
}));

const mockResolveAdvisorNames = jest.fn();
jest.mock('@/lib/queries/resolve-advisor-names', () => ({
  resolveAdvisorNames: (...args: unknown[]) => mockResolveAdvisorNames(...args),
}));

import { GET } from '../route';
import { getServerSession } from 'next-auth';

function makeReq(qs = ''): Request {
  return new Request(`http://localhost/api/admin/coaching-usage${qs ? '?' + qs : ''}`);
}

// Dispatches mock pg-row shape by SQL content. The route fires three queries
// in parallel (KPI, TREND, DETAIL); each has a different RowDescription shape.
// Without this, an empty/wrong row shape crashes the trend mapper on r.month.toISOString().
function defaultMockImpl(sql: string) {
  if (sql.includes('LIMIT 500')) {
    // DETAIL query — empty by default (tests that need rows override per-call)
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
  if (sql.includes('generate_series')) {
    // TREND query — return one synthetic month row so the mapper passes
    return Promise.resolve({
      rows: [{
        month: new Date('2026-04-01T00:00:00Z'),
        advisor_facing_calls: '0',
        pushed_to_sfdc: '0',
        with_ai_feedback: '0',
        with_manager_edit_eval: '0',
        raw_note_volume: '0',
      }],
      rowCount: 1,
    });
  }
  // KPI query (default)
  return Promise.resolve({
    rows: [{
      active_coaching_users: '0', active_users_in_range: '0',
      total_advisor_facing_calls: '0',
      pushed_to_sfdc: '0', with_ai_feedback: '0', with_manager_edit_eval: '0',
      raw_granola: '0', raw_kixie: '0',
    }],
    rowCount: 1,
  });
}

describe('GET /api/admin/coaching-usage', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockQuery.mockImplementation(defaultMockImpl);
    mockGetSessionPermissions.mockReset();
    mockResolveAdvisorNames.mockReset();
    // Default resolver: no SFDC matches. Tests that need SFDC names override.
    mockResolveAdvisorNames.mockResolvedValue({ whoIdToInfo: {}, emailToUniqueInfo: {} });
  });

  it('returns 401 when no session', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(401);
  });

  it('returns 403 when role is not revops_admin', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'admin' });
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(403);
  });

  it('200 when role is revops_admin', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const res = await GET(makeReq('range=30d&sortBy=call_date&sortDir=desc') as never);
    expect(res.status).toBe(200);
  });

  it('clamps invalid range to 30d', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const res = await GET(makeReq('range=evil') as never);
    expect(res.status).toBe(200);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toContain("interval '30 days'");
  });

  it('clamps invalid sortBy to call_date', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const res = await GET(makeReq('sortBy=DROP TABLE') as never);
    expect(res.status).toBe(200);
    const detailSql = mockQuery.mock.calls.map(c => c[0] as string).find(s => s.includes('LIMIT 500')) ?? '';
    expect(detailSql).toContain('cn.call_started_at');
    expect(detailSql).not.toContain('DROP TABLE');
  });

  it('advisor-facing rule: likely_call_type = advisor_call OR Kixie (no bound params)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    // KPI + TREND + DETAIL all use the new rule.
    const advisorRulePattern = /cn\.source = 'kixie' OR cn\.likely_call_type = 'advisor_call'/g;
    const matches = allCalls.match(advisorRulePattern) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    // Old email-heuristic plumbing is gone.
    expect(allCalls).not.toContain('attendees');
    expect(allCalls).not.toContain('unnest($1::text[])');
    expect(allCalls).not.toMatch(/NOT LIKE '%@savvywealth\.com'/);
    // Queries fire without bound params now.
    for (const call of mockQuery.mock.calls) {
      expect(call[1]).toBeUndefined();
    }
  });

  it('counts both slack_dm_edit_eval_text AND slack_dm_edit_eval; never _single_claim', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toContain("'slack_dm_edit_eval_text'");
    expect(allCalls).toContain("'slack_dm_edit_eval'");      // multi-claim flow ALSO counts
    expect(allCalls).not.toContain("'slack_dm_single_claim'"); // AI-Feedback flag flow — covered by metric #4 instead
  });

  it('exposes both census and period-usage active-user counts', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { kpis: { activeCoachingUsers: number; activeUsersInRange: number } };
    expect(typeof body.kpis.activeCoachingUsers).toBe('number');
    expect(typeof body.kpis.activeUsersInRange).toBe('number');
    // KPI SQL produces both columns
    const kpiSql = mockQuery.mock.calls.map(c => c[0] as string).find(s => s.includes('active_coaching_users')) ?? '';
    expect(kpiSql).toContain('active_users_in_range');
  });

  it('uses call_started_at, not created_at, for date filtering', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toContain('cn.call_started_at >=');
  });

  it("range='all' omits the lower-bound predicate entirely", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq('range=all') as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    // The KPI + DETAIL queries use rangeWhere; for 'all' they should have no `interval 'N days'`.
    // The TREND query is hardcoded to "5 months" so we filter it out before checking days.
    const nonTrendCalls = mockQuery.mock.calls
      .map(c => c[0] as string)
      .filter(s => !s.includes('generate_series'))
      .join('\n');
    expect(nonTrendCalls).not.toMatch(/interval '\d+ days'/);
    expect(allCalls).not.toContain("'-infinity'");
  });

  it('uses date_trunc-day cutoffs (calendar-day, not millisecond-rolling)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq('range=30d') as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toContain("date_trunc('day', now())");
  });

  it('drill-down WHERE matches the KPI advisor-facing rule (so headline counts line up)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const detailSql = mockQuery.mock.calls.map(c => c[0] as string).find(s => s.includes('LIMIT 500')) ?? '';
    // The drill-down uses the same rule as the KPI/TREND CTE — Kixie always,
    // Granola only when likely_call_type = 'advisor_call'.
    expect(detailSql).toContain("cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call'");
  });

  it('does not crash when SGA/SGM rows are NULL (LEFT JOIN system rep)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    // Detail query returns a row with null sga_name/sgm_name; KPI + TREND
    // fall through to the shape-aware default impl.
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'abc', call_date: new Date('2026-04-01T12:00:00Z'),
            sga_name: null, rep_role: null, sgm_name: null, source: 'granola',
            sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { drillDown: Array<{ sgaName: string|null; sgmName: string|null }> };
    expect(body.drillDown[0].sgaName).toBeNull();
    expect(body.drillDown[0].sgmName).toBeNull();
  });

  it('drill-down SELECT includes sfdc_who_id, sfdc_record_type, invitee_emails (server-side only)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const detailSql = mockQuery.mock.calls.map(c => c[0] as string).find(s => s.includes('LIMIT 500')) ?? '';
    expect(detailSql).toContain('cn.sfdc_who_id');
    expect(detailSql).toContain('cn.sfdc_record_type');
    expect(detailSql).toContain('cn.invitee_emails');
  });

  it('advisor cascade: sfdc_who_id resolves to a Lead/Contact name', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'k1', call_date: new Date('2026-04-01T12:00:00Z'),
            sga_name: 'Eleni S.', rep_role: 'SGA', sgm_name: null, source: 'kixie',
            sfdc_who_id: '00QVS00000NyAk12AF', sfdc_record_type: 'Lead', invitee_emails: null,
            pushed_to_sfdc: true, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {
        '00QVS00000NyAk12AF': { name: 'Russell Moss', didSql: true, didSqo: true, currentStage: 'Negotiating', closedLost: false },
      },
      emailToUniqueInfo: {},
    });
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; advisorEmail: string|null; advisorEmailExtras: string[] }> };
    expect(body.drillDown[0].advisorName).toBe('Russell Moss');
    expect(body.drillDown[0].advisorEmail).toBeNull();
    expect(body.drillDown[0].advisorEmailExtras).toEqual([]);
    // Resolver was called with the who_id collected from the row
    expect(mockResolveAdvisorNames).toHaveBeenCalledTimes(1);
    expect(mockResolveAdvisorNames.mock.calls[0]![0]).toMatchObject({
      whoIds: ['00QVS00000NyAk12AF'],
    });
  });

  it('advisor cascade: no who_id, single external email resolves uniquely → name wins', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'g1', call_date: new Date('2026-04-01T12:00:00Z'),
            sga_name: 'Eleni S.', rep_role: 'SGA', sgm_name: null, source: 'granola',
            sfdc_who_id: null, sfdc_record_type: null,
            invitee_emails: ['advisor@acme.com', 'eleni@savvywealth.com'],
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {},
      emailToUniqueInfo: {
        'advisor@acme.com': { name: 'Carl Campbell', didSql: false, didSqo: false, currentStage: 'New', closedLost: false },
      },
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; advisorEmail: string|null; advisorEmailExtras: string[] }> };
    expect(body.drillDown[0].advisorName).toBe('Carl Campbell');
    expect(body.drillDown[0].advisorEmail).toBeNull();
    expect(body.drillDown[0].advisorEmailExtras).toEqual([]);
    // Internal Savvy email is NOT sent to the resolver
    expect(mockResolveAdvisorNames.mock.calls[0]![0].emails).toEqual(['advisor@acme.com']);
  });

  it("advisor cascade: no who_id, multiple externals, none uniquely resolve → first email + tooltip with rest", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'g2', call_date: new Date('2026-04-01T12:00:00Z'),
            sga_name: null, rep_role: null, sgm_name: null, source: 'granola',
            sfdc_who_id: null, sfdc_record_type: null,
            invitee_emails: ['a@acme.com', 'b@acme.com', 'eleni@savvyadvisors.com'],
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    // Resolver finds nothing unique
    mockResolveAdvisorNames.mockResolvedValue({ whoIdToInfo: {}, emailToUniqueInfo: {} });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; advisorEmail: string|null; advisorEmailExtras: string[] }> };
    expect(body.drillDown[0].advisorName).toBeNull();
    expect(body.drillDown[0].advisorEmail).toBe('a@acme.com');
    expect(body.drillDown[0].advisorEmailExtras).toEqual(['b@acme.com']);
  });

  it("advisor cascade: no who_id and no external email → null/null/[] (client renders 'Unknown')", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'k2', call_date: new Date('2026-04-01T12:00:00Z'),
            sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
            sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; advisorEmail: string|null; advisorEmailExtras: string[] }> };
    expect(body.drillDown[0].advisorName).toBeNull();
    expect(body.drillDown[0].advisorEmail).toBeNull();
    expect(body.drillDown[0].advisorEmailExtras).toEqual([]);
  });

  it('status fields propagate from resolver into each drill-down row', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 's1', call_date: new Date('2026-04-01T12:00:00Z'),
            sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
            sfdc_who_id: 'WHO-MATCHED', sfdc_record_type: 'Lead', invitee_emails: null,
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {
        'WHO-MATCHED': { name: 'Carla Ramirez', didSql: true, didSqo: true, currentStage: 'Sales Process', closedLost: false },
      },
      emailToUniqueInfo: {},
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ advisorName: string; didSql: boolean; didSqo: boolean; currentStage: string|null; closedLost: boolean }> };
    expect(body.drillDown[0].advisorName).toBe('Carla Ramirez');
    expect(body.drillDown[0].didSql).toBe(true);
    expect(body.drillDown[0].didSqo).toBe(true);
    expect(body.drillDown[0].currentStage).toBe('Sales Process');
    expect(body.drillDown[0].closedLost).toBe(false);
  });

  it('status fields default to false / null when advisor cannot be linked', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 's2', call_date: new Date('2026-04-01T12:00:00Z'),
            sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
            sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ didSql: boolean; didSqo: boolean; currentStage: string|null; closedLost: boolean }> };
    expect(body.drillDown[0].didSql).toBe(false);
    expect(body.drillDown[0].didSqo).toBe(false);
    expect(body.drillDown[0].currentStage).toBeNull();
    expect(body.drillDown[0].closedLost).toBe(false);
  });

  it('filter sql=yes drops rows where didSql=false', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [
            { call_note_id: 'a', call_date: new Date('2026-04-01T12:00:00Z'), sga_name: null, rep_role: 'SGA', sgm_name: null, source: 'kixie',
              sfdc_who_id: 'WHO-A', sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            { call_note_id: 'b', call_date: new Date('2026-04-01T12:00:00Z'), sga_name: null, rep_role: 'SGA', sgm_name: null, source: 'kixie',
              sfdc_who_id: 'WHO-B', sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
          ],
          rowCount: 2,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {
        'WHO-A': { name: 'A', didSql: true,  didSqo: false, currentStage: 'MQL',         closedLost: false },
        'WHO-B': { name: 'B', didSql: false, didSqo: false, currentStage: 'New',         closedLost: false },
      },
      emailToUniqueInfo: {},
    });
    const res = await GET(makeReq('sql=yes') as never);
    const body = await res.json() as { drillDown: Array<{ callNoteId: string }>; filters: { sql: string } };
    expect(body.filters.sql).toBe('yes');
    expect(body.drillDown.map((r) => r.callNoteId)).toEqual(['a']);
  });

  it("filter sqo=yes&closedLost=no keeps only SQO'd, currently-open advisors", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [
            { call_note_id: 'open',     call_date: new Date('2026-04-01T12:00:00Z'), sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: 'OPEN',     sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            { call_note_id: 'lost',     call_date: new Date('2026-04-01T12:00:00Z'), sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: 'LOST',     sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            { call_note_id: 'no-sqo',   call_date: new Date('2026-04-01T12:00:00Z'), sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: 'NOSQO',    sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
          ],
          rowCount: 3,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {
        'OPEN':  { name: 'Open',   didSql: true, didSqo: true,  currentStage: 'Negotiating', closedLost: false },
        'LOST':  { name: 'Lost',   didSql: true, didSqo: true,  currentStage: 'Closed Lost', closedLost: true  },
        'NOSQO': { name: 'NoSqo',  didSql: true, didSqo: false, currentStage: 'MQL',         closedLost: false },
      },
      emailToUniqueInfo: {},
    });
    const res = await GET(makeReq('sqo=yes&closedLost=no') as never);
    const body = await res.json() as { drillDown: Array<{ callNoteId: string }> };
    expect(body.drillDown.map((r) => r.callNoteId)).toEqual(['open']);
  });

  it('filter stages=Negotiating,Discovery is case-insensitive multi-select', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [
            { call_note_id: 'neg',   call_date: new Date('2026-04-01T12:00:00Z'), sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: 'NEG', sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            { call_note_id: 'disc',  call_date: new Date('2026-04-01T12:00:00Z'), sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: 'DISC', sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            { call_note_id: 'mql',   call_date: new Date('2026-04-01T12:00:00Z'), sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: 'MQL', sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
          ],
          rowCount: 3,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {
        'NEG':  { name: 'A', didSql: true, didSqo: true, currentStage: 'Negotiating', closedLost: false },
        'DISC': { name: 'B', didSql: true, didSqo: true, currentStage: 'Discovery',   closedLost: false },
        'MQL':  { name: 'C', didSql: false, didSqo: false, currentStage: 'MQL',       closedLost: false },
      },
      emailToUniqueInfo: {},
    });
    const res = await GET(makeReq('stages=Negotiating,Discovery') as never);
    const body = await res.json() as { drillDown: Array<{ callNoteId: string }>; filters: { stages: string[] } };
    expect(body.filters.stages).toEqual(['Negotiating', 'Discovery']);
    expect(body.drillDown.map((r) => r.callNoteId).sort()).toEqual(['disc', 'neg']);
  });

  it('repRole=SGA filter keeps only rows where rep_role=SGA', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [
            { call_note_id: 'sga1', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: 'Bre M', rep_role: 'SGA', sgm_name: null, source: 'granola',
              sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            { call_note_id: 'sgm1', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: 'David H', rep_role: 'SGM', sgm_name: null, source: 'granola',
              sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            { call_note_id: 'admin1', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: 'Russell', rep_role: 'admin', sgm_name: null, source: 'granola',
              sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
          ],
          rowCount: 3,
        });
      }
      return defaultMockImpl(sql);
    });
    const res = await GET(makeReq('repRole=SGA') as never);
    const body = await res.json() as { drillDown: Array<{ callNoteId: string; repRole: string|null }>; filters: { repRole: string } };
    expect(body.filters.repRole).toBe('SGA');
    expect(body.drillDown.map((r) => r.callNoteId)).toEqual(['sga1']);
    expect(body.drillDown[0]!.repRole).toBe('SGA');
  });

  it('repRole=SGM keeps only SGM rows; admin/manager/null are excluded', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [
            { call_note_id: 'sga', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: 'A', rep_role: 'SGA', sgm_name: null, source: 'granola',
              sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            { call_note_id: 'sgm', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: 'B', rep_role: 'SGM', sgm_name: null, source: 'granola',
              sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            { call_note_id: 'unassigned', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: 'C', rep_role: null, sgm_name: null, source: 'granola',
              sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
          ],
          rowCount: 3,
        });
      }
      return defaultMockImpl(sql);
    });
    const res = await GET(makeReq('repRole=SGM') as never);
    const body = await res.json() as { drillDown: Array<{ callNoteId: string }> };
    expect(body.drillDown.map((r) => r.callNoteId)).toEqual(['sgm']);
  });

  it('repRole=any (default) returns all rows regardless of rep_role', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [
            { call_note_id: 'sga', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: 'A', rep_role: 'SGA', sgm_name: null, source: 'granola',
              sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            { call_note_id: 'sgm', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: 'B', rep_role: 'SGM', sgm_name: null, source: 'granola',
              sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
          ],
          rowCount: 2,
        });
      }
      return defaultMockImpl(sql);
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ callNoteId: string; repRole: string|null }>; filters: { repRole: string } };
    expect(body.filters.repRole).toBe('any');
    expect(body.drillDown.map((r) => r.callNoteId).sort()).toEqual(['sga', 'sgm']);
    expect(body.drillDown[0]!.repRole).toMatch(/^SG[AM]$/);
  });

  it('drill-down SQL pulls reps.role as rep_role for the role filter + UI badge', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const detailSql = mockQuery.mock.calls.map(c => c[0] as string).find(s => s.includes('LIMIT 500')) ?? '';
    expect(detailSql).toContain('sga.role AS rep_role');
  });

  it('any active filter drops unlinked rows; with no filters all rows are returned', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [
            // Linked row (info returned by resolver below)
            { call_note_id: 'linked', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: 'LINKED', sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            // Unlinked row — no who_id, no external email
            { call_note_id: 'unlinked', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
          ],
          rowCount: 2,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {
        'LINKED': { name: 'Linked Person', didSql: false, didSqo: false, currentStage: null, closedLost: false },
      },
      emailToUniqueInfo: {},
    });

    // No filters → both rows show up
    const noFilterRes = await GET(makeReq() as never);
    const noFilterBody = await noFilterRes.json() as { drillDown: Array<{ callNoteId: string }> };
    expect(noFilterBody.drillDown.map((r) => r.callNoteId).sort()).toEqual(['linked', 'unlinked']);

    // Any filter active → unlinked dropped (sql=no would otherwise have kept it)
    const filteredRes = await GET(makeReq('sql=no') as never);
    const filteredBody = await filteredRes.json() as { drillDown: Array<{ callNoteId: string }> };
    expect(filteredBody.drillDown.map((r) => r.callNoteId)).toEqual(['linked']);
  });

  it('invalid filter values default to "any" (no filter applied)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const res = await GET(makeReq('sql=evil&sqo=DROP&closedLost=null&pushed=maybe') as never);
    const body = await res.json() as { filters: { sql: string; sqo: string; closedLost: string; stages: string[]; pushed: string } };
    expect(body.filters.sql).toBe('any');
    expect(body.filters.sqo).toBe('any');
    expect(body.filters.closedLost).toBe('any');
    expect(body.filters.stages).toEqual([]);
    expect(body.filters.pushed).toBe('any');
  });

  it('pushed=no keeps only call_notes that were NOT pushed to SFDC; does NOT require SFDC linkage', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [
            // Pushed (linked) — should be dropped by pushed=no
            { call_note_id: 'pushed-linked', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: null, rep_role: 'SGA', sgm_name: null, source: 'kixie',
              sfdc_who_id: 'WHO-A', sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: true, has_ai_feedback: false, has_manager_edit_eval: false },
            // Not pushed (linked) — should be kept
            { call_note_id: 'unpushed-linked', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: null, rep_role: 'SGA', sgm_name: null, source: 'kixie',
              sfdc_who_id: 'WHO-B', sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            // Not pushed (UNlinked) — should also be kept (pushed filter does
            // NOT trigger the linkage requirement — it's per-call, not per-advisor)
            { call_note_id: 'unpushed-unlinked', call_date: new Date('2026-04-01T12:00:00Z'),
              sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
          ],
          rowCount: 3,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {
        'WHO-A': { name: 'A', didSql: false, didSqo: false, currentStage: null, closedLost: false },
        'WHO-B': { name: 'B', didSql: false, didSqo: false, currentStage: null, closedLost: false },
      },
      emailToUniqueInfo: {},
    });
    const res = await GET(makeReq('pushed=no') as never);
    const body = await res.json() as { drillDown: Array<{ callNoteId: string }> };
    expect(body.drillDown.map((r) => r.callNoteId).sort()).toEqual(['unpushed-linked', 'unpushed-unlinked']);
  });

  it('pushed=yes works alongside funnel filters (combined: SQO\'d AND pushed)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [
            { call_note_id: 'a', call_date: new Date('2026-04-01T12:00:00Z'), sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: 'A', sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: true,  has_ai_feedback: false, has_manager_edit_eval: false },
            { call_note_id: 'b', call_date: new Date('2026-04-01T12:00:00Z'), sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: 'B', sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            { call_note_id: 'c', call_date: new Date('2026-04-01T12:00:00Z'), sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: 'C', sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: true,  has_ai_feedback: false, has_manager_edit_eval: false },
          ],
          rowCount: 3,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {
        'A': { name: 'A', didSql: true, didSqo: true,  currentStage: 'Negotiating', closedLost: false }, // SQO + pushed → keep
        'B': { name: 'B', didSql: true, didSqo: true,  currentStage: 'Discovery',   closedLost: false }, // SQO but not pushed → drop
        'C': { name: 'C', didSql: true, didSqo: false, currentStage: null,          closedLost: false }, // pushed but not SQO → drop
      },
      emailToUniqueInfo: {},
    });
    const res = await GET(makeReq('sqo=yes&pushed=yes') as never);
    const body = await res.json() as { drillDown: Array<{ callNoteId: string }> };
    expect(body.drillDown.map((r) => r.callNoteId)).toEqual(['a']);
  });

  it('drill-down response strips internal SFDC fields (sfdc_who_id, sfdc_record_type, invitee_emails)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('LIMIT 500')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'k3', call_date: new Date('2026-04-01T12:00:00Z'),
            sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
            sfdc_who_id: '00QVS00000Sensitive', sfdc_record_type: 'Lead',
            invitee_emails: ['secret@example.com'],
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<Record<string, unknown>> };
    const row = body.drillDown[0]!;
    expect(row).not.toHaveProperty('sfdc_who_id');
    expect(row).not.toHaveProperty('sfdcWhoId');
    expect(row).not.toHaveProperty('sfdc_record_type');
    expect(row).not.toHaveProperty('invitee_emails');
    expect(row).not.toHaveProperty('inviteeEmails');
  });
});
