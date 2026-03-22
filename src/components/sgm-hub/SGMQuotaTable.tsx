'use client';

import { useState, useMemo } from 'react';
import { Card } from '@tremor/react';
import { SGMQuotaEntry } from '@/types/sgm-hub';

interface SGMQuotaTableProps {
  quotas: SGMQuotaEntry[];
  loading: boolean;
  onSave: (data: { userEmail: string; quarter: string; arrGoal: number }) => Promise<void>;
  selectedYear: number;
  onYearChange: (year: number) => void;
}

function formatDollar(value: number): string {
  return `$${value.toLocaleString()}`;
}

export function SGMQuotaTable({ quotas, loading, onSave, selectedYear, onYearChange }: SGMQuotaTableProps) {
  const [editingCell, setEditingCell] = useState<string | null>(null); // "email:quarter"
  const [draftValue, setDraftValue] = useState<string>('');
  const [savingCell, setSavingCell] = useState<string | null>(null);

  const quarters = [`${selectedYear}-Q1`, `${selectedYear}-Q2`, `${selectedYear}-Q3`, `${selectedYear}-Q4`];
  const quarterLabels = ['Q1', 'Q2', 'Q3', 'Q4'];

  // Group quotas by SGM
  const sgmRows = useMemo(() => {
    const map = new Map<string, { sgmName: string; userEmail: string; quotasByQuarter: Record<string, number> }>();
    for (const q of quotas) {
      if (!map.has(q.userEmail)) {
        map.set(q.userEmail, { sgmName: q.sgmName, userEmail: q.userEmail, quotasByQuarter: {} });
      }
      map.get(q.userEmail)!.quotasByQuarter[q.quarter] = q.arrGoal;
    }
    return Array.from(map.values()).sort((a, b) => a.sgmName.localeCompare(b.sgmName));
  }, [quotas]);

  const startEdit = (userEmail: string, quarter: string, currentValue: number) => {
    const key = `${userEmail}:${quarter}`;
    setEditingCell(key);
    setDraftValue(String(currentValue));
  };

  const commitEdit = async (userEmail: string, quarter: string) => {
    const key = `${userEmail}:${quarter}`;
    const parsed = parseFloat(draftValue);
    if (isNaN(parsed) || parsed < 0) {
      setEditingCell(null);
      return;
    }

    const arrGoal = Math.round(parsed);
    setSavingCell(key);
    setEditingCell(null);

    try {
      await onSave({ userEmail, quarter, arrGoal });
    } finally {
      setSavingCell(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, userEmail: string, quarter: string) => {
    if (e.key === 'Enter') {
      commitEdit(userEmail, quarter);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  const yearOptions = [selectedYear - 1, selectedYear, selectedYear + 1];

  if (loading) {
    return (
      <Card className="mt-6">
        <div className="animate-pulse space-y-3 py-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Quota Management
        </h3>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">Year:</label>
          <select
            value={selectedYear}
            onChange={(e) => onYearChange(parseInt(e.target.value, 10))}
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-900 dark:text-white"
          >
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {sgmRows.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 py-4 text-center">No quota data for {selectedYear}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-3 text-gray-600 dark:text-gray-400 font-medium">SGM</th>
                {quarterLabels.map((label, i) => (
                  <th key={quarters[i]} className="text-right py-2 px-3 text-gray-600 dark:text-gray-400 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sgmRows.map((sgm) => (
                <tr key={sgm.userEmail} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900">
                  <td className="py-2 px-3 text-gray-900 dark:text-white font-medium">
                    {sgm.sgmName}
                  </td>
                  {quarters.map((quarter) => {
                    const key = `${sgm.userEmail}:${quarter}`;
                    const value = sgm.quotasByQuarter[quarter] ?? 0;
                    const isEditing = editingCell === key;
                    const isSaving = savingCell === key;

                    return (
                      <td key={quarter} className="py-2 px-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={draftValue}
                            onChange={(e) => setDraftValue(e.target.value)}
                            onBlur={() => commitEdit(sgm.userEmail, quarter)}
                            onKeyDown={(e) => handleKeyDown(e, sgm.userEmail, quarter)}
                            autoFocus
                            className="w-28 text-right rounded border border-blue-400 bg-white dark:bg-gray-800 px-2 py-0.5 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <button
                            onClick={() => startEdit(sgm.userEmail, quarter, value)}
                            className={`text-right hover:bg-blue-50 dark:hover:bg-blue-900/20 px-2 py-0.5 rounded ${
                              isSaving ? 'opacity-50' : ''
                            } ${value === 0 ? 'text-gray-400' : 'text-gray-900 dark:text-white'}`}
                            disabled={isSaving}
                          >
                            {formatDollar(value)}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
