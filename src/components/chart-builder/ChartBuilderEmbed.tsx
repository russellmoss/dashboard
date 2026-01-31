// src/components/chart-builder/ChartBuilderEmbed.tsx
// ═══════════════════════════════════════════════════════════════════════
// CHART BUILDER LAUNCHER COMPONENT
// Landing page with saved questions/dashboards and quick actions
// ═══════════════════════════════════════════════════════════════════════

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ExternalLink,
  BarChart2,
  PieChart,
  TrendingUp,
  Table2,
  Sparkles,
  LayoutDashboard,
  FileQuestion,
  Loader2,
  ChevronRight,
} from 'lucide-react';

interface MetabaseQuestion {
  id: number;
  name: string;
  description: string | null;
  display: string;
  embedUrl: string | null;
  collection?: {
    id: number;
    name: string;
  };
}

interface MetabaseDashboard {
  id: number;
  name: string;
  description: string | null;
  embedUrl: string | null;
  collection?: {
    id: number;
    name: string;
  };
}

interface MetabaseContent {
  questions: MetabaseQuestion[];
  dashboards: MetabaseDashboard[];
  configured: boolean;
  embeddingEnabled?: boolean;
  error?: string;
}

interface ChartBuilderEmbedProps {
  metabaseUrl: string;
  className?: string;
}

// Map Metabase display types to icons
function getDisplayIcon(display: string) {
  switch (display) {
    case 'bar':
      return <BarChart2 className="w-4 h-4" />;
    case 'pie':
      return <PieChart className="w-4 h-4" />;
    case 'line':
    case 'area':
      return <TrendingUp className="w-4 h-4" />;
    case 'table':
    case 'pivot':
      return <Table2 className="w-4 h-4" />;
    default:
      return <FileQuestion className="w-4 h-4" />;
  }
}

export function ChartBuilderEmbed({ metabaseUrl, className = '' }: ChartBuilderEmbedProps) {
  const [content, setContent] = useState<MetabaseContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'questions' | 'dashboards'>('questions');

  // Fetch saved content from Metabase
  useEffect(() => {
    async function fetchContent() {
      try {
        const response = await fetch('/api/metabase/content');
        if (response.ok) {
          const data = await response.json();
          setContent(data);
        }
      } catch (error) {
        console.error('Failed to fetch Metabase content:', error);
      } finally {
        setIsLoading(false);
      }
    }
    fetchContent();
  }, []);

  const handleOpenMetabase = useCallback(() => {
    window.open(metabaseUrl, '_blank', 'noopener,noreferrer');
  }, [metabaseUrl]);

  const handleOpenNewQuestion = useCallback(() => {
    window.open(`${metabaseUrl}/question/notebook`, '_blank', 'noopener,noreferrer');
  }, [metabaseUrl]);

  const handleOpenQuestion = useCallback((question: MetabaseQuestion) => {
    // Use embed URL if available (no login required), otherwise fall back to direct link
    const url = question.embedUrl || `${metabaseUrl}/question/${question.id}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [metabaseUrl]);

  const handleOpenDashboard = useCallback((dashboard: MetabaseDashboard) => {
    // Use embed URL if available (no login required), otherwise fall back to direct link
    const url = dashboard.embedUrl || `${metabaseUrl}/dashboard/${dashboard.id}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [metabaseUrl]);

  const handleOpenDashboards = useCallback(() => {
    window.open(`${metabaseUrl}/collection/root`, '_blank', 'noopener,noreferrer');
  }, [metabaseUrl]);

  const hasContent = content && (content.questions.length > 0 || content.dashboards.length > 0);

  return (
    <div className={`flex flex-col h-full bg-gray-50 dark:bg-gray-900 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Chart Builder
          </h1>
          <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded">
            Powered by Metabase
          </span>
        </div>
        <button
          onClick={handleOpenMetabase}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          Open Metabase
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto">
          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <button
              onClick={handleOpenNewQuestion}
              className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all text-left"
            >
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <Sparkles className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">Create New Chart</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Start building a custom visualization
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 ml-auto" />
            </button>

            <button
              onClick={handleOpenDashboards}
              className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm transition-all text-left"
            >
              <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg">
                <LayoutDashboard className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">Browse All</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Explore all charts and dashboards
                </p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 ml-auto" />
            </button>
          </div>

          {/* Saved Content Section */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              <span className="ml-2 text-gray-600 dark:text-gray-400">Loading saved charts...</span>
            </div>
          ) : hasContent ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              {/* Tabs */}
              <div className="flex border-b border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setActiveTab('questions')}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === 'questions'
                      ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  <FileQuestion className="w-4 h-4 inline mr-2" />
                  Saved Charts ({content?.questions.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab('dashboards')}
                  className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                    activeTab === 'dashboards'
                      ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50 dark:bg-blue-900/20'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4 inline mr-2" />
                  Dashboards ({content?.dashboards.length || 0})
                </button>
              </div>

              {/* Content List */}
              <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-auto">
                {activeTab === 'questions' && content?.questions.map((question) => (
                  <button
                    key={question.id}
                    onClick={() => handleOpenQuestion(question)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
                  >
                    <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-400">
                      {getDisplayIcon(question.display)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {question.name}
                      </h4>
                      {question.collection && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {question.collection.name}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  </button>
                ))}

                {activeTab === 'dashboards' && content?.dashboards.map((dashboard) => (
                  <button
                    key={dashboard.id}
                    onClick={() => handleOpenDashboard(dashboard)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
                  >
                    <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded text-gray-600 dark:text-gray-400">
                      <LayoutDashboard className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {dashboard.name}
                      </h4>
                      {dashboard.collection && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {dashboard.collection.name}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  </button>
                ))}

                {activeTab === 'questions' && content?.questions.length === 0 && (
                  <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No saved charts yet. Create your first chart!
                  </div>
                )}

                {activeTab === 'dashboards' && content?.dashboards.length === 0 && (
                  <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No dashboards yet. Create your first dashboard!
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Empty State / Not Configured */
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full mb-4">
                <FileQuestion className="w-6 h-6 text-gray-400" />
              </div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-2">
                {content?.configured === false
                  ? 'Metabase API Not Configured'
                  : 'No Saved Charts Yet'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {content?.configured === false
                  ? 'Add METABASE_API_EMAIL and METABASE_API_PASSWORD to your environment to see saved charts here.'
                  : 'Create charts in Metabase and they will appear here.'}
              </p>
              <button
                onClick={handleOpenMetabase}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Open Metabase
              </button>
            </div>
          )}

          {/* Capabilities Footer */}
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <BarChart2 className="w-4 h-4 text-blue-500" />
              <span>Bar & Column Charts</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <PieChart className="w-4 h-4 text-blue-500" />
              <span>Pie & Donut Charts</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <span>Line & Area Charts</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <Table2 className="w-4 h-4 text-blue-500" />
              <span>Tables & Pivots</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
