// src/types/record-activity.ts

/**
 * Types for the Activity tab in the Record Detail Modal.
 * Displays all Salesforce Task activity associated with a lead/opportunity.
 */

/** Single activity record displayed in the timeline */
export interface ActivityRecord {
  taskId: string;
  createdDate: string;           // ISO timestamp (UTC)
  createdDateEst: string;        // EST datetime string for display
  activityChannel: string;       // SMS, Call, LinkedIn, Email (Manual), Email (Campaign), etc.
  activityChannelGroup: string;  // High-level: SMS, Call, LinkedIn, Email, Meeting, Other
  direction: 'Inbound' | 'Outbound';
  subject: string;
  messagePreview: string | null; // SMS body from Description field
  executorName: string;
  callDurationSeconds: number | null;
  isMeaningfulConnect: boolean;
  // Which object the task was linked to
  linkedObjectType: 'Lead' | 'Contact' | 'Opportunity' | 'Re-Engagement Opp' | 'Original Opp' | 'Unknown';
}

/** Raw BigQuery row from the activity query */
export interface ActivityRecordRaw {
  task_id: string;
  created_date_utc: { value: string } | string;
  created_datetime_est: string;
  activity_channel: string;
  activity_channel_group: string;
  direction: string;
  subject: string;
  message_preview: string | null;
  executor_name: string;
  call_duration_seconds: number | null;
  is_meaningful_connect: number;
  linked_object_type: string;
}

/** API response for activity endpoint */
export interface RecordActivityResponse {
  activities: ActivityRecord[];
  totalCount: number;
  error?: string;
}
