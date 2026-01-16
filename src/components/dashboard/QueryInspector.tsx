// src/components/dashboard/QueryInspector.tsx
'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check, Clock, Database } from 'lucide-react';

interface QueryInspectorProps {
  sql: string;
  params: Record<string, unknown>;
  executionTimeMs?: number;
}

export function QueryInspector({ sql, params, executionTimeMs }: QueryInspectorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showExecutable, setShowExecutable] = useState(true);

  /**
   * Substitute parameter placeholders with actual values to create executable SQL
   * Handles date strings, SQL expressions, arrays, and other types correctly
   */
  const substituteParameters = (querySql: string, queryParams: Record<string, unknown>): string => {
    let executableSql = querySql;
    
    for (const [key, value] of Object.entries(queryParams)) {
      // Handle different parameter types
      let sqlValue: string;
      
      if (value === null || value === undefined) {
        sqlValue = 'NULL';
      } else if (typeof value === 'string') {
        // Check if it's already a SQL expression (contains functions like DATE, TIMESTAMP, CONCAT, etc.)
        // SQL expressions typically contain parentheses or SQL keywords
        const isSqlExpression = /^\s*(DATE|TIMESTAMP|CONCAT|DATE_TRUNC|DATE_SUB|DATE_ADD|CURRENT_DATE|CURRENT_TIMESTAMP|EXTRACT|CAST|UNNEST)\s*\(/i.test(value.trim()) ||
                                 value.includes('INTERVAL') ||
                                 (value.includes('(') && value.includes(')') && !value.match(/^['"]/));
        
        if (isSqlExpression) {
          // It's already a SQL expression, use as-is (no quotes)
          sqlValue = value;
        } else {
          // It's a string literal, wrap in quotes and escape single quotes
          // Date strings like '2024-10-01' or '2024-10-01 23:59:59' should be quoted
          sqlValue = `'${String(value).replace(/'/g, "''")}'`;
        }
      } else if (typeof value === 'number') {
        sqlValue = String(value);
      } else if (typeof value === 'boolean') {
        sqlValue = value ? 'TRUE' : 'FALSE';
      } else if (Array.isArray(value)) {
        // Handle arrays (e.g., for UNNEST)
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
  };

  const executableSql = substituteParameters(sql, params);

  const copyToClipboard = async () => {
    const sqlToCopy = showExecutable ? executableSql : sql;
    await navigator.clipboard.writeText(sqlToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Format SQL for display
  const formatSql = (querySql: string) => {
    return querySql
      .replace(/SELECT/gi, 'SELECT\n  ')
      .replace(/FROM/gi, '\nFROM')
      .replace(/WHERE/gi, '\nWHERE')
      .replace(/GROUP BY/gi, '\nGROUP BY')
      .replace(/ORDER BY/gi, '\nORDER BY')
      .replace(/LEFT JOIN/gi, '\nLEFT JOIN')
      .replace(/RIGHT JOIN/gi, '\nRIGHT JOIN')
      .replace(/INNER JOIN/gi, '\nINNER JOIN')
      .replace(/WITH/gi, 'WITH')
      .replace(/,\s*([A-Z])/g, ',\n  $1') // Format CTE commas
      .replace(/AND/gi, '\n  AND')
      .replace(/OR/gi, '\n  OR')
      .trim();
  };

  const formattedSql = formatSql(showExecutable ? executableSql : sql);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 
                   bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 
                   dark:hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Query Inspector
          </span>
          {executionTimeMs !== undefined && (
            <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <Clock className="w-3 h-3" />
              {executionTimeMs}ms
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-500" />
        )}
      </button>

      {/* Expandable content */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          {/* Toggle between parameterized and executable SQL */}
          {Object.keys(params).length > 0 && (
            <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 
                           bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                {showExecutable ? 'Executable SQL (ready for BigQuery)' : 'Parameterized SQL'}
              </span>
              <button
                onClick={() => setShowExecutable(!showExecutable)}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                {showExecutable ? 'Show Parameterized' : 'Show Executable'}
              </button>
            </div>
          )}
          
          {/* SQL Section */}
          <div className="relative">
            <button
              onClick={copyToClipboard}
              className="absolute top-2 right-2 p-2 rounded-md bg-gray-100 dark:bg-gray-700 
                         hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors z-10"
              title={showExecutable ? "Copy Executable SQL" : "Copy Parameterized SQL"}
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              )}
            </button>
            <pre className="p-4 overflow-x-auto bg-gray-900 dark:bg-gray-950 text-sm">
              <code className="text-green-400 font-mono whitespace-pre-wrap">
                {formattedSql}
              </code>
            </pre>
          </div>

          {/* Parameters Section */}
          {Object.keys(params).length > 0 && (
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 
                           bg-gray-50 dark:bg-gray-800/50">
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                Parameters
              </h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(params).map(([key, value]) => (
                  <span
                    key={key}
                    className="inline-flex items-center px-2 py-1 rounded text-xs 
                               bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300"
                  >
                    <span className="font-medium">{key}:</span>
                    <span className="ml-1 opacity-75">
                      {value === null ? 'null' : String(value).substring(0, 50)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
