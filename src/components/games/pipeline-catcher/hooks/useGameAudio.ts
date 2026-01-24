'use client';

import { useCallback, useEffect, useRef } from 'react';

export const MENU_MUSIC_MAP: Record<string, string> = {
  'menu-music': '/games/pipeline-catcher/audio/menu-music.mp3',
  'menu-music-2': '/games/pipeline-catcher/audio/menu-music-2.mp3',
  'menu-music-3': '/games/pipeline-catcher/audio/menu-music-3.mp3',
  'menu-music-4': '/games/pipeline-catcher/audio/menu-music-4.mp3',
  'menu-music-5': '/games/pipeline-catcher/audio/menu-music-5.mp3',
  'menu-music-6': '/games/pipeline-catcher/audio/menu-music-6.mp3',
};

export type AudioTrack = 'menu' | 'gameplay' | 'gameover';

export interface AudioHookReturn {
  play: (track: AudioTrack) => void;
  stop: () => void;
  toggleMute: () => boolean;
  selectMenuSong: (songId: string) => void;
  togglePlayPause: () => void;
  getCurrentMenuSongId: () => string | null;
  getIsPlaying: () => boolean;
  getIsMuted: () => boolean;
  playNextSong: () => void;
  playPreviousSong: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (time: number) => void;
}

