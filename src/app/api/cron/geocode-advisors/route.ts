import { NextRequest, NextResponse } from 'next/server';
import { getBigQueryClient } from '@/lib/bigquery';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const LOCATION = 'northamerica-northeast2';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

interface GeocodeResult {
  lat: number;
  lng: number;
  accuracy: string;
  formatted_address: string;
}

interface AdvisorRow {
  primary_key: string;
  advisor_name: string;
  address_street_1: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal: string | null;
  has_full_address: boolean;
}

async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', GOOGLE_MAPS_API_KEY);
  url.searchParams.set('components', 'country:US');

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status === 'OK' && data.results.length > 0) {
    const result = data.results[0];
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      accuracy: result.geometry.location_type,
      formatted_address: result.formatted_address,
    };
  } else if (data.status === 'ZERO_RESULTS') {
    return null;
  } else {
    throw new Error(`Geocoding failed: ${data.status} - ${data.error_message || 'Unknown error'}`);
  }
}

function buildAddressString(row: AdvisorRow): string {
  const parts: string[] = [];

  if (row.address_street_1) {
    parts.push(row.address_street_1);
  }
  if (row.address_city) {
    parts.push(row.address_city);
  }
  if (row.address_state) {
    parts.push(row.address_state);
  }
  if (row.address_postal) {
    parts.push(row.address_postal);
  }

  return parts.join(', ');
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Validate CRON_SECRET (auto-injected by Vercel)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      logger.warn('[Cron Geocode] CRON_SECRET not configured');
      return NextResponse.json({ error: 'Cron not configured' }, { status: 500 });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      logger.warn('[Cron Geocode] Invalid CRON_SECRET');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check for Google Maps API key
    if (!GOOGLE_MAPS_API_KEY) {
      logger.error('[Cron Geocode] GOOGLE_MAPS_API_KEY not configured');
      return NextResponse.json({ error: 'Geocoding not configured' }, { status: 500 });
    }

    const bigquery = getBigQueryClient();

    // Find advisors that need geocoding
    const query = `
      SELECT
        v.primary_key,
        v.advisor_name,
        v.address_street_1,
        v.address_city,
        v.address_state,
        v.address_postal,
        v.has_full_address
      FROM \`${PROJECT_ID}.Tableau_Views.vw_joined_advisor_location\` v
      LEFT JOIN \`${PROJECT_ID}.Tableau_Views.geocoded_addresses\` g
        ON v.primary_key = g.primary_key
      WHERE v.has_address = TRUE
        AND v.sfdc_lat IS NULL
        AND g.primary_key IS NULL
      ORDER BY v.advisor_name
      LIMIT 50
    `;

    const [rows] = await bigquery.query({ query, location: LOCATION });
    const advisorRows = rows as AdvisorRow[];

    if (advisorRows.length === 0) {
      logger.info('[Cron Geocode] No advisors need geocoding');
      return NextResponse.json({
        success: true,
        message: 'No advisors need geocoding',
        processed: 0,
        duration_ms: Date.now() - startTime,
      });
    }

    logger.info(`[Cron Geocode] Found ${advisorRows.length} advisors to geocode`);

    // Geocode each advisor
    const results: Array<{
      primary_key: string;
      address_input: string;
      lat: number;
      lng: number;
      geocode_accuracy: string;
      geocode_source: string;
      geocoded_at: string;
    }> = [];

    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < advisorRows.length; i++) {
      const row = advisorRows[i];
      const addressString = buildAddressString(row);

      if (!addressString || addressString.trim() === '') {
        failCount++;
        continue;
      }

      try {
        // Rate limit: 100ms delay between requests
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        const geo = await geocodeAddress(addressString);

        if (geo) {
          results.push({
            primary_key: row.primary_key,
            address_input: addressString,
            lat: geo.lat,
            lng: geo.lng,
            geocode_accuracy: geo.accuracy,
            geocode_source: 'google',
            geocoded_at: new Date().toISOString(),
          });
          successCount++;
        } else {
          failCount++;
          errors.push(`No results for: ${row.advisor_name}`);
        }
      } catch (error) {
        failCount++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${row.advisor_name}: ${errorMsg}`);
        logger.error(`[Cron Geocode] Error geocoding ${row.advisor_name}:`, error);
      }
    }

    // Insert results into BigQuery
    if (results.length > 0) {
      const table = bigquery
        .dataset('Tableau_Views', { location: LOCATION })
        .table('geocoded_addresses');

      await table.insert(results);
      logger.info(`[Cron Geocode] Inserted ${results.length} geocoded addresses`);
    }

    const duration = Date.now() - startTime;

    logger.info('[Cron Geocode] Completed', {
      processed: advisorRows.length,
      success: successCount,
      failed: failCount,
      duration_ms: duration,
    });

    return NextResponse.json({
      success: true,
      message: `Geocoded ${successCount} advisors`,
      processed: advisorRows.length,
      success_count: successCount,
      fail_count: failCount,
      errors: errors.slice(0, 5), // Only return first 5 errors
      duration_ms: duration,
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('[Cron Geocode] Fatal error:', error);

    return NextResponse.json(
      {
        error: 'Failed to geocode advisors',
        message: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: duration,
      },
      { status: 500 }
    );
  }
}
