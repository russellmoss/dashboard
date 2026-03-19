'use client';

import { useState } from 'react';
import type { ReportType } from '@/types/reporting';
import { REPORT_LABELS } from '@/types/reporting';

const REPORT_DESCRIPTIONS: Record<ReportType, string> = {
  'analyze-wins': 'Analyze joined advisors — sources, SGA patterns, velocity, AUM profiles, and what drives wins.',
  'sga-performance': 'Compare SGA team performance — conversion rates, activity patterns, SMS discipline, and coaching priorities.',
  'sgm-analysis': 'Analyze an SGM\'s qualification discipline, close rate, pipeline health, and production trends.',
  'competitive-intel': 'Identify which firms we lose to, deal economics, qualitative loss patterns, and RIA market intelligence.',
};

interface ReportGeneratorProps {
  onGenerate: (jobId: string) => void;
}

export function ReportGenerator({ onGenerate }: ReportGeneratorProps) {
  const [selectedType, setSelectedType] = useState<ReportType | null>(null);
  const [name, setName] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!selectedType) return;
    if (selectedType === 'sgm-analysis' && !name.trim()) {
      setError('Name is required for SGM Analysis');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        type: selectedType,
        customPrompt: customPrompt.trim() || null,
      };

      if (selectedType === 'sgm-analysis') {
        body.parameters = { name: name.trim() };
      }

      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to generate report');
        setIsGenerating(false);
        return;
      }

      onGenerate(data.id);
    } catch {
      setError('Network error — please try again');
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Generate Report</h2>

      {/* Report Type Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(Object.keys(REPORT_LABELS) as ReportType[]).map(type => (
          <button
            key={type}
            onClick={() => { setSelectedType(type); setError(null); }}
            className={`p-4 rounded-lg border text-left transition-colors ${
              selectedType === type
                ? 'border-primary bg-primary/10'
                : 'border-border hover:border-primary/50'
            }`}
          >
            <h3 className="font-medium text-sm">{REPORT_LABELS[type]}</h3>
            <p className="text-xs text-muted-foreground mt-1">{REPORT_DESCRIPTIONS[type]}</p>
          </button>
        ))}
      </div>

      {/* Parameters */}
      {selectedType && (
        <div className="space-y-4">
          {selectedType === 'sgm-analysis' && (
            <div>
              <label className="block text-sm font-medium mb-1">Name (required)</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Corey Marcello"
                className="w-full max-w-md px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Additional instructions (optional)</label>
            <textarea
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              placeholder="e.g., Focus specifically on Q1 2026 performance..."
              rows={3}
              className="w-full max-w-lg px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-6 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? 'Starting...' : 'Generate Report'}
          </button>
        </div>
      )}
    </div>
  );
}
