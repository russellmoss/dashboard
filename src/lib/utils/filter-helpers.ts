// src/lib/utils/filter-helpers.ts

import { AdvancedFilters, DEFAULT_ADVANCED_FILTERS } from '@/types/filters';

interface FilterClauseResult {
  whereClauses: string[];
  params: Record<string, unknown>;
}

/**
 * Build SQL WHERE clauses and parameters from advanced filters
 * Uses BigQuery parameterized query syntax (@paramName)
 * 
 * IMPORTANT: DATE fields use direct comparison, TIMESTAMP fields use TIMESTAMP() wrapper
 */
export function buildAdvancedFilterClauses(
  filters: AdvancedFilters,
  paramPrefix: string = 'adv'
): FilterClauseResult {
  const whereClauses: string[] = [];
  const params: Record<string, unknown> = {};

  // Merge with defaults to ensure all nested properties exist
  const safeFilters: AdvancedFilters = {
    initialCallScheduled: {
      ...DEFAULT_ADVANCED_FILTERS.initialCallScheduled,
      ...(filters.initialCallScheduled || {}),
    },
    qualificationCallDate: {
      ...DEFAULT_ADVANCED_FILTERS.qualificationCallDate,
      ...(filters.qualificationCallDate || {}),
    },
    channels: {
      ...DEFAULT_ADVANCED_FILTERS.channels,
      ...(filters.channels || {}),
    },
    sources: {
      ...DEFAULT_ADVANCED_FILTERS.sources,
      ...(filters.sources || {}),
    },
    sgas: {
      ...DEFAULT_ADVANCED_FILTERS.sgas,
      ...(filters.sgas || {}),
    },
    sgms: {
      ...DEFAULT_ADVANCED_FILTERS.sgms,
      ...(filters.sgms || {}),
    },
    experimentationTags: {
      ...DEFAULT_ADVANCED_FILTERS.experimentationTags,
      ...(filters.experimentationTags || {}),
    },
    campaigns: {
      ...DEFAULT_ADVANCED_FILTERS.campaigns,
      ...(filters.campaigns || {}),
    },
    leadScoreTiers: {
      ...DEFAULT_ADVANCED_FILTERS.leadScoreTiers,
      ...(filters.leadScoreTiers || {}),
    },
  };

  // Initial Call Scheduled Date filter
  // CRITICAL: Initial_Call_Scheduled_Date__c is a DATE field - direct comparison (no TIMESTAMP wrapper)
  if (safeFilters.initialCallScheduled.enabled) {
    if (safeFilters.initialCallScheduled.startDate) {
      whereClauses.push(`Initial_Call_Scheduled_Date__c >= @${paramPrefix}_initial_start`);
      params[`${paramPrefix}_initial_start`] = safeFilters.initialCallScheduled.startDate;
    }
    if (safeFilters.initialCallScheduled.endDate) {
      whereClauses.push(`Initial_Call_Scheduled_Date__c <= @${paramPrefix}_initial_end`);
      params[`${paramPrefix}_initial_end`] = safeFilters.initialCallScheduled.endDate;
    }
  }

  // Qualification Call Date filter
  // CRITICAL: Qualification_Call_Date__c is a DATE field - direct comparison (no TIMESTAMP wrapper)
  if (safeFilters.qualificationCallDate.enabled) {
    if (safeFilters.qualificationCallDate.startDate) {
      whereClauses.push(`Qualification_Call_Date__c >= @${paramPrefix}_qual_start`);
      params[`${paramPrefix}_qual_start`] = safeFilters.qualificationCallDate.startDate;
    }
    if (safeFilters.qualificationCallDate.endDate) {
      whereClauses.push(`Qualification_Call_Date__c <= @${paramPrefix}_qual_end`);
      params[`${paramPrefix}_qual_end`] = safeFilters.qualificationCallDate.endDate;
    }
  }

  // Channel filter (multi-select)
  // Channel_Grouping_Name now comes directly from Finance_View__c in the view
  if (!safeFilters.channels.selectAll && safeFilters.channels.selected.length > 0) {
    whereClauses.push(`v.Channel_Grouping_Name IN UNNEST(@${paramPrefix}_channels)`);
    params[`${paramPrefix}_channels`] = safeFilters.channels.selected;
  }

  // Source filter (multi-select)
  if (!safeFilters.sources.selectAll && safeFilters.sources.selected.length > 0) {
    whereClauses.push(`v.Original_source IN UNNEST(@${paramPrefix}_sources)`);
    params[`${paramPrefix}_sources`] = safeFilters.sources.selected;
  }

  // SGA filter (multi-select)
  // NOTE: For lead metrics, use SGA_Owner_Name__c
  // For opportunity metrics, queries should use Opp_SGA_Name__c
  // Since advanced filters apply at view level, we use SGA_Owner_Name__c
  if (!safeFilters.sgas.selectAll && safeFilters.sgas.selected.length > 0) {
    whereClauses.push(`v.SGA_Owner_Name__c IN UNNEST(@${paramPrefix}_sgas)`);
    params[`${paramPrefix}_sgas`] = safeFilters.sgas.selected;
  }

  // SGM filter (multi-select)
  // NOTE: SGM only applies to opportunity-level metrics
  if (!safeFilters.sgms.selectAll && safeFilters.sgms.selected.length > 0) {
    whereClauses.push(`v.SGM_Owner_Name__c IN UNNEST(@${paramPrefix}_sgms)`);
    params[`${paramPrefix}_sgms`] = safeFilters.sgms.selected;
  }

  // Experimentation Tag filter (multi-select)
  // NOTE: Uses Experimentation_Tag_List array field - check if any selected tag is in the array
  if (!safeFilters.experimentationTags.selectAll && safeFilters.experimentationTags.selected.length > 0) {
    // Use EXISTS with UNNEST to check if any tag in the array matches the selected tags
    whereClauses.push(`EXISTS (
      SELECT 1 
      FROM UNNEST(v.Experimentation_Tag_List) as tag
      WHERE tag IN UNNEST(@${paramPrefix}_experimentation_tags)
    )`);
    params[`${paramPrefix}_experimentation_tags`] = safeFilters.experimentationTags.selected;
  }

  // Campaign filter (multi-select): match single campaign (Campaign_Id__c) OR any membership (all_campaigns)
  if (!safeFilters.campaigns.selectAll && safeFilters.campaigns.selected.length > 0) {
    whereClauses.push(`(
      v.Campaign_Id__c IN UNNEST(@${paramPrefix}_campaigns)
      OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id IN (SELECT * FROM UNNEST(@${paramPrefix}_campaigns))) > 0
    )`);
    params[`${paramPrefix}_campaigns`] = safeFilters.campaigns.selected;
  }

  // Lead Score Tier filter (multi-select)
  // Handles special "__NO_TIER__" sentinel for NULL tiers
  if (!safeFilters.leadScoreTiers.selectAll && safeFilters.leadScoreTiers.selected.length > 0) {
    const realTiers = safeFilters.leadScoreTiers.selected.filter(t => t !== '__NO_TIER__');
    const includeNoTier = safeFilters.leadScoreTiers.selected.includes('__NO_TIER__');

    if (realTiers.length > 0 && includeNoTier) {
      // Both real tiers AND "(No Tier)" selected
      whereClauses.push(`(v.Lead_Score_Tier__c IN UNNEST(@${paramPrefix}_lead_score_tiers) OR v.Lead_Score_Tier__c IS NULL)`);
      params[`${paramPrefix}_lead_score_tiers`] = realTiers;
    } else if (realTiers.length > 0) {
      // Only real tiers selected
      whereClauses.push(`v.Lead_Score_Tier__c IN UNNEST(@${paramPrefix}_lead_score_tiers)`);
      params[`${paramPrefix}_lead_score_tiers`] = realTiers;
    } else if (includeNoTier) {
      // Only "(No Tier)" selected
      whereClauses.push(`v.Lead_Score_Tier__c IS NULL`);
    }
  }

  return { whereClauses, params };
}

/**
 * Check if any advanced filters are active (for optimization)
 */
export function hasActiveFilters(filters: AdvancedFilters): boolean {
  return (
    filters.initialCallScheduled.enabled ||
    filters.qualificationCallDate.enabled ||
    !filters.channels.selectAll ||
    !filters.sources.selectAll ||
    !filters.sgas.selectAll ||
    !filters.sgms.selectAll ||
    !filters.experimentationTags.selectAll ||
    !filters.campaigns.selectAll ||
    !filters.leadScoreTiers.selectAll
  );
}