export function useGameAudio(): AudioHookReturn {
  // Single menu audio element - THE KEY FIX
  const menuAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // Other audio tracks (gameplay, gameover)
  const audioRefs = useRef<Record<Exclude<AudioTrack, 'menu'>, HTMLAudioElement | null>>({
    gameplay: null,
    gameover: null,
  });

  // State tracking
  const currentMenuSongId = useRef<string | null>(null);
  const currentTrack = useRef<AudioTrack | null>(null);
  const isPlayingRef = useRef(false);
  const isMuted = useRef(false);
  
  // Mutex to prevent race conditions
  const audioLockRef = useRef(false);
  
  // Track initialization
  const isInitialized = useRef(false);
  
  // Time tracking for progress bar
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const isSeekingRef = useRef(false);

  // Initialize audio elements
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isInitialized.current) return; // Prevent double initialization (React StrictMode)
    
    isInitialized.current = true;
    console.log('[Audio] Initializing single menu audio element');

    // Create SINGLE menu audio element
    const menuAudio = new Audio();
    menuAudio.loop = true;
    menuAudio.volume = 0.5;
    menuAudio.preload = 'auto';
    
    menuAudio.addEventListener('play', () => {
      console.log(`[Audio] Play event fired for: ${currentMenuSongId.current}`);
      isPlayingRef.current = true;
      currentTrack.current = 'menu';
    });
    
    menuAudio.addEventListener('pause', () => {
      console.log(`[Audio] Pause event fired for: ${currentMenuSongId.current}`);
      isPlayingRef.current = false;
    });
    
    menuAudio.addEventListener('timeupdate', () => {
      if (menuAudioRef.current && !isSeekingRef.current) {
        currentTimeRef.current = menuAudioRef.current.currentTime;
      }
    });
    
    menuAudio.addEventListener('loadedmetadata', () => {
      if (menuAudioRef.current) {
        durationRef.current = menuAudioRef.current.duration || 0;
      }
    });
    
    menuAudio.addEventListener('durationchange', () => {
      if (menuAudioRef.current) {
        durationRef.current = menuAudioRef.current.duration || 0;
      }
    });
    
    menuAudio.addEventListener('error', (e) => {
      console.error('[Audio] Error loading audio:', e);
      audioLockRef.current = false;
    });

    menuAudioRef.current = menuAudio;

    // Select random song for initial session
    const songIds = Object.keys(MENU_MUSIC_MAP);
    if (songIds.length > 0) {
      const randomIndex = Math.floor(Math.random() * songIds.length);
      const randomSongId = songIds[randomIndex];
      currentMenuSongId.current = randomSongId;
      menuAudio.src = MENU_MUSIC_MAP[randomSongId];
      menuAudio.load();
      console.log(`[Audio] Selected menu music: ${randomSongId}`);
    }

    // Create other audio elements (gameplay, gameover)
    const AUDIO_PATHS: Record<Exclude<AudioTrack, 'menu'>, string> = {
      gameplay: '/games/pipeline-catcher/audio/gameplay-music.mp3',
      gameover: '/games/pipeline-catcher/audio/gameover-music.mp3',
    };
    
    Object.entries(AUDIO_PATHS).forEach(([track, path]) => {
      const audio = new Audio(path);
      audio.loop = track !== 'gameover';
      audio.volume = 0.5;
      audio.preload = 'auto';
      audio.load();
      audioRefs.current[track as Exclude<AudioTrack, 'menu'>] = audio;
    });

    // Cleanup on unmount
    return () => {
      console.log('[Audio] Cleaning up audio elements');
      if (menuAudioRef.current) {
        menuAudioRef.current.pause();
        menuAudioRef.current.src = '';
        menuAudioRef.current = null;
      }
      Object.values(audioRefs.current).forEach(audio => {
        if (audio) {
          audio.pause();
          audio.src = '';
        }
      });
      isInitialized.current = false;
    };
  }, []);

  // Helper: Stop menu audio and wait for it to actually pause
  const stopMenuAudio = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const audio = menuAudioRef.current;
      
      if (!audio || audio.paused) {
        resolve();
        return;
      }

      const onPause = () => {
        audio.removeEventListener('pause', onPause);
        resolve();
      };

      audio.addEventListener('pause', onPause, { once: true });
      audio.pause();
      audio.currentTime = 0;

      // Fallback timeout in case pause event doesn't fire
      setTimeout(() => {
        audio.removeEventListener('pause', onPause);
        resolve();
      }, 100);
    });
  }, []);

  // Play a track
  const play = useCallback((track: AudioTrack) => {
    if (isMuted.current) {
      console.log('[Audio] Play blocked: muted');
      return;
    }

    if (audioLockRef.current) {
      console.log('[Audio] Play blocked: operation in progress');
      return;
    }

    console.log(`[Audio] Attempting to play: ${track}`);

    if (track === 'menu') {
      const audio = menuAudioRef.current;
      if (!audio) {
        console.warn('[Audio] Menu audio not initialized');
        return;
      }

      // If already playing this track, don't restart
      if (isPlayingRef.current && currentTrack.current === 'menu') {
        console.log('[Audio] Menu already playing, skipping');
        return;
      }

      audioLockRef.current = true;

      // Stop any other tracks first
      Object.values(audioRefs.current).forEach(a => {
        if (a && !a.paused) {
          a.pause();
          a.currentTime = 0;
        }
      });

      audio.currentTime = 0;
      audio.play()
        .then(() => {
          console.log(`[Audio] Menu music playing: ${currentMenuSongId.current}`);
          audioLockRef.current = false;
        })
        .catch((error) => {
          console.warn('[Audio] Autoplay failed (user interaction required):', error.message);
          isPlayingRef.current = false;
          audioLockRef.current = false;
        });

    } else {
      // Handle other tracks (gameplay, gameover)
      const audio = audioRefs.current[track];
      if (!audio) return;

      // Stop menu music if playing
      if (menuAudioRef.current && !menuAudioRef.current.paused) {
        menuAudioRef.current.pause();
        menuAudioRef.current.currentTime = 0;
      }

      // Stop other non-menu tracks
      Object.entries(audioRefs.current).forEach(([key, a]) => {
        if (key !== track && a && !a.paused) {
          a.pause();
          a.currentTime = 0;
        }
      });

      currentTrack.current = track;
      audio.currentTime = 0;
      audio.play().catch(console.warn);
    }
  }, []);

  // Stop all audio
  const stop = useCallback(() => {
    console.log('[Audio] Stopping all audio');
    
    // Stop menu audio
    if (menuAudioRef.current && !menuAudioRef.current.paused) {
      menuAudioRef.current.pause();
      menuAudioRef.current.currentTime = 0;
    }
    
    // Stop all other tracks
    Object.values(audioRefs.current).forEach(audio => {
      if (audio && !audio.paused) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
    
    isPlayingRef.current = false;
    currentTrack.current = null;
  }, []);

  // Select a different menu song
  const selectMenuSong = useCallback((songId: string) => {
    console.log(`[Audio] selectMenuSong called: ${songId}`);
    
    // Validate song ID
    if (!MENU_MUSIC_MAP[songId]) {
      console.error(`[Audio] Invalid song ID: ${songId}`);
      return;
    }

    // Don't switch if already playing this song
    if (currentMenuSongId.current === songId && isPlayingRef.current) {
      console.log('[Audio] Already playing this song, skipping');
      return;
    }

    // Check mutex
    if (audioLockRef.current) {
      console.log('[Audio] Operation in progress, ignoring selectMenuSong');
      return;
    }

    const audio = menuAudioRef.current;
    if (!audio) {
      console.warn('[Audio] Menu audio not initialized');
      return;
    }

    const wasPlaying = isPlayingRef.current;
    audioLockRef.current = true;

    // Stop current audio first, then switch
    stopMenuAudio().then(() => {
      console.log(`[Audio] Switching to song: ${songId}`);
      
      // Update state
      currentMenuSongId.current = songId;
      currentTrack.current = 'menu';
      
      // Change source
      audio.src = MENU_MUSIC_MAP[songId];
      audio.load();

      // If was playing, start the new song
      if (wasPlaying && !isMuted.current) {
        audio.currentTime = 0;
        audio.play()
          .then(() => {
            console.log(`[Audio] Now playing: ${songId}`);
            audioLockRef.current = false;
          })
          .catch((error) => {
            console.warn('[Audio] Play failed:', error.message);
            isPlayingRef.current = false;
            audioLockRef.current = false;
          });
      } else {
        console.log(`[Audio] Song loaded but not playing (wasPlaying: ${wasPlaying}, muted: ${isMuted.current})`);
        audioLockRef.current = false;
      }
    });
  }, [stopMenuAudio]);

  // Toggle play/pause
  const togglePlayPause = useCallback(() => {
    const audio = menuAudioRef.current;
    if (!audio) return;

    if (audioLockRef.current) {
      console.log('[Audio] Operation in progress, ignoring togglePlayPause');
      return;
    }

    if (audio.paused) {
      if (!isMuted.current) {
        audioLockRef.current = true;
        audio.play()
          .then(() => {
            console.log('[Audio] Resumed playback');
            audioLockRef.current = false;
          })
          .catch((error) => {
            console.warn('[Audio] Resume failed:', error.message);
            audioLockRef.current = false;
          });
      }
    } else {
      audio.pause();
      console.log('[Audio] Paused playback');
    }
  }, []);

  // Toggle mute
  const toggleMute = useCallback((): boolean => {
    isMuted.current = !isMuted.current;
    console.log(`[Audio] Mute toggled: ${isMuted.current}`);
    
    // Set muted property on all audio elements
    if (menuAudioRef.current) {
      menuAudioRef.current.muted = isMuted.current;
    }
    Object.values(audioRefs.current).forEach(audio => {
      if (audio) {
        audio.muted = isMuted.current;
      }
    });
    
    // If muting, stop playback
    if (isMuted.current) {
      if (menuAudioRef.current && !menuAudioRef.current.paused) {
        menuAudioRef.current.pause();
        menuAudioRef.current.currentTime = 0;
      }
      Object.values(audioRefs.current).forEach(audio => {
        if (audio && !audio.paused) {
          audio.pause();
          audio.currentTime = 0;
        }
      });
      isPlayingRef.current = false;
    }
    
    return isMuted.current;
  }, []);

  // Play next song in playlist
  const playNextSong = useCallback(() => {
    const songIds = Object.keys(MENU_MUSIC_MAP);
    if (songIds.length === 0) return;
    
    const currentIndex = currentMenuSongId.current 
      ? songIds.indexOf(currentMenuSongId.current)
      : -1;
    
    // If current song not found or is last, wrap to first
    const nextIndex = currentIndex >= 0 && currentIndex < songIds.length - 1
      ? currentIndex + 1
      : 0;
    
    const nextSongId = songIds[nextIndex];
    selectMenuSong(nextSongId);
  }, [selectMenuSong]);

  // Play previous song in playlist
  const playPreviousSong = useCallback(() => {
    const songIds = Object.keys(MENU_MUSIC_MAP);
    if (songIds.length === 0) return;
    
    const currentIndex = currentMenuSongId.current 
      ? songIds.indexOf(currentMenuSongId.current)
      : -1;
    
    // If current song not found or is first, wrap to last
    const prevIndex = currentIndex > 0
      ? currentIndex - 1
      : songIds.length - 1;
    
    const prevSongId = songIds[prevIndex];
    selectMenuSong(prevSongId);
  }, [selectMenuSong]);

  // Seek to specific time in current track
  const seekTo = useCallback((time: number) => {
    const audio = menuAudioRef.current;
    if (audio && !isNaN(time) && isFinite(time)) {
      isSeekingRef.current = true;
      const clampedTime = Math.max(0, Math.min(time, durationRef.current || 0));
      audio.currentTime = clampedTime;
      currentTimeRef.current = clampedTime;
      // Allow timeupdate to resume after a brief moment
      setTimeout(() => {
        isSeekingRef.current = false;
      }, 100);
    }
  }, []);

  // Getters for external state access
  const getCurrentMenuSongId = useCallback(() => currentMenuSongId.current, []);
  const getIsPlaying = useCallback(() => isPlayingRef.current, []);
  const getIsMuted = useCallback(() => isMuted.current, []);
  const getCurrentTime = useCallback(() => currentTimeRef.current, []);
  const getDuration = useCallback(() => durationRef.current, []);

  return {
    play,
    stop,
    toggleMute,
    selectMenuSong,
    togglePlayPause,
    getCurrentMenuSongId,
    getIsPlaying,
    getIsMuted,
    playNextSong,
    playPreviousSong,
    getCurrentTime,
    getDuration,
    seekTo,
  };
}
