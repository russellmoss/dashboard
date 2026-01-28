'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

const TOOLTIP_WIDTH = 320;
const VIEWPORT_MARGIN = 16;

interface InfoTooltipProps {
  content: React.ReactNode;
  className?: string;
}

export function InfoTooltip({ content, className = '' }: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number; position: 'above' | 'below'; arrowLeft: number } | null>(null);
  const iconRef = useRef<SVGSVGElement>(null);

  const updateCoords = useCallback(() => {
    if (!iconRef.current) return;
    const iconRect = iconRef.current.getBoundingClientRect();
    const spaceAbove = iconRect.top;
    const spaceBelow = window.innerHeight - iconRect.bottom;
    const position: 'above' | 'below' = spaceAbove > spaceBelow * 2 && iconRect.top > 400 ? 'above' : 'below';

    // Horizontal: center on icon but clamp so tooltip doesn't go off left or right
    const idealLeft = iconRect.left + iconRect.width / 2 - TOOLTIP_WIDTH / 2;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(idealLeft, window.innerWidth - TOOLTIP_WIDTH - VIEWPORT_MARGIN));
    const arrowLeft = iconRect.left + iconRect.width / 2 - left; // px from tooltip left to center arrow

    const top = position === 'below'
      ? iconRect.bottom + 8
      : iconRect.top - 8; // for above we use -translate-y-full in class

    setCoords({ left, top, position, arrowLeft });
  }, []);

  const handleMouseEnter = useCallback(() => {
    updateCoords();
    setIsVisible(true);
  }, [updateCoords]);

  const handleMouseLeave = useCallback(() => {
    setIsVisible(false);
    setCoords(null);
  }, []);

  // Update position on scroll/resize while visible so it doesn't drift
  useEffect(() => {
    if (!isVisible || !iconRef.current) return;
    const interval = setInterval(updateCoords, 100);
    return () => clearInterval(interval);
  }, [isVisible, updateCoords]);

  const tooltipEl = isVisible && coords && typeof document !== 'undefined' && (
    <div
      className="fixed z-[100] w-80 max-w-[320px] p-3 text-sm bg-gray-900 text-white rounded-lg shadow-lg"
      style={{
        left: coords.left,
        top: coords.top,
        transform: coords.position === 'above' ? 'translateY(-100%)' : undefined,
      }}
    >
      <div
        className="absolute w-3 h-3 bg-gray-900 transform rotate-45"
        style={{
          left: Math.max(12, Math.min(coords.arrowLeft - 6, TOOLTIP_WIDTH - 12)),
          ...(coords.position === 'above' ? { bottom: '-6px' } : { top: '-6px' }),
        }}
      />
      <div className="break-words whitespace-normal overflow-hidden relative z-10">
        {content}
      </div>
    </div>
  );

  return (
    <div className={`relative inline-block ${className}`}>
      <Info
        ref={iconRef}
        className="h-4 w-4 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 cursor-help ml-1"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />
      {typeof document !== 'undefined' && tooltipEl && createPortal(tooltipEl, document.body)}
    </div>
  );
}
