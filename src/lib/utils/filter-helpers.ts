// src/lib/utils/filter-helpers.ts

import { AdvancedFilters } from '@/types/filters';

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

  // Initial Call Scheduled Date filter
  // CRITICAL: Initial_Call_Scheduled_Date__c is a DATE field - direct comparison (no TIMESTAMP wrapper)
  if (filters.initialCallScheduled.enabled) {
    if (filters.initialCallScheduled.startDate) {
      whereClauses.push(`Initial_Call_Scheduled_Date__c >= @${paramPrefix}_initial_start`);
      params[`${paramPrefix}_initial_start`] = filters.initialCallScheduled.startDate;
    }
    if (filters.initialCallScheduled.endDate) {
      whereClauses.push(`Initial_Call_Scheduled_Date__c <= @${paramPrefix}_initial_end`);
      params[`${paramPrefix}_initial_end`] = filters.initialCallScheduled.endDate;
    }
  }

  // Qualification Call Date filter
  // CRITICAL: Qualification_Call_Date__c is a DATE field - direct comparison (no TIMESTAMP wrapper)
  if (filters.qualificationCallDate.enabled) {
    if (filters.qualificationCallDate.startDate) {
      whereClauses.push(`Qualification_Call_Date__c >= @${paramPrefix}_qual_start`);
      params[`${paramPrefix}_qual_start`] = filters.qualificationCallDate.startDate;
    }
    if (filters.qualificationCallDate.endDate) {
      whereClauses.push(`Qualification_Call_Date__c <= @${paramPrefix}_qual_end`);
      params[`${paramPrefix}_qual_end`] = filters.qualificationCallDate.endDate;
    }
  }

  // Channel filter (multi-select)
  // CRITICAL: Must use COALESCE pattern to match existing queries
  if (!filters.channels.selectAll && filters.channels.selected.length > 0) {
    whereClauses.push(`COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') IN UNNEST(@${paramPrefix}_channels)`);
    params[`${paramPrefix}_channels`] = filters.channels.selected;
  }
  // NOTE: This requires the query to include: LEFT JOIN `${MAPPING_TABLE}` nm ON v.Original_source = nm.original_source

  // Source filter (multi-select)
  if (!filters.sources.selectAll && filters.sources.selected.length > 0) {
    whereClauses.push(`v.Original_source IN UNNEST(@${paramPrefix}_sources)`);
    params[`${paramPrefix}_sources`] = filters.sources.selected;
  }

  // SGA filter (multi-select)
  // NOTE: For lead metrics, use SGA_Owner_Name__c
  // For opportunity metrics, queries should use Opp_SGA_Name__c
  // Since advanced filters apply at view level, we use SGA_Owner_Name__c
  if (!filters.sgas.selectAll && filters.sgas.selected.length > 0) {
    whereClauses.push(`v.SGA_Owner_Name__c IN UNNEST(@${paramPrefix}_sgas)`);
    params[`${paramPrefix}_sgas`] = filters.sgas.selected;
  }

  // SGM filter (multi-select)
  // NOTE: SGM only applies to opportunity-level metrics
  if (!filters.sgms.selectAll && filters.sgms.selected.length > 0) {
    whereClauses.push(`v.SGM_Owner_Name__c IN UNNEST(@${paramPrefix}_sgms)`);
    params[`${paramPrefix}_sgms`] = filters.sgms.selected;
  }

  // Experimentation Tag filter (multi-select)
  // NOTE: Uses Experimentation_Tag_List array field - check if any selected tag is in the array
  if (!filters.experimentationTags.selectAll && filters.experimentationTags.selected.length > 0) {
    // Use EXISTS with UNNEST to check if any tag in the array matches the selected tags
    whereClauses.push(`EXISTS (
      SELECT 1 
      FROM UNNEST(v.Experimentation_Tag_List) as tag
      WHERE tag IN UNNEST(@${paramPrefix}_experimentation_tags)
    )`);
    params[`${paramPrefix}_experimentation_tags`] = filters.experimentationTags.selected;
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
    !filters.experimentationTags.selectAll
  );
}
