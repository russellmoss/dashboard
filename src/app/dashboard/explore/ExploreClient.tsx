'use client';

import { useReducer, useCallback } from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { ExploreInput } from '@/components/dashboard/ExploreInput';
import { ExploreResults } from '@/components/dashboard/ExploreResults';
import { SuggestedQuestions } from '@/components/dashboard/SuggestedQuestions';
import { agentApi } from '@/lib/api-client';
import type { AgentResponse, ConversationMessage } from '@/types/agent';

// =============================================================================
// STATE MACHINE FOR STREAMING
// Using useReducer for robust state management during SSE transitions
// =============================================================================

type ExploreState = {
  status: 'idle' | 'thinking' | 'parsing' | 'compiling' | 'executing' | 'success' | 'error';
  question: string | null;
  response: AgentResponse | null;
  error: string | null;
  conversationHistory: ConversationMessage[];
  streamingMessage: string | null; // For SSE progress messages
};

type ExploreAction =
  | { type: 'SUBMIT_QUESTION'; question: string }
  | { type: 'SET_THINKING'; message: string }
  | { type: 'SET_PARSING' }
  | { type: 'SET_COMPILING'; sql: string }
  | { type: 'SET_EXECUTING' }
  | { type: 'SET_SUCCESS'; response: AgentResponse }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RESET' }
  | { type: 'ADD_TO_HISTORY'; message: ConversationMessage };

function exploreReducer(state: ExploreState, action: ExploreAction): ExploreState {
  switch (action.type) {
    case 'SUBMIT_QUESTION':
      return {
        ...state,
        status: 'thinking',
        question: action.question,
        error: null,
        streamingMessage: 'Analyzing your question...',
      };
    case 'SET_THINKING':
      return {
        ...state,
        status: 'thinking',
        streamingMessage: action.message,
      };
    case 'SET_PARSING':
      return {
        ...state,
        status: 'parsing',
        streamingMessage: 'Selecting query template...',
      };
    case 'SET_COMPILING':
      return {
        ...state,
        status: 'compiling',
        streamingMessage: 'Building query...',
      };
    case 'SET_EXECUTING':
      return {
        ...state,
        status: 'executing',
        streamingMessage: 'Running query...',
      };
    case 'SET_SUCCESS':
      return {
        ...state,
        status: 'success',
        response: action.response,
        streamingMessage: null,
      };
    case 'SET_ERROR':
      return {
        ...state,
        status: 'error',
        error: action.error,
        streamingMessage: null,
      };
    case 'RESET':
      return {
        ...state,
        status: 'idle',
        question: null,
        response: null,
        error: null,
        streamingMessage: null,
      };
    case 'ADD_TO_HISTORY':
      return {
        ...state,
        conversationHistory: [...state.conversationHistory, action.message],
      };
    default:
      return state;
  }
}

const initialState: ExploreState = {
  status: 'idle',
  question: null,
  response: null,
  error: null,
  conversationHistory: [],
  streamingMessage: null,
};

export default function ExploreClient() {
  const [state, dispatch] = useReducer(exploreReducer, initialState);
  const { status, question, response, error, conversationHistory, streamingMessage } = state;

  const isLoading = ['thinking', 'parsing', 'compiling', 'executing'].includes(status);
  const currentQuestion = question || '';

  const handleSubmit = useCallback(
    async (questionText: string) => {
      console.log('[Explore] Submitting question:', questionText);
      dispatch({ type: 'SUBMIT_QUESTION', question: questionText });

      // Add user message to history
      dispatch({
        type: 'ADD_TO_HISTORY',
        message: {
          role: 'user',
          content: questionText,
          timestamp: new Date().toISOString(),
        },
      });

      try {
        console.log('[Explore] Calling agentApi.query...');
        const result = await agentApi.query({
          question: questionText,
          conversationHistory: conversationHistory.slice(-5),
        });

        console.log('[Explore] Query result received:', result);
        dispatch({ type: 'SET_SUCCESS', response: result });

        // Add assistant message to history
        dispatch({
          type: 'ADD_TO_HISTORY',
          message: {
            role: 'assistant',
            content: result.templateSelection?.explanation || 'Query executed',
            timestamp: new Date().toISOString(),
            queryResult: result.result,
          },
        });
      } catch (err) {
        console.error('[Explore] Error submitting question:', err);
        const message = err instanceof Error ? err.message : 'An error occurred';
        console.error('[Explore] Error message:', message);
        dispatch({ type: 'SET_ERROR', error: message });
      }
    },
    [conversationHistory]
  );

  const handleSuggestedSelect = useCallback(
    (q: string) => {
      handleSubmit(q);
    },
    [handleSubmit]
  );

  const handleRetry = useCallback(() => {
    if (question) {
      handleSubmit(question);
    }
  }, [question, handleSubmit]);

  const handleReset = useCallback(() => {
    dispatch({ type: 'RESET' });
    // Keep conversation history for context
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-8 p-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
          <Bot className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Explore</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Ask questions about your funnel in plain English
          </p>
        </div>
      </div>

      {/* Input Section */}
      <ExploreInput onSubmit={handleSubmit} isLoading={isLoading} />

      {/* Results or Suggestions */}
      {response || error || isLoading ? (
        <div className="space-y-4">
          {/* Current question display */}
          {currentQuestion && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20">
              <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div>
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  You asked:
                </span>
                <p className="text-gray-900 dark:text-gray-100">{currentQuestion}</p>
              </div>
            </div>
          )}

          {/* Results */}
          <ExploreResults
            response={response}
            isLoading={isLoading}
            error={error}
            streamingMessage={streamingMessage}
            currentQuestion={currentQuestion}
            onRetry={handleRetry}
          />

          {/* Reset button */}
          {(response || error) && !isLoading && (
            <div className="flex justify-center">
              <button
                onClick={handleReset}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 
                           dark:hover:text-gray-200 transition-colors"
              >
                Ask another question
              </button>
            </div>
          )}
        </div>
      ) : (
        <SuggestedQuestions onSelect={handleSuggestedSelect} />
      )}

      {/* Conversation History (Collapsible) */}
      {conversationHistory.length > 2 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            View conversation history ({conversationHistory.length} messages)
          </summary>
          <div className="mt-4 space-y-2 max-h-64 overflow-y-auto">
            {conversationHistory.map((msg, i) => (
              <div
                key={i}
                className={`p-2 rounded text-sm ${
                  msg.role === 'user'
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'bg-gray-50 dark:bg-gray-800'
                }`}
              >
                <span className="font-medium">{msg.role === 'user' ? 'You' : 'Agent'}:</span>{' '}
                {msg.content}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

