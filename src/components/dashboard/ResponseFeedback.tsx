// ResponseFeedback — Explore AI feedback component
'use client';

import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { generateExecutableSql } from '@/lib/utils/sql-helpers';
import type { AgentResponse } from '@/types/agent';

interface FeedbackProps {
  questionId: string; // Use timestamp or generate UUID
  templateId: string;
  question: string;
  response: AgentResponse | null; // For accessing compiledQuery and resultSummary
  error: string | null; // For capturing query errors (parsing, execution, etc.)
}

export function ResponseFeedback({ questionId, templateId, question, response, error }: FeedbackProps) {
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  // Update handleFeedback to save positive feedback immediately
  const handleFeedback = async (type: 'positive' | 'negative') => {
    setFeedback(type);
    setSaveError(null);

    if (type === 'negative') {
      setShowComment(true);
      // Don't save yet - wait for comment
      return;
    }

    // For positive feedback, save immediately
    await saveFeedback(type, null);
  };

  // Add saveFeedback function
  const saveFeedback = async (feedbackType: 'positive' | 'negative', commentText: string | null) => {
    setIsSaving(true);
    setSaveError(null);

    try {
      // Prepare resultSummary from response
      const resultSummary = response?.result ? {
        rowCount: response.result.metadata.rowCount,
        executionTimeMs: response.result.metadata.executionTimeMs,
        visualization: response.visualization,
      } : null;

      // Generate executable SQL if compiledQuery exists
      let executableSql: string | null = null;
      if (response?.compiledQuery?.sql && response?.compiledQuery?.params) {
        try {
          executableSql = generateExecutableSql(
            response.compiledQuery.sql,
            response.compiledQuery.params
          );
        } catch (err) {
          console.warn('Failed to generate executable SQL:', err);
          // Continue without executable SQL
        }
      }

      const response_data = await fetch('/api/explore/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId,
          templateId,
          question,
          feedback: feedbackType,
          comment: commentText,
          compiledQuery: response?.compiledQuery || null,
          executableSql,
          resultSummary,
          error: error || null, // Capture error if query failed
        }),
      });

      if (!response_data.ok) {
        const errorData = await response_data.json();
        throw new Error(errorData.error || 'Failed to save feedback');
      }

      setIsSaved(true);
      if (feedbackType === 'negative') {
        setShowComment(false);
      }
    } catch (error) {
      console.error('Failed to save feedback:', error);
      setSaveError(error instanceof Error ? error.message : 'Failed to save feedback');
      // Don't block user - they can still see the feedback was recorded
    } finally {
      setIsSaving(false);
    }
  };

  // Update handleCommentSubmit to require comment and save
  const handleCommentSubmit = async () => {
    if (!comment || comment.trim() === '') {
      setSaveError('Please provide a comment explaining what went wrong');
      return;
    }

    await saveFeedback('negative', comment.trim());
  };

  // Update render logic
  if (isSaved) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span>Thanks for your feedback!</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Was this helpful?
        </span>
        <button
          onClick={() => handleFeedback('positive')}
          disabled={isSaving}
          className={`p-1 rounded transition-colors ${
            feedback === 'positive'
              ? 'text-green-600 bg-green-100 dark:bg-green-900/30'
              : 'text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
          } ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
          title="Yes, this was helpful"
        >
          <ThumbsUp className="w-4 h-4" />
        </button>
        <button
          onClick={() => handleFeedback('negative')}
          disabled={isSaving}
          className={`p-1 rounded transition-colors ${
            feedback === 'negative'
              ? 'text-red-600 bg-red-100 dark:bg-red-900/30'
              : 'text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
          } ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
          title="No, this could be better"
        >
          <ThumbsDown className="w-4 h-4" />
        </button>
        {isSaving && (
          <span className="text-xs text-gray-500 dark:text-gray-400">Saving...</span>
        )}
      </div>

      {saveError && (
        <div className="text-xs text-red-600 dark:text-red-400">
          {saveError}
        </div>
      )}

      {showComment && (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setSaveError(null); // Clear error when user types
            }}
            placeholder="What went wrong? (required)"
            className="flex-1 px-3 py-1 text-sm border border-gray-300 dark:border-gray-600
                       rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && comment.trim()) {
                handleCommentSubmit();
              }
            }}
          />
          <button
            onClick={handleCommentSubmit}
            disabled={!comment || comment.trim() === '' || isSaving}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md
                       hover:bg-blue-700 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Send'}
          </button>
        </div>
      )}
    </div>
  );
}
