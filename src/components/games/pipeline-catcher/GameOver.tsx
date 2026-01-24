'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { pipelineCatcherApi } from '@/lib/api-client';
import { LeaderboardEntry } from '@/types/game';
import { formatGameAum, formatQuarterDisplay } from '@/config/game-constants';

interface GameOverProps {
  quarter: string;
  result: {
    score: number;
    advisorsCaught: number;
    joinedCaught: number;
    ghostsHit: number;
    gameDuration: number;
  };
  scoreId: string | null;
  userRank: number | null;
  isTopThree: boolean;
  onPlayAgain: () => void;
  onChangeLevel: () => void;
}

export function GameOver({ quarter, result, scoreId, userRank, isTopThree, onPlayAgain, onChangeLevel }: GameOverProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await pipelineCatcherApi.getLeaderboard(quarter);
        if (!cancelled) {
          setLeaderboard(res.entries);
        }
      } catch (e) {
        if (!cancelled) console.error('Error fetching leaderboard:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [quarter]);
  
  const handleSubmitMessage = async () => {
    if (!message.trim() || isSubmitting || !scoreId) return;
    setIsSubmitting(true);
    try {
      await pipelineCatcherApi.updateScoreMessage(scoreId, message.trim());
      setIsSubmitted(true);
      const res = await pipelineCatcherApi.getLeaderboard(quarter);
      setLeaderboard(res.entries);
    } catch (e) {
      console.error('Error updating message:', e);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <div 
      className="flex items-center justify-center min-h-screen p-4"
      style={{ 
        background: `linear-gradient(rgba(15, 23, 42, 0.65), rgba(15, 23, 42, 0.68)), url('/games/pipeline-catcher/images/lobby-bg.png')`,
        backgroundSize: 'cover',
      }}
    >
      <div className="bg-slate-900/90 rounded-lg p-8 max-w-2xl w-full border border-slate-700">
        <div className="flex items-center justify-center gap-4 mb-6">
          <Image 
            src="/games/pipeline-catcher/images/david-dance.gif"
            alt="Dancing David"
            width={96}
            height={96}
            unoptimized
            style={{ 
              imageRendering: 'pixelated',
              transform: 'scaleX(-1)' 
            }}
          />
          <h2 className="text-3xl font-bold text-white">Game Over!</h2>
          <Image 
            src="/games/pipeline-catcher/images/david-dance.gif"
            alt="Dancing David"
            width={96}
            height={96}
            unoptimized
            style={{ 
              imageRendering: 'pixelated'
            }}
          />
        </div>
        
        {/* Final Score */}
        <div className="text-center mb-6">
          <div className="text-5xl font-bold text-emerald-400 mb-2">
            {formatGameAum(result.score)}
          </div>
          <div className="text-slate-400">Total AUM Caught</div>
        </div>
        
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="text-center p-3 bg-slate-800 rounded-lg">
            <div className="text-2xl font-bold text-emerald-400">{result.advisorsCaught}</div>
            <div className="text-xs text-slate-400">ADVISORS CAUGHT</div>
          </div>
          <div className="text-center p-3 bg-slate-800 rounded-lg">
            <div className="text-2xl font-bold text-yellow-400">{result.joinedCaught}</div>
            <div className="text-xs text-slate-400">JOINED CAUGHT</div>
          </div>
          <div className="text-center p-3 bg-slate-800 rounded-lg">
            <div className="text-2xl font-bold text-red-400">{result.ghostsHit}</div>
            <div className="text-xs text-slate-400">GHOSTS HIT</div>
          </div>
        </div>
        
        {/* Rank */}
        {userRank && (
          <div className="text-center mb-4">
            <span className="text-lg">Your Rank: </span>
            <span className={`text-2xl font-bold ${userRank <= 3 ? 'text-yellow-400' : 'text-slate-300'}`}>
              #{userRank}
            </span>
          </div>
        )}
        
        {/* Top 3 Message Input */}
        {isTopThree && !isSubmitted && (
          <div className="mb-6 p-4 bg-yellow-500/20 rounded-lg border border-yellow-500/50">
            <div className="text-center text-yellow-400 font-bold mb-2">
              🏆 Top 3 for {formatQuarterDisplay(quarter)}!
            </div>
            <input
              type="text"
              maxLength={100}
              placeholder="Leave a message for coworkers..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm"
            />
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-slate-500">{message.length}/100</span>
              <button
                onClick={handleSubmitMessage}
                disabled={isSubmitting || !message.trim() || !scoreId}
                className="bg-yellow-500 hover:bg-yellow-400 disabled:bg-slate-600 text-slate-900 font-bold px-4 py-1 rounded-lg text-sm transition-colors"
              >
                {isSubmitting ? '...' : 'Save Message'}
              </button>
            </div>
          </div>
        )}
        
        {isSubmitted && (
          <div className="mb-6 p-3 bg-emerald-500/20 rounded-lg border border-emerald-500/50 text-center">
            <div className="text-emerald-400 font-bold">✓ Message Saved!</div>
          </div>
        )}
        
        {/* Leaderboard */}
        <div className="mb-6">
          <h3 className="text-lg font-bold mb-3 text-center">
            {formatQuarterDisplay(quarter)} Leaderboard
          </h3>
          {isLoading ? (
            <div className="text-center text-slate-400 py-4">Loading...</div>
          ) : leaderboard.length > 0 ? (
            <div className="space-y-2">
              {leaderboard.slice(0, 5).map((entry, i) => (
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
          ) : (
            <div className="text-center text-slate-400 py-4">No scores yet!</div>
          )}
        </div>
        
        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onPlayAgain}
            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg transition-colors"
          >
            Play Again
          </button>
          <button
            onClick={onChangeLevel}
            className="flex-1 bg-slate-600 hover:bg-slate-500 text-white font-bold py-3 rounded-lg transition-colors"
          >
            Change Quarter
          </button>
        </div>
      </div>
    </div>
  );
}
