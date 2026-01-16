# Cursor.ai Pre-Execution Fix Prompt
## Fix Remaining Issues in SAVVY-SELF-SERVE-ANALYTICS-IMPLEMENTATION.md

**File to Modify:** `C:\Users\russe\Documents\Dashboard\SAVVY-SELF-SERVE-ANALYTICS-IMPLEMENTATION.md`

**Purpose:** Address the remaining issues identified by technical review before beginning agentic implementation.

---

## 🔴 CRITICAL FIXES REQUIRED

### Fix 1: Duplicate `renderVisualization` Function (BUG)

**Location:** Step 3.6 - ExploreResults.tsx (around lines 3287-3370 in the implementation guide)

**Issue:** There are TWO `renderVisualization` functions defined in the same file. This will cause a TypeScript error: "Duplicate function implementation."

**Required Change:** 
- REMOVE the first `renderVisualization` function (lines 3287-3319) that references non-existent components (`MetricCard`, `BarChartVisualization`, etc.)
- KEEP only the second `renderVisualization` function (lines 3324-3370) that uses inline renderers (`renderMetric`, `renderBarChart`, `renderLineChart`)

**Find this code and DELETE IT:**
```typescript
// Add visualization-specific rendering
function renderVisualization(
  visualization: VisualizationType,
  data: QueryResultData,
  title?: string
): React.ReactNode {
  switch (visualization) {
    case 'metric':
      return <MetricCard data={data} title={title} />;
    
    case 'bar':
      return (
        <BarChartVisualization 
          data={data} 
          title={title}
          // Use horizontal bars for rankings (when ordered by value)
          layout={data.rows.length <= 10 ? 'horizontal' : 'vertical'}
        />
      );
    
    case 'line':
      return <LineChartVisualization data={data} title={title} />;
    
    case 'funnel':
      return <FunnelVisualization data={data} title={title} />;
    
    case 'comparison':
      return <ComparisonVisualization data={data} title={title} />;
    
    case 'table':
    default:
      return <DataTable data={data} title={title} />;
  }
}
```

**KEEP this version:**
```typescript
// Visualization rendering function
// NOTE: For full implementation, create separate components (MetricCard, BarChartVisualization, etc.)
// For now, using inline renderers that match existing patterns
function renderVisualization(
  visualization: VisualizationType,
  data: QueryResultData,
  title?: string
): React.ReactNode {
  switch (visualization) {
    case 'metric':
      return renderMetric(data);
    // ... rest of implementation
  }
}
```

---

### Fix 2: Add `useReducer` State Machine for Streaming UI

**Location:** Step 3.7 - Explore Page (src/app/dashboard/explore/page.tsx)

**Issue:** The current implementation uses multiple `useState` calls which can cause race conditions during SSE streaming transitions (thinking → parsing → executing → result). Gemini flagged this as a potential problem.

**Required Change:** Replace the multiple `useState` calls with a `useReducer` state machine pattern.

**Find this code:**
```typescript
export default function ExplorePage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<string>('');
```

**Replace with:**
```typescript
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

export default function ExplorePage() {
  const [state, dispatch] = useReducer(exploreReducer, initialState);
  const { status, question, response, error, conversationHistory, streamingMessage } = state;
  
  const isLoading = ['thinking', 'parsing', 'compiling', 'executing'].includes(status);
```

**Also update the imports:**
```typescript
import { useReducer, useCallback } from 'react';
```

**And update handleSubmit to use dispatch:**
```typescript
const handleSubmit = useCallback(async (questionText: string) => {
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
    const result = await agentApi.query({
      question: questionText,
      conversationHistory: conversationHistory.slice(-5),
    });

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
    const message = err instanceof Error ? err.message : 'An error occurred';
    dispatch({ type: 'SET_ERROR', error: message });
  }
}, [conversationHistory]);
```

---

### Fix 3: Add Primary Key Clarification for Lead vs Opportunity Metrics

