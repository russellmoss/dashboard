'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Title, Text, Card } from '@tremor/react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Search, ExternalLink, Download, Filter, Check, ArrowUp, ArrowDown } from 'lucide-react';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import type { UserPermissions } from '@/types/user';

interface ProspectRecord {
  primary_key: string;
  advisor_name: string;
  External_Agency__c: string;
  SGA_Owner_Name__c: string | null;
  Next_Steps__c: string | null;
  TOF_Stage: string;
  Conversion_Status: string;
  salesforce_url: string | null;
  Full_Opportunity_ID__c: string | null;
}

interface OpportunityRecord {
  primary_key: string;
  advisor_name: string;
  External_Agency__c: string;
  SGM_Owner_Name__c: string | null;
  StageName: string;
  NextStep: string | null;
  salesforce_url: string | null;
}

interface ProspectFilters {
  stages: string[];
  statusOpen: boolean;
  statusClosed: boolean;
  externalAgencies: string[];
}

interface OpportunityFilters {
  stages: string[];
  sgms: string[];
  statusOpen: boolean;
  statusClosed: boolean;
  externalAgencies: string[];
}

const ROWS_PER_PAGE = 150;

const PROSPECT_STAGES = ['MQL', 'SQL', 'SQO', 'Qualified', 'Closed Lost'];

// Open stages for Recruiter Hub opportunities (match pipeline “Open”)
const OPEN_OPPORTUNITY_STAGES_RH = [
  'Qualifying',
  'Discovery',
  'Sales Process',
  'Negotiating',
  'Signed',
  'On Hold',
  'Re-Engaged',
  'Planned Nurture',
];
const CLOSED_OPPORTUNITY_STAGES_RH = ['Joined', 'Closed Lost'];
const ALL_OPPORTUNITY_STAGES_RH = [
  { value: 'Qualifying', label: 'Qualifying', isOpenStage: true },
  { value: 'Discovery', label: 'Discovery', isOpenStage: true },
  { value: 'Sales Process', label: 'Sales Process', isOpenStage: true },
  { value: 'Negotiating', label: 'Negotiating', isOpenStage: true },
  { value: 'Signed', label: 'Signed', isOpenStage: true },
  { value: 'On Hold', label: 'On Hold', isOpenStage: true },
  { value: 'Re-Engaged', label: 'Re-Engaged', isOpenStage: true },
  { value: 'Planned Nurture', label: 'Planned Nurture', isOpenStage: true },
  { value: 'Joined', label: 'Joined', isOpenStage: false },
  { value: 'Closed Lost', label: 'Closed Lost', isOpenStage: false },
];

