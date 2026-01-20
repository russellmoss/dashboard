import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { DashboardFilters } from '@/types/filters';
import { GoogleSheetsExporter } from '@/lib/sheets/google-sheets-exporter';
import { SheetsExportData } from '@/lib/sheets/sheets-types';
import { getExportDetailRecords, buildConversionAnalysis } from '@/lib/queries/export-records';
import { getConversionRates } from '@/lib/queries/conversion-rates';
import { getConversionTrends } from '@/lib/queries/conversion-rates';
import { getFunnelMetrics } from '@/lib/queries/funnel-metrics';
import { buildDateRangeFromFilters } from '@/lib/utils/date-helpers';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds for export

export async function POST(request: NextRequest) {
  try {
    // Step 1: Authenticate
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Step 2: Parse request and apply permission filters
    const body = await request.json();
    const filters: DashboardFilters = body.filters;
    const maxRecords = body.maxRecords || 10000;
    // Parse mode parameter (default to 'cohort' to match dashboard default)
    const mode = (body.mode as 'period' | 'cohort') || 'cohort';

    const permissions = await getUserPermissions(session.user.email);
    
    // Check export permission
    if (!permissions.canExport) {
      return NextResponse.json(
        { error: 'You do not have permission to export data' }, 
        { status: 403 }
      );
    }

    // Apply permission-based filters
    if (permissions.sgaFilter) {
      filters.sga = permissions.sgaFilter;
    }
    if (permissions.sgmFilter) {
      filters.sgm = permissions.sgmFilter;
    }

    // Step 3: Fetch all data in parallel
    const { startDate, endDate } = buildDateRangeFromFilters(filters);
    
    logger.info('[Export] Starting export', {
      user: session.user.email,
      dateRange: `${startDate} to ${endDate}`,
      mode,
      filters: { channel: filters.channel, source: filters.source, sga: filters.sga, sgm: filters.sgm },
    });

    const [
      metricsResult,
      ratesResult,
      trendsResult,
      detailRecords,
    ] = await Promise.all([
      getFunnelMetrics(filters),
      getConversionRates(filters, mode), // Use the same mode as dashboard
      getConversionTrends(filters, 'month', mode), // Get monthly trends with same mode
      getExportDetailRecords(filters, maxRecords),
    ]);

    logger.debug('[Export] Data fetched', { recordCount: detailRecords.length });

    // Step 4: Build conversion analysis from detail records
    const conversionAnalysis = buildConversionAnalysis(detailRecords);

    // Step 5: Prepare export data package
    // Convert ConversionRatesResponse to ConversionRates format
    const conversionRates = {
      contactedToMql: {
        rate: ratesResult.contactedToMql.rate,
        numerator: ratesResult.contactedToMql.numerator,
        denominator: ratesResult.contactedToMql.denominator,
      },
      mqlToSql: {
        rate: ratesResult.mqlToSql.rate,
        numerator: ratesResult.mqlToSql.numerator,
        denominator: ratesResult.mqlToSql.denominator,
      },
      sqlToSqo: {
        rate: ratesResult.sqlToSqo.rate,
        numerator: ratesResult.sqlToSqo.numerator,
        denominator: ratesResult.sqlToSqo.denominator,
      },
      sqoToJoined: {
        rate: ratesResult.sqoToJoined.rate,
        numerator: ratesResult.sqoToJoined.numerator,
        denominator: ratesResult.sqoToJoined.denominator,
      },
    };

    const exportData: SheetsExportData = {
      exportDate: new Date().toISOString(),
      exportedBy: session.user.email,
      dateRange: {
        start: startDate,
        end: endDate,
        preset: filters.datePreset,
      },
      filtersApplied: {
        channel: filters.channel,
        source: filters.source,
        sga: filters.sga,
        sgm: filters.sgm,
      },
      mode, // Include mode in export data for reference
      metrics: metricsResult,
      conversionRates,
      trends: trendsResult,
      detailRecords,
      conversionAnalysis,
    };

    // Step 6: Export to Google Sheets
    logger.info('[Export] Creating Google Sheet');
    const exporter = new GoogleSheetsExporter();
    const result = await exporter.exportToSheets(exportData);

    if (!result.success) {
      logger.error('[Export] Failed', result.error);
      return NextResponse.json(
        { error: result.error || 'Export failed' },
        { status: 500 }
      );
    }

    logger.info('[Export] Success', { spreadsheetUrl: result.spreadsheetUrl });

    return NextResponse.json({
      success: true,
      spreadsheetId: result.spreadsheetId,
      spreadsheetUrl: result.spreadsheetUrl,
    });

  } catch (error) {
    logger.error('[Export] Error', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    );
  }
}
