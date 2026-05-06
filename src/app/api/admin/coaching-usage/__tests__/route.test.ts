const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

jest.mock('@/lib/coachingDb', () => ({
  getCoachingPool: () => ({ query: mockQuery }),
  ALLOWED_RANGES: ['7d', '30d', '90d', 'all'],
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

// Two queries fire in parallel: DETAIL (LIMIT-less, ORDER BY ...) and CENSUS
// (single-row reps count). Dispatch the mock by SQL content.
function defaultMockImpl(sql: string) {
  if (sql.includes('active_coaching_users')) {
    return Promise.resolve({ rows: [{ active_coaching_users: '0' }], rowCount: 1 });
  }
  // DETAIL — empty by default; tests that need rows override.
  return Promise.resolve({ rows: [], rowCount: 0 });
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
    const res = await GET(makeReq('range=30d') as never);
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

  it("range='all' omits the lower-bound predicate entirely", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq('range=all') as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).not.toMatch(/interval '\d+ days'/);
    expect(allCalls).not.toContain("'-infinity'");
  });

  it('uses date_trunc-day cutoffs (calendar-day, not millisecond-rolling)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq('range=30d') as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toContain("date_trunc('day', now())");
  });

  it('uses call_started_at, not created_at, for date filtering', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toContain('cn.call_started_at >=');
  });

  it('advisor-facing rule: likely_call_type = advisor_call OR Kixie (no bound params)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const allCalls = mockQuery.mock.calls.map(c => c[0] as string).join('\n');
    expect(allCalls).toContain("cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call'");
    // Old email-heuristic plumbing is gone.
    expect(allCalls).not.toContain('attendees');
    expect(allCalls).not.toContain('unnest($1::text[])');
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
    expect(allCalls).toContain("'slack_dm_edit_eval'");
    expect(allCalls).not.toContain("'slack_dm_single_claim'");
  });

  it('response shape: activeCoachingUsers + drillDown[] + range + generated_at (no kpis/trend/filters)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('active_coaching_users')) {
        return Promise.resolve({ rows: [{ active_coaching_users: '42' }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const res = await GET(makeReq('range=7d') as never);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.activeCoachingUsers).toBe(42);
    expect(Array.isArray(body.drillDown)).toBe(true);
    expect(body.range).toBe('7d');
    expect(typeof body.generated_at).toBe('string');
    // The old aggregate blocks are gone — KPIs/trend/filters/sort are now
    // computed client-side from drillDown.
    expect(body).not.toHaveProperty('kpis');
    expect(body).not.toHaveProperty('trend');
    expect(body).not.toHaveProperty('filters');
    expect(body).not.toHaveProperty('sortBy');
    expect(body).not.toHaveProperty('sortDir');
  });

  it('drill-down SQL projects rep_id (used client-side for active-users-in-range)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    await GET(makeReq() as never);
    const detailSql = mockQuery.mock.calls.map(c => c[0] as string).find(s => s.includes('AS call_note_id')) ?? '';
    expect(detailSql).toContain('cn.rep_id AS rep_id');
    expect(detailSql).toContain('sga.role AS rep_role');
  });

  it('does not crash when SGA/SGM rows are NULL (LEFT JOIN system rep)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'abc', call_date: new Date('2026-04-01T12:00:00Z'),
            rep_id: null, sga_name: null, rep_role: null, sgm_name: null, source: 'granola',
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
    expect(body.drillDown[0]!.sgaName).toBeNull();
    expect(body.drillDown[0]!.sgmName).toBeNull();
  });

  it('advisor cascade: sfdc_who_id resolves to a Lead/Contact name', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'k1', call_date: new Date('2026-04-01T12:00:00Z'),
            rep_id: 'rep-1', sga_name: 'Eleni S.', rep_role: 'SGA', sgm_name: null, source: 'kixie',
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
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; advisorEmail: string|null; advisorEmailExtras: string[]; repId: string|null }> };
    expect(body.drillDown[0]!.advisorName).toBe('Russell Moss');
    expect(body.drillDown[0]!.advisorEmail).toBeNull();
    expect(body.drillDown[0]!.advisorEmailExtras).toEqual([]);
    expect(body.drillDown[0]!.repId).toBe('rep-1');
    expect(mockResolveAdvisorNames).toHaveBeenCalledTimes(1);
    expect(mockResolveAdvisorNames.mock.calls[0]![0]).toMatchObject({
      whoIds: ['00QVS00000NyAk12AF'],
    });
  });

  it('advisor cascade: no who_id, single external email resolves uniquely → name wins', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'g1', call_date: new Date('2026-04-01T12:00:00Z'),
            rep_id: 'rep-1', sga_name: 'Eleni S.', rep_role: 'SGA', sgm_name: null, source: 'granola',
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
    expect(body.drillDown[0]!.advisorName).toBe('Carl Campbell');
    expect(body.drillDown[0]!.advisorEmail).toBeNull();
    expect(body.drillDown[0]!.advisorEmailExtras).toEqual([]);
    // Internal Savvy email is NOT sent to the resolver
    expect(mockResolveAdvisorNames.mock.calls[0]![0].emails).toEqual(['advisor@acme.com']);
  });

  it("advisor cascade: no who_id, multiple externals, none uniquely resolve → first email + tooltip with rest", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'g2', call_date: new Date('2026-04-01T12:00:00Z'),
            rep_id: null, sga_name: null, rep_role: null, sgm_name: null, source: 'granola',
            sfdc_who_id: null, sfdc_record_type: null,
            invitee_emails: ['a@acme.com', 'b@acme.com', 'eleni@savvyadvisors.com'],
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({ whoIdToInfo: {}, emailToUniqueInfo: {} });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; advisorEmail: string|null; advisorEmailExtras: string[] }> };
    expect(body.drillDown[0]!.advisorName).toBeNull();
    expect(body.drillDown[0]!.advisorEmail).toBe('a@acme.com');
    expect(body.drillDown[0]!.advisorEmailExtras).toEqual(['b@acme.com']);
  });

  it("advisor cascade: no who_id and no external email → null/null/[] (client renders 'Unknown')", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'k2', call_date: new Date('2026-04-01T12:00:00Z'),
            rep_id: null, sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
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
    expect(body.drillDown[0]!.advisorName).toBeNull();
    expect(body.drillDown[0]!.advisorEmail).toBeNull();
    expect(body.drillDown[0]!.advisorEmailExtras).toEqual([]);
  });

  it('status fields propagate from resolver into each drill-down row', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 's1', call_date: new Date('2026-04-01T12:00:00Z'),
            rep_id: 'rep-1', sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
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
    const body = await res.json() as { drillDown: Array<{ advisorName: string; didSql: boolean; didSqo: boolean; currentStage: string|null; closedLost: boolean; linkedToSfdc: boolean }> };
    expect(body.drillDown[0]!.advisorName).toBe('Carla Ramirez');
    expect(body.drillDown[0]!.didSql).toBe(true);
    expect(body.drillDown[0]!.didSqo).toBe(true);
    expect(body.drillDown[0]!.currentStage).toBe('Sales Process');
    expect(body.drillDown[0]!.closedLost).toBe(false);
    expect(body.drillDown[0]!.linkedToSfdc).toBe(true);
  });

  it('status fields default to false / null when advisor cannot be linked', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 's2', call_date: new Date('2026-04-01T12:00:00Z'),
            rep_id: null, sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
            sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ didSql: boolean; didSqo: boolean; currentStage: string|null; closedLost: boolean; linkedToSfdc: boolean }> };
    expect(body.drillDown[0]!.didSql).toBe(false);
    expect(body.drillDown[0]!.didSqo).toBe(false);
    expect(body.drillDown[0]!.currentStage).toBeNull();
    expect(body.drillDown[0]!.closedLost).toBe(false);
    expect(body.drillDown[0]!.linkedToSfdc).toBe(false);
  });

  it('drill-down response strips internal SFDC fields (sfdc_who_id, sfdc_record_type, invitee_emails)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'k3', call_date: new Date('2026-04-01T12:00:00Z'),
            rep_id: null, sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
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

  it('SFDC deep-links: leadUrl/opportunityUrl built from resolver IDs; null when unlinked', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [
            // Linked + has primary opp → both URLs.
            { call_note_id: 'a', call_date: new Date('2026-04-01T12:00:00Z'),
              rep_id: 'rep-1', sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: 'LINKED', sfdc_record_type: 'Lead', invitee_emails: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            // Unlinked → both null.
            { call_note_id: 'b', call_date: new Date('2026-04-01T12:00:00Z'),
              rep_id: null, sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
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
        'LINKED': {
          name: 'Linked Person', leadId: '00Q123', opportunityId: '0061234',
          didSql: false, didSqo: false, currentStage: null, closedLost: false,
        },
      },
      emailToUniqueInfo: {},
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ callNoteId: string; leadUrl: string|null; opportunityUrl: string|null }> };
    const linked = body.drillDown.find(r => r.callNoteId === 'a')!;
    const unlinked = body.drillDown.find(r => r.callNoteId === 'b')!;
    expect(linked.leadUrl).toBe('https://savvywealth.lightning.force.com/lightning/r/Lead/00Q123/view');
    expect(linked.opportunityUrl).toBe('https://savvywealth.lightning.force.com/lightning/r/Opportunity/0061234/view');
    expect(unlinked.leadUrl).toBeNull();
    expect(unlinked.opportunityUrl).toBeNull();
  });
});
