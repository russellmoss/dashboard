'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { QuarterLevel, LeaderboardEntry } from '@/types/game';
import { formatGameAum, formatQuarterDisplay } from '@/config/game-constants';
import { pipelineCatcherApi } from '@/lib/api-client';
import DancingMascot from './DancingMascot';
import { Playlist } from './Playlist';
import { useAudioContext } from './AudioContext';

interface LevelSelectProps {
  levels: QuarterLevel[];
  onSelectLevel: (quarter: string) => void;
  isLoading: boolean;
}

export function LevelSelect({ levels, onSelectLevel, isLoading }: LevelSelectProps) {
  const [leaderboardQuarter, setLeaderboardQuarter] = useState<string | null>(null);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const audio = useAudioContext();
  const [currentSongId, setCurrentSongId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  
  // Update current song and playing state
  useEffect(() => {
    const updateState = () => {
      const songId = audio.getCurrentMenuSongId();
      const playing = audio.getIsPlaying();
      // Always update to ensure we show the correct song
      setCurrentSongId(songId);
      setIsPlaying(playing);
    };
    
    // Update immediately, then wait a bit for initialization, then periodically
    updateState();
    const initTimeout = setTimeout(updateState, 500);
    const interval = setInterval(updateState, 100);
    
    return () => {
      clearTimeout(initTimeout);
      clearInterval(interval);
    };
  }, [audio]);

  const openLeaderboard = useCallback(async (quarter: string) => {
    setLeaderboardQuarter(quarter);
    setLeaderboardEntries([]);
    setLeaderboardError(null);
    setIsLoadingLeaderboard(true);
    try {
      const res = await pipelineCatcherApi.getLeaderboard(quarter);
      setLeaderboardEntries(res.entries);
    } catch (e) {
      setLeaderboardError(e instanceof Error ? e.message : 'Failed to load leaderboard');
    } finally {
      setIsLoadingLeaderboard(false);
    }
  }, []);

  const closeLeaderboard = useCallback(() => {
    setLeaderboardQuarter(null);
    setLeaderboardEntries([]);
    setLeaderboardError(null);
  }, []);

  if (isLoading) {
    return (
      <div 
        className="flex items-center justify-center min-h-screen"
        style={{ 
          background: `linear-gradient(rgba(15, 23, 42, 0.6), rgba(15, 23, 42, 0.65)), url('/games/pipeline-catcher/images/lobby-bg.png')`,
          backgroundSize: 'cover',
        }}
      >
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-emerald-500 mx-auto mb-4"></div>
          <div className="text-xl">Loading levels...</div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="flex items-center justify-center min-h-screen p-4"
      style={{ 
        background: `linear-gradient(rgba(15, 23, 42, 0.6), rgba(15, 23, 42, 0.65)), url('/games/pipeline-catcher/images/lobby-bg.png')`,
        backgroundSize: 'cover',
      }}
    >
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-4">
            <DancingMascot size={96} flipHorizontal />
            <h1 className="text-5xl font-bold text-white">Pipeline Catcher</h1>
            <DancingMascot size={96} />
          </div>
          <p className="text-slate-300 text-lg">Catch SQOs, avoid ghosts, and climb the leaderboard!</p>
        </div>

        {levels.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-2xl font-bold text-white mb-4">No Levels Available</div>
            <div className="text-slate-400 mb-4">
              <p>Unable to load game levels. This could be due to:</p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>No SQO data available for the selected quarters</li>
                <li>API connection issue</li>
                <li>BigQuery query error</li>
              </ul>
            </div>
            <div className="text-sm text-slate-500 mt-4">
              Check the browser console (F12) for error details.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {levels.map((level) => (
              <div
                key={level.quarter}
                className={`
                  relative p-6 rounded-lg border-2 transition-all
                  ${level.isQTD 
                    ? 'bg-emerald-600/20 border-emerald-500' 
                    : 'bg-slate-800/50 border-slate-600'
                  }
                `}
              >
                {level.isQTD && (
                  <div className="absolute top-2 right-2 bg-emerald-500 text-white text-xs font-bold px-2 py-1 rounded">
                    QTD
                  </div>
                )}
                
                <div className="text-center">
                  <div className={`text-2xl font-bold mb-2 ${level.isQTD ? 'text-emerald-400' : 'text-white'}`}>
                    {level.displayName}
                  </div>
                  
                  <div className="space-y-2 text-sm text-slate-300">
                    <div>
                      <span className="text-slate-400">SQOs: </span>
                      <span className="font-semibold">{level.sqoCount}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Joined: </span>
                      <span className="font-semibold text-yellow-400">{level.joinedCount}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Total AUM: </span>
                      <span className="font-semibold">{formatGameAum(level.totalAum)}</span>
                    </div>
                  </div>

                  {level.highScore && (
                    <div className="mt-4 pt-4 border-t border-slate-600">
                      <div className="text-xs text-slate-400 mb-1">High Score</div>
                      <div className="text-lg font-bold text-yellow-400">
                        {formatGameAum(level.highScore.score)}
                      </div>
                      <div className="text-xs text-slate-400">
                        by {level.highScore.playerName}
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex flex-col gap-2">
                    <button
                      onClick={() => onSelectLevel(level.quarter)}
                      className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors"
                    >
                      Play
                    </button>
                    <button
                      onClick={() => openLeaderboard(level.quarter)}
                      className="w-full py-2 px-4 rounded-lg bg-slate-600 hover:bg-slate-500 text-slate-200 text-sm font-medium transition-colors"
                    >
                      View leaderboard
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {levels.length > 0 && (
          <div className="mt-8 text-center text-slate-400 text-sm">
            <p>Select a quarter to start playing, or view its leaderboard!</p>
          </div>
        )}
      </div>
      
      <Playlist
        currentSongId={currentSongId}
        onSelectSong={(songId) => {
          audio.selectMenuSong(songId);
        }}
        isPlaying={isPlaying}
        onTogglePlay={audio.togglePlayPause}
      />

      {/* Leaderboard modal */}
      {leaderboardQuarter && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={closeLeaderboard}
        >
          <div 
            className="bg-slate-900 rounded-xl border border-slate-700 shadow-xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">
                {formatQuarterDisplay(leaderboardQuarter)} Leaderboard
              </h3>
              <button
                onClick={closeLeaderboard}
                className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {isLoadingLeaderboard ? (
                <div className="text-center text-slate-400 py-8">
                  <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-emerald-500 mx-auto mb-3" />
                  <p>Loading...</p>
                </div>
              ) : leaderboardError ? (
                <div className="text-center text-red-400 py-6">
                  <p>{leaderboardError}</p>
                  <button
                    onClick={closeLeaderboard}
                    className="mt-4 text-sm text-slate-400 hover:text-white"
                  >
                    Close
                  </button>
                </div>
              ) : leaderboardEntries.length === 0 ? (
                <div className="text-center text-slate-400 py-8">No scores yet for this quarter!</div>
              ) : (
                <div className="space-y-2">
                  {leaderboardEntries.map((entry, i) => (
                    <div
                      key={entry.id}
                      className={`p-3 rounded-lg ${
                        entry.isCurrentUser 
                          ? 'bg-emerald-500/20 border border-emerald-500/50' 
                          : i === 0 ? 'bg-yellow-500/20' 
                          : i === 1 ? 'bg-slate-400/20' 
                          : i === 2 ? 'bg-orange-700/20' 
                          : 'bg-slate-700/30'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-lg shrink-0">{i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`}</span>
                          <span className={`font-medium truncate ${entry.isCurrentUser ? 'text-emerald-400' : ''}`}>
                            {entry.playerName} {entry.isCurrentUser && '(You)'}
                          </span>
                        </div>
                        <div className="font-bold text-sm shrink-0">{formatGameAum(entry.score)}</div>
                      </div>
                      {entry.message && (
                        <div className="mt-1.5 text-sm text-slate-400 break-words">&quot;{entry.message}&quot;</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-slate-700">
              <button
                onClick={closeLeaderboard}
                className="w-full py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 text-white font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
