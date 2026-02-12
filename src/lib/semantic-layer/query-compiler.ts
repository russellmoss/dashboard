// src/lib/semantic-layer/query-compiler.ts
// =============================================================================
// QUERY COMPILER
// Deterministic compiler that assembles safe SQL from verified semantic layer fragments
// =============================================================================

import {
  SEMANTIC_LAYER,
  CONSTANTS,
  VOLUME_METRICS,
  AUM_METRICS,
  CONVERSION_METRICS,
  DIMENSIONS,
  TIME_DIMENSIONS,
  DATE_RANGES,
  SGA_FILTER_PATTERNS,
} from './definitions';

import { QUERY_TEMPLATES, BASE_QUERY } from './query-templates';

import type {
  TemplateSelection,
  CompiledQuery,
  DateRangeParams,
  DimensionFilter,
  VisualizationType,
} from '@/types/agent';


// =============================================================================
// VALIDATION
// =============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that a template selection is valid before compilation
 */
export function validateTemplateSelection(
  selection: TemplateSelection
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check template exists
  if (!QUERY_TEMPLATES[selection.templateId as keyof typeof QUERY_TEMPLATES]) {
    errors.push(`Unknown template: ${selection.templateId}`);
    return { valid: false, errors, warnings };
  }

  const template = QUERY_TEMPLATES[selection.templateId as keyof typeof QUERY_TEMPLATES];
  const params = selection.parameters;

  // Validate metric if required
  if (params.metric) {
    if (!isValidMetric(params.metric)) {
      // Check if it's actually a conversion metric
      if (isValidConversionMetric(params.metric)) {
        errors.push(`'${params.metric}' is a conversion metric. Use 'conversionMetric' parameter instead of 'metric', or use a conversion template like 'conversion_by_dimension' or 'multi_stage_conversion'.`);
      } else {
        errors.push(`Unknown metric: ${params.metric}`);
      }
    }
  }

  // Validate dimension if present
  if (params.dimension) {
    if (!isValidDimension(params.dimension)) {
      errors.push(`Unknown dimension: ${params.dimension}`);
    }
  }

  // Validate conversion metric if present
  if (params.conversionMetric) {
    if (!isValidConversionMetric(params.conversionMetric)) {
      errors.push(`Unknown conversion metric: ${params.conversionMetric}`);
    }
  }

  // Validate date range (not required for snapshot templates or period_comparison which uses separate period params)
  // generic_detail_list also supports optional dateRange (for "all time" queries)
  const templatesWithoutDateRange = ['open_pipeline_list', 'pipeline_by_stage', 'generic_detail_list', 'mql_detail_list', 'sql_detail_list'];
  if (selection.templateId === 'period_comparison') {
    // Period comparison requires currentPeriod and previousPeriod
    // These can be preset strings (e.g., 'this_quarter') or DateRangeParams objects (for custom ranges)
    if (!params.currentPeriod || !params.previousPeriod) {
      errors.push('Period comparison requires currentPeriod and previousPeriod parameters');
    } else {
      // Validate currentPeriod
      if (typeof params.currentPeriod === 'string') {
        if (!isValidDatePreset(params.currentPeriod)) {
          errors.push(`Invalid currentPeriod preset: ${params.currentPeriod}`);
        }
      } else if (typeof params.currentPeriod === 'object') {
        // It's a DateRangeParams object
        if (params.currentPeriod.preset && !isValidDatePreset(params.currentPeriod.preset)) {
          errors.push(`Invalid currentPeriod preset: ${params.currentPeriod.preset}`);
        }
        if (params.currentPeriod.preset === 'custom' && (!params.currentPeriod.startDate || !params.currentPeriod.endDate)) {
          errors.push('Custom currentPeriod requires startDate and endDate');
        }
      } else {
        errors.push('currentPeriod must be a string (preset) or DateRangeParams object');
      }
      
      // Validate previousPeriod
      if (typeof params.previousPeriod === 'string') {
        if (!isValidDatePreset(params.previousPeriod)) {
          errors.push(`Invalid previousPeriod preset: ${params.previousPeriod}`);
        }
      } else if (typeof params.previousPeriod === 'object') {
        // It's a DateRangeParams object
        if (params.previousPeriod.preset && !isValidDatePreset(params.previousPeriod.preset)) {
          errors.push(`Invalid previousPeriod preset: ${params.previousPeriod.preset}`);
        }
        if (params.previousPeriod.preset === 'custom' && (!params.previousPeriod.startDate || !params.previousPeriod.endDate)) {
          errors.push('Custom previousPeriod requires startDate and endDate');
        }
      } else {
        errors.push('previousPeriod must be a string (preset) or DateRangeParams object');
      }
    }
  } else if (!templatesWithoutDateRange.includes(selection.templateId)) {
    // Date range is optional for "all time" queries
    // If provided, validate it
    if (params.dateRange) {
      if (params.dateRange.preset && !isValidDatePreset(params.dateRange.preset)) {
        errors.push(`Unknown date preset: ${params.dateRange.preset}`);
      }
    }
    // If dateRange is missing, it means "all time" - this is valid
  }

  // Validate filters
  if (params.filters) {
    for (const filter of params.filters) {
      if (!isValidDimension(filter.dimension)) {
        errors.push(`Unknown filter dimension: ${filter.dimension}`);
      }
    }
  }

  // Validate time period for trends
  if (params.timePeriod) {
    if (!['day', 'week', 'month', 'quarter', 'year'].includes(params.timePeriod)) {
      errors.push(`Invalid time period: ${params.timePeriod}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function isValidMetric(metric: string): boolean {
  return (
    metric in VOLUME_METRICS ||
    metric in AUM_METRICS
  );
}

function isValidDimension(dimension: string): boolean {
  return dimension in DIMENSIONS || dimension in TIME_DIMENSIONS;
}

function isValidConversionMetric(metric: string): boolean {
  return metric in CONVERSION_METRICS;
}

function isValidDatePreset(preset: string): boolean {
  return preset in DATE_RANGES;
}

/**
 * Get the SQL fragment for a volume or AUM metric
 * 
 * CRITICAL: DATE vs TIMESTAMP handling (VERIFIED via MCP BigQuery schema)
 * - DATE fields: Use DATE() wrapper
 *   - converted_date_raw: `DATE(v.converted_date_raw) >= DATE(@startDate)`
 *   - advisor_join_date__c: `DATE(v.advisor_join_date__c) >= DATE(@startDate)`
 * - TIMESTAMP fields: Use TIMESTAMP wrapper
 *   - FilterDate: `TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDate)`
 *   - Date_Became_SQO__c: `TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)`
 *   - mql_stage_entered_ts: `TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)`
 *   - stage_entered_contacting__c: `TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)`
 * 
 * CRITICAL: For DISTINCT counting, use `primary_key` field (NOT `sfdc_lead_id` - field doesn't exist)
 * Example: `COUNT(DISTINCT CASE ... THEN v.primary_key END)`
 * 
 * CRITICAL: DISTINCT COUNTING BY METRIC LEVEL
 * 
 * The `primary_key` field is the unique identifier for records in vw_funnel_master.
 * Use COUNT(DISTINCT primary_key) for ALL metrics because:
 * 
 * 1. LEAD-LEVEL METRICS (prospects, contacted, mqls, sqls):
 *    - primary_key is unique per lead
 *    - Counts: COUNT(DISTINCT CASE WHEN [condition] THEN v.primary_key END)
 *    - SGA Filter: v.SGA_Owner_Name__c = @sga
 * 
 * 2. OPPORTUNITY-LEVEL METRICS (sqos, joined, won, lost, pipeline):
 *    - primary_key is STILL the unique identifier (one record per lead/opp combo)
 *    - Counts: COUNT(DISTINCT CASE WHEN [condition] THEN v.primary_key END)
 *    - SGA Filter: (v.SGA_Owner_Name__c = @sga OR v.Opp_SGA_Name__c = @sga)
 *      ^ Note: Check BOTH fields for opportunity metrics!
 * 
 * 3. AUM METRICS (underwritten_aum, joined_aum, pipeline_aum):
 *    - Uses SUM, not COUNT
 *    - Still filtered by primary_key uniqueness via date field conditions
 *    - SGA Filter: Same as opportunity-level
 * 
 * NEVER use sfdc_lead_id (field doesn't exist in current schema)
 * ALWAYS use primary_key for DISTINCT counting
 * 
 * Reference DATE_FIELDS from definitions.ts to determine correct type per field.
 */
export function getMetricSql(metricName: string): string {
  let sql: string;
  let isOppLevel = false;

  if (metricName in VOLUME_METRICS) {
    const metric = VOLUME_METRICS[metricName as keyof typeof VOLUME_METRICS];
    sql = metric.sql;
    isOppLevel = ['sqos', 'joined'].includes(metricName);
  } else if (metricName in AUM_METRICS) {
    const metric = AUM_METRICS[metricName as keyof typeof AUM_METRICS];
    sql = metric.sql;
    isOppLevel = true; // All AUM metrics are opportunity-level
  } else {
    throw new Error(`Unknown metric: ${metricName}`);
  }

  // No RBAC filters - all users see all data
  // Replace placeholders with empty strings
  sql = sql.replace('{sgaFilterLead}', '');
  sql = sql.replace('{sgaFilterOpp}', '');

  return sql;
}

/**
 * Get the SQL fragment for a dimension
 * 
 * Note: Channel_Grouping_Name now comes directly from Finance_View__c in the view, so no JOINs are needed.
 * The dimension.field property contains the field reference.
 */
export function getDimensionSql(dimensionName: string): string {
  if (dimensionName in DIMENSIONS) {
    const dimension = DIMENSIONS[dimensionName as keyof typeof DIMENSIONS];
    return dimension.field;
  } else if (dimensionName in TIME_DIMENSIONS) {
    throw new Error('Use getTimeDimensionSql for time dimensions');
  }
  throw new Error(`Unknown dimension: ${dimensionName}`);
}

/**
 * Get SQL for time dimension with date field
 */
export function getTimeDimensionSql(
  timePeriod: string,
  dateField: string
): string {
  const dimension = TIME_DIMENSIONS[timePeriod as keyof typeof TIME_DIMENSIONS];
  if (!dimension) {
    throw new Error(`Unknown time dimension: ${timePeriod}`);
  }
  return dimension.sql(dateField);
}

/**
 * Get SQL for date range
 * 
 * CRITICAL: DATE vs TIMESTAMP handling (VERIFIED via MCP BigQuery schema)
 * - DATE fields: Use DATE() wrapper: `DATE(field) >= DATE(@startDate)`
 *   - converted_date_raw: DATE type
 *   - advisor_join_date__c: DATE type
 *   - Initial_Call_Scheduled_Date__c: DATE type
 *   - Qualification_Call_Date__c: DATE type
 * - TIMESTAMP fields: Use TIMESTAMP wrapper: `TIMESTAMP(field) >= TIMESTAMP(@startDate)`
 *   - FilterDate: TIMESTAMP type
 *   - stage_entered_contacting__c: TIMESTAMP type
 *   - mql_stage_entered_ts: TIMESTAMP type
 *   - Date_Became_SQO__c: TIMESTAMP type
 *   - Opp_CreatedDate: TIMESTAMP type
 * - Reference DATE_FIELDS from definitions.ts for correct type per field
 * 
 * NOTE: Some existing queries in funnel-metrics.ts incorrectly use TIMESTAMP() for DATE fields.
 * The semantic layer definitions.ts is CORRECT - use DATE() for DATE fields.
 * 
 * For presets: Returns SQL expressions for direct use in SQL (e.g., DATE_TRUNC(CURRENT_DATE(), QUARTER))
 * For custom: Returns DATE() wrapped values for parameter substitution
 * 
 * The startDate/endDate in return value are actual date strings (YYYY-MM-DD) for params object.
 * For presets, we calculate these from the current date.
 */
export function getDateRangeSql(
  dateRange: DateRangeParams
): { startSql: string; endSql: string; startDate: string; endDate: string } {
  if (dateRange.preset && dateRange.preset !== 'custom') {
    const preset = DATE_RANGES[dateRange.preset as keyof typeof DATE_RANGES];
    if (!preset) {
      throw new Error(`Unknown date preset: ${dateRange.preset}`);
    }
    if ('requiresParams' in preset) {
      throw new Error(`Custom date range requires startDate and endDate`);
    }
    
    // Calculate actual date strings for params object
    // For presets, we need to compute the actual dates
    // Since presets use SQL expressions, we'll use the SQL expressions directly in SQL
    // and calculate approximate date strings for the params (these won't be used in SQL but needed for metadata)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Calculate approximate dates based on preset type
    let startDateStr = todayStr;
    let endDateStr = todayStr;
    
    if (dateRange.preset === 'this_quarter') {
      const currentMonth = today.getMonth();
      const currentQuarter = Math.floor(currentMonth / 3);
      const quarterStart = new Date(today.getFullYear(), currentQuarter * 3, 1);
      startDateStr = quarterStart.toISOString().split('T')[0];
      endDateStr = todayStr;
    } else if (dateRange.preset === 'ytd') {
      startDateStr = `${today.getFullYear()}-01-01`;
      endDateStr = todayStr;
    } else if (dateRange.preset === 'this_month') {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      startDateStr = monthStart.toISOString().split('T')[0];
      endDateStr = todayStr;
    } else if (dateRange.preset === 'last_30_days') {
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      startDateStr = thirtyDaysAgo.toISOString().split('T')[0];
      endDateStr = todayStr;
    } else if (dateRange.preset === 'last_90_days') {
      const ninetyDaysAgo = new Date(today);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      startDateStr = ninetyDaysAgo.toISOString().split('T')[0];
      endDateStr = todayStr;
    }
    // For other presets, use today as fallback (SQL expressions will be correct)
    
    return {
      startSql: preset.startDateSql, // SQL expression for direct use
      endSql: preset.endDateSql,     // SQL expression for direct use
      startDate: startDateStr,       // Approximate date string for params/metadata
      endDate: endDateStr,            // Approximate date string for params/metadata
    };
  }

  // Custom date range
  if (!dateRange.startDate || !dateRange.endDate) {
    throw new Error('Custom date range requires startDate and endDate');
  }

  return {
    startSql: `DATE('${dateRange.startDate}')`,
    endSql: `DATE('${dateRange.endDate}')`,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  };
}

/**
 * Get the date field for a given metric
 */
export function getMetricDateField(metricName: string): string {
  if (metricName in VOLUME_METRICS) {
    const metric = VOLUME_METRICS[metricName as keyof typeof VOLUME_METRICS];
    return metric.dateField;
  }
  if (metricName in AUM_METRICS) {
    const metric = AUM_METRICS[metricName as keyof typeof AUM_METRICS];
    // Some AUM metrics (like avg_aum) don't have dateField - use FilterDate as default
    return 'dateField' in metric && metric.dateField ? metric.dateField : 'FilterDate';
  }
  throw new Error(`Unknown metric: ${metricName}`);
}

/**
 * Build dimension filter SQL
 */
export function buildDimensionFilterSql(
  filters: DimensionFilter[], 
  isOppLevel: boolean = false
): { sql: string; needsUserJoin: boolean } {
  if (!filters || filters.length === 0) return { sql: '', needsUserJoin: false };

  const clauses: string[] = [];
  let needsUserJoin = false;

  for (const filter of filters) {
    const dimension = DIMENSIONS[filter.dimension as keyof typeof DIMENSIONS];
    if (!dimension) continue;

    // Handle experimentation tag specially (uses UNNEST with Experimentation_Tag_List)
    if (filter.dimension === 'experimentation_tag') {
      if (filter.operator === 'equals' || filter.operator === 'in') {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        
        // Special case: "*" means "any experimentation tag exists" (array is not empty)
        if (values.length === 1 && values[0] === '*') {
          clauses.push(
            `ARRAY_LENGTH(v.Experimentation_Tag_List) > 0`
          );
        } else {
          // For experimentation tags, support fuzzy matching using LIKE for partial matches
          // This allows users to search for "LPL" and find tags like "LPL Experiment", "LPL Campaign", etc.
          const conditions = values.map((v) => {
            const escapedValue = String(v).replace(/'/g, "''").replace(/%/g, "\\%").replace(/_/g, "\\_");
            // Use LIKE with wildcards for fuzzy matching (case-insensitive)
            return `UPPER(tag) LIKE UPPER('%${escapedValue}%')`;
          });
          clauses.push(
            `EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE ${conditions.join(' OR ')})`
          );
        }
      } else if (filter.operator === 'not_equals' || filter.operator === 'not_in') {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        
        // Special case: "*" means "no experimentation tag exists" (array is empty)
        if (values.length === 1 && values[0] === '*') {
          clauses.push(
            `(ARRAY_LENGTH(v.Experimentation_Tag_List) = 0 OR v.Experimentation_Tag_List IS NULL)`
          );
        } else {
          const conditions = values.map((v) => {
            const escapedValue = String(v).replace(/'/g, "''").replace(/%/g, "\\%").replace(/_/g, "\\_");
            return `UPPER(tag) LIKE UPPER('%${escapedValue}%')`;
          });
          clauses.push(
            `NOT EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE ${conditions.join(' OR ')})`
          );
        }
      }
      continue;
    }

    // Handle campaign: support ID (15–18 char) exact match; name uses fuzzy match (LIKE) so partial names work
    if (filter.dimension === 'campaign') {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      const isId = (v: unknown) => /^[a-zA-Z0-9]{15,18}$/.test(String(v));
      if (filter.operator === 'equals' || filter.operator === 'in') {
        const conditions = values.map((v) => {
          const escaped = String(v).replace(/'/g, "''").replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
          if (isId(v)) {
            return `(v.Campaign_Id__c = '${escaped}' OR EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '${escaped}'))`;
          }
          // Fuzzy match: campaign name contains user value (so "January 2026" matches "Scored List January 2026")
          return `(UPPER(COALESCE(v.Campaign_Name__c, '')) LIKE UPPER('%${escaped}%') OR EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE UPPER(COALESCE(camp.name, '')) LIKE UPPER('%${escaped}%')))`;
        });
        clauses.push(`(${conditions.join(' OR ')})`);
      } else if (filter.operator === 'not_equals' || filter.operator === 'not_in') {
        const conditions = values.map((v) => {
          const escaped = String(v).replace(/'/g, "''").replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
          if (isId(v)) {
            return `(v.Campaign_Id__c IS NULL OR v.Campaign_Id__c != '${escaped}') AND NOT EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '${escaped}')`;
          }
          return `(v.Campaign_Name__c IS NULL OR UPPER(v.Campaign_Name__c) NOT LIKE UPPER('%${escaped}%')) AND NOT EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE UPPER(COALESCE(camp.name, '')) LIKE UPPER('%${escaped}%'))`;
        });
        clauses.push(`(${conditions.join(' AND ')})`);
      }
      continue;
    }

    // Handle SGA with special logic for opportunity-level metrics
    // For opportunity-level metrics, check both SGA_Owner_Name__c and Opp_SGA_Name__c
    // Opp_SGA_Name__c may contain a User ID, so we need User table join to resolve it
    if (filter.dimension === 'sga') {
      if (filter.operator === 'equals' || filter.operator === 'in') {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        const conditions = values.map((v) => {
          const escapedValue = String(v).replace(/'/g, "''").replace(/%/g, "\\%").replace(/_/g, "\\_");
          if (isOppLevel) {
            // For opportunity-level: check both fields and resolved User name
            needsUserJoin = true;
            return `(UPPER(v.SGA_Owner_Name__c) LIKE UPPER('%${escapedValue}%') OR UPPER(v.Opp_SGA_Name__c) LIKE UPPER('%${escapedValue}%') OR UPPER(COALESCE(sga_user.Name, v.Opp_SGA_Name__c)) LIKE UPPER('%${escapedValue}%'))`;
          } else {
            // For lead-level: only check SGA_Owner_Name__c
            return `UPPER(v.SGA_Owner_Name__c) LIKE UPPER('%${escapedValue}%')`;
          }
        });
        clauses.push(`(${conditions.join(' OR ')})`);
      } else if (filter.operator === 'not_equals' || filter.operator === 'not_in') {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        const conditions = values.map((v) => {
          const escapedValue = String(v).replace(/'/g, "''").replace(/%/g, "\\%").replace(/_/g, "\\_");
          if (isOppLevel) {
            // For opportunity-level: check both fields and resolved User name
            needsUserJoin = true;
            return `(UPPER(v.SGA_Owner_Name__c) NOT LIKE UPPER('%${escapedValue}%') AND UPPER(v.Opp_SGA_Name__c) NOT LIKE UPPER('%${escapedValue}%') AND UPPER(COALESCE(sga_user.Name, v.Opp_SGA_Name__c)) NOT LIKE UPPER('%${escapedValue}%'))`;
          } else {
            // For lead-level: only check SGA_Owner_Name__c
            return `UPPER(v.SGA_Owner_Name__c) NOT LIKE UPPER('%${escapedValue}%')`;
          }
        });
        clauses.push(`(${conditions.join(' AND ')})`);
      }
      continue;
    }

    // Handle SGM with fuzzy matching for partial names
    if (filter.dimension === 'sgm') {
      const columnSql = dimension.field;
      if (filter.operator === 'equals' || filter.operator === 'in') {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        // Use LIKE with wildcards for fuzzy matching (case-insensitive)
        const conditions = values.map((v) => {
          const escapedValue = String(v).replace(/'/g, "''").replace(/%/g, "\\%").replace(/_/g, "\\_");
          return `UPPER(${columnSql}) LIKE UPPER('%${escapedValue}%')`;
        });
        clauses.push(`(${conditions.join(' OR ')})`);
      } else if (filter.operator === 'not_equals' || filter.operator === 'not_in') {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        const conditions = values.map((v) => {
          const escapedValue = String(v).replace(/'/g, "''").replace(/%/g, "\\%").replace(/_/g, "\\_");
          return `UPPER(${columnSql}) NOT LIKE UPPER('%${escapedValue}%')`;
        });
        clauses.push(`(${conditions.join(' AND ')})`);
      }
      continue;
    }

    // Standard dimension filter
    const columnSql = dimension.field;
    if (filter.operator === 'equals') {
      const value = String(filter.value).replace(/'/g, "''");
      clauses.push(`${columnSql} = '${value}'`);
    } else if (filter.operator === 'in') {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      const valueList = values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ');
      clauses.push(`${columnSql} IN (${valueList})`);
    } else if (filter.operator === 'not_equals') {
      const value = String(filter.value).replace(/'/g, "''");
      clauses.push(`${columnSql} != '${value}'`);
    } else if (filter.operator === 'not_in') {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      const valueList = values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ');
      clauses.push(`${columnSql} NOT IN (${valueList})`);
    }
  }

  return {
    sql: clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '',
    needsUserJoin,
  };
}

// =============================================================================
// VISUALIZATION DETERMINATION
// =============================================================================

/**
 * Determine the final visualization type based on:
 * 1. Claude's explicit preference (highest priority)
 * 2. Smart defaults based on data characteristics
 * 3. Template default (fallback)
 */
export function determineVisualization(
  templateId: string,
  selection: TemplateSelection,
  rowCount?: number
): { 
  visualization: VisualizationType; 
  overridden: boolean; 
  reason: string;
} {
  const template = QUERY_TEMPLATES[templateId as keyof typeof QUERY_TEMPLATES];
  const templateDefault = template?.visualization || 'table';

  // 1. Claude's explicit preference takes priority
  if (selection.preferredVisualization) {
    const overridden = selection.preferredVisualization !== templateDefault;
    return {
      visualization: selection.preferredVisualization,
      overridden,
      reason: selection.visualizationReasoning || 
        (overridden ? `Overridden from ${templateDefault} to ${selection.preferredVisualization}` : 'Claude preference'),
    };
  }

  // 2. Smart defaults based on data shape (post-query)
  if (rowCount !== undefined) {
    // Single row = metric card
    if (rowCount === 1) {
      return {
        visualization: 'metric',
        overridden: templateDefault !== 'metric',
        reason: 'Single value result displayed as metric card',
      };
    }

    // Small categorical datasets (≤15 rows) that defaulted to table → bar chart
    if (rowCount <= 15 && templateDefault === 'table') {
      return {
        visualization: 'bar',
        overridden: true,
        reason: `Small dataset (${rowCount} rows) better visualized as bar chart`,
      };
    }

    // Large datasets (>50 rows) → table regardless
    if (rowCount > 50 && templateDefault !== 'table') {
      return {
        visualization: 'table',
        overridden: true,
        reason: `Large dataset (${rowCount} rows) requires table for readability`,
      };
    }
  }

  // 3. Fall back to template default
  return {
    visualization: templateDefault as VisualizationType,
    overridden: false,
    reason: `Template default: ${templateDefault}`,
  };
}

// =============================================================================
// MAIN COMPILER
// =============================================================================

/**
 * Compile a template selection into executable SQL
 * Note: No RBAC filters applied - all users can see all data in Explore
 */
export function compileQuery(
  selection: TemplateSelection
): CompiledQuery {
  // Validate first
  const validation = validateTemplateSelection(selection);
  if (!validation.valid) {
    throw new Error(`Invalid template selection: ${validation.errors.join(', ')}`);
  }

  const template = QUERY_TEMPLATES[selection.templateId as keyof typeof QUERY_TEMPLATES];
  const params = selection.parameters;

  // Build the query based on template type
  // Note: No sgaFilter parameter - all users see all data
  let compiledQuery: CompiledQuery;
  switch (selection.templateId) {
    case 'single_metric':
      compiledQuery = compileSingleMetric(params);
      break;
    case 'metric_by_dimension':
      compiledQuery = compileMetricByDimension(params);
      break;
    case 'conversion_by_dimension':
      compiledQuery = compileConversionByDimension(params);
      break;
    case 'metric_trend':
      compiledQuery = compileMetricTrend(params);
      break;
    case 'conversion_trend':
      compiledQuery = compileConversionTrend(params);
      break;
    case 'period_comparison':
      compiledQuery = compilePeriodComparison(params);
      break;
    case 'top_n':
      compiledQuery = compileTopN(params);
      break;
    case 'funnel_summary':
      compiledQuery = compileFunnelSummary(params);
      break;
    case 'pipeline_by_stage':
      compiledQuery = compilePipelineByStage(params);
      break;
    case 'sga_summary':
      compiledQuery = compileSgaSummary(params);
      break;
    case 'sga_leaderboard':
      compiledQuery = compileSgaLeaderboard(params);
      break;
    case 'forecast_vs_actual':
      compiledQuery = compileForecastVsActual(params);
      break;
    case 'average_aum':
      compiledQuery = compileAverageAum(params);
      break;
    case 'time_to_convert':
      compiledQuery = compileTimeToConvert(params);
      break;
    case 'multi_stage_conversion':
      compiledQuery = compileMultiStageConversion(params);
      break;
    case 'sqo_detail_list':
      compiledQuery = compileSqoDetailList(params);
      break;
    case 'generic_detail_list':
    case 'mql_detail_list':
    case 'sql_detail_list':
      // Generic detail list that works for MQLs, SQLs, and other lead-level metrics
      compiledQuery = compileGenericDetailList(params);
      break;
    case 'scheduled_calls_list':
      compiledQuery = compileScheduledCallsList(params);
      break;
    case 'open_pipeline_list':
      compiledQuery = compileOpenPipelineList(params);
      break;
    case 'rolling_average':
      compiledQuery = compileRollingAverage(params);
      break;
    case 'opportunities_by_age':
      compiledQuery = compileOpportunitiesByAge(params);
      break;
    default:
      throw new Error(`Unsupported template: ${selection.templateId}`);
  }

  // Determine visualization (before we know row count - will be re-evaluated post-query)
  const vizResult = determineVisualization(selection.templateId, selection);

  return {
    ...compiledQuery,
    visualization: vizResult.visualization,
    metadata: {
      ...compiledQuery.metadata,
      // Note: visualizationOverridden and visualizationReason are stored in metadata
      // but will be moved to top-level AgentResponse after query execution
      visualizationOverridden: vizResult.overridden,
      visualizationReason: vizResult.reason,
    },
  };
}

// =============================================================================
// TEMPLATE-SPECIFIC COMPILERS
// =============================================================================

function compileSingleMetric(
  params: TemplateSelection['parameters']
): CompiledQuery {
  const { metric, conversionMetric, dateRange, filters } = params;
  
  // Support both regular metrics and conversion metrics
  if (!metric && !conversionMetric) {
    throw new Error('Metric or conversionMetric is required for single_metric template');
  }
  // Date range is optional - if missing, query is for "all time"

  let metricSql: string;
  let dateField: string;
  let dateWrapper: string;
  
  if (conversionMetric) {
    // Handle conversion metric
    const conversion = CONVERSION_METRICS[conversionMetric as keyof typeof CONVERSION_METRICS];
    if (!conversion) throw new Error(`Unknown conversion metric: ${conversionMetric}`);
    
    dateField = conversion.cohortDateField;
    const dateFieldInfo = SEMANTIC_LAYER.dateFields[dateField as keyof typeof SEMANTIC_LAYER.dateFields];
    const isDateType = dateFieldInfo?.type === 'DATE';
    dateWrapper = isDateType ? 'DATE' : 'TIMESTAMP';
    
    // Build conversion rate SQL (cohort mode)
    if (dateRange) {
      const dateRangeSql = getDateRangeSql(dateRange);
      const isPreset = dateRange.preset && dateRange.preset !== 'custom';
      
      // For presets, use the correct wrapper based on field type
      // For DATE fields: Use DATE() wrapper on preset expressions (which may include time, but DATE() will extract date part)
      // For TIMESTAMP fields: Use TIMESTAMP() wrapper on preset expressions
      // For custom ranges: Use parameter placeholders with appropriate wrapper
      const startDateExpr = isPreset 
        ? (isDateType ? `DATE(${dateRangeSql.startSql})` : `${dateWrapper}(${dateRangeSql.startSql})`)
        : (isDateType ? `DATE(@startDate)` : `${dateWrapper}(@startDate)`);
      const endDateExpr = isPreset
        ? (isDateType ? `DATE(${dateRangeSql.endSql})` : `${dateWrapper}(${dateRangeSql.endSql})`)
        : (isDateType ? `DATE(@endDate)` : `${dateWrapper}(@endDate)`);
      
      metricSql = `
        SAFE_DIVIDE(
          COUNTIF(
            ${dateWrapper}(v.${dateField}) IS NOT NULL
            AND ${dateWrapper}(v.${dateField}) >= ${startDateExpr}
            AND ${dateWrapper}(v.${dateField}) <= ${endDateExpr}
            AND v.${conversion.numeratorField} = 1
          ),
          COUNTIF(
            ${dateWrapper}(v.${dateField}) IS NOT NULL
            AND ${dateWrapper}(v.${dateField}) >= ${startDateExpr}
            AND ${dateWrapper}(v.${dateField}) <= ${endDateExpr}
            AND v.${conversion.denominatorField} = 1
          )
        ) * 100
      `.trim();
    } else {
      // No date range = "all time" - no date filtering
      metricSql = `
        SAFE_DIVIDE(
          COUNTIF(
            ${dateWrapper}(v.${dateField}) IS NOT NULL
            AND v.${conversion.numeratorField} = 1
          ),
          COUNTIF(
            ${dateWrapper}(v.${dateField}) IS NOT NULL
            AND v.${conversion.denominatorField} = 1
          )
        ) * 100
      `.trim();
    }
  } else {
    // Handle regular metric
    metricSql = getMetricSql(metric!);
    dateField = getMetricDateField(metric!);
    dateWrapper = dateField.includes('TIMESTAMP') ? 'TIMESTAMP' : 'DATE';
  }
  
  // Determine if this is an opportunity-level metric (SQOs, Joined, AUM)
  // These metrics require checking both SGA_Owner_Name__c and Opp_SGA_Name__c
  const isOppLevelMetric = metric && (
    ['sqos', 'joined'].includes(metric) || 
    metric in AUM_METRICS ||
    metric === 'signed'
  );
  
  const filterResult = buildDimensionFilterSql(filters || [], isOppLevelMetric || false);
  const filterSql = filterResult.sql;
  const needsUserJoin = filterResult.needsUserJoin;

  // Handle date range (optional for "all time" queries)
  let dateFilterSql = '';
  let isPreset = false;
  let dateRangeSql: ReturnType<typeof getDateRangeSql> | null = null;
  
  if (dateRange) {
    dateRangeSql = getDateRangeSql(dateRange);
    isPreset = !!(dateRange.preset && dateRange.preset !== 'custom');
    
    if (conversionMetric) {
      // For conversion metrics, date conditions are embedded in metricSql
      // We need to remove them if dateRange is missing, but if it's present, they're already there
      // So no additional date filter needed here
    } else {
      // CRITICAL: For regular metrics, date filtering is already in the CASE statement within metricSql
      // DO NOT add redundant date filters to WHERE clause - this causes double filtering and count discrepancies
      // The metric SQL definitions (VOLUME_METRICS, AUM_METRICS) already include date range checks in their CASE statements
      // Adding WHERE clause date filters would filter rows BEFORE the CASE evaluation, potentially excluding valid records
      // Example: SQO metric has: AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate) in CASE
      // Adding WHERE clause filter would be redundant and could cause mismatches (DATE() vs TIMESTAMP())
      // dateFilterSql remains empty - date filtering happens only in metricSql CASE statements
    }
    
    // Replace @startDate and @endDate placeholders in metric SQL (only for regular metrics, not conversion metrics which already have dates embedded)
    // For presets: Use SQL expressions directly (e.g., DATE_TRUNC(CURRENT_DATE(), QUARTER))
    // For custom: Use parameter placeholders (will be replaced by BigQuery parameter substitution)
    if (!conversionMetric && dateRangeSql) {
      // Only replace placeholders for regular metrics (conversion metrics already have dates embedded)
      if (isPreset) {
        // Replace placeholders with SQL expressions for presets
        metricSql = metricSql.replace(/@startDate/g, dateRangeSql.startSql);
        metricSql = metricSql.replace(/@endDate/g, dateRangeSql.endSql);
      }
      // For custom ranges, keep @startDate and @endDate as BigQuery parameters
      // The params object will provide the actual date values
    }
  } else {
    // No date range = "all time" query
    // For conversion metrics, date conditions are already removed in the conversion metric block above
    // For regular metrics, remove @startDate and @endDate placeholders from CASE WHEN conditions
    if (!conversionMetric) {
      // The metric SQL has conditions like: AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      // or: AND DATE(v.converted_date_raw) >= DATE(@startDate)
      // 
      // CRITICAL: Use a line-by-line approach to safely remove date conditions
      // This prevents issues like "NULLAND" where spacing gets corrupted
      const lines = metricSql.split(/\r?\n/);
      const filteredLines = lines.filter(line => {
        // Keep lines that don't contain date condition patterns
        const trimmed = line.trim();
        // Remove lines that contain @startDate or @endDate in date comparisons
        if (trimmed.includes('@startDate') || trimmed.includes('@endDate')) {
          // Check if this is a date condition line (contains AND + date function + comparison)
          // Pattern: AND TIMESTAMP(v.field) >= TIMESTAMP(@startDate) or similar
          const isDateCondition = /AND\s+(TIMESTAMP|DATE)\(v\.[\w_.]+\)\s*[><=]+\s*(TIMESTAMP|DATE)?\(?@(startDate|endDate)/i.test(trimmed);
          if (isDateCondition) {
            return false; // Remove this line
          }
        }
        return true; // Keep this line
      });
      metricSql = filteredLines.join('\n');
      
      // Clean up any double newlines or excessive whitespace that might have been created
      metricSql = metricSql.replace(/\n{3,}/g, '\n\n');
      metricSql = metricSql.replace(/[ \t]{3,}/g, '  '); // Replace 3+ spaces with 2 spaces
      
      // Ensure proper spacing around AND keywords (fix any "NULLAND" or similar issues)
      metricSql = metricSql.replace(/(\w+)(AND)(\w+)/gi, '$1 AND $3');
    }
  }

  // For open_pipeline_aum, add is_sqo_unique filter to match main dashboard
  let additionalWhereClause = '';
  if (metric === 'open_pipeline_aum') {
    additionalWhereClause = `
  AND v.recordtypeid = @recruitingRecordType
  AND v.StageName IN UNNEST(@openPipelineStages)
  AND v.is_sqo_unique = 1`;
  }

  const userJoin = needsUserJoin 
    ? `LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user ON v.Opp_SGA_Name__c = sga_user.Id`
    : '';

  const sql = `
