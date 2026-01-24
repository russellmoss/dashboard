'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { LevelSelect } from './LevelSelect';
import { GameCanvas } from './GameCanvas';
import { GameOver } from './GameOver';
import { useGameAudio } from './hooks/useGameAudio';
import { pipelineCatcherApi } from '@/lib/api-client';
import { QuarterLevel, QuarterGameData } from '@/types/game';
import { GAME_CONFIG } from '@/config/game-constants';

type GameScreen = 'levelSelect' | 'playing' | 'gameOver';

interface GameResult {
  score: number;
  advisorsCaught: number;
  joinedCaught: number;
  ghostsHit: number;
  gameDuration: number;
}

export function PipelineCatcher() {
  const [screen, setScreen] = useState<GameScreen>('levelSelect');
  const [levels, setLevels] = useState<QuarterLevel[]>([]);
  const [isLoadingLevels, setIsLoadingLevels] = useState(true);
  const [selectedQuarter, setSelectedQuarter] = useState<string | null>(null);
  const [gameData, setGameData] = useState<QuarterGameData | null>(null);
  const [isLoadingGame, setIsLoadingGame] = useState(false);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [scoreId, setScoreId] = useState<string | null>(null);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [isTopThree, setIsTopThree] = useState(false);
  const [isEoqMode, setIsEoqMode] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  
  const audio = useGameAudio();
  
  // Fetch available levels on mount
  useEffect(() => {
    const fetchLevels = async () => {
      try {
        const response = await pipelineCatcherApi.getLevels();
        setLevels(response.levels || []);
      } catch (error) {
        console.error('Error fetching levels:', error);
        // Set empty array on error so UI can show error state
        setLevels([]);
      } finally {
        setIsLoadingLevels(false);
      }
    };
    
    fetchLevels();
  }, []);
  
  // Play menu music when on level select
  useEffect(() => {
    if (screen === 'levelSelect' && !isMuted) {
      const timer = setTimeout(() => audio.play('menu'), 100);
      return () => {
        clearTimeout(timer);
        audio.stop();
      };
    }
  }, [screen, audio, isMuted]);

  // Play gameplay music when in a level (effect runs after menu cleanup on transition)
  useEffect(() => {
    if (screen === 'playing' && !isMuted) {
      const timer = setTimeout(() => audio.play('gameplay'), 100);
      return () => {
        clearTimeout(timer);
        audio.stop();
      };
    }
  }, [screen, audio, isMuted]);

  // Play game over music
  useEffect(() => {
    if (screen === 'gameOver' && !isMuted) {
      audio.play('gameover');
    }
  }, [screen, audio, isMuted]);
  
  // Handle level selection
  const handleSelectLevel = useCallback(async (quarter: string) => {
    setIsLoadingGame(true);
    setSelectedQuarter(quarter);
    
    try {
      const response = await pipelineCatcherApi.getGameData(quarter);
      setGameData(response.data);
      setScreen('playing');
      setIsEoqMode(false);
    } catch (error) {
      console.error('Error fetching game data:', error);
      alert('Failed to load game data. Please try again.');
    } finally {
      setIsLoadingGame(false);
    }
  }, []);
  
  // Handle game over: submit score once here (no useEffect in GameOver) to avoid duplicates
  const handleGameOver = useCallback(async (result: GameResult) => {
    audio.stop();
    if (!isMuted) {
      audio.play('gameover');
    }
    setGameResult(result);
    setScreen('gameOver');
    try {
      const res = await pipelineCatcherApi.submitScore({
        quarter: selectedQuarter!,
        score: result.score,
        advisorsCaught: result.advisorsCaught,
        joinedCaught: result.joinedCaught,
        ghostsHit: result.ghostsHit,
        gameDuration: result.gameDuration,
      });
      setScoreId(res.entry.id);
      setUserRank(res.rank);
      setIsTopThree(res.isTopThree);
    } catch (e) {
      console.error('Error submitting score:', e);
    }
  }, [audio, isMuted, selectedQuarter]);
  
  // Handle play again (same quarter)
  const handlePlayAgain = useCallback(() => {
    if (selectedQuarter) {
      handleSelectLevel(selectedQuarter);
    }
  }, [selectedQuarter, handleSelectLevel]);
  
  // Handle change level
  const handleChangeLevel = useCallback(() => {
    setScreen('levelSelect');
    setGameResult(null);
    setScoreId(null);
    setUserRank(null);
    setIsTopThree(false);
    setSelectedQuarter(null);
    setGameData(null);
    setIsEoqMode(false);
    audio.stop();
    if (!isMuted) {
      audio.play('menu');
    }
  }, [audio, isMuted]);
  
  // Handle time updates (EOQ mode: last 10 seconds)
  const handleTimeUpdate = useCallback((timeRemaining: number) => {
    if (timeRemaining <= GAME_CONFIG.EOQ_MODE_START && !isEoqMode) {
      setIsEoqMode(true);
    }
  }, [isEoqMode]);
  
  // Toggle mute
  const handleToggleMute = useCallback(() => {
    const nowMuted = audio.toggleMute();
    setIsMuted(nowMuted);
  }, [audio]);
  
  // Loading overlay
  if (isLoadingGame) {
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
          <div className="text-xl">Loading game data...</div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="relative">
      {/* Mute button - always visible */}
      <button
        onClick={handleToggleMute}
        className="fixed top-4 right-4 z-50 bg-slate-800/80 hover:bg-slate-700 p-3 rounded-full text-white"
        title={isMuted ? 'Unmute' : 'Mute'}
      >
        {isMuted ? '🔇' : '🔊'}
      </button>
      
      {/* Exit button */}
      <a
        href="/dashboard"
        className="fixed top-4 left-4 z-50 bg-slate-800/80 hover:bg-slate-700 px-4 py-2 rounded-lg text-white text-sm"
      >
        ← Exit Game
      </a>
      
      {screen === 'levelSelect' && (
        <LevelSelect
          levels={levels}
          onSelectLevel={handleSelectLevel}
          isLoading={isLoadingLevels}
        />
      )}
      
      {screen === 'playing' && selectedQuarter && gameData && (
        <GameCanvas
          quarter={selectedQuarter}
          gameData={gameData}
          onGameOver={handleGameOver}
          onTimeUpdate={handleTimeUpdate}
          isEoqMode={isEoqMode}
          setIsEoqMode={setIsEoqMode}
        />
      )}
      
      {screen === 'gameOver' && selectedQuarter && gameResult && (
        <GameOver
          quarter={selectedQuarter}
          result={gameResult}
          scoreId={scoreId}
          userRank={userRank}
          isTopThree={isTopThree}
          onPlayAgain={handlePlayAgain}
          onChangeLevel={handleChangeLevel}
        />
      )}
    </div>
  );
}
