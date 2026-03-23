'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, Text } from '@tremor/react';
import { ChevronDown, ChevronUp, Trash2, Share2, Eye } from 'lucide-react';
import { dashboardApi } from '@/lib/api-client';

interface Scenario {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  createdByName: string;
  createdById: string;
  shareToken: string;
  isPublic: boolean;
  rateOverride_sqo_to_sp: number;
  rateOverride_sp_to_neg: number;
  rateOverride_neg_to_signed: number;
  rateOverride_signed_to_joined: number;
  q2_p10_aum: number | null;
  q2_p50_aum: number | null;
  q2_p90_aum: number | null;
  q3_p10_aum: number | null;
  q3_p50_aum: number | null;
  q3_p90_aum: number | null;
  trialCount: number;
  pipelineOppCount: number | null;
  pipelineTotalAum: number | null;
}

interface SavedScenariosListProps {
  canRunScenarios: boolean;
  onLoadScenario: (scenario: Scenario) => void;
}

function formatAum(value: number | null): string {
  if (!value) return '-';
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

export function SavedScenariosList({ canRunScenarios, onLoadScenario }: SavedScenariosListProps) {
  const [expanded, setExpanded] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const fetchScenarios = useCallback(async () => {
    setLoading(true);
    try {
      const { scenarios: data } = await dashboardApi.getScenarios();
      setScenarios(data as Scenario[]);
    } catch (err) {
      console.error('Failed to load scenarios:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded) {
      fetchScenarios();
    }
  }, [expanded, fetchScenarios]);

  const handleDelete = async (id: string) => {
    try {
      await dashboardApi.deleteScenario(id);
      setScenarios(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error('Failed to delete scenario:', err);
    }
  };

  const handleShare = (shareToken: string) => {
    const url = `${window.location.origin}/dashboard/forecast?scenario=${shareToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopyStatus('Link copied!');
      setTimeout(() => setCopyStatus(null), 2000);
    });
  };

  return (
    <Card className="p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          <Text className="font-semibold">Saved Scenarios</Text>
          {scenarios.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 rounded-full">
              {scenarios.length}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="mt-4">
          {copyStatus && (
            <p className="text-sm text-green-600 mb-2">{copyStatus}</p>
          )}

          {loading ? (
            <div className="h-20 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg" />
          ) : scenarios.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No saved scenarios yet</p>
          ) : (
            <div className="space-y-3">
              {scenarios.map(scenario => (
                <div
                  key={scenario.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-3"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                        {scenario.name}
                      </span>
                      <span className="ml-2 text-xs text-gray-500">
                        by {scenario.createdByName} on{' '}
                        {new Date(scenario.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onLoadScenario(scenario)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                        title="Load scenario"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleShare(scenario.shareToken)}
                        className="p-1.5 text-gray-400 hover:text-green-600 transition-colors"
                        title="Copy share link"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                      {canRunScenarios && (
                        <button
                          onClick={() => handleDelete(scenario.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                          title="Delete scenario"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {scenario.description && (
                    <p className="text-xs text-gray-500 mb-2">{scenario.description}</p>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div>
                      <span className="text-gray-500">Q2 P50:</span>{' '}
                      <span className="font-mono">{formatAum(scenario.q2_p50_aum)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Q3 P50:</span>{' '}
                      <span className="font-mono">{formatAum(scenario.q3_p50_aum)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Opps:</span>{' '}
                      <span className="font-mono">{scenario.pipelineOppCount ?? '-'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Trials:</span>{' '}
                      <span className="font-mono">{scenario.trialCount.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
