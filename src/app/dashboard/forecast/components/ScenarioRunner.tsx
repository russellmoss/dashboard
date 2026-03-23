'use client';

import React, { useState } from 'react';
import { Card, Text } from '@tremor/react';
import { ChevronDown, ChevronUp, Play, Save, Loader2 } from 'lucide-react';
import { ForecastRates } from '@/lib/queries/forecast-rates';
import { ForecastSummary } from '@/lib/queries/forecast-pipeline';
import { MonteCarloResponse } from '@/lib/queries/forecast-monte-carlo';
import { dashboardApi } from '@/lib/api-client';

interface ScenarioRunnerProps {
  rates: ForecastRates | null;
  summary: ForecastSummary | null;
  monteCarloResults: MonteCarloResponse | null;
  onRunMonteCarlo: (rateOverrides: {
    sqo_to_sp: number;
    sp_to_neg: number;
    neg_to_signed: number;
    signed_to_joined: number;
  }) => Promise<void>;
  mcLoading: boolean;
}

export function ScenarioRunner({
  rates,
  summary,
  monteCarloResults,
  onRunMonteCarlo,
  mcLoading,
}: ScenarioRunnerProps) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Rate overrides — initialize from historical
  const [overrides, setOverrides] = useState({
    sqo_to_sp: rates?.sqo_to_sp ?? 0,
    sp_to_neg: rates?.sp_to_neg ?? 0,
    neg_to_signed: rates?.neg_to_signed ?? 0,
    signed_to_joined: rates?.signed_to_joined ?? 0,
  });

  // Update overrides when rates change
  React.useEffect(() => {
    if (rates) {
      setOverrides({
        sqo_to_sp: rates.sqo_to_sp,
        sp_to_neg: rates.sp_to_neg,
        neg_to_signed: rates.neg_to_signed,
        signed_to_joined: rates.signed_to_joined,
      });
    }
  }, [rates]);

  const handleRateChange = (key: keyof typeof overrides, value: string) => {
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      setOverrides(prev => ({ ...prev, [key]: parsed }));
    }
  };

  const handleRunAndSave = async () => {
    if (!name.trim() || !rates) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      await onRunMonteCarlo(overrides);

      // Wait for results to be available, then save
      const scenario = await dashboardApi.createScenario({
        name: name.trim(),
        description: description.trim() || null,
        isPublic,
        rateOverride_sqo_to_sp: overrides.sqo_to_sp,
        rateOverride_sp_to_neg: overrides.sp_to_neg,
        rateOverride_neg_to_signed: overrides.neg_to_signed,
        rateOverride_signed_to_joined: overrides.signed_to_joined,
        avgDaysOverride_in_sp: rates.avg_days_in_sp,
        avgDaysOverride_in_neg: rates.avg_days_in_neg,
        avgDaysOverride_in_signed: rates.avg_days_in_signed,
        historicalRate_sqo_to_sp: rates.sqo_to_sp,
        historicalRate_sp_to_neg: rates.sp_to_neg,
        historicalRate_neg_to_signed: rates.neg_to_signed,
        historicalRate_signed_to_joined: rates.signed_to_joined,
        pipelineOppCount: summary?.total_opps ?? null,
        pipelineTotalAum: summary?.pipeline_total_aum ?? null,
        quartersJson: monteCarloResults?.quarters ?? null,
      });
      setSaveStatus(`Saved! Share: /dashboard/forecast?scenario=${scenario.shareToken}`);
    } catch (err) {
      setSaveStatus('Save failed');
    } finally {
      setSaving(false);
    }
  };

  const RATE_FIELDS: { key: keyof typeof overrides; label: string }[] = [
    { key: 'sqo_to_sp', label: 'SQO → SP' },
    { key: 'sp_to_neg', label: 'SP → Neg' },
    { key: 'neg_to_signed', label: 'Neg → Signed' },
    { key: 'signed_to_joined', label: 'Signed → Joined' },
  ];

  return (
    <Card className="p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full"
      >
        <Text className="font-semibold">Scenario Runner</Text>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Name & Description */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Scenario Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Q2 Optimistic"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional notes"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
            </div>
          </div>

          {/* Rate overrides */}
          <div>
            <Text className="text-sm font-medium mb-2">Rate Overrides</Text>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {RATE_FIELDS.map(field => (
                <div key={field.key}>
                  <label className="block text-xs text-gray-500 mb-1">{field.label}</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 font-mono">
                      {rates ? (rates[field.key as keyof ForecastRates] as number * 100).toFixed(1) : '-'}%
                    </span>
                    <span className="text-gray-400">→</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={overrides[field.key]}
                      onChange={e => handleRateChange(field.key, e.target.value)}
                      className="w-20 px-2 py-1 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Public checkbox */}
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={e => setIsPublic(e.target.checked)}
              className="rounded border-gray-300"
            />
            Public (visible to all users)
          </label>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleRunAndSave}
              disabled={!name.trim() || mcLoading || saving}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving || mcLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Run & Save
            </button>
            <button
              onClick={() => onRunMonteCarlo(overrides)}
              disabled={mcLoading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              Run without saving
            </button>
          </div>

          {saveStatus && (
            <p className={`text-sm ${saveStatus.startsWith('Saved') ? 'text-green-600' : 'text-red-600'}`}>
              {saveStatus}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