SELECT
  ${metricSql} as value
FROM \`${CONSTANTS.FULL_TABLE}\` v
${userJoin}
WHERE 1=1
  ${filterSql}${dateFilterSql}${additionalWhereClause}
  `.trim();

  // Build params object - for presets, we still include date strings for metadata
  // but they won't be used in SQL (SQL expressions are used instead)
  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
  };
  
  // Add required parameters for the metric (from metric definition)
  if (metric && !conversionMetric) {
    let metricDef: { requiredParams?: readonly string[] } | undefined;
    if (metric in VOLUME_METRICS) {
      metricDef = VOLUME_METRICS[metric as keyof typeof VOLUME_METRICS] as { requiredParams?: readonly string[] };
    } else if (metric in AUM_METRICS) {
      metricDef = AUM_METRICS[metric as keyof typeof AUM_METRICS] as { requiredParams?: readonly string[] };
    }
    
    if (metricDef?.requiredParams) {
      for (const param of metricDef.requiredParams) {
        if (param === 'openPipelineStages') {
          queryParams.openPipelineStages = CONSTANTS.OPEN_PIPELINE_STAGES;
        }
        // recruitingRecordType is already added above
        // Add other required params here as needed
      }
    }
  }
  
  // Only add date parameters for custom ranges (presets use SQL expressions directly)
  // Skip if no date range (all time query)
  if (dateRange && !isPreset && dateRangeSql) {
    queryParams.startDate = dateRangeSql.startDate;
    queryParams.endDate = dateRangeSql.endDate;
  }

  return {
    sql,
    params: queryParams,
    templateId: 'single_metric',
    visualization: 'metric',
    metadata: {
      metric: conversionMetric || metric,
      dateRange: dateRangeSql ? {
        start: dateRangeSql.startDate,
        end: dateRangeSql.endDate,
      } : {
        start: new Date().toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
      },
    },
  };
}