**Location:** Step 1.2 - Query Compiler (src/lib/semantic-layer/query-compiler.ts)

**Issue:** The guide says to use `primary_key` for DISTINCT counting but doesn't clarify when this applies to Lead-level vs Opportunity-level metrics.

**Required Change:** Add a comment block in the `getMetricSql` function explaining the distinction.

**Add this comment block before the `getMetricSql` function:**
```typescript
/**
 * Get the SQL fragment for a volume or AUM metric
 * 
 * CRITICAL: DISTINCT COUNTING BY METRIC LEVEL
 * 
 * The `primary_key` field is the unique identifier for records in vw_funnel_master.
 * Use COUNT(DISTINCT primary_key) for ALL metrics because:
 * 
 * 1. LEAD-LEVEL METRICS (prospects, contacted, mqls, sqls):
 *    - primary_key is unique per lead
 *    - Counts: COUNT(DISTINCT CASE WHEN [condition] THEN v.primary_key END)
 *    - SGA Filter: v.SGA_Owner_Name__c = @sga
 * 
 * 2. OPPORTUNITY-LEVEL METRICS (sqos, joined, won, lost, pipeline):
 *    - primary_key is STILL the unique identifier (one record per lead/opp combo)
 *    - Counts: COUNT(DISTINCT CASE WHEN [condition] THEN v.primary_key END)
 *    - SGA Filter: (v.SGA_Owner_Name__c = @sga OR v.Opp_SGA_Name__c = @sga)
 *      ^ Note: Check BOTH fields for opportunity metrics!
 * 
 * 3. AUM METRICS (underwritten_aum, joined_aum, pipeline_aum):
 *    - Uses SUM, not COUNT
 *    - Still filtered by primary_key uniqueness via date field conditions
 *    - SGA Filter: Same as opportunity-level
 * 
 * NEVER use sfdc_lead_id (field doesn't exist in current schema)
 * ALWAYS use primary_key for DISTINCT counting
 */
```

---

### Fix 4: Add Thumbs Up/Down Feedback Component

**Location:** Add as NEW Step 3.9 (after Step 3.8)

**Issue:** Gemini recommended adding a feedback loop to identify which templates need tuning.

**Required Change:** Add a new step to create a feedback component.

**Add this new step:**
```markdown
---

### Step 3.9: Add Feedback Component

#### Cursor Prompt
```
Create a simple feedback component for the Explore results that allows users to rate responses.

Features:
1. Thumbs up / thumbs down buttons
2. Optional feedback text field (shown after clicking)
3. Saves feedback to console.log for now (can be extended to API later)
4. Helps identify which templates need tuning

Place this component in ExploreResults.tsx after the query inspector.
```

#### Required Code
```typescript
// Add to ExploreResults.tsx - Feedback Component
interface FeedbackProps {
  questionId: string; // Use timestamp or generate UUID
  templateId: string;
  question: string;
}

