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
    mockResolveAdvisorNames.mockResolvedValue({ whoIdToInfo: {}, whatIdToInfo: {}, contactAccountOppToInfo: {}, emailToUniqueInfo: {}, kixieTaskIdToInfo: {} });
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
            kixie_task_id: null,
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
            kixie_task_id: '00TVS00000Task001',
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
      kixieTaskIdToInfo: {},
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

  it('advisor cascade: kixie row with NULL sfdc_who_id self-heals via kixie_task_id → Task.WhoId', async () => {
    // Repro of the SFDC↔BQ sync-lag case: call_notes.sfdc_who_id was baked
    // in as NULL (Task.WhoId not yet associated when call-transcriber ran),
    // but BQ has since caught up. The kixie_task_id arm of the resolver
    // should pick the row up and surface the advisor's name.
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'k-heal', call_date: new Date('2026-05-06T15:10:52Z'),
            rep_id: 'rep-1', sga_name: 'Jason A.', rep_role: 'SGA', sgm_name: null, source: 'kixie',
            // The defining detail: who_id is NULL but the kixie task ref is set.
            sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
            kixie_task_id: '00TVS00000nAdLw2AK',
            pushed_to_sfdc: true, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {},
      emailToUniqueInfo: {},
      kixieTaskIdToInfo: {
        '00TVS00000nAdLw2AK': {
          name: 'Joseph Pigot', leadId: '00QVS00000UXMGb2AP', opportunityId: null,
          didSql: false, didSqo: false, currentStage: null, closedLost: false,
        },
      },
    });
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; advisorEmail: string|null; linkedToSfdc: boolean; leadUrl: string|null }> };
    expect(body.drillDown[0]!.advisorName).toBe('Joseph Pigot');
    expect(body.drillDown[0]!.advisorEmail).toBeNull();
    expect(body.drillDown[0]!.linkedToSfdc).toBe(true);
    expect(body.drillDown[0]!.leadUrl).toBe('https://savvywealth.lightning.force.com/lightning/r/Lead/00QVS00000UXMGb2AP/view');
    // Resolver was called with the kixie task id; whoIds was empty.
    expect(mockResolveAdvisorNames.mock.calls[0]![0]).toMatchObject({
      whoIds: [],
      kixieTaskIds: ['00TVS00000nAdLw2AK'],
    });
  });

  it('advisor cascade: who_id wins when both arms can resolve; all fallback inputs still collected', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'k-direct', call_date: new Date('2026-05-06T15:10:52Z'),
            rep_id: 'rep-1', sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
            sfdc_who_id: 'WHO-DIRECT', sfdc_record_type: 'Lead', invitee_emails: null,
            kixie_task_id: '00TVS00000someTask',
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {
        'WHO-DIRECT': { name: 'Direct Match', leadId: '00Qdirect', opportunityId: null,
          didSql: false, didSqo: false, currentStage: null, closedLost: false },
      },
      emailToUniqueInfo: {},
      kixieTaskIdToInfo: {},
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null }> };
    expect(body.drillDown[0]!.advisorName).toBe('Direct Match');
    // Fallback inputs are collected unconditionally — the cascade decides
    // which one wins per row at row-mapping time. This guarantees the kixie
    // self-heal and email arms have data to fall through to when whoId
    // misses BQ (e.g. brand-new Lead not yet sync'd from SFDC).
    expect(mockResolveAdvisorNames.mock.calls[0]![0]).toMatchObject({
      whoIds: ['WHO-DIRECT'],
      kixieTaskIds: ['00TVS00000someTask'],
    });
  });

  it('advisor cascade: sfdc_who_id set but BQ misses → falls through to email (Fivetran-lag case)', async () => {
    // Repro of the same-day-Lead case for kixie/Granola alike: the call_note
    // row was correctly populated with sfdc_who_id at write time, but the
    // referenced Lead/Contact hasn't sync'd to BQ yet — and the row also
    // carries an invitee email that does match an existing BQ Lead. The
    // cascade must fall through to the email arm instead of giving up.
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'k-rahul', call_date: new Date('2026-05-06T17:40:11Z'),
            rep_id: 'rep-1', sga_name: 'Perry K.', rep_role: 'SGA', sgm_name: null, source: 'kixie',
            // sfdc_who_id is set — points at a Contact not yet in BQ.
            sfdc_who_id: '003VS00000dfJD7YAM', sfdc_record_type: 'Contact',
            invitee_emails: ['rahul18sarin@gmail.com'],
            kixie_task_id: '00TVS00000nB7dM2AS',
            pushed_to_sfdc: true, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    // BQ misses on both who_id (Contact not synced) AND kixie_task_id
    // (Task.WhoId points at the same not-yet-synced Contact). Email arm hits.
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {},
      emailToUniqueInfo: {
        'rahul18sarin@gmail.com': {
          name: 'Rahul Sarin', leadId: '00QVS00000TDJsA2AX', opportunityId: null,
          didSql: false, didSqo: false, currentStage: null, closedLost: false,
        },
      },
      kixieTaskIdToInfo: {},
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; advisorEmail: string|null; linkedToSfdc: boolean }> };
    expect(body.drillDown[0]!.advisorName).toBe('Rahul Sarin');
    expect(body.drillDown[0]!.advisorEmail).toBeNull();
    expect(body.drillDown[0]!.linkedToSfdc).toBe(true);
    // Both fallback inputs were collected and made available to the resolver.
    expect(mockResolveAdvisorNames.mock.calls[0]![0]).toMatchObject({
      whoIds: ['003VS00000dfJD7YAM'],
      emails: ['rahul18sarin@gmail.com'],
      kixieTaskIds: ['00TVS00000nB7dM2AS'],
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
            kixie_task_id: null,
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
      kixieTaskIdToInfo: {},
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
            kixie_task_id: null,
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({ whoIdToInfo: {}, whatIdToInfo: {}, contactAccountOppToInfo: {}, emailToUniqueInfo: {}, kixieTaskIdToInfo: {} });
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
            kixie_task_id: null,
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
            kixie_task_id: null,
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
      kixieTaskIdToInfo: {},
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
            kixie_task_id: null,
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
            kixie_task_id: '00TVS00000Sensitive',
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
    expect(row).not.toHaveProperty('kixie_task_id');
    expect(row).not.toHaveProperty('kixieTaskId');
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
              kixie_task_id: null,
              pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false },
            // Unlinked → both null.
            { call_note_id: 'b', call_date: new Date('2026-04-01T12:00:00Z'),
              rep_id: null, sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
              sfdc_who_id: null, sfdc_record_type: null, invitee_emails: null,
              kixie_task_id: null,
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
      kixieTaskIdToInfo: {},
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

  // 2026-05-11 — bug repro: Granola call linked directly to an Opportunity
  // (sfdc_who_id=NULL, sfdc_what_id=<Opp.Id>) showed "Closed Lost" in the
  // drill-down because the resolver only consulted who_id and the email
  // cascade picked a stale sibling Lead. The what-arm pulls THIS opp's
  // stage from vw_funnel_master directly so a sibling can't poison it.
  it('advisor cascade: granola call linked to Opportunity uses what_id arm (no Closed-Lost regression)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: '7f7aa08c-d2ea-4418-a7d1-89386cd36c61',
            call_date: new Date('2026-05-11T14:00:52Z'),
            rep_id: 'rep-1', sga_name: 'Clayton K.', rep_role: 'SGA', sgm_name: null, source: 'granola',
            sfdc_who_id: null,
            sfdc_what_id: '006VS00000XXtabYAD',
            sfdc_record_type: 'Opportunity',
            invitee_emails: ['kurt.fetter@example.com'],
            kixie_task_id: null,
            sfdc_suggestion: null,
            pushed_to_sfdc: true, has_ai_feedback: true, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    // The what-arm wins; the email arm is intentionally NOT consulted even
    // though the row has an invitee email that resolves to a different (and,
    // in real data, Closed-Lost) lead.
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {},
      whatIdToInfo: {
        '006VS00000XXtabYAD': {
          name: 'Kurt Fetter - Account', leadId: null, opportunityId: '006VS00000XXtabYAD',
          didSql: true, didSqo: true, currentStage: 'Negotiating', closedLost: false,
        },
      },
      emailToUniqueInfo: {
        'kurt.fetter@example.com': {
          name: 'Stale Closed-Lost Lead', leadId: '00QStaleLead', opportunityId: '006StaleOpp',
          didSql: true, didSqo: false, currentStage: 'Closed Lost', closedLost: true,
        },
      },
      kixieTaskIdToInfo: {},
    });
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; currentStage: string|null; closedLost: boolean; linkedToSfdc: boolean; leadUrl: string|null; opportunityUrl: string|null }> };
    expect(body.drillDown[0]!.advisorName).toBe('Kurt Fetter - Account');
    expect(body.drillDown[0]!.currentStage).toBe('Negotiating');
    expect(body.drillDown[0]!.closedLost).toBe(false);
    expect(body.drillDown[0]!.linkedToSfdc).toBe(true);
    // leadId is intentionally null for what-arm hits — Full_prospect_id__c
    // in this org is sometimes an Opp Id, not a Lead Id.
    expect(body.drillDown[0]!.leadUrl).toBeNull();
    expect(body.drillDown[0]!.opportunityUrl).toBe('https://savvywealth.lightning.force.com/lightning/r/Opportunity/006VS00000XXtabYAD/view');
    expect(mockResolveAdvisorNames.mock.calls[0]![0]).toMatchObject({
      whatIds: ['006VS00000XXtabYAD'],
    });
  });

  // Pre-push case: granola row has no linkage of its own (sfdc_who_id and
  // sfdc_what_id both NULL) but the waterfall ranked an Opp as 'likely'.
  // The DM's recommendation drives the stage display until the rep approves.
  it("advisor cascade: pre-push granola row inherits 'likely' suggestion's Opp + stage", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'pre-push', call_date: new Date('2026-05-11T14:00:52Z'),
            rep_id: 'rep-1', sga_name: 'Clayton K.', rep_role: 'SGA', sgm_name: null, source: 'granola',
            sfdc_who_id: null, sfdc_what_id: null, sfdc_record_type: null,
            invitee_emails: null, kixie_task_id: null,
            sfdc_suggestion: {
              candidates: [
                { confidence_tier: 'likely', who_id: null, what_id: '006VS00000XXtabYAD', primary_record_type: 'Opportunity' },
                { confidence_tier: 'possible', who_id: '003ContactX', what_id: null, primary_record_type: 'Contact' },
              ],
            },
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {},
      whatIdToInfo: {
        '006VS00000XXtabYAD': {
          name: 'Kurt Fetter - Account', leadId: null, opportunityId: '006VS00000XXtabYAD',
          didSql: true, didSqo: true, currentStage: 'Negotiating', closedLost: false,
        },
      },
      emailToUniqueInfo: {},
      kixieTaskIdToInfo: {},
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; currentStage: string|null }> };
    expect(body.drillDown[0]!.advisorName).toBe('Kurt Fetter - Account');
    expect(body.drillDown[0]!.currentStage).toBe('Negotiating');
    // Resolver was primed with the suggestion's what_id even though the call
    // note's own sfdc_what_id was null.
    expect(mockResolveAdvisorNames.mock.calls[0]![0]).toMatchObject({
      whatIds: ['006VS00000XXtabYAD'],
    });
  });

  // Suggestion is consulted ONLY when the call_note has no linkage of its
  // own. If the rep manually re-linked to a different record, that pointer
  // wins — a stale DM-time suggestion must not override the rep's choice.
  it("advisor cascade: 'likely' suggestion is ignored when call_note has its own linkage", async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'relinked', call_date: new Date('2026-05-11T14:00:52Z'),
            rep_id: 'rep-1', sga_name: null, rep_role: null, sgm_name: null, source: 'granola',
            sfdc_who_id: 'WHO-MANUAL', sfdc_what_id: null, sfdc_record_type: 'Lead',
            invitee_emails: null, kixie_task_id: null,
            sfdc_suggestion: {
              candidates: [
                { confidence_tier: 'likely', who_id: null, what_id: '006StaleSuggestion', primary_record_type: 'Opportunity' },
              ],
            },
            pushed_to_sfdc: true, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {
        'WHO-MANUAL': {
          name: 'Manually Linked Person', leadId: '00QManual', opportunityId: '006Manual',
          didSql: true, didSqo: true, currentStage: 'Signed', closedLost: false,
        },
      },
      whatIdToInfo: {},
      emailToUniqueInfo: {},
      kixieTaskIdToInfo: {},
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; currentStage: string|null }> };
    expect(body.drillDown[0]!.advisorName).toBe('Manually Linked Person');
    expect(body.drillDown[0]!.currentStage).toBe('Signed');
    // The stale suggestion's what_id was NOT added to the resolver lookup
    // because the row already has its own who_id.
    expect(mockResolveAdvisorNames.mock.calls[0]![0].whatIds ?? []).not.toContain('006StaleSuggestion');
  });

  // 2026-05-11 — second bug repro: kixie call whose sfdc_who_id is a Contact
  // tied to a 2024 Closed Lost lead lifecycle, while SFDC has a newer
  // Qualifying opp on the SAME Account. The Contact→Account→best-opp arm
  // returns the active Qualifying opp; the existing who→ConvertedLead arm
  // would have returned the stale Closed Lost.
  it('advisor cascade: Contact-on-Account-with-newer-opp resolves to Account-best (not stale lead-primary)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'dbd1f176-b63b-48cc-ae5a-47ee2249146d',
            call_date: new Date('2026-05-05T15:12:41Z'),
            rep_id: 'rep-1', sga_name: 'Russell A.', rep_role: 'SGA', sgm_name: null, source: 'kixie',
            sfdc_who_id: '003VS00000GrSzRYAV',  // Colin's Contact
            sfdc_what_id: null,
            sfdc_record_type: 'Contact',
            invitee_emails: null,
            kixie_task_id: '00TVS00000n7UOr2AM',
            sfdc_suggestion: null,
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    // who-arm finds the stale 2024 Closed Lost lead; contactAccountOppToInfo
    // returns the current Qualifying opp on the same Account.
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {
        '003VS00000GrSzRYAV': {
          name: 'Colin Kampfe', leadId: '00QVS00000CTVhT2AX', opportunityId: '006VS00000D0vN1YAJ',
          didSql: true, didSqo: false, currentStage: 'Closed Lost', closedLost: true,
        },
      },
      whatIdToInfo: {},
      contactAccountOppToInfo: {
        '003VS00000GrSzRYAV': {
          name: 'Colin Kampfe', leadId: null, opportunityId: '006VS00000a20LmYAI',
          didSql: true, didSqo: false, currentStage: 'Qualifying', closedLost: false,
        },
      },
      emailToUniqueInfo: {},
      kixieTaskIdToInfo: {},
    });
    const res = await GET(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; currentStage: string|null; closedLost: boolean; linkedToSfdc: boolean; opportunityUrl: string|null }> };
    expect(body.drillDown[0]!.advisorName).toBe('Colin Kampfe');
    expect(body.drillDown[0]!.currentStage).toBe('Qualifying');
    expect(body.drillDown[0]!.closedLost).toBe(false);
    expect(body.drillDown[0]!.linkedToSfdc).toBe(true);
    expect(body.drillDown[0]!.opportunityUrl).toBe('https://savvywealth.lightning.force.com/lightning/r/Opportunity/006VS00000a20LmYAI/view');
  });

  // The Account-pivot arm fires only for Contact who-ids; Lead who-ids are
  // not affected (the Account-arm map is empty for them). Same row layout
  // as the above, but the existing whoIdToInfo wins — no override.
  it('advisor cascade: Lead-direct who-id is NOT affected by the Account-pivot arm', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'lead-row', call_date: new Date('2026-05-05T15:12:41Z'),
            rep_id: 'rep-1', sga_name: null, rep_role: null, sgm_name: null, source: 'kixie',
            sfdc_who_id: '00QVS00000LeadOnly',  // Lead.Id, not Contact
            sfdc_what_id: null,
            sfdc_record_type: 'Lead',
            invitee_emails: null, kixie_task_id: null,
            sfdc_suggestion: null,
            pushed_to_sfdc: false, has_ai_feedback: false, has_manager_edit_eval: false,
          }],
          rowCount: 1,
        });
      }
      return defaultMockImpl(sql);
    });
    mockResolveAdvisorNames.mockResolvedValue({
      whoIdToInfo: {
        '00QVS00000LeadOnly': {
          name: 'Lead Person', leadId: '00QVS00000LeadOnly', opportunityId: '006LeadOpp',
          didSql: true, didSqo: true, currentStage: 'Sales Process', closedLost: false,
        },
      },
      whatIdToInfo: {},
      // Account-pivot returns nothing for Lead who-ids (SQL only matches
      // Contact.Id values), so the cascade falls through to whoIdToInfo.
      contactAccountOppToInfo: {},
      emailToUniqueInfo: {},
      kixieTaskIdToInfo: {},
    });
    const res = await GET(makeReq() as never);
    const body = await res.json() as { drillDown: Array<{ advisorName: string|null; currentStage: string|null }> };
    expect(body.drillDown[0]!.advisorName).toBe('Lead Person');
    expect(body.drillDown[0]!.currentStage).toBe('Sales Process');
  });

  // Internal-only fields stay server-side. Both sfdc_what_id and the JSONB
  // suggestion blob get stripped before the response leaves the route.
  it('drill-down response strips sfdc_what_id and sfdc_suggestion (server-only)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS call_note_id')) {
        return Promise.resolve({
          rows: [{
            call_note_id: 'strip', call_date: new Date('2026-04-01T12:00:00Z'),
            rep_id: null, sga_name: null, rep_role: null, sgm_name: null, source: 'granola',
            sfdc_who_id: null,
            sfdc_what_id: '006InternalOnly',
            sfdc_record_type: 'Opportunity',
            invitee_emails: null, kixie_task_id: null,
            sfdc_suggestion: { candidates: [{ confidence_tier: 'likely', what_id: '006InternalOnly', who_id: null }] },
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
    expect(row).not.toHaveProperty('sfdc_what_id');
    expect(row).not.toHaveProperty('sfdcWhatId');
    expect(row).not.toHaveProperty('sfdc_suggestion');
    expect(row).not.toHaveProperty('sfdcSuggestion');
  });
});