function compileMetricByDimension(
  params: TemplateSelection['parameters']
): CompiledQuery {
  // CRITICAL: For GROUP BY queries, use COUNT(DISTINCT primary_key) for volume metrics
  // NOT COUNT(*) - this ensures proper deduplication
  // The metricSql from getMetricSql() should use COUNT(DISTINCT primary_key) pattern
  const { metric, dimension, dateRange, filters, limit } = params;
  if (!metric) throw new Error('Metric is required');
  if (!dimension) throw new Error('Dimension is required');
  if (!dateRange) throw new Error('Date range is required for metric_by_dimension template');

  let metricSql = getMetricSql(metric);
  const dimensionSql = getDimensionSql(dimension);
  const dateRangeSql = getDateRangeSql(dateRange);
  const filterResult = buildDimensionFilterSql(filters || [], false);
  const filterSql = filterResult.sql;
  const limitSql = limit ? `LIMIT ${limit}` : '';

  // Replace @startDate and @endDate placeholders in metric SQL
  const isPreset = dateRange.preset && dateRange.preset !== 'custom';
  if (isPreset) {
    metricSql = metricSql.replace(/@startDate/g, dateRangeSql.startSql);
    metricSql = metricSql.replace(/@endDate/g, dateRangeSql.endSql);
  }

  const sql = `
SELECT
  ${dimensionSql} as dimension_value,
  ${metricSql} as metric_value
FROM \`${CONSTANTS.FULL_TABLE}\` v
WHERE 1=1
  ${filterSql}
GROUP BY dimension_value
HAVING metric_value > 0
ORDER BY metric_value DESC
${limitSql}
  `.trim();

  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
  };
  
  if (!isPreset) {
    queryParams.startDate = dateRangeSql.startDate;
    queryParams.endDate = dateRangeSql.endDate;
  }

  return {
    sql,
    params: queryParams,
    templateId: 'metric_by_dimension',
    visualization: 'bar',
    metadata: {
      metric,
      dimension,
      dateRange: {
        start: dateRangeSql.startDate,
        end: dateRangeSql.endDate,
      },
    },
  };
}

