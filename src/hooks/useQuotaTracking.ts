'use client';

import { useState, useEffect, useCallback } from 'react';
import { dashboardApi } from '@/lib/api-client';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/sga-hub-helpers';
import {
  SGMQuotaProgress, SGMOpenOpp, SGMHistoricalQuarter,
  SGMAdminBreakdown, SGMTeamProgress, SGMQuotaEntry, SGMQuotaFilters,
  SGMHubTab,
} from '@/types/sgm-hub';

function generateQuarterOptions(): Array<{ value: string; label: string }> {
  const now = new Date();
  const currentYear = now.getFullYear();
  const options: Array<{ value: string; label: string }> = [];
  for (let year = currentYear - 1; year <= currentYear + 1; year++) {
    for (let q = 1; q <= 4; q++) {
      const value = `${year}-Q${q}`;
      const info = getQuarterInfo(value);
      options.push({ value, label: info.label });
    }
  }
  return options;
}

export function useQuotaTracking(
  isAdmin: boolean,
  isSGM: boolean,
  currentUserSgmName: string | null,
  activeTab: SGMHubTab,
) {
  // SGM view state
  const [quotaQuarter, setQuotaQuarter] = useState<string>(getCurrentQuarter());
  const [quotaProgress, setQuotaProgress] = useState<SGMQuotaProgress | null>(null);
  const [quotaProgressLoading, setQuotaProgressLoading] = useState(false);
  const [historicalQuarters, setHistoricalQuarters] = useState<SGMHistoricalQuarter[]>([]);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [openOpps, setOpenOpps] = useState<SGMOpenOpp[]>([]);
  const [openOppsLoading, setOpenOppsLoading] = useState(false);

  // Admin view state
  const [adminBreakdown, setAdminBreakdown] = useState<SGMAdminBreakdown[]>([]);
  const [adminBreakdownLoading, setAdminBreakdownLoading] = useState(false);
  const [teamProgress, setTeamProgress] = useState<SGMTeamProgress | null>(null);
  const [quotas, setQuotas] = useState<SGMQuotaEntry[]>([]);
  const [quotasLoading, setQuotasLoading] = useState(false);
  const [quotaFilters, setQuotaFilters] = useState<SGMQuotaFilters>({
    quarter: getCurrentQuarter(),
  });
  const [quotaYear, setQuotaYear] = useState<number>(new Date().getFullYear());

  const quarterOptions = generateQuarterOptions();

  // SGM view fetch functions
  const fetchQuotaProgress = useCallback(async () => {
    if (!currentUserSgmName) return;
    setQuotaProgressLoading(true);
    try {
      const { progress } = await dashboardApi.getSGMQuotaProgress(currentUserSgmName, quotaQuarter);
      setQuotaProgress(progress);
    } catch (err) {
      console.error('Error fetching quota progress:', err);
    } finally {
      setQuotaProgressLoading(false);
    }
  }, [currentUserSgmName, quotaQuarter]);

  const fetchHistoricalQuarters = useCallback(async () => {
    if (!currentUserSgmName) return;
    setHistoricalLoading(true);
    try {
      const { quarters } = await dashboardApi.getSGMHistoricalQuarters(currentUserSgmName, 8);
      setHistoricalQuarters(quarters);
    } catch (err) {
      console.error('Error fetching historical quarters:', err);
    } finally {
      setHistoricalLoading(false);
    }
  }, [currentUserSgmName]);

  const fetchOpenOpps = useCallback(async () => {
    if (!currentUserSgmName) return;
    setOpenOppsLoading(true);
    try {
      const { opps } = await dashboardApi.getSGMOpenOpps(currentUserSgmName);
      setOpenOpps(opps);
    } catch (err) {
      console.error('Error fetching open opps:', err);
    } finally {
      setOpenOppsLoading(false);
    }
  }, [currentUserSgmName]);

  // Admin view fetch functions
  const fetchAdminBreakdown = useCallback(async () => {
    setAdminBreakdownLoading(true);
    try {
      const { breakdown } = await dashboardApi.getSGMAdminBreakdown(quotaFilters);
      setAdminBreakdown(breakdown);
    } catch (err) {
      console.error('Error fetching admin breakdown:', err);
    } finally {
      setAdminBreakdownLoading(false);
    }
  }, [quotaFilters]);

  const fetchTeamProgress = useCallback(async () => {
    try {
      const { progress } = await dashboardApi.getSGMTeamProgress(quotaFilters.quarter);
      setTeamProgress(progress);
    } catch (err) {
      console.error('Error fetching team progress:', err);
    }
  }, [quotaFilters.quarter]);

  const fetchQuotas = useCallback(async () => {
    setQuotasLoading(true);
    try {
      const { quotas: data } = await dashboardApi.getSGMQuotas(String(quotaYear));
      setQuotas(data);
    } catch (err) {
      console.error('Error fetching quotas:', err);
    } finally {
      setQuotasLoading(false);
    }
  }, [quotaYear]);

  // Quota tracking data fetch effect
  useEffect(() => {
    if (activeTab !== 'quota-tracking') return;

    if (isAdmin) {
      fetchAdminBreakdown();
      fetchTeamProgress();
      fetchQuotas();
    } else if (isSGM && currentUserSgmName) {
      fetchQuotaProgress();
      fetchHistoricalQuarters();
      fetchOpenOpps();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, quotaQuarter, quotaFilters]);

  // Quota year change → refetch quota table
  useEffect(() => {
    if (activeTab !== 'quota-tracking' || !isAdmin) return;
    fetchQuotas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotaYear]);

  // Handler: save quota (optimistic update)
  const handleQuotaSave = async (data: { userEmail: string; quarter: string; arrGoal: number }) => {
    setQuotas(prev => prev.map(q =>
      q.userEmail === data.userEmail && q.quarter === data.quarter
        ? { ...q, arrGoal: data.arrGoal }
        : q
    ));
    try {
      await dashboardApi.saveSGMQuota(data);
    } catch (err) {
      console.error('Error saving quota:', err);
      fetchQuotas();
    }
  };

  return {
    // SGM view
    quotaQuarter,
    setQuotaQuarter,
    quotaProgress,
    quotaProgressLoading,
    historicalQuarters,
    historicalLoading,
    openOpps,
    openOppsLoading,
    // Admin view
    adminBreakdown,
    adminBreakdownLoading,
    teamProgress,
    quotas,
    quotasLoading,
    quotaFilters,
    setQuotaFilters,
    quotaYear,
    setQuotaYear,
    // Handlers
    handleQuotaSave,
    // Options
    quarterOptions,
  };
}
