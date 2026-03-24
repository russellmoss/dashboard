'use client';

import React, { useState, useMemo } from 'react';
import { Card, Text } from '@tremor/react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { ForecastPipelineRecord } from '@/lib/queries/forecast-pipeline';

interface PipelineDetailTableProps {
  records: ForecastPipelineRecord[];
  onRowClick: (oppId: string) => void;
}

const STAGE_TABS = [
  { label: 'All stages', filter: null },
  { label: 'Signed', filter: ['Signed'] },
  { label: 'Negotiating', filter: ['Negotiating'] },
  { label: 'Sales Process', filter: ['Sales Process'] },
  { label: 'SQO, Discovery & Qualifying', filter: ['Discovery', 'Qualifying'] },
];

type SortField = 'advisor_name' | 'StageName' | 'Opportunity_AUM_M' | 'p_join' | 'expected_aum' | 'days_in_current_stage' | 'durationBucket' | 'final_projected_join_date';

const DURATION_BUCKET_ORDER: Record<string, number> = {
  'Within 1 SD': 0,
  '1-2 SD': 1,
  '2+ SD': 2,
};

function formatAum(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}B`;
  return `$${value.toFixed(1)}M`;
}

export function PipelineDetailTable({ records, onRowClick }: PipelineDetailTableProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [sortField, setSortField] = useState<SortField>('expected_aum');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filteredRecords = useMemo(() => {
    const tab = STAGE_TABS[activeTab];
    if (!tab.filter) return records;
    return records.filter(r => tab.filter!.includes(r.StageName));
  }, [records, activeTab]);

  const sortedRecords = useMemo(() => {
    return [...filteredRecords].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      if (sortField === 'expected_aum') {
        aVal = a.expected_aum_weighted;
        bVal = b.expected_aum_weighted;
      } else if (sortField === 'final_projected_join_date') {
        aVal = a.final_projected_join_date || '';
        bVal = b.final_projected_join_date || '';
      } else if (sortField === 'durationBucket') {
        aVal = DURATION_BUCKET_ORDER[a.durationBucket ?? 'Within 1 SD'] ?? 0;
        bVal = DURATION_BUCKET_ORDER[b.durationBucket ?? 'Within 1 SD'] ?? 0;
      } else {
        aVal = a[sortField] as number | string;
        bVal = b[sortField] as number | string;
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredRecords, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 inline ml-1" />
      : <ChevronDown className="w-3 h-3 inline ml-1" />;
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <Text className="font-semibold">Pipeline Detail ({sortedRecords.length} opps)</Text>
      </div>

      {/* Stage tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto">
        {STAGE_TABS.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(i)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === i
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
              <th className="py-2 px-2 cursor-pointer hover:text-blue-600" onClick={() => handleSort('advisor_name')}>
                Advisor<SortIcon field="advisor_name" />
              </th>
              <th className="py-2 px-2 cursor-pointer hover:text-blue-600" onClick={() => handleSort('StageName')}>
                Stage<SortIcon field="StageName" />
              </th>
              <th className="py-2 px-2 text-right cursor-pointer hover:text-blue-600" onClick={() => handleSort('Opportunity_AUM_M')}>
                AUM<SortIcon field="Opportunity_AUM_M" />
              </th>
              <th className="py-2 px-2 text-right cursor-pointer hover:text-blue-600" onClick={() => handleSort('p_join')}>
                P(Join)<SortIcon field="p_join" />
              </th>
              <th className="py-2 px-2 text-right cursor-pointer hover:text-blue-600" onClick={() => handleSort('expected_aum')}>
                Expected AUM<SortIcon field="expected_aum" />
              </th>
              <th className="py-2 px-2 text-right cursor-pointer hover:text-blue-600" onClick={() => handleSort('days_in_current_stage')}>
                Days<SortIcon field="days_in_current_stage" />
              </th>
              <th className="py-2 px-2 cursor-pointer hover:text-blue-600" onClick={() => handleSort('durationBucket')}>
                Duration<SortIcon field="durationBucket" />
              </th>
              <th className="py-2 px-2 cursor-pointer hover:text-blue-600" onClick={() => handleSort('final_projected_join_date')}>
                Proj. Join<SortIcon field="final_projected_join_date" />
              </th>
              <th className="py-2 px-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {sortedRecords.map(r => {
              const totalExpected = r.expected_aum_weighted;
              return (
                <tr
                  key={r.Full_Opportunity_ID__c}
                  onClick={() => onRowClick(r.Full_Opportunity_ID__c)}
                  className="border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <td className="py-2 px-2 font-medium text-gray-900 dark:text-gray-100 max-w-[200px] truncate">
                    {r.advisor_name}
                  </td>
                  <td className="py-2 px-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                      r.StageName === 'Signed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                      r.StageName === 'Negotiating' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                      r.StageName === 'Sales Process' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                      'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                    }`}>
                      {r.StageName}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono">
                    {r.is_zero_aum ? (
                      <span className="text-gray-400">$0</span>
                    ) : (
                      formatAum(r.Opportunity_AUM_M)
                    )}
                  </td>
                  <td className="py-2 px-2 text-right font-mono">
                    {(r.p_join * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 px-2 text-right font-mono font-medium">
                    {totalExpected > 0 ? formatAum(totalExpected / 1e6) : '-'}
                  </td>
                  <td className="py-2 px-2 text-right text-gray-600 dark:text-gray-400">
                    {r.days_in_current_stage}d
                  </td>
                  <td className="py-2 px-2">
                    {r.durationBucket && r.durationBucket !== 'Within 1 SD' ? (
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                        r.durationBucket === '2+ SD'
                          ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {r.durationBucket}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Normal</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-gray-600 dark:text-gray-400">
                    {r.final_projected_join_date?.substring(0, 10) || '-'}
                  </td>
                  <td className="py-2 px-2">
                    {r.date_source === 'Anticipated' ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-xs text-purple-600 dark:text-purple-400">Anticipated</span>
                        {r.dateConfidence === 'Low' && (
                          <span className="inline-block w-2 h-2 rounded-full bg-red-500" title={`Low confidence — ${r.dateRevisionCount ?? 0} revisions`} />
                        )}
                        {r.dateConfidence === 'Medium' && (
                          <span className="inline-block w-2 h-2 rounded-full bg-amber-500" title={`Medium confidence — ${r.dateRevisionCount ?? 0} revisions`} />
                        )}
                        {r.dateConfidence === 'High' && (
                          <span className="inline-block w-2 h-2 rounded-full bg-green-500" title={`High confidence — ${r.dateRevisionCount ?? 0} revisions`} />
                        )}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