function compileConversionByDimension(
  params: TemplateSelection['parameters']
): CompiledQuery {
  // CRITICAL: Conversion metrics ALWAYS use COHORT MODE
  // The conversion metric SQL from definitions.ts already enforces cohort mode
  // Do not modify the cohort calculation logic
  const { conversionMetric, dimension, dateRange, filters } = params;
  if (!conversionMetric) throw new Error('Conversion metric is required');
  if (!dimension) throw new Error('Dimension is required');
  if (!dateRange) throw new Error('Date range is required for conversion_by_dimension template');

  const conversion = CONVERSION_METRICS[conversionMetric as keyof typeof CONVERSION_METRICS];
  if (!conversion) throw new Error(`Unknown conversion metric: ${conversionMetric}`);

  const dimensionSql = getDimensionSql(dimension);
  const dateRangeSql = getDateRangeSql(dateRange);
  const filterResult = buildDimensionFilterSql(filters || [], false);
  const filterSql = filterResult.sql;

  // Determine if we need DATE() or TIMESTAMP() wrapper based on cohortDateField type
  // Check DATE_FIELDS to determine the type
  const dateFieldInfo = SEMANTIC_LAYER.dateFields[conversion.cohortDateField as keyof typeof SEMANTIC_LAYER.dateFields];
  const isDateType = dateFieldInfo?.type === 'DATE';
  const dateWrapper = isDateType ? 'DATE' : 'TIMESTAMP';

  // Build cohort-based conversion SQL using numeratorField and denominatorField
  // These are field names like 'sql_to_sqo_progression' and 'eligible_for_sql_conversions'
  const sql = `
SELECT
  ${dimensionSql} as dimension_value,
  SAFE_DIVIDE(
    SUM(CASE WHEN v.${conversion.numeratorField} = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN v.${conversion.denominatorField} = 1 THEN 1 ELSE 0 END)
  ) * 100 as rate,
  SUM(CASE WHEN v.${conversion.numeratorField} = 1 THEN 1 ELSE 0 END) as numerator,
  SUM(CASE WHEN v.${conversion.denominatorField} = 1 THEN 1 ELSE 0 END) as denominator
FROM \`${CONSTANTS.FULL_TABLE}\` v
WHERE v.${conversion.cohortDateField} IS NOT NULL
  AND ${dateWrapper}(v.${conversion.cohortDateField}) >= ${dateWrapper}(${dateRangeSql.startSql})
  AND ${dateWrapper}(v.${conversion.cohortDateField}) <= ${dateWrapper}(${dateRangeSql.endSql})
  ${filterSql}
GROUP BY dimension_value
HAVING denominator > 0
ORDER BY rate DESC
  `.trim();

  const isPreset = dateRange.preset && dateRange.preset !== 'custom';
  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
  };
  
  if (!isPreset) {
    queryParams.startDate = dateRangeSql.startDate;
    queryParams.endDate = dateRangeSql.endDate;
  }

  return {
    sql,
    params: queryParams,
    templateId: 'conversion_by_dimension',
    visualization: 'bar',
    metadata: {
      metric: conversionMetric,
      dimension,
      dateRange: {
        start: dateRangeSql.startDate,
        end: dateRangeSql.endDate,
      },
    },
  };
}

function compileMetricTrend(
  params: TemplateSelection['parameters']
): CompiledQuery {
  const { metric, timePeriod, dateRange, filters, includeRollingAverage, rollingAverageWindow } = params;
  if (!metric) throw new Error('Metric is required');
  if (!timePeriod) throw new Error('Time period is required');
  if (!dateRange) throw new Error('Date range is required for metric_trend template');

  const metricDateField = getMetricDateField(metric);
  let metricSql = getMetricSql(metric);
  const timeDimensionSql = getTimeDimensionSql(timePeriod, `v.${metricDateField}`);
  const dateRangeSql = getDateRangeSql(dateRange);
  const filterResult = buildDimensionFilterSql(filters || [], false);
  const filterSql = filterResult.sql;

  // Replace @startDate and @endDate placeholders in metric SQL
  const isPreset = dateRange.preset && dateRange.preset !== 'custom';
  if (isPreset) {
    metricSql = metricSql.replace(/@startDate/g, dateRangeSql.startSql);
    metricSql = metricSql.replace(/@endDate/g, dateRangeSql.endSql);
  }

  // Determine DATE vs TIMESTAMP wrapper for date field
  const dateFieldInfo = SEMANTIC_LAYER.dateFields[metricDateField as keyof typeof SEMANTIC_LAYER.dateFields];
  const isDateType = dateFieldInfo?.type === 'DATE';
  const dateWrapper = isDateType ? 'DATE' : 'TIMESTAMP';

  // Rolling average calculation
  const rollingAvgSql = includeRollingAverage && rollingAverageWindow
    ? `AVG(metric_value) OVER (ORDER BY period ROWS BETWEEN ${rollingAverageWindow - 1} PRECEDING AND CURRENT ROW) as rolling_avg`
    : 'NULL as rolling_avg';

  const sql = `
WITH period_metrics AS (
  SELECT
    ${timeDimensionSql} as period,
    ${metricSql} as metric_value
  FROM \`${CONSTANTS.FULL_TABLE}\` v
  WHERE v.${metricDateField} IS NOT NULL
    AND ${dateWrapper}(v.${metricDateField}) >= ${dateWrapper}(${dateRangeSql.startSql})
    AND ${dateWrapper}(v.${metricDateField}) <= ${dateWrapper}(${dateRangeSql.endSql})
    ${filterSql}
  GROUP BY period
)
SELECT
  period,
  metric_value as raw_value,
  ${rollingAvgSql}
FROM period_metrics
ORDER BY period ASC
  `.trim();

  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
  };
  
  if (!isPreset) {
    queryParams.startDate = dateRangeSql.startDate;
    queryParams.endDate = dateRangeSql.endDate;
  }

  return {
    sql,
    params: queryParams,
    templateId: 'metric_trend',
    visualization: 'line',
    metadata: {
      metric,
      dateRange: {
        start: dateRangeSql.startDate,
        end: dateRangeSql.endDate,
      },
    },
  };
}

// =============================================================================
// HELPER: Generate expected periods for trend queries
// =============================================================================

/**
 * Generate all expected periods (quarters or months) within a date range
 * This ensures all periods are shown in trend queries even if there's no data
 */
function generateExpectedPeriods(
  startDate: string,
  endDate: string,
  timePeriod: string
): string[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const periods: string[] = [];

  if (timePeriod === 'quarter') {
    // Start from the beginning of the quarter containing startDate
    const startQuarter = Math.floor(start.getMonth() / 3) + 1;
    const startYear = start.getFullYear();
    const current = new Date(startYear, (startQuarter - 1) * 3, 1);

    // End at the beginning of the quarter containing endDate (we'll include that quarter)
    const endQuarter = Math.floor(end.getMonth() / 3) + 1;
    const endYear = end.getFullYear();
    const endQuarterStart = new Date(endYear, (endQuarter - 1) * 3, 1);

    while (current <= endQuarterStart) {
      const year = current.getFullYear();
      const quarter = Math.floor(current.getMonth() / 3) + 1;
      periods.push(`${year}-Q${quarter}`);
      // Move to next quarter
      current.setMonth(current.getMonth() + 3);
    }
  } else if (timePeriod === 'month') {
    // Start from the beginning of the month containing startDate
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    // End at the beginning of the month containing endDate (we'll include that month)
    const endMonthStart = new Date(end.getFullYear(), end.getMonth(), 1);

    while (current <= endMonthStart) {
      const year = current.getFullYear();
      const month = current.getMonth() + 1;
      periods.push(`${year}-${String(month).padStart(2, '0')}`);
      // Move to next month
      current.setMonth(current.getMonth() + 1);
    }
  } else if (timePeriod === 'week') {
    // Start from the beginning of the week (Monday) containing startDate
    const current = new Date(start);
    const dayOfWeek = current.getDay();
    const diff = current.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Adjust to Monday
    current.setDate(diff);
    current.setHours(0, 0, 0, 0);

    while (current <= end) {
      const year = current.getFullYear();
      const week = getWeekNumber(current);
      periods.push(`${year}-W${String(week).padStart(2, '0')}`);
      // Move to next week (7 days)
      current.setDate(current.getDate() + 7);
    }
  }

  return periods;
}

/**
 * Get ISO week number for a date
 */
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Stub implementations for remaining templates
// These follow the same pattern - implement based on query-templates.ts

function compileConversionTrend(params: TemplateSelection['parameters']): CompiledQuery {
  // CRITICAL: Conversion trends ALWAYS use COHORT MODE
  // Use cohortDateField from the conversion metric definition
  // Do not use periodic mode for conversion rates
  const { conversionMetric, timePeriod, dateRange, filters } = params;
  if (!conversionMetric) throw new Error('Conversion metric is required for conversion_trend template');
  if (!timePeriod) throw new Error('Time period is required for conversion_trend template');
  if (!dateRange) throw new Error('Date range is required for conversion_trend template');

  const conversion = CONVERSION_METRICS[conversionMetric as keyof typeof CONVERSION_METRICS];
  if (!conversion) throw new Error(`Unknown conversion metric: ${conversionMetric}`);

  // Get the cohort date field and determine DATE vs TIMESTAMP wrapper
  const cohortDateField = conversion.cohortDateField;
  const dateFieldInfo = SEMANTIC_LAYER.dateFields[cohortDateField as keyof typeof SEMANTIC_LAYER.dateFields];
  const isDateType = dateFieldInfo?.type === 'DATE';
  const dateWrapper = isDateType ? 'DATE' : 'TIMESTAMP';

  // Get time dimension SQL for grouping
  const timeDimensionSql = getTimeDimensionSql(timePeriod, `v.${cohortDateField}`);
  const dateRangeSql = getDateRangeSql(dateRange);
  const filterResult = buildDimensionFilterSql(filters || [], false);
  const filterSql = filterResult.sql;

  // No RBAC filters - all users see all data
  const isPreset = dateRange.preset && dateRange.preset !== 'custom';

  // Build date filter expressions
  const startDateExpr = isPreset ? dateRangeSql.startSql : '@startDate';
  const endDateExpr = isPreset ? dateRangeSql.endSql : '@endDate';

  // Generate expected periods based on date range and timePeriod
  // This ensures all periods are shown even if there's no data
  const expectedPeriods = generateExpectedPeriods(
    dateRangeSql.startDate,
    dateRangeSql.endDate,
    timePeriod
  );
  const expectedPeriodsSql = expectedPeriods.map(p => `'${p}'`).join(', ');

  const sql = `
WITH conversion_data AS (
  SELECT
    ${timeDimensionSql} as period,
    SUM(CASE WHEN v.${conversion.numeratorField} = 1 THEN 1 ELSE 0 END) as numerator,
    SUM(CASE WHEN v.${conversion.denominatorField} = 1 THEN 1 ELSE 0 END) as denominator
  FROM \`${CONSTANTS.FULL_TABLE}\` v
  WHERE v.${cohortDateField} IS NOT NULL
    AND ${dateWrapper}(v.${cohortDateField}) >= ${dateWrapper}(${startDateExpr})
    AND ${dateWrapper}(v.${cohortDateField}) <= ${dateWrapper}(${endDateExpr})
    ${filterSql}
  GROUP BY period
),
all_periods AS (
  SELECT period FROM UNNEST([${expectedPeriodsSql}]) as period
)
SELECT
  ap.period,
  SAFE_DIVIDE(
    COALESCE(cd.numerator, 0),
    NULLIF(COALESCE(cd.denominator, 0), 0)
  ) * 100 as rate,
  COALESCE(cd.numerator, 0) as numerator,
  COALESCE(cd.denominator, 0) as denominator
FROM all_periods ap
LEFT JOIN conversion_data cd ON ap.period = cd.period
ORDER BY ap.period ASC
  `.trim();

  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
  };
  
  if (!isPreset) {
    queryParams.startDate = dateRangeSql.startDate;
    queryParams.endDate = dateRangeSql.endDate;
  }

  return {
    sql,
    params: queryParams,
    templateId: 'conversion_trend',
    visualization: 'line',
    metadata: {
      metric: conversionMetric,
      dateRange: {
        start: dateRangeSql.startDate,
        end: dateRangeSql.endDate,
      },
    },
  };
}

