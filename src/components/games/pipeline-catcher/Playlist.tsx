'use client';

import React, { useState } from 'react';
import Image from 'next/image';

interface Song {
  id: string;
  file: string;
  artist: string;
  title: string;
  image: string;
}

const PLAYLIST: Song[] = [
  {
    id: 'menu-music',
    file: '/games/pipeline-catcher/audio/menu-music.mp3',
    artist: 'Gorillaz',
    title: 'Clint Eastwood',
    image: '/games/pipeline-catcher/images/mascot-dance.gif', // Using mascot gif as placeholder
  },
  {
    id: 'menu-music-2',
    file: '/games/pipeline-catcher/audio/menu-music-2.mp3',
    artist: 'Outkast',
    title: 'Hey Ya',
    image: '/games/pipeline-catcher/images/mascot-dance.gif',
  },
  {
    id: 'menu-music-3',
    file: '/games/pipeline-catcher/audio/menu-music-3.mp3',
    artist: 'The White Stripes',
    title: 'Seven Nation Army',
    image: '/games/pipeline-catcher/images/mascot-dance.gif',
  },
  {
    id: 'menu-music-4',
    file: '/games/pipeline-catcher/audio/menu-music-4.mp3',
    artist: 'Lady Gaga',
    title: 'Bad Romance',
    image: '/games/pipeline-catcher/images/mascot-dance.gif',
  },
  {
    id: 'menu-music-5',
    file: '/games/pipeline-catcher/audio/menu-music-5.mp3',
    artist: 'Shakira',
    title: "Hips Don't Lie",
    image: '/games/pipeline-catcher/images/mascot-dance.gif',
  },
  {
    id: 'menu-music-6',
    file: '/games/pipeline-catcher/audio/menu-music-6.mp3',
    artist: 'Fetty Wap',
    title: 'Trap Queen',
    image: '/games/pipeline-catcher/images/mascot-dance.gif',
  },
];

interface PlaylistProps {
  currentSongId: string | null;
  onSelectSong: (songId: string) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
}

export function Playlist({ currentSongId, onSelectSong, isPlaying, onTogglePlay }: PlaylistProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  // Find the current song, or default to first if not found
  const currentSong = currentSongId 
    ? PLAYLIST.find(song => song.id === currentSongId) || PLAYLIST[0]
    : PLAYLIST[0];

  return (
    <div className="fixed right-4 top-1/2 -translate-y-1/2 z-40 w-80">
      <div className="bg-slate-900/95 rounded-lg border border-slate-700 shadow-xl overflow-hidden transition-all duration-300">
        {/* Collapsed view - current song */}
        <div 
          className="flex items-center gap-3 p-4 cursor-pointer hover:bg-slate-800/50 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="relative w-16 h-16 rounded overflow-hidden flex-shrink-0">
            <Image
              src={currentSong.image}
              alt={currentSong.title}
              width={64}
              height={64}
              unoptimized
              className="object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-semibold text-sm truncate">{currentSong.title}</div>
            <div className="text-slate-400 text-xs truncate">{currentSong.artist}</div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePlay();
            }}
            className="p-2 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white transition-colors flex-shrink-0"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="p-2 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors flex-shrink-0"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            <svg 
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* Expanded view - playlist */}
        {isExpanded && (
          <div className="border-t border-slate-700 max-h-96 overflow-y-auto">
            <div className="p-2">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2 px-2">Playlist</div>
              {PLAYLIST.map((song) => (
                <button
                  key={song.id}
                  onClick={() => {
                    onSelectSong(song.id);
                    setIsExpanded(false);
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left ${
                    currentSongId === song.id
                      ? 'bg-emerald-600/20 border border-emerald-500/50'
                      : 'hover:bg-slate-800/50'
                  }`}
                >
                  <div className="relative w-12 h-12 rounded overflow-hidden flex-shrink-0">
                    <Image
                      src={song.image}
                      alt={song.title}
                      width={48}
                      height={48}
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${
                      currentSongId === song.id ? 'text-emerald-400' : 'text-white'
                    }`}>
                      {song.title}
                    </div>
                    <div className="text-xs text-slate-400 truncate">{song.artist}</div>
                  </div>
                  {currentSongId === song.id && (
                    <div className="flex-shrink-0">
                      <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
