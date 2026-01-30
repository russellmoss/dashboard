'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Loader2,
  ExternalLink,
  Trash2,
  Archive,
  ArchiveRestore,
  Lock,
  Unlock,
  MessageCircle,
  Clock,
  FileText,
} from 'lucide-react';
import { dashboardRequestsApi } from '@/lib/api-client';
import {
  DashboardRequestFull,
  RequestStatus,
  RequestPriority,
  STATUS_LABELS,
  STATUS_COLORS,
  TYPE_LABELS,
  TYPE_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  RequestCommentWithAuthor,
} from '@/types/dashboard-request';
import { CommentThread } from './CommentThread';
import { EditHistoryTimeline } from './EditHistoryTimeline';

interface RequestDetailModalProps {
  requestId: string;
  isOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
  canManageRequests: boolean;
}

type TabId = 'details' | 'comments' | 'history';

const selectStyles = "px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white";

export function RequestDetailModal({
  requestId,
  isOpen,
  onClose,
  onUpdated,
  canManageRequests,
}: RequestDetailModalProps) {
  const [request, setRequest] = useState<DashboardRequestFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('details');
  const [isUpdating, setIsUpdating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Fetch request details
  useEffect(() => {
    if (!isOpen || !requestId) return;

    async function fetchRequest() {
      setLoading(true);
      setError(null);
      try {
        const data = await dashboardRequestsApi.getById(requestId);
        setRequest(data);
      } catch (err: any) {
        console.error('Failed to fetch request:', err);
        setError(err.message || 'Failed to load request');
      } finally {
        setLoading(false);
      }
    }

    fetchRequest();
  }, [isOpen, requestId]);

  // Handle status change
  const handleStatusChange = async (newStatus: RequestStatus) => {
    if (!request || !canManageRequests) return;
    setIsUpdating(true);
    try {
      const result = await dashboardRequestsApi.updateStatus(request.id, newStatus);
      setRequest(result.request);
      onUpdated();
    } catch (err: any) {
      console.error('Failed to update status:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle priority change
  const handlePriorityChange = async (newPriority: RequestPriority | '') => {
    if (!request || !canManageRequests) return;
    setIsUpdating(true);
    try {
      const updated = await dashboardRequestsApi.update(request.id, {
        priority: newPriority || undefined,
      });
      setRequest(updated);
      onUpdated();
    } catch (err: any) {
      console.error('Failed to update priority:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle privacy toggle
  const handlePrivacyToggle = async () => {
    if (!request || !canManageRequests) return;
    setIsUpdating(true);
    try {
      const updated = await dashboardRequestsApi.update(request.id, {
        isPrivate: !request.isPrivate,
      });
      setRequest(updated);
      onUpdated();
    } catch (err: any) {
      console.error('Failed to toggle privacy:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle archive/unarchive
  const handleArchiveToggle = async () => {
    if (!request || !canManageRequests) return;
    setIsUpdating(true);
    try {
      if (request.status === RequestStatus.ARCHIVED) {
        const updated = await dashboardRequestsApi.unarchive(request.id);
        setRequest(updated);
      } else {
        const updated = await dashboardRequestsApi.archive(request.id);
        setRequest(updated);
      }
      onUpdated();
    } catch (err: any) {
      console.error('Failed to toggle archive:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle delete
  const handleDelete = async () => {
    if (!request) return;
    setIsUpdating(true);
    try {
      await dashboardRequestsApi.delete(request.id);
      onUpdated();
      onClose();
    } catch (err: any) {
      console.error('Failed to delete request:', err);
    } finally {
      setIsUpdating(false);
      setShowDeleteConfirm(false);
    }
  };

  // Handle comment added
  const handleCommentAdded = (comment: RequestCommentWithAuthor) => {
    if (!request) return;
    setRequest({
      ...request,
      comments: [...request.comments, comment],
    });
    onUpdated();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Request Details
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-600 dark:text-red-400">{error}</p>
            </div>
          ) : request ? (
            <div className="space-y-6">
              {/* Title and Type */}
              <div>
                <div className="flex items-start gap-3 mb-2">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
                      TYPE_COLORS[request.requestType].bg
                    } ${TYPE_COLORS[request.requestType].text}`}
                  >
                    {TYPE_LABELS[request.requestType]}
                  </span>
                  {request.isPrivate && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                      <Lock className="w-3 h-3" />
                      Private
                    </span>
                  )}
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                  {request.title}
                </h3>
              </div>

              {/* Admin Controls */}
              {canManageRequests && (
                <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  {/* Status */}
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-600 dark:text-gray-400">Status:</label>
                    <select
                      value={request.status}
                      onChange={(e) => handleStatusChange(e.target.value as RequestStatus)}
                      disabled={isUpdating}
                      className={selectStyles}
                    >
                      {Object.values(RequestStatus).map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Priority */}
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-600 dark:text-gray-400">Priority:</label>
                    <select
                      value={request.priority || ''}
                      onChange={(e) => handlePriorityChange(e.target.value as RequestPriority | '')}
                      disabled={isUpdating}
                      className={selectStyles}
                    >
                      <option value="">None</option>
                      {Object.values(RequestPriority).map((priority) => (
                        <option key={priority} value={priority}>
                          {PRIORITY_LABELS[priority]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Privacy Toggle */}
                  <button
                    onClick={handlePrivacyToggle}
                    disabled={isUpdating}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                  >
                    {request.isPrivate ? (
                      <>
                        <Unlock className="w-4 h-4" />
                        Make Public
                      </>
                    ) : (
                      <>
                        <Lock className="w-4 h-4" />
                        Make Private
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Status and Priority Display (non-admin) */}
              {!canManageRequests && (
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
                      STATUS_COLORS[request.status].bg
                    } ${STATUS_COLORS[request.status].text}`}
                  >
                    {STATUS_LABELS[request.status]}
                  </span>
                  {request.priority && (
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-medium rounded ${
                        PRIORITY_COLORS[request.priority].bg
                      } ${PRIORITY_COLORS[request.priority].text}`}
                    >
                      {PRIORITY_LABELS[request.priority]}
                    </span>
                  )}
                </div>
              )}

              {/* Meta Info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Submitted by:</span>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {request.submitter.name}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Created:</span>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {formatDate(request.createdAt)}
                  </p>
                </div>
                {request.affectedPage && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Affected Page:</span>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {request.affectedPage}
                    </p>
                  </div>
                )}
                {request.wrikePermalink && (
                  <div>
                    <span className="text-gray-500 dark:text-gray-400">Wrike Task:</span>
                    <a
                      href={request.wrikePermalink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      View in Wrike
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>

              {/* Tabs */}
              <div className="border-b border-gray-200 dark:border-gray-700">
                <nav className="-mb-px flex space-x-6">
                  {[
                    { id: 'details' as TabId, label: 'Details', icon: FileText },
                    { id: 'comments' as TabId, label: `Comments (${request.comments.length})`, icon: MessageCircle },
                    { id: 'history' as TabId, label: 'Activity', icon: Clock },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`
                          flex items-center gap-1.5 py-3 px-1 border-b-2 text-sm font-medium transition-colors
                          ${isActive
                            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                            : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                          }
                        `}
                      >
                        <Icon className="w-4 h-4" />
                        {tab.label}
                      </button>
                    );
                  })}
                </nav>
              </div>

              {/* Tab Content */}
              <div className="min-h-[200px]">
                {activeTab === 'details' && (
                  <div className="space-y-4">
                    {/* Description */}
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Description
                      </h4>
                      <p className="text-gray-900 dark:text-white whitespace-pre-wrap">
                        {request.description}
                      </p>
                    </div>

                    {/* Data Error Fields */}
                    {request.requestType === 'DATA_ERROR' && (
                      <div className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        {request.filtersApplied && (
                          <div>
                            <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                              Filters Applied
                            </h5>
                            <p className="text-sm text-gray-900 dark:text-white">
                              {request.filtersApplied}
                            </p>
                          </div>
                        )}
                        {request.valueSeen && (
                          <div>
                            <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                              Value Seen (Incorrect)
                            </h5>
                            <p className="text-sm text-gray-900 dark:text-white">
                              {request.valueSeen}
                            </p>
                          </div>
                        )}
                        {request.valueExpected && (
                          <div>
                            <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                              Value Expected (Correct)
                            </h5>
                            <p className="text-sm text-gray-900 dark:text-white">
                              {request.valueExpected}
                            </p>
                          </div>
                        )}
                        {request.errorOccurredAt && (
                          <div>
                            <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">
                              When Noticed
                            </h5>
                            <p className="text-sm text-gray-900 dark:text-white">
                              {formatDate(request.errorOccurredAt)}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'comments' && (
                  <CommentThread
                    requestId={request.id}
                    comments={request.comments}
                    onCommentAdded={handleCommentAdded}
                  />
                )}

                {activeTab === 'history' && (
                  <EditHistoryTimeline
                    history={request.editHistory}
                    comments={request.comments}
                  />
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {request && (
          <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <div className="flex items-center gap-2">
              {/* Delete Button */}
              {(canManageRequests || request.status === 'SUBMITTED') && (
                <>
                  {showDeleteConfirm ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-red-600 dark:text-red-400">Delete this request?</span>
                      <button
                        onClick={handleDelete}
                        disabled={isUpdating}
                        className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                      >
                        Yes, Delete
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  )}
                </>
              )}

              {/* Archive Button (Admin only) */}
              {canManageRequests && !showDeleteConfirm && (
                <button
                  onClick={handleArchiveToggle}
                  disabled={isUpdating}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {request.status === RequestStatus.ARCHIVED ? (
                    <>
                      <ArchiveRestore className="w-4 h-4" />
                      Unarchive
                    </>
                  ) : (
                    <>
                      <Archive className="w-4 h-4" />
                      Archive
                    </>
                  )}
                </button>
              )}
            </div>

            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