function compilePeriodComparison(params: TemplateSelection['parameters']): CompiledQuery {
  const { metric, conversionMetric, currentPeriod, previousPeriod, filters } = params;
  
  // Support both regular metrics and conversion metrics
  if (!metric && !conversionMetric) {
    throw new Error('Metric or conversionMetric is required for period_comparison template');
  }
  if (!currentPeriod || !previousPeriod) {
    throw new Error('Period comparison requires currentPeriod and previousPeriod parameters');
  }

  let metricSql: string;
  let dateField: string;
  let dateWrapper: string;
  
  if (conversionMetric) {
    // Handle conversion metric
    const conversion = CONVERSION_METRICS[conversionMetric as keyof typeof CONVERSION_METRICS];
    if (!conversion) throw new Error(`Unknown conversion metric: ${conversionMetric}`);
    
    dateField = conversion.cohortDateField;
    const dateFieldInfo = SEMANTIC_LAYER.dateFields[dateField as keyof typeof SEMANTIC_LAYER.dateFields];
    const isDateType = dateFieldInfo?.type === 'DATE';
    dateWrapper = isDateType ? 'DATE' : 'TIMESTAMP';
    
    // Build conversion rate SQL (cohort mode) - we'll build the full SQL here
    // For period comparison, we need to build separate SQL for each period
    metricSql = `
      SAFE_DIVIDE(
        COUNTIF(
          ${dateWrapper}(v.${dateField}) IS NOT NULL
          AND ${dateWrapper}(v.${dateField}) >= @startDate
          AND ${dateWrapper}(v.${dateField}) <= @endDate
          AND v.${conversion.numeratorField} = 1
        ),
        COUNTIF(
          ${dateWrapper}(v.${dateField}) IS NOT NULL
          AND ${dateWrapper}(v.${dateField}) >= @startDate
          AND ${dateWrapper}(v.${dateField}) <= @endDate
          AND v.${conversion.denominatorField} = 1
        )
      ) * 100
    `.trim();
  } else {
    // Handle regular metric
    metricSql = getMetricSql(metric!);
    dateField = getMetricDateField(metric!);
    dateWrapper = dateField.includes('TIMESTAMP') ? 'TIMESTAMP' : 'DATE';
  }

  // Get date ranges for current and previous periods
  // Handle both preset strings and DateRangeParams objects
  const currentPeriodParam = typeof currentPeriod === 'string' 
    ? { preset: currentPeriod } 
    : currentPeriod;
  const previousPeriodParam = typeof previousPeriod === 'string'
    ? { preset: previousPeriod }
    : previousPeriod;
  
  // Validate custom date ranges have required fields
  if (typeof currentPeriodParam === 'object' && currentPeriodParam.preset === 'custom') {
    if (!currentPeriodParam.startDate || !currentPeriodParam.endDate) {
      throw new Error('currentPeriod with preset "custom" requires startDate and endDate');
    }
  }
  if (typeof previousPeriodParam === 'object' && previousPeriodParam.preset === 'custom') {
    if (!previousPeriodParam.startDate || !previousPeriodParam.endDate) {
      throw new Error('previousPeriod with preset "custom" requires startDate and endDate');
    }
  }
    
  const currentRange = getDateRangeSql(currentPeriodParam);
  const previousRange = getDateRangeSql(previousPeriodParam);
  
  const currentStartSql = currentRange.startSql;
  const currentEndSql = currentRange.endSql;
  const previousStartSql = previousRange.startSql;
  const previousEndSql = previousRange.endSql;
  const currentStartDate = currentRange.startDate;
  const currentEndDate = currentRange.endDate;
  const previousStartDate = previousRange.startDate;
  const previousEndDate = previousRange.endDate;

  const filterResult = buildDimensionFilterSql(filters || [], false);
  const filterSql = filterResult.sql;

  // Determine if we're using presets (SQL expressions) or custom ranges (parameters)
  const currentIsPreset = typeof currentPeriod === 'string' || (typeof currentPeriod === 'object' && currentPeriod.preset && currentPeriod.preset !== 'custom');
  const previousIsPreset = typeof previousPeriod === 'string' || (typeof previousPeriod === 'object' && previousPeriod.preset && previousPeriod.preset !== 'custom');

  // Build date filters for current and previous periods
  // For presets: Use SQL expressions directly
  // For custom: Use parameter placeholders
  // CRITICAL: For current period, use DATE() conversion for consistency
  // This ensures both DATE and TIMESTAMP fields are compared as DATE values
  // DATE_TRUNC() and CURRENT_DATE() return DATE, but we need to ensure explicit DATE type
  // Pattern: DATE(v.field) >= DATE(date_expression) to ensure both sides are DATE
  const currentPeriodFilter = currentIsPreset
    ? `
    AND DATE(v.${dateField}) >= DATE(${currentStartSql})
    AND DATE(v.${dateField}) <= DATE(${currentEndSql})`
    : `
    AND DATE(v.${dateField}) >= DATE(@currentStartDate)
    AND DATE(v.${dateField}) <= DATE(@currentEndDate)`;

  // CRITICAL: For previous period with presets, the endDateSql for last_quarter contains ' 23:59:59'
  // The SQL is: CONCAT(CAST(DATE_SUB(...) AS STRING), ' 23:59:59')
  // When we wrap this with DATE(), it strips the time: DATE(CONCAT(...)) = DATE('2025-09-30 23:59:59') = '2025-09-30'
  // Then TIMESTAMP(DATE(...)) = '2025-09-30 00:00:00', which excludes records later in the day.
  // Solution: Extract the date part and use < next_day pattern to include the full day.
  // For last_quarter, the endDateSql returns a string like '2025-09-30 23:59:59'
  // We extract the date part and add 1 day: DATE_ADD(DATE('2025-09-30'), INTERVAL 1 DAY) = '2025-10-01'
  // Then use < TIMESTAMP('2025-10-01') to include all of 2025-09-30
  // CRITICAL: For previous period with presets, we need to include the full last day
  // For last_quarter, endDateSql is now: DATE_SUB(DATE_TRUNC(CURRENT_DATE(), QUARTER), INTERVAL 1 DAY)
  // This returns a DATE (the last day of the previous quarter)
  // For DATE fields: Use DATE(v.field) <= DATE(endDateSql) - both sides are DATE, includes the full day
  // For TIMESTAMP fields: Use DATE(v.field) <= DATE(endDateSql) - convert TIMESTAMP to DATE for comparison
  // Note: Using DATE() conversion on TIMESTAMP fields matches the working BigQuery pattern
  // CRITICAL: Wrap date expressions in DATE() to ensure explicit DATE type (even if they already return DATE)
  // This ensures type consistency and matches the working BigQuery query pattern
  // CRITICAL: For custom ranges, also use DATE() conversion for consistency
  // This ensures both DATE and TIMESTAMP fields are compared as DATE values
  const previousPeriodFilter = previousIsPreset
    ? `
    AND DATE(v.${dateField}) >= DATE(${previousStartSql})
    AND DATE(v.${dateField}) <= DATE(${previousEndSql})`
    : `
    AND DATE(v.${dateField}) >= DATE(@previousStartDate)
    AND DATE(v.${dateField}) <= DATE(@previousEndDate)`;

  // Replace placeholders in metric SQL for current period
  // CRITICAL: The metric SQL template may use TIMESTAMP(@startDate) or DATE(@startDate)
  // We need to replace these with DATE() expressions to ensure type consistency
  // Pattern: TIMESTAMP(@startDate) -> DATE(date_expression) and DATE(@startDate) -> DATE(date_expression)
  let currentMetricSql = metricSql;
  
  // First, convert TIMESTAMP(v.field) to DATE(v.field) for type consistency
  currentMetricSql = currentMetricSql.replace(
    /TIMESTAMP\s*\(\s*v\.(\w+)\s*\)/g,
    `DATE(v.$1)`
  );
  
  // Then replace @startDate and @endDate placeholders
  // CRITICAL: Replace TIMESTAMP(@startDate) with DATE(date_expression) to match the field conversion
  if (currentIsPreset) {
    // Replace TIMESTAMP(@startDate) with DATE(date_expression)
    currentMetricSql = currentMetricSql.replace(
      /TIMESTAMP\s*\(\s*@startDate\s*\)/g,
      `DATE(${currentStartSql})`
    );
    currentMetricSql = currentMetricSql.replace(
      /TIMESTAMP\s*\(\s*@endDate\s*\)/g,
      `DATE(${currentEndSql})`
    );
    // Replace DATE(@startDate) with DATE(date_expression)
    currentMetricSql = currentMetricSql.replace(
      /DATE\s*\(\s*@startDate\s*\)/g,
      `DATE(${currentStartSql})`
    );
    currentMetricSql = currentMetricSql.replace(
      /DATE\s*\(\s*@endDate\s*\)/g,
      `DATE(${currentEndSql})`
    );
    // Fallback: replace bare @startDate/@endDate
    currentMetricSql = currentMetricSql.replace(/@startDate/g, `DATE(${currentStartSql})`);
    currentMetricSql = currentMetricSql.replace(/@endDate/g, `DATE(${currentEndSql})`);
  } else {
    // For custom ranges, use parameter placeholders with DATE() wrapper
    currentMetricSql = currentMetricSql.replace(
      /TIMESTAMP\s*\(\s*@startDate\s*\)/g,
      `DATE(@currentStartDate)`
    );
    currentMetricSql = currentMetricSql.replace(
      /TIMESTAMP\s*\(\s*@endDate\s*\)/g,
      `DATE(@currentEndDate)`
    );
    currentMetricSql = currentMetricSql.replace(
      /DATE\s*\(\s*@startDate\s*\)/g,
      `DATE(@currentStartDate)`
    );
    currentMetricSql = currentMetricSql.replace(
      /DATE\s*\(\s*@endDate\s*\)/g,
      `DATE(@currentEndDate)`
    );
    // Fallback
    currentMetricSql = currentMetricSql.replace(/@startDate/g, `DATE(@currentStartDate)`);
    currentMetricSql = currentMetricSql.replace(/@endDate/g, `DATE(@currentEndDate)`);
  }

  // Replace placeholders in metric SQL for previous period
  // CRITICAL: The metric SQL template may use TIMESTAMP(@startDate) or DATE(@startDate)
  // We need to replace these with DATE() expressions to ensure type consistency
  let previousMetricSql = metricSql;
  
  // First, convert TIMESTAMP(v.field) to DATE(v.field) for type consistency
  previousMetricSql = previousMetricSql.replace(
    /TIMESTAMP\s*\(\s*v\.(\w+)\s*\)/g,
    `DATE(v.$1)`
  );
  
  // Then replace @startDate and @endDate placeholders
  // CRITICAL: Replace TIMESTAMP(@startDate) with DATE(date_expression) to match the field conversion
  if (previousIsPreset) {
    // Replace TIMESTAMP(@startDate) with DATE(date_expression)
    previousMetricSql = previousMetricSql.replace(
      /TIMESTAMP\s*\(\s*@startDate\s*\)/g,
      `DATE(${previousStartSql})`
    );
    previousMetricSql = previousMetricSql.replace(
      /TIMESTAMP\s*\(\s*@endDate\s*\)/g,
      `DATE(${previousEndSql})`
    );
    // Replace DATE(@startDate) with DATE(date_expression)
    previousMetricSql = previousMetricSql.replace(
      /DATE\s*\(\s*@startDate\s*\)/g,
      `DATE(${previousStartSql})`
    );
    previousMetricSql = previousMetricSql.replace(
      /DATE\s*\(\s*@endDate\s*\)/g,
      `DATE(${previousEndSql})`
    );
    // Fallback: replace bare @startDate/@endDate
    previousMetricSql = previousMetricSql.replace(/@startDate/g, `DATE(${previousStartSql})`);
    if (previousMetricSql.includes('@endDate')) {
      previousMetricSql = previousMetricSql.replace(/@endDate/g, `DATE(${previousEndSql})`);
    }
    
  } else {
    // For custom ranges, replace TIMESTAMP(@startDate) with DATE(@previousStartDate)
    previousMetricSql = previousMetricSql.replace(
      /TIMESTAMP\s*\(\s*@startDate\s*\)/g,
      `DATE(@previousStartDate)`
    );
    previousMetricSql = previousMetricSql.replace(
      /TIMESTAMP\s*\(\s*@endDate\s*\)/g,
      `DATE(@previousEndDate)`
    );
    // Replace DATE(@startDate) with DATE(@previousStartDate)
    previousMetricSql = previousMetricSql.replace(
      /DATE\s*\(\s*@startDate\s*\)/g,
      `DATE(@previousStartDate)`
    );
    previousMetricSql = previousMetricSql.replace(
      /DATE\s*\(\s*@endDate\s*\)/g,
      `DATE(@previousEndDate)`
    );
    // Fallback
    previousMetricSql = previousMetricSql.replace(/@startDate/g, `DATE(@previousStartDate)`);
    previousMetricSql = previousMetricSql.replace(/@endDate/g, `DATE(@previousEndDate)`);
  }

  // Debug: Check if @endDate is still in the SQL (should never happen)
  if (currentMetricSql.includes('@endDate') || previousMetricSql.includes('@endDate')) {
    console.error('@endDate still present in metric SQL after replacements', {
      currentMetricSql: currentMetricSql.substring(0, 500),
      previousMetricSql: previousMetricSql.substring(0, 500),
    });
    throw new Error('Failed to replace @endDate in metric SQL - this should never happen');
  }

  const sql = `
    WITH current_period AS (
      SELECT ${currentMetricSql} as value
      FROM \`${CONSTANTS.FULL_TABLE}\` v
      WHERE 1=1
        ${currentPeriodFilter}
        ${filterSql}
    ),
    previous_period AS (
      SELECT ${previousMetricSql} as value
      FROM \`${CONSTANTS.FULL_TABLE}\` v
      WHERE 1=1
        ${previousPeriodFilter}
        ${filterSql}
    )
    SELECT
      c.value as current_value,
      p.value as previous_value,
      SAFE_DIVIDE(c.value - p.value, p.value) * 100 as change_percent,
      c.value - p.value as change_absolute
    FROM current_period c, previous_period p
  `.trim();

  // Debug logging for MQL period comparison issues
  if (metric === 'mqls' || conversionMetric?.includes('mql')) {
    console.log('[compilePeriodComparison] MQL query debug:', {
      dateField,
      currentStartSql,
      currentEndSql,
      previousStartSql,
      previousEndSql,
      currentPeriodFilter: currentPeriodFilter.substring(0, 200),
      previousPeriodFilter: previousPeriodFilter.substring(0, 200),
      currentMetricSql: currentMetricSql.substring(0, 300),
      previousMetricSql: previousMetricSql.substring(0, 300),
      sql: sql.substring(0, 500),
    });
  }

  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
  };
  

  // Add date parameters for custom ranges (presets use SQL expressions directly)
  // CRITICAL: Append ' 23:59:59' to end dates to include the full last day (matches main dashboard behavior)
  if (!currentIsPreset) {
    queryParams.currentStartDate = currentStartDate;
    queryParams.currentEndDate = currentEndDate + ' 23:59:59';
  }
  if (!previousIsPreset) {
    queryParams.previousStartDate = previousStartDate;
    queryParams.previousEndDate = previousEndDate + ' 23:59:59';
  }

  return {
    sql,
    params: queryParams,
    templateId: 'period_comparison',
    visualization: 'comparison',
    metadata: {
      metric: conversionMetric || metric,
      dateRange: {
        start: currentStartDate,
        end: currentEndDate,
      },
    },
  };
}

