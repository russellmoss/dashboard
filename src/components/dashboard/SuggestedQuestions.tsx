// src/components/dashboard/SuggestedQuestions.tsx
'use client';

interface SuggestedQuestionsProps {
  onSelect: (question: string) => void;
}

const SUGGESTED_QUESTIONS = {
  charts: {
    label: '📊 Charts',
    questions: [
      { text: 'SQOs by channel this quarter', viz: 'bar' },
      { text: 'SQO to Joined conversion rate for last 4 quarters', viz: 'line' },
      { text: 'SQO trend by month for the last 12 months', viz: 'line' },
      { text: 'Conversion rates by channel', viz: 'bar' },
    ],
  },
  metrics: {
    label: '🔢 Metrics',
    questions: [
      { text: 'How many SQOs this quarter?', viz: 'metric' },
      { text: 'What is our SQL to SQO rate?', viz: 'metric' },
      { text: 'Total joined AUM this year', viz: 'metric' },
    ],
  },
  comparisons: {
    label: '📈 Comparisons',
    questions: [
      { text: 'Compare SQOs this quarter vs last', viz: 'comparison' },
      { text: 'How do we compare to last month?', viz: 'comparison' },
      { text: 'SGA Leaderboard by SQO for current quarter by Outbound & Outbound + Marketing channels', viz: 'bar' },
    ],
  },
  details: {
    label: '📋 Details',
    questions: [
      { text: 'Show me the open pipeline list', viz: 'table' },
      { text: 'List SQOs for this quarter', viz: 'table' },
      { text: 'What SQOs came from the Commonwealth experiment?', viz: 'table' },
    ],
  },
};

export function SuggestedQuestions({ onSelect }: SuggestedQuestionsProps) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
        Try asking...
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(SUGGESTED_QUESTIONS).map(([key, category]) => (
          <div key={key} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {category.label}
              </span>
            </div>

            <div className="space-y-2">
              {category.questions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => {
                    console.log('[SuggestedQuestions] Question selected:', q.text);
                    onSelect(q.text);
                  }}
                  className="w-full text-left px-3 py-2 text-sm rounded-lg border 
                           border-gray-200 dark:border-gray-700 
                           bg-white dark:bg-gray-800
                           hover:bg-gray-50 dark:hover:bg-gray-700
                           transition-colors"
                  title={`Expected visualization: ${q.viz}`}
                >
                  {q.text}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
