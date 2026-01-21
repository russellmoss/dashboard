'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Star,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  FileText,
  Users,
} from 'lucide-react';
import { SavedReport } from '@/types/saved-reports';

interface SavedReportsDropdownProps {
  userReports: SavedReport[];
  adminTemplates: SavedReport[];
  activeReportId: string | null;
  onSelectReport: (report: SavedReport) => void;
  onEditReport: (report: SavedReport) => void;
  onDuplicateReport: (report: SavedReport) => void;
  onDeleteReport: (report: SavedReport) => void;
  onSetDefault: (report: SavedReport) => void;
  isLoading?: boolean;
  isAdmin?: boolean; // Whether current user is admin/manager
}

export function SavedReportsDropdown({
  userReports,
  adminTemplates,
  activeReportId,
  onSelectReport,
  onEditReport,
  onDuplicateReport,
  onDeleteReport,
  onSetDefault,
  isLoading = false,
  isAdmin = false,
}: SavedReportsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);


  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setMenuOpenFor(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeReport =
    userReports.find((r) => r.id === activeReportId) ||
    adminTemplates.find((r) => r.id === activeReportId);

  const hasReports = userReports.length > 0 || adminTemplates.length > 0;

  const handleReportClick = (report: SavedReport) => {
    onSelectReport(report);
    setIsOpen(false);
    setMenuOpenFor(null);
  };

  const handleMenuClick = (e: React.MouseEvent, reportId: string) => {
    e.stopPropagation();
    setMenuOpenFor(menuOpenFor === reportId ? null : reportId);
  };

  const handleAction = (
    e: React.MouseEvent,
    action: () => void
  ) => {
    e.stopPropagation();
    action();
    setMenuOpenFor(null);
    setIsOpen(false);
  };

  return (
    <div className="relative z-10" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors min-w-[200px] justify-between"
      >
        <div className="flex items-center gap-2 truncate">
          <FileText className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
          <span className="truncate text-sm">
            {activeReport ? activeReport.name : 'Saved Reports'}
          </span>
          {activeReport?.isDefault && (
            <Star className="w-3 h-3 text-amber-500 flex-shrink-0" />
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform flex-shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          {!hasReports ? (
            <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No saved reports yet.
              <br />
              Save your current filters to create one.
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {/* User Reports */}
              {userReports.length > 0 && (
                <div>
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    My Reports
                  </div>
                  {userReports.map((report) => (
                    <ReportItem
                      key={report.id}
                      report={report}
                      isActive={report.id === activeReportId}
                      menuOpen={menuOpenFor === report.id}
                      onSelect={() => handleReportClick(report)}
                      onMenuClick={(e) => handleMenuClick(e, report.id)}
                      onEdit={(e) => handleAction(e, () => onEditReport(report))}
                      onDuplicate={(e) =>
                        handleAction(e, () => onDuplicateReport(report))
                      }
                      onDelete={(e) =>
                        handleAction(e, () => onDeleteReport(report))
                      }
                      onSetDefault={(e) =>
                        handleAction(e, () => onSetDefault(report))
                      }
                      canEdit={true}
                      canDelete={true}
                      canSetDefault={true}
                    />
                  ))}
                </div>
              )}

              {/* Admin Templates */}
              {adminTemplates.length > 0 && (
                <div>
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    Templates
                  </div>
                  {adminTemplates.map((report) => (
                    <ReportItem
                      key={report.id}
                      report={report}
                      isActive={report.id === activeReportId}
                      menuOpen={menuOpenFor === report.id}
                      onSelect={() => handleReportClick(report)}
                      onMenuClick={(e) => handleMenuClick(e, report.id)}
                      onEdit={(e) =>
                        handleAction(e, () => onEditReport(report))
                      }
                      onDuplicate={(e) =>
                        handleAction(e, () => onDuplicateReport(report))
                      }
                      onDelete={(e) =>
                        handleAction(e, () => onDeleteReport(report))
                      }
                      onSetDefault={(e) =>
                        handleAction(e, () => onSetDefault(report))
                      }
                      canEdit={isAdmin}
                      canDelete={isAdmin}
                      canSetDefault={false}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ReportItemProps {
  report: SavedReport;
  isActive: boolean;
  menuOpen: boolean;
  onSelect: () => void;
  onMenuClick: (e: React.MouseEvent) => void;
  onEdit: (e: React.MouseEvent) => void;
  onDuplicate: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onSetDefault: (e: React.MouseEvent) => void;
  canEdit: boolean;
  canDelete: boolean;
  canSetDefault: boolean;
}

function ReportItem({
  report,
  isActive,
  menuOpen,
  onSelect,
  onMenuClick,
  onEdit,
  onDuplicate,
  onDelete,
  onSetDefault,
  canEdit,
  canDelete,
  canSetDefault,
}: ReportItemProps) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; right: number } | null>(null);

  // Calculate menu position when it opens
  useEffect(() => {
    if (menuOpen && menuButtonRef.current) {
      const rect = menuButtonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 4, // 4px gap below button
        right: window.innerWidth - rect.right, // Distance from right edge
      });
    } else {
      setMenuPosition(null);
    }
  }, [menuOpen]);

  return (
    <div
      className={`relative flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 ${
        isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''
      }`}
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0 pr-2">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm truncate ${
              isActive
                ? 'text-blue-700 dark:text-blue-300 font-medium'
                : 'text-gray-900 dark:text-white'
            }`}
          >
            {report.name}
          </span>
          {report.isDefault && (
            <Star className="w-3 h-3 text-amber-500 flex-shrink-0" />
          )}
        </div>
        {report.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {report.description}
          </p>
        )}
      </div>

      {/* Actions Menu */}
      <div className="relative">
        <button
          ref={menuButtonRef}
          onClick={onMenuClick}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          <MoreHorizontal className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </button>

        {menuOpen && menuPosition && (
          <div
            className="fixed w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-[100]"
            style={{
              top: `${menuPosition.top}px`,
              right: `${menuPosition.right}px`,
            }}
          >
            {canEdit && (
              <button
                onClick={onEdit}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>
            )}
            <button
              onClick={onDuplicate}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <Copy className="w-4 h-4" />
              Duplicate
            </button>
            {canSetDefault && !report.isDefault && (
              <button
                onClick={onSetDefault}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <Star className="w-4 h-4" />
                Set as Default
              </button>
            )}
            {canDelete && (
              <button
                onClick={onDelete}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
