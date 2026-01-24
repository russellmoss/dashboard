'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { useGameAudio } from './hooks/useGameAudio';
import type { AudioHookReturn } from './hooks/useGameAudio';

const AudioContext = createContext<AudioHookReturn | null>(null);

export function AudioProvider({ children }: { children: ReactNode }) {
  const audio = useGameAudio();
  
  return (
    <AudioContext.Provider value={audio}>
      {children}
    </AudioContext.Provider>
  );
}

export function useAudioContext(): AudioHookReturn {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error('useAudioContext must be used within AudioProvider');
  }
  return context;
}
