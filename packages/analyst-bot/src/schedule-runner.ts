// packages/analyst-bot/src/schedule-runner.ts
// ============================================================================
// Cron handler: run all due schedules and DM results to users
// ============================================================================

import type { WebClient } from '@slack/web-api';
import type { KnownBlock } from '@slack/types';
import { getDueSchedules, markScheduleRun } from './schedule-store';
import { runExportQuery } from './bq-query';
import { processMessage } from './conversation';
import { cleanTextForDoc, extractTablesFromText, splitNarrativeAndAppendix, isReportRequest, generateReport } from './report-generator';
import {
  createDoc, appendHeading, appendParagraph, appendTable, embedChartImage, shareDoc,
} from './google-docs';
import { dmUser } from './dm-helper';
import type { ScheduleRecord } from './types';

/**
 * Format query result rows as a simple text table for Slack DM.
 * Handles 0 rows, capped at 20 rows for readability.
 */
function formatResultsAsText(rows: Record<string, any>[]): string {
  if (rows.length === 0) return '';

  const keys = Object.keys(rows[0]);
  const displayRows = rows.slice(0, 20);

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const key of keys) {
    widths[key] = key.length;
    for (const row of displayRows) {
      const val = String(row[key] ?? '');
      widths[key] = Math.max(widths[key], val.length);
    }
  }

  // Build text table
  const header = keys.map((k) => k.padEnd(widths[k])).join(' | ');
  const separator = keys.map((k) => '-'.repeat(widths[k])).join('-+-');
  const dataLines = displayRows.map((row) =>
    keys.map((k) => String(row[k] ?? '').padEnd(widths[k])).join(' | ')
  );

  let table = `\`\`\`\n${header}\n${separator}\n${dataLines.join('\n')}\n\`\`\``;
  if (rows.length > 20) {
    table += `\n_...and ${rows.length - 20} more rows_`;
  }
  return table;
}

/**
 * Run a schedule that delivers via Google Doc.
 * Runs the question through the Claude pipeline, creates a Google Doc with
 * the results (narrative + tables + charts), shares it, and DMs the link.
 */
