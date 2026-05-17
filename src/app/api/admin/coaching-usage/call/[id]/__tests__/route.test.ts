const mockQuery = jest.fn();

jest.mock('@/lib/coachingDb', () => ({
  getCoachingPool: () => ({ query: mockQuery }),
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

import { GET } from '../route';
import { getServerSession } from 'next-auth';

const VALID_UUID = '11111111-2222-3333-4444-555555555555';

function makeReq(): Request {
  return new Request(`http://localhost/api/admin/coaching-usage/call/${VALID_UUID}`);
}
function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/admin/coaching-usage/call/[id]', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetSessionPermissions.mockReset();
  });

  it('returns 401 when no session', async () => {
    (getServerSession as jest.Mock).mockResolvedValue(null);
    const res = await GET(makeReq() as never, makeCtx(VALID_UUID));
    expect(res.status).toBe(401);
  });

  it('returns 403 when role is not in allowed list', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'viewer' });
    const res = await GET(makeReq() as never, makeCtx(VALID_UUID));
    expect(res.status).toBe(403);
  });

  it('returns 400 when id is not a UUID (rejects SQL-injection-shaped values)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const res = await GET(makeReq() as never, makeCtx("' OR 1=1 --"));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 404 when no row matches', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await GET(makeReq() as never, makeCtx(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it('returns 200 with notesMarkdown + coachingMarkdown + transcript shape (kixie path, no markers → all to notes)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockResolvedValue({
      rows: [{
        source: 'kixie',
        summary_markdown: '## 1. Call summary\n\nGreat call.',
        ai_original: null,
        transcript: [
          { utterance_index: 0, speaker_role: 'rep',         text: 'Hi.',         start_seconds: 0, end_seconds: 1 },
          { utterance_index: 1, speaker_role: 'other_party', text: 'Hi back.',    start_seconds: 1, end_seconds: 2 },
        ],
      }],
      rowCount: 1,
    });
    const res = await GET(makeReq() as never, makeCtx(VALID_UUID));
    expect(res.status).toBe(200);
    const body = await res.json() as { notesMarkdown: string; coachingMarkdown: string; transcript: unknown };
    expect(body.notesMarkdown).toContain('## 1. Call summary');
    expect(body.coachingMarkdown).toBe('');
    expect(Array.isArray(body.transcript)).toBe(true);
    expect((body.transcript as unknown[]).length).toBe(2);

    // SQL parameterized via $1; UUID never concatenated.
    const calledSql = mockQuery.mock.calls[0]![0] as string;
    const calledParams = mockQuery.mock.calls[0]![1] as unknown[];
    expect(calledSql).toContain('WHERE cn.id = $1');
    expect(calledSql).toContain('source_deleted_at IS NULL');
    expect(calledParams).toEqual([VALID_UUID]);
  });

  it('returns transcript=null when call_transcripts row is absent (LEFT JOIN)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockResolvedValue({
      rows: [{ source: 'kixie', summary_markdown: 'Notes only.', ai_original: null, transcript: null }],
      rowCount: 1,
    });
    const res = await GET(makeReq() as never, makeCtx(VALID_UUID));
    const body = await res.json() as { notesMarkdown: string; coachingMarkdown: string; transcript: unknown };
    expect(body.notesMarkdown).toBe('Notes only.');
    expect(body.coachingMarkdown).toBe('');
    expect(body.transcript).toBeNull();
  });

  it('returns empty markdown fields when summary_markdown is null (defensive)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockResolvedValue({
      rows: [{ source: 'kixie', summary_markdown: null, ai_original: null, transcript: null }],
      rowCount: 1,
    });
    const res = await GET(makeReq() as never, makeCtx(VALID_UUID));
    const body = await res.json() as { notesMarkdown: string; coachingMarkdown: string; transcript: unknown };
    expect(body.notesMarkdown).toBe('');
    expect(body.coachingMarkdown).toBe('');
    expect(body.transcript).toBeNull();
  });

  it('Kixie: splits markdown on COACHING markers — notes and coaching go to separate fields', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const md = [
      '## 1. Call summary',
      '',
      'Great rapport throughout.',
      '',
      '═══ COACHING ANALYSIS START ═══',
      '',
      'Rapport was strong. Discovery missed AUM.',
      '',
      '═══ COACHING ANALYSIS END ═══',
    ].join('\n');
    mockQuery.mockResolvedValue({
      rows: [{ source: 'kixie', summary_markdown: md, ai_original: null, transcript: null }],
      rowCount: 1,
    });
    const res = await GET(makeReq() as never, makeCtx(VALID_UUID));
    const body = await res.json() as { notesMarkdown: string; coachingMarkdown: string };
    expect(body.notesMarkdown).toContain('## 1. Call summary');
    expect(body.notesMarkdown).toContain('Great rapport throughout.');
    expect(body.notesMarkdown).not.toContain('COACHING ANALYSIS');
    expect(body.notesMarkdown).not.toContain('Discovery missed AUM');
    expect(body.coachingMarkdown).toContain('Rapport was strong');
    expect(body.coachingMarkdown).toContain('Discovery missed AUM');
    expect(body.coachingMarkdown).not.toContain('═══');
    expect(body.coachingMarkdown).not.toContain('Call summary');
  });

  it('Kixie: handles START marker without END (coaching = everything after START)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const md = 'Pre-coaching notes.\n═══ COACHING ANALYSIS START ═══\nUnterminated coaching content.';
    mockQuery.mockResolvedValue({
      rows: [{ source: 'kixie', summary_markdown: md, ai_original: null, transcript: null }],
      rowCount: 1,
    });
    const res = await GET(makeReq() as never, makeCtx(VALID_UUID));
    const body = await res.json() as { notesMarkdown: string; coachingMarkdown: string };
    expect(body.notesMarkdown).toBe('Pre-coaching notes.');
    expect(body.coachingMarkdown).toContain('Unterminated coaching content.');
  });

  it('Kixie: puts trailing post-END content back into notes', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const md = [
      'Header notes.',
      '═══ COACHING ANALYSIS START ═══',
      'Coaching middle.',
      '═══ COACHING ANALYSIS END ═══',
      'Trailing notes appended.',
    ].join('\n');
    mockQuery.mockResolvedValue({
      rows: [{ source: 'kixie', summary_markdown: md, ai_original: null, transcript: null }],
      rowCount: 1,
    });
    const res = await GET(makeReq() as never, makeCtx(VALID_UUID));
    const body = await res.json() as { notesMarkdown: string; coachingMarkdown: string };
    expect(body.notesMarkdown).toContain('Header notes.');
    expect(body.notesMarkdown).toContain('Trailing notes appended.');
    expect(body.coachingMarkdown).toBe('Coaching middle.');
  });

  it('Granola: notes = full summary_markdown verbatim; coaching rendered from evaluations.ai_original', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const ai_original = {
      overallScore: 8.5,
      narrative: { text: 'Strong call overall — Aaron engaged throughout.' },
      dimensionScores: {
        Discovery: { score: 3 },
        Rapport: { score: 4 },
      },
      strengths: [
        { text: 'Genuine rapport with Aaron throughout the call.' },
        { text: 'PER explanation was clear and practical.' },
      ],
      weaknesses: [
        { text: 'Missed AUM clarification.' },
      ],
      knowledgeGaps: [],
      complianceFlags: [],
      coachingNudge: { text: 'Tighten discovery sequencing before pitching.' },
      additionalObservations: [{ text: 'Name/brand inconsistency (Terry vs Perry, Savi vs Savvy).' }],
    };
    mockQuery.mockResolvedValue({
      rows: [{
        source: 'granola',
        summary_markdown: '## Call Summary\n\nFull Granola notes here.',
        ai_original,
        transcript: null,
      }],
      rowCount: 1,
    });
    const res = await GET(makeReq() as never, makeCtx(VALID_UUID));
    const body = await res.json() as { notesMarkdown: string; coachingMarkdown: string };

    // Notes = full summary verbatim, no markers
    expect(body.notesMarkdown).toContain('Full Granola notes here.');
    expect(body.notesMarkdown).not.toContain('COACHING ANALYSIS');

    // Coaching rendered from ai_original
    expect(body.coachingMarkdown).toContain('## Overall Score');
    expect(body.coachingMarkdown).toContain('8.5');
    expect(body.coachingMarkdown).toContain('## Narrative');
    expect(body.coachingMarkdown).toContain('Strong call overall');
    expect(body.coachingMarkdown).toContain('## Dimension Scores');
    expect(body.coachingMarkdown).toMatch(/-\s+\*\*Discovery\*\*:\s+3/);
    expect(body.coachingMarkdown).toContain('## Strengths');
    expect(body.coachingMarkdown).toContain('Genuine rapport with Aaron');
    expect(body.coachingMarkdown).toContain('## Weaknesses');
    expect(body.coachingMarkdown).toContain('Missed AUM');
    expect(body.coachingMarkdown).toContain('## Coaching Nudge');
    expect(body.coachingMarkdown).toContain('Tighten discovery sequencing');
    expect(body.coachingMarkdown).toContain('## Additional Observations');
    expect(body.coachingMarkdown).toContain('Name/brand inconsistency');

    // Empty arrays should NOT emit a heading.
    expect(body.coachingMarkdown).not.toContain('## Knowledge Gaps');
    expect(body.coachingMarkdown).not.toContain('## Compliance Flags');
  });

  it('Granola: gracefully handles missing evaluations row (no ai_original) — coaching is empty', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockResolvedValue({
      rows: [{
        source: 'granola',
        summary_markdown: '## Call Summary\n\nFull Granola notes here.',
        ai_original: null,
        transcript: null,
      }],
      rowCount: 1,
    });
    const res = await GET(makeReq() as never, makeCtx(VALID_UUID));
    const body = await res.json() as { notesMarkdown: string; coachingMarkdown: string };
    expect(body.notesMarkdown).toContain('Full Granola notes here.');
    expect(body.coachingMarkdown).toBe('');
  });

  it('Granola: tolerates v2 ai_original (no coachingNudge, no additionalObservations)', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    const ai_v2 = {
      overallScore: 7,
      narrative: { text: 'Decent call.' },
      strengths: [{ text: 'Strong opener.' }],
      weaknesses: [{ text: 'Generic close.' }],
      knowledgeGaps: [],
      complianceFlags: [],
      // intentionally no coachingNudge, no additionalObservations
    };
    mockQuery.mockResolvedValue({
      rows: [{ source: 'granola', summary_markdown: 'Notes', ai_original: ai_v2, transcript: null }],
      rowCount: 1,
    });
    const res = await GET(makeReq() as never, makeCtx(VALID_UUID));
    const body = await res.json() as { coachingMarkdown: string };
    expect(body.coachingMarkdown).toContain('Decent call.');
    expect(body.coachingMarkdown).toContain('Strong opener.');
    expect(body.coachingMarkdown).not.toContain('## Coaching Nudge');
    expect(body.coachingMarkdown).not.toContain('## Additional Observations');
  });

  it('SQL joins evaluations via DISTINCT ON to pick the most recent eval per call_note', async () => {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: 'a@x.com' } });
    mockGetSessionPermissions.mockReturnValue({ role: 'revops_admin' });
    mockQuery.mockResolvedValue({
      rows: [{ source: 'granola', summary_markdown: '', ai_original: null, transcript: null }],
      rowCount: 1,
    });
    await GET(makeReq() as never, makeCtx(VALID_UUID));
    const calledSql = mockQuery.mock.calls[0]![0] as string;
    expect(calledSql).toContain('LEFT JOIN call_transcripts');
    expect(calledSql).toMatch(/DISTINCT ON\s*\(call_note_id\)/);
    expect(calledSql).toContain('FROM evaluations');
    expect(calledSql).toContain('ORDER BY call_note_id, created_at DESC');
  });
});
