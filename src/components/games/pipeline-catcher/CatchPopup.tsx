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

  useEffect(() => {
    if (type) {
      const now = Date.now();
      const lastTime = type === 'sqo' ? lastSqoTime.current : lastJoinedTime.current;
      
      // 5 second cooldown
      if (now - lastTime < 5000) {
        onComplete();
        return;
      }
      
      if (type === 'sqo') {
        lastSqoTime.current = now;
      } else {
        lastJoinedTime.current = now;
      }
      
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        // Wait for fade out animation to finish before calling onComplete
        const cleanupTimer = setTimeout(() => {
          onComplete();
        }, 300);
        // return () => clearTimeout(cleanupTimer); // Do not clean up cleanupTimer here
      }, 2000); // Visible for 2 seconds
      
      // Only clean up the main timer if the component unmounts or type changes
      return () => clearTimeout(timer);
    }
  }, [type]); // Removed onComplete from dependency array to prevent effect re-running

  const imageSrc = type === 'joined' 
    ? '/games/pipeline-catcher/images/advisor-joined.png'
    : '/games/pipeline-catcher/images/another-sqo.png';

  if (!visible) return null;

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
