# Pipeline Catcher: Complete Implementation Plan

> **Game Overview**: An easter egg game hidden in the Savvy dashboard where users catch falling SQO advisors, avoid ghosts (leads that never responded) and stop signs (Do Not Call), and try to land rare Joined advisors for bonus points.
>
> **Access**: Triple-click the "Savvy Wealth" logo in the sidebar
>
> **Music**: 
> - Menu/Level Select: Gorillaz.mp3
> - Gameplay: Billy_Joel.mp3 (intensity increases at 2:48, game ends at 3:00)
> - Game Over/Leaderboard: Dre.mp3

---

## Important Codebase Alignment Notes

**Before implementing, note these codebase-specific patterns:**

1. **Date Handling**: All BigQuery date fields are TIMESTAMP type. Always wrap with `DATE()` function:
   - ✅ `DATE(Date_Became_SQO__c) >= @startDate`
   - ✅ `FORMAT_DATE('%Y-Q%Q', DATE(Date_Became_SQO__c))`
   - ❌ `Date_Became_SQO__c >= @startDate` (will fail type mismatch)
   - ❌ `FORMAT_DATE('%Y-Q%Q', Date_Became_SQO__c)` (may work but inconsistent)

2. **Caching**: All query functions should use `cachedQuery` wrapper:
   - Import: `import { cachedQuery, CACHE_TAGS } from '@/lib/cache';`
   - Pattern: Create `_getFunction` (internal), then `export const getFunction = cachedQuery(_getFunction, 'getFunction', CACHE_TAGS.DASHBOARD);`
   - See `src/lib/queries/open-pipeline.ts` for examples

3. **Number Extraction**: BigQuery returns numbers as `{ value: string }` or `number`. Use `parseFloat()` not `parseInt()` for AUM values (they can be decimals like 15000000.50).

4. **Prisma Import**: Use `import prisma from '@/lib/prisma';` (not `@prisma/client`). The prisma client is a proxy that handles lazy initialization.

5. **API Client Pattern**: Add to existing `src/lib/api-client.ts` file, don't create new file. Follow the `dashboardApi` pattern exactly.

6. **PowerShell Commands**: This is a Windows environment - use PowerShell syntax, not bash. Commands in this doc use PowerShell.

7. **Quarter Calculation**: The `getLastNQuarters` function has been fixed to properly calculate quarters (handles year rollover correctly).

8. **Prisma Distinct Limitation**: Prisma doesn't support `distinct: ['quarter']` easily. Use `Promise.all` with `findFirst` per quarter instead (see Step 5.1).

9. **Sidebar Component**: The Sidebar is a client component (`'use client'`). The EasterEggTrigger must be defined inside the same file to use hooks.

10. **Next.js 14 App Router Params**: Route params may be a Promise in Next.js 14+. Always await: `const resolvedParams = await Promise.resolve(params);`

---

## Pre-Implementation Checklist

Before starting, ensure:
- [ ] You have access to the codebase at `C:\Users\russe\Documents\Dashboard\`
- [ ] BigQuery MCP connection is working
- [ ] Neon database is accessible
- [ ] The three MP3 files exist in the Dashboard folder
- [ ] You understand the codebase patterns:
  - BigQuery queries use `runQuery` from `@/lib/bigquery`
  - Queries should be wrapped with `cachedQuery` from `@/lib/cache`
  - Date fields are TIMESTAMP - use `DATE()` function in SQL
  - Prisma client is imported as `prisma` from `@/lib/prisma`
  - API routes use `getServerSession(authOptions)` for auth

---

# PHASE 1: Project Setup & Asset Organization

## Step 1.1: Create Directory Structure

**Cursor Prompt:**
```
Create the following directory structure for the Pipeline Catcher game:

1. src/app/dashboard/games/pipeline-catcher/ (for the page)
2. src/components/games/pipeline-catcher/ (for game components)  
3. src/components/games/pipeline-catcher/hooks/ (for custom hooks)
4. src/lib/queries/pipeline-catcher.ts (for BigQuery queries)
5. src/app/api/games/pipeline-catcher/ (for API routes)
6. src/app/api/games/pipeline-catcher/levels/ (for levels endpoint)
7. src/app/api/games/pipeline-catcher/play/ (for game data endpoint)
8. src/app/api/games/pipeline-catcher/leaderboard/ (for scores endpoint)
9. public/games/pipeline-catcher/audio/ (for audio assets)
10. public/games/pipeline-catcher/images/ (for image assets)

Create placeholder files or .gitkeep in each directory.
```

**Verification (PowerShell commands):**
```powershell
Get-ChildItem src/app/dashboard/games/pipeline-catcher/ -ErrorAction SilentlyContinue
Get-ChildItem src/components/games/pipeline-catcher/ -ErrorAction SilentlyContinue
Get-ChildItem src/lib/queries/ | Where-Object { $_.Name -like "*pipeline*" }
Get-ChildItem src/app/api/games/pipeline-catcher/ -Recurse -ErrorAction SilentlyContinue
Get-ChildItem public/games/pipeline-catcher/ -Recurse -ErrorAction SilentlyContinue
```

---

## Step 1.2: Move Audio Assets

**Cursor Prompt:**
```
Move the following audio files to the public game assets directory:

1. Copy "C:\Users\russe\Documents\Dashboard\Gorillaz.mp3" to "public/games/pipeline-catcher/audio/menu-music.mp3"
2. Copy "C:\Users\russe\Documents\Dashboard\Billy_Joel.mp3" to "public/games/pipeline-catcher/audio/gameplay-music.mp3"  
3. Copy "C:\Users\russe\Documents\Dashboard\Dre.mp3" to "public/games/pipeline-catcher/audio/gameover-music.mp3"