const OPPORTUNITY_STAGE_COLORS: Record<string, string> = {
  Qualifying: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  Discovery: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  'Sales Process': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  Negotiating: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  Signed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  'On Hold': 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  'Re-Engaged': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  'Planned Nurture': 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-400',
  Joined: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  'Closed Lost': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export function RecruiterHubContent() {
  const { data: session } = useSession();
  const [permissions, setPermissions] = useState<UserPermissions | null>(null);

  useEffect(() => {
    if (session?.user?.email) {
      fetch('/api/auth/permissions')
        .then((res) => res.json())
        .then((data) => setPermissions(data))
        .catch(console.error);
    }
  }, [session?.user?.email]);

  const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager';
  const recruiterFilter = permissions?.recruiterFilter ?? null;

  const [prospects, setProspects] = useState<ProspectRecord[]>([]);
  const [prospectsLoading, setProspectsLoading] = useState(true);
  const defaultProspectFilters: ProspectFilters = {
    stages: [],
    statusOpen: true,
    statusClosed: false,
    externalAgencies: [],
  };
  const [prospectFilters, setProspectFilters] = useState<ProspectFilters>(defaultProspectFilters);
  const [prospectFiltersApplied, setProspectFiltersApplied] = useState<ProspectFilters>(defaultProspectFilters);
  const [prospectFiltersExpanded, setProspectFiltersExpanded] = useState(false);

  const defaultOpportunityFilters: OpportunityFilters = {
    stages: [...OPEN_OPPORTUNITY_STAGES_RH],
    sgms: [],
    statusOpen: true,
    statusClosed: false,
    externalAgencies: [],
  };
  const [opportunities, setOpportunities] = useState<OpportunityRecord[]>([]);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(true);
  const [opportunityFilters, setOpportunityFilters] = useState<OpportunityFilters>(defaultOpportunityFilters);
  const [opportunityFiltersApplied, setOpportunityFiltersApplied] = useState<OpportunityFilters>(defaultOpportunityFilters);
  const [opportunityFiltersExpanded, setOpportunityFiltersExpanded] = useState(false);

  const [externalAgencies, setExternalAgencies] = useState<string[]>([]);
  const [sgmOptions, setSgmOptions] = useState<string[]>([]);

  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  const [prospectSearch, setProspectSearch] = useState('');
  const [opportunitySearch, setOpportunitySearch] = useState('');

  const [prospectsPage, setProspectsPage] = useState(1);
  const [opportunitiesPage, setOpportunitiesPage] = useState(1);

  type SortDir = 'asc' | 'desc';
  const [prospectSortKey, setProspectSortKey] = useState<string | null>('advisor_name');
  const [prospectSortDir, setProspectSortDir] = useState<SortDir>('asc');
  const [opportunitySortKey, setOpportunitySortKey] = useState<string | null>('advisor_name');
  const [opportunitySortDir, setOpportunitySortDir] = useState<SortDir>('asc');

  useEffect(() => {
    if (isAdmin) {
      fetch('/api/recruiter-hub/external-agencies')
        .then((res) => res.json())
        .then((data) => setExternalAgencies(data.agencies || []))
        .catch(console.error);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetch('/api/recruiter-hub/opportunities')
      .then((res) => res.json())
      .then((data) => {
        const sgms = data.sgms || [];
        setSgmOptions(sgms);
        setOpportunityFilters((prev) => ({ ...prev, sgms }));
        setOpportunityFiltersApplied((prev) => ({ ...prev, sgms }));
      })
      .catch(console.error);
  }, []);

  const fetchProspects = useCallback(async () => {
    setProspectsLoading(true);
    try {
      const a = prospectFiltersApplied;
      const openOnly = a.statusOpen && !a.statusClosed;
      const closedOnly = a.statusClosed && !a.statusOpen;
      const response = await fetch('/api/recruiter-hub/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stages: a.stages.length > 0 ? a.stages : undefined,
          openOnly,
          closedOnly,
          externalAgencies:
            isAdmin && a.externalAgencies.length > 0 ? a.externalAgencies : undefined,
        }),
      });
      const data = await response.json();
      setProspects(data.records || []);
    } catch (error) {
      console.error('Failed to fetch prospects:', error);
    } finally {
      setProspectsLoading(false);
    }
  }, [prospectFiltersApplied, isAdmin]);

  const fetchOpportunities = useCallback(async () => {
    setOpportunitiesLoading(true);
    try {
      const a = opportunityFiltersApplied;
      const openOnly = a.statusOpen && !a.statusClosed;
      const closedOnly = a.statusClosed && !a.statusOpen;
      const response = await fetch('/api/recruiter-hub/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stages: a.stages.length > 0 ? a.stages : undefined,
          sgms: a.sgms.length > 0 ? a.sgms : undefined,
          openOnly,
          closedOnly,
          externalAgencies:
            isAdmin && a.externalAgencies.length > 0 ? a.externalAgencies : undefined,
        }),
      });
      const data = await response.json();
      setOpportunities(data.records || []);
    } catch (error) {
      console.error('Failed to fetch opportunities:', error);
    } finally {
      setOpportunitiesLoading(false);
    }
  }, [opportunityFiltersApplied, isAdmin]);

  useEffect(() => {
    fetchProspects();
  }, [fetchProspects]);

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  const filteredProspects = prospects.filter(
    (p) =>
      p.advisor_name?.toLowerCase().includes(prospectSearch.toLowerCase()) ||
      p.External_Agency__c?.toLowerCase().includes(prospectSearch.toLowerCase()) ||
      p.SGA_Owner_Name__c?.toLowerCase().includes(prospectSearch.toLowerCase())
  );

  const filteredOpportunities = opportunities.filter(
    (o) =>
      o.advisor_name?.toLowerCase().includes(opportunitySearch.toLowerCase()) ||
      o.External_Agency__c?.toLowerCase().includes(opportunitySearch.toLowerCase()) ||
      o.SGM_Owner_Name__c?.toLowerCase().includes(opportunitySearch.toLowerCase())
  );

  function getProspectStageLabel(p: ProspectRecord): string {
    return p.Conversion_Status === 'Closed'
      ? 'Closed Lost'
      : p.Full_Opportunity_ID__c
        ? 'Qualified'
        : p.TOF_Stage;
  }

  const sortedProspects = (() => {
    const key = prospectSortKey ?? 'advisor_name';
    const dir = prospectSortDir;
    const mult = dir === 'asc' ? 1 : -1;
    return [...filteredProspects].sort((a, b) => {
      let av: string | null | undefined;
      let bv: string | null | undefined;
      if (key === 'stage') {
        av = getProspectStageLabel(a);
        bv = getProspectStageLabel(b);
      } else {
        av = (a as unknown as Record<string, unknown>)[key] as string | null | undefined;
        bv = (b as unknown as Record<string, unknown>)[key] as string | null | undefined;
      }
      const aStr = (av ?? '').toString().toLowerCase();
      const bStr = (bv ?? '').toString().toLowerCase();
      return mult * (aStr < bStr ? -1 : aStr > bStr ? 1 : 0);
    });
  })();

  const sortedOpportunities = (() => {
    const key = opportunitySortKey ?? 'advisor_name';
    const dir = opportunitySortDir;
    const mult = dir === 'asc' ? 1 : -1;
    return [...filteredOpportunities].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[key] as string | null | undefined;
      const bv = (b as unknown as Record<string, unknown>)[key] as string | null | undefined;
      const aStr = (av ?? '').toString().toLowerCase();
      const bStr = (bv ?? '').toString().toLowerCase();
      return mult * (aStr < bStr ? -1 : aStr > bStr ? 1 : 0);
    });
  })();

  const prospectsTotalPages = Math.max(1, Math.ceil(sortedProspects.length / ROWS_PER_PAGE));
  const opportunitiesTotalPages = Math.max(1, Math.ceil(sortedOpportunities.length / ROWS_PER_PAGE));
  const paginatedProspects = sortedProspects.slice(
    (prospectsPage - 1) * ROWS_PER_PAGE,
    prospectsPage * ROWS_PER_PAGE
  );
  const paginatedOpportunities = sortedOpportunities.slice(
    (opportunitiesPage - 1) * ROWS_PER_PAGE,
    opportunitiesPage * ROWS_PER_PAGE
  );

  useEffect(() => {
    setProspectsPage(1);
  }, [prospectSearch, prospectFiltersApplied, prospectSortKey, prospectSortDir]);

  useEffect(() => {
    setOpportunitiesPage(1);
  }, [opportunitySearch, opportunityFiltersApplied, opportunitySortKey, opportunitySortDir]);

  function escapeCsvCell(value: string | null | undefined): string {
    const s = String(value ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function exportProspectsCsv() {
    const headers = ['Advisor', 'External Agency', 'SGA', 'Stage', 'Next Steps', 'Salesforce URL'];
    const rows = sortedProspects.map((p) => [
      escapeCsvCell(p.advisor_name),
      escapeCsvCell(p.External_Agency__c),
      escapeCsvCell(p.SGA_Owner_Name__c ?? ''),
      escapeCsvCell(getProspectStageLabel(p)),
      escapeCsvCell(p.Next_Steps__c ?? ''),
      escapeCsvCell(p.salesforce_url ?? ''),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recruiter-hub-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportOpportunitiesCsv() {
    const headers = ['Advisor', 'External Agency', 'SGM', 'Stage', 'Next Step', 'Salesforce URL'];
    const rows = sortedOpportunities.map((o) => [
      escapeCsvCell(o.advisor_name),
      escapeCsvCell(o.External_Agency__c),
      escapeCsvCell(o.SGM_Owner_Name__c ?? ''),
      escapeCsvCell(o.StageName),
      escapeCsvCell(o.NextStep ?? ''),
      escapeCsvCell(o.salesforce_url ?? ''),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recruiter-hub-opportunities-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleProspectSort(key: string) {
    if (prospectSortKey === key) {
      setProspectSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setProspectSortKey(key);
      setProspectSortDir('asc');
    }
  }

  function handleOpportunitySort(key: string) {
    if (opportunitySortKey === key) {
      setOpportunitySortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setOpportunitySortKey(key);
      setOpportunitySortDir('asc');
    }
  }

  const SortableTh = ({
    label,
    sortKey,
    currentKey,
    currentDir,
    onSort,
  }: {
    label: string;
    sortKey: string;
    currentKey: string | null;
    currentDir: SortDir;
    onSort: (key: string) => void;
  }) => (
    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1.5 hover:text-gray-700 dark:hover:text-gray-300 group w-full"
      >
        <span>{label}</span>
        <span className="flex flex-col opacity-60 group-hover:opacity-100">
          <ArrowUp
            className={`w-3.5 h-3.5 -mb-0.5 ${currentKey === sortKey && currentDir === 'asc' ? 'text-blue-600 dark:text-blue-400 opacity-100' : ''}`}
            aria-hidden
          />
          <ArrowDown
            className={`w-3.5 h-3.5 ${currentKey === sortKey && currentDir === 'desc' ? 'text-blue-600 dark:text-blue-400 opacity-100' : ''}`}
            aria-hidden
          />
        </span>
      </button>
    </th>
  );

  const EmptyState = ({ agencyName }: { agencyName?: string }) => (
    <div className="text-center py-12">
      <div className="text-gray-400 text-4xl mb-4">📋</div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
        No records found{agencyName ? ` for ${agencyName}` : ''}
      </h3>
      <p className="text-gray-500 dark:text-gray-400">
        If you believe this is an error, please contact your administrator.
      </p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <Title>Recruiter Hub</Title>
        <Text>
          {recruiterFilter
            ? `Viewing prospects and opportunities for ${recruiterFilter}`
            : 'Viewing all prospects and opportunities with external agencies'}
        </Text>
      </div>

      <Card>
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Prospects
              </h2>
              <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 rounded-full">
                {filteredProspects.length}
              </span>
            </div>
            <button
              onClick={exportProspectsCsv}
              disabled={filteredProspects.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Export all ({filteredProspects.length})
            </button>
          </div>

          {/* Prospects filters – pipeline style, apply on click */}
          {(() => {
            const prospectAgencyOptions = recruiterFilter ? [recruiterFilter] : externalAgencies;
            const prospectStagesSummary =
              prospectFiltersApplied.stages.length === 0
                ? 'All stages'
                : prospectFiltersApplied.stages.length === PROSPECT_STAGES.length
                  ? 'All stages'
                  : `${prospectFiltersApplied.stages.length} stages`;
            const prospectStatusSummary = prospectFiltersApplied.statusOpen && !prospectFiltersApplied.statusClosed
              ? 'Open'
              : !prospectFiltersApplied.statusOpen && prospectFiltersApplied.statusClosed
                ? 'Closed'
                : 'Open + Closed';
            const prospectAgencySummary =
              prospectFiltersApplied.externalAgencies.length === 0 || prospectFiltersApplied.externalAgencies.length === prospectAgencyOptions.length
                ? 'All agencies'
                : `${prospectFiltersApplied.externalAgencies.length} agencies`;
            const prospectHasPending =
              prospectFilters.stages.length !== prospectFiltersApplied.stages.length ||
              !prospectFilters.stages.every((s) => prospectFiltersApplied.stages.includes(s)) ||
              !prospectFiltersApplied.stages.every((s) => prospectFilters.stages.includes(s)) ||
              prospectFilters.statusOpen !== prospectFiltersApplied.statusOpen ||
              prospectFilters.statusClosed !== prospectFiltersApplied.statusClosed ||
              prospectFilters.externalAgencies.length !== prospectFiltersApplied.externalAgencies.length ||
              !prospectFilters.externalAgencies.every((a) => prospectFiltersApplied.externalAgencies.includes(a));
            return (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
                <button
                  type="button"
                  onClick={() => setProspectFiltersExpanded(!prospectFiltersExpanded)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Filter className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    <span className="text-base font-medium text-gray-700 dark:text-gray-300">Filters</span>
                    <span className="text-sm bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">{prospectStagesSummary}</span>
                    <span className="text-sm bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">{prospectStatusSummary}</span>
                    <span className="text-sm bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">{prospectAgencySummary}</span>
                    {prospectHasPending && <span className="text-sm text-blue-600 dark:text-blue-400">(Pending)</span>}
                  </div>
                  {prospectFiltersExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                </button>
                {prospectFiltersExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-base font-medium text-gray-700 dark:text-gray-300">Prospect Stage</label>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setProspectFilters((p) => ({ ...p, stages: [...PROSPECT_STAGES] }))} className="text-sm text-blue-600 dark:text-blue-400">All</button>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <button type="button" onClick={() => setProspectFilters((p) => ({ ...p, stages: [] }))} className="text-sm text-blue-600 dark:text-blue-400">Deselect All</button>
                          </div>
                        </div>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {PROSPECT_STAGES.map((stage) => {
                            const isSelected = prospectFilters.stages.includes(stage);
                            return (
                              <label key={stage} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'}`}>
                                  {isSelected && <Check className="w-4 h-4 text-white" />}
                                </div>
                                <input type="checkbox" checked={isSelected} onChange={() => setProspectFilters((p) => ({ ...p, stages: isSelected ? p.stages.filter((s) => s !== stage) : [...p.stages, stage] }))} className="sr-only" />
                                <span className={`text-base ${isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{stage}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Leave all unchecked for all stages</p>
                      </div>
                      <div>
                        <label className="text-base font-medium text-gray-700 dark:text-gray-300 mb-3 block">Status</label>
                        <div className="space-y-1">
                          {['Open', 'Closed'].map((status) => {
                            const isOpen = status === 'Open';
                            const isSelected = isOpen ? prospectFilters.statusOpen : prospectFilters.statusClosed;
                            return (
                              <label key={status} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-green-50 dark:bg-green-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-green-600 border-green-600' : 'border-gray-300 dark:border-gray-600'}`}>
                                  {isSelected && <Check className="w-4 h-4 text-white" />}
                                </div>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => setProspectFilters((p) => ({ ...p, [isOpen ? 'statusOpen' : 'statusClosed']: !isSelected }))}
                                  className="sr-only"
                                />
                                <span className={`text-base ${isSelected ? 'text-green-700 dark:text-green-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{status}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Default: Open only</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-base font-medium text-gray-700 dark:text-gray-300">External Agency</label>
                          {prospectAgencyOptions.length > 1 && (
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setProspectFilters((p) => ({ ...p, externalAgencies: [...prospectAgencyOptions] }))} className="text-sm text-blue-600 dark:text-blue-400">All</button>
                              <span className="text-gray-300 dark:text-gray-600">|</span>
                              <button type="button" onClick={() => setProspectFilters((p) => ({ ...p, externalAgencies: [] }))} className="text-sm text-blue-600 dark:text-blue-400">Deselect All</button>
                            </div>
                          )}
                        </div>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {prospectAgencyOptions.map((agency) => {
                            const isSelected = prospectFilters.externalAgencies.length === 0 || prospectFilters.externalAgencies.includes(agency);
                            return (
                              <label key={agency} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-purple-50 dark:bg-purple-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-purple-600 border-purple-600' : 'border-gray-300 dark:border-gray-600'}`}>
                                  {isSelected && <Check className="w-4 h-4 text-white" />}
                                </div>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {
                                    if (isSelected) setProspectFilters((p) => ({ ...p, externalAgencies: p.externalAgencies.length === 0 ? prospectAgencyOptions.filter((a) => a !== agency) : p.externalAgencies.filter((a) => a !== agency) }));
                                    else setProspectFilters((p) => ({ ...p, externalAgencies: p.externalAgencies.length === 0 ? [agency] : [...p.externalAgencies, agency] }));
                                  }}
                                  className="sr-only"
                                />
                                <span className={`text-base ${isSelected ? 'text-purple-700 dark:text-purple-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{agency}</span>
                              </label>
                            );
                          })}
                        </div>
                        {recruiterFilter && <p className="text-xs text-gray-500 mt-1">Recruiter: only your agency</p>}
                      </div>
                    </div>
                    <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 mt-4 bg-gray-50 dark:bg-gray-900 flex justify-between items-center">
                      <span className="text-base text-gray-500 dark:text-gray-400">{prospectHasPending ? 'Changes pending' : 'Filters applied'}</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setProspectFilters(defaultProspectFilters); setProspectFiltersApplied(defaultProspectFilters); fetchProspects(); }} className="px-4 py-2 text-base text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">Reset</button>
                        <button type="button" onClick={() => { setProspectFiltersApplied({ ...prospectFilters }); }} disabled={!prospectHasPending} className="px-5 py-2 text-base text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 disabled:cursor-not-allowed">Apply Filters</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={prospectSearch}
              onChange={(e) => setProspectSearch(e.target.value)}
              placeholder="Search prospects..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          {prospectsLoading ? (
            <div className="flex justify-center py-8">
              <Text>Loading...</Text>
            </div>
          ) : filteredProspects.length === 0 ? (
            <EmptyState agencyName={recruiterFilter || undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[34%]" />
                  <col className="w-[6%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <SortableTh label="Advisor" sortKey="advisor_name" currentKey={prospectSortKey} currentDir={prospectSortDir} onSort={handleProspectSort} />
                    <SortableTh label="External Agency" sortKey="External_Agency__c" currentKey={prospectSortKey} currentDir={prospectSortDir} onSort={handleProspectSort} />
                    <SortableTh label="SGA" sortKey="SGA_Owner_Name__c" currentKey={prospectSortKey} currentDir={prospectSortDir} onSort={handleProspectSort} />
                    <SortableTh label="Stage" sortKey="stage" currentKey={prospectSortKey} currentDir={prospectSortDir} onSort={handleProspectSort} />
                    <SortableTh label="Next Steps" sortKey="Next_Steps__c" currentKey={prospectSortKey} currentDir={prospectSortDir} onSort={handleProspectSort} />
                    <SortableTh label="SF" sortKey="salesforce_url" currentKey={prospectSortKey} currentDir={prospectSortDir} onSort={handleProspectSort} />
                  </tr>
                </thead>
                <tbody>
                  {paginatedProspects.map((prospect) => {
                    const stageLabel =
                      prospect.Conversion_Status === 'Closed'
                        ? 'Closed Lost'
                        : prospect.Full_Opportunity_ID__c
                          ? 'Qualified'
                          : prospect.TOF_Stage;

                    const stageClasses =
                      stageLabel === 'MQL'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                        : stageLabel === 'SQL'
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
                          : stageLabel === 'SQO'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                            : stageLabel === 'Qualified'
                              ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400'
                              : stageLabel === 'Closed Lost'
                                ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';

                    return (
                      <tr
                        key={prospect.primary_key}
                        onClick={() => setSelectedRecordId(prospect.primary_key)}
                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                      >
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white font-medium">
                          {prospect.advisor_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                          {prospect.External_Agency__c}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                          {prospect.SGA_Owner_Name__c || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${stageClasses}`}>
                            {stageLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 max-w-xs truncate">
                          {prospect.Next_Steps__c || '-'}
                        </td>
                        <td className="px-4 py-3">
                          {prospect.salesforce_url && (
                            <a
                              href={prospect.salesforce_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-blue-600 hover:text-blue-800"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredProspects.length > ROWS_PER_PAGE && (
                <div className="flex items-center justify-between py-4 px-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Showing {(prospectsPage - 1) * ROWS_PER_PAGE + 1}–
                    {Math.min(prospectsPage * ROWS_PER_PAGE, filteredProspects.length)} of {filteredProspects.length}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setProspectsPage((p) => Math.max(1, p - 1))}
                      disabled={prospectsPage <= 1}
                      className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      Page {prospectsPage} of {prospectsTotalPages}
                    </span>
                    <button
                      onClick={() => setProspectsPage((p) => Math.min(prospectsTotalPages, p + 1))}
                      disabled={prospectsPage >= prospectsTotalPages}
                      className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Opportunities
              </h2>
              <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 rounded-full">
                {filteredOpportunities.length}
              </span>
            </div>
            <button
              onClick={exportOpportunitiesCsv}
              disabled={filteredOpportunities.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Export all ({filteredOpportunities.length})
            </button>
          </div>

          {/* Opportunities filters – pipeline style, apply on click */}
          {(() => {
            const oppAgencyOptions = recruiterFilter ? [recruiterFilter] : externalAgencies;
            const oppStagesSummary =
              opportunityFiltersApplied.stages.length === 0
                ? 'All stages'
                : opportunityFiltersApplied.stages.length === ALL_OPPORTUNITY_STAGES_RH.length
                  ? 'All stages'
                  : OPEN_OPPORTUNITY_STAGES_RH.every((s) => opportunityFiltersApplied.stages.includes(s)) && opportunityFiltersApplied.stages.length === OPEN_OPPORTUNITY_STAGES_RH.length
                    ? 'Open stages'
                    : `${opportunityFiltersApplied.stages.length} stages`;
            const oppSgmsSummary =
              opportunityFiltersApplied.sgms.length === 0 || opportunityFiltersApplied.sgms.length === sgmOptions.length
                ? 'All SGMs'
                : `${opportunityFiltersApplied.sgms.length} SGMs`;
            const oppStatusSummary = opportunityFiltersApplied.statusOpen && !opportunityFiltersApplied.statusClosed
              ? 'Open'
              : !opportunityFiltersApplied.statusOpen && opportunityFiltersApplied.statusClosed
                ? 'Closed'
                : 'Open + Closed';
            const oppAgencySummary =
              opportunityFiltersApplied.externalAgencies.length === 0 || opportunityFiltersApplied.externalAgencies.length === oppAgencyOptions.length
                ? 'All agencies'
                : `${opportunityFiltersApplied.externalAgencies.length} agencies`;
            const oppHasPending =
              opportunityFilters.stages.length !== opportunityFiltersApplied.stages.length ||
              !opportunityFilters.stages.every((s) => opportunityFiltersApplied.stages.includes(s)) ||
              !opportunityFiltersApplied.stages.every((s) => opportunityFilters.stages.includes(s)) ||
              opportunityFilters.sgms.length !== opportunityFiltersApplied.sgms.length ||
              !opportunityFilters.sgms.every((s) => opportunityFiltersApplied.sgms.includes(s)) ||
              !opportunityFiltersApplied.sgms.every((s) => opportunityFilters.sgms.includes(s)) ||
              opportunityFilters.statusOpen !== opportunityFiltersApplied.statusOpen ||
              opportunityFilters.statusClosed !== opportunityFiltersApplied.statusClosed ||
              opportunityFilters.externalAgencies.length !== opportunityFiltersApplied.externalAgencies.length ||
              !opportunityFilters.externalAgencies.every((a) => opportunityFiltersApplied.externalAgencies.includes(a));
            return (
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
                <button
                  type="button"
                  onClick={() => setOpportunityFiltersExpanded(!opportunityFiltersExpanded)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Filter className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    <span className="text-base font-medium text-gray-700 dark:text-gray-300">Filters</span>
                    <span className="text-sm bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">{oppStagesSummary}</span>
                    <span className="text-sm bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">{oppSgmsSummary}</span>
                    <span className="text-sm bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">{oppStatusSummary}</span>
                    <span className="text-sm bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">{oppAgencySummary}</span>
                    {oppHasPending && <span className="text-sm text-blue-600 dark:text-blue-400">(Pending)</span>}
                  </div>
                  {opportunityFiltersExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                </button>
                {opportunityFiltersExpanded && (
                  <div className="border-t border-gray-200 dark:border-gray-700 p-4">
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-base font-medium text-gray-700 dark:text-gray-300">Stage</label>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setOpportunityFilters((p) => ({ ...p, stages: [...OPEN_OPPORTUNITY_STAGES_RH] }))} className="text-sm text-blue-600 dark:text-blue-400">Open stages</button>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <button type="button" onClick={() => setOpportunityFilters((p) => ({ ...p, stages: ALL_OPPORTUNITY_STAGES_RH.map((s) => s.value) }))} className="text-sm text-blue-600 dark:text-blue-400">All</button>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <button type="button" onClick={() => setOpportunityFilters((p) => ({ ...p, stages: [] }))} className="text-sm text-blue-600 dark:text-blue-400">Deselect All</button>
                          </div>
                        </div>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {ALL_OPPORTUNITY_STAGES_RH.map((stage) => {
                            const isSelected = opportunityFilters.stages.includes(stage.value);
                            return (
                              <label key={stage.value} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-600'}`}>
                                  {isSelected && <Check className="w-4 h-4 text-white" />}
                                </div>
                                <input type="checkbox" checked={isSelected} onChange={() => setOpportunityFilters((p) => ({ ...p, stages: isSelected ? p.stages.filter((s) => s !== stage.value) : [...p.stages, stage.value] }))} className="sr-only" />
                                <span className={`text-base ${isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{stage.label}</span>
                                {stage.isOpenStage && <span className="text-sm text-gray-400 dark:text-gray-500">(Open stage)</span>}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-base font-medium text-gray-700 dark:text-gray-300">SGM</label>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setOpportunityFilters((p) => ({ ...p, sgms: [...sgmOptions] }))} className="text-sm text-blue-600 dark:text-blue-400">All SGMs</button>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <button type="button" onClick={() => setOpportunityFilters((p) => ({ ...p, sgms: [] }))} className="text-sm text-blue-600 dark:text-blue-400">Deselect All</button>
                          </div>
                        </div>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {sgmOptions.map((sgm) => {
                            const isSelected = opportunityFilters.sgms.length === 0 || opportunityFilters.sgms.includes(sgm);
                            return (
                              <label key={sgm} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-green-50 dark:bg-green-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-green-600 border-green-600' : 'border-gray-300 dark:border-gray-600'}`}>
                                  {isSelected && <Check className="w-4 h-4 text-white" />}
                                </div>
                                <input type="checkbox" checked={isSelected} onChange={() => setOpportunityFilters((p) => ({ ...p, sgms: isSelected ? (p.sgms.length === 0 ? sgmOptions.filter((s) => s !== sgm) : p.sgms.filter((s) => s !== sgm)) : (p.sgms.length === 0 ? [sgm] : [...p.sgms, sgm]) }))} className="sr-only" />
                                <span className={`text-base ${isSelected ? 'text-green-700 dark:text-green-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{sgm}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Default: All SGMs</p>
                      </div>
                      <div>
                        <label className="text-base font-medium text-gray-700 dark:text-gray-300 mb-3 block">Status</label>
                        <div className="space-y-1">
                          {['Open', 'Closed'].map((status) => {
                            const isOpen = status === 'Open';
                            const isSelected = isOpen ? opportunityFilters.statusOpen : opportunityFilters.statusClosed;
                            return (
                              <label key={status} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-amber-50 dark:bg-amber-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-amber-600 border-amber-600' : 'border-gray-300 dark:border-gray-600'}`}>
                                  {isSelected && <Check className="w-4 h-4 text-white" />}
                                </div>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {
                                    setOpportunityFilters((p) => {
                                      const nextOpen = isOpen ? !p.statusOpen : p.statusOpen;
                                      const nextClosed = isOpen ? p.statusClosed : !p.statusClosed;
                                      let stages: string[];
                                      if (nextOpen && nextClosed) {
                                        stages = ALL_OPPORTUNITY_STAGES_RH.map((s) => s.value);
                                      } else if (nextOpen) {
                                        stages = [...OPEN_OPPORTUNITY_STAGES_RH];
                                      } else if (nextClosed) {
                                        stages = [...CLOSED_OPPORTUNITY_STAGES_RH];
                                      } else {
                                        stages = [...OPEN_OPPORTUNITY_STAGES_RH];
                                      }
                                      return { ...p, statusOpen: nextOpen, statusClosed: nextClosed, stages };
                                    });
                                  }}
                                  className="sr-only"
                                />
                                <span className={`text-base ${isSelected ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{status}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Open = open stages only; Closed = Joined + Closed Lost; both = all stages</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-base font-medium text-gray-700 dark:text-gray-300">External Agency</label>
                          {oppAgencyOptions.length > 1 && (
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setOpportunityFilters((p) => ({ ...p, externalAgencies: [] }))} className="text-sm text-blue-600 dark:text-blue-400">All</button>
                              <span className="text-gray-300 dark:text-gray-600">|</span>
                              <button type="button" onClick={() => setOpportunityFilters((p) => ({ ...p, externalAgencies: [...oppAgencyOptions] }))} className="text-sm text-blue-600 dark:text-blue-400">Deselect All</button>
                            </div>
                          )}
                        </div>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {oppAgencyOptions.map((agency) => {
                            const isSelected = opportunityFilters.externalAgencies.length === 0 || opportunityFilters.externalAgencies.includes(agency);
                            return (
                              <label key={agency} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-purple-50 dark:bg-purple-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-purple-600 border-purple-600' : 'border-gray-300 dark:border-gray-600'}`}>
                                  {isSelected && <Check className="w-4 h-4 text-white" />}
                                </div>
                                <input type="checkbox" checked={isSelected} onChange={() => { if (isSelected) setOpportunityFilters((p) => ({ ...p, externalAgencies: p.externalAgencies.length === 0 ? oppAgencyOptions.filter((a) => a !== agency) : p.externalAgencies.filter((a) => a !== agency) })); else setOpportunityFilters((p) => ({ ...p, externalAgencies: p.externalAgencies.length === 0 ? [agency] : [...p.externalAgencies, agency] })); }} className="sr-only" />
                                <span className={`text-base ${isSelected ? 'text-purple-700 dark:text-purple-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{agency}</span>
                              </label>
                            );
                          })}
                        </div>
                        {recruiterFilter && <p className="text-xs text-gray-500 mt-1">Recruiter: only your agency</p>}
                      </div>
                    </div>
                    <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 mt-4 bg-gray-50 dark:bg-gray-900 flex justify-between items-center">
                      <span className="text-base text-gray-500 dark:text-gray-400">{oppHasPending ? 'Changes pending' : 'Filters applied'}</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { const def = { ...defaultOpportunityFilters, sgms: sgmOptions.length ? [...sgmOptions] : [] }; setOpportunityFilters(def); setOpportunityFiltersApplied(def); fetchOpportunities(); }} className="px-4 py-2 text-base text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">Reset</button>
                        <button type="button" onClick={() => setOpportunityFiltersApplied({ ...opportunityFilters })} disabled={!oppHasPending} className="px-5 py-2 text-base text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 disabled:cursor-not-allowed">Apply Filters</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={opportunitySearch}
              onChange={(e) => setOpportunitySearch(e.target.value)}
              placeholder="Search opportunities..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          {opportunitiesLoading ? (
            <div className="flex justify-center py-8">
              <Text>Loading...</Text>
            </div>
          ) : filteredOpportunities.length === 0 ? (
            <EmptyState agencyName={recruiterFilter || undefined} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                  <col className="w-[14%]" />
                  <col className="w-[14%]" />
                  <col className="w-[34%]" />
                  <col className="w-[6%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <SortableTh label="Advisor" sortKey="advisor_name" currentKey={opportunitySortKey} currentDir={opportunitySortDir} onSort={handleOpportunitySort} />
                    <SortableTh label="External Agency" sortKey="External_Agency__c" currentKey={opportunitySortKey} currentDir={opportunitySortDir} onSort={handleOpportunitySort} />
                    <SortableTh label="SGM" sortKey="SGM_Owner_Name__c" currentKey={opportunitySortKey} currentDir={opportunitySortDir} onSort={handleOpportunitySort} />
                    <SortableTh label="Stage" sortKey="StageName" currentKey={opportunitySortKey} currentDir={opportunitySortDir} onSort={handleOpportunitySort} />
                    <SortableTh label="Next Step" sortKey="NextStep" currentKey={opportunitySortKey} currentDir={opportunitySortDir} onSort={handleOpportunitySort} />
                    <SortableTh label="SF" sortKey="salesforce_url" currentKey={opportunitySortKey} currentDir={opportunitySortDir} onSort={handleOpportunitySort} />
                  </tr>
                </thead>
                <tbody>
                  {paginatedOpportunities.map((opp) => (
                    <tr
                      key={opp.primary_key}
                      onClick={() => setSelectedRecordId(opp.primary_key)}
                      className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                    >
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white font-medium">
                        {opp.advisor_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {opp.External_Agency__c}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {opp.SGM_Owner_Name__c || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded ${
                            OPPORTUNITY_STAGE_COLORS[opp.StageName] ??
                            'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {opp.StageName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 max-w-xs truncate">
                        {opp.NextStep || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {opp.salesforce_url && (
                          <a
                            href={opp.salesforce_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredOpportunities.length > ROWS_PER_PAGE && (
                <div className="flex items-center justify-between py-4 px-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Showing {(opportunitiesPage - 1) * ROWS_PER_PAGE + 1}–
                    {Math.min(opportunitiesPage * ROWS_PER_PAGE, filteredOpportunities.length)} of {filteredOpportunities.length}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setOpportunitiesPage((p) => Math.max(1, p - 1))}
                      disabled={opportunitiesPage <= 1}
                      className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      Page {opportunitiesPage} of {opportunitiesTotalPages}
                    </span>
                    <button
                      onClick={() => setOpportunitiesPage((p) => Math.min(opportunitiesTotalPages, p + 1))}
                      disabled={opportunitiesPage >= opportunitiesTotalPages}
                      className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <RecordDetailModal
        isOpen={selectedRecordId !== null}
        onClose={() => setSelectedRecordId(null)}
        recordId={selectedRecordId}
      />
    </div>
  );
}
