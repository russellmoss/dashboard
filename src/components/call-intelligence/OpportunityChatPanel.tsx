'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Send, MessageCircle, Info, ChevronDown, ExternalLink, ChevronRight, Plus, Clock, ArrowLeft } from 'lucide-react';
import type { OpportunityChatMessage, OpportunityChatThreadSummary, ChatStreamChunk } from '@/types/call-intelligence-opportunities';

const MARKDOWN_PROSE = [
  '[&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:dark:text-white',
  '[&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:dark:text-white',
  '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:dark:text-white',
  '[&_p]:text-sm [&_p]:leading-6 [&_p]:my-2 [&_p]:dark:text-gray-100',
  '[&_strong]:font-semibold [&_strong]:dark:text-white',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ul]:space-y-1',
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_ol]:space-y-1',
  '[&_li]:text-sm [&_li]:leading-6 [&_li]:dark:text-gray-100',
  '[&_a]:text-indigo-400 [&_a]:underline [&_a]:hover:text-indigo-300',
].join(' ');

const SUGGESTED_PROMPTS = [
  'Prep me for my next call with personal rapport notes',
  'What type of advisor persona is this and how should I approach them?',
  'What are the open objections?',
  'Draft a personalized pitch based on their persona and concerns',
  'What personal details have they shared that I should remember?',
  'What should I bring up in our next meeting?',
];

interface Props {
  opportunityId: string;
  isOpen: boolean;
  onClose: () => void;
  advisorName: string;
}

interface SourceDoc {
  title: string;
  url: string;
}

function formatRelativeDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function OpportunityChatPanel({ opportunityId, isOpen, onClose, advisorName }: Props) {
  const [messages, setMessages] = useState<OpportunityChatMessage[]>([]);
  const [threads, setThreads] = useState<OpportunityChatThreadSummary[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadTitle, setThreadTitle] = useState<string | null>(null);
  const [showNewMessagePill, setShowNewMessagePill] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [showThreadList, setShowThreadList] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isUserScrolledUp = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadThread = useCallback(async (specificThreadId?: string) => {
    setIsLoading(true);
    setError(null);
    setShowThreadList(false);
    try {
      const qs = specificThreadId ? `?threadId=${specificThreadId}` : '';
      const res = await fetch(`/api/call-intelligence/opportunities/${opportunityId}/chat${qs}`);
      if (!res.ok) throw new Error(`Failed to load chat: ${res.status}`);
      const data = await res.json();
      setThreadId(data.thread.id);
      setThreadTitle(data.thread.title);
      setMessages(data.messages);
      setThreads(data.threads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chat');
    } finally {
      setIsLoading(false);
    }
  }, [opportunityId]);

  // Esc-to-close (or back from thread list)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showThreadList) {
          setShowThreadList(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, showThreadList]);

  // Load thread on open
  useEffect(() => {
    if (!isOpen) return;
    loadThread();
  }, [isOpen, loadThread]);

  // Auto-scroll
  useEffect(() => {
    if (!isUserScrolledUp.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    } else if (isUserScrolledUp.current && (messages.length > 0 || streamingContent)) {
      setShowNewMessagePill(true);
    }
  }, [messages, streamingContent]);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    isUserScrolledUp.current = !atBottom;
    if (atBottom) setShowNewMessagePill(false);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    isUserScrolledUp.current = false;
    setShowNewMessagePill(false);
  }, []);

  // Focus input when panel opens or thread loads
  useEffect(() => {
    if (isOpen && !isLoading && !showThreadList) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen, isLoading, showThreadList]);

  const createNewThread = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setShowThreadList(false);
    try {
      const res = await fetch(`/api/call-intelligence/opportunities/${opportunityId}/chat?action=new`);
      if (!res.ok) throw new Error(`Failed to create thread: ${res.status}`);
      const data = await res.json();
      setThreadId(data.thread.id);
      setThreadTitle(data.thread.title);
      setMessages([]);
      setThreads(data.threads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create thread');
    } finally {
      setIsLoading(false);
    }
  }, [opportunityId]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: OpportunityChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      citedChunkIds: [],
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setError(null);
    setIsStreaming(true);
    setStreamingContent('');
    isUserScrolledUp.current = false;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch(`/api/call-intelligence/opportunities/${opportunityId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({ message: text.trim(), threadId }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Chat request failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let doneCitedIds: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk: ChatStreamChunk = JSON.parse(line.slice(6));
            if (chunk.type === 'text') {
              fullContent += chunk.content;
              setStreamingContent(fullContent);
            } else if (chunk.type === 'done') {
              doneCitedIds = chunk.citedChunkIds;
            } else if (chunk.type === 'error') {
              throw new Error(chunk.message);
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== 'Failed to generate response') {
              // Ignore JSON parse errors on malformed chunks
            } else {
              throw parseErr;
            }
          }
        }
      }

      const assistantMsg: OpportunityChatMessage = {
        id: `temp-assistant-${Date.now()}`,
        role: 'assistant',
        content: fullContent,
        citedChunkIds: doneCitedIds,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setStreamingContent('');

      // Refresh thread list to pick up new title (generated after first exchange)
      if (messages.length === 0) {
        setTimeout(async () => {
          try {
            const res = await fetch(`/api/call-intelligence/opportunities/${opportunityId}/chat?threadId=${threadId}`);
            if (res.ok) {
              const data = await res.json();
              setThreadTitle(data.thread.title);
              setThreads(data.threads ?? []);
            }
          } catch { /* ignore */ }
        }, 3000);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setStreamingContent('');
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [isStreaming, opportunityId, threadId, messages.length]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  const toggleSources = (messageId: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  function extractSourceDocs(content: string): SourceDoc[] {
    const linkRegex = /\[([^\]]+)\]\((https:\/\/docs\.google\.com\/document\/d\/[^\s)]+)\)/g;
    const seen = new Set<string>();
    const docs: SourceDoc[] = [];
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      const url = match[2];
      if (!seen.has(url)) {
        seen.add(url);
        docs.push({ title: match[1], url });
      }
    }
    return docs;
  }

  const showSuggestions = !isStreaming && !isLoading && !showThreadList &&
    (messages.filter((m) => m.role !== 'system').length === 0 ||
     messages[messages.length - 1]?.role === 'assistant');

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/20 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chat about this deal"
        className={`fixed inset-y-0 right-0 z-40 flex w-[45vw] min-w-[380px] max-w-[640px] flex-col
                     bg-white shadow-xl dark:bg-gray-900
                     transform transition-transform duration-300 ease-in-out
                     ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {showThreadList && (
                <button
                  onClick={() => setShowThreadList(false)}
                  className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  aria-label="Back to chat"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                {showThreadList ? 'Chat History' : (threadTitle || 'Chat about this deal')}
              </h2>
            </div>
            {!showThreadList && advisorName && (
              <p className="truncate text-xs text-gray-500 dark:text-gray-400">{advisorName}</p>
            )}
          </div>
          <div className="ml-3 flex items-center gap-1">
            {!showThreadList && (
              <>
                <button
                  onClick={() => setShowThreadList(true)}
                  className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  aria-label="View chat history"
                  title="Chat history"
                >
                  <Clock className="h-4 w-4" />
                </button>
                <button
                  onClick={createNewThread}
                  className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  aria-label="New chat"
                  title="New chat"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              aria-label="Close chat"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Thread list view */}
        {showThreadList ? (
          <div className="flex-1 overflow-y-auto">
            <div className="p-3">
              <button
                onClick={createNewThread}
                className="flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-3
                           text-sm text-gray-600 hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700
                           dark:border-gray-600 dark:text-gray-400 dark:hover:border-indigo-500 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-300
                           transition-colors"
              >
                <Plus className="h-4 w-4" />
                Start new chat
              </button>
            </div>
            <div className="space-y-1 px-3 pb-3">
              {threads.map((t) => (
                <button
                  key={t.id}
                  onClick={() => loadThread(t.id)}
                  className={`flex w-full flex-col rounded-lg px-3 py-2.5 text-left transition-colors
                    ${t.id === threadId
                      ? 'bg-indigo-50 dark:bg-indigo-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                >
                  <span className={`text-sm font-medium truncate ${
                    t.id === threadId
                      ? 'text-indigo-700 dark:text-indigo-300'
                      : 'text-gray-900 dark:text-gray-100'
                  }`}>
                    {t.title || 'Untitled chat'}
                  </span>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span>{t.messageCount} message{t.messageCount !== 1 ? 's' : ''}</span>
                    <span>&middot;</span>
                    <span>{formatRelativeDate(t.lastMessageAt || t.createdAt)}</span>
                  </div>
                </button>
              ))}
              {threads.length === 0 && (
                <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                  No conversations yet
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Messages area */}
            <div
              ref={messagesContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto px-4 py-3"
            >
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="animate-pulse">
                      <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
                      <div className="mt-1 h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {messages.length === 0 && !isStreaming && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <MessageCircle className="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Ask questions about this opportunity&apos;s calls, deal context, and our knowledge base.
                      </p>
                    </div>
                  )}

                  {messages.map((msg) => {
                    if (msg.role === 'system') {
                      return (
                        <div key={msg.id} className="my-3 flex justify-center">
                          <div className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                            <Info className="h-3.5 w-3.5 flex-shrink-0" />
                            <span>{msg.content}</span>
                          </div>
                        </div>
                      );
                    }

                    if (msg.role === 'user') {
                      return (
                        <div key={msg.id} className="my-3 flex justify-end">
                          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-sm text-white">
                            {msg.content}
                          </div>
                        </div>
                      );
                    }

                    const sources = extractSourceDocs(msg.content);
                    const isExpanded = expandedSources.has(msg.id);

                    return (
                      <div key={msg.id} className="my-3">
                        <div className="max-w-[95%] rounded-2xl rounded-bl-md bg-gray-100 px-4 py-2.5 dark:bg-gray-800">
                          <div className={MARKDOWN_PROSE}>
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{ a: ({ href, children }) => (
                                <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                              )}}
                            >{msg.content}</ReactMarkdown>
                          </div>
                        </div>

                        {sources.length > 0 && (
                          <div className="ml-1 mt-1">
                            <button
                              onClick={() => toggleSources(msg.id)}
                              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                            >
                              <ChevronRight className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                              {sources.length} source{sources.length !== 1 ? 's' : ''}
                            </button>
                            {isExpanded && (
                              <div className="ml-4 mt-1 space-y-1">
                                {sources.map((doc) => (
                                  <a
                                    key={doc.url}
                                    href={doc.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-400"
                                  >
                                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                    {doc.title}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Streaming message */}
                  {isStreaming && (
                    <div className="my-3">
                      <div className="max-w-[95%] rounded-2xl rounded-bl-md bg-gray-100 px-4 py-2.5 dark:bg-gray-800">
                        {streamingContent ? (
                          <div className={MARKDOWN_PROSE}>
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{ a: ({ href, children }) => (
                                <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                              )}}
                            >{streamingContent}</ReactMarkdown>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 py-1">
                            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
                            <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {error && (
                    <div className="my-3 flex justify-center">
                      <div className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
                        <span>{error}</span>
                        <button
                          onClick={() => {
                            setError(null);
                            const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
                            if (lastUserMsg) sendMessage(lastUserMsg.content);
                          }}
                          className="ml-1 rounded bg-red-100 px-2 py-0.5 text-xs font-medium hover:bg-red-200 dark:bg-red-800 dark:hover:bg-red-700"
                        >
                          Retry
                        </button>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* New message pill */}
            {showNewMessagePill && (
              <div className="absolute bottom-32 left-1/2 z-10 -translate-x-1/2">
                <button
                  onClick={scrollToBottom}
                  className="flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-indigo-700"
                >
                  <ChevronDown className="h-3 w-3" />
                  New message
                </button>
              </div>
            )}

            {/* Suggested prompts */}
            {showSuggestions && (
              <div className="flex flex-wrap gap-2 border-t border-gray-100 px-4 py-2 dark:border-gray-800">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700
                               hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700
                               dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300
                               dark:hover:border-indigo-500 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300
                               transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {/* Input bar */}
            <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about this deal..."
                  rows={1}
                  disabled={isStreaming || isLoading}
                  className="flex-1 resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm
                             placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
                             disabled:opacity-50
                             dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500
                             dark:focus:border-indigo-400 dark:focus:ring-indigo-400"
                  style={{ maxHeight: '120px' }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = 'auto';
                    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                  }}
                />
                <button
                  onClick={() => sendMessage(inputValue)}
                  disabled={!inputValue.trim() || isStreaming || isLoading}
                  className="flex-shrink-0 rounded-lg bg-indigo-600 p-2 text-white
                             hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40
                             transition-colors"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
