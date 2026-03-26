// src/components/sga-hub/ClosedLostFollowUpTabs.tsx

'use client';

import { ExternalLink } from 'lucide-react';

const RE_ENGAGEMENT_LIST_URL =
  'https://savvywealth.lightning.force.com/lightning/o/Opportunity/list?filterName=Re_Engagement_Eligible';

const funnelStats = [
  { stage: 'Contact \u2192 MQL', reEngagement: '34.5%', other: '2.2%' },
  { stage: 'MQL \u2192 SQL', reEngagement: '86.7%', other: '23.3%' },
  { stage: 'SQL \u2192 SQO', reEngagement: '76.9%', other: '62.4%' },
  { stage: 'SQO \u2192 Joined', reEngagement: '17.6%', other: '5.0%' },
];

export function ClosedLostFollowUpTabs() {
  return (
    <div className="space-y-6">
      {/* Header & CTA */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
          Re-Engagement Eligible Candidates
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
          The Re-Engagement Eligible list in Salesforce shows all candidates who are eligible to be
          re-engaged. For each candidate you can see whether they have been re-engaged before and how
          many times, who originally owned the opportunity, the original closed-lost reason and
          details, and — if they were re-engaged and closed again — the most recent closed-lost reason
          and details. Use all of that context to parse through and hunt for the advisors you want to
          re-engage.
        </p>
        <a
          href={RE_ENGAGEMENT_LIST_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Open Re-Engagement List in Salesforce
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {/* Why re-engagement works */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Why Re-Engagement Candidates Are Worth Prioritizing
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
          Since SGAs began reaching out to re-engagement candidates in October 2025, this candidate
          pool has dramatically outperformed self-sourced and lead list leads at every stage of the
          funnel. These are advisors who have already expressed interest in Savvy — they know who we
          are, they&apos;ve been through part of the process before, and the data shows they convert at
          significantly higher rates than candidates who are hearing from us for the first time.
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-5">
          The table below compares conversion rates at each funnel stage since October 2025.
          Re-engagement candidates outperform at every step, most dramatically at the top of the
          funnel where Contact-to-MQL rates are nearly 16x higher.
        </p>

        {/* Comparison table */}
        <div className="overflow-x-auto flex justify-center">
          <table className="text-sm" style={{ minWidth: '420px', maxWidth: '540px' }}>
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2.5 pr-4 font-medium text-gray-500 dark:text-gray-400">
                  Funnel Stage
                </th>
                <th className="text-right py-2.5 px-4 font-medium text-gray-500 dark:text-gray-400">
                  Re-Engagement
                </th>
                <th className="text-right py-2.5 pl-4 font-medium text-gray-500 dark:text-gray-400">
                  Self-Sourced &amp; Lead List
                </th>
              </tr>
            </thead>
            <tbody>
              {funnelStats.map((row) => (
                <tr
                  key={row.stage}
                  className="border-b border-gray-100 dark:border-gray-800 last:border-0"
                >
                  <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300">{row.stage}</td>
                  <td className="py-2.5 px-4 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                    {row.reEngagement}
                  </td>
                  <td className="py-2.5 pl-4 text-right text-gray-500 dark:text-gray-400">
                    {row.other}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
