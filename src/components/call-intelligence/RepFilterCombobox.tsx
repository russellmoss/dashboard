'use client';

// ============================================================================
// RepFilterCombobox — single-select type-ahead for the Insights tab filter bar
// ----------------------------------------------------------------------------
// Vanilla impl in the spirit of src/components/ui/MultiSelectCombobox.tsx, but
// single-select and rep-shaped (role badge + pod hint, "Unassigned (no pod)").
// In-memory substring filter against a pre-fetched list (~30 rows for a
// manager, no pagination). If usage grows past a few hundred reps, switch to
// server-side q= filtering on /api/call-intelligence/insights/reps.
// ============================================================================

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { InsightsRep } from '@/types/call-intelligence';

interface Props {
  reps: InsightsRep[];
  /** Currently focused rep id (from ?focus_rep). null when no rep selected. */
  value: string | null;
  /** Called with the rep (or null when cleared). */
  onChange: (rep: InsightsRep | null) => void;
  placeholder?: string;
  className?: string;
}

export default function RepFilterCombobox({
  reps,
  value,
  onChange,
  placeholder = 'Filter by rep…',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selectedRep = useMemo(
    () => (value ? reps.find(r => r.id === value) ?? null : null),
    [reps, value],
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reps;
    return reps.filter(r => r.fullName.toLowerCase().includes(q));
  }, [reps, query]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  const select = (rep: InsightsRep) => {
    onChange(rep);
    setOpen(false);
    setQuery('');
  };

  const clear = () => {
    onChange(null);
    setQuery('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) select(opt);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    } else if (e.key === 'Backspace' && query === '' && selectedRep) {
      // Empty input + Backspace → clear selection (conventional combobox).
      clear();
    }
  };

  // Show the selected rep's name in the input while closed; while open, the
  // user is typing freely so we show whatever they've typed.
  const displayValue = open
    ? query
    : selectedRep
      ? selectedRep.fullName
      : query;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
        className="flex items-center gap-1 min-h-[32px] px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 cursor-text"
      >
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Filter by rep"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={listboxId}
          role="combobox"
          className="flex-1 min-w-[140px] bg-transparent outline-none text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
        {selectedRep && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
            className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            aria-label="Clear rep filter"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 max-h-72 overflow-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 min-w-[260px]"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No reps match</li>
          ) : (
            filtered.map((rep, i) => {
              const isSelected = rep.id === value;
              const isActive = i === activeIndex;
              return (
                <li
                  key={rep.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={(e) => {
                    e.preventDefault();
                    select(rep);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`px-3 py-2 text-sm cursor-pointer ${
                    isActive ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                  } ${
                    isSelected
                      ? 'text-blue-900 dark:text-blue-100 font-medium'
                      : 'text-gray-900 dark:text-gray-100'
                  }`}
                >
                  {rep.fullName}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
