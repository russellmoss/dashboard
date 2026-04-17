// src/lib/queries/advisor-locations.ts

import { runQuery } from '@/lib/bigquery';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { toString, toNumber } from '@/types/bigquery-raw';
import { prisma } from '@/lib/prisma';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';

/**
 * Raw BigQuery result for advisor location
 */
interface RawAdvisorLocation {
  primary_key: string;
  advisor_name: string;
  advisor_join_date__c: { value: string } | string | null;
  address_street_1: string | null;
  address_street_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal: string | null;
  address_country: string | null;
  address_lat: number | null;
  address_long: number | null;
  coord_source: string | null;
  geocode_accuracy: string | null;
  /** COALESCE(Account_Total_AUM__c, Opportunity_AUM) from query */
  AUM: number | null;
  SGA_Owner_Name__c: string | null;
  SGM_Owner_Name__c: string | null;
  Channel_Grouping_Name: string | null;
  Original_source: string | null;
}

/**
 * Advisor location for map display
 */
export interface AdvisorLocation {
  primaryKey: string;
  advisorName: string;
  joinDate: string | null;
  street1: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  coordSource: string | null;
  geocodeAccuracy: string | null;
  aum: number | null;
  sgaOwner: string | null;
  sgmOwner: string | null;
  channel: string | null;
  source: string | null;
  // Override information
  hasOverride?: boolean;
  overrideNotes?: string | null;
}

/**
 * Filters for advisor locations query
 */
export interface AdvisorLocationFilters {
  startDate?: string;
  endDate?: string;
  sga?: string | null;
  sgm?: string | null;
  channel?: string | null;
  source?: string | null;
  coordSourceFilter?: 'all' | 'geocoded' | 'sfdc';
}

/**
 * Summary stats for advisor locations
 */
export interface AdvisorLocationStats {
  total: number;
  withCoords: number;
  withoutCoords: number;
  geocoded: number;
  sfdc: number;
  accuracyBreakdown: {
    rooftop: number;
    rangeInterpolated: number;
    geometricCenter: number;
    approximate: number;
  };
}

/**
 * Response type for getAdvisorLocations
 */
export interface AdvisorLocationsResponse {
  advisors: AdvisorLocation[];
  stats: AdvisorLocationStats;
}

/**
 * Get advisor locations for map display
 */