Use copy not move so the originals are preserved.
```

**Verification (PowerShell):**
```powershell
Get-ChildItem public/games/pipeline-catcher/audio/
# Should show: menu-music.mp3, gameplay-music.mp3, gameover-music.mp3
```

---

## Step 1.3: Download and Save Background Image

**Cursor Prompt:**
```
Download the lobby background image and copy the logo:

1. Download https://i.imgur.com/rQrfmen.png and save to public/games/pipeline-catcher/images/lobby-bg.png
2. Copy public/savvy-logo.png to public/games/pipeline-catcher/images/savvy-logo.png

You can use curl or wget to download the image.
```

**Verification (PowerShell):**
```powershell
Get-ChildItem public/games/pipeline-catcher/images/
# Should show: lobby-bg.png, savvy-logo.png
```

---

# PHASE 2: Database Schema & Prisma Setup

## Step 2.1: Add GameScore Model to Prisma Schema

**Cursor Prompt:**
```
Open prisma/schema.prisma and add a new GameScore model for the Pipeline Catcher leaderboard.

Add this model after the existing User model, and add a relation from User to GameScore.
```

**Code to Add to `prisma/schema.prisma`:**
```prisma
// Pipeline Catcher Game Leaderboard
model GameScore {
  id             String   @id @default(cuid())
  
  // User relation
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  // Score data
  score          BigInt   // Total AUM caught (stored in dollars)
  advisorsCaught Int      // Number of SQOs caught
  joinedCaught   Int      // Number of Joined advisors caught (bonus)
  ghostsHit      Int      // Number of ghosts/stop signs hit
  
  // Game context
  quarter        String   // e.g., "2025-Q1", "2025-Q2"
  gameDuration   Int      // Seconds played (max 180)
  
  // Leaderboard message
  message        String?  @db.VarChar(100)
  
  // Timestamps
  playedAt       DateTime @default(now())
  
  // Indexes for fast leaderboard queries
  @@index([quarter, score(sort: Desc)])
  @@index([userId])
  @@index([playedAt])
}
```

**Also add to the User model (find the existing User model and add this line in the relations section):**
```prisma
gameScores     GameScore[]
```

---

## Step 2.2: Generate Prisma Client and Create Migration

**Cursor Prompt:**
```
Run these commands to apply the database changes:

1. npx prisma generate
2. npx prisma migrate dev --name add_game_score_leaderboard

Verify the migration was successful.
```

**Verification (PowerShell):**
```powershell
Get-ChildItem prisma/migrations/ | Sort-Object LastWriteTime -Descending | Select-Object -First 5
npx prisma studio
# Check that GameScore table appears in Prisma Studio
```

**Manual Verification:**
- [ ] Open Prisma Studio and confirm GameScore table exists
- [ ] Confirm columns: id, userId, score, advisorsCaught, joinedCaught, ghostsHit, quarter, gameDuration, message, playedAt

---

# PHASE 3: TypeScript Types & Constants

## Step 3.1: Create Game Types

**Cursor Prompt:**
```
Create a new file at src/types/game.ts with TypeScript types for the Pipeline Catcher game.
```

**Code for `src/types/game.ts`:**
```typescript
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
```

---

## Step 3.2: Create Game Constants

**Cursor Prompt:**
```
Create a new file at src/config/game-constants.ts with game configuration.
```

**Code for `src/config/game-constants.ts`:**
```typescript
export const GAME_CONFIG = {
  GAME_DURATION: 180,
  STARTING_LIVES: 3,
  INTENSE_MODE_START: 12, // Last 12 seconds (2:48 mark)
  SPAWN_INTERVAL_NORMAL: 1400,
  SPAWN_INTERVAL_INTENSE: 800,
  BASE_FALL_SPEED: 2.0,
  INTENSE_FALL_SPEED_MULTIPLIER: 1.5,
  JOINED_SPEED_MULTIPLIER: 2.5,
  GHOST_PENALTY: 5000000, // $5M
  POWERUP_SPAWN_CHANCE: 0.05,
  GHOST_SPAWN_CHANCE: 0.15,
  STOP_SIGN_SPAWN_CHANCE: 0.10,
  JOINED_SPAWN_CHANCE: 0.05,
  CANVAS_WIDTH: 700,
  CANVAS_HEIGHT: 500,
  PLAYER_WIDTH: 100,
  PLAYER_HEIGHT: 60,
};

export const STAGE_SPEED_MODIFIERS: Record<string, number> = {
  'Qualifying': 1.4,
  'Discovery': 1.2,
  'Sales Process': 1.0,
  'Negotiating': 0.75,
};

export const getAumColor = (aum: number): string => {
  if (aum >= 50000000) return '#a855f7'; // Purple whale
  if (aum >= 25000000) return '#3b82f6'; // Blue premium
  if (aum >= 10000000) return '#22c55e'; // Green growth
  return '#6b7280'; // Gray starter
};

export const formatGameAum = (aum: number): string => {
  if (aum >= 1000000000) return `$${(aum / 1000000000).toFixed(2)}B`;
  if (aum >= 1000000) return `$${(aum / 1000000).toFixed(1)}M`;
  if (aum >= 1000) return `$${(aum / 1000).toFixed(0)}K`;
  return `$${aum}`;
};

export const QUARTERS_TO_SHOW = 5;

export const getQuarterDates = (quarter: string): { startDate: string; endDate: string } => {
  const [year, q] = quarter.split('-Q');
  const quarterNum = parseInt(q);
  const startMonth = (quarterNum - 1) * 3;
  const startDate = new Date(parseInt(year), startMonth, 1);
  
  const now = new Date();
  const currentQuarter = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  
  let endDate: Date;
  if (quarter === currentQuarter) {
    // QTD: end date is today
    endDate = now;
  } else {
    // Past quarter: end date is last day of quarter
    endDate = new Date(parseInt(year), startMonth + 3, 0);
  }
  
  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
};

export const getCurrentQuarter = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
};

