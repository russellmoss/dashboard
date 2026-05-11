import { GET } from '../route';
import { NextRequest } from 'next/server';

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/queries/call-intelligence-evaluations', () => ({
  getRepIdByEmail: jest.fn(),
}));
jest.mock('@/lib/queries/call-intelligence/visible-reps', () => ({
  getRepIdsVisibleToActor: jest.fn(),
}));
jest.mock('@/lib/queries/call-intelligence/dimension-heatmap', () => ({
  getDimensionHeatmap: jest.fn().mockResolvedValue({ rowBlocks: [], sparklines: null }),
}));

const { getServerSession } = require('next-auth');
const { getRepIdByEmail } = require('@/lib/queries/call-intelligence-evaluations');
const { getRepIdsVisibleToActor } = require('@/lib/queries/call-intelligence/visible-reps');

beforeEach(() => {
  getServerSession.mockResolvedValue({
    user: { email: 'manager@savvywealth.com' },
    permissions: { role: 'manager', allowedPages: [20] },
  });
  getRepIdByEmail.mockResolvedValue({ id: 'manager-rep-id', role: 'manager' });
});

describe('GET /api/call-intelligence/insights/heatmap', () => {
  it('returns 404 when focus_rep not in visible set (no leak)', async () => {
    getRepIdsVisibleToActor.mockResolvedValue(['a', 'b']);
    const url = 'http://x/api/call-intelligence/insights/heatmap?focus_rep=11111111-1111-1111-1111-111111111111';
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(404);
  });

  it('returns 400 on invalid range', async () => {
    getRepIdsVisibleToActor.mockResolvedValue(['a']);
    const url = 'http://x/api/call-intelligence/insights/heatmap?range=180d';
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(400);
  });

  it('returns 403 for SGA role even with allowedPages.includes(20)', async () => {
    getServerSession.mockResolvedValue({
      user: { email: 'sga@savvywealth.com' },
      permissions: { role: 'sga', allowedPages: [20] },
    });
    const url = 'http://x/api/call-intelligence/insights/heatmap';
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(403);
  });

  it('returns 200 for manager with valid request', async () => {
    getRepIdsVisibleToActor.mockResolvedValue(['rep-a', 'rep-b']);
    const url = 'http://x/api/call-intelligence/insights/heatmap?range=30d&role=both';
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(200);
  });

  it('admin without coaching rep row still passes (short-circuit)', async () => {
    getServerSession.mockResolvedValue({
      user: { email: 'admin@savvywealth.com' },
      permissions: { role: 'admin', allowedPages: [20] },
    });
    getRepIdByEmail.mockResolvedValueOnce(null);
    getRepIdsVisibleToActor.mockResolvedValue(['a', 'b']);
    const res = await GET(new NextRequest('http://x/api/call-intelligence/insights/heatmap?range=7d'));
    expect(res.status).toBe(200);
  });
});