const _getAdvisorLocations = async (
  filters: AdvisorLocationFilters = {}
): Promise<AdvisorLocationsResponse> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {};

  // Date filters (v = view alias)
  if (filters.startDate) {
    conditions.push('v.advisor_join_date__c >= DATE(@startDate)');
    params.startDate = filters.startDate;
  }
  if (filters.endDate) {
    conditions.push('v.advisor_join_date__c <= DATE(@endDate)');
    params.endDate = filters.endDate;
  }

  // Owner filters
  if (filters.sga) {
    conditions.push('v.SGA_Owner_Name__c = @sga');
    params.sga = filters.sga;
  }
  if (filters.sgm) {
    conditions.push('v.SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }

  // Channel/source filters
  if (filters.channel) {
    conditions.push('v.Channel_Grouping_Name = @channel');
    params.channel = filters.channel;
  }
  if (filters.source) {
    conditions.push('v.Original_source = @source');
    params.source = filters.source;
  }

  // Coordinate source filter
  if (filters.coordSourceFilter === 'geocoded') {
    conditions.push("v.coord_source = 'Geocoded'");
  } else if (filters.coordSourceFilter === 'sfdc') {
    conditions.push("v.coord_source = 'SFDC'");
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // AUM: prefer Account.Account_Total_AUM__c, fallback to Opportunity_AUM from view
  const query = `
    SELECT
      v.primary_key,
      v.advisor_name,
      v.advisor_join_date__c,
      v.address_street_1,
      v.address_street_2,
      v.address_city,
      v.address_state,
      v.address_postal,
      v.address_country,
      v.address_lat,
      v.address_long,
      v.coord_source,
      v.geocode_accuracy,
      COALESCE(a.Account_Total_AUM__c, v.Opportunity_AUM) AS AUM,
      v.SGA_Owner_Name__c,
      v.SGM_Owner_Name__c,
      v.Channel_Grouping_Name,
      v.Original_source
    FROM \`${PROJECT_ID}.Tableau_Views.vw_joined_advisor_location\` v
    LEFT JOIN \`${PROJECT_ID}.SavvyGTMData.Opportunity\` o
      ON v.Full_Opportunity_ID__c = o.Id
    LEFT JOIN \`${PROJECT_ID}.SavvyGTMData.Account\` a
      ON o.AccountId = a.Id AND a.IsDeleted = FALSE
    ${whereClause}
    ORDER BY v.advisor_join_date__c DESC
  `;

  // Fetch BigQuery data and overrides in parallel
  const [results, overrides] = await Promise.all([
    runQuery<RawAdvisorLocation>(query, params),
    prisma.advisorAddressOverride.findMany(),
  ]);

  // Create a map of overrides by primaryKey for fast lookup
  const overrideMap = new Map(
    overrides.map((o) => [o.primaryKey, o])
  );

  // Transform results and apply overrides
  const advisors: AdvisorLocation[] = results.map((row) => {
    // Handle BigQuery date format (can be { value: string } or string)
    let joinDate: string | null = null;
    if (row.advisor_join_date__c) {
      if (typeof row.advisor_join_date__c === 'object' && 'value' in row.advisor_join_date__c) {
        joinDate = row.advisor_join_date__c.value;
      } else if (typeof row.advisor_join_date__c === 'string') {
        joinDate = row.advisor_join_date__c;
      }
    }

    const primaryKey = toString(row.primary_key);
    const override = overrideMap.get(primaryKey);

    // Base values from BigQuery
    let street1 = row.address_street_1 ? toString(row.address_street_1) : null;
    let street2 = row.address_street_2 ? toString(row.address_street_2) : null;
    let city = row.address_city ? toString(row.address_city) : null;
    let state = row.address_state ? toString(row.address_state) : null;
    let postalCode = row.address_postal ? toString(row.address_postal) : null;
    let country = row.address_country ? toString(row.address_country) : null;
    let lat = row.address_lat !== null ? toNumber(row.address_lat) : null;
    let lng = row.address_long !== null ? toNumber(row.address_long) : null;
    let coordSource = row.coord_source ? toString(row.coord_source) : null;
    let geocodeAccuracy = row.geocode_accuracy ? toString(row.geocode_accuracy) : null;

    // Apply override if exists
    if (override) {
      if (override.street1) street1 = override.street1;
      if (override.street2) street2 = override.street2;
      if (override.city) city = override.city;
      if (override.state) state = override.state;
      if (override.postalCode) postalCode = override.postalCode;
      if (override.country) country = override.country;
      if (override.lat !== null) {
        lat = override.lat;
        coordSource = 'Override';
        geocodeAccuracy = 'ROOFTOP'; // Assume manual overrides are precise
      }
      if (override.lng !== null) {
        lng = override.lng;
      }
    }

    return {
      primaryKey,
      advisorName: toString(row.advisor_name),
      joinDate,
      street1,
      street2,
      city,
      state,
      postalCode,
      country,
      lat,
      lng,
      coordSource,
      geocodeAccuracy,
      aum: row.AUM !== null ? toNumber(row.AUM) : null,
      sgaOwner: row.SGA_Owner_Name__c ? toString(row.SGA_Owner_Name__c) : null,
      sgmOwner: row.SGM_Owner_Name__c ? toString(row.SGM_Owner_Name__c) : null,
      channel: row.Channel_Grouping_Name ? toString(row.Channel_Grouping_Name) : null,
      source: row.Original_source ? toString(row.Original_source) : null,
      hasOverride: !!override,
      overrideNotes: override?.notes || null,
    };
  });

  // Calculate stats (overrides count as rooftop since they're manually verified)
  const withCoords = advisors.filter(a => a.lat !== null && a.lng !== null);
  const geocoded = advisors.filter(a => a.coordSource === 'Geocoded');
  const sfdc = advisors.filter(a => a.coordSource === 'SFDC');
  const overridden = advisors.filter(a => a.coordSource === 'Override');

  const stats: AdvisorLocationStats = {
    total: advisors.length,
    withCoords: withCoords.length,
    withoutCoords: advisors.length - withCoords.length,
    geocoded: geocoded.length,
    sfdc: sfdc.length,
    accuracyBreakdown: {
      // Overrides count as rooftop since they're manually set/verified
      rooftop: advisors.filter(a => a.geocodeAccuracy === 'ROOFTOP').length,
      rangeInterpolated: advisors.filter(a => a.geocodeAccuracy === 'RANGE_INTERPOLATED').length,
      geometricCenter: advisors.filter(a => a.geocodeAccuracy === 'GEOMETRIC_CENTER').length,
      approximate: advisors.filter(a => a.geocodeAccuracy === 'APPROXIMATE').length,
    },
  };

  return { advisors, stats };
};

export const getAdvisorLocations = cachedQuery(
  _getAdvisorLocations,
  'getAdvisorLocations',
  CACHE_TAGS.DASHBOARD
);
