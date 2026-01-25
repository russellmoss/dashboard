'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { QuarterGameData, GameObject, ActivePowerUp } from '@/types/game';
import { GAME_CONFIG, STAGE_SPEED_MODIFIERS, formatGameAum } from '@/config/game-constants';
import CatchPopup from './CatchPopup';
import JedPopup from './JedPopup';

const OBJECT_SIZES = {
  sqo: { width: 85, height: 90, emojiSize: 48 },
  joined: { width: 95, height: 100, emojiSize: 56 },
  ghost: { width: 80, height: 85, emojiSize: 52 },
  stopSign: { width: 80, height: 85, emojiSize: 52 },
  powerup: { width: 55, height: 55, emojiSize: 40 },
  jed: { width: 85, height: 90, emojiSize: 48 },
} as const;

const COLORS = {
  sqo: { primary: '#22c55e', secondary: '#14b8a6', glow: '#22c55e', text: '#ffffff' },
  joined: { primary: '#fbbf24', secondary: '#f59e0b', glow: '#fbbf24', text: '#92400e' },
  ghost: { primary: '#ef4444', secondary: '#dc2626', glow: '#ef4444', text: '#fecaca', opacity: 0.7 },
  stopSign: { primary: '#dc2626', secondary: '#b91c1c', glow: '#dc2626', text: '#ffffff', border: '#ffffff' },
  powerup: {
    doubleAum: { glow: '#a855f7', bg: '#7c3aed' },
    slowMo: { glow: '#06b6d4', bg: '#0891b2' },
    shield: { glow: '#3b82f6', bg: '#2563eb' },
  },
} as const;

interface FloatingText {
  id: string;
  text: string;
  x: number;
  y: number;
  startTime: number;
  color: string;
}