function compileTopN(params: TemplateSelection['parameters']): CompiledQuery {
  // Similar to metric_by_dimension but with sorting and limit
  const compiled = compileMetricByDimension(params);
  compiled.templateId = 'top_n';
  return compiled;
}

function compileFunnelSummary(params: TemplateSelection['parameters']): CompiledQuery {
  const { dateRange, filters } = params;
  if (!dateRange) {
    throw new Error('Date range is required for funnel_summary template');
  }

  // Funnel summary includes both lead-level and opportunity-level metrics (SQOs, Joined)
  // When there's an SGA filter, we MUST use opportunity-level filtering because the query includes SQOs/Joined
  // This ensures SQOs are included when Opp_SGA_Name__c contains a User ID
  const hasSgaFilter = filters?.some(f => f.dimension === 'sga');
  const filterResult = buildDimensionFilterSql(filters || [], hasSgaFilter); // Pass true when SGA filter exists (query includes opp-level metrics)
  const filterSql = filterResult.sql;
  const needsUserJoin = filterResult.needsUserJoin;
  
  const dateRangeSql = getDateRangeSql(dateRange);
  const isPreset = dateRange.preset && dateRange.preset !== 'custom';

  // Get SQL for each funnel metric
  const prospectsSql = getMetricSql('prospects');
  const contactedSql = getMetricSql('contacted');
  const mqlsSql = getMetricSql('mqls');
  const sqlsSql = getMetricSql('sqls');
  const sqosSql = getMetricSql('sqos');
  const joinedSql = getMetricSql('joined');
  const joinedAumSql = getMetricSql('joined_aum');

  // Replace @startDate and @endDate placeholders in each metric SQL
  const replaceDatePlaceholders = (sql: string) => {
    if (isPreset) {
      return sql
        .replace(/@startDate/g, dateRangeSql.startSql)
        .replace(/@endDate/g, dateRangeSql.endSql);
    }
    return sql; // Keep placeholders for custom ranges
  };

  const userJoin = needsUserJoin 
    ? `LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user ON v.Opp_SGA_Name__c = sga_user.Id`
    : '';

  const sql = `
    SELECT
      ${replaceDatePlaceholders(prospectsSql)} as prospects,
      ${replaceDatePlaceholders(contactedSql)} as contacted,
      ${replaceDatePlaceholders(mqlsSql)} as mqls,
      ${replaceDatePlaceholders(sqlsSql)} as sqls,
      ${replaceDatePlaceholders(sqosSql)} as sqos,
      ${replaceDatePlaceholders(joinedSql)} as joined,
      ${replaceDatePlaceholders(joinedAumSql)} as joined_aum
    FROM \`${CONSTANTS.FULL_TABLE}\` v
    ${userJoin}
    WHERE 1=1
      ${filterSql}
  `.trim();

  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
  };

  if (!isPreset) {
    queryParams.startDate = dateRangeSql.startDate;
    queryParams.endDate = dateRangeSql.endDate;
  }

  return {
    sql,
    params: queryParams,
    templateId: 'funnel_summary',
    visualization: 'funnel',
    metadata: {
      dateRange: {
        start: dateRangeSql.startDate,
        end: dateRangeSql.endDate,
      },
    },
  };
}

function compilePipelineByStage(params: TemplateSelection['parameters']): CompiledQuery {
  const { filters } = params;
  const filterResult = buildDimensionFilterSql(filters || [], true); // Pipeline is opportunity-level
  const filterSql = filterResult.sql;
  const needsUserJoin = filterResult.needsUserJoin;

  // Pipeline by stage shows count and AUM for each stage
  // Only includes open pipeline stages (excludes Closed Lost, Joined, etc.)
  const userJoin = needsUserJoin 
    ? `LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user ON v.Opp_SGA_Name__c = sga_user.Id`
    : '';

  const sql = `
    SELECT 
      v.StageName as stage,
      COUNT(DISTINCT v.primary_key) as opportunity_count,
      SUM(COALESCE(v.Underwritten_AUM__c, v.Amount)) as total_aum,
      AVG(COALESCE(v.Underwritten_AUM__c, v.Amount)) as avg_aum
    FROM \`${CONSTANTS.FULL_TABLE}\` v
    ${userJoin}
    WHERE v.recordtypeid = @recruitingRecordType
      AND v.StageName IN UNNEST(@openPipelineStages)
      AND v.is_sqo_unique = 1
      ${filterSql}
    GROUP BY v.StageName
    ORDER BY 
      CASE v.StageName
        WHEN 'Qualifying' THEN 1
        WHEN 'Discovery' THEN 2
        WHEN 'Sales Process' THEN 3
        WHEN 'Negotiating' THEN 4
        ELSE 5
      END
  `.trim();

  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
    openPipelineStages: CONSTANTS.OPEN_PIPELINE_STAGES,
  };

  return {
    sql,
    params: queryParams,
    templateId: 'pipeline_by_stage',
    visualization: 'bar',
    metadata: {
      dateRange: {
        start: new Date().toISOString().split('T')[0], // Current snapshot
        end: new Date().toISOString().split('T')[0],
      },
    },
  };
}

function compileSgaSummary(params: TemplateSelection['parameters']): CompiledQuery {
  const { sga, dateRange, filters } = params;
  if (!sga) {
    throw new Error('SGA name is required for sga_summary template');
  }
  if (!dateRange) {
    throw new Error('Date range is required for sga_summary template');
  }

  const filterResult = buildDimensionFilterSql(filters || [], false);
  const filterSql = filterResult.sql;
  const dateRangeSql = getDateRangeSql(dateRange);
  const isPreset = dateRange.preset && dateRange.preset !== 'custom';

  // Get SQL for each metric, replacing date placeholders
  const replaceDates = (sql: string) => {
    if (isPreset) {
      return sql
        .replace(/@startDate/g, dateRangeSql.startSql)
        .replace(/@endDate/g, dateRangeSql.endSql);
    }
    return sql;
  };

  // Lead-level metrics (use SGA_Owner_Name__c only)
  const prospectsSql = replaceDates(getMetricSql('prospects'));
  const contactedSql = replaceDates(getMetricSql('contacted'));
  const mqlsSql = replaceDates(getMetricSql('mqls'));
  const sqlsSql = replaceDates(getMetricSql('sqls'));

  // Opportunity-level metrics (use OR logic: SGA_Owner_Name__c OR Opp_SGA_Name__c)
  // Note: The metric SQL already includes the SGA filter, but for summary we need to handle both
  const sqosSql = replaceDates(getMetricSql('sqos'));
  const joinedSql = replaceDates(getMetricSql('joined'));
  const sqoAumSql = replaceDates(getMetricSql('sqo_aum'));
  const joinedAumSql = replaceDates(getMetricSql('joined_aum'));

  // Conversion rates (cohort mode)
  const contactedToMqlRate = CONVERSION_METRICS.contacted_to_mql_rate;
  const mqlToSqlRate = CONVERSION_METRICS.mql_to_sql_rate;
  const sqlToSqoRate = CONVERSION_METRICS.sql_to_sqo_rate;
  const sqoToJoinedRate = CONVERSION_METRICS.sqo_to_joined_rate;

  // Build conversion rate SQLs with date replacements
  const buildConversionSql = (conversion: { sql: string }) => {
    let sql = conversion.sql;
    if (isPreset) {
      sql = sql.replace(/@startDate/g, dateRangeSql.startSql);
      sql = sql.replace(/@endDate/g, dateRangeSql.endSql);
    }
    return sql;
  };

  const sql = `
    SELECT
      ${prospectsSql} as prospects,
      ${contactedSql} as contacted,
      ${mqlsSql} as mqls,
      ${sqlsSql} as sqls,
      ${sqosSql} as sqos,
      ${joinedSql} as joined,
      ${sqoAumSql} as sqo_aum,
      ${joinedAumSql} as joined_aum,
      ${buildConversionSql(contactedToMqlRate)} as contacted_to_mql_rate,
      ${buildConversionSql(mqlToSqlRate)} as mql_to_sql_rate,
      ${buildConversionSql(sqlToSqoRate)} as sql_to_sqo_rate,
      ${buildConversionSql(sqoToJoinedRate)} as sqo_to_joined_rate
    FROM \`${CONSTANTS.FULL_TABLE}\` v
    WHERE 1=1
      AND (v.SGA_Owner_Name__c = @sgaName OR v.Opp_SGA_Name__c = @sgaName)
      ${filterSql}
  `.trim();

  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
    sgaName: sga,
  };

  if (!isPreset) {
    queryParams.startDate = dateRangeSql.startDate;
    queryParams.endDate = dateRangeSql.endDate;
  }

  return {
    sql,
    params: queryParams,
    templateId: 'sga_summary',
    visualization: 'table',
    metadata: {
      dateRange: {
        start: dateRangeSql.startDate,
        end: dateRangeSql.endDate,
      },
    },
  };
}

function compileSgaLeaderboard(params: TemplateSelection['parameters']): CompiledQuery {
  const { metric, dateRange, filters, limit } = params;
  if (!metric) throw new Error('Metric is required for sga_leaderboard template');
  if (!dateRange) throw new Error('Date range is required for sga_leaderboard template');

  // For leaderboard, we don't want SGA filter in metric calculation (we're grouping by SGA)
  // But we still need to know if it's opportunity-level for SGA field selection
  const isOppLevel = ['sqos', 'joined'].includes(metric) || metric in AUM_METRICS;
  
  // Get metric SQL WITHOUT SGA filter (we'll group by SGA instead)
  let metricSql = getMetricSql(metric);
  const dateRangeSql = getDateRangeSql(dateRange);
  const filterResult = buildDimensionFilterSql(filters || [], false);
  const filterSql = filterResult.sql;
  const limitValue = limit && typeof limit === 'number' ? limit : 20;
  const limitSql = `LIMIT ${limitValue}`;

  // Replace @startDate and @endDate placeholders in metric SQL
  const isPreset = dateRange.preset && dateRange.preset !== 'custom';
  if (isPreset) {
    metricSql = metricSql.replace(/@startDate/g, dateRangeSql.startSql);
    metricSql = metricSql.replace(/@endDate/g, dateRangeSql.endSql);
  }

  // No RBAC filters - all users see all data

  // For opportunity-level metrics, we need to handle the fact that an SQO might be attributed to different SGAs
  // via SGA_Owner_Name__c (lead SGA) or Opp_SGA_Name__c (opportunity SGA)
  // We'll use COALESCE to pick one SGA per record for grouping
  // For lead-level metrics, use SGA_Owner_Name__c
  const sgaGroupByField = isOppLevel 
    ? `COALESCE(v.SGA_Owner_Name__c, v.Opp_SGA_Name__c)`
    : `v.SGA_Owner_Name__c`;

  const sql = `
SELECT
  ${sgaGroupByField} as sga,
  ${metricSql} as value,
  RANK() OVER (ORDER BY ${metricSql} DESC) as rank
FROM \`${CONSTANTS.FULL_TABLE}\` v
WHERE ${sgaGroupByField} IS NOT NULL
  ${filterSql}
GROUP BY sga
HAVING value > 0
ORDER BY value DESC
${limitSql}
  `.trim();

  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
  };
  
  if (!isPreset) {
    queryParams.startDate = dateRangeSql.startDate;
    queryParams.endDate = dateRangeSql.endDate;
  }

  return {
    sql,
    params: queryParams,
    templateId: 'sga_leaderboard',
    visualization: 'bar',
    metadata: {
      metric,
      dateRange: {
        start: dateRangeSql.startDate,
        end: dateRangeSql.endDate,
      },
    },
  };
}

