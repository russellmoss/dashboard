// packages/analyst-bot/src/report-generator.ts
// ============================================================================
// Google Docs report orchestrator: detect intent, plan sections, run through
// Claude pipeline concurrently, assemble into a Google Doc, DM the link.
// ============================================================================

import type { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
import { callClaude } from './claude';
import { processMessage } from './conversation';
import { parseChartBlock, renderChart, stripChartBlocks } from './charts';
import {
  createDoc,
  appendHeading,
  appendParagraph,
  appendTable,
  embedChartImage,
  shareDoc,
} from './google-docs';
import { dmUser } from './dm-helper';
import { createReport, updateReportStatus } from './report-store';
import type { ReportSection, SectionResult } from './types';

// ---- Shared doc formatting utilities (used by both report-generator and schedule-runner) ----

/**
 * Clean raw Claude response text for Google Docs insertion.
 * Strips markdown formatting, Slack emoji codes, code blocks, footers, etc.
 */
export function cleanTextForDoc(text: string): string {
  return text
    // Remove [CHART]...[/CHART], [XLSX]...[/XLSX], [EXPORT_SQL]...[/EXPORT_SQL] blocks
    .replace(/\[CHART\][\s\S]*?\[\/CHART\]/g, '')
    .replace(/\[XLSX\]\s*[\s\S]*?\s*\[\/XLSX\]/g, '')
    .replace(/\[EXPORT_SQL\]\s*[\s\S]*?\s*\[\/EXPORT_SQL\]/g, '')
    // Remove ALL code blocks (tables extracted separately, SQL not needed in doc)
    .replace(/```(?:\w*)\n[\s\S]*?```/g, '')
    // Remove standard markdown pipe tables (extracted separately)
    .replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/g, '')
    // Remove Slack emoji codes :emoji_name:
    .replace(/:[a-z0-9_+-]+:/g, '')
    // Remove the "export xlsx" / "report issue" footer
    .replace(/"export xlsx"[^\n]*/gi, '')
    .replace(/"report issue"[^\n]*/gi, '')
    .replace(/_"export xlsx"[^\n]*/gi, '')
    .replace(/_"report issue"[^\n]*/gi, '')
    // Clean markdown formatting
    .replace(/\*\*(.+?)\*\*/g, '$1')       // **bold** → bold
    .replace(/\*(.+?)\*/g, '$1')            // *italic* → italic
    .replace(/_(.+?)_/g, '$1')              // _italic_ → italic
    .replace(/`([^`]+)`/g, '$1')            // `code` → code
    .replace(/^#{1,3}\s+(.+)$/gm, '$1')    // ### heading → heading
    .replace(/^>\s+/gm, '')                 // > blockquote → plain
    .replace(/^---+$/gm, '')                // --- dividers → remove
    .replace(/^\*\s+/gm, '• ')             // * list item → bullet
    .replace(/^-\s+/gm, '• ')              // - list item → bullet
    .replace(/\n{3,}/g, '\n\n')             // collapse multiple newlines
    .trim();
}

/**
 * Split a section's cleaned text into reader-friendly narrative and technical appendix content.
 * Narrative = the analysis, editorial, and key findings.
 * Appendix = assumptions, filters, field names, SQL references, suggested follow-ups.
 */
export function splitNarrativeAndAppendix(text: string): { narrative: string; appendix: string } {
  const lines = text.split('\n');
  const narrativeLines: string[] = [];
  const appendixLines: string[] = [];
  let inAppendix = false;

  for (const line of lines) {
    const lower = line.toLowerCase().trim();

    // Detect appendix-worthy content
    const isAppendixLine =
      /^(assumptions|key assumptions|filters|filter|technical notes|methodology)[\s:]/i.test(lower) ||
      /^(note:|important:|caveat:)/i.test(lower) ||
      // Lines with field name references (snake_case__c patterns, backtick-wrapped fields)
      /\b\w+__c\b/.test(line) ||
      // Lines mentioning recordtypeid, is_sqo_unique, etc.
      /\b(recordtypeid|is_sqo_unique|is_joined_unique|is_primary_opp_record|eligible_for_|_progression)\b/.test(lower) ||
      // "Suggested follow-up" lines
      /^suggested follow[- ]?up/i.test(lower) ||
      // Lines with SQL-like filter descriptions
      /\bStageName\s+(NOT\s+)?IN\b/i.test(line) ||
      /\bWHERE\b.*\b(AND|OR)\b/i.test(line);

    if (isAppendixLine && !inAppendix) {
      inAppendix = true;
    }

    // Some lines reset back to narrative (Editorial, Results, etc.)
    if (inAppendix && /^(editorial|results|summary|key (findings|takeaways|insights))/i.test(lower)) {
      inAppendix = false;
    }

    if (inAppendix) {
      appendixLines.push(line);
    } else {
      narrativeLines.push(line);
    }
  }

  return {
    narrative: narrativeLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    appendix: appendixLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

/**
 * Parse ALL tables from Claude response text — handles both formats:
 * 1. Code block tables: ```\nSGA | Count\n----|------\nAmy | 34\n```
 * 2. Standard markdown: |SGA|Count|\n|---|---|\n|Amy|34|
 * Returns deduplicated array of table data.
 */
export function extractTablesFromText(text: string): Record<string, any>[][] {
  const tables: Record<string, any>[][] = [];

  // Helper: parse a pipe-delimited table from lines
  function parsePipeTable(lines: string[]): Record<string, any>[] | null {
    if (lines.length < 3) return null;
    let sepIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      if (/^[\s|:\-]+$/.test(lines[i]) && lines[i].includes('-')) {
        sepIdx = i;
        break;
      }
    }
    if (sepIdx < 1) return null;
    const headerLine = lines[sepIdx - 1];
    const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
    if (headers.length < 2) return null;
    const dataLines = lines.slice(sepIdx + 1).filter(l => l.trim() && l.includes('|'));
    if (dataLines.length === 0) return null;
    return dataLines.map(line => {
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      const obj: Record<string, any> = {};
      headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
      return obj;
    });
  }

  // Strategy 1: Extract tables from code blocks
  let textWithoutCodeBlocks = text;
  const codeBlockRegex = /```(?:\w*)\n([\s\S]*?)```/g;
  let cbMatch;
  while ((cbMatch = codeBlockRegex.exec(text)) !== null) {
    const content = cbMatch[1].trim();
    const firstLine = content.split('\n')[0].trim().toUpperCase();
    if (/^(SELECT|WITH|--|\/\*|CREATE|ALTER|INSERT|UPDATE|DELETE|EXPLAIN)\b/.test(firstLine)) continue;
    if (content.includes('|') && /[-]{3,}/.test(content)) {
      const parsed = parsePipeTable(content.split('\n'));
      if (parsed && parsed.length > 0) {
        tables.push(parsed);
        textWithoutCodeBlocks = textWithoutCodeBlocks.replace(cbMatch[0], '');
      }
    }
  }

  // Strategy 2: Standard markdown pipe tables (only in text NOT inside code blocks)
  const mdTableRegex = /\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/g;
  let mdMatch;
  while ((mdMatch = mdTableRegex.exec(textWithoutCodeBlocks)) !== null) {
    const headers = mdMatch[1].split('|').map((h: string) => h.trim()).filter(Boolean);
    const dataRows = mdMatch[2].trim().split('\n').map((row: string) =>
      row.split('|').map((c: string) => c.trim()).filter(Boolean)
    );
    const parsed = dataRows.map((row: string[]) => {
      const obj: Record<string, any> = {};
      headers.forEach((h: string, i: number) => { obj[h] = row[i] ?? ''; });
      return obj;
    });
    if (parsed.length > 0) tables.push(parsed);
  }

  return tables;
}

/**
 * Detect if a user message is a report request.
 *
 * Spec gap #8: The original spec's triggers were too broad ("full analysis").
 * We require the word "report" to be present in the trigger phrase.
 */
const REPORT_PATTERNS = [
  /\bgenerate\s+(?:a\s+)?report\b/i,
  /\bcreate\s+(?:a\s+)?report\b/i,
  /\bwrite\s+(?:me\s+)?(?:a\s+)?report\b/i,
  /\bput\s+together\s+(?:a\s+)?report\b/i,
  /\bbuild\s+(?:me\s+)?(?:a\s+)?report\b/i,
  /\bmulti[- ]section\s+report\b/i,
];

export function isReportRequest(text: string): boolean {
  return REPORT_PATTERNS.some((re) => re.test(text));
}

/**
 * Ask Claude to plan report sections from the user's request.
 * Returns a structured array of sections with titles and questions.
 */
async function planSections(userText: string): Promise<ReportSection[]> {
  const plannerPrompt = `You are a report planner. Given the user request below, produce a JSON array of sections for a data report. Each section has:
