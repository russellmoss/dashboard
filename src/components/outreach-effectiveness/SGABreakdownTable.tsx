'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Card, Text, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '@tremor/react';
import { Info } from 'lucide-react';
import { SGABreakdownRow } from '@/types/outreach-effectiveness';

interface SGABreakdownTableProps {
  rows: SGABreakdownRow[];
  activeMetric: string;
  onRowClick: (sgaName: string) => void;
  onCellClick: (sgaName: string, columnFilter: string) => void;
}

type SortField = string;
type SortDir = 'asc' | 'desc';

function getSortValue(row: SGABreakdownRow, field: SortField): number | string {
  return (row as any)[field] ?? 0;
}

// ============================================
// COLUMN TOOLTIP
// ============================================

interface TooltipDef {
  title: string;
  items: { label: string; text: string; color: string }[];
}

const COLUMN_TOOLTIPS: Record<string, TooltipDef> = {
  totalAssigned: {
    title: 'Assigned',
    items: [
      { label: 'Definition', text: 'Total leads under this SGA\'s name within the selected date range. This includes leads assigned via marketing campaigns, scored lead lists, AND advisors the SGA self-sourced and put into their own name.', color: 'bg-blue-400' },
      { label: 'Date logic', text: 'Based on FilterDate — the date the lead was created or entered the current cohort, not the date they were assigned to the SGA.', color: 'bg-amber-400' },
    ],
  },
  badLeads: {
    title: 'Bad Leads',
    items: [
      { label: 'Definition', text: 'Leads with a disposition of "Not a Fit", "Bad Contact Info - Uncontacted", "Bad Lead Provided", or "Wrong Phone Number - Contacted".', color: 'bg-red-400' },
      { label: 'Not a Fit', text: 'Determined after a conversation that the advisor isn\'t a good match for Savvy. The SGA did their job — the lead just wasn\'t right.', color: 'bg-amber-400' },
      { label: 'Bad Contact / Wrong Number', text: 'Invalid contact information, bad lead from source, or reached the wrong person. Not an SGA performance issue — it\'s a data quality issue.', color: 'bg-amber-400' },
      { label: 'Impact on metrics', text: 'Bad leads are excluded from persistence, avg touches, and multi-channel metric denominators so they don\'t count against SGAs.', color: 'bg-blue-400' },
    ],
  },
  workedLeads: {
    title: 'Worked',
    items: [
      { label: 'Definition', text: 'Leads where the SGA made at least one outreach attempt.', color: 'bg-blue-400' },
      { label: 'What counts', text: 'Any outbound SMS, LinkedIn, Call, or Email — including automated drip emails. The candidate received it, so it counts.', color: 'bg-green-400' },
      { label: 'Owner filter', text: 'Only touches performed by the current lead owner count, not activity from a previous owner.', color: 'bg-amber-400' },
    ],
  },
  mql: {
    title: 'MQL (Marketing Qualified Lead)',
    items: [
      { label: 'Definition', text: 'Leads that scheduled an initial call with the SGA.', color: 'bg-blue-400' },
      { label: 'What this means', text: 'The lead progressed past the contacting stage into qualification. This is a positive outcome — the SGA got them on the phone.', color: 'bg-green-400' },
    ],
  },
  sql: {
    title: 'SQL (Sales Qualified Lead)',
    items: [
      { label: 'Definition', text: 'Leads that converted to a sales opportunity after the qualification call.', color: 'bg-emerald-400' },
      { label: 'What this means', text: 'The SGA and SGM conducted a qualification call and determined the lead is worth pursuing. This is one step beyond MQL.', color: 'bg-blue-400' },
    ],
  },
  sqo: {
    title: 'SQO (Sales Qualified Opportunity)',
    items: [
      { label: 'Definition', text: 'Leads that became a fully qualified sales opportunity.', color: 'bg-emerald-400' },
      { label: 'What this means', text: 'The highest progression — the lead made it all the way through qualification and is now an active opportunity in the pipeline.', color: 'bg-blue-400' },
    ],
  },
  replied: {
    title: 'Replied / Engaged',
    items: [
      { label: 'Definition', text: 'Leads that showed engagement but haven\'t scheduled a call yet.', color: 'bg-blue-400' },
      { label: 'Inbound activity', text: 'Any inbound SMS or Call back from the lead counts as a reply.', color: 'bg-green-400' },
      { label: 'Dispositions that count', text: '"Not Interested in Moving", "Timing", "No Book", "AUM / Revenue too Low", "Book Not Transferable", "Restrictive Covenants", "Compensation Model Issues", "Interested in M&A", "Wants Platform Only", "Other", and "Withdrawn or Rejected Application" — all imply a conversation happened.', color: 'bg-purple-400' },
      { label: 'What doesn\'t count', text: '"No Show / Ghosted" is NOT a reply — they had a call scheduled but didn\'t show, so they count as unengaged in persistence metrics. "No Response" and "Auto-Closed by Operations" are not replies. "Not a Fit", "Bad Contact Info", "Bad Lead Provided", and "Wrong Phone Number - Contacted" are bad leads (separate column).', color: 'bg-red-400' },
      { label: 'Why it matters', text: 'Replied leads are excluded from persistence/abandonment metrics since the SGA did get a response.', color: 'bg-amber-400' },
    ],
  },
  unengaged: {
    title: 'Unengaged',
    items: [
      { label: 'Definition', text: 'Leads with no signs of engagement — no replies, no calls scheduled, no conversion.', color: 'bg-red-400' },
      { label: 'Why it matters', text: 'These are the leads that persistence, avg touches, and multi-channel metrics focus on. The question is: how thoroughly did the SGA work these leads before giving up?', color: 'bg-amber-400' },
    ],
  },
  terminalUnengagedWorked: {
    title: 'Contacting Unengaged',
    items: [
      { label: 'Who\'s in this number', text: 'Leads the SGA has touched at least once but that have never replied or engaged. Two groups:', color: 'bg-blue-400' },
      { label: 'Currently in contacting', text: 'Leads that are open and sitting in the contacting stage right now with no reply. These are active leads the SGA is still working.', color: 'bg-green-400' },
      { label: 'Closed without engaging', text: 'Leads that were in contacting, got outreach, but closed without ever replying or scheduling a call. The SGA worked them and moved on.', color: 'bg-amber-400' },
      { label: 'Who\'s NOT included', text: 'Leads that moved to MQL are excluded — if they scheduled a call, they did engage. Bad leads (Not a Fit, Bad Contact Info, Wrong Number) are also excluded since those aren\'t SGA performance issues.', color: 'bg-red-400' },
      { label: 'Why this matters', text: 'This is the denominator for avg touchpoints, 5+ touches %, and multi-channel coverage. It answers: "Of the leads the SGA worked that didn\'t respond, how thoroughly did they try?"', color: 'bg-purple-400' },
    ],
  },
  zeroTouchCount: {
    title: 'Zero-Touch',
    items: [
      { label: 'Definition', text: 'Leads with zero tracked outbound activity from their current owner.', color: 'bg-red-400' },
      { label: 'Stale vs All', text: 'In "Stale" mode (default), only shows leads that are already closed or have been untouched for 30+ days. In "All" mode, shows every zero-touch lead regardless of age. Toggle is on the scorecard.', color: 'bg-blue-400' },
      { label: 'Excluded leads', text: 'Ghost contacts, bad leads (Not a Fit, Bad Contact Info, Wrong Number, Bad Lead Provided), replied leads, and "No Response" leads are all excluded.', color: 'bg-amber-400' },
    ],
  },
};

