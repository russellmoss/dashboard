'use client';

// ============================================================================
// MultiSelectCombobox — vanilla (no external combobox lib)
// ----------------------------------------------------------------------------
// Narrow-scope primitive for filter bars: multi-select, substring search,
// keyboard navigation, chip display. Matches the Tailwind conventions used in
// src/components/outreach-effectiveness/OutreachEffectivenessFilters.tsx.
//
// Intentionally NOT a general-purpose combobox library (no async loading, no
// virtualization, no grouped options). Good for <1k options. If you need more,
// reach for cmdk or Radix before extending this.
// ============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional note shown dimmed next to the label. Used for synthetic options. */
  hint?: string;
}

interface MultiSelectComboboxProps {
  options: ComboboxOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** aria-label for the root input (e.g. "Campaign"). */
  ariaLabel?: string;
  /** Label shown when nothing matches the current query. */
  emptyMessage?: string;
  className?: string;
}

export default function MultiSelectCombobox({
  options,
  selected,
  onChange,
  placeholder = 'Select…',
  ariaLabel,
  emptyMessage = 'No matches',
  className = '',
}: MultiSelectComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Filter visible options by substring. Case-insensitive. Keeps the active
  // index in range when the filtered list shrinks.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(opt => opt.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length, activeIndex]);

  const labelFor = (value: string): string => {
    const match = options.find(o => o.value === value);
    return match?.label ?? value;
  };

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const clearAll = () => {
    onChange([]);
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
      if (opt) toggle(opt.value);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Backspace' && query === '' && selected.length > 0) {
      // Remove last chip if query is empty — conventional combobox behavior.
      onChange(selected.slice(0, -1));
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* Input + chips */}
      <div
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
        className="flex flex-wrap gap-1 min-h-[38px] items-center px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 cursor-text"
      >
        {selected.map(v => (
          <span
            key={v}
            className="inline-flex items-center gap-1 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 text-xs font-medium rounded px-2 py-0.5"
          >
            {labelFor(v)}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggle(v);
              }}
              className="hover:text-blue-600 dark:hover:text-blue-100 focus:outline-none"
              aria-label={`Remove ${labelFor(v)}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? placeholder : ''}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-autocomplete="list"
          role="combobox"
          className="flex-1 min-w-[60px] bg-transparent outline-none text-sm"
        />
        {selected.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              clearAll();
            }}
            className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 pr-1"
            aria-label="Clear all"
          >
            Clear
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <ul
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 max-h-64 overflow-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{emptyMessage}</li>
          ) : (
            filtered.map((opt, i) => {
              const isSelected = selected.includes(opt.value);
              const isActive = i === activeIndex;
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  onClick={(e) => {
                    e.preventDefault();
                    toggle(opt.value);
                    inputRef.current?.focus();
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-900/30'
                      : ''
                  } ${
                    isSelected
                      ? 'text-blue-900 dark:text-blue-100 font-medium'
                      : 'text-gray-900 dark:text-gray-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    tabIndex={-1}
                    className="rounded border-gray-300 text-blue-600 focus:ring-0 cursor-pointer"
                  />
                  <span className="flex-1">{opt.label}</span>
                  {opt.hint && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">{opt.hint}</span>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
