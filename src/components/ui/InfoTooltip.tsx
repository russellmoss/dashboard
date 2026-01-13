'use client';

import { useState, useRef, useCallback } from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  content: React.ReactNode;
  className?: string;
}

export function InfoTooltip({ content, className = '' }: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<'above' | 'below'>('below');
  const iconRef = useRef<SVGSVGElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (iconRef.current) {
      const iconRect = iconRef.current.getBoundingClientRect();
      const spaceAbove = iconRect.top;
      const spaceBelow = window.innerHeight - iconRect.bottom;

      // Default to below - only show above if there's significantly more space above (2x)
      // This prevents cutoff at the top of the page
      if (spaceAbove > spaceBelow * 2 && iconRect.top > 400) {
        setPosition('above');
      } else {
        setPosition('below');
      }
    }
    setIsVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsVisible(false);
  }, []);

  return (
    <div className={`relative inline-block ${className}`}>
      <Info
        ref={iconRef}
        className="h-4 w-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-help ml-1"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />
      {isVisible && (
        <div
          className={`absolute z-50 w-80 max-w-[320px] p-3 text-sm bg-gray-900 text-white rounded-lg shadow-lg -translate-x-1/2 left-1/2 ${
            position === 'above' 
              ? 'bottom-full mb-2' 
              : 'top-full mt-2'
          }`}
        >
          <div
            className={`absolute w-3 h-3 bg-gray-900 transform rotate-45 left-1/2 -translate-x-1/2 ${
              position === 'above'
                ? '-bottom-1.5'
                : '-top-1.5'
            }`}
          />
          <div className="break-words whitespace-normal overflow-hidden">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}
