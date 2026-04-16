// packages/analyst-bot/src/app-home.ts
// ============================================================================
// App Home tab builder — renders the persistent Home view in the bot's DM
// ============================================================================
//
// REMINDER: App Home tab must be enabled at api.slack.com → Your App → App Home
// → Show Tabs → Home Tab = ON. This is a one-time manual step in the Slack dashboard.

import type { KnownBlock } from '@slack/types';
import type { ScheduleRecord, ReportRecord } from './types';
import type { ApprovedDMUser } from './dm-access-store';

interface HomeViewOptions {
  recentQueries: Array<{ questionText: string; askedAt: Date }>;
  activeSchedules?: ScheduleRecord[];
}

export function buildHomeView(opts: HomeViewOptions): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // ── Hero ──────────────────────────────────────────────
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: 'Savvy Analyst Bot', emoji: true },
  });
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: 'Ask questions about your recruiting funnel. Results include tables, charts, and XLSX exports.',
    },
  });
  blocks.push({ type: 'divider' });

  // ── Quick Reports ──────────────────────────────────────
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Quick Reports*' },
  });

  // Row 1 — 3 buttons
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: ':chart_with_upwards_trend: Pipeline Summary', emoji: true },
        action_id: 'home_quick_pipeline',
        value: 'Show me a full pipeline summary for this month including SQOs, offers, and joins',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':trophy: SGA Leaderboard', emoji: true },
        action_id: 'home_quick_sga',
        value: 'Show me the SGA leaderboard ranked by SQOs created this month',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':repeat: Funnel Conversion', emoji: true },
        action_id: 'home_quick_funnel',
        value: 'Show me funnel conversion rates by stage for this quarter in cohort mode',
      },
    ],
  });

  // Row 2 — 2 buttons
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: ':calendar: SQOs This Week', emoji: true },
        action_id: 'home_quick_sqos',
        value: 'How many SQOs were created this week and by which SGAs?',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':globe_with_meridians: Leads by Source', emoji: true },
        action_id: 'home_quick_leads',
        value: 'Show me lead volume by source for the last 30 days',
      },
    ],
  });

  blocks.push({ type: 'divider' });

  // ── Scheduled Reports ───────────────────────────────────
  const schedules = opts.activeSchedules ?? [];

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Scheduled Reports*' },
    accessory: {
      type: 'button',
      text: { type: 'plain_text', text: ':memo: New Report', emoji: true },
      action_id: 'open_report_builder',
      style: 'primary' as const,
    },
  });

  if (schedules.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '_No scheduled reports yet. Click New Report to create one._',
      },
    });
  } else {
    for (const schedule of schedules) {
      const frequencyLabel = schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);
      const deliveryLabel = schedule.deliveryType === 'google_doc' ? ':page_facing_up: Google Doc' : ':speech_balloon: Slack DM';
      const nextRun = schedule.nextRunAt
        ? schedule.nextRunAt.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET'
        : 'pending';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${schedule.reportName}*\n${frequencyLabel} · ${deliveryLabel} · Next: ${nextRun}`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Cancel', emoji: false },
          style: 'danger' as const,
          action_id: 'cancel_schedule',
          value: schedule.id,
          confirm: {
            title: { type: 'plain_text', text: 'Cancel this report?' },
            text: { type: 'mrkdwn', text: `This will permanently cancel *"${schedule.reportName}"*. You can recreate it at any time.` },
            confirm: { type: 'plain_text', text: 'Yes, cancel it' },
            deny: { type: 'plain_text', text: 'Keep it' },
          },
        },
      });
    }
  }

  blocks.push({ type: 'divider' });

  // ── Recent Queries ─────────────────────────────────────
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Your Recent Queries*' },
  });

  if (opts.recentQueries.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: "_You haven't asked anything yet. Try a quick report above or @mention me in any channel._",
      },
    });
  } else {
    for (const query of opts.recentQueries) {
      const timeAgo = formatTimeAgo(query.askedAt);
      const truncated = query.questionText.length > 80
        ? query.questionText.substring(0, 77) + '...'
        : query.questionText;

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:clock1: _${timeAgo}_  "${truncated}"`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Ask Again', emoji: false },
          action_id: 'home_ask_again',
          value: query.questionText.substring(0, 2000),
        },
      });
    }
  }

  blocks.push({ type: 'divider' });

  // ── Tips ───────────────────────────────────────────────
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: ':bulb: *Tips:* Ask for charts ("as a pie chart"), exports ("as xlsx"), reports ("generate a report"), or schedule recurring queries. @mention me in any channel.',
    }],
  });

  return blocks;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 172800) return 'Yesterday';
  return `${Math.floor(seconds / 86400)}d`;
}

// ---- Admin App Home View ----

interface AdminHomeViewOptions {
  allSchedules: ScheduleRecord[];
  allReports: ReportRecord[];
  approvedDMUsers: ApprovedDMUser[];
}

/**
 * Build the admin App Home view — shows all schedules across all users
 * with failure state indicators, plus all generated Google Doc reports.
 * Only shown to users in ADMIN_SLACK_USER_IDS.
 */
