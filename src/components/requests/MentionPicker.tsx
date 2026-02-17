'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface TaggableUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface MentionPickerProps {
  users: TaggableUser[];
  query: string;
  /** Position relative to the textarea */
  position: { top: number; left: number } | null;
  onSelect: (user: TaggableUser) => void;
  onClose: () => void;
  visible: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  revops_admin: 'RevOps Admin',
  admin: 'Admin',
  manager: 'Manager',
  sgm: 'SGM',
  sga: 'SGA',
  viewer: 'Viewer',
};

const ROLE_COLORS: Record<string, string> = {
  revops_admin: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  admin: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  manager: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  sgm: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  sga: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  viewer: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

export function MentionPicker({
  users,
  query,
  position,
  onSelect,
  onClose,
  visible,
}: MentionPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter users by query
  const filtered = users.filter((user) => {
    const q = query.toLowerCase();
    return (
      user.name.toLowerCase().includes(q) ||
      user.email.toLowerCase().includes(q)
    );
  }).slice(0, 8); // Max 8 results

  // Reset selection when query or filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIndex] as HTMLElement;
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible || filtered.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filtered.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
          break;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          onSelect(filtered[selectedIndex]);
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [visible, filtered, selectedIndex, onSelect, onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!visible || !position || filtered.length === 0) return null;

  return (
    <div
      className="absolute z-50 w-72 max-h-56 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg"
      style={{ bottom: `calc(100% - ${position.top}px + 4px)`, left: position.left }}
      ref={listRef}
    >
      {filtered.map((user, index) => (
        <button
          key={user.id}
          type="button"
          className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
            index === selectedIndex
              ? 'bg-blue-50 dark:bg-blue-900/30'
              : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
          }`}
          onMouseDown={(e) => {
            e.preventDefault(); // Prevent textarea blur
            onSelect(user);
          }}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          {/* Avatar placeholder — initials circle */}
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center text-white text-xs font-medium">
            {user.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {user.name}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {user.email}
            </div>
          </div>
          <span
            className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded ${
              ROLE_COLORS[user.role] || ROLE_COLORS.viewer
            }`}
          >
            {ROLE_LABELS[user.role] || user.role}
          </span>
        </button>
      ))}
    </div>
  );
}
