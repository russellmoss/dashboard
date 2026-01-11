/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // Temporarily disabled Tremor scanning - can cause compilation slowdown
    // './node_modules/@tremor/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Custom dashboard colors
        'dashboard': {
          // Light mode
          'bg': '#f9fafb',
          'card': '#ffffff',
          'border': '#e5e7eb',
          'border-hover': '#3b82f6',
          // Zebra striping
          'zebra-even': '#ffffff',
          'zebra-odd': '#f9fafb',
          'zebra-hover': '#eff6ff',
          // Dark mode equivalents
          'dark-bg': '#111827',
          'dark-card': '#1f2937',
          'dark-border': '#374151',
          'dark-border-hover': '#60a5fa',
          'dark-zebra-even': '#1f2937',
          'dark-zebra-odd': '#111827',
          'dark-zebra-hover': '#1e3a5f',
        },
      },
      boxShadow: {
        // Scorecard hover shadow
        'scorecard': '0 2px 4px rgba(0, 0, 0, 0.05)',
        'scorecard-hover': '0 4px 12px rgba(59, 130, 246, 0.15)',
      },
    },
  },
  plugins: [],
};
