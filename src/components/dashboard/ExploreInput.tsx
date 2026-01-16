// src/components/dashboard/ExploreInput.tsx
'use client';

// EXACT IMPORT PATTERN (from codebase):
import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { Send, Loader2, History, X } from 'lucide-react';

interface ExploreInputProps {
  onSubmit: (question: string) => void;
  isLoading: boolean;
  disabled?: boolean;
}

const MAX_CHARS = 500;

export function ExploreInput({ onSubmit, isLoading, disabled }: ExploreInputProps) {
  const [question, setQuestion] = useState('');
  const [recentQuestions, setRecentQuestions] = useState<string[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load recent questions from session storage
  useEffect(() => {
    const stored = sessionStorage.getItem('explore-recent-questions');
    if (stored) {
      try {
        setRecentQuestions(JSON.parse(stored));
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, []);

  const handleSubmit = () => {
    console.log('[ExploreInput] handleSubmit called', { question, isLoading, disabled });
    
    if (!question.trim() || isLoading || disabled) {
      console.log('[ExploreInput] Submit blocked:', { hasQuestion: !!question.trim(), isLoading, disabled });
      return;
    }

    const trimmedQuestion = question.trim();
    console.log('[ExploreInput] Calling onSubmit with:', trimmedQuestion);
    
    // Save to recent questions
    const updated = [trimmedQuestion, ...recentQuestions.filter(q => q !== trimmedQuestion)].slice(0, 10);
    setRecentQuestions(updated);
    sessionStorage.setItem('explore-recent-questions', JSON.stringify(updated));

    onSubmit(trimmedQuestion);
    setQuestion('');
    setShowRecent(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const selectRecentQuestion = (q: string) => {
    setQuestion(q);
    setShowRecent(false);
    inputRef.current?.focus();
  };

  const clearRecentQuestions = () => {
    setRecentQuestions([]);
    sessionStorage.removeItem('explore-recent-questions');
    setShowRecent(false);
  };

  return (
    <div className="relative">
      <div className="flex items-start gap-3">
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your funnel..."
            className="w-full min-h-[100px] p-4 pr-12 rounded-lg border border-gray-200 dark:border-gray-700 
                       bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       placeholder:text-gray-400 dark:placeholder:text-gray-500
                       resize-none transition-all"
            disabled={isLoading || disabled}
          />
          
          {/* Character count */}
          <div className="absolute bottom-2 right-2 text-xs text-gray-400 dark:text-gray-500">
            {question.length}/{MAX_CHARS}
          </div>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!question.trim() || isLoading || disabled}
          className="p-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 
                     dark:disabled:bg-gray-700 text-white transition-colors
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Recent questions toggle */}
      {recentQuestions.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowRecent(!showRecent)}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 
                       dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            <History className="w-4 h-4" />
            Recent questions
          </button>

          {showRecent && (
            <div className="mt-2 p-2 rounded-lg border border-gray-200 dark:border-gray-700 
                           bg-white dark:bg-gray-800 shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Recent
                </span>
                <button
                  onClick={clearRecentQuestions}
                  className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  Clear all
                </button>
              </div>
              <div className="space-y-1">
                {recentQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => selectRecentQuestion(q)}
                    className="w-full text-left px-2 py-1 text-sm rounded hover:bg-gray-100 
                               dark:hover:bg-gray-700 truncate transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
