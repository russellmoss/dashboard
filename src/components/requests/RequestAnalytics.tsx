'use client';

import { useState, useEffect } from 'react';
import {
  BarChart3,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  FileText,
  Bug,
  Users,
} from 'lucide-react';
import { dashboardRequestsApi } from '@/lib/api-client';
import {
  STATUS_LABELS,
  STATUS_COLORS,
  TYPE_LABELS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  RequestStatus,
  RequestType,
  RequestPriority,
} from '@/types/dashboard-request';

interface AnalyticsData {
  totalRequests: number;
  averageResolutionDays: number | null;
  thisMonth: {
    featureRequests: number;
    dataErrors: number;
    resolved: number;
  };
  byStatus: Array<{ status: RequestStatus; count: number }>;
  byType: Array<{ type: RequestType; count: number }>;
  byPriority: Array<{ priority: RequestPriority | null; count: number }>;
  recentActivity: {
    submissions: number;
    resolutions: number;
  };
  topSubmitters: Array<{ name: string; count: number }>;
}

export function RequestAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await dashboardRequestsApi.getAnalytics();
      setData(result);
    } catch (err: any) {
      console.error('Failed to fetch analytics:', err);
      setError(err.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <button
          onClick={fetchAnalytics}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Request Analytics
        </h2>
        <button
          onClick={fetchAnalytics}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Requests"
          value={data.totalRequests}
          icon={FileText}
          color="blue"
        />
        <MetricCard
          title="Avg. Resolution Time"
          value={data.averageResolutionDays !== null ? `${data.averageResolutionDays} days` : 'N/A'}
          icon={Clock}
          color="purple"
        />
        <MetricCard
          title="Resolved (Last 7 Days)"
          value={data.recentActivity.resolutions}
          icon={CheckCircle}
          color="green"
        />
        <MetricCard
          title="New (Last 7 Days)"
          value={data.recentActivity.submissions}
          icon={TrendingUp}
          color="orange"
        />
      </div>

      {/* This Month Stats */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-md font-medium text-gray-900 dark:text-white mb-4">
          This Month
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
            <FileText className="w-6 h-6 text-indigo-600 dark:text-indigo-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {data.thisMonth.featureRequests}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Feature Requests</p>
          </div>
          <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <Bug className="w-6 h-6 text-red-600 dark:text-red-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-red-600 dark:text-red-400">
              {data.thisMonth.dataErrors}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Data Errors</p>
          </div>
          <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 mx-auto mb-2" />
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {data.thisMonth.resolved}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Resolved</p>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Status */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-md font-medium text-gray-900 dark:text-white mb-4">
            By Status
          </h3>
          <div className="space-y-3">
            {data.byStatus.map((item) => {
              const total = data.totalRequests || 1;
              const percentage = Math.round((item.count / total) * 100);
              const colors = STATUS_COLORS[item.status];
              return (
                <div key={item.status}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-700 dark:text-gray-300">
                      {STATUS_LABELS[item.status]}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {item.count} ({percentage}%)
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${colors.bg}`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* By Type */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-md font-medium text-gray-900 dark:text-white mb-4">
            By Type
          </h3>
          <div className="space-y-3">
            {data.byType.map((item) => {
              const total = data.totalRequests || 1;
              const percentage = Math.round((item.count / total) * 100);
              const isFeature = item.type === 'FEATURE_REQUEST';
              return (
                <div key={item.type}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-700 dark:text-gray-300">
                      {TYPE_LABELS[item.type]}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {item.count} ({percentage}%)
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${isFeature ? 'bg-indigo-500' : 'bg-red-500'}`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Priority */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-md font-medium text-gray-900 dark:text-white mb-4">
            By Priority
          </h3>
          <div className="space-y-3">
            {data.byPriority.map((item) => {
              const total = data.totalRequests || 1;
              const percentage = Math.round((item.count / total) * 100);
              const label = item.priority ? PRIORITY_LABELS[item.priority] : 'No Priority';
              const colors = item.priority ? PRIORITY_COLORS[item.priority] : { bg: 'bg-gray-400' };
              return (
                <div key={item.priority || 'none'}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-700 dark:text-gray-300">{label}</span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {item.count} ({percentage}%)
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${colors.bg}`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top Submitters */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-md font-medium text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Users className="w-5 h-5" />
            Top Submitters (This Month)
          </h3>
          {data.topSubmitters.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">
              No submissions this month
            </p>
          ) : (
            <div className="space-y-2">
              {data.topSubmitters.map((submitter, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 flex items-center justify-center bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 text-xs font-bold rounded-full">
                      {index + 1}
                    </span>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {submitter.name}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {submitter.count} request{submitter.count !== 1 ? 's' : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Metric Card Component
interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color: 'blue' | 'green' | 'purple' | 'orange';
}

function MetricCard({ title, value, icon: Icon, color }: MetricCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    orange: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}
