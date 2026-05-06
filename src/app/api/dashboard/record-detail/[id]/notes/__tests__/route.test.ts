// Tests for GET /api/dashboard/record-detail/[id]/notes
//
// Heavy use of mocks: the BQ resolver and the Pg fetcher are stubbed
// per-test so we exercise the route's RBAC + response-shape logic
// without touching real warehouses.

const mockResolveRecordContext = jest.fn();
const mockFetchNotesForContext = jest.fn();
const mockGetUserRepIdentity   = jest.fn();

jest.mock('@/lib/queries/record-notes', () => ({
  resolveRecordContext: (...a: unknown[]) => mockResolveRecordContext(...a),
  fetchNotesForContext: (...a: unknown[]) => mockFetchNotesForContext(...a),
  getUserRepIdentity:   (...a: unknown[]) => mockGetUserRepIdentity(...a),
}));

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

const mockGetSessionPermissions = jest.fn();
jest.mock('@/types/auth', () => ({
  getSessionPermissions: (...a: unknown[]) => mockGetSessionPermissions(...a),
}));
jest.mock('@/lib/cache', () => ({
  cachedQuery: <T extends (...a: unknown[]) => unknown>(fn: T) => fn,
  CACHE_TAGS: { DASHBOARD: 'dashboard' },
}));

import { GET } from '../route';
import { getServerSession } from 'next-auth';

function makeReq(): Request {
  return new Request('http://localhost/api/dashboard/record-detail/00QVS00000UXMGb2AP/notes');
}

const ctxParams = { params: Promise.resolve({ id: '00QVS00000UXMGb2AP' }) } as never;

