# Agentic Reporting Architecture

> Self-serve AI-powered report generation inside the Savvy Wealth dashboard.

## Overview

Turn four existing Claude Code intelligence skills into a user-facing report generation platform. Dashboard users select a report type, optionally customize the prompt, and receive an **interactive HTML report with charts** — explorable in-browser, exportable as a clean PDF, and shareable within the dashboard. Each report supports **conversational follow-up**: users can ask drill-down questions against the full dataset without re-running the entire report.

### Report Types

| Report | What It Answers | Key Data Sources |
|--------|----------------|------------------|
| **Won Deal Intelligence** | Why did we win? Where do winners come from? How do we win more? | vw_funnel_master, vw_sga_sms_timing_analysis_v2, vw_lost_to_competition |
| **SGA Performance** | What do top SGAs do differently? How do we replicate it? | vw_funnel_master, vw_sga_activity_performance, sms_weekly_metrics_daily |
| **SGM Analysis** | How is an SGM's qualification discipline? Pipeline health? | vw_funnel_master (SGM fields), Opportunity |
| **Competitive Intel** | Who are we losing to? Why? What's happening in the RIA market? | vw_lost_to_competition (FinTrx-powered), Opportunity, web search (industry news) |

---

## Key Design Decisions

These decisions were made during architecture review and are final for the build:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Agent output format** | Structured JSON (`ReportOutput` schema) | Frontend renders interactive Recharts; enables temporal diffing, follow-up, and downstream consumption by Coach AI / Slack bot |
| **Presentation layer** | Native HTML with React/Recharts (no Gamma) | No external dependency; interactive charts users can hover/filter; same components serve browser + PDF |
| **PDF export** | Client-side `window.print()` with `@media print` styles (Phase 4); server-side Puppeteer deferred to Phase 5 only if automated/emailed PDFs are requested | Zero server cost, zero bundle bloat, works immediately. Puppeteer adds ~50MB to function size and painful cold starts on Vercel serverless |
| **Follow-up context** | Full query result sets persisted on ReportJob | Richer follow-ups without re-querying BigQuery; higher token cost accepted |
| **Agent reliability** | Three-pass generation (analyze → verify → structure) | Pass 1 runs queries + writes narrative; Pass 1.5 verifies every cited statistic against raw data; Pass 2 converts to typed JSON. ~$0.15/report but dramatically more reliable and trustworthy output |
| **Competitive intel web search** | Industry news only (not advisor movement) | FinTrx already powers `vw_lost_to_competition` for advisor-level CRD tracking and firm movement; web search targets RIA M&A, aggregator activity, platform announcements |
| **Primary audience** | RevOps, Sales Managers, Leadership | Same canonical report for all; audience-specific depth via conversational follow-up with role-tagged suggested questions |
| **Follow-up chat persistence** | Yes — persisted in `ReportConversation` model | Users can return to a report days later and see their prior follow-up thread; capped at 20 messages |
| **Chart data size** | Agent-enforced limits in system prompt | Bar charts: max 15 categories (top 10 + "Other"). Line charts: max 24 data points. Tables for anything with >15 rows or >6 columns |

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **LLM orchestration** | Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) | Native Next.js streaming, automatic multi-step tool loops via `maxSteps`, Zod tool definitions |
| **Model** | `claude-sonnet-4-6` | Best balance of speed, cost, and tool-use reliability for structured report generation |
| **Data** | BigQuery (existing views) | All four reports query the same semantic layer views already in production |
| **Web search** | Tavily API (competitive-intel only) | Scoped to RIA industry news: M&A activity, aggregator strategy, platform launches. Not used for advisor-level data (FinTrx handles that via `vw_lost_to_competition`) |
| **Report rendering** | React + Recharts + shadcn/ui | Interactive charts (hover, toggle, filter) rendered from structured JSON chart specs |
| **PDF export** | Client-side `window.print()` + `@media print` CSS | Zero server cost; same print stylesheet serves both browser print and potential future Puppeteer upgrade |
| **Email** | SendGrid (existing) | Already wired up in `src/lib/email.ts` |
| **Storage** | Neon PostgreSQL (Prisma) | `ReportJob` model with `reportJson`, `queryLog`, `extractedMetrics` fields |
| **Hosting** | Vercel (existing) | No new infrastructure. Pro tier (300s timeout, $20/month) needed for all reports except SGM Analysis |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Dashboard Frontend                          │
│                                                                   │
│  /dashboard/reports                                               │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────────┐  │
│  │  Report   │  │   Custom     │  │      Report Library        │  │
│  │  Picker   │  │   Prompt     │  │  (list/filter/share/PDF)   │  │
│  └─────┬─────┘  └──────┬───────┘  └────────────────────────────┘  │
│        │               │                                          │
│        └───────┬───────┘                                          │
│                ▼                                                   │
│     POST /api/reports/generate                                    │
│                │                                                   │
│  /dashboard/reports/[id]                                          │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │  Interactive Report (React/Recharts)                        │   │
│  │  KPI Cards → Sections → Charts → Tables → Recommendations  │   │
│  ├────────────────────────────────────────────────────────────┤   │
│  │  Suggested Follow-Up Questions (role-tagged chips)          │   │
│  ├────────────────────────────────────────────────────────────┤   │
│  │  Follow-Up Chat (streaming, inline charts/tables)           │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                 Report Generation API Route                       │
│                                                                   │
│  1. Validate request + auth                                       │
│  2. Create ReportJob record (status: pending)                     │
│  3. Stream Pass 1 via Vercel AI SDK (queries + narrative)         │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │           Vercel AI SDK — streamText() — Pass 1            │   │
│  │                                                            │   │
│  │  System prompt: SKILL_PROMPTS[reportType]                  │   │
│  │  User message: default + customPrompt                      │   │
│  │  maxSteps: 15                                              │   │
│  │                                                            │   │
│  │  Tools:                                                    │   │
│  │  ┌──────────────┐  ┌──────────────┐                        │   │
│  │  │ runBigQuery  │  │  webSearch   │                        │   │
│  │  │ (all reports)│  │ (comp-intel  │                        │   │
│  │  │              │  │  only)       │                        │   │
│  │  └──────┬───────┘  └──────┬───────┘                        │   │
│  │         │                 │                                │   │
│  │         ▼                 ▼                                │   │
│  │    BigQuery API      Tavily API                            │   │
│  │                      (industry news only —                 │   │
│  │                       FinTrx handles advisor movement)     │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  4. onFinish: persist queryLog (full result sets) + narrative     │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │           Pass 1.5 — Data Verification                     │   │
│  │                                                            │   │
│  │  Input: narrative + query results from Pass 1              │   │
│  │  Output: verification JSON (verified: bool, issues[])      │   │
│  │  Checks every number/stat in narrative against raw data    │   │
│  │  Fast and cheap (~5s, ~$0.03)                              │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  5. If verification finds errors: flag on report, optionally      │
│     re-run Pass 1 with corrections, or surface to user            │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │           Pass 2 — Structure Conversion                    │   │
│  │                                                            │   │
│  │  Input: verified narrative + query results from Pass 1     │   │
│  │  Output: ReportOutput JSON (validated against Zod schema)  │   │
│  │  No tool access — pure text-to-JSON conversion             │   │
│  │  Cheaper model call, very constrained prompt               │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  6. Validate ReportOutput JSON against Zod schema                 │
│  7. Save reportJson + queryLog + extractedMetrics to ReportJob    │
│  8. Send email via SendGrid with exec summary + dashboard link    │
│  9. Update ReportJob status: complete                             │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Agent Design

Each report type is a **single Claude agent** with a specialized system prompt and access to tools. The agent autonomously decides which queries to run, interprets results, and synthesizes a structured report.

### Three-Pass Generation

Report generation uses three sequential LLM calls to separate analytical reasoning, data verification, and structured formatting:

**Pass 1 — Analysis & Narrative** (the "thinking" pass):
- System prompt derived from the skill file (query patterns, domain logic, report structure)
- Has tool access (`runBigQuery`, optionally `webSearch`)
- Runs 5-10 BigQuery queries, interprets results, writes prose narrative with findings
- Output: markdown narrative + accumulated queryLog with full result sets
- This is the expensive, tool-heavy pass (~60-120s depending on report type)