function ResponseFeedback({ questionId, templateId, question }: FeedbackProps) {
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');

  const handleFeedback = (type: 'positive' | 'negative') => {
    setFeedback(type);
    if (type === 'negative') {
      setShowComment(true);
    }
    
    // Log feedback for analysis
    // TODO: Send to API endpoint for storage
    console.log('[Explore Feedback]', {
      questionId,
      templateId,
      question,
      feedback: type,
      timestamp: new Date().toISOString(),
    });
  };

  const handleCommentSubmit = () => {
    console.log('[Explore Feedback Comment]', {
      questionId,
      templateId,
      comment,
      timestamp: new Date().toISOString(),
    });
    setShowComment(false);
  };

  if (feedback && !showComment) {
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
          className={`p-1 rounded transition-colors ${
            feedback === 'positive'
              ? 'text-green-600 bg-green-100 dark:bg-green-900/30'
              : 'text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
          }`}
          title="Yes, this was helpful"
        >
          <ThumbsUp className="w-4 h-4" />
        </button>
        <button
          onClick={() => handleFeedback('negative')}
          className={`p-1 rounded transition-colors ${
            feedback === 'negative'
              ? 'text-red-600 bg-red-100 dark:bg-red-900/30'
              : 'text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
          }`}
          title="No, this could be better"
        >
          <ThumbsDown className="w-4 h-4" />
        </button>
      </div>

      {showComment && (
        <div className="flex gap-2">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What went wrong? (optional)"
            className="flex-1 px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 
                       rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleCommentSubmit}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md 
                       hover:bg-blue-700 transition-colors"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
```

**Also add the import at the top of ExploreResults.tsx:**
```typescript
import { ThumbsUp, ThumbsDown } from 'lucide-react';
```

**And add the component in the ExploreResults return statement, after QueryInspector:**
```typescript
{/* Feedback */}
{response?.success && response?.templateSelection && (
  <ResponseFeedback
    questionId={new Date().toISOString()}
    templateId={response.templateSelection.templateId}
    question={currentQuestion || ''}
  />
)}
```
```

---

### Fix 5: Add Streaming Progress Indicator to UI

**Location:** Step 3.6 - ExploreResults.tsx

**Issue:** The loading state just shows a generic skeleton. With the useReducer state machine, we can show progress through streaming phases.

**Required Change:** Update the loading state rendering to show streaming progress.

**Find this code:**
```typescript
// Loading state
if (isLoading) {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
      <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
      <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
    </div>
  );
}
```

**Replace with:**
```typescript
// Loading state with streaming progress
if (isLoading) {
  return (
    <div className="space-y-4">
      {/* Progress indicator */}
      <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
        <Loader2 className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
        <div>
          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
            {streamingMessage || 'Processing...'}
          </p>
          <p className="text-xs text-blue-600 dark:text-blue-400">
            This usually takes 5-10 seconds
          </p>
        </div>
      </div>
      
      {/* Skeleton placeholder */}
      <div className="animate-pulse space-y-4">
        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    </div>
  );
}
```

**Note:** This requires passing `streamingMessage` as a prop to ExploreResults.

**Update ExploreResultsProps:**
```typescript
interface ExploreResultsProps {
  response: AgentResponse | null;
  isLoading: boolean;
  error: string | null;
  streamingMessage?: string | null; // NEW
  onRetry?: () => void;
}
```

**And update the component call in page.tsx:**
```typescript
<ExploreResults
  response={response}
  isLoading={isLoading}
  error={error}
  streamingMessage={streamingMessage}
  onRetry={handleRetry}
/>
```

---

### Fix 6: Mark Funnel and Comparison as V2 Features

**Location:** Step 3.6 - ExploreResults.tsx and Step 2.1 - agent-prompt.ts

**Issue:** Funnel and Comparison visualizations are marked as TODO but the system prompt tells Claude they're available. This creates a mismatch.

**Required Change:** 

**Option A (Recommended for MVP):** Update the system prompt to NOT offer funnel or comparison for MVP.

**In agent-prompt.ts, update the VISUALIZATION SELECTION RULES:**
```typescript
// Change this:
4. FUNNEL (visualization: 'funnel')
   - Use for: Full funnel summaries showing stage progression
   - Examples: "Show me the funnel", "Funnel summary for Q1"

5. COMPARISON (visualization: 'comparison')
   - Use for: Period-over-period comparisons
   - Examples: "Compare this quarter to last quarter", "YoY comparison"

// To this:
4. FUNNEL (visualization: 'funnel') - **V2 FEATURE - NOT YET AVAILABLE**
   - For MVP, render funnel questions as TABLE visualization instead
   - Examples: "Show me the funnel" → Use TABLE with stage metrics

5. COMPARISON (visualization: 'comparison') - **V2 FEATURE - NOT YET AVAILABLE**  
   - For MVP, render comparison questions as TABLE visualization instead
   - Examples: "Compare this quarter to last" → Use TABLE with current/previous columns
```

**Option B:** Implement basic versions of these visualizations (more work, not recommended for MVP).

---

### Fix 7: Add API Client `agentApi` Implementation

**Location:** Step 2.3 - API Client (src/lib/api-client.ts)

**Issue:** The guide references `agentApi` but doesn't show the complete implementation clearly.

**Required Change:** Ensure the agentApi object is fully defined.

**Add this complete implementation to the Required Code section of Step 2.3:**
```typescript
// Add to src/lib/api-client.ts

/**
 * Agent API client for self-serve analytics
 */
export const agentApi = {
  /**
   * Submit a question and get results (non-streaming)
   */
  async query(request: AgentRequest): Promise<AgentResponse> {
    const response = await fetch('/api/agent/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || error.error || 'Query failed');
    }

    return response.json();
  },

  /**
   * Submit a question with streaming progress updates (SSE)
   * Returns an async generator that yields StreamChunk objects
   */
  async *queryStream(request: AgentRequest): AsyncGenerator<StreamChunk> {
    const response = await fetch('/api/agent/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || error.error || 'Query failed');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            yield JSON.parse(data) as StreamChunk;
          } catch {
            console.warn('Failed to parse SSE chunk:', data);
          }
        }
      }
    }
  },
};

// Also add types import at top of file
import type { AgentRequest, AgentResponse, StreamChunk } from '@/types/agent';
```

---

## 📋 IMPLEMENTATION CHECKLIST

After applying all fixes, verify:

- [ ] **Fix 1:** Only ONE `renderVisualization` function exists in ExploreResults.tsx
- [ ] **Fix 2:** ExplorePage uses `useReducer` with state machine pattern
- [ ] **Fix 3:** Primary key clarification comment added to query-compiler.ts
- [ ] **Fix 4:** Feedback component (thumbs up/down) added to ExploreResults
- [ ] **Fix 5:** Streaming progress indicator shows meaningful messages
- [ ] **Fix 6:** Funnel and Comparison marked as V2 in system prompt
- [ ] **Fix 7:** agentApi fully implemented with both query() and queryStream()
- [ ] TypeScript compiles without errors: `npx tsc --noEmit`

---

## 📝 UPDATE CHANGE LOG

After applying fixes, add this entry to `SELF-SERVE-PLAN-CHANGES.md`:

```markdown
---

### Change 22: Pre-Execution Fixes

**Date**: [Current Date]
**Type**: Bug Fixes and Improvements

**Issues Fixed**:

1. **Duplicate renderVisualization function (BUG)**
   - Removed duplicate function that would cause TypeScript error
   - Kept inline renderer version

2. **useState → useReducer for streaming**
   - Replaced multiple useState calls with useReducer state machine
   - Prevents race conditions during SSE streaming transitions
   - Enables better progress tracking (thinking → parsing → executing → done)

3. **Primary Key Clarification**
   - Added detailed comment explaining when to use primary_key
   - Clarified Lead-level vs Opportunity-level metric counting
   - Clarified SGA filter patterns per metric type

4. **Feedback Component Added**
   - Thumbs up/down buttons after query results
   - Optional comment field for negative feedback
   - Logs to console for MVP (can extend to API later)

5. **Streaming Progress Indicator**
   - Shows meaningful progress messages during query execution
   - Better UX than generic skeleton loader

6. **V2 Features Clarified**
   - Funnel and Comparison visualizations marked as V2
   - System prompt updated to use TABLE for these in MVP

7. **agentApi Implementation Completed**
   - Full query() and queryStream() implementations
   - Proper error handling and SSE parsing

**Rationale**: These fixes address issues identified by technical review (Gemini) before agentic execution to prevent runtime errors and improve robustness.
```

---

## 🚀 AFTER FIXES ARE APPLIED

Once all fixes are applied and verified, the implementation guide is ready for agentic execution.

**Next Step:** Use the CURSOR-AGENTIC-EXECUTION-PROMPT.md to begin Phase 0.
