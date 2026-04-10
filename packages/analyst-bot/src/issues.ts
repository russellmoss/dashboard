// packages/analyst-bot/src/issues.ts
// ============================================================================
// Issue report formatting and posting to #data-issues
// ============================================================================

import { IssueReport } from './types';

/**
 * Format an issue report as Slack Block Kit blocks for #data-issues.
 */
export function formatIssueBlocks(issue: IssueReport): any[] {
  const severityEmoji =
    issue.severity === 'blocking' ? ':rotating_light:' :
    issue.severity === 'needs-attention' ? ':warning:' : ':information_source:';

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':triangular_flag_on_post: Data Issue Report' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Reporter:* <@${issue.reporterSlackId}>` },
        { type: 'mrkdwn', text: `*Severity:* ${severityEmoji} ${issue.severity}` },
        { type: 'mrkdwn', text: `*Thread:* ${issue.threadLink}` },
        { type: 'mrkdwn', text: `*Timestamp:* ${issue.timestamp}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Question asked:*\n${issue.originalQuestion}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*What looks wrong:*\n${issue.whatLooksWrong}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Expected:*\n${issue.whatExpected}` },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Schema context used:*\n${issue.schemaToolsCalled.map((t) => `\u2022 ${t}`).join('\n') || 'None'}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*SQL executed:*\n\`\`\`${issue.sqlExecuted.join('\n---\n') || 'None'}\`\`\``,
      },
    },
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `<@${process.env.MAINTAINER_SLACK_ID}> for review`,
        },
      ],
    },
  ];
}

/**
 * Post an issue report to the #data-issues channel.
 * Takes a Slack WebClient instance (injected from slack.ts for testability).
 */
export async function postIssueToChannel(
  webClient: any,
  issue: IssueReport
): Promise<void> {
  const channel = process.env.ISSUES_CHANNEL;
  if (!channel) {
    console.error('[issues] ISSUES_CHANNEL not set, cannot post issue');
    return;
  }

  try {
    await webClient.chat.postMessage({
      channel,
      blocks: formatIssueBlocks(issue),
      text: `:triangular_flag_on_post: Data issue reported by <@${issue.reporterSlackId}>: ${issue.whatLooksWrong}`,
    });
  } catch (err) {
    console.error('[issues] Failed to post issue to channel:', (err as Error).message);
  }
}
