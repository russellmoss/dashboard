'use client';

import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { RequestCommentWithAuthor } from '@/types/dashboard-request';
import { dashboardRequestsApi } from '@/lib/api-client';

interface CommentThreadProps {
  requestId: string;
  comments: RequestCommentWithAuthor[];
  onCommentAdded: (comment: RequestCommentWithAuthor) => void;
}

export function CommentThread({ requestId, comments, onCommentAdded }: CommentThreadProps) {
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const comment = await dashboardRequestsApi.addComment(requestId, newComment.trim());
      onCommentAdded(comment);
      setNewComment('');
    } catch (err: any) {
      console.error('Failed to add comment:', err);
      setError(err.message || 'Failed to add comment');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-4">
      {/* Comments List */}
      <div className="space-y-4 max-h-[400px] overflow-y-auto">
        {comments.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-8">
            No comments yet. Be the first to comment!
          </p>
        ) : (
          comments.map((comment) => (
            <div
              key={comment.id}
              className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-900 dark:text-white text-sm">
                  {comment.author.name}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDate(comment.createdAt)}
                </span>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {comment.content}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Add Comment Form */}
      <form onSubmit={handleSubmit} className="space-y-2">
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <div className="flex gap-2">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            rows={2}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-400 resize-none"
          />
          <button
            type="submit"
            disabled={loading || !newComment.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed self-end"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
