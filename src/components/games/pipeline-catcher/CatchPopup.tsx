import Image from 'next/image';
import { useEffect, useState, useRef } from 'react';

interface CatchPopupProps {
  type: 'sqo' | 'joined' | null;
  onComplete: () => void;
}

export default function CatchPopup({ type, onComplete }: CatchPopupProps) {
  const [visible, setVisible] = useState(false);
  const lastSqoTime = useRef(0);
  const lastJoinedTime = useRef(0);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!type) {
      setVisible(false);
      return;
    }
    const now = Date.now();
    const lastTime = type === 'sqo' ? lastSqoTime.current : lastJoinedTime.current;

    // 5 second cooldown
    if (now - lastTime < 5000) {
      onCompleteRef.current();
      return;
    }

    if (type === 'sqo') {
      lastSqoTime.current = now;
    } else {
      lastJoinedTime.current = now;
    }

    setVisible(true);
    const duration = 2000;
    const timer = setTimeout(() => {
      setVisible(false);
      cleanupTimerRef.current = setTimeout(() => {
        onCompleteRef.current();
        cleanupTimerRef.current = null;
      }, 300);
    }, duration);

    return () => {
      clearTimeout(timer);
      if (cleanupTimerRef.current) {
        clearTimeout(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
    };
  }, [type]); // onComplete excluded so effect doesn't re-run every render (avoids clearing timer)

  const imageSrc =
    type === 'joined'
      ? '/games/pipeline-catcher/images/advisor-joined.png'
      : '/games/pipeline-catcher/images/another-sqo.png';

  if (!type || !visible) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center pointer-events-none z-50 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <Image
        src={imageSrc}
        alt={type === 'joined' ? 'Advisor Joined!' : 'Another SQO!'}
        width={300}
        height={300}
        className={`transition-transform duration-300 ${visible ? 'scale-100' : 'scale-50'}`}
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}
