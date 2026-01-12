'use client';

import { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
  content: React.ReactNode;
  className?: string;
}

export function InfoTooltip({ content, className = '' }: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<'above' | 'below'>('below');
  const tooltipRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (isVisible && iconRef.current && tooltipRef.current) {
      const iconRect = iconRef.current.getBoundingClientRect();
      const tooltipHeight = 400; // Approximate tooltip height
      const spaceAbove = iconRect.top;
      const spaceBelow = window.innerHeight - iconRect.bottom;

      // If there's more space below or we're near the top, show below
      if (spaceBelow > spaceAbove || iconRect.top < 200) {
        setPosition('below');
      } else {
        setPosition('above');
      }
    }
  }, [isVisible]);

  return (
    <div className={`relative inline-block ${className}`}>
      <Info
        ref={iconRef}
        className="h-4 w-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-help ml-1"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      />
      {isVisible && (
        <div
          ref={tooltipRef}
          className={`absolute z-50 w-80 p-3 text-sm bg-gray-900 text-white rounded-lg shadow-lg -translate-x-1/2 left-1/2 ${
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
          {content}
        </div>
      )}
    </div>
  );
}
