export type AttributionModel = 'v1' | 'v2';

/**
 * Returns 'v1' when ATTRIBUTION_MODEL is unset, empty, or any value other than 'v2'.
 * 'v1' preserves today's behavior — reads vw_funnel_master.SGA_Owner_Name__c directly.
 * 'v2' routes SGA-filtered queries through vw_lead_primary_sga.
 */
export function getAttributionModel(): AttributionModel {
  return process.env.ATTRIBUTION_MODEL === 'v2' ? 'v2' : 'v1';
}

/**
 * When true AND server is computing an SGA-filtered query for an authorized admin,
 * compute BOTH v1 and v2 numbers. The extra payload is attached for side-by-side display.
 * Server-side only — client gates on payload presence + role, not its own env var.
 */
export function isAttributionDebugEnabled(): boolean {
  return process.env.ATTRIBUTION_DEBUG === 'true';
}
