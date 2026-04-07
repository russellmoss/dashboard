// src/components/dashboard/ActivityTimeline.tsx

'use client';

import React, { useState } from 'react';
import {
  MessageSquare,
  Phone,
  Mail,
  Linkedin,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
  Users,
  Video,
  MoreHorizontal,
  Megaphone,
  Bell,
} from 'lucide-react';
import { ActivityRecord } from '@/types/record-activity';
import { formatDate } from '@/lib/utils/format-helpers';

interface ActivityTimelineProps {
  activities: ActivityRecord[];
  loading?: boolean;
}

/** Channel icon and color config */
const CHANNEL_CONFIG: Record<string, {
  icon: React.ElementType;
  bgColor: string;
  textColor: string;
  label: string;
}> = {
  'SMS': {
    icon: MessageSquare,
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    textColor: 'text-green-700 dark:text-green-300',
    label: 'SMS',
  },
  'Call': {
    icon: Phone,
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    textColor: 'text-blue-700 dark:text-blue-300',
    label: 'Call',
  },
  'LinkedIn': {
    icon: Linkedin,
    bgColor: 'bg-sky-100 dark:bg-sky-900/30',
    textColor: 'text-sky-700 dark:text-sky-300',
    label: 'LinkedIn',
  },
  'Email': {
    icon: Mail,
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    textColor: 'text-purple-700 dark:text-purple-300',
    label: 'Email',
  },
  'Email (Manual)': {
    icon: Mail,
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    textColor: 'text-purple-700 dark:text-purple-300',
    label: 'Email',
  },
  'Email (Campaign)': {
    icon: Megaphone,
    bgColor: 'bg-violet-100 dark:bg-violet-900/30',
    textColor: 'text-violet-700 dark:text-violet-300',
    label: 'Campaign Email',
  },
  'Email (Blast)': {
    icon: Megaphone,
    bgColor: 'bg-violet-100 dark:bg-violet-900/30',
    textColor: 'text-violet-700 dark:text-violet-300',
    label: 'Blast Email',
  },
  'Email (Engagement)': {
    icon: Mail,
    bgColor: 'bg-pink-100 dark:bg-pink-900/30',
    textColor: 'text-pink-700 dark:text-pink-300',
    label: 'Email Click',
  },
  'Meeting': {
    icon: Video,
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    textColor: 'text-amber-700 dark:text-amber-300',
    label: 'Meeting',
  },
  'Reminder': {
    icon: Bell,
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    textColor: 'text-yellow-700 dark:text-yellow-300',
    label: 'Reminder',
  },
  'Marketing': {
    icon: Megaphone,
    bgColor: 'bg-orange-100 dark:bg-orange-900/30',
    textColor: 'text-orange-700 dark:text-orange-300',
    label: 'Marketing',
  },
  'Other': {
    icon: MoreHorizontal,
    bgColor: 'bg-gray-100 dark:bg-gray-700',
    textColor: 'text-gray-700 dark:text-gray-300',
    label: 'Other',
  },
};

function getChannelConfig(channel: string) {
  return CHANNEL_CONFIG[channel] || CHANNEL_CONFIG['Other'];
}

function formatCallDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatActivityTime(estDatetime: string): string {
  if (!estDatetime) return '';
  // The EST datetime comes as "YYYY-MM-DD HH:MM:SS" or similar
  try {
    const d = new Date(estDatetime + (estDatetime.includes('T') ? '' : ' UTC'));
    // Since we already have EST from the query, just format the time portion
    // Parse the raw string to extract time
    const match = estDatetime.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      const hour = parseInt(match[1]);
      const minute = match[2];
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      return `${displayHour}:${minute} ${ampm} ET`;
    }
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function groupActivitiesByDate(activities: ActivityRecord[]): Map<string, ActivityRecord[]> {
  const groups = new Map<string, ActivityRecord[]>();
  for (const activity of activities) {
    // Use the EST datetime to extract the date for grouping
    const dateKey = activity.createdDateEst?.substring(0, 10) || activity.createdDate?.substring(0, 10) || 'Unknown';
    const existing = groups.get(dateKey) || [];
    existing.push(activity);
    groups.set(dateKey, existing);
  }
  return groups;
}

/** Loading skeleton for the activity timeline */
function ActivityTimelineSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {[1, 2, 3].map((g) => (
        <div key={g}>
          <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
          {[1, 2].map((i) => (
            <div key={i} className="flex gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-3 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Single activity item in the timeline */
function ActivityItem({ activity }: { activity: ActivityRecord }) {
  const [expanded, setExpanded] = useState(false);
  const config = getChannelConfig(activity.activityChannel);
  const Icon = config.icon;
  const isInbound = activity.direction === 'Inbound';
  const DirectionIcon = isInbound ? ArrowDownLeft : ArrowUpRight;
  const callDuration = formatCallDuration(activity.callDurationSeconds);
  const time = formatActivityTime(activity.createdDateEst);

  return (
    <div className="flex gap-3 py-2.5 group">
      {/* Channel icon */}
      <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${config.bgColor}`}>
        <Icon className={`w-4 h-4 ${config.textColor}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Channel badge */}
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.textColor}`}>
            {config.label}
          </span>
          {/* Direction badge */}
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium ${
            isInbound
              ? 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-300'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
          }`}>
            <DirectionIcon className="w-3 h-3" />
            {isInbound ? 'Inbound' : 'Outbound'}
          </span>
          {/* Meaningful connect indicator */}
          {activity.isMeaningfulConnect && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300">
              Connected
            </span>
          )}
          {/* Call duration */}
          {callDuration && (
            <span className="inline-flex items-center gap-0.5 text-xs text-gray-500 dark:text-gray-400">
              <Clock className="w-3 h-3" />
              {callDuration}
            </span>
          )}
        </div>

        {/* Subject */}
        <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5 truncate">
          {activity.subject}
        </p>

        {/* Executor and time */}
        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {activity.executorName}
          </span>
          <span>{time}</span>
        </div>

        {/* SMS message preview (expandable) */}
        {activity.messagePreview && (
          <div className="mt-1.5">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? 'Hide message' : 'Show message'}
            </button>
            {expanded && (
              <div className="mt-1 p-2.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {activity.messagePreview}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Summary stats bar at the top of the timeline */
function ActivitySummary({ activities }: { activities: ActivityRecord[] }) {
  // Exclude reminders (lemlist task reminders) from all counts
  const realActivities = activities.filter(a => a.activityChannelGroup !== 'Reminder');
  const outbound = realActivities.filter(a => a.direction === 'Outbound').length;
  const inbound = realActivities.filter(a => a.direction === 'Inbound').length;

  // Count by channel group
  const channelCounts: Record<string, number> = {};
  for (const a of realActivities) {
    const group = a.activityChannelGroup;
    channelCounts[group] = (channelCounts[group] || 0) + 1;
  }

  const meaningfulConnects = realActivities.filter(a => a.isMeaningfulConnect).length;

  return (
    <div className="flex flex-wrap gap-3 mb-4 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 dark:text-gray-400">Total:</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{realActivities.length}</span>
      </div>
      <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 self-center" />
      <div className="flex items-center gap-1.5">
        <ArrowUpRight className="w-3 h-3 text-gray-500" />
        <span className="text-xs text-gray-500 dark:text-gray-400">Outbound:</span>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{outbound}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <ArrowDownLeft className="w-3 h-3 text-cyan-500" />
        <span className="text-xs text-gray-500 dark:text-gray-400">Inbound:</span>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{inbound}</span>
      </div>
      {meaningfulConnects > 0 && (
        <>
          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 self-center" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400">Connects:</span>
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{meaningfulConnects}</span>
          </div>
        </>
      )}
      <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 self-center" />
      {Object.entries(channelCounts)
        .filter(([ch]) => ch !== 'Marketing' && ch !== 'Other' && ch !== 'Email (Engagement)' && ch !== 'Reminder')
        .sort(([, a], [, b]) => b - a)
        .map(([channel, count]) => {
          const cfg = getChannelConfig(channel);
          return (
            <div key={channel} className="flex items-center gap-1">
              <span className={`text-xs ${cfg.textColor}`}>{cfg.label}:</span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{count}</span>
            </div>
          );
        })}
    </div>
  );
}

export function ActivityTimeline({ activities, loading }: ActivityTimelineProps) {
  const [directionFilter, setDirectionFilter] = useState<'all' | 'outbound' | 'inbound' | 'reminders'>('all');
  const [executorFilter, setExecutorFilter] = useState<string>('all');

  if (loading) {
    return <ActivityTimelineSkeleton />;
  }

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
        <Calendar className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">No activity found for this record</p>
      </div>
    );
  }

  // Get unique executors for filter
  const executors = Array.from(new Set(activities.map(a => a.executorName))).sort();
  const showExecutorFilter = executors.length > 1;

  // Separate reminders from real activities
  const reminders = activities.filter(a => a.activityChannelGroup === 'Reminder');
  const nonReminders = activities.filter(a => a.activityChannelGroup !== 'Reminder');

  // Apply both filters
  const filtered = activities.filter(a => {
    const isReminder = a.activityChannelGroup === 'Reminder';
    if (directionFilter === 'reminders' && !isReminder) return false;
    if (directionFilter === 'all' && isReminder) return false;
    if (directionFilter === 'outbound' && (a.direction !== 'Outbound' || isReminder)) return false;
    if (directionFilter === 'inbound' && (a.direction !== 'Inbound' || isReminder)) return false;
    if (executorFilter !== 'all' && a.executorName !== executorFilter) return false;
    return true;
  });

  const grouped = groupActivitiesByDate(filtered);

  return (
    <div>
      <ActivitySummary activities={activities} />

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Direction filter */}
        <div className="flex gap-1">
          {(['all', 'outbound', 'inbound', ...(reminders.length > 0 ? ['reminders' as const] : [])] as const).map((f) => (
            <button
              key={f}
              onClick={() => setDirectionFilter(f)}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                directionFilter === f
                  ? f === 'reminders'
                    ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300'
                    : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {f === 'all' ? `All (${nonReminders.length})` : f === 'outbound' ? `Outbound (${nonReminders.filter(a => a.direction === 'Outbound').length})` : f === 'inbound' ? `Inbound (${nonReminders.filter(a => a.direction === 'Inbound').length})` : `Reminders (${reminders.length})`}
            </button>
          ))}
        </div>

        {/* Executor filter — only show when multiple executors exist */}
        {showExecutorFilter && (
          <>
            <div className="w-px h-5 bg-gray-300 dark:bg-gray-600" />
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-gray-400" />
              <select
                value={executorFilter}
                onChange={(e) => setExecutorFilter(e.target.value)}
                className="text-xs font-semibold bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-500 rounded-full px-2.5 py-1 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                <option value="all">All Executors ({executors.length})</option>
                {executors.map((name) => {
                  const count = activities.filter(a => a.executorName === name).length;
                  return (
                    <option key={name} value={name}>
                      {name} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
          </>
        )}

        {/* Active filter count */}
        {(directionFilter !== 'all' || executorFilter !== 'all') && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Showing {filtered.length} of {activities.length}
          </span>
        )}
      </div>

      {/* Grouped timeline */}
      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([dateKey, items]) => (
          <div key={dateKey}>
            {/* Date header */}
            <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 pb-1">
              <h5 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
                <Calendar className="w-3 h-3" />
                {formatDate(dateKey)}
                <span className="text-gray-400 dark:text-gray-500 font-normal">({items.length})</span>
              </h5>
            </div>
            {/* Activities for this date */}
            <div className="border-l-2 border-gray-200 dark:border-gray-700 ml-4 pl-4 space-y-0.5">
              {items.map((activity) => (
                <ActivityItem key={activity.taskId} activity={activity} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ActivityTimeline;
