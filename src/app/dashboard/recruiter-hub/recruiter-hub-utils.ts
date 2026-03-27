import type { ProspectRecord } from './recruiter-hub-types';

export function getProspectStageLabel(p: ProspectRecord): string {
  return p.Conversion_Status === 'Closed'
    ? 'Closed Lost'
    : p.Full_Opportunity_ID__c
      ? 'Qualified'
      : p.TOF_Stage;
}

export function escapeCsvCell(value: string | null | undefined): string {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
