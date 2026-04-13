// packages/dashboard/src/lib/sga-canonical-name.ts
// ============================================================================
// Resolve a dashboard user's email to their canonical SGA name from
// `savvy-gtm-analytics.SavvyGTMData.User`, which is what the funnel view's
// SGA_Owner_Name__c field is derived from. Using Salesforce User.Name as the
// authority (instead of the dashboard's freeform User.name) protects against
// Google-OAuth display-name drift (e.g. "Brian OHara" vs "Brian O'Hara").
// ============================================================================

import { runQuery } from '@/lib/bigquery';

// Per-instance cache. Refreshed every 10 minutes so role/name changes in
// Salesforce propagate without requiring a re-login.
const CACHE = new Map<string, { name: string | null; at: number }>();
const TTL_MS = 10 * 60 * 1000;

/**
 * Look up the canonical SGA name for a given email.
 * Returns null if the user is not an active SGA (caller should fall back to
 * the dashboard's stored User.name in that case).
 */
export async function resolveSgaCanonicalName(email: string): Promise<string | null> {
  const key = email.toLowerCase().trim();
  if (!key) return null;

  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.name;
  }

  try {
    const rows = await runQuery<{ name: string }>(
      `SELECT TRIM(u.Name) AS name
       FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
       WHERE LOWER(u.Email) = @email
         AND u.IsSGA__c = TRUE
         AND u.IsActive = TRUE
       LIMIT 1`,
      { email: key }
    );
    const name = rows[0]?.name ?? null;
    CACHE.set(key, { name, at: Date.now() });
    return name;
  } catch (err) {
    console.error('[sga-canonical-name] lookup failed for', key, (err as Error).message);
    return null;
  }
}
