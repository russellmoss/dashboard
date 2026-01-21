'use client';

import React, { useState, useEffect } from 'react';
import { X, Save, Star } from 'lucide-react';
import { Button } from '@tremor/react';
import { DashboardFilters } from '@/types/filters';
import { ViewMode } from '@/types/dashboard';
import {
  FeatureSelection,
  DEFAULT_FEATURE_SELECTION,
  SavedReport,
  getEffectiveFeatureSelection,
} from '@/types/saved-reports';

interface SaveReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    name: string,
    description: string,
    filters: DashboardFilters,
    featureSelection: FeatureSelection,
    viewMode: ViewMode,
    isDefault: boolean,
    isAdminTemplate: boolean
  ) => Promise<void>;
  currentFilters: DashboardFilters;
  currentViewMode: ViewMode;
  currentFeatureSelection: FeatureSelection;
  editingReport?: SavedReport | null;
  isAdmin?: boolean;
  isSaving?: boolean;
}

export function SaveReportModal({
  isOpen,
  onClose,
  onSave,
  currentFilters,
  currentViewMode,
  currentFeatureSelection,
  editingReport,
  isAdmin = false,
  isSaving = false,
}: SaveReportModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [featureSelection, setFeatureSelection] = useState<FeatureSelection>(
    DEFAULT_FEATURE_SELECTION
  );
  const [isDefault, setIsDefault] = useState(false);
  const [isAdminTemplate, setIsAdminTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens or editingReport changes
  useEffect(() => {
    if (isOpen) {
      if (editingReport) {
        setName(editingReport.name);
        setDescription(editingReport.description || '');
        // Use getEffectiveFeatureSelection to handle backward compatibility
        setFeatureSelection(
          getEffectiveFeatureSelection(editingReport.featureSelection)
        );
        setIsDefault(editingReport.isDefault);
        setIsAdminTemplate(editingReport.reportType === 'admin_template');
      } else {
        setName('');
        setDescription('');
        setFeatureSelection(getEffectiveFeatureSelection(currentFeatureSelection));
        setIsDefault(false);
        setIsAdminTemplate(false);
      }
      setError(null);
    }
  }, [isOpen, editingReport, currentFeatureSelection]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter a report name');
      return;
    }

    if (name.length > 255) {
      setError('Name must be 255 characters or less');
      return;
    }

    try {
      await onSave(
        name.trim(),
        description.trim(),
        currentFilters,
        featureSelection,
        currentViewMode,
        isDefault,
        isAdminTemplate
      );
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save report');
    }
  };

  const toggleFeature = (
    category: keyof FeatureSelection,
    feature?: string
  ) => {
    setFeatureSelection((prev) => {
      if (feature && typeof prev[category] === 'object') {
        return {
          ...prev,
          [category]: {
            ...(prev[category] as Record<string, boolean>),
            [feature]: !(prev[category] as Record<string, boolean>)[feature],
          },
        };
      } else {
        return {
          ...prev,
          [category]: !prev[category],
        };
      }
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {editingReport ? 'Edit Saved Report' : 'Save Report'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Report Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Report Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Q1 Paid Search Performance"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              maxLength={255}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this report show?"
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              maxLength={500}
            />
          </div>

          {/* Feature Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
              Visible Features
            </label>
            <div className="space-y-3 text-sm">
              {/* Scorecards */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Scorecards
                </p>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.prospects}
                      onChange={() => toggleFeature('scorecards', 'prospects')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">Prospects</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.contacted}
                      onChange={() => toggleFeature('scorecards', 'contacted')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">Contacted</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.mqls}
                      onChange={() => toggleFeature('scorecards', 'mqls')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">MQLs</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.sqls}
                      onChange={() => toggleFeature('scorecards', 'sqls')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">SQLs</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.sqos}
                      onChange={() => toggleFeature('scorecards', 'sqos')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">SQOs</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.signed}
                      onChange={() => toggleFeature('scorecards', 'signed')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">Signed</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.joined}
                      onChange={() => toggleFeature('scorecards', 'joined')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">Joined</span>
                  </label>
                </div>
              </div>

              {/* Open Pipeline */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={featureSelection.scorecards.openPipeline}
                    onChange={() => toggleFeature('scorecards', 'openPipeline')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    Open Pipeline
                  </span>
                </label>
              </div>

              {/* Conversion Rates */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Conversion Rate Cards
                </p>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.conversionRates.contactedToMql}
                      onChange={() => toggleFeature('conversionRates', 'contactedToMql')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">Contacted → MQL</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.conversionRates.mqlToSql}
                      onChange={() => toggleFeature('conversionRates', 'mqlToSql')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">MQL → SQL</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.conversionRates.sqlToSqo}
                      onChange={() => toggleFeature('conversionRates', 'sqlToSqo')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">SQL → SQO</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.conversionRates.sqoToJoined}
                      onChange={() => toggleFeature('conversionRates', 'sqoToJoined')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">SQO → Joined</span>
                  </label>
                </div>
              </div>

              {/* Charts */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Charts
                </p>
                <label className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={featureSelection.charts.conversionTrends}
                    onChange={() => toggleFeature('charts', 'conversionTrends')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-600 dark:text-gray-400">
                    Conversion Trends
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={featureSelection.charts.volumeTrends}
                    onChange={() => toggleFeature('charts', 'volumeTrends')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-600 dark:text-gray-400">
                    Volume Trends
                  </span>
                </label>
              </div>

              {/* Tables */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Tables
                </p>
                <label className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={featureSelection.tables.channelPerformance}
                    onChange={() => toggleFeature('tables', 'channelPerformance')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-600 dark:text-gray-400">
                    Channel Performance
                  </span>
                </label>
                <label className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={featureSelection.tables.sourcePerformance}
                    onChange={() => toggleFeature('tables', 'sourcePerformance')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-600 dark:text-gray-400">
                    Source Performance
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={featureSelection.tables.detailRecords}
                    onChange={() => toggleFeature('tables', 'detailRecords')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-600 dark:text-gray-400">
                    Detail Records
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-2">
            {/* Set as Default */}
            {!isAdminTemplate && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                <Star className="w-4 h-4 text-amber-500" />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Set as my default report
                </span>
              </label>
            )}

            {/* Admin Template (only for admins) */}
            {isAdmin && !editingReport && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isAdminTemplate}
                  onChange={(e) => {
                    setIsAdminTemplate(e.target.checked);
                    if (e.target.checked) setIsDefault(false);
                  }}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Save as template (visible to all users)
                </span>
              </label>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            icon={Save}
            onClick={handleSave}
            loading={isSaving}
            disabled={isSaving || !name.trim()}
          >
            {editingReport ? 'Update Report' : 'Save Report'}
          </Button>
        </div>
      </div>
    </div>
  );
}
