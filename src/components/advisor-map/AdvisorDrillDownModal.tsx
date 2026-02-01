// src/components/advisor-map/AdvisorDrillDownModal.tsx

'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, MapPin, Building, Pencil, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
} from '@tremor/react';
import { AdvisorLocation } from '@/lib/queries/advisor-locations';
import { formatDate } from '@/lib/utils/format-helpers';
import { formatCurrency } from '@/lib/utils/date-helpers';
import { ExportButton } from '@/components/ui/ExportButton';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import { AddressEditModal } from './AddressEditModal';
import { useSession } from 'next-auth/react';
import { ExtendedSession } from '@/types/auth';

export type DrillDownType = 'all' | 'mapped' | 'street-level' | 'city-level' | 'unmapped';

interface AdvisorDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  drillDownType: DrillDownType;
  advisors: AdvisorLocation[];
  title: string;
  onRefresh?: () => void; // Called after address override is saved
}

// Column configuration for the table
const COLUMNS = [
  { key: 'advisorName', label: 'Advisor Name', width: 'w-44', sortable: true },
  { key: 'joinDate', label: 'Joined', width: 'w-28', sortable: true },
  { key: 'location', label: 'Location', width: 'w-48', sortable: true },
  { key: 'aum', label: 'AUM', width: 'w-28', sortable: true },
  { key: 'accuracy', label: 'Accuracy', width: 'w-24', sortable: true },
  { key: 'source', label: 'Source', width: 'w-28', sortable: true },
  { key: 'channel', label: 'Channel', width: 'w-28', sortable: true },
  { key: 'actions', label: '', width: 'w-16', sortable: false },
];

type SortDirection = 'asc' | 'desc';
type SortKey = 'advisorName' | 'joinDate' | 'location' | 'aum' | 'accuracy' | 'source' | 'channel';

// Helper to get sortable value from advisor
function getSortValue(advisor: AdvisorLocation, key: SortKey): string | number | null {
  switch (key) {
    case 'advisorName':
      return advisor.advisorName?.toLowerCase() || '';
    case 'joinDate':
      return advisor.joinDate ? new Date(advisor.joinDate).getTime() : 0;
    case 'location':
      // Sort by street address first if available, then city/state
      const parts = [advisor.street1, advisor.city, advisor.state].filter(Boolean);
      return parts.join(', ').toLowerCase();
    case 'aum':
      return advisor.aum || 0;
    case 'accuracy':
      // Sort by accuracy level: ROOFTOP > RANGE_INTERPOLATED > GEOMETRIC_CENTER > APPROXIMATE > null
      const accuracyOrder: Record<string, number> = {
        'ROOFTOP': 4,
        'RANGE_INTERPOLATED': 3,
        'GEOMETRIC_CENTER': 2,
        'APPROXIMATE': 1,
      };
      return accuracyOrder[advisor.geocodeAccuracy || ''] || 0;
    case 'source':
      return advisor.source?.toLowerCase() || '';
    case 'channel':
      return advisor.channel?.toLowerCase() || '';
    default:
      return '';
  }
}

// Skeleton row component
function SkeletonRow({ columns }: { columns: number }) {
  return (
    <TableRow>
      {Array.from({ length: columns }).map((_, i) => (
        <TableCell key={i}>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </TableCell>
      ))}
    </TableRow>
  );
}

