// src/components/dashboard/RecordDetailModal.tsx

'use client';

import React, { useEffect, useState } from 'react';
import { 
  X, 
  ExternalLink, 
  Calendar, 
  DollarSign, 
  Users, 
  Tag,
  Building,
  AlertCircle,
  FileText
} from 'lucide-react';
// Removed Badge import - using custom styled badges instead
import { RecordDetailFull } from '@/types/record-detail';
import { dashboardApi } from '@/lib/api-client';
import { FunnelProgressStepper } from './FunnelProgressStepper';
import { RecordDetailSkeleton } from './RecordDetailSkeleton';
import { formatDate } from '@/lib/utils/format-helpers';

interface RecordDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  recordId: string | null;
  initialRecord?: RecordDetailFull | null;
  // New props for back button
  showBackButton?: boolean;
  onBack?: () => void;
  backButtonLabel?: string;
}

// Helper component for section headers
function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-gray-500 dark:text-gray-400" />
      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
        {title}
      </h4>
    </div>
  );
}

// Helper component for detail rows
function DetailRow({ 
  label, 
  value, 
  highlight = false 
}: { 
  label: string; 
  value: string | null | undefined;
  highlight?: boolean;
}) {
  if (!value) return null;
  
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>
        {value}
      </span>
    </div>
  );
}

// Helper component for date rows with formatting
function DateRow({ label, value }: { label: string; value: string | null | undefined }) {
  // formatDate now handles null/undefined and invalid dates, returning empty string
  const formatted = formatDate(value);
  
  // Don't render if no formatted value
  if (!formatted) return null;
  
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {formatted}
      </span>
    </div>
  );
}

