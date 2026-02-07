import { runQuery } from '../bigquery';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { FULL_TABLE } from '@/config/constants';
import type { FilterOption } from '@/types/filters';

/**
 * Cache filter options for 1 hour
 * Filter options change only when new data is synced (every 6 hours)
 * 1-hour TTL provides good cache hit rate while staying fresh
 */
const FILTERS_TTL = 3600; // 1 hour

// Raw query result types
interface ChannelResult {
  channel: string | null;
  record_count: number | string;
}

interface SourceResult {
  source: string | null;
  record_count: number | string;
}

interface SGAResult {
  value: string | null;
  record_count: number | string;
  isActive: boolean | number;
}

interface SGMResult {
  value: string | null;
  record_count: number | string;
  isActive: boolean | number;
}

interface StageResult {
  stage: string | null;
}

interface YearResult {
  year: number | null;
}

interface ExperimentationTagResult {
  experimentation_tag: string | null;
}

interface CampaignResult {
  id: string | null;
  name: string | null;
}

// Processed result type
export interface RawFilterOptions {
  channels: string[];
  sources: string[];
  sgas: Array<{
    value: string;
    record_count: number;
    isActive: boolean;
  }>;
  sgms: Array<{
    value: string;
    record_count: number;
    isActive: boolean;
  }>;
  stages: string[];
  years: number[];
  experimentationTags: string[];
  campaigns: FilterOption[];
}

/**
 * Internal function - executes all filter queries
 * Returns raw data that needs post-processing in the route
 */
const _getRawFilterOptions = async (): Promise<RawFilterOptions> => {
  // Channel options with counts
  const channelsQuery = `
    SELECT
      v.Channel_Grouping_Name as channel,
      COUNT(*) AS record_count
    FROM \`${FULL_TABLE}\` v
    WHERE v.Channel_Grouping_Name IS NOT NULL
      AND v.FilterDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
    GROUP BY v.Channel_Grouping_Name
    ORDER BY record_count DESC
  `;

  // Source options with counts
  const sourcesQuery = `
    SELECT
      Original_source as source,
      COUNT(*) AS record_count
    FROM \`${FULL_TABLE}\`
    WHERE Original_source IS NOT NULL
      AND FilterDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
    GROUP BY Original_source
    ORDER BY record_count DESC
  `;

  // SGA options with isActive from User table
  const sgasQuery = `
    SELECT
      v.SGA_Owner_Name__c AS value,
      COUNT(*) AS record_count,
      MAX(COALESCE(u.IsActive, FALSE)) as isActive
    FROM \`${FULL_TABLE}\` v
    INNER JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u
      ON v.SGA_Owner_Name__c = u.Name
      AND u.IsSGA__c = TRUE
    WHERE v.SGA_Owner_Name__c IS NOT NULL
      AND v.SGA_Owner_Name__c != 'Savvy Operations'
      AND v.FilterDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
    GROUP BY v.SGA_Owner_Name__c
    ORDER BY record_count DESC
  `;

  // SGM options with isActive from User table
  const sgmsQuery = `
    SELECT
      v.SGM_Owner_Name__c AS value,
      COUNT(DISTINCT v.Full_Opportunity_ID__c) AS record_count,
      MAX(COALESCE(u.IsActive, FALSE)) as isActive
    FROM \`${FULL_TABLE}\` v
    INNER JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u
      ON v.SGM_Owner_Name__c = u.Name
      AND u.Is_SGM__c = TRUE
    WHERE v.SGM_Owner_Name__c IS NOT NULL
      AND v.Full_Opportunity_ID__c IS NOT NULL
      AND v.Opp_CreatedDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
    GROUP BY v.SGM_Owner_Name__c
    ORDER BY record_count DESC
  `;

  // Stage options (simple)
  const stagesQuery = `
    SELECT DISTINCT StageName as stage
    FROM \`${FULL_TABLE}\`
    WHERE StageName IS NOT NULL
    ORDER BY StageName
  `;

  // Year options (simple)
  const yearsQuery = `
    SELECT DISTINCT EXTRACT(YEAR FROM FilterDate) as year
    FROM \`${FULL_TABLE}\`
    WHERE FilterDate IS NOT NULL
    ORDER BY year DESC
  `;

  // Experimentation tags (uses UNNEST)
  const experimentationTagsQuery = `
    SELECT DISTINCT tag as experimentation_tag
    FROM \`${FULL_TABLE}\` v,
    UNNEST(v.Experimentation_Tag_List) as tag
    WHERE tag IS NOT NULL
      AND TRIM(tag) != ''
      AND v.FilterDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
    ORDER BY experimentation_tag
  `;

  const campaignsQuery = `
    SELECT DISTINCT
      c.Id as id,
      c.Name as name
    FROM \`savvy-gtm-analytics.SavvyGTMData.Campaign\` c
    WHERE c.IsActive = TRUE
      AND (
        EXISTS (SELECT 1 FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\` l WHERE l.Campaign__c = c.Id)
        OR EXISTS (SELECT 1 FROM \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o WHERE o.CampaignId = c.Id)
        OR EXISTS (SELECT 1 FROM \`savvy-gtm-analytics.SavvyGTMData.CampaignMember\` cm WHERE cm.CampaignId = c.Id)
      )
    ORDER BY c.Name ASC
  `;

  // Execute all queries in parallel
  const [
    channelsResult,
    sourcesResult,
    sgasResult,
    sgmsResult,
    stagesResult,
    yearsResult,
    experimentationTagsResult,
    campaignsResult,
  ] = await Promise.all([
    runQuery<ChannelResult>(channelsQuery),
    runQuery<SourceResult>(sourcesQuery),
    runQuery<SGAResult>(sgasQuery),
    runQuery<SGMResult>(sgmsQuery),
    runQuery<StageResult>(stagesQuery),
    runQuery<YearResult>(yearsQuery),
    runQuery<ExperimentationTagResult>(experimentationTagsQuery),
    runQuery<CampaignResult>(campaignsQuery),
  ]);

  return {
    channels: channelsResult
      .map(r => r.channel || '')
      .filter(Boolean),
    sources: sourcesResult
      .map(r => r.source || '')
      .filter(Boolean),
    sgas: sgasResult
      .filter(r => r.value)
      .map(r => ({
        value: r.value!,
        record_count: parseInt((r.record_count?.toString() || '0'), 10),
        isActive: r.isActive === true || r.isActive === 1,
      })),
    sgms: sgmsResult
      .filter(r => r.value)
      .map(r => ({
        value: r.value!,
        record_count: parseInt((r.record_count?.toString() || '0'), 10),
        isActive: r.isActive === true || r.isActive === 1,
      })),
    stages: stagesResult
      .map(r => r.stage || '')
      .filter(Boolean),
    years: yearsResult
      .map(r => r.year || 0)
      .filter(y => y > 0),
    experimentationTags: experimentationTagsResult
      .map(r => r.experimentation_tag || '')
      .filter(Boolean),
    campaigns: campaignsResult
      .filter(r => r.id && r.name)
      .map(r => ({ value: r.id!, label: r.name!, isActive: true })),
  };
};

/**
 * Cached version of filter options query
 * Uses DASHBOARD cache tag for invalidation with admin refresh
 */
export const getRawFilterOptions = cachedQuery(
  _getRawFilterOptions,
  'getRawFilterOptions',
  CACHE_TAGS.DASHBOARD,
  FILTERS_TTL
);