export const getLastNQuarters = (n: number): string[] => {
  const quarters: string[] = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11
  const currentQuarter = Math.floor(currentMonth / 3) + 1; // 1-4
  
  // Start with current quarter (QTD)
  quarters.push(`${currentYear}-Q${currentQuarter}`);
  
  // Add previous quarters
  for (let i = 1; i < n; i++) {
    let year = currentYear;
    let q = currentQuarter - i;
    
    // Handle year rollover
    while (q <= 0) {
      q += 4;
      year -= 1;
    }
    
    quarters.push(`${year}-Q${q}`);
  }
  
  return quarters;
};

export const formatQuarterDisplay = (quarter: string): string => {
  const [year, q] = quarter.split('-');
  return `${q} ${year}`;
};

export const isQTD = (quarter: string): boolean => {
  return quarter === getCurrentQuarter();
};
```

---

# PHASE 4: BigQuery Data Queries

## Step 4.1: Create Game Data Query Functions

**Cursor Prompt:**
```
Create a new file at src/lib/queries/pipeline-catcher.ts with BigQuery query functions.

Follow the existing pattern from src/lib/queries/open-pipeline.ts using runQuery and the FULL_TABLE constant.
```

**Code for `src/lib/queries/pipeline-catcher.ts`:**
```typescript
import { runQuery } from '../bigquery';
import { FULL_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';
import { QuarterGameData, QuarterLevel } from '@/types/game';
import { getQuarterDates, getLastNQuarters, getCurrentQuarter, formatQuarterDisplay, QUARTERS_TO_SHOW } from '@/config/game-constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

// Note: Following the pattern from src/lib/queries/open-pipeline.ts
// All queries use DATE() wrapper for TIMESTAMP fields
// All query functions are wrapped with cachedQuery for performance

interface RawSqoRecord {
  name: string;
  aum: { value: string } | number | null;
  stage: string;
}

interface RawJoinedRecord {
  name: string;
  aum: { value: string } | number | null;
}

interface RawGhostRecord {
  name: string;
}

interface RawQuarterSummary {
  quarter: string;
  sqo_count: { value: string } | number;
  joined_count: { value: string } | number;
  total_aum: { value: string } | number | null;
}

const extractNumber = (value: { value: string } | number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && 'value' in value) {
    const num = parseFloat(value.value);
    return isNaN(num) ? 0 : num;
  }
  return 0;
};

const _getAvailableLevels = async (): Promise<QuarterLevel[]> => {
  const quarters = getLastNQuarters(QUARTERS_TO_SHOW);
  const currentQtr = getCurrentQuarter();
  const oldestQuarter = quarters[quarters.length - 1];
  const { startDate } = getQuarterDates(oldestQuarter);
  
  const summaryQuery = `
    WITH quarter_data AS (
      SELECT 
        FORMAT_DATE('%Y-Q%Q', DATE(Date_Became_SQO__c)) as quarter,
        COUNT(*) as sqo_count,
        SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) as total_aum
      FROM \`${FULL_TABLE}\`
      WHERE is_sqo_unique = 1
        AND recordtypeid = @recruitingRecordType
        AND DATE(Date_Became_SQO__c) >= @startDate
      GROUP BY quarter
    ),
    joined_data AS (
      SELECT 
        FORMAT_DATE('%Y-Q%Q', DATE(advisor_join_date__c)) as quarter,
        COUNT(*) as joined_count
      FROM \`${FULL_TABLE}\`
      WHERE is_joined_unique = 1
        AND DATE(advisor_join_date__c) >= @startDate
      GROUP BY quarter
    )
    SELECT 
      q.quarter,
      COALESCE(q.sqo_count, 0) as sqo_count,
      COALESCE(j.joined_count, 0) as joined_count,
      COALESCE(q.total_aum, 0) as total_aum
    FROM quarter_data q
    LEFT JOIN joined_data j ON q.quarter = j.quarter
    WHERE q.quarter IN UNNEST(@quarters)
    ORDER BY q.quarter DESC
  `;
  
  const summaryResults = await runQuery<RawQuarterSummary>(summaryQuery, {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    startDate,
    quarters,
  });
  
  return quarters.map(quarter => {
    const summary = summaryResults.find(s => s.quarter === quarter);
    return {
      quarter,
      displayName: formatQuarterDisplay(quarter),
      sqoCount: summary ? extractNumber(summary.sqo_count) : 0,
      joinedCount: summary ? extractNumber(summary.joined_count) : 0,
      totalAum: summary ? extractNumber(summary.total_aum) : 0,
      isQTD: quarter === currentQtr,
    };
  });
};

export const getAvailableLevels = cachedQuery(
  _getAvailableLevels,
  'getAvailableLevels',
  CACHE_TAGS.DASHBOARD
);