describe('GET /api/dashboard/record-detail/[id]/notes', () => {
  beforeEach(() => {
    mockResolveRecordContext.mockReset();
    mockFetchNotesForContext.mockReset();
    mockGetUserRepIdentity.mockReset();
    mockGetSessionPermissions.mockReset();
    (getServerSession as jest.Mock).mockReset();

    // Defaults that individual tests override.
    mockResolveRecordContext.mockResolvedValue({
      leadId: '00QVS00000UXMGb2AP',
      contactId: null,
      matchingKixieTaskIds: [],
      uniqueEmails: [],
      sgaOwnerName: 'Jason Ainsworth',
      oppSgaName: null,
      sgmOwnerName: 'David Hipperson',
    });
    mockFetchNotesForContext.mockResolvedValue([]);
  });

  it('401 with no session', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);
    const res = await GET(makeReq() as never, ctxParams);
    expect(res.status).toBe(401);
  });

  it('400 on malformed record id', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const res = await GET(
      new Request('http://localhost/api/dashboard/record-detail/garbage/notes') as never,
      { params: Promise.resolve({ id: 'garbage' }) } as never,
    );
    expect(res.status).toBe(400);
  });

  it('revops_admin sees all notes (no rep lookup needed)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'admin@savvywealth.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockFetchNotesForContext.mockResolvedValue([
      { id: 'n1', callDate: '2026-05-06T15:10:52.000Z', source: 'kixie',
        repName: 'Jason Ainsworth', repRole: 'SGA', managerName: 'David Hipperson',
        otherSavvyAttendees: [], notesMarkdown: 'hi', coachingMarkdown: '',
        pushedToSfdc: true, linkConfidence: 'pushed' },
    ]);
    const res = await GET(makeReq() as never, ctxParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorized).toBe(true);
    expect(body.notes).toHaveLength(1);
    expect(mockGetUserRepIdentity).not.toHaveBeenCalled();
  });

  it('manager sees all notes (no rep lookup needed)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'mgr@savvywealth.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'manager' });
    mockFetchNotesForContext.mockResolvedValue([{ id: 'n1' } as never]);
    const res = await GET(makeReq() as never, ctxParams);
    const body = await res.json();
    expect(body.authorized).toBe(true);
    expect(mockGetUserRepIdentity).not.toHaveBeenCalled();
  });

  it('SGA sees notes when their reps.full_name matches sga_owner_name', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'jason@savvywealth.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'sga' });
    mockGetUserRepIdentity.mockResolvedValue({ fullName: 'Jason Ainsworth', role: 'SGA' });
    mockFetchNotesForContext.mockResolvedValue([{ id: 'n1' } as never]);
    const res = await GET(makeReq() as never, ctxParams);
    const body = await res.json();
    expect(body.authorized).toBe(true);
    expect(body.notes).toHaveLength(1);
  });

  it('SGA sees notes when their full_name matches opp_sga_name (lead-vs-opp split ownership)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'other-sga@savvywealth.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'sga' });
    mockResolveRecordContext.mockResolvedValue({
      leadId: '00QXXX', contactId: null, matchingKixieTaskIds: [], uniqueEmails: [],
      sgaOwnerName: 'Jason Ainsworth',     // lead-side owner
      oppSgaName: 'Holly Huffman',          // opp-side owner — different person
      sgmOwnerName: null,
    });
    mockGetUserRepIdentity.mockResolvedValue({ fullName: 'Holly Huffman', role: 'SGA' });
    mockFetchNotesForContext.mockResolvedValue([{ id: 'n1' } as never]);
    const res = await GET(makeReq() as never, ctxParams);
    const body = await res.json();
    expect(body.authorized).toBe(true);
  });

  it('SGA whose name matches NEITHER owner gets authorized:false + empty notes', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'unrelated@savvywealth.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'sga' });
    mockGetUserRepIdentity.mockResolvedValue({ fullName: 'Unrelated SGA', role: 'SGA' });
    const res = await GET(makeReq() as never, ctxParams);
    const body = await res.json();
    expect(body.authorized).toBe(false);
    expect(body.notes).toEqual([]);
    // Critical: the notes fetcher must NOT have been called when not authorized.
    expect(mockFetchNotesForContext).not.toHaveBeenCalled();
  });

  it('SGM sees notes when full_name matches sgm_owner_name', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'david@savvywealth.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'sgm' });
    mockGetUserRepIdentity.mockResolvedValue({ fullName: 'David Hipperson', role: 'SGM' });
    mockFetchNotesForContext.mockResolvedValue([{ id: 'n1' } as never]);
    const res = await GET(makeReq() as never, ctxParams);
    const body = await res.json();
    expect(body.authorized).toBe(true);
  });

  it('SGM whose name does not match → authorized:false', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'sgm2@savvywealth.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'sgm' });
    mockGetUserRepIdentity.mockResolvedValue({ fullName: 'Other SGM', role: 'SGM' });
    const res = await GET(makeReq() as never, ctxParams);
    const body = await res.json();
    expect(body.authorized).toBe(false);
  });

  it('SGA without a Neon reps row → authorized:false (fail closed)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'ghost@savvywealth.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'sga' });
    mockGetUserRepIdentity.mockResolvedValue(null);
    const res = await GET(makeReq() as never, ctxParams);
    const body = await res.json();
    expect(body.authorized).toBe(false);
  });

  it('viewer / recruiter / capital_partner roles → authorized:false', async () => {
    for (const role of ['viewer', 'recruiter', 'capital_partner']) {
      (getServerSession as jest.Mock).mockResolvedValue({ user: { email: `${role}@savvywealth.com` } });
      mockGetSessionPermissions.mockReturnValue({ role });
      const res = await GET(makeReq() as never, ctxParams);
      const body = await res.json();
      expect(body.authorized).toBe(false);
      expect(body.notes).toEqual([]);
    }
  });

  it('name match is case-insensitive (defensive — Salesforce User.Name casing varies)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'jason@savvywealth.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'sga' });
    mockResolveRecordContext.mockResolvedValue({
      leadId: '00QXXX', contactId: null, matchingKixieTaskIds: [], uniqueEmails: [],
      sgaOwnerName: 'JASON AINSWORTH', oppSgaName: null, sgmOwnerName: null,
    });
    mockGetUserRepIdentity.mockResolvedValue({ fullName: 'jason ainsworth', role: 'SGA' });
    mockFetchNotesForContext.mockResolvedValue([{ id: 'n1' } as never]);
    const res = await GET(makeReq() as never, ctxParams);
    const body = await res.json();
    expect(body.authorized).toBe(true);
  });

  it('response includes leadId resolved by the BQ context', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'admin@savvywealth.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const res = await GET(makeReq() as never, ctxParams);
    const body = await res.json();
    expect(body.leadId).toBe('00QVS00000UXMGb2AP');
  });
});
