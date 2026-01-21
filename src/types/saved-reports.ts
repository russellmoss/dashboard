import { DashboardFilters } from './filters';
import { ViewMode } from './dashboard';

/**
 * Feature Selection - Controls which dashboard components are visible
 * Granular control over individual scorecards and conversion rate cards
 */
export interface FeatureSelection {
  scorecards: {
    // Full Funnel scorecards (available in fullFunnel view mode)
    prospects: boolean;
    contacted: boolean;
    mqls: boolean;
    // Volume scorecards (available in both views)
    sqls: boolean;
    sqos: boolean;
    signed: boolean;
    joined: boolean;
    openPipeline: boolean;
  };
  conversionRates: {
    contactedToMql: boolean;
    mqlToSql: boolean;
    sqlToSqo: boolean;
    sqoToJoined: boolean;
  };
  charts: {
    conversionTrends: boolean;
    volumeTrends: boolean;
  };
  tables: {
    channelPerformance: boolean;
    sourcePerformance: boolean;
    detailRecords: boolean;
  };
}

/**
 * Default feature selection - all features visible
 */
export const DEFAULT_FEATURE_SELECTION: FeatureSelection = {
  scorecards: {
    prospects: true,
    contacted: true,
    mqls: true,
    sqls: true,
    sqos: true,
    signed: true,
    joined: true,
    openPipeline: true,
  },
  conversionRates: {
    contactedToMql: true,
    mqlToSql: true,
    sqlToSqo: true,
    sqoToJoined: true,
  },
  charts: {
    conversionTrends: true,
    volumeTrends: true,
  },
  tables: {
    channelPerformance: true,
    sourcePerformance: true,
    detailRecords: true,
  },
};

/**
 * Report type discriminator
 */
export type ReportType = 'user' | 'admin_template';

/**
 * Saved Report - stored in database
 */
export interface SavedReport {
  id: string;
  userId: string | null;
  name: string;
  description: string | null;
  filters: DashboardFilters;
  featureSelection: FeatureSelection | null;
  viewMode: ViewMode | null;
  dashboard: string;
  reportType: ReportType;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

/**
 * Create/Update SavedReport payload
 */
export interface SavedReportInput {
  name: string;
  description?: string;
  filters: DashboardFilters;
  featureSelection?: FeatureSelection;
  viewMode?: ViewMode;
  isDefault?: boolean;
  reportType?: ReportType; // Only admins can set 'admin_template'
}

/**
 * API response for list of saved reports
 */
export interface SavedReportsResponse {
  userReports: SavedReport[];
  adminTemplates: SavedReport[];
}

/**
 * API response for single saved report
 */
export interface SavedReportResponse {
  report: SavedReport;
}

/**
 * Get effective feature selection (with defaults)
 * Handles backward compatibility with old format (fullFunnel/volume groups)
 */
export function getEffectiveFeatureSelection(
  featureSelection: FeatureSelection | null | undefined
): FeatureSelection {
  if (!featureSelection) {
    return DEFAULT_FEATURE_SELECTION;
  }
  
  // Handle backward compatibility: if old format exists, convert it
  const oldFormat = featureSelection as any;
  if (oldFormat.scorecards?.fullFunnel !== undefined || oldFormat.scorecards?.volume !== undefined) {
    // Old format detected - convert to new format
    const fullFunnel = oldFormat.scorecards?.fullFunnel ?? true;
    const volume = oldFormat.scorecards?.volume ?? true;
    return {
      scorecards: {
        prospects: fullFunnel,
        contacted: fullFunnel,
        mqls: fullFunnel,
        sqls: volume,
        sqos: volume,
        signed: volume,
        joined: volume,
        openPipeline: volume,
      },
      conversionRates: typeof oldFormat.conversionRates === 'boolean'
        ? {
            contactedToMql: oldFormat.conversionRates,
            mqlToSql: oldFormat.conversionRates,
            sqlToSqo: oldFormat.conversionRates,
            sqoToJoined: oldFormat.conversionRates,
          }
        : {
            contactedToMql: oldFormat.conversionRates?.contactedToMql ?? true,
            mqlToSql: oldFormat.conversionRates?.mqlToSql ?? true,
            sqlToSqo: oldFormat.conversionRates?.sqlToSqo ?? true,
            sqoToJoined: oldFormat.conversionRates?.sqoToJoined ?? true,
          },
      charts: {
        conversionTrends: oldFormat.charts?.conversionTrends ?? true,
        volumeTrends: oldFormat.charts?.volumeTrends ?? true,
      },
      tables: {
        channelPerformance: oldFormat.tables?.channelPerformance ?? true,
        sourcePerformance: oldFormat.tables?.sourcePerformance ?? true,
        detailRecords: oldFormat.tables?.detailRecords ?? true,
      },
    };
  }
  
  // New format - merge with defaults for backward compatibility
  return {
    scorecards: {
      prospects: featureSelection.scorecards?.prospects ?? true,
      contacted: featureSelection.scorecards?.contacted ?? true,
      mqls: featureSelection.scorecards?.mqls ?? true,
      sqls: featureSelection.scorecards?.sqls ?? true,
      sqos: featureSelection.scorecards?.sqos ?? true,
      signed: featureSelection.scorecards?.signed ?? true,
      joined: featureSelection.scorecards?.joined ?? true,
      openPipeline: featureSelection.scorecards?.openPipeline ?? true,
    },
    conversionRates: typeof featureSelection.conversionRates === 'boolean'
      ? {
          contactedToMql: featureSelection.conversionRates,
          mqlToSql: featureSelection.conversionRates,
          sqlToSqo: featureSelection.conversionRates,
          sqoToJoined: featureSelection.conversionRates,
        }
      : {
          contactedToMql: featureSelection.conversionRates?.contactedToMql ?? true,
          mqlToSql: featureSelection.conversionRates?.mqlToSql ?? true,
          sqlToSqo: featureSelection.conversionRates?.sqlToSqo ?? true,
          sqoToJoined: featureSelection.conversionRates?.sqoToJoined ?? true,
        },
    charts: {
      conversionTrends: featureSelection.charts?.conversionTrends ?? true,
      volumeTrends: featureSelection.charts?.volumeTrends ?? true,
    },
    tables: {
      channelPerformance: featureSelection.tables?.channelPerformance ?? true,
      sourcePerformance: featureSelection.tables?.sourcePerformance ?? true,
      detailRecords: featureSelection.tables?.detailRecords ?? true,
    },
  };
}