const _getGameDataForQuarter = async (quarter: string): Promise<QuarterGameData> => {
  const { startDate, endDate } = getQuarterDates(quarter);
  
  const sqoQuery = `
    SELECT 
      advisor_name as name,
      COALESCE(Underwritten_AUM__c, Amount, 0) as aum,
      StageName as stage
    FROM \`${FULL_TABLE}\`
    WHERE is_sqo_unique = 1
      AND recordtypeid = @recruitingRecordType
      AND DATE(Date_Became_SQO__c) >= @startDate
      AND DATE(Date_Became_SQO__c) <= @endDate
      AND advisor_name IS NOT NULL
    ORDER BY COALESCE(Underwritten_AUM__c, Amount, 0) DESC
  `;
  
  const stopSignQuery = `
    SELECT DISTINCT advisor_name as name
    FROM \`${FULL_TABLE}\`
    WHERE DoNotCall = TRUE
      AND DATE(FilterDate) >= @startDate
      AND DATE(FilterDate) <= @endDate
      AND advisor_name IS NOT NULL
    ORDER BY RAND()
    LIMIT 25
  `;
  
  const ghostQuery = `
    SELECT DISTINCT advisor_name as name
    FROM \`${FULL_TABLE}\`
    WHERE is_contacted = 1
      AND is_mql = 0
      AND DATE(FilterDate) >= @startDate
      AND DATE(FilterDate) <= @endDate
      AND advisor_name IS NOT NULL
    ORDER BY RAND()
    LIMIT 25
  `;
  
  const joinedQuery = `
    SELECT 
      advisor_name as name,
      COALESCE(Underwritten_AUM__c, Amount, 0) as aum
    FROM \`${FULL_TABLE}\`
    WHERE is_joined_unique = 1
      AND DATE(advisor_join_date__c) >= @startDate
      AND DATE(advisor_join_date__c) <= @endDate
      AND advisor_name IS NOT NULL
    ORDER BY COALESCE(Underwritten_AUM__c, Amount, 0) DESC
  `;
  
  const params = { recruitingRecordType: RECRUITING_RECORD_TYPE, startDate, endDate };
  
  const [sqoResults, stopSignResults, ghostResults, joinedResults] = await Promise.all([
    runQuery<RawSqoRecord>(sqoQuery, params),
    runQuery<RawGhostRecord>(stopSignQuery, params),
    runQuery<RawGhostRecord>(ghostQuery, params),
    runQuery<RawJoinedRecord>(joinedQuery, params),
  ]);
  
  return {
    sqos: sqoResults.map(r => ({ name: r.name, aum: extractNumber(r.aum), stage: r.stage })),
    stopSigns: stopSignResults.map(r => ({ name: r.name })),
    ghosts: ghostResults.map(r => ({ name: r.name })),
    joined: joinedResults.map(r => ({ name: r.name, aum: extractNumber(r.aum) })),
  };
};

export const getGameDataForQuarter = cachedQuery(
  _getGameDataForQuarter,
  'getGameDataForQuarter',
  CACHE_TAGS.DASHBOARD
);
```

---

# PHASE 5: API Routes

## Step 5.1: Create Levels API Route

**Cursor Prompt:**
```
Create src/app/api/games/pipeline-catcher/levels/route.ts
```

**Code for `src/app/api/games/pipeline-catcher/levels/route.ts`:**
```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAvailableLevels } from '@/lib/queries/pipeline-catcher';
import { getCurrentQuarter } from '@/config/game-constants';
import prisma from '@/lib/prisma';
import { LevelsApiResponse } from '@/types/game';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const levels = await getAvailableLevels();
    
    // Get high scores (top score per quarter)
    // Note: Prisma doesn't support distinct on multiple fields easily, so we query each quarter separately
    const quarterList = levels.map(l => l.quarter);
    const topScores = await Promise.all(
      quarterList.map(async (quarter) => {
        const topScore = await prisma.gameScore.findFirst({
          where: { quarter },
          orderBy: { score: 'desc' },
          include: { user: { select: { name: true } } },
        });
        return topScore ? { quarter, ...topScore } : null;
      })
    );
    const validTopScores = topScores.filter((s): s is NonNullable<typeof s> => s !== null);
    
    const levelsWithScores = levels.map(level => {
      const topScore = validTopScores.find(ts => ts.quarter === level.quarter);
      return {
        ...level,
        highScore: topScore ? {
          playerName: topScore.user.name.split(' ')[0] + ' ' + (topScore.user.name.split(' ')[1]?.[0] || '') + '.',
          score: Number(topScore.score),
        } : undefined,
      };
    });
    
    const response: LevelsApiResponse = {
      levels: levelsWithScores,
      currentQuarter: getCurrentQuarter(),
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching game levels:', error);
    return NextResponse.json({ error: 'Failed to fetch game levels' }, { status: 500 });
  }
}
```

---

## Step 5.2: Create Game Data API Route

**Cursor Prompt:**
```
Create src/app/api/games/pipeline-catcher/play/[quarter]/route.ts
```

**Code for `src/app/api/games/pipeline-catcher/play/[quarter]/route.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getGameDataForQuarter } from '@/lib/queries/pipeline-catcher';
import { GameDataApiResponse } from '@/types/game';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest, 
  { params }: { params: Promise<{ quarter: string }> | { quarter: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Next.js 14+ App Router: params may be a Promise
    const resolvedParams = await Promise.resolve(params);
    const { quarter } = resolvedParams;
    if (!/^\d{4}-Q[1-4]$/.test(quarter)) {
      return NextResponse.json({ error: 'Invalid quarter format' }, { status: 400 });
    }
    
    const gameData = await getGameDataForQuarter(quarter);
    const response: GameDataApiResponse = { quarter, data: gameData };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching game data:', error);
    return NextResponse.json({ error: 'Failed to fetch game data' }, { status: 500 });
  }
}
```

---

## Step 5.3: Create Leaderboard API Route

**Cursor Prompt:**
```
Create src/app/api/games/pipeline-catcher/leaderboard/route.ts with GET and POST methods.
```

**Code for `src/app/api/games/pipeline-catcher/leaderboard/route.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { LeaderboardApiResponse, SubmitScoreRequest, SubmitScoreResponse, LeaderboardEntry } from '@/types/game';

export const dynamic = 'force-dynamic';