**Pass 1.5 — Data Verification** (the "trust" pass):
- Input: Pass 1 narrative + all query results
- No tool access — pure text comparison
- Checks that every specific number, percentage, count, or statistic cited in the narrative actually appears in or is correctly derived from the query results
- Output: verification JSON with `verified: boolean` and an array of issues (each with the claim, what was cited, what the data actually shows, and severity)
- Fast and cheap (~5s, ~$0.03 per report)
- If verification finds `severity: "error"` issues, the narrative is corrected before proceeding to Pass 2
- This catches the most dangerous failure mode: the agent writing "LinkedIn Self Sourced had a 90.6% MQL rate" when the query result says 85.3%

**Pass 2 — Structure Conversion** (the "formatting" pass):
- Input: verified narrative (corrected if needed) + all query results (compact JSON)
- No tool access — pure text-to-JSON conversion
- Constrained system prompt with the `ReportOutput` schema definition and chart type guidance
- Output: valid `ReportOutput` JSON validated against Zod schema
- Fast and cheap (~5-10s, ~2K output tokens)

**Why three passes**: Pass 1 handles the hard analytical thinking with tool access. Pass 1.5 catches hallucinated or misquoted statistics before they reach end users — the single highest-value step for report trust. Pass 2 handles the mechanical formatting into structured JSON. Each pass is focused on exactly one job, which makes all three more reliable than a single pass trying to do everything.

**Fallback**: If Pass 2 JSON validation fails, retry Pass 2 (not the whole report) with the Zod error message appended. This is cheap and fast since Pass 1 and 1.5 results are already cached.

### Agent Structure

```typescript
// src/lib/reporting/agents.ts

interface ReportAgent {
  type: 'analyze-wins' | 'sga-performance' | 'sgm-analysis' | 'competitive-intel';
  systemPrompt: string;        // derived from SKILL.md content
  tools: ToolSet;              // runBigQuery + optional webSearch
  maxSteps: number;            // tool call budget
  defaultUserPrompt: string;   // what to ask when no custom prompt
  requiredParams?: string[];   // e.g., ["name"] for SGM-analysis
}
```

### Agent: Won Deal Intelligence (`analyze-wins`)

**System prompt**: Instructs Claude to analyze joined advisors — sources, SGA patterns, SMS behavior, velocity, AUM profiles, and contrast with lost deals.

**Tool calls** (typical run):
1. Pull joined advisor cohort (full journey)
2. Source & channel win rates
3. SGA win leaderboard with velocity
4. SMS behavior comparison (joined vs not joined)
5. Stage velocity by quarter
6. AUM distribution of winners
7. Won vs lost-to-competition contrast

**Output**: Structured JSON report with executive summary, 6 analysis sections (each with narrative + charts/tables), KPI metrics, and actionable recommendations.

**Estimated duration**: 75-105 seconds (Pass 1: 60-90s + Pass 1.5: ~5s + Pass 2: ~10s).

### Agent: SGA Performance (`sga-performance`)

**System prompt**: Analyzes SGA team performance across conversion rates, activity patterns, SMS discipline, and response habits. Identifies what top performers do differently.

**Tool calls** (typical run):
1. SGA conversion leaderboard (all stages)
2. Time-period trend comparison (last 90d vs prior 90d)
3. Source-adjusted performance (control for lead quality)
4. Bottleneck analysis per SGA
5. Activity volume profiles (SMS, calls, timing)
6. SMS behavior patterns (double-tap, reply rate, first-text intent)
7. Response speed deep-dive
8. Call behavior patterns
9. Playbook adherence (bookend, golden window, coverage)

**Output**: Structured JSON report with ranking matrix, top performer profiles, behavior gap analysis, coaching recommendations, and a replication playbook.

**Estimated duration**: 105-135 seconds. This is the heaviest report.

### Agent: SGM Analysis (`sgm-analysis`)

**System prompt**: Analyzes an SGM's qualification discipline (SQL→SQO rate vs close rate), SGA routing patterns, pipeline health, and production trends. Also supports SGA ramp analysis if the name resolves to an SGA.

**Required parameter**: `name` (the SGM or SGA to analyze).

**Tool calls** (typical run):
1. Role identification (SGM or SGA?)
2. SQL→SQO qualification discipline (ALL SGMs for comparison)
3. SGA routing breakdown for this SGM
4. Current pipeline under management
5. Quarterly production trend
6. Won/lost analysis by source

**Output**: Structured JSON report with qualification discipline comparison table, SGA routing breakdown, pipeline status, and specific recommendations.

**Estimated duration**: 60-90 seconds (Pass 1: 45-75s + Pass 1.5: ~5s + Pass 2: ~10s). Simplest and fastest report.

### Agent: Competitive Intelligence (`competitive-intel`)

**System prompt**: Analyzes which firms Savvy loses to, deal economics of lost deals, qualitative loss details, and cross-references with **RIA industry news** for market context.

**Tools**: `runBigQuery` + `webSearch` (this is the only agent with web search).

**Important — web search scope**: Tavily web search is scoped to **RIA industry news only** — M&A activity (small/medium RIAs being absorbed by aggregators), competitor platform announcements, regulatory changes, and market trends. It is NOT used for advisor-level movement data because `vw_lost_to_competition` already handles that via FinTrx CRD matching. The view joins Salesforce closed-lost SQOs against `FinTrx_data_CA.ria_contacts_current` to track exactly which firm each lost advisor moved to and when.

**Web search query patterns for this agent**:
- `"[Firm Name]" RIA acquisition 2026` — M&A activity
- `"[Firm Name]" advisor platform technology announcement` — product launches
- `RIA aggregator recruiting trends 2026` — market-level patterns
- `"[Firm Name]" regulatory action SEC` — compliance issues
- NOT: individual advisor movement queries (FinTrx handles this)

**Tool calls** (typical run):
1. Competitor leaderboard (who takes our deals — from `vw_lost_to_competition`)
2. Deal economics of lost-to-competition deals
3. Loss detail mining (freetext qualitative intel from `Closed_Lost_Details__c`)
4. Time trend (losing more or less?)
5. Web search x3-5 (top competitors: M&A activity, platform news, market trends)

**Output**: Structured JSON report with threat matrix, deep dives on top 3 competitors, loss pattern analysis, qualitative intelligence, and positioning recommendations.

**Estimated duration**: 135-195 seconds (web searches add latency). Requires Vercel Pro.

---

## Structured JSON Report Schema

The agent outputs a JSON object conforming to the `ReportOutput` schema (via the two-pass process). The frontend parses this and renders each section with the appropriate chart/table/narrative components.

### Why Structured JSON Over Markdown

- **Interactive charts**: Recharts components with hover, toggle, filtering — not static text tables
- **Metric extraction is free**: Key metrics are already structured, no parsing needed
- **Temporal diffing becomes trivial**: Compare `keyMetrics` objects across report versions by stable ID
- **Follow-up context is typed**: The agent knows exactly what data it produced
- **Downstream consumption**: Coach AI, Slack bot, and dashboard widgets can all consume `keyMetrics` without parsing prose

### Schema Definition