export function buildAdminHomeView(opts: AdminHomeViewOptions): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // ── Admin Header ───────────────────────────────────────
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: 'Analyst Bot — Admin View', emoji: true },
  });
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Viewing as admin · ${opts.allSchedules.length} active schedules · ${opts.allReports.length} reports`,
    }],
  });
  blocks.push({ type: 'divider' });

  // ── Approved DM Users ─────────────────────────────────
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Approved DM Users* (${opts.approvedDMUsers.length})`,
    },
    accessory: {
      type: 'button',
      text: { type: 'plain_text', text: ':heavy_plus_sign: Add User', emoji: true },
      action_id: 'admin_add_dm_user',
      style: 'primary' as const,
    },
  });

  if (opts.approvedDMUsers.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '_No approved DM users yet. Admins always have DM access._',
      },
    });
  } else {
    for (const user of opts.approvedDMUsers) {
      const label = user.displayName
        ? `<@${user.slackUserId}> (${user.displayName})`
        : `<@${user.slackUserId}>`;
      const addedAgo = formatTimeAgo(user.addedAt);

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${label} · added ${addedAgo} ago by <@${user.addedBy}>`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Remove', emoji: false },
          action_id: 'admin_remove_dm_user',
          style: 'danger' as const,
          value: user.slackUserId,
          confirm: {
            title: { type: 'plain_text', text: 'Remove DM access?' },
            text: {
              type: 'mrkdwn',
              text: `Remove DM access for <@${user.slackUserId}>? They can still use the bot in channels.`,
            },
            confirm: { type: 'plain_text', text: 'Yes, remove' },
            deny: { type: 'plain_text', text: 'Keep' },
          },
        },
      });
    }
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: ':information_source: Admins always have DM access and are not listed here.',
    }],
  });

  blocks.push({ type: 'divider' });

  // ── All Scheduled Reports ──────────────────────────────
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*All Scheduled Reports* (${opts.allSchedules.length} active)`,
    },
  });

  if (opts.allSchedules.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No active schedules._' },
    });
  } else {
    // Group by user_id for display
    const byUser = new Map<string, ScheduleRecord[]>();
    for (const s of opts.allSchedules) {
      const existing = byUser.get(s.userId) ?? [];
      existing.push(s);
      byUser.set(s.userId, existing);
    }

    for (const [userId, schedules] of byUser.entries()) {
      const userLabel = schedules[0].userEmail ?? userId;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${userLabel}*` },
      });

      for (const schedule of schedules) {
        const frequencyLabel = schedule.frequency.charAt(0).toUpperCase() + schedule.frequency.slice(1);
        const deliveryLabel = schedule.deliveryType === 'google_doc' ? ':page_facing_up: Google Doc' : ':speech_balloon: Slack DM';
        const nextRun = schedule.nextRunAt.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET';
        const lastRunText = schedule.lastRunAt
          ? formatTimeAgo(schedule.lastRunAt) + ' ago'
          : 'never run';

        // Failure state indicator
        const failureIndicator = schedule.failureCount >= 2
          ? ` :x: *FAILING (${schedule.failureCount}/3)*`
          : schedule.failureCount === 1
          ? ` :warning: 1 failure`
          : ' :white_check_mark:';

        // Recipients display
        const recipientNames = (schedule.recipients ?? []).map(r => `<@${r.userId}>`);
        const recipientLine = recipientNames.length > 0
          ? `Recipients: ${recipientNames.join(', ')}`
          : '';

        // Convert deliverAtHour to ET display
        const utcMin = schedule.deliverAtHour >= 24 ? schedule.deliverAtHour : schedule.deliverAtHour * 60;
        const etH = ((Math.floor(utcMin / 60) - 4) + 24) % 24;
        const etM = utcMin % 60;
        const etTimeStr = `${etH > 12 ? etH - 12 : etH || 12}:${String(etM).padStart(2, '0')} ${etH >= 12 ? 'PM' : 'AM'} ET`;

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              `*${schedule.reportName}*${failureIndicator}`,
              `${frequencyLabel} · ${deliveryLabel} · ${etTimeStr}`,
              `Last run: ${lastRunText}  |  Next: ${nextRun}`,
              recipientLine,
              `_"${schedule.questionText.substring(0, 80)}${schedule.questionText.length > 80 ? '...' : ''}"_`,
            ].filter(Boolean).join('\n'),
          },
        });

        // Edit + Edit Prompt + Cancel buttons in an actions block
        blocks.push({
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Edit Settings', emoji: true },
              action_id: 'admin_edit_schedule',
              value: schedule.id,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Edit Prompt', emoji: true },
              action_id: 'admin_edit_prompt',
              value: schedule.id,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Cancel', emoji: true },
              action_id: 'admin_cancel_schedule',
              style: 'danger' as const,
              value: schedule.id,
              confirm: {
                title: { type: 'plain_text', text: 'Cancel this schedule?' },
                text: {
                  type: 'mrkdwn',
                  text: `Cancel *"${schedule.reportName}"* for ${userLabel}? This cannot be undone.`,
                },
                confirm: { type: 'plain_text', text: 'Yes, cancel it' },
                deny: { type: 'plain_text', text: 'Keep it' },
              },
            },
          ],
        });
      }
    }
  }

  blocks.push({ type: 'divider' });

  // ── All Generated Reports ──────────────────────────────
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Generated Reports* (last 50)`,
    },
  });

  if (opts.allReports.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No reports generated yet._' },
    });
  } else {
    for (const report of opts.allReports) {
      const userLabel = report.userEmail ?? report.userId;
      const timeAgo = formatTimeAgo(report.createdAt);
      const statusEmoji = report.status === 'done' ? ':white_check_mark:'
        : report.status === 'failed' ? ':x:'
        : report.status === 'running' ? ':hourglass:'
        : ':clock1:';

      const docLink = report.googleDocUrl
        ? `<${report.googleDocUrl}|View Doc>`
        : '_no doc_';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `${statusEmoji} *${report.title}*  ·  ${userLabel}`,
            `${timeAgo} ago  ·  ${docLink}`,
            report.status === 'failed' && report.errorMessage
              ? `_Error: ${report.errorMessage.substring(0, 100)}_`
              : '',
          ].filter(Boolean).join('\n'),
        },
      });
    }
  }

  return blocks;
}