function formatPlayerName(fullName: string): string {
  const parts = fullName.split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[1]?.[0] || ''}.`;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const quarter = new URL(request.url).searchParams.get('quarter');
    if (!quarter) {
      return NextResponse.json({ error: 'Quarter required' }, { status: 400 });
    }
    
    const scores = await prisma.gameScore.findMany({
      where: { quarter },
      orderBy: { score: 'desc' },
      take: 10,
      include: { user: { select: { id: true, name: true } } },
    });
    
    const entries: LeaderboardEntry[] = scores.map((score, i) => ({
      id: score.id,
      rank: i + 1,
      playerName: formatPlayerName(score.user.name),
      playerId: score.user.id,
      score: Number(score.score),
      advisorsCaught: score.advisorsCaught,
      joinedCaught: score.joinedCaught,
      message: score.message,
      playedAt: score.playedAt.toISOString(),
      isCurrentUser: score.user.id === session.user.id,
    }));
    
    const response: LeaderboardApiResponse = {
      quarter,
      entries,
      userRank: entries.find(e => e.isCurrentUser)?.rank || null,
      userEntry: entries.find(e => e.isCurrentUser) || null,
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body: SubmitScoreRequest = await request.json();
    const { quarter, score, advisorsCaught, joinedCaught, ghostsHit, gameDuration, message } = body;
    
    const newScore = await prisma.gameScore.create({
      data: {
        userId: session.user.id,
        quarter,
        score: BigInt(Math.floor(score)),
        advisorsCaught,
        joinedCaught: joinedCaught || 0,
        ghostsHit: ghostsHit || 0,
        gameDuration: gameDuration || 180,
        message: message?.slice(0, 100).trim() || null,
      },
      include: { user: { select: { id: true, name: true } } },
    });
    
    const higherScores = await prisma.gameScore.count({
      where: { quarter, score: { gt: newScore.score } },
    });
    const rank = higherScores + 1;
    
    const response: SubmitScoreResponse = {
      success: true,
      rank,
      isTopThree: rank <= 3,
      entry: {
        id: newScore.id,
        rank,
        playerName: formatPlayerName(newScore.user.name),
        playerId: newScore.user.id,
        score: Number(newScore.score),
        advisorsCaught: newScore.advisorsCaught,
        joinedCaught: newScore.joinedCaught,
        message: newScore.message,
        playedAt: newScore.playedAt.toISOString(),
        isCurrentUser: true,
      },
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error submitting score:', error);
    return NextResponse.json({ error: 'Failed to submit score' }, { status: 500 });
  }
}
```

---

## Step 5.4: Add API Client Functions

**Cursor Prompt:**
```
Add pipelineCatcherApi to src/lib/api-client.ts following the existing dashboardApi pattern.
```

**Code to ADD to `src/lib/api-client.ts`:**

**Step 1: Add imports at the top of the file (with other type imports):**
```typescript
import {
  LevelsApiResponse,
  GameDataApiResponse,
  LeaderboardApiResponse,
  SubmitScoreRequest,
  SubmitScoreResponse,
} from '@/types/game';
```

**Step 2: Add pipelineCatcherApi object at the end of the file (after dashboardApi and agentApi, before the handleApiError function):**
```typescript
export const pipelineCatcherApi = {
  getLevels: () => apiFetch<LevelsApiResponse>('/api/games/pipeline-catcher/levels'),
  getGameData: (quarter: string) => apiFetch<GameDataApiResponse>(`/api/games/pipeline-catcher/play/${encodeURIComponent(quarter)}`),
  getLeaderboard: (quarter: string) => apiFetch<LeaderboardApiResponse>(`/api/games/pipeline-catcher/leaderboard?quarter=${encodeURIComponent(quarter)}`),
  submitScore: (data: SubmitScoreRequest) => apiFetch<SubmitScoreResponse>('/api/games/pipeline-catcher/leaderboard', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
};
```

---

# PHASE 6: Game Components

## Step 6.1: Create Audio Manager Hook

**Cursor Prompt:**
```
Create src/components/games/pipeline-catcher/hooks/useGameAudio.ts
```

**Code for `src/components/games/pipeline-catcher/hooks/useGameAudio.ts`:**
```typescript
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
    
    Object.entries(AUDIO_PATHS).forEach(([track, path]) => {
      const audio = new Audio(path);
      audio.loop = track !== 'gameover';
      audio.volume = 0.5;
      audio.preload = 'auto';
      audioRefs.current[track as AudioTrack] = audio;
    });
    
    return () => {
      Object.values(audioRefs.current).forEach(audio => {
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
      audio.play().catch(console.error);
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
```

---

## Step 6.2: Create LevelSelect Component

**Note**: This component is referenced but the full code was not provided in Part 1 or Part 2. You'll need to create this component based on the game design. It should display available quarters/levels and allow selection.

**Cursor Prompt:**
```
Create src/components/games/pipeline-catcher/LevelSelect.tsx

This component should:
1. Display available quarters as selectable levels
2. Show high scores for each quarter
3. Highlight QTD quarter
4. Allow selecting a quarter to start the game
5. Display the lobby background image
```

---

## Step 6.3: Create GameCanvas Component

**Note**: This component is referenced but the full code was not provided in Part 1 or Part 2. You'll need to create this component based on the game design. It should handle the main game loop, rendering, and game mechanics.

**Cursor Prompt:**
```
Create src/components/games/pipeline-catcher/GameCanvas.tsx

This component should:
1. Handle the game loop using requestAnimationFrame
2. Render falling objects (SQOs, ghosts, stop signs, joined, power-ups)
3. Handle player movement (arrow keys, A/D keys)
4. Detect collisions
5. Track score, lives, and time
6. Trigger intense mode at 12 seconds remaining
7. Call onGameOver when game ends
```

---

## Step 6.4: Create GameOver Component

**Cursor Prompt:**
```
Create src/components/games/pipeline-catcher/GameOver.tsx
```