function ColumnTooltip({ tooltip }: { tooltip: TooltipDef }) {
  const [show, setShow] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!show) return;
    const handler = (e: MouseEvent) => {
      if (
        tooltipRef.current && !tooltipRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setShow(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShow(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [show]);

  // Position using fixed coords relative to the button
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!show || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - 140; // center a 280px tooltip
    // Clamp to viewport
    if (left < 8) left = 8;
    if (left + 280 > window.innerWidth - 8) left = window.innerWidth - 288;
    setPos({ top: rect.bottom + 6, left });
  }, [show]);

  return (
    <span className="inline-block ml-1 align-middle">
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setShow(!show);
        }}
        className="p-0 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
      >
        <Info className="w-3 h-3 text-gray-400 dark:text-gray-500 inline" />
      </button>
      {show && pos && (
        <div
          ref={tooltipRef}
          className="fixed z-[100] w-[280px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl"
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-3">
            <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 mb-2 uppercase tracking-wide">
              {tooltip.title}
            </div>
            <div className="space-y-2">
              {tooltip.items.map((item, i) => (
                <div key={i} className={`flex gap-2 ${i > 0 ? 'pt-2 border-t border-gray-100 dark:border-gray-700' : ''}`}>
                  <div className={`w-1 rounded-full shrink-0 self-stretch ${item.color}`} />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-gray-700 dark:text-gray-300">
                      {item.label}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed whitespace-normal break-words">
                      {item.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

// ============================================
// CLICKABLE CELL
// ============================================

function ClickableCell({
  sgaName,
  filter,
  value,
  onCellClick,
}: {
  sgaName: string;
  filter: string;
  value: number;
  onCellClick: (sgaName: string, columnFilter: string) => void;
}) {
  return (
    <TableCell className="text-center">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (value > 0) onCellClick(sgaName, filter);
        }}
        className={`${
          value > 0
            ? 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline decoration-dotted underline-offset-2 cursor-pointer'
            : 'text-gray-400 dark:text-gray-500 cursor-default'
        }`}
        disabled={value === 0}
      >
        {value}
      </button>
    </TableCell>
  );
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function SGABreakdownTable({ rows, activeMetric, onRowClick, onCellClick }: SGABreakdownTableProps) {
  const [sortField, setSortField] = useState<SortField>('avgInitialPerWeek');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aVal = getSortValue(a, sortField);
      const bVal = getSortValue(b, sortField);
      const cmp = typeof aVal === 'string' ? aVal.localeCompare(bVal as string) : (aVal as number) - (bVal as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortField, sortDir]);

  const SortHeader = ({ field, label, tooltip, alignLeft }: { field: SortField; label: string; tooltip?: TooltipDef; alignLeft?: boolean }) => (
    <TableHeaderCell
      className={`cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 whitespace-nowrap ${alignLeft ? '' : 'text-center'}`}
      onClick={() => handleSort(field)}
    >
      {label}{tooltip && <ColumnTooltip tooltip={tooltip} />} {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </TableHeaderCell>
  );

  // Common columns
  const commonHeaders = (
    <>
      <SortHeader field="sgaName" label="SGA" alignLeft />
      <SortHeader field="totalAssigned" label="Assigned" tooltip={COLUMN_TOOLTIPS.totalAssigned} />
      <SortHeader field="workedLeads" label="Worked" tooltip={COLUMN_TOOLTIPS.workedLeads} />
      <SortHeader field="badLeads" label="Bad Leads" tooltip={COLUMN_TOOLTIPS.badLeads} />
      <SortHeader field="mql" label="MQL" tooltip={COLUMN_TOOLTIPS.mql} />
      <SortHeader field="sql" label="SQL" tooltip={COLUMN_TOOLTIPS.sql} />
      <SortHeader field="sqo" label="SQO" tooltip={COLUMN_TOOLTIPS.sqo} />
      <SortHeader field="replied" label="Replied" tooltip={COLUMN_TOOLTIPS.replied} />
    </>
  );

  const renderMetricHeaders = () => {
    switch (activeMetric) {
      case 'persistence':
        return (
          <>
            <SortHeader field="terminalUnengagedWorked" label="Contacting Unengaged" tooltip={COLUMN_TOOLTIPS.terminalUnengagedWorked} />
            <SortHeader field="avgTouchpoints" label="Avg Touches" />
            <SortHeader field="fivePlusTouches" label="5+ Touches" />
            <SortHeader field="pct5Plus" label="% 5+" />
            <SortHeader field="prematureCount" label="<5 Touches" />
            <SortHeader field="prematureRate" label="% Premature" />
          </>
        );
      case 'multi-channel':
        return (
          <>
            <SortHeader field="pct2PlusChannels" label="2+ Ch %" />
            <SortHeader field="pct3PlusChannels" label="3+ Ch %" />
            <SortHeader field="pctAllChannels" label="All 4 %" />
            <SortHeader field="smsPct" label="SMS %" />
            <SortHeader field="linkedInPct" label="LinkedIn %" />
            <SortHeader field="callPct" label="Call %" />
            <SortHeader field="emailPct" label="Email %" />
          </>
        );
      case 'zero-touch':
        return (
          <>
            <SortHeader field="zeroTouchCount" label="Zero-Touch" tooltip={COLUMN_TOOLTIPS.zeroTouchCount} />
            <SortHeader field="zeroTouchPct" label="% Zero-Touch" />
            <SortHeader field="zeroTouchClosed" label="Closed" />
          </>
        );
      case 'avg-calls':
      default:
        return (
          <>
            <SortHeader field="eligibleWeeks" label="Weeks" />
            <SortHeader field="totalInitialCalls" label="Total IC" />
            <SortHeader field="avgInitialPerWeek" label="Avg IC/Wk" />
            <SortHeader field="totalQualCalls" label="Total QC" />
            <SortHeader field="avgQualPerWeek" label="Avg QC/Wk" />
          </>
        );
    }
  };

  const renderMetricCells = (row: SGABreakdownRow) => {
    switch (activeMetric) {
      case 'persistence':
        return (
          <>
            <ClickableCell sgaName={row.sgaName} filter="terminalUnengaged" value={row.terminalUnengagedWorked} onCellClick={onCellClick} />
            <TableCell className="text-center">{row.avgTouchpoints.toFixed(1)}</TableCell>
            <ClickableCell sgaName={row.sgaName} filter="fivePlus" value={row.fivePlusTouches} onCellClick={onCellClick} />
            <TableCell className="text-center">{row.pct5Plus}%</TableCell>
            <ClickableCell sgaName={row.sgaName} filter="premature" value={row.prematureCount} onCellClick={onCellClick} />
            <TableCell className="text-center">{row.prematureRate}%</TableCell>
          </>
        );
      case 'multi-channel':
        return (
          <>
            <TableCell className="text-center">{row.pct2PlusChannels}%</TableCell>
            <TableCell className="text-center">{row.pct3PlusChannels}%</TableCell>
            <TableCell className="text-center">{row.pctAllChannels}%</TableCell>
            <TableCell className="text-center">{row.smsPct}%</TableCell>
            <TableCell className="text-center">{row.linkedInPct}%</TableCell>
            <TableCell className="text-center">{row.callPct}%</TableCell>
            <TableCell className="text-center">{row.emailPct}%</TableCell>
          </>
        );
      case 'zero-touch':
        return (
          <>
            <ClickableCell sgaName={row.sgaName} filter="zeroTouchOpen" value={row.zeroTouchCount} onCellClick={onCellClick} />
            <TableCell className="text-center">{row.zeroTouchPct}%</TableCell>
            <ClickableCell sgaName={row.sgaName} filter="zeroTouchClosed" value={row.zeroTouchClosed} onCellClick={onCellClick} />
          </>
        );
      case 'avg-calls':
      default:
        return (
          <>
            <TableCell className="text-center">{row.eligibleWeeks}</TableCell>
            <TableCell className="text-center">{row.totalInitialCalls}</TableCell>
            <TableCell className="text-center font-semibold">{row.avgInitialPerWeek.toFixed(2)}</TableCell>
            <TableCell className="text-center">{row.totalQualCalls}</TableCell>
            <TableCell className="text-center font-semibold">{row.avgQualPerWeek.toFixed(2)}</TableCell>
          </>
        );
    }
  };

  return (
    <Card>
      <Text className="text-lg font-semibold mb-4">SGA Breakdown</Text>
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow>
              {commonHeaders}
              {renderMetricHeaders()}
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRows.map((row) => (
              <TableRow
                key={row.sgaName}
                className={activeMetric === 'avg-calls' ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50' : ''}
                onClick={activeMetric === 'avg-calls' ? () => onRowClick(row.sgaName) : undefined}
              >
                <TableCell className="font-medium">{row.sgaName}</TableCell>
                <ClickableCell sgaName={row.sgaName} filter="assigned" value={row.totalAssigned} onCellClick={onCellClick} />
                <ClickableCell sgaName={row.sgaName} filter="worked" value={row.workedLeads} onCellClick={onCellClick} />
                <ClickableCell sgaName={row.sgaName} filter="badLeads" value={row.badLeads} onCellClick={onCellClick} />
                <ClickableCell sgaName={row.sgaName} filter="mql" value={row.mql} onCellClick={onCellClick} />
                <ClickableCell sgaName={row.sgaName} filter="sql" value={row.sql} onCellClick={onCellClick} />
                <ClickableCell sgaName={row.sgaName} filter="sqo" value={row.sqo} onCellClick={onCellClick} />
                <ClickableCell sgaName={row.sgaName} filter="replied" value={row.replied} onCellClick={onCellClick} />
                {renderMetricCells(row)}
              </TableRow>
            ))}
            {sortedRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={20}>
                  <Text className="text-center text-gray-500 py-4">No data available</Text>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
