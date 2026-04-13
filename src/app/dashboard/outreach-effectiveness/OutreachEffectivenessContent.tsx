'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Text } from '@tremor/react';
import { useSession } from 'next-auth/react';
import { getSessionPermissions } from '@/types/auth';
import OutreachEffectivenessFilters from '@/components/outreach-effectiveness/OutreachEffectivenessFilters';
import MetricCards from '@/components/outreach-effectiveness/MetricCards';
import SGABreakdownTable from '@/components/outreach-effectiveness/SGABreakdownTable';
import OutreachDrillDownModal from '@/components/outreach-effectiveness/OutreachDrillDownModal';
import CampaignSummary from '@/components/outreach-effectiveness/CampaignSummary';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import type {
  OutreachEffectivenessFilters as FilterType,
  OutreachEffectivenessDashboardData,
  OutreachDrillDownType,
  OutreachFilterOptions,
} from '@/types/outreach-effectiveness';

interface OutreachEffectivenessContentProps {
  embedded?: boolean;
}

const DEFAULT_FILTERS: FilterType = {
  sga: null,
  dateRangeType: 'qtd',
  startDate: null,
  endDate: null,
  campaignIds: [],
  zeroTouchMode: 'stale',
};

export default function OutreachEffectivenessContent({
  embedded = false,
}: OutreachEffectivenessContentProps) {
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager' || permissions?.role === 'revops_admin';
  const showSGAFilter = isAdmin || permissions?.role === 'sgm';

  // Data state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OutreachEffectivenessDashboardData | null>(null);
  const [filters, setFilters] = useState<FilterType>(DEFAULT_FILTERS);
  const [sgaOptions, setSgaOptions] = useState<OutreachFilterOptions['sgas']>([]);
  const [campaignOptions, setCampaignOptions] = useState<OutreachFilterOptions['campaigns']>([]);
  const [activeMetric, setActiveMetric] = useState<string>('persistence');

  // Drill-down state
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownType, setDrillDownType] = useState<OutreachDrillDownType>('leads');
  const [drillDownTitle, setDrillDownTitle] = useState('');
  const [drillDownRecords, setDrillDownRecords] = useState<any[]>([]);
  const [drillDownLoading, setDrillDownLoading] = useState(false);
  const [drillDownError, setDrillDownError] = useState<string | null>(null);
  const [drillDownPage, setDrillDownPage] = useState(1);
  const [drillDownTotal, setDrillDownTotal] = useState(0);
  const [drillDownSga, setDrillDownSga] = useState<string>('');
  const [drillDownColumnFilter, setDrillDownColumnFilter] = useState<string | undefined>();

  // Record detail modal
  const [recordDetailOpen, setRecordDetailOpen] = useState(false);
  const [recordDetailId, setRecordDetailId] = useState<string | null>(null);

  // Fetch filter options on mount
  useEffect(() => {
    async function fetchFilterOptions() {
      try {
        const res = await fetch('/api/outreach-effectiveness/filters');
        if (!res.ok) return;
        const opts: OutreachFilterOptions = await res.json();
        setSgaOptions(opts.sgas);
        setCampaignOptions(opts.campaigns);
      } catch {
        // Filter options are non-critical
      }
    }
    fetchFilterOptions();
  }, []);

  // Fetch dashboard data on filter change
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/outreach-effectiveness/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      setData(result);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Drill-down fetch
  const fetchDrillDown = useCallback(async (
    type: OutreachDrillDownType,
    sgaName: string,
    page: number = 1,
    columnFilter?: string
  ) => {
    setDrillDownLoading(true);
    setDrillDownError(null);
    try {
      const res = await fetch('/api/outreach-effectiveness/drill-down', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          filters,
          sgaName,
          columnFilter,
          page,
          pageSize: 100,
        }),
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);

      if (type === 'weekly-calls') {
        // Weekly calls returns array directly
        setDrillDownRecords(Array.isArray(result) ? result : []);
        setDrillDownTotal(Array.isArray(result) ? result.length : 0);
      } else {
        setDrillDownRecords(result.records || []);
        setDrillDownTotal(result.total || 0);
      }
    } catch (err: any) {
      console.error('Drill-down fetch error:', err);
      setDrillDownError(err.message || 'Failed to load drill-down data');
      setDrillDownRecords([]);
      setDrillDownTotal(0);
    } finally {
      setDrillDownLoading(false);
    }
  }, [filters]);

  // Column label map for drill-down titles
  const COLUMN_LABELS: Record<string, string> = {
    assigned: 'All Leads',
    worked: 'Worked Leads',
    badLeads: 'Bad Leads',
    mql: 'MQLs',
    sql: 'SQLs',
    sqo: 'SQOs',
    replied: 'Replied Leads',
    unengaged: 'Unengaged Leads',
    fivePlus: '5+ Touchpoint Leads',
    terminalUnengaged: 'Contacting Unengaged Leads',
    premature: 'Premature (<5 Touches) Leads',
    zeroTouchOpen: 'Zero-Touch (Open)',
    zeroTouchClosed: 'Zero-Touch (Closed)',
  };

  // Cell click handler — drills down on a specific column for an SGA
  const handleCellClick = (sgaName: string, columnFilter: string) => {
    const isZeroTouch = columnFilter === 'zeroTouchOpen' || columnFilter === 'zeroTouchClosed';
    const type: OutreachDrillDownType = isZeroTouch ? 'zero-touch' : 'leads';
    const label = COLUMN_LABELS[columnFilter] || 'Leads';
    const title = `${label} — ${sgaName}`;

    setDrillDownType(type);
    setDrillDownTitle(title);
    setDrillDownSga(sgaName);
    setDrillDownPage(1);
    setDrillDownColumnFilter(columnFilter);
    setDrillDownOpen(true);

    if (isZeroTouch) {
      fetchDrillDown('zero-touch', sgaName, 1);
    } else {
      fetchDrillDown('leads', sgaName, 1, columnFilter);
    }
  };

  // SGA row click handler (for weekly-calls metric)
  const handleSGARowClick = (sgaName: string) => {
    if (activeMetric === 'avg-calls') {
      setDrillDownType('weekly-calls');
      setDrillDownTitle(`Weekly Calls — ${sgaName}`);
      setDrillDownSga(sgaName);
      setDrillDownPage(1);
      setDrillDownColumnFilter(undefined);
      setDrillDownOpen(true);
      fetchDrillDown('weekly-calls', sgaName, 1);
    }
  };

  const handleDrillDownPageChange = (newPage: number) => {
    setDrillDownPage(newPage);
    fetchDrillDown(drillDownType, drillDownSga, newPage, drillDownColumnFilter);
  };

  const handleRecordClick = (record: any) => {
    const id = record.prospectId || record.opportunityId;
    if (id) {
      setRecordDetailId(id);
      setRecordDetailOpen(true);
    }
  };

  const handleExportAll = async (): Promise<any[]> => {
    const res = await fetch('/api/outreach-effectiveness/drill-down', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: drillDownType,
        filters,
        sgaName: drillDownSga,
        columnFilter: drillDownColumnFilter,
        page: 1,
        pageSize: 10000,
      }),
    });
    const result = await res.json();
    if (drillDownType === 'weekly-calls') return result;
    return result.records || [];
  };

  const handleBackToDrillDown = () => {
    setRecordDetailOpen(false);
  };

  return (
    <div className={embedded ? 'space-y-6' : 'p-6 space-y-6'}>
      {!embedded && (
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Outreach Effectiveness</h1>
      )}

      <OutreachEffectivenessFilters
        filters={filters}
        onApply={setFilters}
        onReset={() => setFilters(DEFAULT_FILTERS)}
        sgaOptions={sgaOptions}
        campaignOptions={campaignOptions}
        showSGAFilter={showSGAFilter}
      />

      {loading && !data && (
        <div className="flex justify-center py-12">
          <Text className="text-gray-500">Loading outreach data...</Text>
        </div>
      )}

      {error && !data && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <Text className="text-red-600 dark:text-red-400">{error}</Text>
        </div>
      )}

      {data && (
        <>
          <MetricCards
            data={data}
            activeMetric={activeMetric}
            onMetricClick={setActiveMetric}
            zeroTouchMode={filters.zeroTouchMode}
            onZeroTouchModeChange={(mode) => setFilters(prev => ({ ...prev, zeroTouchMode: mode }))}
          />
          {data.campaignSummary && <CampaignSummary data={data.campaignSummary} />}
          <SGABreakdownTable
            rows={data.sgaBreakdown}
            activeMetric={activeMetric}
            onRowClick={handleSGARowClick}
            onCellClick={handleCellClick}
          />
        </>
      )}

      <OutreachDrillDownModal
        isOpen={drillDownOpen && !recordDetailOpen}
        onClose={() => setDrillDownOpen(false)}
        title={drillDownTitle}
        drillDownType={drillDownType}
        records={drillDownRecords}
        loading={drillDownLoading}
        error={drillDownError}
        total={drillDownTotal}
        page={drillDownPage}
        pageSize={100}
        onPageChange={handleDrillDownPageChange}
        onRecordClick={handleRecordClick}
        onExportAll={handleExportAll}
      />

      <RecordDetailModal
        isOpen={recordDetailOpen}
        onClose={() => setRecordDetailOpen(false)}
        recordId={recordDetailId}
        showBackButton={drillDownOpen}
        onBack={handleBackToDrillDown}
        backButtonLabel="Back to Drill-Down"
      />
    </div>
  );
}