async function runGoogleDocSchedule(
  client: WebClient,
  schedule: ScheduleRecord
): Promise<{ success: boolean; error?: string }> {
  try {
    const question = schedule.frozenSql.startsWith('QUESTION:')
      ? schedule.frozenSql.substring('QUESTION:'.length)
      : schedule.questionText;

    // If the question is a report-intent prompt ("generate a report..."),
    // route through the full multi-section report generator instead of
    // single processMessage. This creates a proper multi-section Google Doc.
    if (isReportRequest(question)) {
      const userName = schedule.userEmail?.split('@')[0] ?? schedule.userId;
      console.log(`[schedule-runner] Routing Google Doc schedule ${schedule.id} through multi-section report generator`);

      const docUrl = await generateReport(
        client, schedule.userId,
        schedule.userEmail ?? `${schedule.userId}@unknown`,
        userName, question,
        schedule.userId, // channelId — DM channel, used for processMessage context
      );

      // Also DM additional recipients
      for (const recipient of (schedule.recipients ?? [])) {
        await dmUser(client, recipient.userId, {
          text: `Scheduled report "${schedule.reportName}" is ready: ${docUrl}`,
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:calendar: *Scheduled Report: ${schedule.reportName}*\n\n:page_facing_up: <${docUrl}|Open in Google Docs>`,
            },
          }] as KnownBlock[],
        });
        if (recipient.email) await shareDoc(docUrl.split('/d/')[1]?.split('/')[0] ?? '', recipient.email);
      }

      await markScheduleRun(schedule.id);
      return { success: true };
    }

    // For non-report questions, run single processMessage and build doc manually
    const threadId = `schedule:${schedule.id}:${Date.now()}`;
    const result = await processMessage(question, threadId, schedule.userId, schedule.userId);

    // Resolve user name for folder
    const userName = schedule.userEmail?.split('@')[0] ?? schedule.userId;
    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const docTitle = `${schedule.reportName} — ${dateStr}`;

    // Create Google Doc
    const { docId, docUrl } = await createDoc(docTitle, userName);

    // Add heading
    await appendHeading(docId, schedule.reportName, 1);

    // Clean text and split into narrative vs appendix
    const cleanText = cleanTextForDoc(result.text);
    const { narrative, appendix } = splitNarrativeAndAppendix(cleanText);

    if (narrative) {
      await appendParagraph(docId, narrative);
    }

    // Extract and insert all tables as native Doc tables
    const tables = extractTablesFromText(result.text);
    for (const tableData of tables) {
      if (tableData.length > 0) {
        const headers = Object.keys(tableData[0]);
        const rows = tableData.map((row) => headers.map((h) => String(row[h] ?? '')));
        await appendTable(docId, headers, rows);
        await appendParagraph(docId, ' ');
      }
    }

    // Add appendix if there are technical details
    if (appendix) {
      await appendHeading(docId, 'Appendix: Methodology & Assumptions', 2);
      await appendParagraph(docId, appendix);
    }

    // Embed chart if generated
    if (result.chartBuffer) {
      await embedChartImage(docId, result.chartBuffer);
    }

    // Share with creator
    if (schedule.userEmail && !schedule.userEmail.endsWith('@unknown')) {
      await shareDoc(docId, schedule.userEmail);
    }

    // Share with all additional recipients
    for (const recipient of (schedule.recipients ?? [])) {
      if (recipient.email) {
        await shareDoc(docId, recipient.email);
      }
    }

    // DM the creator
    const docBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:calendar: *Scheduled Report: ${schedule.reportName}*\n\n:page_facing_up: <${docUrl}|Open in Google Docs>\n\n_${schedule.frequency} · ${result.provenanceQueryCount} queries_`,
      },
    };

    await dmUser(client, schedule.userId, {
      text: `Your scheduled report "${schedule.reportName}" is ready: ${docUrl}`,
      blocks: [docBlock] as KnownBlock[],
    });

    // DM all additional recipients
    for (const recipient of (schedule.recipients ?? [])) {
      await dmUser(client, recipient.userId, {
        text: `Scheduled report "${schedule.reportName}" is ready: ${docUrl}`,
        blocks: [docBlock] as KnownBlock[],
      });
    }

    await markScheduleRun(schedule.id);
    return { success: true };
  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error(`[schedule-runner] Google Doc schedule ${schedule.id} failed:`, errorMsg);
    throw err; // re-throw so the outer handler can DM the failure
  }
}

/**
 * Run a single schedule: execute frozen SQL, format results, DM user.
 */
async function runSingleSchedule(
  client: WebClient,
  schedule: ScheduleRecord
): Promise<{ success: boolean; error?: string }> {
  try {
    // Route to Google Doc delivery if configured
    if (schedule.deliveryType === 'google_doc') {
      return await runGoogleDocSchedule(client, schedule);
    }
    // If frozenSql starts with "QUESTION:", it's a natural language fallback —
    // run through the full Claude pipeline instead of raw SQL.
    if (schedule.frozenSql.startsWith('QUESTION:')) {
      const question = schedule.frozenSql.substring('QUESTION:'.length);
      const threadId = `schedule:${schedule.id}:${Date.now()}`;
      const convResult = await processMessage(question, threadId, schedule.userId, schedule.userId);

      await dmUser(client, schedule.userId, {
        text: `Your scheduled report: ${schedule.reportName}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:calendar: *Scheduled Report: ${schedule.reportName}*`,
            },
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: convResult.text.substring(0, 3000),
            },
          },
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: `:repeat: _${schedule.frequency}_ · ${convResult.provenanceQueryCount} queries`,
            }],
          },
        ] as KnownBlock[],
      });

      await markScheduleRun(schedule.id);
      return { success: true };
    }

    const result = await runExportQuery(schedule.frozenSql);

    if (result.rows.length === 0) {
      // Spec gap #5: handle 0-row results
      await dmUser(client, schedule.userId, {
        text: `Your scheduled report "${schedule.questionText}" returned no results this run.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:calendar: *Scheduled Report: No Results*\n\nYour report _"${schedule.questionText}"_ ran but returned no data this period.`,
            },
          },
        ] as KnownBlock[],
      });
    } else {
      const tableText = formatResultsAsText(result.rows);
      await dmUser(client, schedule.userId, {
        text: `Your scheduled report: ${schedule.questionText}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:calendar: *Scheduled Report*\n*${schedule.questionText}*`,
            },
          },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: tableText,
            },
          },
          {
            type: 'context',
            elements: [{
              type: 'mrkdwn',
              text: `:repeat: _${schedule.frequency}_ · ${result.rows.length} rows · ${(result.bytesProcessed / 1048576).toFixed(1)} MB scanned`,
            }],
          },
        ] as KnownBlock[],
      });
    }

    // DM all additional recipients (same content as creator got)
    for (const recipient of (schedule.recipients ?? [])) {
      // Re-run the DM for each recipient with the same result
      if (result.rows.length > 0) {
        const tableText = formatResultsAsText(result.rows);
        await dmUser(client, recipient.userId, {
          text: `Scheduled report: ${schedule.reportName}`,
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: `:calendar: *Scheduled Report: ${schedule.reportName}*` } },
            { type: 'divider' },
            { type: 'section', text: { type: 'mrkdwn', text: tableText } },
          ] as KnownBlock[],
        });
      }
    }

    // Update schedule timestamps
    await markScheduleRun(schedule.id);
    return { success: true };
  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error(`[schedule-runner] Schedule ${schedule.id} failed:`, errorMsg);

    // DM the user about the failure
    await dmUser(client, schedule.userId, {
      text: `Your scheduled report failed: ${errorMsg}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:warning: *Scheduled Report Failed*\n\nYour report _"${schedule.questionText}"_ encountered an error:\n\`${errorMsg.substring(0, 500)}\``,
          },
        },
      ] as KnownBlock[],
    });

    // Still advance the schedule so it doesn't retry forever
    try {
      await markScheduleRun(schedule.id);
    } catch {
      // Non-critical
    }

    return { success: false, error: errorMsg };
  }
}

/**
 * Main cron entry point: find all due schedules and run them.
 * Called by the /internal/run-schedules endpoint.
 *
 * Returns a summary of results for the HTTP response.
 */
export async function runDueSchedules(
  client: WebClient
): Promise<{ ran: number; succeeded: number; failed: number }> {
  const due = await getDueSchedules();
  console.log(`[schedule-runner] Found ${due.length} due schedules`);

  if (due.length === 0) {
    return { ran: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  // Run schedules sequentially to avoid overwhelming BQ / Slack rate limits
  for (const schedule of due) {
    const result = await runSingleSchedule(client, schedule);
    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  console.log(`[schedule-runner] Complete: ${succeeded} succeeded, ${failed} failed out of ${due.length}`);
  return { ran: due.length, succeeded, failed };
}