**Code for `src/components/games/pipeline-catcher/GameOver.tsx`:**
```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { pipelineCatcherApi } from '@/lib/api-client';
import { LeaderboardEntry, SubmitScoreRequest } from '@/types/game';
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
  onPlayAgain: () => void;
  onChangeLevel: () => void;
}

export function GameOver({ quarter, result, onPlayAgain, onChangeLevel }: GameOverProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [isTopThree, setIsTopThree] = useState(false);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  
  useEffect(() => {
    const submitScore = async () => {
      try {
        const scoreData: SubmitScoreRequest = {
          quarter,
          score: result.score,
          advisorsCaught: result.advisorsCaught,
          joinedCaught: result.joinedCaught,
          ghostsHit: result.ghostsHit,
          gameDuration: result.gameDuration,
        };
        
        const response = await pipelineCatcherApi.submitScore(scoreData);
        setIsTopThree(response.isTopThree);
        setUserRank(response.rank);
        
        // Fetch leaderboard
        const leaderboardResponse = await pipelineCatcherApi.getLeaderboard(quarter);
        setLeaderboard(leaderboardResponse.entries);
        setUserRank(leaderboardResponse.userRank || response.rank);
      } catch (error) {
        console.error('Error submitting score:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    submitScore();
  }, [quarter, result]);
  
  const handleSubmitMessage = async () => {
    if (!message.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      await pipelineCatcherApi.submitScore({
        quarter,
        score: result.score,
        advisorsCaught: result.advisorsCaught,
        joinedCaught: result.joinedCaught,
        ghostsHit: result.ghostsHit,
        gameDuration: result.gameDuration,
        message: message.trim(),
      });
      setIsSubmitted(true);
    } catch (error) {
      console.error('Error submitting message:', error);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <div 
      className="flex items-center justify-center min-h-screen p-4"
      style={{ 
        background: `linear-gradient(rgba(15, 23, 42, 0.95), rgba(15, 23, 42, 0.98)), url('/games/pipeline-catcher/images/lobby-bg.png')`,
        backgroundSize: 'cover',
      }}
    >
      <div className="bg-slate-900/90 rounded-lg p-8 max-w-2xl w-full border border-slate-700">
        <h2 className="text-3xl font-bold text-center mb-6 text-white">Game Over!</h2>
        
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
                disabled={isSubmitting || !message.trim()}
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
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    entry.isCurrentUser 
                      ? 'bg-emerald-500/20 border border-emerald-500/50' 
                      : i === 0 ? 'bg-yellow-500/20' 
                      : i === 1 ? 'bg-slate-400/20' 
                      : i === 2 ? 'bg-orange-700/20' 
                      : 'bg-slate-700/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`}</span>
                    <span className={`font-medium ${entry.isCurrentUser ? 'text-emerald-400' : ''}`}>
                      {entry.playerName} {entry.isCurrentUser && '(You)'}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-sm">{formatGameAum(entry.score)}</div>
                    {entry.message && (
                      <div className="text-xs text-slate-400 max-w-32 truncate">"{entry.message}"</div>
                    )}
                  </div>
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
```

---

## Step 6.5: Create Main Game Component

**Cursor Prompt:**
```
Create the main game orchestrator component at:
src/components/games/pipeline-catcher/PipelineCatcher.tsx

This component manages the game state machine (menu, playing, game over) and coordinates audio.
```

**Code for `src/components/games/pipeline-catcher/PipelineCatcher.tsx`:**
```typescript
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
  const [isIntenseMode, setIsIntenseMode] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  
  const audio = useGameAudio();
  
  // Fetch available levels on mount
  useEffect(() => {
    const fetchLevels = async () => {
      try {
        const response = await pipelineCatcherApi.getLevels();
        setLevels(response.levels);
      } catch (error) {
        console.error('Error fetching levels:', error);
      } finally {
        setIsLoadingLevels(false);
      }
    };
    
    fetchLevels();
  }, []);
  
  // Play menu music when on level select
  useEffect(() => {
    if (screen === 'levelSelect' && !isMuted) {
      audio.play('menu');
    }
    return () => {
      if (screen === 'levelSelect') {
        audio.stop();
      }
    };
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
      setIsIntenseMode(false);
      
      // Start gameplay music
      if (!isMuted) {
        audio.play('gameplay');
      }
    } catch (error) {
      console.error('Error fetching game data:', error);
      alert('Failed to load game data. Please try again.');
    } finally {
      setIsLoadingGame(false);
    }
  }, [audio, isMuted]);
  
  // Handle game over
  const handleGameOver = useCallback((result: GameResult) => {
    setGameResult(result);
    setScreen('gameOver');
    audio.stop();
    if (!isMuted) {
      audio.play('gameover');
    }
  }, [audio, isMuted]);
  
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
    setSelectedQuarter(null);
    setGameData(null);
    setIsIntenseMode(false);
    audio.stop();
    if (!isMuted) {
      audio.play('menu');
    }
  }, [audio, isMuted]);
  
  // Handle time updates (for intense mode music sync)
  const handleTimeUpdate = useCallback((timeRemaining: number) => {
    // Intense mode starts at 12 seconds remaining (2:48 in a 3-minute game)
    if (timeRemaining <= GAME_CONFIG.INTENSE_MODE_START && !isIntenseMode) {
      setIsIntenseMode(true);
    }
  }, [isIntenseMode]);
  
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
          background: `linear-gradient(rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.95)), url('/games/pipeline-catcher/images/lobby-bg.png')`,
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
          isIntenseMode={isIntenseMode}
          setIsIntenseMode={setIsIntenseMode}
        />
      )}
      
      {screen === 'gameOver' && selectedQuarter && gameResult && (
        <GameOver
          quarter={selectedQuarter}
          result={gameResult}
          onPlayAgain={handlePlayAgain}
          onChangeLevel={handleChangeLevel}
        />
      )}
    </div>
  );
}
```

---

## Step 6.6: Create Component Index Export

**Cursor Prompt:**
```
Create an index file to export all game components at:
src/components/games/pipeline-catcher/index.ts
```

**Code for `src/components/games/pipeline-catcher/index.ts`:**
```typescript
export { PipelineCatcher } from './PipelineCatcher';
export { LevelSelect } from './LevelSelect';
export { GameCanvas } from './GameCanvas';
export { GameOver } from './GameOver';
export { useGameAudio } from './hooks/useGameAudio';
```

---

# PHASE 7: Game Page & Easter Egg Trigger

## Step 7.1: Create Game Page

**Cursor Prompt:**
```
Create the game page at:
src/app/dashboard/games/pipeline-catcher/page.tsx

