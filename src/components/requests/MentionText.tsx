'use client';

import React from 'react';

interface MentionTextProps {
  content: string;
  /** If true, truncate to this many characters (handles mention markup safely) */
  maxLength?: number;
}

// Regex to match @[Display Name](userId) pattern
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Parses comment content and renders @mentions as styled spans.
 * Plain text is rendered normally with whitespace-pre-wrap preserved.
 */
export function MentionText({ content, maxLength }: MentionTextProps) {
  const displayContent = maxLength ? truncateWithMentions(content, maxLength) : content;
  const parts = parseMentions(displayContent);

  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, index) =>
        part.type === 'mention' ? (
          <span
            key={index}
            className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-medium mx-0.5"
            title={part.displayName}
          >
            @{part.displayName}
          </span>
        ) : (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        )
      )}
    </span>
  );
}

interface TextPart {
  type: 'text';
  text: string;
}

interface MentionPart {
  type: 'mention';
  displayName: string;
  userId: string;
}

type ContentPart = TextPart | MentionPart;

function parseMentions(content: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let lastIndex = 0;

  // Reset regex state
  MENTION_REGEX.lastIndex = 0;

  let match;
  while ((match = MENTION_REGEX.exec(content)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: content.slice(lastIndex, match.index) });
    }

    // Add mention
    parts.push({
      type: 'mention',
      displayName: match[1],
      userId: match[2],
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push({ type: 'text', text: content.slice(lastIndex) });
  }

  return parts;
}

/**
 * Truncates content to approximately maxLength visible characters,
 * without breaking mention markup mid-pattern.
 */
function truncateWithMentions(content: string, maxLength: number): string {
  let visibleLength = 0;
  let safeIndex = 0;

  MENTION_REGEX.lastIndex = 0;

  // Walk through the content tracking visible characters
  let match;
  let lastMatchEnd = 0;
  const matches: Array<{ start: number; end: number; displayName: string }> = [];

  while ((match = MENTION_REGEX.exec(content)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      displayName: match[1],
    });
  }

  let i = 0;
  let matchIdx = 0;

  while (i < content.length && visibleLength < maxLength) {
    // Check if we're at a mention start
    if (matchIdx < matches.length && i === matches[matchIdx].start) {
      const m = matches[matchIdx];
      // The mention displays as "@Name" — count that length
      const mentionVisibleLen = m.displayName.length + 1; // +1 for @
      if (visibleLength + mentionVisibleLen > maxLength) {
        break; // Don't include partial mention
      }
      visibleLength += mentionVisibleLen;
      i = m.end;
      safeIndex = i;
      matchIdx++;
    } else {
      visibleLength++;
      i++;
      safeIndex = i;
    }
  }

  if (safeIndex >= content.length) return content;
  return content.slice(0, safeIndex) + '...';
}