- title (string): A clear section heading
- question (string): The specific question to ask the data analyst bot to fill this section

Return ONLY a valid JSON array, no markdown fences, no prose. Limit to 6 sections max.

User request: "${userText}"`;

  const response = await callClaude(
    [{ role: 'user', content: plannerPrompt }],
    { maxTokens: 2048 }
  );

  const jsonText = response.text.trim();

  // Try to parse the JSON (Claude sometimes wraps in ```json ... ```)
  let cleaned = jsonText;
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let sections: Array<{ title: string; question: string }>;
  try {
    sections = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`[report-generator] Failed to parse section plan: ${(err as Error).message}`);
  }

  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error('[report-generator] Section plan returned empty or non-array');
  }

  return sections.slice(0, 6).map((s) => ({
    title: s.title,
    question: s.question,
    status: 'pending' as const,
  }));
}

/**
 * Process a single report section through the Claude pipeline.
 * Captures narrative text, optional chart buffer, and optional table data.
 */
async function processSection(
  section: ReportSection,
  sectionIndex: number,
  userId: string,
  channelId: string
): Promise<SectionResult> {
  // Use a unique thread ID per section to avoid context cross-contamination
  const threadId = `report:${userId}:${Date.now()}:s${sectionIndex}`;

  const result = await processMessage(
    section.question,
    threadId,
    channelId,
    userId
  );

  // Extract all tables using shared utility
  const tables = extractTablesFromText(result.text);

  return {
    title: section.title,
    text: result.text,
    chartBuffer: result.chartBuffer,
    tableData: tables.length > 0 ? tables[0] : null,
    allTables: tables,
  };
}

/**
 * Main report generation orchestrator.
 *
 * 1. Plan sections via Claude
 * 2. Run sections concurrently (max 3 at a time) via processMessage
 * 3. Create Google Doc
 * 4. Assemble sections into doc (heading + narrative + table + chart)
 * 5. Share doc with user
 * 6. Persist report record
 * 7. DM user the link
 */
export async function generateReport(
  client: WebClient,
  userId: string,
  userEmail: string,
  userName: string,
  text: string,
  channelId: string,
  threadTs?: string
): Promise<string> {
  // Create initial report record
  let sections: ReportSection[] = [];
  let reportId: string | null = null;

  try {
    // Step 1: Plan sections
    sections = await planSections(text);

    // Create report record in Neon
    const report = await createReport({
      userId,
      userEmail,
      title: `Report: ${text.substring(0, 100)}`,
      sectionsJson: sections,
    });
    reportId = report.id;

    await updateReportStatus(reportId, 'running', { sectionsJson: sections });

    // Step 2: Run sections concurrently (up to 3 at a time)
    const CONCURRENCY = 3;
    const results: SectionResult[] = [];

    for (let i = 0; i < sections.length; i += CONCURRENCY) {
      const batch = sections.slice(i, i + CONCURRENCY);
      const batchPromises = batch.map((section, batchIdx) =>
        processSection(section, i + batchIdx, userId, channelId)
      );

      const settled = await Promise.allSettled(batchPromises);

      for (let j = 0; j < settled.length; j++) {
        const outcome = settled[j];
        const sectionIdx = i + j;

        if (outcome.status === 'fulfilled') {
          results.push(outcome.value);
          sections[sectionIdx].status = 'done';
          sections[sectionIdx].narrativeText = outcome.value.text.substring(0, 5000);
        } else {
          const errMsg = outcome.reason?.message ?? 'Unknown error';
          console.error(`[report-generator] Section "${sections[sectionIdx].title}" failed:`, errMsg);
          results.push({
            title: sections[sectionIdx].title,
            text: `[Section failed to generate: ${errMsg}]`,
            chartBuffer: null,
            tableData: null,
          });
          sections[sectionIdx].status = 'failed';
          sections[sectionIdx].errorMessage = errMsg;
        }
      }
    }

    // Step 3: Create Google Doc
    const reportTitle = `Report: ${text.substring(0, 80)} — ${new Date().toLocaleDateString()}`;
    const { docId, docUrl } = await createDoc(reportTitle, userName);

    // Step 4: Assemble sections into the doc
    // Main body gets clean narrative + tables + charts.
    // Technical details (assumptions, filters, field names) collected for appendix.
    const appendixEntries: Array<{ title: string; content: string }> = [];

    for (const sectionResult of results) {
      await appendHeading(docId, sectionResult.title, 1);

      // Clean text and split into reader-friendly narrative vs technical appendix
      const cleanText = cleanTextForDoc(sectionResult.text);
      const { narrative, appendix } = splitNarrativeAndAppendix(cleanText);

      // Insert narrative text (analysis, editorial, key findings only)
      if (narrative) {
        await appendParagraph(docId, narrative);
      }

      // Collect appendix content for this section
      if (appendix) {
        appendixEntries.push({ title: sectionResult.title, content: appendix });
      }

      // Insert ALL tables as native Google Doc tables
      const tablesToInsert = sectionResult.allTables ?? (sectionResult.tableData ? [sectionResult.tableData] : []);
      for (const tableData of tablesToInsert) {
        if (tableData.length > 0) {
          const headers = Object.keys(tableData[0]);
          const rows = tableData.map((row) =>
            headers.map((h) => String(row[h] ?? ''))
          );
          await appendTable(docId, headers, rows);
          await appendParagraph(docId, ' '); // spacing after table
        }
      }

      // Embed chart if available
      if (sectionResult.chartBuffer) {
        await embedChartImage(docId, sectionResult.chartBuffer);
      }
    }

    // Step 4b: Add Appendix with technical details
    if (appendixEntries.length > 0) {
      await appendHeading(docId, 'Appendix: Methodology & Assumptions', 1);
      await appendParagraph(docId, 'The following technical details describe the filters, field definitions, and assumptions used to generate each section of this report. Included for traceability and auditability.');

      for (const entry of appendixEntries) {
        await appendHeading(docId, entry.title, 2);
        await appendParagraph(docId, entry.content);
      }
    }

    // Step 5: Share doc with user
    console.log(`[report-generator] Doc assembled: ${docUrl}. Sharing with ${userEmail}...`);
    if (userEmail && !userEmail.endsWith('@unknown')) {
      await shareDoc(docId, userEmail);
    }

    // Step 6: Persist final state
    console.log(`[report-generator] Persisting report status and sending DM to ${userId}...`);
    await updateReportStatus(reportId, 'done', {
      sectionsJson: sections,
      googleDocId: docId,
      googleDocUrl: docUrl,
    });

    // Step 7: Reply in the original thread with the doc link + action buttons
    const completionBlocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:page_facing_up: *Your report is ready!*\n\n<${docUrl}|Open in Google Docs>\n\n_${sections.length} sections · ${sections.filter((s) => s.status === 'done').length} completed · ${sections.filter((s) => s.status === 'failed').length} failed_`,
        },
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: ':calendar: Schedule This', emoji: true },
            action_id: 'open_report_builder',
            value: JSON.stringify({
              prefillQuestion: text.substring(0, 500),
              prefillSql: '',
            }),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: ':triangular_flag_on_post: Report Issue', emoji: true },
            action_id: 'report_issue_action',
            value: JSON.stringify({ threadTs: threadTs ?? '', channelId }),
          },
        ],
      },
    ];

    // Reply in the thread where the user asked
    if (threadTs) {
      try {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `Your report is ready: ${docUrl}`,
          blocks: completionBlocks,
        });
      } catch (err) {
        console.error('[report-generator] Thread reply failed, falling back to DM:', (err as Error).message);
        await dmUser(client, userId, {
          text: `Your report is ready: ${docUrl}`,
          blocks: completionBlocks,
        });
      }
    } else {
      // Fallback to DM if no thread context
      await dmUser(client, userId, {
        text: `Your report is ready: ${docUrl}`,
        blocks: completionBlocks,
      });
    }

    return docUrl;
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error('[report-generator] Report generation failed:', errMsg);

    // Update report status to failed
    if (reportId) {
      await updateReportStatus(reportId, 'failed', { errorMessage: errMsg }).catch(() => {});
    }

    // Notify user about the failure — in thread if possible, DM as fallback
    const errorBlocks: KnownBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:warning: *Report generation failed*\n\n${errMsg.substring(0, 500)}\n\nPlease try again or simplify your request.`,
        },
      } as KnownBlock,
    ];

    if (threadTs) {
      try {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `Sorry, your report failed to generate: ${errMsg}`,
          blocks: errorBlocks,
        });
      } catch {
        await dmUser(client, userId, { text: `Sorry, your report failed to generate: ${errMsg}`, blocks: errorBlocks });
      }
    } else {
      await dmUser(client, userId, { text: `Sorry, your report failed to generate: ${errMsg}`, blocks: errorBlocks });
    }

    throw err;
  }
}
