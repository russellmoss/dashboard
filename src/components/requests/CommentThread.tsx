'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { RequestCommentWithAuthor } from '@/types/dashboard-request';
import { dashboardRequestsApi } from '@/lib/api-client';
import { MentionPicker, TaggableUser } from './MentionPicker';
import { MentionText } from './MentionText';

interface CommentThreadProps {
  requestId: string;
  comments: RequestCommentWithAuthor[];
  onCommentAdded: (comment: RequestCommentWithAuthor) => void;
}

export function CommentThread({ requestId, comments, onCommentAdded }: CommentThreadProps) {
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mention state
  const [taggableUsers, setTaggableUsers] = useState<TaggableUser[]>([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionVisible, setMentionVisible] = useState(false);
  const [mentionPosition, setMentionPosition] = useState<{ top: number; left: number } | null>(null);
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch taggable users on mount
  useEffect(() => {
    let cancelled = false;
    async function fetchUsers() {
      try {
        const users = await dashboardRequestsApi.getTaggableUsers();
        if (!cancelled) setTaggableUsers(users);
      } catch (err) {
        console.error('Failed to fetch taggable users:', err);
      }
    }
    fetchUsers();
    return () => { cancelled = true; };
  }, []);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setNewComment(value);

    // Detect @ trigger
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      // Check that @ is at start or preceded by whitespace/newline
      const charBefore = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
      if (charBefore === ' ' || charBefore === '\n' || lastAtIndex === 0) {
        const query = textBeforeCursor.slice(lastAtIndex + 1);
        // Only show picker if query doesn't contain spaces (user is still typing a name)
        // Allow spaces in names but close if there's been no match for a while
        if (query.length <= 30 && !query.includes('\n')) {
          setMentionQuery(query);
          setMentionStartIndex(lastAtIndex);
          setMentionVisible(true);
          updatePickerPosition();
          return;
        }
      }
    }

    // Close picker if no valid @ context
    setMentionVisible(false);
    setMentionStartIndex(null);
  };

  const updatePickerPosition = () => {
    if (textareaRef.current && containerRef.current) {
      const textarea = textareaRef.current;
      // Position above the textarea, aligned to the left
      setMentionPosition({
        top: textarea.offsetTop,
        left: 0,
      });
    }
  };

  const handleMentionSelect = (user: TaggableUser) => {
    if (mentionStartIndex === null || !textareaRef.current) return;

    const before = newComment.slice(0, mentionStartIndex);
    const cursorPos = textareaRef.current.selectionStart;
    const after = newComment.slice(cursorPos);

    // Insert mention markup
    const mentionMarkup = `@[${user.name}](${user.id}) `;
    const newValue = before + mentionMarkup + after;

    setNewComment(newValue);
    setMentionVisible(false);
    setMentionStartIndex(null);
    setMentionQuery('');

    // Restore focus and cursor position
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursorPos = before.length + mentionMarkup.length;
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const handleMentionClose = () => {
    setMentionVisible(false);
    setMentionStartIndex(null);
    setMentionQuery('');
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
              <p className="text-sm text-gray-700 dark:text-gray-300">
                <MentionText content={comment.content} />
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
        <div className="relative" ref={containerRef}>
          {/* Mention Picker */}
          <MentionPicker
            users={taggableUsers}
            query={mentionQuery}
            position={mentionPosition}
            onSelect={handleMentionSelect}
            onClose={handleMentionClose}
            visible={mentionVisible}
          />
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={newComment}
              onChange={handleInputChange}
              onBlur={() => {
                // Delay closing so click on picker registers first
                setTimeout(() => setMentionVisible(false), 200);
              }}
              placeholder="Add a comment... Use @ to mention someone"
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
        </div>
      </form>
    </div>
  );
}