This is a simple page that renders the PipelineCatcher component.
```

**Code for `src/app/dashboard/games/pipeline-catcher/page.tsx`:**
```typescript
'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PipelineCatcher } from '@/components/games/pipeline-catcher';

export default function PipelineCatcherPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);
  
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-emerald-500"></div>
      </div>
    );
  }
  
  if (!session) {
    return null;
  }
  
  return <PipelineCatcher />;
}
```

---

## Step 7.2: Add Triple-Click Easter Egg to Sidebar

**Cursor Prompt:**
```
Modify src/components/layout/Sidebar.tsx to add a triple-click easter egg on the "Savvy Wealth" text.

Find the span with "Savvy Wealth" text and:
1. Wrap it in a clickable div
2. Add a triple-click handler that navigates to the game
3. Keep the visual appearance exactly the same
```

**Find this code in Sidebar.tsx (around line 56-60):**
```tsx
{!isCollapsed && (
  <div className="ml-3 flex items-center">
    <span className="text-lg font-semibold text-gray-900">Savvy Wealth</span>
  </div>
)}
```

**Replace with:**
```tsx
{!isCollapsed && (
  <div className="ml-3 flex items-center">
    <EasterEggTrigger>
      <span className="text-lg font-semibold text-gray-900 dark:text-white cursor-default select-none">
        Savvy Wealth
      </span>
    </EasterEggTrigger>
  </div>
)}
```

**Important**: The Sidebar component already imports `usePathname` from `next/navigation` (line 3). Update that import to also include `useRouter`:
```tsx
import { usePathname, useRouter } from 'next/navigation';
```

**Add the EasterEggTrigger component INSIDE the Sidebar.tsx file (after imports, before the PAGES constant):**

**Add these imports at the top (update existing usePathname import, add useRef/useCallback/ReactNode):**
```tsx
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useCallback, ReactNode } from 'react';
```

**Then add the EasterEggTrigger component (after imports, before PAGES constant around line 12):**
```tsx
// Easter egg component - triple-click to access Pipeline Catcher game
function EasterEggTrigger({ children }: { children: ReactNode }) {
  const router = useRouter();
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const handleClick = useCallback(() => {
    clickCountRef.current++;
    
    // Reset click count after 500ms of no clicks
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }
    
    clickTimerRef.current = setTimeout(() => {
      clickCountRef.current = 0;
    }, 500);
    
    // Triple-click detected!
    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
      }
      router.push('/dashboard/games/pipeline-catcher');
    }
  }, [router]);
  
  return (
    <div onClick={handleClick} role="button" tabIndex={-1}>
      {children}
    </div>
  );
}
```


---

## Step 7.3: Verification - Easter Egg & Page Access

**Manual Verification Steps:**

1. **Start the dev server:**
   ```powershell
   npm run dev
   ```

2. **Log in to the dashboard**

3. **Test direct page access:**
   - Navigate to `http://localhost:3000/dashboard/games/pipeline-catcher`
   - Should see the level select screen

4. **Test easter egg trigger:**
   - Go to any dashboard page
   - Triple-click the "Savvy Wealth" text in the sidebar
   - Should navigate to the game

**Browser Console Verification (F12):**
```javascript
// Check if game page is accessible
fetch('/dashboard/games/pipeline-catcher')
  .then(r => console.log('Game page status:', r.status))
  .catch(console.error);
```

---

# PHASE 8: Testing & Verification

## Step 8.1: Full Game Flow Test

**Manual Testing Checklist:**

### Level Select Screen
- [ ] Background image displays (lobby photo)
- [ ] Menu music plays (Gorillaz)
- [ ] All 5 quarters display with correct stats
- [ ] QTD quarter has "QTD" badge
- [ ] High scores show if available
- [ ] Mute button works
- [ ] Exit button returns to dashboard

### Gameplay
- [ ] Background image displays (darkened)
- [ ] Gameplay music plays (Billy Joel)
- [ ] Player moves with arrow keys (← →)
- [ ] Player moves with A/D keys
- [ ] Savvy logo displays on catcher bucket
- [ ] SQOs fall (green/blue/purple cards with 💼)
- [ ] Ghosts fall (red cards with 👻)
- [ ] Stop signs fall (octagon with 🛑)
- [ ] Joined fall (gold cards with ⭐, faster)
- [ ] Power-ups fall occasionally
- [ ] Catching SQO adds AUM to score
- [ ] Catching Joined adds 1.5x AUM to score
- [ ] Hitting ghost loses life and -$5M
- [ ] Hitting stop sign loses life and -$5M
- [ ] Score displays correctly formatted ($XXM)
- [ ] Lives display correctly (❤️/🖤)
- [ ] Timer counts down from 3:00
- [ ] At 0:12 (2:48 in), intense mode activates:
  - [ ] Background turns red-tinted
  - [ ] "INTENSE MODE" text appears
  - [ ] Objects fall faster
  - [ ] Spawning increases
- [ ] Game ends at 0:00

### Game Over
- [ ] Game over music plays (Dre)
- [ ] Final score displays
- [ ] Stats show (advisors caught, joined caught, ghosts hit)
- [ ] Rank displays
- [ ] If top 3, message input appears
- [ ] Message saves correctly
- [ ] Leaderboard displays
- [ ] "Play Again" works
- [ ] "Change Quarter" returns to level select

---

## Step 8.2: API Endpoint Tests

**Browser Console Tests (F12):**

