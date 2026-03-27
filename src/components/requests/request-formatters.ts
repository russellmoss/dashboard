/**
 * Shared formatting utilities for the requests feature.
 * Extracted from RequestDetailModal, CommentThread, and EditHistoryTimeline
 * which all had identical local formatDate implementations.
 *
 * This file must remain a dependency-free leaf — pure functions only.
 */

export function formatRequestTimestamp(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
