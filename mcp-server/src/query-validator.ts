const ALLOWED_DATASETS = ['Tableau_Views', 'SavvyGTMData', 'savvy_analytics'];

const BLOCKED_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE',
  'CREATE', 'DROP', 'ALTER',
  'EXECUTE', 'CALL',  // Council review C4: block EXECUTE IMMEDIATE and CALL
];

const BLOCKED_TABLE_PATTERNS = [/_tmp_/i];

// Council review S1: inject LIMIT if missing to prevent OOM on large tables
const MAX_ROWS = 1000;

export interface ValidationResult {
  valid: boolean;
  error?: string;
  datasetsReferenced: string[];
  sanitizedQuery: string;  // Query with LIMIT injected if missing
}

/**
 * Strip leading SQL comments before validation.
 * Council review C4: prevents bypass via leading comments like '/* bypass *​/ DELETE...'
 */
function stripLeadingComments(sql: string): string {
  let s = sql.trimStart();
  while (true) {
    if (s.startsWith('--')) {
      const newline = s.indexOf('\n');
      s = newline === -1 ? '' : s.slice(newline + 1).trimStart();
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      s = end === -1 ? '' : s.slice(end + 2).trimStart();
    } else {
      break;
    }
  }
  return s;
}

export function validateQuery(sql: string): ValidationResult {
  // Council review C4: strip leading comments before validation
  const trimmed = stripLeadingComments(sql);

  if (!trimmed) {
    return { valid: false, error: 'Empty query', datasetsReferenced: [], sanitizedQuery: sql };
  }

  // 1. Must start with SELECT, WITH, or (SELECT
  const upperStart = trimmed.toUpperCase();
  if (!upperStart.startsWith('SELECT') &&
      !upperStart.startsWith('WITH') &&
      !upperStart.startsWith('(SELECT')) {
    return { valid: false, error: 'Only SELECT queries are allowed', datasetsReferenced: [], sanitizedQuery: sql };
  }

  // 2. Block DML/DDL keywords (word-boundary check)
  // Strip string literals before checking so 'Call', 'Outbound', etc. don't false-positive
  const withoutStrings = trimmed.replace(/'[^']*'/g, "''");
  for (const keyword of BLOCKED_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(withoutStrings)) {
      return { valid: false, error: `Blocked keyword detected: ${keyword}`, datasetsReferenced: [], sanitizedQuery: sql };
    }
  }

  // 3. Block INFORMATION_SCHEMA access
  if (/INFORMATION_SCHEMA/i.test(trimmed)) {
    return { valid: false, error: 'INFORMATION_SCHEMA access is not allowed', datasetsReferenced: [], sanitizedQuery: sql };
  }

  // 4. Block _tmp_* table patterns
  for (const pattern of BLOCKED_TABLE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: 'Access to temporary tables is not allowed', datasetsReferenced: [], sanitizedQuery: sql };
    }
  }

  // 5. Extract and validate dataset references
  const datasetPattern = /`?savvy-gtm-analytics`?\.`?(\w+)`?\./gi;
  const shortDatasetPattern = /\bFROM\s+`?(\w+)`?\.\w+/gi;
  const datasetsReferenced = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = datasetPattern.exec(trimmed)) !== null) {
    datasetsReferenced.add(match[1]);
  }
  while ((match = shortDatasetPattern.exec(trimmed)) !== null) {
    if (ALLOWED_DATASETS.includes(match[1])) {
      datasetsReferenced.add(match[1]);
    }
  }

  // 6. Verify all referenced datasets are in the allowlist
  for (const ds of datasetsReferenced) {
    if (!ALLOWED_DATASETS.includes(ds)) {
      return {
        valid: false,
        error: `Dataset "${ds}" is not in the allowed list. Allowed: ${ALLOWED_DATASETS.join(', ')}`,
        datasetsReferenced: Array.from(datasetsReferenced),
        sanitizedQuery: sql,
      };
    }
  }

  // 7. Council review S1: Inject LIMIT if missing to prevent OOM
  let sanitizedQuery = trimmed;
  if (!/\bLIMIT\s+\d+/i.test(trimmed)) {
    sanitizedQuery = `${trimmed.replace(/;\s*$/, '')} LIMIT ${MAX_ROWS}`;
  }

  return { valid: true, datasetsReferenced: Array.from(datasetsReferenced), sanitizedQuery };
}
