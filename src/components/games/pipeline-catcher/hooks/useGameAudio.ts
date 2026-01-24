import { useRef, useCallback, useEffect } from 'react';

type AudioTrack = 'menu' | 'gameplay' | 'gameover';

const AUDIO_PATHS: Record<AudioTrack, string> = {
  menu: '/games/pipeline-catcher/audio/menu-music.mp3',
  gameplay: '/games/pipeline-catcher/audio/gameplay-music.mp3',
  gameover: '/games/pipeline-catcher/audio/gameover-music.mp3',
};

export function useGameAudio() {
  const audioRefs = useRef<Record<AudioTrack, HTMLAudioElement | null>>({
    menu: null, gameplay: null, gameover: null,
  });
  const currentTrack = useRef<AudioTrack | null>(null);
  const isMuted = useRef(false);
  
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const refs = audioRefs.current;
    Object.entries(AUDIO_PATHS).forEach(([track, path]) => {
      const audio = new Audio(path);
      audio.loop = track !== 'gameover';
      audio.volume = 0.5;
      audio.preload = 'auto';
      refs[track as AudioTrack] = audio;
    });
    
    return () => {
      Object.values(refs).forEach(audio => {
        if (audio) { audio.pause(); audio.src = ''; }
      });
    };
  }, []);
  
  const play = useCallback((track: AudioTrack) => {
    if (isMuted.current) return;
    if (currentTrack.current && currentTrack.current !== track) {
      const curr = audioRefs.current[currentTrack.current];
      if (curr) { curr.pause(); curr.currentTime = 0; }
    }
    const audio = audioRefs.current[track];
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch((error) => {
        // Browser autoplay policy - user interaction required
        console.warn(`Audio autoplay blocked for ${track}. User interaction required.`, error);
      });
      currentTrack.current = track;
    }
  }, []);
  
  const stop = useCallback(() => {
    Object.values(audioRefs.current).forEach(a => { if (a) { a.pause(); a.currentTime = 0; } });
    currentTrack.current = null;
  }, []);
  
  const toggleMute = useCallback(() => {
    isMuted.current = !isMuted.current;
    Object.values(audioRefs.current).forEach(a => { if (a) a.muted = isMuted.current; });
    return isMuted.current;
  }, []);
  
  return { play, stop, toggleMute };
}
