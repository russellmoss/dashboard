// =============================================================================
// SEMANTIC LAYER - Main Export
// Location: src/lib/semantic-layer/index.ts
// =============================================================================

export * from './definitions';
export * from './query-templates';
export * from './query-compiler';

// Re-export the main objects for convenience
export { SEMANTIC_LAYER } from './definitions';
export { QUERY_LAYER, QUERY_TEMPLATES } from './query-templates';

// Re-export query compiler functions
export {
  compileQuery,
  validateTemplateSelection,
  determineVisualization,
  getMetricSql,
  getDimensionSql,
  getTimeDimensionSql,
  getDateRangeSql,
  getMetricDateField,
  buildDimensionFilterSql,
} from './query-compiler';