```typescript
// src/types/reporting.ts

type ReportType = 'analyze-wins' | 'sga-performance' | 'sgm-analysis' | 'competitive-intel';

/** Top-level report output from the agent */
interface ReportOutput {
  title: string;
  reportType: ReportType;
  generatedAt: string; // ISO 8601

  /** 2-4 sentence executive summary for email notifications and report cards */
  executiveSummary: string;

  /** Headline metrics displayed as KPI cards at the top of the report */
  keyMetrics: KeyMetric[];

  /** Ordered report sections — each rendered as a distinct visual block */
  sections: ReportSection[];

  /** Actionable recommendations, ranked by expected impact */
  recommendations: Recommendation[];
}

interface KeyMetric {
  id: string;           // stable identifier for diffing (e.g., "total_joined", "avg_aum_m")
  label: string;        // display label (e.g., "Total Joined Advisors")
  value: number | string;
  format: 'number' | 'currency' | 'percent' | 'text';
  /** Optional comparison to prior period — populated when temporal context is available */
  delta?: {
    value: number;
    direction: 'up' | 'down' | 'flat';
    label: string;      // e.g., "vs prior quarter"
    favorable: boolean; // true = green, false = red
  };
}

interface ReportSection {
  id: string;           // stable identifier (e.g., "source-analysis", "sga-leaderboard")
  title: string;

  /** Prose narrative explaining the findings. 2-5 paragraphs. */
  narrative: string;

  /** Zero or more chart specifications rendered by the frontend */
  charts: ChartSpec[];

  /** Zero or more data tables rendered as sortable/filterable components */
  tables: TableSpec[];

  /** Optional callout metrics specific to this section */
  callouts: KeyMetric[];
}

// ─── Chart Specifications ───────────────────────────────────────────

type ChartSpec = BarChartSpec | LineChartSpec | PieChartSpec | ComposedChartSpec;

interface BaseChartSpec {
  id: string;
  title: string;
  subtitle?: string;
  height?: number;      // default: 350
}

interface BarChartSpec extends BaseChartSpec {
  type: 'bar';
  data: Record<string, unknown>[];
  xKey: string;
  yKeys: { key: string; label: string; color?: string; stackId?: string }[];
  layout?: 'vertical' | 'horizontal';
  showValues?: boolean; // render value labels on bars
}

interface LineChartSpec extends BaseChartSpec {
  type: 'line';
  data: Record<string, unknown>[];
  xKey: string;
  yKeys: { key: string; label: string; color?: string; strokeDasharray?: string }[];
  showDots?: boolean;
  referenceLines?: { y: number; label: string; color: string }[];
}

interface PieChartSpec extends BaseChartSpec {
  type: 'pie';
  data: { name: string; value: number; color?: string }[];
  innerRadius?: number; // >0 = donut chart
}

interface ComposedChartSpec extends BaseChartSpec {
  type: 'composed';
  data: Record<string, unknown>[];
  xKey: string;
  series: {
    key: string;
    label: string;
    chartType: 'bar' | 'line' | 'area';
    yAxisId?: 'left' | 'right';
    color?: string;
  }[];
  dualAxis?: boolean;
}

// ─── Table Specifications ───────────────────────────────────────────

interface TableSpec {
  id: string;
  title: string;
  columns: {
    key: string;
    label: string;
    format?: 'number' | 'currency' | 'percent' | 'text' | 'date';
    sortable?: boolean;   // default: true
    align?: 'left' | 'center' | 'right';
    highlight?: 'high-is-good' | 'low-is-good'; // conditional formatting
  }[];
  rows: Record<string, unknown>[];
  sortBy?: { key: string; direction: 'asc' | 'desc' };
  /** Optional: highlight the row matching this condition */
  highlightRow?: { key: string; value: unknown };
  maxRows?: number; // truncate with "show more" if exceeded
}

// ─── Recommendations ────────────────────────────────────────────────

interface Recommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  category: 'source-allocation' | 'sga-coaching' | 'process' | 'positioning' | 'product' | 'monitoring';
  title: string;        // one-line action (e.g., "Shift 20% of outbound effort to LinkedIn Self Sourced")
  rationale: string;    // 2-3 sentences explaining why
  expectedImpact?: string; // e.g., "+5 SQOs per quarter"
  timeframe: 'immediate' | 'this-quarter' | 'next-quarter';
}
```

### Pass 1.5 System Prompt (Data Verification)

This prompt checks every cited statistic against the actual query results before the narrative reaches Pass 2 formatting.

```typescript
// src/lib/reporting/prompts/verification.ts

const VERIFICATION_PROMPT = `
You are a data auditor. You will receive a report narrative and the raw query results that produced it.

Your ONLY job is to check that every specific number, percentage, count, dollar amount, or statistic 
cited in the narrative actually appears in or is correctly derived from the query results.

Rules:
- Check EVERY number in the narrative, not just headline metrics
- For percentages, verify the numerator and denominator are correct
- For averages, verify the average matches the data (allow rounding within 0.5)
- For counts, verify the count matches the number of matching rows
- For rankings ("top performer", "highest rate"), verify the ranking is correct
- If a number is a reasonable derivation (sum, ratio, difference) of query data, mark it as verified
- If a number cannot be traced to any query result, flag it as an error

Output ONLY a JSON object:
{
  "verified": true/false,
  "issueCount": 0,
  "issues": [
    {
      "claim": "the exact text from the narrative containing the wrong number",
      "cited": "the specific number/stat that was cited",
      "actual": "what the query data actually shows",
      "queryIndex": 0,
      "severity": "error" | "warning"
    }
  ],
  "corrections": "If verified is false, rewrite ONLY the sentences that contain errors with corrected numbers. Do not rewrite the entire narrative."
}

Severity guide:
- "error": The number is materially wrong (>5% off, wrong ranking, wrong direction)
- "warning": Minor rounding difference (<5%), or a stat that is plausible but not directly verifiable from the query results provided
`;
```

### Verification Zod Schema

```typescript
// src/lib/reporting/schema.ts (add alongside existing schemas)

const VerificationIssueSchema = z.object({
  claim: z.string(),
  cited: z.string(),
  actual: z.string(),
  queryIndex: z.number().optional(),
  severity: z.enum(['error', 'warning']),
});

export const VerificationResultSchema = z.object({
  verified: z.boolean(),
  issueCount: z.number(),
  issues: z.array(VerificationIssueSchema),
  corrections: z.string().optional(),
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;
```

### Pass 2 System Prompt (Structure Conversion)

This prompt is appended to the Pass 2 call that converts narrative → JSON:

```typescript
// src/lib/reporting/prompts/structure-conversion.ts

const STRUCTURE_CONVERSION_PROMPT = `
You are converting an analytical report into structured JSON. You will receive:
1. The report narrative (prose with findings and analysis)
2. The raw query results that produced the narrative

Your output must be a single JSON object conforming to the ReportOutput schema.
Do NOT wrap it in markdown code fences. Do NOT include any text before or after the JSON.

SCHEMA REQUIREMENTS:
- title: Report title
- reportType: The report type key
- generatedAt: Current ISO 8601 timestamp
- executiveSummary: 2-4 sentence summary of key findings
- keyMetrics: Array of 4-8 headline KPI metrics with stable IDs
- sections: Array of report sections, each with narrative prose, optional charts, and optional tables
- recommendations: Array of prioritized, actionable recommendations

CHART RULES:
- Use "bar" for comparisons across categories (sources, SGAs, quarters)
- Use "line" for trends over time
- Use "pie" only for composition/share breakdowns with ≤6 segments
- Use "composed" when overlaying rates (line) on volumes (bar) with dual Y-axes
- Bar charts: MAX 15 categories. If more, show top 10 + aggregate "Other" row.
- Line charts: MAX 24 data points. Aggregate to quarters if longer.
- Always include the actual data array inline — do not reference external data
- Chart data must come from the query results provided, not be invented

TABLE RULES:
- Include column definitions with format hints (number, currency, percent)
- Set highlight: "high-is-good" or "low-is-good" for conditional formatting columns
- Use tables for any dataset with >15 rows or >6 columns
- Tables are the detailed backup for charts, not a replacement for them

METRIC ID RULES:
- Use stable IDs that won't change between runs (e.g., "total_joined", "avg_cycle_days")
- These IDs are used for temporal diffing between report versions
- Include delta information when the narrative mentions period-over-period changes
`;
```

### Zod Validation on the Backend