export function RecordDetailModal({ 
  isOpen, 
  onClose, 
  recordId,
  initialRecord,
  showBackButton = false,
  onBack,
  backButtonLabel = '← Back to list',
}: RecordDetailModalProps) {
  const [record, setRecord] = useState<RecordDetailFull | null>(initialRecord || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch record data when modal opens
  useEffect(() => {
    if (isOpen && recordId && !initialRecord) {
      setLoading(true);
      setError(null);
      
      dashboardApi.getRecordDetail(recordId)
        .then((data) => {
          if (data) {
            setRecord(data);
          } else {
            setError('Record not found');
          }
        })
        .catch((err) => {
          console.error('Error fetching record:', err);
          setError('Failed to load record details');
        })
        .finally(() => {
          setLoading(false);
        });
    } else if (initialRecord) {
      setRecord(initialRecord);
    }
  }, [isOpen, recordId, initialRecord]);

  // Handle ESC key (add keyboard event listener)
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setRecord(initialRecord || null);
      setError(null);
    }
  }, [isOpen, initialRecord]);

  if (!isOpen) return null;

  // Stage badge styling helper - returns Tailwind classes for custom badge
  const getStageBadgeClasses = (stage: string | null | undefined): string => {
    if (!stage) {
      return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200';
    }
    
    const styles: Record<string, string> = {
      'Joined': 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200',
      'SQO': 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200',
      'SQL': 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-200',
      'MQL': 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200',
      'Contacted': 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200',
      'Prospect': 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200',
    };
    
    return styles[stage] || 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200';
  };

  // Record type badge styling helper - returns Tailwind classes for custom badge
  const getRecordTypeBadgeClasses = (recordType: string | null | undefined): string => {
    if (!recordType) {
      return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200';
    }
    
    const styles: Record<string, string> = {
      'Lead': 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200',
      'Opportunity': 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200',
      'Converted': 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200',
    };
    
    return styles[recordType] || 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm" 
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Modal Content */}
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header - Fixed */}
        <div className="flex items-start justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex-1 min-w-0">
            {showBackButton && onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors mb-2"
              >
                {backButtonLabel}
              </button>
            )}
            {loading ? (
              <div className="space-y-2">
                <div className="h-7 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
              </div>
            ) : record ? (
              <>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white truncate">
                  {record.advisorName}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${getRecordTypeBadgeClasses(record.recordType)}`}>
                    {record.recordType}
                  </span>
                  {record.recordTypeName && (
                    <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                      {record.recordTypeName}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Record Details
              </h2>
            )}
          </div>
          
          <div className="flex items-center gap-3 ml-4">
            {record && (
              <span className={`px-3 py-1.5 text-sm font-semibold rounded-full ${getStageBadgeClasses(record.tofStage)}`}>
                {record.tofStage}
              </span>
            )}
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Error State */}
          {error && (
            <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg mb-6">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
            </div>
          )}

          {/* Loading State */}
          {loading && <RecordDetailSkeleton />}

          {/* Record Content */}
          {!loading && record && (
            <div className="space-y-6">
              {/* Funnel Progress */}
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                <SectionHeader icon={Tag} title="Funnel Progress" />
                <FunnelProgressStepper 
                  flags={record.funnelFlags} 
                  tofStage={record.tofStage}
                />
              </div>

              {/* Main Content Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Attribution Section */}
                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                  <SectionHeader icon={Users} title="Attribution" />
                  <div className="space-y-1">
                    <DetailRow label="Source" value={record.source} />
                    <DetailRow label="Channel" value={record.channel} />
                    <DetailRow label="SGA" value={record.sga} highlight />
                    <DetailRow label="SGM" value={record.sgm} highlight />
                    <DetailRow label="External Agency" value={record.externalAgency} />
                    <DetailRow label="Lead Score Tier" value={record.leadScoreTier} />
                    <DetailRow label="Experiment Tag" value={record.experimentationTag} />
                  </div>
                </div>

                {/* Key Dates Section */}
                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                  <SectionHeader icon={Calendar} title="Key Dates" />
                  <div className="space-y-1">
                    <DateRow label="Created" value={record.createdDate} />
                    <DateRow label="Contacted" value={record.contactedDate} />
                    <DateRow label="MQL" value={record.mqlDate} />
                    <DateRow label="Initial Call" value={record.initialCallScheduledDate} />
                    <DateRow label="SQL" value={record.sqlDate} />
                    <DateRow label="Qualification Call" value={record.qualificationCallDate} />
                    <DateRow label="SQO" value={record.sqoDate} />
                    <DateRow label="Joined" value={record.joinedDate} />
                  </div>
                </div>

                {/* Financials Section - Only show for Opportunity records */}
                {(record.recordType === 'Opportunity' || record.recordType === 'Converted') && (
                  <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                    <SectionHeader icon={DollarSign} title="Financials" />
                    <div className="space-y-1">
                      <DetailRow label="AUM" value={record.aumFormatted} highlight />
                      <DetailRow label="Underwritten AUM" value={record.underwrittenAumFormatted} />
                      <DetailRow label="Amount" value={record.amountFormatted} />
                      <DetailRow label="AUM Tier" value={record.aumTier} />
                    </div>
                  </div>
                )}

                {/* Status Section */}
                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                  <SectionHeader icon={FileText} title="Status" />
                  <div className="space-y-1">
                    <DetailRow label="Current Stage" value={record.stageName} />
                    <DetailRow label="TOF Stage" value={record.tofStage} />
                    <DetailRow label="Conversion Status" value={record.conversionStatus} />
                    <DetailRow label="Disposition" value={record.disposition} />
                    {record.closedLostReason && (
                      <>
                        <DetailRow label="Closed Lost Reason" value={record.closedLostReason} />
                        <DetailRow label="Closed Lost Details" value={record.closedLostDetails} />
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Stage Entry Dates - Collapsible/Secondary */}
              {(record.stageEnteredDiscovery || record.stageEnteredSalesProcess || 
                record.stageEnteredNegotiating || record.stageEnteredSigned || 
                record.stageEnteredOnHold || record.joinedDate) && (
                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                  <SectionHeader icon={Calendar} title="Stage Entry Dates" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                    <DateRow label="Discovery" value={record.stageEnteredDiscovery} />
                    <DateRow label="Sales Process" value={record.stageEnteredSalesProcess} />
                    <DateRow label="Negotiating" value={record.stageEnteredNegotiating} />
                    <DateRow label="Signed" value={record.stageEnteredSigned} />
                    <DateRow label="On Hold" value={record.stageEnteredOnHold} />
                    <DateRow label="Closed" value={record.stageEnteredClosed} />
                    <DateRow label="Advisor Joined" value={record.joinedDate} />
                  </div>
                </div>
              )}

              {/* IDs Section - For debugging/reference */}
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                <SectionHeader icon={Building} title="Record IDs" />
                <div className="space-y-1">
                  <DetailRow label="Primary Key" value={record.id} />
                  <DetailRow label="Lead ID" value={record.fullProspectId} />
                  <DetailRow label="Opportunity ID" value={record.fullOpportunityId} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer - Fixed with Salesforce Links */}
        {!loading && record && (
          <div className="p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <div className="flex flex-wrap gap-3">
              {record.leadUrl && (
                <a
                  href={record.leadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Lead in Salesforce
                </a>
              )}
              {record.opportunityUrl && (
                <a
                  href={record.opportunityUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 hover:bg-green-100 dark:hover:bg-green-900/50 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View Opportunity in Salesforce
                </a>
              )}
              {!record.leadUrl && !record.opportunityUrl && record.salesforceUrl && (
                <a
                  href={record.salesforceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  View in Salesforce
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default RecordDetailModal;