// Get accuracy badge styling
function getAccuracyBadge(accuracy: string | null, hasOverride?: boolean): { label: string; className: string } {
  // Show override badge if has override
  if (hasOverride) {
    return { label: 'Override', className: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' };
  }

  if (!accuracy) {
    return { label: 'No coords', className: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' };
  }

  const badges: Record<string, { label: string; className: string }> = {
    'ROOFTOP': { label: 'Street', className: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
    'RANGE_INTERPOLATED': { label: 'Street', className: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
    'GEOMETRIC_CENTER': { label: 'City', className: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
    'APPROXIMATE': { label: 'City', className: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' },
  };

  return badges[accuracy] || { label: accuracy, className: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' };
}

export function AdvisorDrillDownModal({
  isOpen,
  onClose,
  drillDownType,
  advisors,
  title,
  onRefresh,
}: AdvisorDrillDownModalProps) {
  const { data: session } = useSession();
  const extendedSession = session as ExtendedSession | null;
  const userRole = extendedSession?.permissions?.role;
  const canEdit = userRole ? ['admin', 'revops_admin', 'manager'].includes(userRole) : false;

  // Sorting state - default to alphabetical by advisor name
  const [sortKey, setSortKey] = useState<SortKey>('advisorName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // State for record detail modal
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [showRecordDetail, setShowRecordDetail] = useState(false);

  // State for address edit modal
  const [editingAdvisor, setEditingAdvisor] = useState<AdvisorLocation | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showEditModal) {
          setShowEditModal(false);
        } else if (showRecordDetail) {
          setShowRecordDetail(false);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, showRecordDetail, showEditModal]);

  // Filter advisors based on drill-down type
  const filteredAdvisors = useMemo(() => {
    let filtered: AdvisorLocation[];
    switch (drillDownType) {
      case 'all':
        filtered = [...advisors];
        break;
      case 'mapped':
        filtered = advisors.filter(a => a.lat !== null && a.lng !== null);
        break;
      case 'unmapped':
        filtered = advisors.filter(a => a.lat === null || a.lng === null);
        break;
      case 'street-level':
        filtered = advisors.filter(a =>
          a.geocodeAccuracy === 'ROOFTOP' || a.geocodeAccuracy === 'RANGE_INTERPOLATED'
        );
        break;
      case 'city-level':
        filtered = advisors.filter(a =>
          a.geocodeAccuracy === 'APPROXIMATE' || a.geocodeAccuracy === 'GEOMETRIC_CENTER'
        );
        break;
      default:
        filtered = [...advisors];
    }

    // Sort the filtered results
    return filtered.sort((a, b) => {
      const aVal = getSortValue(a, sortKey);
      const bVal = getSortValue(b, sortKey);

      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return sortDirection === 'asc' ? 1 : -1;
      if (bVal === null) return sortDirection === 'asc' ? -1 : 1;

      let comparison = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else {
        comparison = (aVal as number) - (bVal as number);
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [advisors, drillDownType, sortKey, sortDirection]);

  // Prepare data for CSV export
  const exportData = useMemo(() => {
    return filteredAdvisors.map(advisor => ({
      'Advisor Name': advisor.advisorName,
      'Join Date': formatDate(advisor.joinDate) || '',
      'Street Address': advisor.street1 || '',
      'Street Address 2': advisor.street2 || '',
      'City': advisor.city || '',
      'State': advisor.state || '',
      'Postal Code': advisor.postalCode || '',
      'Country': advisor.country || '',
      'AUM': advisor.aum?.toLocaleString() || '',
      'Accuracy': advisor.geocodeAccuracy || 'No coords',
      'Source': advisor.source || '',
      'Channel': advisor.channel || '',
      'SGA': advisor.sgaOwner || '',
      'SGM': advisor.sgmOwner || '',
      'Latitude': advisor.lat?.toString() || '',
      'Longitude': advisor.lng?.toString() || '',
    }));
  }, [filteredAdvisors]);

  // Generate filename from title
  const exportFilename = useMemo(() => {
    const sanitizedTitle = title
      .replace(/[^a-z0-9]/gi, '-')
      .toLowerCase()
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return `advisor-map-${sanitizedTitle}`;
  }, [title]);

  // Handle row click
  const handleRowClick = (primaryKey: string) => {
    setSelectedRecordId(primaryKey);
    setShowRecordDetail(true);
  };

  // Handle back from record detail
  const handleBackFromDetail = () => {
    setShowRecordDetail(false);
    setSelectedRecordId(null);
  };

  // Handle edit click
  const handleEditClick = (e: React.MouseEvent, advisor: AdvisorLocation) => {
    e.stopPropagation(); // Don't trigger row click
    setEditingAdvisor(advisor);
    setShowEditModal(true);
  };

  // Handle edit save
  const handleEditSave = () => {
    setShowEditModal(false);
    setEditingAdvisor(null);
    onRefresh?.(); // Refresh the data
  };

  // Handle column header click for sorting
  const handleSort = (key: string) => {
    if (!COLUMNS.find(c => c.key === key)?.sortable) return;

    const newKey = key as SortKey;
    if (sortKey === newKey) {
      // Toggle direction if same column
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to ascending
      setSortKey(newKey);
      setSortDirection('asc');
    }
  };

  // Render sort icon for column
  const renderSortIcon = (columnKey: string, sortable: boolean) => {
    if (!sortable) return null;

    if (sortKey === columnKey) {
      return sortDirection === 'asc' ? (
        <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
      ) : (
        <ChevronDown className="w-4 h-4 text-blue-600 dark:text-blue-400" />
      );
    }
    return <ChevronsUpDown className="w-4 h-4 text-gray-400" />;
  };

  if (!isOpen) return null;

  // If showing record detail, render that modal instead
  if (showRecordDetail && selectedRecordId) {
    return (
      <RecordDetailModal
        isOpen={true}
        onClose={onClose}
        recordId={selectedRecordId}
        showBackButton={true}
        onBack={handleBackFromDetail}
        backButtonLabel="← Back to advisor list"
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-[1000]" />

      {/* Modal */}
      <div
        className="relative z-[1001] bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-6xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {title}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {filteredAdvisors.length} advisor{filteredAdvisors.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ExportButton data={exportData} filename={exportFilename} />
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label="Close modal"
            >
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          <Table>
            <TableHead>
              <TableRow>
                {COLUMNS.map((col) => (
                  <TableHeaderCell
                    key={col.key}
                    className={`${col.width} ${col.sortable ? 'cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-700/50' : ''}`}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      <span>{col.label}</span>
                      {renderSortIcon(col.key, col.sortable)}
                    </div>
                  </TableHeaderCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredAdvisors.length === 0 ? (
                // Empty state
                <TableRow>
                  <TableCell colSpan={COLUMNS.length}>
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      No advisors found
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                // Data rows
                filteredAdvisors.map((advisor) => {
                  const accuracyBadge = getAccuracyBadge(advisor.geocodeAccuracy, advisor.hasOverride);

                  return (
                    <TableRow
                      key={advisor.primaryKey}
                      onClick={() => handleRowClick(advisor.primaryKey)}
                      className="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-colors"
                    >
                      <TableCell>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {advisor.advisorName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-gray-700 dark:text-gray-300">
                          {formatDate(advisor.joinDate) || '-'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-start gap-1">
                          {advisor.street1 || advisor.city || advisor.state ? (
                            <>
                              <Building className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                              <div className="text-gray-700 dark:text-gray-300">
                                {advisor.street1 ? (
                                  <>
                                    <p className="text-xs">{advisor.street1}</p>
                                    {advisor.street2 && <p className="text-xs">{advisor.street2}</p>}
                                    <p className="text-xs">
                                      {[advisor.city, advisor.state].filter(Boolean).join(', ')}
                                      {advisor.postalCode && ` ${advisor.postalCode}`}
                                    </p>
                                  </>
                                ) : (
                                  <span>{[advisor.city, advisor.state].filter(Boolean).join(', ')}</span>
                                )}
                              </div>
                            </>
                          ) : (
                            <span className="text-gray-400 dark:text-gray-500">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-gray-700 dark:text-gray-300">
                          {advisor.aum ? formatCurrency(advisor.aum) : '-'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${accuracyBadge.className}`}>
                          {accuracyBadge.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-gray-700 dark:text-gray-300">
                          {advisor.source || '-'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-gray-700 dark:text-gray-300">
                          {advisor.channel || '-'}
                        </span>
                      </TableCell>
                      <TableCell>
                        {canEdit && (
                          <button
                            onClick={(e) => handleEditClick(e, advisor)}
                            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            title="Edit address"
                          >
                            <Pencil className="w-4 h-4 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400" />
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Click any row to view full record details
            {canEdit && ' | Click pencil icon to edit address'}
          </p>
        </div>
      </div>

      {/* Address Edit Modal */}
      <AddressEditModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingAdvisor(null);
        }}
        advisor={editingAdvisor}
        onSave={handleEditSave}
      />
    </div>
  );
}
