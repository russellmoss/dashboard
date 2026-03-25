'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Text } from '@tremor/react';
import { ChevronDown, ChevronRight, ExternalLink, FileSpreadsheet, FolderOpen, Loader2, Trash2 } from 'lucide-react';
import { dashboardApi } from '@/lib/api-client';

interface ExportRecord {
  id: string;
  name: string;
  spreadsheetUrl: string;
  createdAt: string;
  createdBy: string;
  windowDays: number;
  p2RowCount: number;
  auditRowCount: number;
}

interface UserFolder {
  email: string;
  displayName: string;
  exports: ExportRecord[];
}

function windowLabel(days: number): string {
  if (days === 180) return '180d';
  if (days === 365) return '1yr';
  if (days === 730) return '2yr';
  if (days === 0) return 'All time';
  return `${days}d`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function emailToDisplayName(email: string): string {
  const local = email.split('@')[0];
  return local
    .split('.')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function groupByUser(exports: ExportRecord[]): UserFolder[] {
  const map = new Map<string, ExportRecord[]>();
  for (const exp of exports) {
    const list = map.get(exp.createdBy) || [];
    list.push(exp);
    map.set(exp.createdBy, list);
  }
  return Array.from(map.entries())
    .map(([email, exps]) => ({
      email,
      displayName: emailToDisplayName(email),
      exports: exps,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function ExportsPanel() {
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const folders = useMemo(() => groupByUser(exports), [exports]);

  useEffect(() => {
    dashboardApi.getForecastExports()
      .then(data => {
        setExports(data.exports);
      })
      .catch(() => setError('Failed to load exports'))
      .finally(() => setLoading(false));
  }, []);

  const toggleFolder = (email: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const handleDelete = async (exp: ExportRecord) => {
    if (!confirm(`Delete "${exp.name}"?\n\nThis will permanently remove the Google Sheet and cannot be undone.`)) {
      return;
    }
    setDeleting(exp.id);
    try {
      await dashboardApi.deleteForecastExport(exp.id);
      setExports(prev => prev.filter(e => e.id !== exp.id));
    } catch {
      setError('Failed to delete export');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <Card className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <Text className="text-red-500">{error}</Text>
      </Card>
    );
  }

  if (exports.length === 0) {
    return (
      <Card className="p-8 text-center">
        <FileSpreadsheet className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <Text className="text-gray-500">No exports yet</Text>
        <Text className="text-xs text-gray-400 mt-1">
          Use the "Export to Sheets" button on the Pipeline Forecast tab to create your first export.
        </Text>
      </Card>
    );
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <Text className="font-semibold">Forecast Exports</Text>
        <Text className="text-xs text-gray-500 mt-0.5">
          Each export is a unique Google Sheet snapshot. Click a folder to view exports. Exports are organized by user in Google Drive.
        </Text>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {folders.map(folder => {
          const isExpanded = expandedFolders.has(folder.email);
          return (
            <div key={folder.email}>
              <button
                onClick={() => toggleFolder(folder.email)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                )}
                <FolderOpen className="w-4.5 h-4.5 text-amber-500 flex-shrink-0" />
                <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                  {folder.displayName}
                </span>
                <span className="text-xs text-gray-400 ml-1">
                  {folder.exports.length} {folder.exports.length === 1 ? 'export' : 'exports'}
                </span>
              </button>
              {isExpanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50 text-left">
                        <th className="pl-12 pr-4 py-2 font-medium text-gray-600 dark:text-gray-400">Date</th>
                        <th className="px-4 py-2 font-medium text-gray-600 dark:text-gray-400">Window</th>
                        <th className="px-4 py-2 font-medium text-gray-600 dark:text-gray-400">Deals</th>
                        <th className="px-4 py-2 font-medium text-gray-600 dark:text-gray-400">Cohort</th>
                        <th className="px-4 py-2 font-medium text-gray-600 dark:text-gray-400">Sheet</th>
                        <th className="px-4 py-2 font-medium text-gray-600 dark:text-gray-400 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                      {folder.exports.map(exp => (
                        <tr key={exp.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="pl-12 pr-4 py-2.5 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                            {formatDate(exp.createdAt)}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                              {windowLabel(exp.windowDays)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                            {exp.p2RowCount} opps
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">
                            {exp.auditRowCount} resolved
                          </td>
                          <td className="px-4 py-2.5">
                            <a
                              href={exp.spreadsheetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:underline font-medium"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Open
                            </a>
                          </td>
                          <td className="px-4 py-2.5">
                            <button
                              onClick={() => handleDelete(exp)}
                              disabled={deleting === exp.id}
                              className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                              title="Delete export"
                            >
                              {deleting === exp.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