```typescript
// src/lib/reporting/schema.ts
import { z } from 'zod';

const KeyMetricSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  format: z.enum(['number', 'currency', 'percent', 'text']),
  delta: z.object({
    value: z.number(),
    direction: z.enum(['up', 'down', 'flat']),
    label: z.string(),
    favorable: z.boolean(),
  }).optional(),
});

const BarChartSpecSchema = z.object({
  type: z.literal('bar'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  height: z.number().optional(),
  data: z.array(z.record(z.unknown())),
  xKey: z.string(),
  yKeys: z.array(z.object({
    key: z.string(),
    label: z.string(),
    color: z.string().optional(),
    stackId: z.string().optional(),
  })),
  layout: z.enum(['vertical', 'horizontal']).optional(),
  showValues: z.boolean().optional(),
});

const LineChartSpecSchema = z.object({
  type: z.literal('line'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  height: z.number().optional(),
  data: z.array(z.record(z.unknown())),
  xKey: z.string(),
  yKeys: z.array(z.object({
    key: z.string(),
    label: z.string(),
    color: z.string().optional(),
    strokeDasharray: z.string().optional(),
  })),
  showDots: z.boolean().optional(),
  referenceLines: z.array(z.object({
    y: z.number(),
    label: z.string(),
    color: z.string(),
  })).optional(),
});

const PieChartSpecSchema = z.object({
  type: z.literal('pie'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  height: z.number().optional(),
  data: z.array(z.object({
    name: z.string(),
    value: z.number(),
    color: z.string().optional(),
  })),
  innerRadius: z.number().optional(),
});

const ComposedChartSpecSchema = z.object({
  type: z.literal('composed'),
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  height: z.number().optional(),
  data: z.array(z.record(z.unknown())),
  xKey: z.string(),
  series: z.array(z.object({
    key: z.string(),
    label: z.string(),
    chartType: z.enum(['bar', 'line', 'area']),
    yAxisId: z.enum(['left', 'right']).optional(),
    color: z.string().optional(),
  })),
  dualAxis: z.boolean().optional(),
});

const ChartSpecSchema = z.discriminatedUnion('type', [
  BarChartSpecSchema,
  LineChartSpecSchema,
  PieChartSpecSchema,
  ComposedChartSpecSchema,
]);

const TableSpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  columns: z.array(z.object({
    key: z.string(),
    label: z.string(),
    format: z.enum(['number', 'currency', 'percent', 'text', 'date']).optional(),
    sortable: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    highlight: z.enum(['high-is-good', 'low-is-good']).optional(),
  })),
  rows: z.array(z.record(z.unknown())),
  sortBy: z.object({
    key: z.string(),
    direction: z.enum(['asc', 'desc']),
  }).optional(),
  highlightRow: z.object({
    key: z.string(),
    value: z.unknown(),
  }).optional(),
  maxRows: z.number().optional(),
});

const RecommendationSchema = z.object({
  id: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  category: z.enum(['source-allocation', 'sga-coaching', 'process', 'positioning', 'product', 'monitoring']),
  title: z.string(),
  rationale: z.string(),
  expectedImpact: z.string().optional(),
  timeframe: z.enum(['immediate', 'this-quarter', 'next-quarter']),
});

const ReportSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  narrative: z.string(),
  charts: z.array(ChartSpecSchema).default([]),
  tables: z.array(TableSpecSchema).default([]),
  callouts: z.array(KeyMetricSchema).default([]),
});

export const ReportOutputSchema = z.object({
  title: z.string(),
  reportType: z.string(),
  generatedAt: z.string(),
  executiveSummary: z.string(),
  keyMetrics: z.array(KeyMetricSchema).min(3).max(12),
  sections: z.array(ReportSectionSchema).min(1),
  recommendations: z.array(RecommendationSchema),
});

export type ReportOutput = z.infer<typeof ReportOutputSchema>;
```

---

## Tool Definitions

### `runBigQuery`

Available to all four agents. Executes a SQL query against BigQuery and returns results. Every call is logged with full result sets for follow-up context.

```typescript
// src/lib/reporting/tools.ts
import { tool } from 'ai';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';

const bigqueryClient = new BigQuery({ projectId: 'savvy-gtm-analytics' });

interface QueryLogEntry {
  stepIndex: number;
  sql: string;
  description: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  bytesScanned: number;
  durationMs: number;
  timestamp: string;
}

// Factory function — creates a fresh tool instance with its own queryLog per report generation
export function createRunBigQueryTool() {
  const queryLog: QueryLogEntry[] = [];

  const runBigQuery = tool({
    description: 'Execute a read-only SQL query against BigQuery. Returns rows as JSON.',
    parameters: z.object({
      sql: z.string().describe('The BigQuery SQL query to execute'),
      description: z.string().describe('Brief description of what this query measures'),
    }),
    execute: async ({ sql, description }) => {
      const startTime = Date.now();

      // Validate read-only
      if (!/^\s*SELECT/i.test(sql.trim()) && !/^\s*WITH/i.test(sql.trim())) {
        throw new Error('Only SELECT/WITH queries are allowed');
      }

      const [rows, metadata] = await bigqueryClient.query({
        query: sql,
        maximumBytesBilled: '1000000000', // 1GB safety cap
        timeoutMs: 30000,
      });

      const cappedRows = rows.slice(0, 200); // Cap at 200 rows — agent rarely needs more for narrative, keeps follow-up context lean

      const entry: QueryLogEntry = {
        stepIndex: queryLog.length,
        sql,
        description,
        rows: cappedRows,
        rowCount: cappedRows.length,
        bytesScanned: Number(metadata?.totalBytesProcessed ?? 0),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };

      queryLog.push(entry);

      return { rows: cappedRows, rowCount: cappedRows.length, description };
    },
  });

  return { runBigQuery, getQueryLog: () => queryLog };
}
```

**Safety guardrails**:
- Read-only: reject anything that isn't a SELECT or WITH statement
- Row limit: cap at 200 rows returned to Claude (agent rarely needs more for narrative; keeps follow-up context ~60% leaner)
- Timeout: 30s per query
- Cost guard: track total bytes scanned per report, `maximumBytesBilled` set to 1GB

### `webSearch`

Available only to the competitive-intel agent. Searches the web for RIA industry news — NOT for advisor-level movement data (FinTrx handles that).

```typescript
const webSearch = tool({
  description: `Search the web for RIA industry news and competitor intelligence.
Use this for: M&A activity, aggregator strategy, platform announcements, regulatory news.
Do NOT use for: individual advisor movements (already tracked via FinTrx in vw_lost_to_competition).`,
  parameters: z.object({
    query: z.string().describe('Search query about RIA industry news or competitor firm activity'),
  }),
  execute: async ({ query }) => {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: 5,
        search_depth: 'advanced',
        include_domains: [
          'riabiz.com', 'wealthmanagement.com', 'investmentnews.com',
          'advisorhub.com', 'financial-planning.com', 'citywire.com',
          'barrons.com', 'thinkadvisor.com', 'sec.gov',
        ],
      }),
    });
    const data = await response.json();
    return data.results.map((r: any) => ({
      title: r.title,
      snippet: r.content?.slice(0, 300),
      url: r.url,
      publishedDate: r.published_date,
    }));
  },
});
```

---

## Data Model

### Prisma Models

```prisma
model ReportJob {
  id             String    @id @default(cuid())
  type           String    // "analyze-wins" | "sga-performance" | "sgm-analysis" | "competitive-intel"
  status         String    @default("pending") // pending | running | complete | failed

  // Who requested it
  requestedById  String
  requestedBy    User      @relation(fields: [requestedById], references: [id])

  // Input
  customPrompt   String?   // null = default report
  parameters     Json?     // { "name": "Corey Marcello" } for SGM-analysis

  // Output
  reportJson     Json?     // ReportOutput schema — structured data for frontend rendering
  queryLog       Json?     // QueryLogEntry[] — full query results for conversational follow-up
  extractedMetrics Json?   // KeyMetric[] — copied from reportJson.keyMetrics for fast temporal diffing
  verificationResult Json? // VerificationResult — Pass 1.5 data audit (verified: bool, issues[])

  // Sharing
  visibility     String    @default("private") // private | shared | all
  sharedWith     ReportShare[]

  // Follow-up conversations
  conversations  ReportConversation[]

  // Metadata
  stepsCompleted Int       @default(0)  // tool calls completed (for progress UI)
  totalTokens    Int?      // cost tracking (Pass 1 + Pass 2 combined)
  durationMs     Int?      // how long generation took
  error          String?   // error message if failed
  promptVersion  String?   // hash of the prompt version used — enables reproducibility

  createdAt      DateTime  @default(now())
  completedAt    DateTime?

  @@index([type, requestedById, createdAt(sort: Desc)]) // temporal diffing queries
  @@index([requestedById])
  @@index([status])
  @@index([type])
}

model ReportShare {
  id           String    @id @default(cuid())
  reportId     String
  report       ReportJob @relation(fields: [reportId], references: [id], onDelete: Cascade)
  sharedWithId String
  sharedWith   User      @relation(fields: [sharedWithId], references: [id])
  createdAt    DateTime  @default(now())

  @@unique([reportId, sharedWithId])
}

model ReportConversation {
  id        String   @id @default(cuid())
  reportId  String
  report    ReportJob @relation(fields: [reportId], references: [id], onDelete: Cascade)
  role      String   // "user" | "assistant"
  content   String   @db.Text
  createdAt DateTime @default(now())

  @@index([reportId, createdAt])
}
```

**Migration note**: As with all schema changes, generate a manual SQL file for the human to run in the Neon SQL Editor, then run `npx prisma generate` locally. `npx prisma migrate dev` does not work in this environment.

---

## API Routes

### `POST /api/reports/generate`

Creates a report job and runs the two-pass generation.

