'use client';

import Image from 'next/image';
import { useEffect, useState, useRef } from 'react';
import { GAME_CONFIG } from '@/config/game-constants';

const JED_POPUP_DURATION_MS = 3000;
const JED_IMAGE_SIZE = 200; // Fits within 700x500 canvas

interface JedPopupProps {
  onComplete: () => void;
}

export default function JedPopup({ onComplete }: JedPopupProps) {
  const [visible, setVisible] = useState(true);
  const onCompleteRef = useRef(onComplete);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      cleanupTimerRef.current = setTimeout(() => {
        onCompleteRef.current();
        cleanupTimerRef.current = null;
      }, 300);
    }, JED_POPUP_DURATION_MS);
    return () => {
      clearTimeout(timer);
      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-20 rounded-lg bg-slate-900/80 transition-opacity duration-300"
      style={{ width: GAME_CONFIG.CANVAS_WIDTH, height: GAME_CONFIG.CANVAS_HEIGHT }}
      aria-live="polite"
    >
      <Image
        src="/games/pipeline-catcher/images/jed-got-me.png"
        alt="You got Jed!"
        width={JED_IMAGE_SIZE}
        height={JED_IMAGE_SIZE}
        className="object-contain transition-transform duration-300"
        style={{ imageRendering: 'pixelated' }}
      />
      <p
        className="text-red-500 font-black text-2xl md:text-3xl mt-3 drop-shadow-lg"
        style={{ textShadow: '0 0 8px rgba(0,0,0,0.8)' }}
      >
        YOU GOT JED!!!
      </p>
      <p className="text-white font-bold text-base mt-1 drop-shadow-md">Caught = Jed +$1B</p>
    </div>
  );
}
