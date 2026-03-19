import { SGM_ANALYSIS_PROMPT } from './prompts/sgm-analysis';
import { ANALYZE_WINS_PROMPT } from './prompts/analyze-wins';
import { SGA_PERFORMANCE_PROMPT } from './prompts/sga-performance';
import { COMPETITIVE_INTEL_PROMPT } from './prompts/competitive-intel';
import { getReportingContext } from './context';
import type { ReportType } from '@/types/reporting';

export interface ReportAgent {
  type: ReportType;
  systemPrompt: string;
  maxSteps: number;
  hasWebSearch: boolean;
  defaultUserPrompt: string;
  requiredParams?: string[];
}

export const REPORT_AGENTS: Record<ReportType, ReportAgent> = {
  'sgm-analysis': {
    type: 'sgm-analysis',
    systemPrompt: SGM_ANALYSIS_PROMPT,
    maxSteps: 10,
    hasWebSearch: false,
    defaultUserPrompt: 'Generate a performance report for {name}.',
    requiredParams: ['name'],
  },
  'analyze-wins': {
    type: 'analyze-wins',
    systemPrompt: ANALYZE_WINS_PROMPT,
    maxSteps: 15,
    hasWebSearch: false,
    defaultUserPrompt: 'Generate a Won Deal Intelligence report.',
  },
  'sga-performance': {
    type: 'sga-performance',
    systemPrompt: SGA_PERFORMANCE_PROMPT,
    maxSteps: 15,
    hasWebSearch: false,
    defaultUserPrompt: 'Generate an SGA Performance Intelligence report.',
  },
  'competitive-intel': {
    type: 'competitive-intel',
    systemPrompt: COMPETITIVE_INTEL_PROMPT,
    maxSteps: 15,
    hasWebSearch: true,
    defaultUserPrompt: 'Generate a Competitive Intelligence report.',
  },
};

export function buildUserMessage(
  type: ReportType,
  customPrompt?: string | null,
  parameters?: Record<string, string> | null
): string {
  const agent = REPORT_AGENTS[type];
  let base = agent.defaultUserPrompt;

  // Substitute parameters (e.g., {name} for SGM-analysis)
  if (parameters) {
    for (const [key, value] of Object.entries(parameters)) {
      base = base.replace(`{${key}}`, value);
    }
  }

  if (customPrompt) {
    return `${base}\n\nAdditional focus from the user: ${customPrompt}`;
  }
  return base;
}

export function getPromptVersionHash(type: ReportType): string {
  // Simple hash of the system prompt for reproducibility tracking
  const prompt = buildReportSystemPrompt(type);
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return `v1-${Math.abs(hash).toString(36)}`;
}

export function buildReportSystemPrompt(type: ReportType): string {
  return `${REPORT_AGENTS[type].systemPrompt}\n\n${getReportingContext(type)}`;
}
