'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // If theme is 'system', convert it to the resolved theme
  useEffect(() => {
    if (mounted && theme === 'system') {
      setTheme(resolvedTheme || 'light');
    }
  }, [mounted, theme, resolvedTheme, setTheme]);

  if (!mounted) {
    return (
      <button className="theme-toggle" aria-label="Toggle theme">
        <div className="w-5 h-5 bg-gray-200 rounded animate-pulse" />
      </button>
    );
  }

  // Get the current effective theme (convert 'system' to resolved theme)
  const currentTheme = theme === 'system' ? (resolvedTheme || 'light') : theme;

  const toggleTheme = () => {
    // Only toggle between light and dark
    if (currentTheme === 'light') {
      setTheme('dark');
    } else {
      setTheme('light');
    }
  };

  const getIcon = () => {
    return currentTheme === 'dark' ? (
      <Moon className="w-5 h-5" />
    ) : (
      <Sun className="w-5 h-5" />
    );
  };

  const getLabel = () => {
    return currentTheme === 'dark' ? 'Dark mode' : 'Light mode';
  };

  return (
    <button
      onClick={toggleTheme}
      className="theme-toggle group relative"
      aria-label={getLabel()}
      title={getLabel()}
    >
      {getIcon()}
      <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-800 px-2 py-1 rounded">
        {getLabel()}
      </span>
    </button>
  );
}
