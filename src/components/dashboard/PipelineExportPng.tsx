'use client';

import React, { useState } from 'react';
import { Image, Loader2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toPng } from 'html-to-image';

interface PipelineExportPngProps {
  chartElementId: string;
  filename?: string;
  disabled?: boolean;
}

export function PipelineExportPng({
  chartElementId,
  filename = 'open-pipeline-chart',
  disabled = false,
}: PipelineExportPngProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const handleExport = async () => {
    const element = document.getElementById(chartElementId);
    if (!element) {
      console.error('Chart element not found:', chartElementId);
      alert('Chart not available for export');
      return;
    }

    setIsExporting(true);
    try {
      // Use theme-appropriate background color
      const backgroundColor = isDark ? '#1f2937' : '#ffffff'; // gray-800 for dark, white for light
      
      const dataUrl = await toPng(element, {
        backgroundColor,
        pixelRatio: 3, // Higher quality for better text rendering
        quality: 1.0,
        style: {
          transform: 'scale(1)',
        },
        filter: (node) => {
          // Exclude elements that shouldn't be in the export
          // But include all chart elements
          return true;
        },
      });
      
      const timestamp = new Date().toISOString().split('T')[0];
      const link = document.createElement('a');
      link.download = `${filename}_${timestamp}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('PNG export failed:', err);
      alert('Failed to export PNG. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={disabled || isExporting}
      className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-gray-200 
                 dark:border-gray-700 bg-white dark:bg-gray-800 
                 hover:bg-gray-50 dark:hover:bg-gray-700 
                 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title="Export chart as PNG image"
    >
      {isExporting ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Image className="w-4 h-4" />
      )}
      <span>Export PNG</span>
    </button>
  );
}
