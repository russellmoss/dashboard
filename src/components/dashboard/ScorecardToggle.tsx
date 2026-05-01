'use client';

interface ScorecardToggleProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}

export function ScorecardToggle<T extends string>({ value, onChange, options }: ScorecardToggleProps<T>) {
  return (
    <div
      className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-md p-0.5 mt-2"
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((option) => (
        <button
          key={option.value}
          onClick={(e) => {
            e.stopPropagation();
            onChange(option.value);
          }}
          className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
            value === option.value
              ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
