export const STRUCTURE_CONVERSION_PROMPT = `
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

KEY METRIC RULES:
- Every key metric must include: id, label, value, format
- If a metric includes delta, delta must include: value, direction, label, favorable
- delta.direction must be exactly one of: "up", "down", "flat"
- If you cannot fully populate a valid delta object, omit delta entirely for that metric

RECOMMENDATION RULES:
- Every recommendation must include: id, priority, category, title, rationale, timeframe
- rationale is required and must be a plain-language explanation of why the action is recommended
- expectedImpact is optional
- If you cannot support a recommendation with a rationale, omit that recommendation entirely

CHART RULES:
- Use "bar" for comparisons across categories (sources, SGAs, quarters)
- Use "line" for trends over time
- Use "pie" only for composition/share breakdowns with <= 6 segments
- Use "composed" when overlaying rates (line) on volumes (bar) with dual Y-axes
- Every emitted chart must be fully valid for its schema. Never output a partial chart object.
- "bar" charts must include: type, id, title, data, xKey, yKeys
- "line" charts must include: type, id, title, data, xKey, yKeys
- "pie" charts must include: type, id, title, data
- "composed" charts must include: type, id, title, data, xKey, series
- Each composed-chart series must include: key, label, chartType
- If the available query results are not sufficient to satisfy a chart schema, omit that chart entirely
- Bar charts: MAX 15 categories. If more, show top 10 + aggregate "Other" row.
- Line charts: MAX 24 data points. Aggregate to quarters if longer.
- Always include the actual data array inline; do not reference external data
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