function compileForecastVsActual(params: TemplateSelection['parameters']): CompiledQuery {
  // TODO: Implement following pattern from forecast_vs_actual template
  throw new Error('Not yet implemented: forecast_vs_actual');
}

function compileAverageAum(params: TemplateSelection['parameters']): CompiledQuery {
  const { dateRange, filters } = params;
  const filterResult = buildDimensionFilterSql(filters || [], false);
  const filterSql = filterResult.sql;

  // Average AUM requires a population filter (e.g., joined advisors, SQOs)
  // For now, we'll calculate average AUM for all records with AUM > 0
  // The population filter can be added via dimension filters
  let dateFilterSql = '';
  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
  };

  if (dateRange) {
    const dateRangeSql = getDateRangeSql(dateRange);
    const isPreset = dateRange.preset && dateRange.preset !== 'custom';
    
    // For average AUM, we typically filter by a date field like advisor_join_date__c or Date_Became_SQO__c
    // Since we don't know which population, we'll use a generic approach
    // The filters parameter should specify the population (e.g., joined advisors)
    if (isPreset) {
      // For joined advisors, use advisor_join_date__c
      // For SQOs, use Date_Became_SQO__c
      // Default to Date_Became_SQO__c if no specific filter
      dateFilterSql = `
      AND DATE(v.Date_Became_SQO__c) >= DATE(${dateRangeSql.startSql})
      AND DATE(v.Date_Became_SQO__c) <= DATE(${dateRangeSql.endSql})`;
    } else {
      dateFilterSql = `
      AND DATE(v.Date_Became_SQO__c) >= DATE(@startDate)
      AND DATE(v.Date_Became_SQO__c) <= DATE(@endDate)`;
      queryParams.startDate = dateRangeSql.startDate;
      queryParams.endDate = dateRangeSql.endDate;
    }
  }

  const sql = `
    SELECT
      AVG(COALESCE(v.Underwritten_AUM__c, v.Amount)) as avg_aum,
      COUNT(DISTINCT v.primary_key) as record_count,
      MIN(COALESCE(v.Underwritten_AUM__c, v.Amount)) as min_aum,
      MAX(COALESCE(v.Underwritten_AUM__c, v.Amount)) as max_aum,
      SUM(COALESCE(v.Underwritten_AUM__c, v.Amount)) as total_aum
    FROM \`${CONSTANTS.FULL_TABLE}\` v
    WHERE COALESCE(v.Underwritten_AUM__c, v.Amount) IS NOT NULL
      AND COALESCE(v.Underwritten_AUM__c, v.Amount) > 0
      AND v.recordtypeid = @recruitingRecordType
      ${dateFilterSql}
      ${filterSql}
  `.trim();

  return {
    sql,
    params: queryParams,
    templateId: 'average_aum',
    visualization: 'metric',
    metadata: {
      dateRange: dateRange ? {
        start: getDateRangeSql(dateRange).startDate,
        end: getDateRangeSql(dateRange).endDate,
      } : {
        start: new Date().toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
      },
    },
  };
}

function compileTimeToConvert(params: TemplateSelection['parameters']): CompiledQuery {
  const { startStage, endStage, statistic, dateRange, filters } = params;
  if (!startStage || !endStage) {
    throw new Error('startStage and endStage are required for time_to_convert template');
  }
  if (!dateRange) {
    throw new Error('Date range is required for time_to_convert template');
  }

  // Map stage names to date fields
  const stageDateFields: Record<string, string> = {
    contacted: 'stage_entered_contacting__c',
    mql: 'mql_stage_entered_ts',
    sql: 'converted_date_raw',
    sqo: 'Date_Became_SQO__c',
    joined: 'advisor_join_date__c',
  };

  const startDateField = stageDateFields[startStage];
  const endDateField = stageDateFields[endStage];

  if (!startDateField || !endDateField) {
    throw new Error(`Invalid stage combination: ${startStage} to ${endStage}`);
  }

  // Get date field types
  const startDateFieldInfo = SEMANTIC_LAYER.dateFields[startDateField as keyof typeof SEMANTIC_LAYER.dateFields];
  const endDateFieldInfo = SEMANTIC_LAYER.dateFields[endDateField as keyof typeof SEMANTIC_LAYER.dateFields];
  const startIsDate = startDateFieldInfo?.type === 'DATE';
  const endIsDate = endDateFieldInfo?.type === 'DATE';

  const dateRangeSql = getDateRangeSql(dateRange);
  const isPreset = dateRange.preset && dateRange.preset !== 'custom';
  const filterResult = buildDimensionFilterSql(filters || [], false);
  const filterSql = filterResult.sql;

  // Build date filter - use DATE() conversion for consistency
  const startDateExpr = isPreset ? dateRangeSql.startSql : '@startDate';
  const endDateExpr = isPreset ? dateRangeSql.endSql : '@endDate';

  // Select statistic based on parameter
  let statisticSql = 'avg_days';
  if (statistic === 'median') {
    statisticSql = 'median_days';
  } else if (statistic === 'min') {
    statisticSql = 'min_days';
  } else if (statistic === 'max') {
    statisticSql = 'max_days';
  } else if (statistic === 'p25') {
    statisticSql = 'p25_days';
  } else if (statistic === 'p75') {
    statisticSql = 'p75_days';
  } else if (statistic === 'p90') {
    statisticSql = 'p90_days';
  }

  const sql = `
    SELECT
      AVG(DATE_DIFF(DATE(v.${endDateField}), DATE(v.${startDateField}), DAY)) as avg_days,
      APPROX_QUANTILES(DATE_DIFF(DATE(v.${endDateField}), DATE(v.${startDateField}), DAY), 100)[OFFSET(50)] as median_days,
      MIN(DATE_DIFF(DATE(v.${endDateField}), DATE(v.${startDateField}), DAY)) as min_days,
      MAX(DATE_DIFF(DATE(v.${endDateField}), DATE(v.${startDateField}), DAY)) as max_days,
      APPROX_QUANTILES(DATE_DIFF(DATE(v.${endDateField}), DATE(v.${startDateField}), DAY), 100)[OFFSET(25)] as p25_days,
      APPROX_QUANTILES(DATE_DIFF(DATE(v.${endDateField}), DATE(v.${startDateField}), DAY), 100)[OFFSET(75)] as p75_days,
      APPROX_QUANTILES(DATE_DIFF(DATE(v.${endDateField}), DATE(v.${startDateField}), DAY), 100)[OFFSET(90)] as p90_days,
      COUNT(DISTINCT v.primary_key) as record_count
    FROM \`${CONSTANTS.FULL_TABLE}\` v
    WHERE v.${startDateField} IS NOT NULL
      AND v.${endDateField} IS NOT NULL
      AND DATE(v.${startDateField}) >= DATE(${startDateExpr})
      AND DATE(v.${startDateField}) <= DATE(${endDateExpr})
      ${filterSql}
  `.trim();

  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
  };

  if (!isPreset) {
    queryParams.startDate = dateRangeSql.startDate;
    queryParams.endDate = dateRangeSql.endDate;
  }

  return {
    sql,
    params: queryParams,
    templateId: 'time_to_convert',
    visualization: 'metric',
    metadata: {
      dateRange: {
        start: dateRangeSql.startDate,
        end: dateRangeSql.endDate,
      },
    },
  };
}

function compileMultiStageConversion(params: TemplateSelection['parameters']): CompiledQuery {
  const { startStage, endStage, dateRange, filters } = params;
  if (!startStage || !endStage) {
    throw new Error('startStage and endStage are required for multi_stage_conversion template');
  }
  if (!dateRange) {
    throw new Error('Date range is required for multi_stage_conversion template');
  }

  // Map stage names to progression and eligibility flags
  const stageFlags: Record<string, { progression: string; eligible: string; dateField: string }> = {
    contacted: {
      progression: 'contacted_to_mql_progression',
      eligible: 'eligible_for_contacted_conversions_30d',
      dateField: 'stage_entered_contacting__c',
    },
    mql: {
      progression: 'mql_to_sql_progression',
      eligible: 'eligible_for_mql_conversions',
      dateField: 'mql_stage_entered_ts',
    },
    sql: {
      progression: 'sql_to_sqo_progression',
      eligible: 'eligible_for_sql_conversions',
      dateField: 'converted_date_raw',
    },
    sqo: {
      progression: 'sqo_to_joined_progression',
      eligible: 'eligible_for_sqo_conversions',
      dateField: 'Date_Became_SQO__c',
    },
  };

  const startFlags = stageFlags[startStage];
  const endFlags = stageFlags[endStage];

  if (!startFlags || !endFlags) {
    throw new Error(`Invalid stage: ${startStage} or ${endStage}`);
  }

  // For multi-stage conversion, we need to find records that:
  // 1. Entered startStage in the date range
  // 2. Progressed all the way to endStage
  // We'll use the endStage progression flag and startStage date field
  const dateRangeSql = getDateRangeSql(dateRange);
  const isPreset = dateRange.preset && dateRange.preset !== 'custom';
  const filterResult = buildDimensionFilterSql(filters || [], false);
  const filterSql = filterResult.sql;

  // Determine DATE vs TIMESTAMP wrapper
  const dateFieldInfo = SEMANTIC_LAYER.dateFields[startFlags.dateField as keyof typeof SEMANTIC_LAYER.dateFields];
  const isDateType = dateFieldInfo?.type === 'DATE';
  const dateWrapper = isDateType ? 'DATE' : 'TIMESTAMP';

  const startDateExpr = isPreset ? dateRangeSql.startSql : '@startDate';
  const endDateExpr = isPreset ? dateRangeSql.endSql : '@endDate';

  const sql = `
    SELECT
      SAFE_DIVIDE(
        SUM(CASE WHEN v.${endFlags.progression} = 1 THEN 1 ELSE 0 END),
        SUM(CASE WHEN v.${startFlags.eligible} = 1 THEN 1 ELSE 0 END)
      ) * 100 as conversion_rate,
      SUM(CASE WHEN v.${endFlags.progression} = 1 THEN 1 ELSE 0 END) as numerator,
      SUM(CASE WHEN v.${startFlags.eligible} = 1 THEN 1 ELSE 0 END) as denominator
    FROM \`${CONSTANTS.FULL_TABLE}\` v
    WHERE v.${startFlags.dateField} IS NOT NULL
      AND ${dateWrapper}(v.${startFlags.dateField}) >= ${dateWrapper}(${startDateExpr})
      AND ${dateWrapper}(v.${startFlags.dateField}) <= ${dateWrapper}(${endDateExpr})
      ${filterSql}
  `.trim();

  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
  };

  if (!isPreset) {
    queryParams.startDate = dateRangeSql.startDate;
    queryParams.endDate = dateRangeSql.endDate;
  }

  return {
    sql,
    params: queryParams,
    templateId: 'multi_stage_conversion',
    visualization: 'metric',
    metadata: {
      dateRange: {
        start: dateRangeSql.startDate,
        end: dateRangeSql.endDate,
      },
    },
  };
}