```javascript
// Test 1: Get levels
(async () => {
  const res = await fetch('/api/games/pipeline-catcher/levels');
  const data = await res.json();
  console.log('Levels:', data);
  console.assert(data.levels?.length > 0, 'Should have levels');
})();

// Test 2: Get game data
(async () => {
  const res = await fetch('/api/games/pipeline-catcher/play/2025-Q1');
  const data = await res.json();
  console.log('Game Data:', data);
  console.assert(data.data?.sqos?.length > 0, 'Should have SQOs');
})();

// Test 3: Get leaderboard
(async () => {
  const res = await fetch('/api/games/pipeline-catcher/leaderboard?quarter=2025-Q1');
  const data = await res.json();
  console.log('Leaderboard:', data);
})();

// Test 4: Submit score
(async () => {
  const res = await fetch('/api/games/pipeline-catcher/leaderboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quarter: '2025-Q1',
      score: 50000000,
      advisorsCaught: 10,
      joinedCaught: 1,
      ghostsHit: 2,
      gameDuration: 180,
      message: 'Test score!'
    })
  });
  const data = await res.json();
  console.log('Submit Response:', data);
})();
```

---

## Step 8.3: Database Verification

**Cursor Prompt:**
```
Open Prisma Studio and verify the GameScore table:
npx prisma studio

Check that:
1. GameScore table exists
2. Scores are being saved with correct data
3. User relation works (userId links to User)
```

**SQL Query via BigQuery MCP (to verify game data queries):**
```sql
-- Verify SQO counts for available quarters
SELECT 
  FORMAT_DATE('%Y-Q%Q', DATE(Date_Became_SQO__c)) as quarter,
  COUNT(*) as sqo_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND DATE(Date_Became_SQO__c) >= '2025-01-01'
GROUP BY quarter
ORDER BY quarter DESC;
```

**Note**: All date fields in BigQuery are TIMESTAMP type, so we must wrap them with `DATE()` function when comparing to DATE strings or using FORMAT_DATE.

---

# PHASE 9: Final Polish & Deployment

## Step 9.1: Add Loading States & Error Handling

**Cursor Prompt:**
```
Review all game components and ensure:
1. All API calls have try/catch error handling
2. Loading states are shown during data fetches
3. Error messages are user-friendly
4. Network failures are handled gracefully
```

---

## Step 9.2: Mobile/Touch Support (Optional)

**Cursor Prompt:**
```
Add touch controls to GameCanvas.tsx for mobile players:
1. Add touch event listeners for left/right swipes
2. Add on-screen arrow buttons for touch devices
3. Detect touch device and show appropriate controls
```

---

## Step 9.3: Build Verification

**Cursor Prompt:**
```
Run a production build to ensure everything compiles:
npm run build

Check for:
1. No TypeScript errors
2. No build warnings
3. All pages generate successfully
```

---

## Step 9.4: Deploy to Vercel

**Manual Steps:**
1. Commit all changes to git
2. Push to your repository
3. Vercel will auto-deploy
4. Test on production URL

**Post-Deployment Verification:**
- [ ] Game loads on production
- [ ] Audio files load (check network tab)
- [ ] Background images load
- [ ] API endpoints work
- [ ] Scores save to Neon database
- [ ] Leaderboard displays correctly

---

# Summary of Files Created/Modified

## New Files Created:
```
src/types/game.ts
src/config/game-constants.ts
src/lib/queries/pipeline-catcher.ts
src/app/api/games/pipeline-catcher/levels/route.ts
src/app/api/games/pipeline-catcher/play/[quarter]/route.ts
src/app/api/games/pipeline-catcher/leaderboard/route.ts
src/components/games/pipeline-catcher/hooks/useGameAudio.ts
src/components/games/pipeline-catcher/LevelSelect.tsx
src/components/games/pipeline-catcher/GameCanvas.tsx
src/components/games/pipeline-catcher/GameOver.tsx
src/components/games/pipeline-catcher/PipelineCatcher.tsx
src/components/games/pipeline-catcher/index.ts
src/app/dashboard/games/pipeline-catcher/page.tsx
public/games/pipeline-catcher/audio/menu-music.mp3
public/games/pipeline-catcher/audio/gameplay-music.mp3
public/games/pipeline-catcher/audio/gameover-music.mp3
public/games/pipeline-catcher/images/lobby-bg.png
public/games/pipeline-catcher/images/savvy-logo.png
```

## Files Modified:
```
prisma/schema.prisma (add GameScore model)
src/lib/api-client.ts (add pipelineCatcherApi)
src/components/layout/Sidebar.tsx (add easter egg trigger)
```

---

# Troubleshooting Guide

## Common Issues:

### "Audio not playing"
- Browser requires user interaction before playing audio
- Check if muted
- Check browser console for autoplay policy errors

### "Game data not loading"
- Check BigQuery MCP connection
- Verify quarter format (YYYY-QN)
- Check API route console logs
- Verify DATE() wrapper is used on TIMESTAMP fields in queries
- Check that cachedQuery wrapper is applied correctly

### "Scores not saving"
- Verify Prisma migration ran (`npx prisma migrate dev`)
- Check Neon database connection (DATABASE_URL env var)
- Look for errors in API response
- Verify GameScore model was added to schema.prisma
- Check that User model has `gameScores GameScore[]` relation

### "Easter egg not working"
- Verify triple-click is fast enough (within 500ms)
- Check if useRouter is imported correctly
- Verify the component was added to Sidebar.tsx

### "Intense mode not triggering"
- Check time calculation (should be at 12 seconds remaining)
- Verify isIntenseMode state is being set

---

---

## Implementation Verification Checklist

After completing all phases, verify:

- [ ] All directories created successfully
- [ ] Audio files copied to public/games/pipeline-catcher/audio/
- [ ] Background image downloaded and logo copied
- [ ] Prisma schema updated with GameScore model
- [ ] Migration created and applied (`npx prisma migrate dev`)
- [ ] All TypeScript files compile without errors
- [ ] BigQuery queries tested and return data
- [ ] API routes respond correctly (test with browser console)
- [ ] Easter egg triple-click works in Sidebar
- [ ] Game page loads at /dashboard/games/pipeline-catcher
- [ ] Level select displays quarters correctly
- [ ] Game data loads for selected quarter
- [ ] Scores save to database
- [ ] Leaderboard displays correctly

**End of Implementation Plan**
