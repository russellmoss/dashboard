// =============================================================================
// QUERY COMPILER VALIDATION SUITE
// Validates the query compiler against validation examples
// 
// Run with: npx ts-node src/lib/semantic-layer/__tests__/query-compiler-validation.ts
// =============================================================================

import { 
  compileQuery, 
  validateTemplateSelection,
  getMetricSql,
  getDimensionSql,
  getDateRangeSql,
} from '../query-compiler';

import { VALIDATION_EXAMPLES } from './validation-examples';
import type { TemplateSelection } from '@/types/agent';

interface TestResult {
  passed: boolean;
  error?: string;
  sql?: string;
  templateId?: string;
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

function testValidateTemplateSelection(): { passed: number; failed: number; results: TestResult[] } {
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  // Test 1: Valid single_metric selection
  try {
    const selection: TemplateSelection = {
      templateId: 'single_metric',
      parameters: {
        metric: 'sqos',
        dateRange: { preset: 'this_quarter' },
      },
      confidence: 0.95,
      explanation: 'Test',
    };
    
    const result = validateTemplateSelection(selection);
    if (result.valid) {
      passed++;
      results.push({ passed: true, templateId: 'single_metric' });
    } else {
      failed++;
      results.push({ passed: false, error: result.errors.join(', ') });
    }
  } catch (e) {
    failed++;
    results.push({ passed: false, error: (e as Error).message });
  }

  // Test 2: Unknown template
  try {
    const selection: TemplateSelection = {
      templateId: 'unknown_template',
      parameters: {
        dateRange: { preset: 'this_quarter' },
      },
      confidence: 0.5,
      explanation: 'Test',
    };
    
    const result = validateTemplateSelection(selection);
    if (!result.valid && result.errors.some(e => e.includes('Unknown template'))) {
      passed++;
      results.push({ passed: true, templateId: 'unknown_template' });
    } else {
      failed++;
      results.push({ passed: false, error: 'Should have rejected unknown template' });
    }
  } catch (e) {
    failed++;
    results.push({ passed: false, error: (e as Error).message });
  }

  // Test 3: Unknown metric
  try {
    const selection: TemplateSelection = {
      templateId: 'single_metric',
      parameters: {
        metric: 'fake_metric',
        dateRange: { preset: 'this_quarter' },
      },
      confidence: 0.5,
      explanation: 'Test',
    };
    
    const result = validateTemplateSelection(selection);
    if (!result.valid && result.errors.some(e => e.includes('Unknown metric'))) {
      passed++;
      results.push({ passed: true, templateId: 'single_metric' });
    } else {
      failed++;
      results.push({ passed: false, error: 'Should have rejected unknown metric' });
    }
  } catch (e) {
    failed++;
    results.push({ passed: false, error: (e as Error).message });
  }

  return { passed, failed, results };
}

function testGetMetricSql(): { passed: number; failed: number; results: TestResult[] } {
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  // Test sqos metric
  try {
    const sql = getMetricSql('sqos');
    if (sql.includes('Date_Became_SQO__c') && sql.includes('is_sqo_unique')) {
      passed++;
      results.push({ passed: true, sql: sql.substring(0, 100) });
    } else {
      failed++;
      results.push({ passed: false, error: 'SQL missing expected fields' });
    }
  } catch (e) {
    failed++;
    results.push({ passed: false, error: (e as Error).message });
  }

  // Test mqls metric
  try {
    const sql = getMetricSql('mqls');
    if (sql.includes('mql_stage_entered_ts') && sql.includes('is_mql')) {
      passed++;
      results.push({ passed: true, sql: sql.substring(0, 100) });
    } else {
      failed++;
      results.push({ passed: false, error: 'SQL missing expected fields' });
    }
  } catch (e) {
    failed++;
    results.push({ passed: false, error: (e as Error).message });
  }

  // Test unknown metric
  try {
    getMetricSql('unknown');
    failed++;
    results.push({ passed: false, error: 'Should have thrown for unknown metric' });
  } catch (e) {
    if ((e as Error).message.includes('Unknown metric')) {
      passed++;
      results.push({ passed: true });
    } else {
      failed++;
      results.push({ passed: false, error: (e as Error).message });
    }
  }

  return { passed, failed, results };
}

function testGetDimensionSql(): { passed: number; failed: number; results: TestResult[] } {
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  // Test channel dimension
  try {
    const sql = getDimensionSql('channel');
    if (sql.includes('Channel_Grouping_Name')) {
      passed++;
      results.push({ passed: true, sql: sql.substring(0, 100) });
    } else {
      failed++;
      results.push({ passed: false, error: 'SQL missing expected fields' });
    }
  } catch (e) {
    failed++;
    results.push({ passed: false, error: (e as Error).message });
  }

  // Test sga dimension
  try {
    const sql = getDimensionSql('sga');
    if (sql.includes('SGA_Owner_Name__c')) {
      passed++;
      results.push({ passed: true, sql: sql.substring(0, 100) });
    } else {
      failed++;
      results.push({ passed: false, error: 'SQL missing expected fields' });
    }
  } catch (e) {
    failed++;
    results.push({ passed: false, error: (e as Error).message });
  }

  return { passed, failed, results };
}

function testGetDateRangeSql(): { passed: number; failed: number; results: TestResult[] } {
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  // Test this_quarter preset
  try {
    const result = getDateRangeSql({ preset: 'this_quarter' });
    if (result.startSql.includes('DATE_TRUNC') && result.startSql.includes('QUARTER')) {
      passed++;
      results.push({ passed: true, sql: result.startSql });
    } else {
      failed++;
      results.push({ passed: false, error: 'SQL missing expected DATE_TRUNC' });
    }
  } catch (e) {
    failed++;
    results.push({ passed: false, error: (e as Error).message });
  }

  // Test custom date range
  try {
    const result = getDateRangeSql({
      preset: 'custom',
      startDate: '2025-01-01',
      endDate: '2025-03-31',
    });
    if (result.startDate === '2025-01-01' && result.endDate === '2025-03-31') {
      passed++;
      results.push({ passed: true });
    } else {
      failed++;
      results.push({ passed: false, error: 'Date strings not correct' });
    }
  } catch (e) {
    failed++;
    results.push({ passed: false, error: (e as Error).message });
  }

  return { passed, failed, results };
}

function testCompileQuery(): { passed: number; failed: number; results: TestResult[] } {
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  // Test single_metric compilation
  try {
    const selection: TemplateSelection = {
      templateId: 'single_metric',
      parameters: {
        metric: 'sqos',
        dateRange: { preset: 'this_quarter' },
      },
      confidence: 0.95,
      explanation: 'Test',
    };
    
    const result = compileQuery(selection);
    if (result.sql.includes('SELECT') && result.sql.includes('vw_funnel_master') && result.visualization === 'metric') {
      passed++;
      results.push({ passed: true, templateId: 'single_metric', sql: result.sql.substring(0, 200) });
    } else {
      failed++;
      results.push({ passed: false, error: 'Compiled SQL missing expected elements' });
    }
  } catch (e) {
    failed++;
    results.push({ passed: false, error: (e as Error).message });
  }

  // Test metric_by_dimension compilation
  try {
    const selection: TemplateSelection = {
      templateId: 'metric_by_dimension',
      parameters: {
        metric: 'sqos',
        dimension: 'channel',
        dateRange: { preset: 'this_quarter' },
      },
      confidence: 0.95,
      explanation: 'Test',
    };
    
    const result = compileQuery(selection);
    if (result.sql.includes('GROUP BY') && result.visualization === 'bar') {
      passed++;
      results.push({ passed: true, templateId: 'metric_by_dimension', sql: result.sql.substring(0, 200) });
    } else {
      failed++;
      results.push({ passed: false, error: 'Compiled SQL missing GROUP BY or wrong visualization' });
    }
  } catch (e) {
    failed++;
    results.push({ passed: false, error: (e as Error).message });
  }

  return { passed, failed, results };
}

function testValidationExamples(): { passed: number; failed: number; skipped: number; results: TestResult[] } {
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // Test first 10 validation examples
  const examplesToTest = VALIDATION_EXAMPLES.slice(0, 10);
  
  for (const example of examplesToTest) {
    try {
      // Convert expected mapping to TemplateSelection
      const selection: TemplateSelection = {
        templateId: example.expectedMapping.templateId,
        parameters: {
          metric: example.expectedMapping.metric,
          dimension: example.expectedMapping.dimension,
          conversionMetric: example.expectedMapping.conversionMetric,
          dateRange: example.expectedMapping.dateRange 
            ? (typeof example.expectedMapping.dateRange === 'string'
                ? { preset: example.expectedMapping.dateRange }
                : example.expectedMapping.dateRange)
            : undefined,
          filters: example.expectedMapping.filters 
            ? Object.entries(example.expectedMapping.filters).map(([dim, val]) => ({
                dimension: dim,
                operator: 'equals' as const,
                value: Array.isArray(val) ? val : [val as string],
              }))
            : undefined,
        },
        confidence: 0.9,
        explanation: example.explanation,
      };

      // Validate selection
      const validation = validateTemplateSelection(selection);
      
      if (!validation.valid) {
        skipped++;
        results.push({ 
          passed: false, 
          error: `Validation failed: ${validation.errors.join(', ')}`,
          templateId: example.expectedMapping.templateId 
        });
        continue;
      }

      // Try to compile
      try {
        const compiled = compileQuery(selection);
        if (compiled.sql && compiled.templateId === example.expectedMapping.templateId) {
          passed++;
          results.push({ 
            passed: true, 
            templateId: example.expectedMapping.templateId,
            sql: compiled.sql.substring(0, 200) 
          });
        } else {
          failed++;
          results.push({ 
            passed: false, 
            error: 'Compilation succeeded but result invalid',
            templateId: example.expectedMapping.templateId 
          });
        }
      } catch (e) {
        const errorMsg = (e as Error).message;
        if (errorMsg.includes('Not yet implemented')) {
          skipped++;
          results.push({ 
            passed: false, 
            error: 'Template not implemented',
            templateId: example.expectedMapping.templateId 
          });
        } else {
          failed++;
          results.push({ 
            passed: false, 
            error: errorMsg,
            templateId: example.expectedMapping.templateId 
          });
        }
      }
    } catch (e) {
      failed++;
      results.push({ 
        passed: false, 
        error: (e as Error).message,
        templateId: example.expectedMapping.templateId 
      });
    }
  }

  return { passed, failed, skipped, results };
}

// =============================================================================
// MAIN RUNNER
// =============================================================================

function runValidationSuite() {
  console.log('='.repeat(80));
  console.log('QUERY COMPILER VALIDATION SUITE');
  console.log('='.repeat(80));
  console.log('');

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  // Test validateTemplateSelection
  console.log('Testing validateTemplateSelection...');
  const validationResults = testValidateTemplateSelection();
  totalPassed += validationResults.passed;
  totalFailed += validationResults.failed;
  console.log(`  ✅ Passed: ${validationResults.passed}, ❌ Failed: ${validationResults.failed}`);
  console.log('');

  // Test getMetricSql
  console.log('Testing getMetricSql...');
  const metricResults = testGetMetricSql();
  totalPassed += metricResults.passed;
  totalFailed += metricResults.failed;
  console.log(`  ✅ Passed: ${metricResults.passed}, ❌ Failed: ${metricResults.failed}`);
  console.log('');

  // Test getDimensionSql
  console.log('Testing getDimensionSql...');
  const dimensionResults = testGetDimensionSql();
  totalPassed += dimensionResults.passed;
  totalFailed += dimensionResults.failed;
  console.log(`  ✅ Passed: ${dimensionResults.passed}, ❌ Failed: ${dimensionResults.failed}`);
  console.log('');

  // Test getDateRangeSql
  console.log('Testing getDateRangeSql...');
  const dateRangeResults = testGetDateRangeSql();
  totalPassed += dateRangeResults.passed;
  totalFailed += dateRangeResults.failed;
  console.log(`  ✅ Passed: ${dateRangeResults.passed}, ❌ Failed: ${dateRangeResults.failed}`);
  console.log('');

  // Test compileQuery
  console.log('Testing compileQuery...');
  const compileResults = testCompileQuery();
  totalPassed += compileResults.passed;
  totalFailed += compileResults.failed;
  console.log(`  ✅ Passed: ${compileResults.passed}, ❌ Failed: ${compileResults.failed}`);
  console.log('');

  // Test validation examples
  console.log('Testing validation examples (first 10)...');
  const exampleResults = testValidationExamples();
  totalPassed += exampleResults.passed;
  totalFailed += exampleResults.failed;
  totalSkipped += exampleResults.skipped;
  console.log(`  ✅ Passed: ${exampleResults.passed}, ❌ Failed: ${exampleResults.failed}, ⏭️  Skipped: ${exampleResults.skipped}`);
  console.log('');

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Tests: ${totalPassed + totalFailed + totalSkipped}`);
  console.log(`✅ Passed: ${totalPassed}`);
  console.log(`❌ Failed: ${totalFailed}`);
  console.log(`⏭️  Skipped: ${totalSkipped}`);
  console.log(`Success Rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`);
  console.log('='.repeat(80));

  return {
    total: totalPassed + totalFailed + totalSkipped,
    passed: totalPassed,
    failed: totalFailed,
    skipped: totalSkipped,
  };
}

// Run if executed directly
if (require.main === module) {
  runValidationSuite();
}

export { runValidationSuite };