```typescript
// src/app/api/reports/generate/route.ts
export const maxDuration = 300; // Requires Vercel Pro

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();

  const { type, customPrompt, parameters } = await req.json();

  // Permission check
  if (!canGenerate(session.user, type)) {
    return Response.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // Create job record
  const job = await prisma.reportJob.create({
    data: {
      type,
      customPrompt,
      parameters,
      requestedById: session.user.id,
      status: 'running',
      promptVersion: getPromptVersionHash(type),
    },
  });

  // Get agent config
  const agent = REPORT_AGENTS[type];
  const { runBigQuery, getQueryLog } = createRunBigQueryTool();

  // Build tool set
  const tools: Record<string, any> = { runBigQuery };
  if (type === 'competitive-intel') {
    tools.webSearch = webSearch;
  }

  // Build user message
  const userMessage = buildUserMessage(type, customPrompt, parameters);

  // ─── Pass 1: Analysis & Narrative ─────────────────────────────
  const pass1Result = await streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: agent.systemPrompt,
    prompt: userMessage,
    tools,
    maxSteps: agent.maxSteps,
    onStepFinish: async () => {
      await prisma.reportJob.update({
        where: { id: job.id },
        data: { stepsCompleted: { increment: 1 } },
      });
    },
  });

  const narrative = await pass1Result.text;
  const queryLog = getQueryLog();
  const pass1Usage = await pass1Result.usage;

  // Persist query log immediately (valuable even if later passes fail)
  await prisma.reportJob.update({
    where: { id: job.id },
    data: { queryLog: queryLog as any },
  });

  // ─── Pass 1.5: Data Verification ───────────────────────────────
  let verifiedNarrative = narrative;

  const verificationResult = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    system: VERIFICATION_PROMPT,
    prompt: `Narrative:\n${narrative}\n\nQuery Results:\n${JSON.stringify(queryLog.map(q => ({
      description: q.description,
      sql: q.sql,
      rows: q.rows,
      rowCount: q.rowCount,
    })), null, 0)}`,
  });

  try {
    const verification = VerificationResultSchema.parse(
      JSON.parse(verificationResult.text.replace(/^```json\n?|```$/g, '').trim())
    );

    // Persist verification result on the job for transparency
    await prisma.reportJob.update({
      where: { id: job.id },
      data: { verificationResult: verification as any },
    });

    if (!verification.verified && verification.issues.some(i => i.severity === 'error')) {
      // Apply corrections to the narrative before Pass 2
      if (verification.corrections) {
        // The corrections field contains rewritten sentences — apply them
        // by re-running Pass 1's final output step with the corrections context
        const correctionResult = await generateText({
          model: anthropic('claude-sonnet-4-6'),
          system: `You are correcting specific factual errors in a report narrative.
Apply ONLY the corrections listed below. Do not change anything else about the narrative.
Preserve all structure, formatting, and analysis — only fix the specific numbers flagged.`,
          prompt: `Original narrative:\n${narrative}\n\nCorrections to apply:\n${verification.corrections}`,
        });
        verifiedNarrative = correctionResult.text;
      }
    }
  } catch {
    // If verification parsing fails, proceed with original narrative
    // This is a non-blocking enhancement — better to have an unverified report than no report
  }

  // ─── Pass 2: Structure Conversion ─────────────────────────────
  const pass2Result = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    system: STRUCTURE_CONVERSION_PROMPT,
    prompt: `
Here is the report narrative:
${verifiedNarrative}

Here are the query results that produced it:
${JSON.stringify(queryLog.map(q => ({
  description: q.description,
  sql: q.sql,
  rows: q.rows,
  rowCount: q.rowCount,
})), null, 0)}

Convert this into the ReportOutput JSON schema.
Report type: "${type}"
`,
  });

  // Validate and persist
  let reportJson: ReportOutput;
  try {
    const parsed = JSON.parse(pass2Result.text.replace(/^```json\n?|```$/g, '').trim());
    reportJson = ReportOutputSchema.parse(parsed);
  } catch (validationError) {
    // Retry Pass 2 with error context
    try {
      const retryResult = await generateText({
        model: anthropic('claude-sonnet-4-6'),
        system: STRUCTURE_CONVERSION_PROMPT,
        prompt: `
Your previous JSON output failed validation with this error:
${validationError instanceof Error ? validationError.message : String(validationError)}

Here is the report narrative:
${verifiedNarrative}

Here are the query results:
${JSON.stringify(queryLog.map(q => ({ description: q.description, rows: q.rows })), null, 0)}

Fix the JSON and try again. Output ONLY the corrected JSON.
`,
      });

      const retryParsed = JSON.parse(retryResult.text.replace(/^```json\n?|```$/g, '').trim());
      reportJson = ReportOutputSchema.parse(retryParsed);
    } catch (retryError) {
      // Both Pass 2 attempts failed — save as failed but preserve Pass 1 data
      await prisma.reportJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: `Structured formatting failed after retry: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
          // queryLog already persisted above — narrative saved here for recovery
          reportJson: { rawNarrative: verifiedNarrative } as any,
          durationMs: Date.now() - job.createdAt.getTime(),
        },
      });

      return Response.json({
        id: job.id,
        status: 'failed',
        error: 'Report analysis completed but structured formatting failed. You can retry formatting without re-running queries.',
        retryable: true, // Frontend uses this to show "Retry Formatting" button
      }, { status: 500 });
    }
  }

  // Finalize
  const totalTokens = (pass1Usage?.totalTokens ?? 0) + (pass2Result.usage?.totalTokens ?? 0);
  await prisma.reportJob.update({
    where: { id: job.id },
    data: {
      status: 'complete',
      reportJson: reportJson as any,
      extractedMetrics: reportJson.keyMetrics as any,
      totalTokens,
      durationMs: Date.now() - job.createdAt.getTime(),
      completedAt: new Date(),
    },
  });

  // Send email notification
  await notifyReportComplete(job.id, session.user);

  return Response.json({
    id: job.id,
    status: 'complete',
    reportJson,
  });
}
```

### `POST /api/reports/[id]/follow-up`

Conversational follow-up on a completed report.

```typescript
// src/app/api/reports/[id]/follow-up/route.ts
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();

  const report = await prisma.reportJob.findUnique({
    where: { id: params.id },
    include: { conversations: { orderBy: { createdAt: 'asc' }, take: 20 } },
  });

  if (!report || report.status !== 'complete') {
    return Response.json({ error: 'Report not found or not complete' }, { status: 404 });
  }

  if (!canViewReport(session.user, report)) {
    return Response.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { message } = await req.json();

  // Persist user message
  await prisma.reportConversation.create({
    data: { reportId: params.id, role: 'user', content: message },
  });

  // Check conversation length cap
  if (report.conversations.length >= 20) {
    return Response.json({
      error: 'Conversation limit reached. Generate a new report for continued analysis.',
    }, { status: 400 });
  }

  // Build context from the original report
  const queryLog = report.queryLog as QueryLogEntry[];
  const followUpContext = buildFollowUpContext(report, queryLog);

  // Build conversation history
  const conversationHistory = report.conversations.map(msg => ({
    role: msg.role as 'user' | 'assistant',
    content: msg.content,
  }));

  const { runBigQuery: followUpBigQuery } = createRunBigQueryTool();

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: `You are a data analyst following up on a previously generated report.
You have full access to the report content, the queries that produced it, and their complete results.

${followUpContext}

CAPABILITIES:
- You can reference any data from the original report or query results directly
- You can run NEW BigQuery queries to drill deeper or answer questions the report didn't cover
- When you produce new findings, output them as JSON sections that the frontend can render:
  - For a new chart: { "type": "chart", "spec": <ChartSpec> }
  - For a new table: { "type": "table", "spec": <TableSpec> }
  - For updated metrics: { "type": "metrics", "data": <KeyMetric[]> }

Wrap each JSON block in <<<VISUAL>>> and <<<END_VISUAL>>> delimiters.
Everything outside these delimiters is narrative prose (markdown allowed).

GUIDELINES:
- First check if the answer is already in the query results before running a new query
- If you need new data, explain what you're querying and why
- Keep follow-up responses focused and concise — 1-3 paragraphs + visuals
- Reference specific numbers from the report to ground your analysis`,

    messages: [
      ...conversationHistory,
      { role: 'user', content: message },
    ],
    tools: { runBigQuery: followUpBigQuery },
    maxSteps: 5, // Lower budget for follow-ups
    onFinish: async ({ text }) => {
      // Persist assistant response
      await prisma.reportConversation.create({
        data: { reportId: params.id, role: 'assistant', content: text },
      });
    },
  });

  return result.toDataStreamResponse();
}
```

### Follow-Up Context Builder

```typescript
// src/lib/reporting/follow-up.ts

