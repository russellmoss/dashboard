'use client';

import { useSession } from 'next-auth/react';
import { getSessionPermissions } from '@/types/auth';
import type { AttributionDebugPayload } from '@/types/dashboard';

/**
 * Phase 3 ATTRIBUTION_DEBUG side-by-side panel. Displayed only when:
 *  - server emitted a `debug` payload (implies server-side ATTRIBUTION_DEBUG=true,
 *    caller is admin, SGA filter active)
 *  - current session role is in {revops_admin, admin}
 *
 * Gates purely on payload presence + role; no client-side env var (per brief's
 * fixed env-var contract — no NEXT_PUBLIC_* twin of the server flag).
 */
export function AttributionDebugPanel({ debug }: { debug?: AttributionDebugPayload }) {
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const isAdmin =
    permissions?.role === 'revops_admin' || permissions?.role === 'admin';

  if (!debug || !isAdmin) return null;

  const deltaPp = (debug.v2.rate - debug.v1.rate) * 100;

  return (
    <div className="mb-4 rounded border border-yellow-300 bg-yellow-50 p-3 text-xs text-gray-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-gray-100">
      <div className="mb-1 font-medium">Attribution Debug (admin-only) — Contacted→MQL</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div>
          <span className="text-gray-500">v1 num/den: </span>
          {debug.v1.num} / {debug.v1.den}
        </div>
        <div>
          <span className="text-gray-500">v1 rate: </span>
          {(debug.v1.rate * 100).toFixed(4)}%
        </div>
        <div>
          <span className="text-gray-500">v2 num/den: </span>
          {debug.v2.num} / {debug.v2.den}
        </div>
        <div>
          <span className="text-gray-500">v2 rate: </span>
          {(debug.v2.rate * 100).toFixed(4)}%{' '}
          <span className="text-gray-500">
            ({deltaPp >= 0 ? '+' : ''}
            {deltaPp.toFixed(4)} pp)
          </span>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-300">
        v2 uses lead-era primary SGA from <code>vw_lead_primary_sga</code>. Opp-era metrics (SQO, Joined, AUM) filtered
        by SGA may understate for leads attributed to a real SGA only at opp stages — Phase 4 adds a dedicated opp-era view.
      </div>
    </div>
  );
}
