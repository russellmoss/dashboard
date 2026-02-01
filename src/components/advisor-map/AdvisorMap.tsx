'use client';

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { MapPin, Users, Target, AlertCircle, RefreshCw, Search, X } from 'lucide-react';
import { AdvisorLocation, AdvisorLocationStats, AdvisorLocationFilters } from '@/lib/queries/advisor-locations';
import { AdvisorDrillDownModal, DrillDownType } from './AdvisorDrillDownModal';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';

// Dynamic import for SSR safety - Leaflet requires window object
const AdvisorMapClient = dynamic(
  () => import('./AdvisorMapClient').then(mod => mod.AdvisorMapClient),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[500px] bg-gray-100 dark:bg-gray-800 rounded-lg">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Loading map...</span>
        </div>
      </div>
    ),
  }
);

interface AdvisorMapProps {
  filters?: AdvisorLocationFilters;
}

interface StatsCardProps {
  icon: React.ElementType;
  label: string;
  value: number;
  subValue?: string;
  color?: string;
  onClick?: () => void;
}

const COLOR_CLASSES: Record<string, string> = {
  blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
  green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
  orange: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400',
  gray: 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
};

function StatsCard({ icon: Icon, label, value, subValue, color = 'blue', onClick }: StatsCardProps) {
  const colorClasses = COLOR_CLASSES[color] || COLOR_CLASSES.blue;

  return (
    <button
      onClick={onClick}
      className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 w-full text-left hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all cursor-pointer"
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorClasses}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-xl font-semibold text-gray-900 dark:text-white">{value.toLocaleString()}</p>
          {subValue && (
            <p className="text-xs text-gray-400 dark:text-gray-500">{subValue}</p>
          )}
        </div>
      </div>
    </button>
  );
}

export function AdvisorMap({ filters }: AdvisorMapProps) {
  const [advisors, setAdvisors] = useState<AdvisorLocation[]>([]);
  const [stats, setStats] = useState<AdvisorLocationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('');

  // Drill-down modal state
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownType, setDrillDownType] = useState<DrillDownType>('all');
  const [drillDownTitle, setDrillDownTitle] = useState('');

  // Refresh counter to trigger re-fetch
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Record detail modal state (for viewing from map popup)
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [showRecordDetail, setShowRecordDetail] = useState(false);

  // Serialize filters to a stable string for dependency comparison
  const filtersKey = JSON.stringify(filters || {});

  // Handler for opening drill-down modal
  const openDrillDown = (type: DrillDownType, title: string) => {
    setDrillDownType(type);
    setDrillDownTitle(title);
    setDrillDownOpen(true);
  };

  // Get unique states for the dropdown
  const uniqueStates = useMemo(() => {
    const states = new Set<string>();
    advisors.forEach(a => {
      if (a.state) states.add(a.state);
    });
    return Array.from(states).sort();
  }, [advisors]);

  // Filter advisors based on search and state
  const filteredAdvisors = useMemo(() => {
    return advisors.filter(advisor => {
      // Must have coordinates
      if (advisor.lat === null || advisor.lng === null) return false;

      // Search filter (name or city)
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const nameMatch = advisor.advisorName?.toLowerCase().includes(query);
        const cityMatch = advisor.city?.toLowerCase().includes(query);
        if (!nameMatch && !cityMatch) return false;
      }

      // State filter
      if (stateFilter && advisor.state !== stateFilter) return false;

      return true;
    });
  }, [advisors, searchQuery, stateFilter]);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/advisor-map/locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters: filters || {} }),
        });

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.status}`);
        }

        const data = await response.json();
        if (cancelled) return;

        setAdvisors(data.advisors);
        setStats(data.stats);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load advisor locations');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [filtersKey, refreshCounter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Function to refresh data (called after override is saved)
  const handleRefresh = () => {
    setRefreshCounter((c) => c + 1);
  };

  // Handler for viewing record details from map popup
  const handleViewDetails = (primaryKey: string) => {
    setSelectedRecordId(primaryKey);
    setShowRecordDetail(true);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-lg" />
                <div className="space-y-2">
                  <div className="w-20 h-3 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div className="w-16 h-6 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="h-[500px] bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse flex items-center justify-center">
          <RefreshCw className="w-8 h-8 text-gray-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[500px] bg-red-50 dark:bg-red-900/20 rounded-lg">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-2" />
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            icon={Users}
            label="Total Advisors"
            value={stats.total}
            color="blue"
            onClick={() => openDrillDown('all', 'All Joined Advisors')}
          />
          <StatsCard
            icon={MapPin}
            label="Mapped"
            value={stats.withCoords}
            subValue={`${Math.round((stats.withCoords / stats.total) * 100)}% coverage`}
            color="green"
            onClick={() => openDrillDown('mapped', 'Mapped Advisors')}
          />
          <StatsCard
            icon={Target}
            label="Street-Level"
            value={stats.accuracyBreakdown.rooftop + stats.accuracyBreakdown.rangeInterpolated}
            subValue="Precise location"
            color="blue"
            onClick={() => openDrillDown('street-level', 'Street-Level Advisors')}
          />
          <StatsCard
            icon={MapPin}
            label="City-Level"
            value={stats.accuracyBreakdown.approximate + stats.accuracyBreakdown.geometricCenter}
            subValue="City center"
            color="orange"
            onClick={() => openDrillDown('city-level', 'City-Level Advisors')}
          />
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* State Filter */}
          <div className="w-48">
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All States</option>
              {uniqueStates.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </select>
          </div>

          {/* Results Count Badge */}
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium">
              {filteredAdvisors.length} advisor{filteredAdvisors.length !== 1 ? 's' : ''}
            </span>
            {(searchQuery || stateFilter) && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStateFilter('');
                }}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            Advisor Locations
          </h2>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span className="text-gray-600 dark:text-gray-400">Street-level</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="text-gray-600 dark:text-gray-400">City-level</span>
            </div>
          </div>
        </div>
        <div className="h-[500px]">
          <AdvisorMapClient
            advisors={filteredAdvisors}
            onViewDetails={handleViewDetails}
          />
        </div>
      </div>

      {/* Record Detail Modal (from map popup) */}
      <RecordDetailModal
        isOpen={showRecordDetail}
        onClose={() => {
          setShowRecordDetail(false);
          setSelectedRecordId(null);
        }}
        recordId={selectedRecordId}
      />

      {/* Drill-down Modal */}
      <AdvisorDrillDownModal
        isOpen={drillDownOpen}
        onClose={() => setDrillDownOpen(false)}
        drillDownType={drillDownType}
        advisors={advisors}
        title={drillDownTitle}
        onRefresh={handleRefresh}
      />
    </div>
  );
}