function buildFollowUpContext(report: ReportJob, queryLog: QueryLogEntry[]): string {
  // Always include: the full structured report (compact JSON)
  const reportContext = JSON.stringify(report.reportJson, null, 0);

  // Always include: query descriptions and SQL (cheap, high-value for context)
  const querySummary = queryLog.map((q, i) =>
    `Query ${i + 1}: ${q.description}\nSQL: ${q.sql}\nRows returned: ${q.rowCount}`
  ).join('\n\n');

  // Conditionally include: full result sets
  // Truncate individual query results to top 100 rows if total would exceed 40K tokens
  const estimatedTokens = JSON.stringify(queryLog).length / 4;
  const fullResults = estimatedTokens > 40000
    ? queryLog.map(q => ({ ...q, rows: q.rows.slice(0, 100) }))
    : queryLog;

  return `
## Report Data (ReportOutput JSON)
${reportContext}

## Queries Executed During Report Generation
${querySummary}

## Full Query Results
${JSON.stringify(fullResults, null, 0)}
`;
}
```

### PDF Export (Client-Side)

PDF export uses `window.print()` with the `@media print` stylesheet. No server-side rendering, no Puppeteer, no bundle bloat. The same print CSS that optimizes the report for paper also serves as the PDF template when the user prints to PDF from the browser dialog.

```typescript
// src/app/dashboard/reports/components/ExportPDFButton.tsx

function ExportPDFButton() {
  const handleExport = () => {
    // The print.css @media print rules automatically:
    // - Hide interactive elements (chat, follow-up chips, nav, share button)
    // - Lock chart SVGs to current state
    // - Optimize typography for paper (11pt, 1.5 line-height)
    // - Prevent page breaks inside sections, KPI rows, table rows
    window.print();
  };

  return (
    <Button variant="outline" onClick={handleExport}>
      <PrinterIcon className="h-4 w-4 mr-2" />
      Export PDF
    </Button>
  );
}
```

**Why not server-side Puppeteer?** `@sparticuz/chromium` adds ~50MB to the Vercel function bundle, inflates cold starts, and counts against the 250MB function size limit. Client-side `window.print()` is free, instant, and the print CSS already handles all the formatting. Server-side Puppeteer can be added in Phase 5 if leadership specifically requests automated/emailed PDFs — the print CSS is reusable for both approaches.

**Phase 5 upgrade path (if needed):** Install `@sparticuz/chromium` + `puppeteer-core`, add `GET /api/reports/[id]/pdf` route that navigates a headless browser to the report page with `?print=true` and captures a PDF. The same `@media print` CSS serves both client-side and server-side rendering.

### Other API Routes

```
GET  /api/reports              — List reports for the current user (own + shared)
GET  /api/reports/[id]         — Get a specific report (with auth check)
POST /api/reports/[id]/share   — Share a report with other dashboard users
POST /api/reports/[id]/retry   — Retry Pass 2 formatting on a failed report (uses saved narrative + queryLog)
DELETE /api/reports/[id]       — Delete a report (owner only)
```

---

## Error Handling

### Pass 2 Failure Recovery

If both Pass 2 attempts fail Zod validation, the system:

1. Sets `ReportJob.status = 'failed'` with the validation error message
2. Preserves `queryLog` (already persisted after Pass 1) and the raw narrative in `reportJson.rawNarrative`
3. Returns `{ retryable: true }` to the frontend

**Frontend behavior for failed reports:**
- Show a message: "Report analysis completed but structured formatting failed."
- Display a "Retry Formatting" button (only shown when `status === 'failed'` and `retryable === true`)
- The retry button calls `POST /api/reports/[id]/retry`, which re-runs only Pass 2 using the saved narrative and queryLog — no BigQuery queries are re-executed
- If retry succeeds, update the report to `status: 'complete'` and render normally
- If retry fails again, suggest "Try regenerating the full report"

```typescript
// src/app/api/reports/[id]/retry/route.ts
export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();

  const report = await prisma.reportJob.findUnique({ where: { id: params.id } });

  if (!report || report.status !== 'failed' || report.requestedById !== session.user.id) {
    return Response.json({ error: 'Not found or not retryable' }, { status: 404 });
  }

  const queryLog = report.queryLog as QueryLogEntry[];
  const rawNarrative = (report.reportJson as any)?.rawNarrative;

  if (!rawNarrative || !queryLog?.length) {
    return Response.json({ error: 'No saved data to retry from' }, { status: 400 });
  }

  // Re-run Pass 2 only
  const pass2Result = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    system: STRUCTURE_CONVERSION_PROMPT,
    prompt: `
Here is the report narrative:
${rawNarrative}

Here are the query results:
${JSON.stringify(queryLog.map(q => ({ description: q.description, rows: q.rows })), null, 0)}

Convert this into the ReportOutput JSON schema.
Report type: "${report.type}"
`,
  });

  try {
    const parsed = JSON.parse(pass2Result.text.replace(/^```json\n?|```$/g, '').trim());
    const reportJson = ReportOutputSchema.parse(parsed);

    await prisma.reportJob.update({
      where: { id: params.id },
      data: {
        status: 'complete',
        reportJson: reportJson as any,
        extractedMetrics: reportJson.keyMetrics as any,
        error: null,
        completedAt: new Date(),
      },
    });

    return Response.json({ id: params.id, status: 'complete', reportJson });
  } catch (err) {
    return Response.json({
      error: 'Formatting retry failed. Try regenerating the full report.',
      retryable: false,
    }, { status: 500 });
  }
}
```

---

## Frontend

### Report Renderer Component Tree

```
<ReportDetail>                          // Page wrapper, loads report data
├── <ReportHeader>                      // Title, date, who generated, actions (PDF, share)
├── <KPICardRow metrics={keyMetrics} /> // Horizontal row of 4-8 metric cards with deltas
├── {sections.map(section => (
│   <ReportSection key={section.id}>
│   ├── <SectionTitle>{section.title}</SectionTitle>
│   ├── <Narrative>{section.narrative}</Narrative>
│   ├── {section.charts.map(chart => (
│   │   <ChartRenderer spec={chart} />  // Dispatches to Recharts component by type
│   │ ))}
│   ├── {section.tables.map(table => (
│   │   <TableRenderer spec={table} />  // Sortable, filterable data table
│   │ ))}
│   └── {section.callouts && <CalloutMetrics metrics={section.callouts} />}
│   </ReportSection>
│ ))}
├── <Recommendations items={recommendations} />
├── <SuggestedFollowUps questions={suggestedQuestions} onSelect={sendToChat} />
└── <FollowUpChat reportId={id} />      // Streaming chat interface
```

### ChartRenderer — Dispatch by Type

```typescript
// src/app/dashboard/reports/components/ChartRenderer.tsx

import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ComposedChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, LabelList,
} from 'recharts';

const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

export function ChartRenderer({ spec }: { spec: ChartSpec }) {
  switch (spec.type) {
    case 'bar':      return <BarChartComponent spec={spec} />;
    case 'line':     return <LineChartComponent spec={spec} />;
    case 'pie':      return <PieChartComponent spec={spec} />;
    case 'composed': return <ComposedChartComponent spec={spec} />;
    default:         return null;
  }
}

