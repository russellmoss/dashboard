/**
 * Substitute BigQuery @param placeholders with actual values.
 * Handles: NULL, strings (with SQL expression detection), numbers, booleans, arrays.
 * Used by ResponseFeedback (explore feedback) and QueryInspector (SQL display).
 */
export function generateExecutableSql(querySql: string, queryParams: Record<string, unknown>): string {
  let executableSql = querySql;

  for (const [key, value] of Object.entries(queryParams)) {
    let sqlValue: string;

    if (value === null || value === undefined) {
      sqlValue = 'NULL';
    } else if (typeof value === 'string') {
      // Check if it's already a SQL expression (contains functions like DATE, TIMESTAMP, CONCAT, etc.)
      const isSqlExpression = /^\s*(DATE|TIMESTAMP|CONCAT|DATE_TRUNC|DATE_SUB|DATE_ADD|CURRENT_DATE|CURRENT_TIMESTAMP|EXTRACT|CAST|UNNEST)\s*\(/i.test(value.trim()) ||
                               value.includes('INTERVAL') ||
                               (value.includes('(') && value.includes(')') && !value.match(/^['"]/));

      if (isSqlExpression) {
        sqlValue = value;
      } else {
        // String literal, wrap in quotes and escape single quotes
        sqlValue = `'${String(value).replace(/'/g, "''")}'`;
      }
    } else if (typeof value === 'number') {
      sqlValue = String(value);
    } else if (typeof value === 'boolean') {
      sqlValue = value ? 'TRUE' : 'FALSE';
    } else if (Array.isArray(value)) {
      const arrayValues = value.map(v => {
        if (typeof v === 'string') {
          return `'${String(v).replace(/'/g, "''")}'`;
        }
        return String(v);
      }).join(', ');
      sqlValue = `[${arrayValues}]`;
    } else {
      sqlValue = String(value);
    }

    // Replace @parameterName with the actual value
    // Use word boundary to avoid partial matches (e.g., @startDate doesn't match @startDateStr)
    const regex = new RegExp(`@${key}\\b`, 'g');
    executableSql = executableSql.replace(regex, sqlValue);
  }

  return executableSql;
}