function compileSqoDetailList(params: TemplateSelection['parameters']): CompiledQuery {
  const { dateRange, filters } = params;
  // SQOs are opportunity-level metrics - must check both SGA_Owner_Name__c and Opp_SGA_Name__c
  const filterResult = buildDimensionFilterSql(filters || [], true); // SQOs are opportunity-level
  const filterSql = filterResult.sql;
  const needsUserJoin = filterResult.needsUserJoin;

  // Build date filter SQL - optional for "all time" queries
  let dateFilterSql = '';
  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
  };
  
  if (dateRange) {
    const dateRangeSql = getDateRangeSql(dateRange);
    const isPreset = dateRange.preset && dateRange.preset !== 'custom';
    const startDateExpr = isPreset ? dateRangeSql.startSql : '@startDate';
    const endDateExpr = isPreset ? dateRangeSql.endSql : '@endDate';
    
    // CRITICAL: Use DATE() conversion for date comparisons to match metric SQL definition
    // Date_Became_SQO__c is TIMESTAMP, but we convert to DATE for comparison to ensure consistency
    // This matches the sqos metric definition which uses DATE() conversion
    // Using DATE() ensures we compare date values correctly and include the full day
    dateFilterSql = `
      AND DATE(v.Date_Became_SQO__c) >= DATE(${startDateExpr})
      AND DATE(v.Date_Became_SQO__c) <= DATE(${endDateExpr})`;
    
    if (!isPreset) {
      queryParams.startDate = dateRangeSql.startDate;
      queryParams.endDate = dateRangeSql.endDate;
    }
  }
  
  const userJoin = needsUserJoin 
    ? `LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user ON v.Opp_SGA_Name__c = sga_user.Id`
    : '';

  const sql = `
    SELECT 
      v.primary_key,
      v.advisor_name,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.Date_Became_SQO__c) as sqo_date,
      v.SGA_Owner_Name__c as sga,
      v.SGM_Owner_Name__c as sgm,
      v.Original_source as source,
      IFNULL(v.Channel_Grouping_Name, 'Other') as channel,
      COALESCE(v.Underwritten_AUM__c, v.Amount) as aum,
      v.aum_tier,
      v.StageName as stage,
      ARRAY_TO_STRING(v.Experimentation_Tag_List, ', ') as experimentation_tag,
      v.lead_url,
      v.opportunity_url
    FROM \`${CONSTANTS.FULL_TABLE}\` v
    ${userJoin}
    WHERE v.Date_Became_SQO__c IS NOT NULL
      AND v.recordtypeid = @recruitingRecordType
      AND v.is_sqo_unique = 1${dateFilterSql}
      ${filterSql}
    ORDER BY v.Date_Became_SQO__c DESC, COALESCE(v.Underwritten_AUM__c, v.Amount) DESC
  `.trim();

  return {
    sql,
    params: queryParams,
    templateId: 'sqo_detail_list',
    visualization: 'table',
    metadata: {
      dateRange: dateRange ? {
        start: getDateRangeSql(dateRange).startDate,
        end: getDateRangeSql(dateRange).endDate,
      } : {
        start: new Date().toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
      },
    },
  };
}

function compileScheduledCallsList(params: TemplateSelection['parameters']): CompiledQuery {
  const { dateRange, filters, limit } = params;
  
  if (!dateRange) {
    throw new Error('Date range is required for scheduled_calls_list template');
  }
  
  const dateRangeSql = getDateRangeSql(dateRange);
  const isPreset = dateRange.preset && dateRange.preset !== 'custom';
  const filterResult = buildDimensionFilterSql(filters || [], false);
  const filterSql = filterResult.sql;
  
  // No RBAC filters - all users see all data
  
  const limitSql = limit ? `LIMIT ${limit}` : '';
  
  // CRITICAL: Initial_Call_Scheduled_Date__c is a DATE field - use DATE() wrapper for parameters
  // For presets, use SQL expressions directly
  const startDateExpr = isPreset ? dateRangeSql.startSql : 'DATE(@startDate)';
  const endDateExpr = isPreset ? dateRangeSql.endSql : 'DATE(@endDate)';
  
  const sql = `
    SELECT 
      v.primary_key,
      v.advisor_name,
      FORMAT_DATE('%Y-%m-%d', v.Initial_Call_Scheduled_Date__c) as call_date,
      v.SGA_Owner_Name__c as sga,
      v.Original_source as source,
      IFNULL(v.Channel_Grouping_Name, 'Other') as channel,
      v.Lead_Score_Tier__c as lead_score_tier,
      v.TOF_Stage as tof_stage,
      ARRAY_TO_STRING(v.Experimentation_Tag_List, ', ') as experimentation_tag,
      v.lead_url,
      v.opportunity_url
    FROM \`${CONSTANTS.FULL_TABLE}\` v
    WHERE v.Initial_Call_Scheduled_Date__c IS NOT NULL
      AND v.Initial_Call_Scheduled_Date__c >= ${startDateExpr}
      AND v.Initial_Call_Scheduled_Date__c <= ${endDateExpr}
      ${filterSql}
    ORDER BY v.Initial_Call_Scheduled_Date__c ASC, v.SGA_Owner_Name__c
    ${limitSql}
  `.trim();
  
  const queryParams: Record<string, unknown> = {};
  
  // Add date parameters for custom ranges
  if (!isPreset) {
    queryParams.startDate = dateRangeSql.startDate;
    queryParams.endDate = dateRangeSql.endDate;
  }
  
  return {
    sql,
    params: queryParams,
    templateId: 'scheduled_calls_list',
    visualization: 'table',
    metadata: {
      dateRange: {
        start: dateRangeSql.startDate,
        end: dateRangeSql.endDate,
      },
    },
  };
}

function compileOpenPipelineList(params: TemplateSelection['parameters']): CompiledQuery {
  const { filters } = params;
  const filterResult = buildDimensionFilterSql(filters || [], true); // Open pipeline is opportunity-level
  const filterSql = filterResult.sql;
  const needsUserJoin = filterResult.needsUserJoin;

  const userJoin = needsUserJoin 
    ? `LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user ON v.Opp_SGA_Name__c = sga_user.Id`
    : '';

  const sql = `
    SELECT 
      v.primary_key,
      v.advisor_name,
      v.SGA_Owner_Name__c as sga,
      v.SGM_Owner_Name__c as sgm,
      v.Original_source as source,
      IFNULL(v.Channel_Grouping_Name, 'Other') as channel,
      COALESCE(v.Underwritten_AUM__c, v.Amount) as aum,
      v.aum_tier,
      v.StageName as stage,
      v.Date_Became_SQO__c as sqo_date,
      ARRAY_TO_STRING(v.Experimentation_Tag_List, ', ') as experimentation_tag,
      v.lead_url,
      v.opportunity_url
    FROM \`${CONSTANTS.FULL_TABLE}\` v
    ${userJoin}
    WHERE v.recordtypeid = @recruitingRecordType
      AND v.StageName IN UNNEST(@openPipelineStages)
      AND v.is_sqo_unique = 1
      ${filterSql}
    ORDER BY COALESCE(v.Underwritten_AUM__c, v.Amount) DESC NULLS LAST
  `.trim();

  const queryParams: Record<string, unknown> = {
    recruitingRecordType: CONSTANTS.RECRUITING_RECORD_TYPE,
    openPipelineStages: CONSTANTS.OPEN_PIPELINE_STAGES,
  };
  
  return {
    sql,
    params: queryParams,
    templateId: 'open_pipeline_list',
    visualization: 'table',
    metadata: {
      dateRange: {
        start: new Date().toISOString().split('T')[0], // Current date as placeholder
        end: new Date().toISOString().split('T')[0], // Current date as placeholder
      },
    },
  };
}

function compileRollingAverage(params: TemplateSelection['parameters']): CompiledQuery {
  // TODO: Implement following pattern from rolling_average template
  throw new Error('Not yet implemented: rolling_average');
}

/**
 * Generic detail list compiler that works for MQLs, SQLs, and other lead-level metrics
 * This is a flexible template that adapts based on the metric parameter
 */
function compileGenericDetailList(params: TemplateSelection['parameters']): CompiledQuery {
  const { metric, dateRange, filters } = params;
  
  if (!metric) {
    throw new Error('Metric is required for generic_detail_list template');
  }

  // Get the date field for this metric
  let dateField: string;
  let dateFieldType: 'DATE' | 'TIMESTAMP';
  let metricFilter: string;
  let dateColumnAlias: string;
  let isOppLevel = false;
  
  // Determine if this is an opportunity-level metric first
  // (needed to pass correct flag to buildDimensionFilterSql)
  if (metric === 'sqos' || metric === 'joined' || metric === 'signed') {
    isOppLevel = true;
  }
  
  const filterResult = buildDimensionFilterSql(filters || [], isOppLevel);
  const filterSql = filterResult.sql;
  const needsUserJoin = filterResult.needsUserJoin;
  let dateFilterSql = '';
  const queryParams: Record<string, unknown> = {};

  // Determine metric-specific fields
  if (metric === 'mqls') {
    dateField = 'mql_stage_entered_ts';
    dateFieldType = 'TIMESTAMP';
    metricFilter = 'v.mql_stage_entered_ts IS NOT NULL AND v.is_mql = 1';
    dateColumnAlias = 'mql_date';
  } else if (metric === 'sqls') {
    dateField = 'converted_date_raw';
    dateFieldType = 'DATE';
    metricFilter = 'v.converted_date_raw IS NOT NULL AND v.is_sql = 1';
    dateColumnAlias = 'sql_date';
  } else if (metric === 'sqos') {
    dateField = 'Date_Became_SQO__c';
    dateFieldType = 'TIMESTAMP';
    metricFilter = 'v.Date_Became_SQO__c IS NOT NULL AND v.recordtypeid = @recruitingRecordType AND v.is_sqo_unique = 1';
    dateColumnAlias = 'sqo_date';
    queryParams.recruitingRecordType = CONSTANTS.RECRUITING_RECORD_TYPE;
  } else if (metric === 'joined') {
    dateField = 'advisor_join_date__c';
    dateFieldType = 'DATE';
    metricFilter = 'v.advisor_join_date__c IS NOT NULL AND v.recordtypeid = @recruitingRecordType AND v.is_joined_unique = 1';
    dateColumnAlias = 'joined_date';
    queryParams.recruitingRecordType = CONSTANTS.RECRUITING_RECORD_TYPE;
  } else if (metric === 'contacted') {
    dateField = 'stage_entered_contacting__c';
    dateFieldType = 'TIMESTAMP';
    metricFilter = 'v.stage_entered_contacting__c IS NOT NULL AND v.is_contacted = 1';
    dateColumnAlias = 'contacted_date';
  } else if (metric === 'prospects') {
    dateField = 'FilterDate';
    dateFieldType = 'TIMESTAMP';
    metricFilter = 'v.FilterDate IS NOT NULL';
    dateColumnAlias = 'prospect_date';
  } else if (metric === 'signed') {
    dateField = 'Stage_Entered_Signed__c';
    dateFieldType = 'TIMESTAMP';
    metricFilter = 'v.Stage_Entered_Signed__c IS NOT NULL AND v.is_sqo_unique = 1';
    dateColumnAlias = 'signed_date';
    queryParams.recruitingRecordType = CONSTANTS.RECRUITING_RECORD_TYPE;
  } else {
    // Default fallback - try to use a generic approach
    throw new Error(`Unsupported metric for generic_detail_list: ${metric}`);
  }

  // Build date filter
  if (dateRange) {
    const dateRangeSql = getDateRangeSql(dateRange);
    const isPreset = dateRange.preset && dateRange.preset !== 'custom';
    
    // Use DATE() conversion for consistency (matches period comparison pattern)
    if (isPreset) {
      dateFilterSql = `
      AND DATE(v.${dateField}) >= DATE(${dateRangeSql.startSql})
      AND DATE(v.${dateField}) <= DATE(${dateRangeSql.endSql})`;
    } else {
      dateFilterSql = `
      AND DATE(v.${dateField}) >= DATE(@startDate)
      AND DATE(v.${dateField}) <= DATE(@endDate)`;
      queryParams.startDate = dateRangeSql.startDate;
      queryParams.endDate = dateRangeSql.endDate;
    }
  }

  // Format date column based on type
  const dateFormatExpr = dateFieldType === 'TIMESTAMP' 
    ? `FORMAT_TIMESTAMP('%Y-%m-%d', v.${dateField})`
    : `FORMAT_DATE('%Y-%m-%d', v.${dateField})`;

  // Build SELECT columns - include AUM only for opportunity-level metrics
  const aumColumns = isOppLevel 
    ? `COALESCE(v.Underwritten_AUM__c, v.Amount) as aum,
      v.aum_tier,`
    : '';

  const userJoin = needsUserJoin 
    ? `LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user ON v.Opp_SGA_Name__c = sga_user.Id`
    : '';

  const sql = `
    SELECT 
      v.primary_key,
      v.advisor_name,
      ${dateFormatExpr} as ${dateColumnAlias},
      v.SGA_Owner_Name__c as sga,
      v.SGM_Owner_Name__c as sgm,
      v.Original_source as source,
      IFNULL(v.Channel_Grouping_Name, 'Other') as channel,
      ${aumColumns}
      v.StageName as stage,
      ARRAY_TO_STRING(v.Experimentation_Tag_List, ', ') as experimentation_tag,
      v.lead_url,
      v.opportunity_url,
      v.lead_record_source as prospect_source_type,
      v.Previous_Recruiting_Opportunity_ID__c as origin_recruiting_opp_id,
      v.origin_opportunity_url
    FROM \`${CONSTANTS.FULL_TABLE}\` v
    ${userJoin}
    WHERE ${metricFilter}${dateFilterSql}
      ${filterSql}
    ORDER BY v.${dateField} DESC${isOppLevel ? ', COALESCE(v.Underwritten_AUM__c, v.Amount) DESC' : ''}
  `.trim();

  // Get date range for metadata (use current date as fallback if no dateRange provided)
  const dateRangeSql = dateRange ? getDateRangeSql(dateRange) : null;
  
  return {
    sql,
    params: queryParams,
    templateId: 'generic_detail_list',
    visualization: 'table',
    metadata: {
      metric,
      dateRange: dateRangeSql ? {
        start: dateRangeSql.startDate,
        end: dateRangeSql.endDate,
      } : {
        start: new Date().toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
      },
    },
  };
}

function compileOpportunitiesByAge(params: TemplateSelection['parameters']): CompiledQuery {
  // TODO: Implement following pattern from opportunities_by_age template
  throw new Error('Not yet implemented: opportunities_by_age');
}

// =============================================================================
// EXPORTS
// =============================================================================

export { CONSTANTS, QUERY_TEMPLATES };