function BarChartComponent({ spec }: { spec: BarChartSpec }) {
  return (
    <div className="my-6">
      <h4 className="text-sm font-medium text-muted-foreground mb-2">{spec.title}</h4>
      {spec.subtitle && <p className="text-xs text-muted-foreground mb-3">{spec.subtitle}</p>}
      <ResponsiveContainer width="100%" height={spec.height ?? 350}>
        <BarChart
          data={spec.data}
          layout={spec.layout ?? 'vertical'}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis dataKey={spec.xKey} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          {spec.yKeys.map((y, i) => (
            <Bar
              key={y.key}
              dataKey={y.key}
              name={y.label}
              fill={y.color ?? COLORS[i % COLORS.length]}
              stackId={y.stackId}
            >
              {spec.showValues && <LabelList dataKey={y.key} position="top" fontSize={11} />}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// LineChartComponent, PieChartComponent, ComposedChartComponent follow the same pattern
```

### Follow-Up Chat with Inline Visuals

The follow-up chat handles mixed content: narrative prose interspersed with `<<<VISUAL>>>` blocks that contain chart/table specs rendered inline.

```typescript
// src/app/dashboard/reports/components/FollowUpChat.tsx

function parseFollowUpResponse(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const parts = text.split(/<<<VISUAL>>>([\s\S]*?)<<<END_VISUAL>>>/g);

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i].trim()) {
        blocks.push({ type: 'narrative', content: parts[i].trim() });
      }
    } else {
      try {
        const spec = JSON.parse(parts[i].trim());
        blocks.push({ type: spec.type, spec: spec.spec ?? spec.data });
      } catch {
        blocks.push({ type: 'narrative', content: parts[i].trim() });
      }
    }
  }

  return blocks;
}

function FollowUpMessage({ content }: { content: string }) {
  const blocks = parseFollowUpResponse(content);

  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'narrative':
            return <ReactMarkdown key={i}>{block.content}</ReactMarkdown>;
          case 'chart':
            return <ChartRenderer key={i} spec={block.spec} />;
          case 'table':
            return <TableRenderer key={i} spec={block.spec} />;
          case 'metrics':
            return <KPICardRow key={i} metrics={block.spec} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
```

### Suggested Follow-Up Questions (Role-Tagged)

Pre-computed per report type. The frontend filters by the current user's role so RevOps, managers, and leadership each see different question chips.

```typescript
// src/lib/reporting/follow-ups.ts

interface SuggestedQuestion {
  label: string;        // chip text
  prompt: string;       // actual message sent to the agent
  audience: ('revops' | 'manager' | 'leadership')[];
}

function getSuggestedFollowUps(report: ReportOutput): SuggestedQuestion[] {
  const suggestions: SuggestedQuestion[] = [];

  switch (report.reportType) {
    case 'analyze-wins':
      suggestions.push(
        {
          label: 'What changed vs last quarter?',
          prompt: 'Compare the key win metrics against the prior quarter. What improved, what declined, and what drove the changes?',
          audience: ['revops', 'manager', 'leadership'],
        },
        {
          label: 'Drill into top source',
          prompt: 'Break down the top-performing source by SGA, AUM tier, and monthly trend. Is the source getting better or worse?',
          audience: ['revops', 'manager'],
        },
        {
          label: 'Pipeline forecast from current wins',
          prompt: 'Based on the current win patterns, project how many joins we should expect next quarter if trends hold. What would need to change to hit 20% growth?',
          audience: ['leadership'],
        },
        {
          label: 'Which SGAs should work which sources?',
          prompt: 'Cross-reference SGA win rates by source. Are there SGAs who perform significantly better on specific sources? Recommend optimal SGA-source assignments.',
          audience: ['revops', 'manager'],
        },
      );
      break;

    case 'sga-performance':
      suggestions.push(
        {
          label: 'Coaching priorities this week',
          prompt: 'Based on the performance gaps, which 2-3 SGAs would benefit most from coaching this week, and what specific behavior should each focus on?',
          audience: ['manager'],
        },
        {
          label: 'Response time deep-dive',
          prompt: 'Show me the distribution of response times for the top 3 SGAs vs bottom 3. Include specific examples of slow responses and their outcomes.',
          audience: ['revops', 'manager'],
        },
        {
          label: 'Team health summary',
          prompt: "Give me a one-paragraph summary of the SGA team health suitable for sharing with leadership. What's working, what needs attention, and what's the trajectory?",
          audience: ['leadership'],
        },
      );
      break;

    case 'sgm-analysis':
      suggestions.push(
        {
          label: 'At-risk pipeline deals',
          prompt: 'Which deals in the current pipeline are at risk based on stage aging, AUM, or source patterns? Recommend specific actions for each.',
          audience: ['manager', 'revops'],
        },
        {
          label: 'Qualification calibration',
          prompt: "Compare this SGM's qualification criteria against the others. Are they letting through deal profiles that consistently close-lost? Show the data.",
          audience: ['revops'],
        },
      );
      break;

    case 'competitive-intel':
      suggestions.push(
        {
          label: 'Counter-positioning deck points',
          prompt: 'For the top 3 competitors, give me 2-3 bullet points I could put on a sales enablement slide that directly counters their pitch with our strengths.',
          audience: ['manager', 'leadership'],
        },
        {
          label: 'Win-back opportunities',
          prompt: 'Are there advisors we lost to competitors in the last 6 months who might be re-engageable? What would the outreach strategy look like?',
          audience: ['revops', 'manager'],
        },
      );
      break;
  }

  return suggestions;
}
```

### Page: `/dashboard/reports`

Two sections:

**1. Generate Report (top)**
- Report type selector (4 cards with icons and descriptions)
- Parameters section (dynamic — shows name input for SGM-analysis, date range for others)
- "Additional instructions" textarea (optional custom prompt)
- "Generate Report" button
- Progress indicator while generating (shows tool call steps completing)

**2. Report Library (bottom)**
- Table/card list of all reports the user can see
- Columns: type, date, requested by, status, actions
- Filter by: type, date range, "my reports" vs "shared with me"
- Actions: view, share, export PDF (client-side print), delete

### Report Detail View: `/dashboard/reports/[id]`

- **Interactive rendered report** (KPI cards → section narratives → charts → tables → recommendations)
- Sidebar with metadata (who generated, when, parameters, custom prompt)
- Action buttons: share, email, export PDF (client-side `window.print()`)
- Share modal: pick users from dashboard user list, set visibility
- Suggested follow-up question chips (filtered by current user role)
- Follow-up chat interface with streaming + inline visuals

### Print-Optimized Styles

```css
/* src/app/dashboard/reports/print.css */
/* Applied when ?print=true or @media print */

@media print {
  /* Hide interactive elements */
  .follow-up-chat,
  .suggested-follow-ups,
  .report-actions,
  .share-button,
  nav,
  aside { display: none !important; }

  /* Charts: lock to current state, ensure SVG renders */
  .recharts-responsive-container {
    width: 100% !important;
    page-break-inside: avoid;
  }

  /* Tables: ensure they don't break mid-row */
  table { page-break-inside: auto; }
  tr { page-break-inside: avoid; }

  /* KPI cards: keep together */
  .kpi-card-row {
    page-break-inside: avoid;
    display: flex;
    gap: 12px;
  }

  /* Sections: avoid breaking mid-section */
  .report-section {
    page-break-inside: avoid;
    page-break-before: auto;
  }

  /* Typography: optimize for print */
  body { font-size: 11pt; line-height: 1.5; color: #000; }
  h2 { font-size: 16pt; margin-top: 18pt; }
  h3 { font-size: 13pt; }

  /* Recommendations: compact layout */
  .recommendation-card {
    border: 1px solid #ddd;
    padding: 8pt;
    margin-bottom: 8pt;
    page-break-inside: avoid;
  }
}
```

---

## Custom Prompt System

Users can either generate the default report or add their own focus areas. The custom prompt is appended to the default instruction, not a replacement.

**Examples of custom prompts:**

| Report | Custom Prompt Example |
|--------|----------------------|
| Won Deal Intelligence | "Focus specifically on Q1 2026 joins and compare LinkedIn-sourced vs partnership-sourced deals" |
| SGA Performance | "I want to understand what changed with Sarah's numbers in February — dig into her activity patterns" |
| SGM Analysis | "Compare Corey's qualification rate against the team and flag any deals that have been stuck in pipeline for 60+ days" |
| Competitive Intel | "Deep dive on Farther specifically — I've heard they're offering equity to everyone now" |

**Implementation:**

```typescript
function buildUserMessage(type: string, custom?: string, params?: Record<string, string>): string {
  const base = {
    'analyze-wins': 'Generate a Won Deal Intelligence report.',
    'sga-performance': 'Generate an SGA Performance Intelligence report.',
    'sgm-analysis': `Generate a performance report for ${params?.name}.`,
    'competitive-intel': 'Generate a Competitive Intelligence report.',
  }[type];

  if (custom) {
    return `${base}\n\nAdditional focus from the user: ${custom}`;
  }
  return base;
}
```

---

## Email Notification

When a report completes, send via existing SendGrid integration:

```typescript
async function notifyReportComplete(jobId: string, user: User) {
  const job = await prisma.reportJob.findUnique({ where: { id: jobId } });
  if (!job?.reportJson) return;

  const reportJson = job.reportJson as ReportOutput;
  const subject = `Your ${REPORT_LABELS[job.type]} report is ready`;

  await sendEmail(
    user.email,
    subject,
    // Text version: executive summary
    reportJson.executiveSummary,
    // HTML version: styled summary + link to dashboard
    renderReportEmail({
      reportTitle: subject,
      summary: reportJson.executiveSummary,
      keyMetrics: reportJson.keyMetrics.slice(0, 4), // top 4 KPIs in email
      dashboardLink: `${process.env.NEXTAUTH_URL}/dashboard/reports/${job.id}`,
    }),
  );
}
```

---

## RBAC & Permissions

Using existing role system from `src/lib/permissions.ts`:

| Role | Can Generate | Can View | Can Share | Can Follow-Up | Notes |
|------|-------------|----------|-----------|---------------|-------|
| revops_admin | All types | All reports | Yes | Yes | Full access |
| admin | All types | All reports | Yes | Yes | Full access |
| manager | All types | Own + shared | Yes | Yes | |
| sgm | SGM Analysis only | Own + shared | Yes | Yes | Can only analyze themselves or their book |
| sga | None | Shared only | No | Yes | Can view and ask follow-ups on reports shared with them |
| viewer | None | Shared only | No | No | Read-only |
| recruiter | None | None | No | No | No access |
| capital_partner | None | None | No | No | No access |

---

## Timeout Strategy

**Vercel Pro required** ($20/month, 300s limit):

| Report | Pass 1 | Pass 1.5 | Pass 2 | Total | Fits in 300s? |
|--------|--------|----------|--------|-------|--------------|
| SGM Analysis | 45-75s | ~5s | ~10s | 60-90s | Yes |
| Won Deal Intelligence | 60-90s | ~5s | ~10s | 75-105s | Yes |
| SGA Performance | 90-120s | ~5s | ~10s | 105-135s | Yes |
| Competitive Intel | 120-180s | ~5s | ~10s | 135-195s | Yes |

All four reports fit within the 300s Pro limit. If any report ever exceeds 300s, add Inngest (serverless background jobs on Vercel) — but this is unlikely given the query counts.

---

## Cost Estimates

### Per Report (with three-pass generation)

| Component | Cost |
|-----------|------|
| Claude Sonnet — Pass 1 (5K input + 3K output tokens avg) | ~$0.06 |
| Claude Sonnet — Pass 1.5 verification (8K input + 0.5K output) | ~$0.03 |
| Claude Sonnet — Pass 1.5 correction (if needed, ~30% of reports) | ~$0.01 avg |
| Claude Sonnet — Pass 2 (8K input + 2K output tokens avg) | ~$0.06 |
| BigQuery (5-10 queries, <100MB scanned) | ~$0.00 (free tier) |
| Tavily web search (competitive-intel only, 3-5 searches) | ~$0.01 |
| SendGrid email | ~$0.00 (free tier) |
| **Total per report** | **~$0.16** |

### Per Follow-Up Turn

| Component | Cost |
|-----------|------|
| Claude Sonnet (30-50K context + 1K output) | ~$0.10-0.15 |
| BigQuery (0-2 new queries if needed) | ~$0.00 |
| **Total per follow-up** | **~$0.12** |

### Monthly Estimate (assuming 50 reports + 100 follow-ups/month)

| Item | Monthly Cost |
|------|-------------|
| Claude API — report generation | ~$6.00 |
| Claude API — follow-ups | ~$12.00 |
| Tavily (competitive-intel reports) | ~$0.50 |
| Vercel Pro | $20.00 |
| **Total** | **~$38.50/month** |

---

## File Structure

```
src/
├── app/
│   ├── api/
│   │   └── reports/
│   │       ├── generate/
│   │       │   └── route.ts          # POST — two-pass report generation
│   │       ├── [id]/
│   │       │   ├── route.ts          # GET, DELETE — single report
│   │       │   ├── follow-up/
│   │       │   │   └── route.ts      # POST — conversational follow-up
│   │       │   ├── retry/
│   │       │   │   └── route.ts      # POST — retry Pass 2 formatting on failed report
│   │       │   └── share/
│   │       │       └── route.ts      # POST — share report
│   │       └── route.ts              # GET — list reports
│   └── dashboard/
│       └── reports/
│           ├── page.tsx              # Report library page
│           ├── ReportsClient.tsx     # Client component
│           ├── print.css             # Print-optimized styles for PDF export
│           ├── [id]/
│           │   └── page.tsx          # Report detail view
│           └── components/
│               ├── ReportGenerator.tsx    # Type picker + prompt input
│               ├── ReportProgress.tsx     # Generation progress UI
│               ├── ReportLibrary.tsx      # Report list/table
│               ├── ReportDetail.tsx       # Full interactive report view
│               ├── KPICardRow.tsx         # Horizontal metric cards with deltas
│               ├── ChartRenderer.tsx      # Dispatch to Recharts by chart type
│               ├── TableRenderer.tsx      # Sortable/filterable data table
│               ├── Recommendations.tsx    # Prioritized action cards
│               ├── SuggestedFollowUps.tsx # Role-tagged question chips
│               ├── FollowUpChat.tsx       # Streaming chat with inline visuals
│               ├── ExportPDFButton.tsx    # Client-side window.print() PDF export
│               └── ShareModal.tsx         # Share with users
├── lib/
│   └── reporting/
│       ├── agents.ts                 # Agent configs (system prompts, tools, maxSteps)
│       ├── tools.ts                  # Tool definitions (runBigQuery, webSearch)
│       ├── schema.ts                 # Zod schemas for ReportOutput validation
│       ├── follow-up.ts             # buildFollowUpContext, getSuggestedFollowUps
│       ├── prompts/
│       │   ├── analyze-wins.ts       # System prompt for Won Deal Intelligence
│       │   ├── sga-performance.ts    # System prompt for SGA Performance
│       │   ├── sgm-analysis.ts       # System prompt for SGM Analysis
│       │   ├── competitive-intel.ts  # System prompt for Competitive Intel
│       │   └── structure-conversion.ts # Pass 2 prompt (narrative → JSON)
│       └── finalize.ts              # Post-generation (save, email)
└── types/
    └── reporting.ts                  # TypeScript types (ReportOutput, ChartSpec, etc.)
```

---

## Implementation Phases

### Phase 1: Structured JSON Foundation (1 week)
1. Define TypeScript types + Zod schemas (`src/types/reporting.ts`, `src/lib/reporting/schema.ts`)
2. Prisma model with `reportJson`, `queryLog`, `extractedMetrics`, `promptVersion`, `ReportConversation`
3. Generate migration SQL for Neon (manual apply via Neon SQL Editor, then `npx prisma generate`)
4. Build `ChartRenderer` and `TableRenderer` components
5. Build `KPICardRow` component
6. Scaffold `ReportDetail` page that renders a hardcoded `ReportOutput` JSON (validates rendering before agent integration)

### Phase 2: Agent Integration (1 week)
1. Port SGM Analysis skill prompt + create Pass 2 structure conversion prompt
2. Wire up `runBigQuery` tool with query log accumulation (factory pattern)
3. API route: `POST /api/reports/generate` with two-pass flow
4. Frontend: Report generator form + progress indicator
5. Test: Generate an SGM Analysis report, verify JSON output renders correctly
6. Port remaining 3 agent prompts
7. Wire up `webSearch` tool for competitive-intel (with FinTrx-aware scoping)

### Phase 3: Conversational Follow-Up (1 week)
1. API route: `POST /api/reports/[id]/follow-up`
2. `buildFollowUpContext()` function with full query log injection
3. `FollowUpChat` component with streaming + inline visual rendering (<<<VISUAL>>> blocks)
4. `getSuggestedFollowUps()` per report type with role-tagged filtering
5. `ReportConversation` persistence (message log, 20-message cap)
6. Test: Generate report → ask follow-up → verify inline chart renders in chat

### Phase 4: PDF Export + Polish + Error UX (3-5 days)
1. Print stylesheet (`print.css`) with `@media print` rules
2. `ExportPDFButton` component using `window.print()`
3. Report library page (list, filter, search)
4. Share modal (`ReportShare` model, user picker)
5. Email notification on completion (exec summary + top 4 KPI metrics)
6. Error UX: handle Pass 2 retry failure gracefully (see Error Handling section)

### Phase 5: Scale & Monitoring (ongoing)
1. Prompt versioning system (store version hash on `ReportJob.promptVersion`)
2. Usage analytics (which reports, how often, follow-up engagement rate)
3. Report scheduling (weekly auto-generation via Vercel cron)
4. Temporal diffing (compare `extractedMetrics` across same-type reports, surface deltas in UI)
5. Integration points: pipe `extractedMetrics` to Coach AI system and Slack bot
6. Server-side PDF export via Puppeteer (only if leadership requests automated/emailed PDFs)
