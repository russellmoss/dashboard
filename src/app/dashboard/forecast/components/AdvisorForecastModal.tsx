'use client';

import React, { useEffect, useState } from 'react';
import { X, ExternalLink, Calendar, Loader2 } from 'lucide-react';
import { dashboardApi } from '@/lib/api-client';

interface AdvisorForecastModalProps {
  isOpen: boolean;
  onClose: () => void;
  oppId: string | null;
}

interface ForecastRecord {
  Full_Opportunity_ID__c: string;
  advisor_name: string;
  salesforce_url: string;
  SGM_Owner_Name__c: string | null;
  SGA_Owner_Name__c: string | null;
  StageName: string;
  days_in_current_stage: number;
  Opportunity_AUM_M: number;
  aum_tier: string;
  is_zero_aum: boolean;
  p_join: number;
  expected_days_remaining: number;
  model_projected_join_date: string | null;
  Earliest_Anticipated_Start_Date__c: string | null;
  final_projected_join_date: string | null;
  date_source: string;
  is_q2_2026: boolean;
  is_q3_2026: boolean;
  expected_aum_q2: number;
  expected_aum_q3: number;
  // Audit fields
  Date_Became_SQO__c: string | null;
  Stage_Entered_Sales_Process__c: string | null;
  Stage_Entered_Negotiating__c: string | null;
  Stage_Entered_Signed__c: string | null;
  Stage_Entered_Joined__c: string | null;
  eff_sp_ts: string | null;
  eff_neg_ts: string | null;
  eff_signed_ts: string | null;
  eff_joined_ts: string | null;
  stages_skipped: number;
  Original_source: string | null;
  Finance_View__c: string | null;
  rate_sqo_to_sp: number | null;
  rate_sp_to_neg: number | null;
  rate_neg_to_signed: number | null;
  rate_signed_to_joined: number | null;
}

const STAGE_TIMELINE = [
  { key: 'SQO', rawField: 'Date_Became_SQO__c', effField: null },
  { key: 'SP', rawField: 'Stage_Entered_Sales_Process__c', effField: 'eff_sp_ts' },
  { key: 'Neg', rawField: 'Stage_Entered_Negotiating__c', effField: 'eff_neg_ts' },
  { key: 'Signed', rawField: 'Stage_Entered_Signed__c', effField: 'eff_signed_ts' },
  { key: 'Joined', rawField: 'Stage_Entered_Joined__c', effField: 'eff_joined_ts' },
];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return dateStr.substring(0, 10);
}

export function AdvisorForecastModal({ isOpen, onClose, oppId }: AdvisorForecastModalProps) {
  const [record, setRecord] = useState<ForecastRecord | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && oppId) {
      setLoading(true);
      dashboardApi.getForecastRecord(oppId)
        .then(({ record: r }) => setRecord(r as ForecastRecord))
        .catch(err => console.error('Failed to load forecast record:', err))
        .finally(() => setLoading(false));
    }
    if (!isOpen) {
      setRecord(null);
    }
  }, [isOpen, oppId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 pt-16">
        <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between z-10">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {loading ? 'Loading...' : record?.advisor_name || 'Advisor Forecast'}
              </h3>
              {record && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {record.StageName} | {record.aum_tier}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {record?.salesforce_url && (
                <a
                  href={record.salesforce_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-gray-400 hover:text-blue-600 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-4 space-y-6">
            {loading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            ) : record ? (
              <>
                {/* Forecast Summary */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                    Forecast Summary
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500">P(Join)</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        {(record.p_join * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500">AUM</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        ${record.Opportunity_AUM_M.toFixed(1)}M
                      </p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Projected Join Date</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {formatDate(record.final_projected_join_date)}
                        {record.date_source === 'Anticipated' && (
                          <span className="ml-1 text-xs text-purple-600">(Anticipated)</span>
                        )}
                      </p>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Days in Stage</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        {record.days_in_current_stage}d
                      </p>
                    </div>
                  </div>
                </div>

                {/* Stage Journey Timeline */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                    <Calendar className="w-4 h-4 inline mr-1" />
                    Stage Journey
                  </h4>
                  <div className="space-y-2">
                    {STAGE_TIMELINE.map((stage, i) => {
                      const rawTs = record[stage.rawField as keyof ForecastRecord] as string | null;
                      const effTs = stage.effField
                        ? (record[stage.effField as keyof ForecastRecord] as string | null)
                        : rawTs;
                      const isBackfilled = !rawTs && !!effTs;
                      const isCurrent = record.StageName === (
                        stage.key === 'SP' ? 'Sales Process' :
                        stage.key === 'Neg' ? 'Negotiating' :
                        stage.key
                      );

                      return (
                        <div
                          key={stage.key}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                            isCurrent
                              ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
                              : 'bg-gray-50 dark:bg-gray-800'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                            effTs
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                          }`}>
                            {i + 1}
                          </div>
                          <div className="flex-1">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {stage.key}
                            </span>
                            {isCurrent && (
                              <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">(current)</span>
                            )}
                          </div>
                          <div className="text-right">
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              {formatDate(effTs || rawTs)}
                            </span>
                            {isBackfilled && (
                              <span className="block text-xs italic text-gray-400">(backfilled)</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Opportunity Detail */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                    Opportunity Detail
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {[
                      ['SGM', record.SGM_Owner_Name__c],
                      ['SGA', record.SGA_Owner_Name__c],
                      ['Source', record.Original_source],
                      ['Channel', record.Finance_View__c],
                      ['Stages Skipped', String(record.stages_skipped)],
                      ['Expected Days Remaining', `${record.expected_days_remaining}d`],
                    ].map(([label, value]) => (
                      <div key={label as string} className="flex justify-between py-1">
                        <span className="text-gray-500">{label}</span>
                        <span className="text-gray-900 dark:text-gray-100 font-medium">{value || '-'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-gray-500 text-center py-8">Record not found</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
