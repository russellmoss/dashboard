// Pipeline Catcher Game Types

export type GameObjectType = 'sqo' | 'joined' | 'ghost' | 'stopSign' | 'powerup';
export type PowerUpType = 'doubleAum' | 'slowMo' | 'shield';

export interface GameObject {
  id: string;
  type: GameObjectType;
  name: string;
  aum: number;
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  stage?: 'Qualifying' | 'Discovery' | 'Sales Process' | 'Negotiating';
  reason?: string;
  powerUpType?: PowerUpType;
}

export interface ActivePowerUp {
  type: PowerUpType;
  expiresAt: number;
}

export interface QuarterLevel {
  quarter: string;
  displayName: string;
  sqoCount: number;
  joinedCount: number;
  totalAum: number;
  isQTD: boolean;
  highScore?: {
    playerName: string;
    score: number;
  };
}

export interface QuarterGameData {
  sqos: Array<{ name: string; aum: number; stage: string }>;
  stopSigns: Array<{ name: string }>;
  ghosts: Array<{ name: string }>;
  joined: Array<{ name: string; aum: number }>;
}

export interface LeaderboardEntry {
  id: string;
  rank: number;
  playerName: string;
  playerId: string;
  score: number;
  advisorsCaught: number;
  joinedCaught: number;
  message: string | null;
  playedAt: string;
  isCurrentUser: boolean;
}

// API Response Types
export interface LevelsApiResponse {
  levels: QuarterLevel[];
  currentQuarter: string;
}

export interface GameDataApiResponse {
  quarter: string;
  data: QuarterGameData;
}

export interface LeaderboardApiResponse {
  quarter: string;
  entries: LeaderboardEntry[];
  userRank: number | null;
  userEntry: LeaderboardEntry | null;
}

export interface SubmitScoreRequest {
  quarter: string;
  score: number;
  advisorsCaught: number;
  joinedCaught: number;
  ghostsHit: number;
  gameDuration: number;
  message?: string;
}

export interface SubmitScoreResponse {
  success: boolean;
  rank: number;
  isTopThree: boolean;
  entry: LeaderboardEntry;
}