function truncate(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function drawGameObject(
  ctx: CanvasRenderingContext2D,
  obj: GameObject,
  animationTime: number
) {
  const t = animationTime;
  const pulseIntensity = 15 + Math.sin(t * 3) * 5;
  const wobbleX = Math.sin(t * 4 + (obj.id.charCodeAt(0) ?? 0)) * 3;
  const shakeX = Math.sin(t * 10 + (obj.id.length * 7)) * 4;
  const rotation = Math.sin(t * 2) * 0.1;

  const w = obj.width;
  const h = obj.height;
  const baseX = obj.x;
  const baseY = obj.y;
  let cx = baseX + w / 2;
  let drawX = baseX;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  if (obj.type === 'sqo') {
    drawX = baseX + wobbleX * 0;
    cx = drawX + w / 2;
    const glow = COLORS.sqo.glow;
    ctx.shadowColor = glow;
    ctx.shadowBlur = pulseIntensity;
    ctx.shadowOffsetY = 2;
    const g = ctx.createLinearGradient(drawX, baseY, drawX + w, baseY + h);
    g.addColorStop(0, COLORS.sqo.primary);
    g.addColorStop(1, COLORS.sqo.secondary);
    ctx.beginPath();
    ctx.roundRect(drawX + 2, baseY + 2, w - 4, h - 4, 12);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.font = `bold ${OBJECT_SIZES.sqo.emojiSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.fillStyle = COLORS.sqo.text;
    ctx.fillText('💼', cx, baseY + 28);
    const nameY = baseY + OBJECT_SIZES.sqo.emojiSize + 14;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 2;
    ctx.font = '12px Arial';
    ctx.fillStyle = COLORS.sqo.text;
    ctx.fillText(truncate(obj.name || '—', 12), cx, nameY);
    ctx.font = 'bold 11px Arial';
    ctx.fillText(formatGameAum(obj.aum), cx, nameY + 14);
    ctx.restore();
  } else if (obj.type === 'joined') {
    drawX = baseX;
    cx = drawX + w / 2;
    const cy = baseY + h / 2 - 8;
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    ctx.translate(-cx, -cy);
    ctx.shadowColor = COLORS.joined.glow;
    ctx.shadowBlur = 25;
    ctx.shadowOffsetY = 2;
    const g = ctx.createLinearGradient(drawX, baseY, drawX + w, baseY + h);
    g.addColorStop(0, COLORS.joined.primary);
    g.addColorStop(1, COLORS.joined.secondary);
    ctx.beginPath();
    ctx.roundRect(drawX + 2, baseY + 2, w - 4, h - 4, 14);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + t * 2;
      const rad = 38 + Math.sin(t * 3 + i) * 4;
      const sx = cx + Math.cos(a) * rad;
      const sy = cy + Math.sin(a) * rad * 0.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fill();
    }
    ctx.font = `bold ${OBJECT_SIZES.joined.emojiSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.fillStyle = COLORS.joined.text;
    ctx.fillText('⭐', cx, baseY + 34);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    cx = baseX + w / 2;
    const nameY = baseY + OBJECT_SIZES.joined.emojiSize + 16;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 2;
    ctx.font = '12px Arial';
    ctx.fillStyle = COLORS.joined.text;
    ctx.fillText(truncate(obj.name || '—', 12), cx, nameY);
    ctx.font = 'bold 11px Arial';
    ctx.fillStyle = COLORS.joined.primary;
    ctx.fillText('JOINED!', cx, nameY + 14);
    ctx.restore();
  } else if (obj.type === 'ghost') {
    drawX = baseX + wobbleX;
    cx = drawX + w / 2;
    ctx.globalAlpha = COLORS.ghost.opacity;
    ctx.shadowColor = COLORS.ghost.glow;
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 2;
    const g = ctx.createLinearGradient(drawX, baseY, drawX + w, baseY + h);
    g.addColorStop(0, COLORS.ghost.primary);
    g.addColorStop(1, COLORS.ghost.secondary);
    ctx.beginPath();
    ctx.roundRect(drawX + 2, baseY + 2, w - 4, h - 4, 12);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = `bold ${OBJECT_SIZES.ghost.emojiSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.fillStyle = COLORS.ghost.text;
    ctx.fillText('👻', cx, baseY + 30);
    const nameY = baseY + OBJECT_SIZES.ghost.emojiSize + 12;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 2;
    ctx.font = '12px Arial';
    ctx.fillStyle = COLORS.ghost.text;
    ctx.fillText(truncate(obj.name || '—', 12), cx, nameY);
    ctx.font = 'bold 10px Arial';
    ctx.fillText('NO RESPONSE', cx, nameY + 14);
    ctx.restore();
  } else if (obj.type === 'stopSign') {
    drawX = baseX + shakeX;
    cx = drawX + w / 2;
    const cy = baseY + h / 2 - 10;
    const borderPulse = 2 + Math.sin(t * 4) * 0.5;
    ctx.shadowColor = COLORS.stopSign.glow;
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * 45 - 90) * (Math.PI / 180);
      const px = cx + (Math.min(w, h) / 2 - 6) * Math.cos(a);
      const py = cy + (Math.min(w, h) / 2 - 6) * Math.sin(a);
      ctx[i ? 'lineTo' : 'moveTo'](px, py);
    }
    ctx.closePath();
    ctx.fillStyle = COLORS.stopSign.primary;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = COLORS.stopSign.border;
    ctx.lineWidth = borderPulse;
    ctx.stroke();
    ctx.font = `bold ${OBJECT_SIZES.stopSign.emojiSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.fillStyle = COLORS.stopSign.text;
    ctx.fillText('✋', cx, baseY + 30);
    const nameY = baseY + OBJECT_SIZES.stopSign.emojiSize + 12;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 2;
    ctx.font = '12px Arial';
    ctx.fillStyle = COLORS.stopSign.text;
    ctx.fillText(truncate(obj.name || '—', 12), cx, nameY);
    ctx.font = 'bold 10px Arial';
    ctx.fillText('DO NOT CALL', cx, nameY + 14);
    ctx.restore();
  } else if (obj.type === 'powerup' && obj.powerUpType) {
    const pu = COLORS.powerup[obj.powerUpType];
    const spin = t * 3;
    ctx.translate(cx, baseY + h / 2 - 4);
    ctx.rotate(spin);
    ctx.translate(-(baseX + w / 2), -(baseY + h / 2 - 4));
    ctx.shadowColor = pu.glow;
    ctx.shadowBlur = 15 + Math.sin(t * 3) * 5;
    ctx.beginPath();
    ctx.roundRect(baseX + 2, baseY + 2, w - 4, h - 4, 10);
    ctx.fillStyle = pu.bg;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    const emoji = obj.powerUpType === 'doubleAum' ? '💎' : obj.powerUpType === 'slowMo' ? '⏱️' : '🛡️';
    ctx.font = `bold ${OBJECT_SIZES.powerup.emojiSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(emoji, baseX + w / 2, baseY + 32);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else if (obj.type === 'jed') {
    // Jed is drawn via DOM <img> overlay (jed-walk.gif) so the 4-frame GIF animates
    // as it falls; skip canvas draw here.
  }

  ctx.restore();
}

interface GameCanvasProps {
  quarter: string;
  gameData: QuarterGameData;
  onGameOver: (result: {
    score: number;
    advisorsCaught: number;
    joinedCaught: number;
    ghostsHit: number;
    gameDuration: number;
  }) => void;
  onTimeUpdate: (timeRemaining: number) => void;
  isEoqMode: boolean;
  setIsEoqMode: (value: boolean) => void;
  isMuted: boolean;
}

export function GameCanvas({
  quarter,
  gameData,
  onGameOver,
  onTimeUpdate,
  isEoqMode,
  setIsEoqMode,
  isMuted,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastSpawnTimeRef = useRef<number>(0);
  const gameStartTimeRef = useRef<number>(0);
  const scoreRef = useRef(0);
  const livesRef = useRef(GAME_CONFIG.STARTING_LIVES);
  const advisorsCaughtRef = useRef(0);
  const joinedCaughtRef = useRef(0);
  const ghostsHitRef = useRef(0);
  const isEoqModeRef = useRef(false);
  const floatingTextsRef = useRef<FloatingText[]>([]);
  
  const catchSoundRef = useRef<HTMLAudioElement | null>(null);
  const joinedSoundRef = useRef<HTMLAudioElement | null>(null);
  const ghostSoundRef = useRef<HTMLAudioElement | null>(null);
  const doNotCallSoundRef = useRef<HTMLAudioElement | null>(null);
  
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(GAME_CONFIG.STARTING_LIVES);
  const [timeRemaining, setTimeRemaining] = useState(GAME_CONFIG.GAME_DURATION);
  const [advisorsCaught, setAdvisorsCaught] = useState(0);
  const [joinedCaught, setJoinedCaught] = useState(0);
  const [ghostsHit, setGhostsHit] = useState(0);
  const [lastCaught, setLastCaught] = useState<{ name: string; aum: number; type: 'sqo' | 'joined' | 'jed' } | null>(null);
  const [catchPopup, setCatchPopup] = useState<'sqo' | 'joined' | 'jed' | null>(null);
  
  const jedImgRef = useRef<HTMLImageElement | null>(null);
  const jedSpawnTimeRef = useRef<number>(0);
  const jedSpawnedRef = useRef(false);
  
  const playerXRef = useRef<number>(GAME_CONFIG.CANVAS_WIDTH / 2 - GAME_CONFIG.PLAYER_WIDTH / 2);
  const objectsRef = useRef<GameObject[]>([]);
  const activePowerUpsRef = useRef<ActivePowerUp[]>([]);
  const keysRef = useRef<Set<string>>(new Set());
  const sqoPoolRef = useRef<typeof gameData.sqos>([]);
  const ghostPoolRef = useRef<typeof gameData.ghosts>([]);
  const stopSignPoolRef = useRef<typeof gameData.stopSigns>([]);
  const joinedPoolRef = useRef<typeof gameData.joined>([]);
  
  // Initialize pools and game clock (only when starting a new game)
  useEffect(() => {
    sqoPoolRef.current = [...gameData.sqos];
    ghostPoolRef.current = [...gameData.ghosts];
    stopSignPoolRef.current = [...gameData.stopSigns];
    joinedPoolRef.current = [...gameData.joined];
    gameStartTimeRef.current = 0;
    lastSpawnTimeRef.current = 0;
    scoreRef.current = 0;
    livesRef.current = GAME_CONFIG.STARTING_LIVES;
    advisorsCaughtRef.current = 0;
    joinedCaughtRef.current = 0;
    ghostsHitRef.current = 0;
    floatingTextsRef.current = [];
    isEoqModeRef.current = false;
    jedSpawnedRef.current = false;
    jedSpawnTimeRef.current = 15 + Math.random() * 60; // 15–75 seconds
  }, [gameData]);

  // Initialize audio
  useEffect(() => {
    catchSoundRef.current = new Audio('/games/pipeline-catcher/audio/catch.mp3');
    joinedSoundRef.current = new Audio('/games/pipeline-catcher/audio/catch-joined.mp3');
    ghostSoundRef.current = new Audio('/games/pipeline-catcher/audio/ghost.mp3');
    doNotCallSoundRef.current = new Audio('/games/pipeline-catcher/audio/do-not-call.mp3');
    catchSoundRef.current.volume = 1.0;
    joinedSoundRef.current.volume = 0.75;
    ghostSoundRef.current.volume = 0.5;
    doNotCallSoundRef.current.volume = 1.0;
  }, []);

  // Keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keysRef.current.add('left');
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keysRef.current.add('right');
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keysRef.current.delete('left');
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keysRef.current.delete('right');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  
  const maxObjW = 95;
  const spawnObject = useCallback((type: GameObject['type'], now: number) => {
    const x = Math.random() * (GAME_CONFIG.CANVAS_WIDTH - maxObjW - 20) + 10;
    
    // Progressive speed stages based on elapsed time
    const elapsed = Math.max(0, (now - gameStartTimeRef.current) / 1000);
    let speedMultiplier = 1.0;
    
    if (isEoqModeRef.current) {
      // Last 10 seconds (80-90): 2.5X speed
      speedMultiplier = GAME_CONFIG.EOQ_FALL_SPEED_MULTIPLIER;
    } else if (elapsed >= GAME_CONFIG.SPEED_STAGE_3_TIME) {
      // 79-80 seconds: 2X speed
      speedMultiplier = GAME_CONFIG.SPEED_STAGE_3_MULTIPLIER;
    } else if (elapsed >= GAME_CONFIG.SPEED_STAGE_2_TIME) {
      // 60-79 seconds: 1.5X speed
      speedMultiplier = GAME_CONFIG.SPEED_STAGE_2_MULTIPLIER;
    } else if (elapsed >= GAME_CONFIG.SPEED_STAGE_1_TIME) {
      // 30-60 seconds: 1.25X speed
      speedMultiplier = GAME_CONFIG.SPEED_STAGE_1_MULTIPLIER;
    }
    // 0-30 seconds: 1X speed (base)
    
    let speed = GAME_CONFIG.BASE_FALL_SPEED * speedMultiplier;
    
    let object: GameObject;
    const sizes = OBJECT_SIZES;
    
    switch (type) {
      case 'sqo': {
        if (sqoPoolRef.current.length === 0) return;
        const sqo = sqoPoolRef.current.shift()!;
        const stageModifier = STAGE_SPEED_MODIFIERS[sqo.stage] || 1.0;
        object = {
          id: `sqo-${now}-${Math.random()}`,
          type: 'sqo',
          name: sqo.name,
          aum: sqo.aum,
          x,
          y: -sizes.sqo.height,
          width: sizes.sqo.width,
          height: sizes.sqo.height,
          speed: speed * stageModifier,
          stage: sqo.stage as any,
        };
        break;
      }
      case 'joined': {
        if (joinedPoolRef.current.length === 0) return;
        const joined = joinedPoolRef.current.shift()!;
        object = {
          id: `joined-${now}-${Math.random()}`,
          type: 'joined',
          name: joined.name,
          aum: joined.aum,
          x,
          y: -sizes.joined.height,
          width: sizes.joined.width,
          height: sizes.joined.height,
          speed: speed * GAME_CONFIG.JOINED_SPEED_MULTIPLIER,
        };
        break;
      }
      case 'ghost': {
        if (ghostPoolRef.current.length === 0) return;
        const ghost = ghostPoolRef.current.shift()!;
        object = {
          id: `ghost-${now}-${Math.random()}`,
          type: 'ghost',
          name: ghost.name,
          aum: 0,
          x,
          y: -sizes.ghost.height,
          width: sizes.ghost.width,
          height: sizes.ghost.height,
          speed,
        };
        break;
      }
      case 'stopSign': {
        if (stopSignPoolRef.current.length === 0) return;
        const stopSign = stopSignPoolRef.current.shift()!;
        object = {
          id: `stop-${now}-${Math.random()}`,
          type: 'stopSign',
          name: stopSign.name,
          aum: 0,
          x,
          y: -sizes.stopSign.height,
          width: sizes.stopSign.width,
          height: sizes.stopSign.height,
          speed,
        };
        break;
      }
      case 'jed': {
        object = {
          id: `jed-${now}`,
          type: 'jed',
          name: 'Jed',
          aum: 1_000_000_000,
          x,
          y: -sizes.jed.height,
          width: sizes.jed.width,
          height: sizes.jed.height,
          speed,
        };
        break;
      }
      default:
        return;
    }
    
    objectsRef.current.push(object);
  }, []);
  
  // Collision detection
  const checkCollision = useCallback((obj: GameObject): boolean => {
    const playerX = playerXRef.current;
    const playerY = GAME_CONFIG.CANVAS_HEIGHT - GAME_CONFIG.PLAYER_HEIGHT - 10;
    
    return (
      obj.x < playerX + GAME_CONFIG.PLAYER_WIDTH &&
      obj.x + obj.width > playerX &&
      obj.y < playerY + GAME_CONFIG.PLAYER_HEIGHT &&
      obj.y + obj.height > playerY
    );
  }, []);
  
  // Game loop
  const gameLoop = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Initialize game start time
    if (gameStartTimeRef.current === 0) {
      gameStartTimeRef.current = timestamp;
    }
    
    const elapsed = (timestamp - gameStartTimeRef.current) / 1000;
    const timeLeft = Math.max(0, GAME_CONFIG.GAME_DURATION - elapsed);
    setTimeRemaining(Math.floor(timeLeft));
    
    // EOQ mode: last 10 seconds (80-90 seconds), 2.5X fall speed
    // timeLeft <= 10 means we're in the last 10 seconds
    if (timeLeft <= (GAME_CONFIG.GAME_DURATION - GAME_CONFIG.EOQ_MODE_START) && !isEoqModeRef.current) {
      isEoqModeRef.current = true;
      setIsEoqMode(true);
      // Calculate current speed multiplier at 80 seconds (just before EOQ)
      const elapsedAtEOQStart = GAME_CONFIG.EOQ_MODE_START;
      let currentMultiplier = 1.0;
      if (elapsedAtEOQStart >= GAME_CONFIG.SPEED_STAGE_3_TIME) {
        currentMultiplier = GAME_CONFIG.SPEED_STAGE_3_MULTIPLIER;
      } else if (elapsedAtEOQStart >= GAME_CONFIG.SPEED_STAGE_2_TIME) {
        currentMultiplier = GAME_CONFIG.SPEED_STAGE_2_MULTIPLIER;
      } else if (elapsedAtEOQStart >= GAME_CONFIG.SPEED_STAGE_1_TIME) {
        currentMultiplier = GAME_CONFIG.SPEED_STAGE_1_MULTIPLIER;
      }
      // Apply EOQ multiplier relative to current speed (2.5X / 2.0X = 1.25X additional)
      const eoqMultiplier = GAME_CONFIG.EOQ_FALL_SPEED_MULTIPLIER / currentMultiplier;
      objectsRef.current.forEach((obj) => {
        obj.speed *= eoqMultiplier;
      });
    }
    
    onTimeUpdate(timeLeft);
    
    const live = livesRef.current;
    if (timeLeft <= 0 || live <= 0) {
      const gameDuration = Math.min(elapsed, GAME_CONFIG.GAME_DURATION);
      onGameOver({
        score: scoreRef.current,
        advisorsCaught: advisorsCaughtRef.current,
        joinedCaught: joinedCaughtRef.current,
        ghostsHit: ghostsHitRef.current,
        gameDuration: Math.floor(gameDuration),
      });
      return;
    }
    
    // Player movement
    const moveSpeed = 5;
    if (keysRef.current.has('left')) {
      playerXRef.current = Math.max(0, playerXRef.current - moveSpeed);
    }
    if (keysRef.current.has('right')) {
      playerXRef.current = Math.min(
        GAME_CONFIG.CANVAS_WIDTH - GAME_CONFIG.PLAYER_WIDTH,
        playerXRef.current + moveSpeed
      );
    }
    
    const now = timestamp;
    
    // Calculate spawn interval based on current speed to maintain density
    // As speed increases, spawn interval decreases to keep same total objects but more dense
    // (elapsed is already defined above)
    let spawnInterval = GAME_CONFIG.SPAWN_INTERVAL_NORMAL;
    
    if (isEoqModeRef.current) {
      // Last 10 seconds: fastest spawn rate (2.5X speed)
      spawnInterval = GAME_CONFIG.SPAWN_INTERVAL_EOQ;
    } else if (elapsed >= GAME_CONFIG.SPEED_STAGE_3_TIME) {
      // 79-80 seconds: 2X speed, spawn more frequently
      spawnInterval = GAME_CONFIG.SPAWN_INTERVAL_NORMAL / 2.0;
    } else if (elapsed >= GAME_CONFIG.SPEED_STAGE_2_TIME) {
      // 60-79 seconds: 1.5X speed, spawn more frequently
      spawnInterval = GAME_CONFIG.SPAWN_INTERVAL_NORMAL / 1.5;
    } else if (elapsed >= GAME_CONFIG.SPEED_STAGE_1_TIME) {
      // 30-60 seconds: 1.25X speed, spawn slightly more frequently
      spawnInterval = GAME_CONFIG.SPAWN_INTERVAL_NORMAL / 1.25;
    }
    // 0-30 seconds: normal spawn interval
    
    // Jed spawn: once per game at random time between 15–75 seconds
    if (!jedSpawnedRef.current && elapsed >= jedSpawnTimeRef.current) {
      jedSpawnedRef.current = true;
      spawnObject('jed', now);
    }

    if (now - lastSpawnTimeRef.current >= spawnInterval) {
      lastSpawnTimeRef.current = now;
      const rand = Math.random();
      if (rand < GAME_CONFIG.GHOST_SPAWN_CHANCE) {
        spawnObject('ghost', now);
      } else if (rand < GAME_CONFIG.GHOST_SPAWN_CHANCE + GAME_CONFIG.STOP_SIGN_SPAWN_CHANCE) {
        spawnObject('stopSign', now);
      } else if (rand < GAME_CONFIG.GHOST_SPAWN_CHANCE + GAME_CONFIG.STOP_SIGN_SPAWN_CHANCE + GAME_CONFIG.JOINED_SPAWN_CHANCE) {
        spawnObject('joined', now);
      } else if (rand < GAME_CONFIG.GHOST_SPAWN_CHANCE + GAME_CONFIG.STOP_SIGN_SPAWN_CHANCE + GAME_CONFIG.JOINED_SPAWN_CHANCE + GAME_CONFIG.POWERUP_SPAWN_CHANCE) {
        // Power-up (simplified)
      } else {
        spawnObject('sqo', now);
      }
    }
    
    // Update objects
    const objectsToRemove: GameObject[] = [];
    objectsRef.current.forEach((obj) => {
      obj.y += obj.speed;
      
      if (obj.y + obj.height > GAME_CONFIG.CANVAS_HEIGHT) {
        if (obj.type === 'sqo') {
           floatingTextsRef.current.push({
               id: Math.random().toString(),
               text: 'Missed opportunity!',
               x: obj.x,
               y: GAME_CONFIG.CANVAS_HEIGHT - 40,
               startTime: now,
               color: '#ef4444' // red-500
           });
        }
        // Jed missed: no message, just remove
        objectsToRemove.push(obj);
        return;
      }
      
      // Check collision
      const playerY = GAME_CONFIG.CANVAS_HEIGHT - GAME_CONFIG.PLAYER_HEIGHT - 10;
      
      // Near-miss detection
      if (!obj.nearMissTriggered && !checkCollision(obj)) {
        if (obj.y + obj.height > playerY && obj.y < playerY + GAME_CONFIG.PLAYER_HEIGHT) {
           const playerCenter = playerXRef.current + GAME_CONFIG.PLAYER_WIDTH / 2;
           const objCenter = obj.x + obj.width / 2;
           const dist = Math.abs(objCenter - playerCenter);
           const minDist = (obj.width + GAME_CONFIG.PLAYER_WIDTH) / 2 + 20;
           
           if (dist < minDist) {
               obj.nearMissTriggered = true;
               floatingTextsRef.current.push({
                   id: Math.random().toString(),
                   text: 'Close!',
                   x: obj.x + 20,
                   y: obj.y,
                   startTime: now,
                   color: '#ffffff'
               });
           }
        }
      }

      if (checkCollision(obj)) {
        objectsToRemove.push(obj);
        
        if (obj.type === 'jed') {
          const jedAum = 1_000_000_000;
          if (!isMuted && catchSoundRef.current) {
            catchSoundRef.current.currentTime = 0;
            catchSoundRef.current.play().catch(() => {});
          }
          scoreRef.current += jedAum;
          setScore(scoreRef.current);
          setLastCaught({ name: 'Jed', aum: jedAum, type: 'jed' });
          setCatchPopup('jed');
        } else if (obj.type === 'sqo' || obj.type === 'joined') {
          // Play sound
          if (!isMuted) {
            if (obj.type === 'sqo' && catchSoundRef.current) {
              catchSoundRef.current.currentTime = 0;
              catchSoundRef.current.play().catch(() => {});
            } else if (obj.type === 'joined' && joinedSoundRef.current) {
              joinedSoundRef.current.currentTime = 0;
              joinedSoundRef.current.play().catch(() => {});
            }
          }

          const aumValue = obj.aum;
          const multiplier = obj.type === 'joined' ? 1.5 : 1.0;
          const hasDoubleAum = activePowerUpsRef.current.some(p => p.type === 'doubleAum' && p.expiresAt > now);
          const finalAum = aumValue * multiplier * (hasDoubleAum ? 2 : 1);
          
          scoreRef.current += finalAum;
          setScore(scoreRef.current);
          setLastCaught({ name: obj.name, aum: finalAum, type: obj.type });
          if (obj.type === 'sqo') {
            advisorsCaughtRef.current += 1;
            setAdvisorsCaught(advisorsCaughtRef.current);
            setCatchPopup('sqo');
          } else {
            joinedCaughtRef.current += 1;
            setJoinedCaught(joinedCaughtRef.current);
            setCatchPopup('joined');
          }
        } else if (obj.type === 'ghost' || obj.type === 'stopSign') {
          // Play sound
          if (!isMuted) {
            if (obj.type === 'ghost' && ghostSoundRef.current) {
              ghostSoundRef.current.currentTime = 0;
              ghostSoundRef.current.play().catch(() => {});
            } else if (obj.type === 'stopSign' && doNotCallSoundRef.current) {
              doNotCallSoundRef.current.currentTime = 0;
              doNotCallSoundRef.current.play().catch(() => {});
            }
          }

          scoreRef.current = Math.max(0, scoreRef.current - GAME_CONFIG.GHOST_PENALTY);
          livesRef.current -= 1;
          ghostsHitRef.current += 1;
          setScore(scoreRef.current);
          setLives(livesRef.current);
          setGhostsHit(ghostsHitRef.current);
        }
      }
    });
    
    // Remove collided/off-screen objects
    objectsRef.current = objectsRef.current.filter(obj => !objectsToRemove.includes(obj));
    
    // Update power-ups
    activePowerUpsRef.current = activePowerUpsRef.current.filter(p => p.expiresAt > now);
    
    // Render
    ctx.clearRect(0, 0, GAME_CONFIG.CANVAS_WIDTH, GAME_CONFIG.CANVAS_HEIGHT);
    
    // EOQ mode tint (last 10 seconds)
    if (isEoqModeRef.current) {
      ctx.fillStyle = 'rgba(220, 38, 38, 0.2)';
      ctx.fillRect(0, 0, GAME_CONFIG.CANVAS_WIDTH, GAME_CONFIG.CANVAS_HEIGHT);
    }
    
    const animationTime = now / 1000;
    // Update Jed DOM overlay (animated GIF) position when Jed exists
    const jed = objectsRef.current.find((o) => o.type === 'jed');
    if (jedImgRef.current) {
      if (jed) {
        jedImgRef.current.style.display = 'block';
        jedImgRef.current.style.left = `${jed.x}px`;
        jedImgRef.current.style.top = `${jed.y}px`;
      } else {
        jedImgRef.current.style.display = 'none';
      }
    }
    objectsRef.current.forEach((obj) => {
      drawGameObject(ctx, obj, animationTime);
    });

    // Draw floating texts
    floatingTextsRef.current = floatingTextsRef.current.filter(ft => now - ft.startTime < 1000);
    floatingTextsRef.current.forEach(ft => {
        const age = (now - ft.startTime) / 1000;
        ctx.save();
        ctx.fillStyle = ft.color;
        ctx.globalAlpha = 1 - age;
        ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        ctx.fillText(ft.text, ft.x, ft.y - 20 * age);
        ctx.restore();
    });
    
    // Draw player
    const playerX = playerXRef.current;
    const playerY = GAME_CONFIG.CANVAS_HEIGHT - GAME_CONFIG.PLAYER_HEIGHT - 10;
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(playerX, playerY, GAME_CONFIG.PLAYER_WIDTH, GAME_CONFIG.PLAYER_HEIGHT);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.strokeRect(playerX, playerY, GAME_CONFIG.PLAYER_WIDTH, GAME_CONFIG.PLAYER_HEIGHT);
    
    // Draw "Savvy" text on player
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('SAVVY', playerX + GAME_CONFIG.PLAYER_WIDTH / 2, playerY + GAME_CONFIG.PLAYER_HEIGHT / 2 + 5);
    
    animationFrameRef.current = requestAnimationFrame(gameLoop);
  }, [setIsEoqMode, onGameOver, onTimeUpdate, checkCollision, spawnObject]);
  
  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(gameLoop);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [gameLoop]);
  
  // Format time
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  return (
    <div 
      className="flex flex-col items-center justify-center min-h-screen p-4"
      style={{ 
        background: `linear-gradient(rgba(15, 23, 42, 0.65), rgba(15, 23, 42, 0.68)), url('/games/pipeline-catcher/images/lobby-bg.png')`,
        backgroundSize: 'cover',
      }}
    >
      {/* HUD */}
      <div className="bg-slate-900/90 rounded-lg p-4 mb-4 w-full max-w-[700px] border border-slate-700">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-xs text-slate-400">SCORE</div>
              <div className="text-2xl font-bold text-emerald-400">{formatGameAum(score)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">LIVES</div>
              <div className="text-2xl font-bold text-red-400">
                {'❤️'.repeat(lives)}{'🖤'.repeat(GAME_CONFIG.STARTING_LIVES - lives)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">TIME</div>
              <div className={`text-2xl font-bold ${timeRemaining <= (GAME_CONFIG.GAME_DURATION - GAME_CONFIG.EOQ_MODE_START) ? 'text-red-500 animate-pulse' : 'text-white'}`}>
                {formatTime(timeRemaining)}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">QUARTER</div>
            <div className="text-lg font-bold text-white">{quarter}</div>
          </div>
        </div>
        
        {lastCaught && (
          <div className="mt-2 pt-2 border-t border-slate-700">
            <span className="text-slate-400 text-sm">Caught: </span>
            <span className="text-emerald-300 font-semibold">{lastCaught.name}</span>
            <span className="text-slate-400 text-sm"> {lastCaught.type === 'joined' ? '(Joined) ' : ''}+{formatGameAum(lastCaught.aum)}</span>
          </div>
        )}
        
        {isEoqMode && (
          <div className="mt-2 text-center">
            <div className="text-2xl font-bold text-red-500 animate-pulse">⚡ EOQ MODE ⚡</div>
          </div>
        )}
      </div>
      
      {/* Canvas + Jed overlay (animated GIF) */}
      <div
        className="relative"
        style={{ width: GAME_CONFIG.CANVAS_WIDTH, height: GAME_CONFIG.CANVAS_HEIGHT }}
      >
        <canvas
          ref={canvasRef}
          width={GAME_CONFIG.CANVAS_WIDTH}
          height={GAME_CONFIG.CANVAS_HEIGHT}
          className="border-2 border-slate-700 rounded-lg bg-slate-900/50"
        />
        <img
          ref={jedImgRef}
          src="/games/pipeline-catcher/images/jed-walk.gif"
          alt="Jed"
          className="absolute pointer-events-none z-10 hidden"
          style={{
            width: OBJECT_SIZES.jed.width,
            height: OBJECT_SIZES.jed.height,
            imageRendering: 'pixelated',
          }}
        />
        {catchPopup === 'jed' && (
          <JedPopup onComplete={() => setCatchPopup(null)} />
        )}
      </div>
      
      {/* Instructions */}
      <div className="mt-4 text-center text-slate-300 text-sm">
        <p>Use ← → or A/D keys to move</p>
      </div>

      <CatchPopup
        type={catchPopup === 'jed' ? null : catchPopup}
        onComplete={() => setCatchPopup(null)}
      />
    </div>
  );
}
