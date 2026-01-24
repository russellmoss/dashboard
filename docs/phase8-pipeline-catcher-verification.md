# Phase 8: Pipeline Catcher – Testing & Verification

This document covers **Phase 8** of the Pipeline Catcher implementation: automated checks, manual testing checklist, API tests, and database verification.

**Quick reference:**

- `npm run verify:game` — file checks + BigQuery SQO verification
- `npm run verify:game:api` — same + API route checks (dev server must be running)
- `npm run build` — production build (requires network; stop dev server first if Prisma EPERM)

---

## 1. Automated Verification Script

Run the verification script from the project root:

```powershell
npm run verify:game
```

This checks:

- Required files and directories exist (types, config, queries, API routes, components, audio, images).
- BigQuery verification query (SQO counts by quarter). Requires `GCP_PROJECT_ID` and `GOOGLE_APPLICATION_CREDENTIALS` (or `GOOGLE_APPLICATION_CREDENTIALS_JSON`).

To also hit the game API routes (expect 401 when unauthenticated), start the dev server in another terminal, then:

```powershell
npm run verify:game:api
```

---

## 2. Build Verification

Ensure the project builds cleanly:

```powershell
npm run build
```

Verify:

- [ ] No TypeScript errors
- [ ] No build warnings
- [ ] All pages generate successfully

---

## 3. Manual Game Flow Checklist (Step 8.1)

Use this list while playing the game. Current setup: **2‑minute** game, **EOQ mode** in the **last 10 seconds**.

### Level Select

- [ ] Background image (lobby) visible
- [ ] Menu music plays
- [ ] All 5 quarters show with correct stats (SQOs, Joined, Total AUM)
- [ ] QTD quarter has “QTD” badge
- [ ] High scores show when available
- [ ] **View leaderboard** opens modal per quarter
- [ ] Mute button works
- [ ] Exit button returns to dashboard
- [ ] **Play** starts the game for selected quarter

### Gameplay

- [ ] Background image visible
- [ ] Gameplay music plays
- [ ] Player moves with **← →** and **A / D**
- [ ] Savvy logo on catcher
- [ ] **SQOs** fall (💼, green/teal, names + $XXM below)
- [ ] **Joined** fall (⭐, gold, “JOINED!” below)
- [ ] **Ghosts** fall (👻, red, “NO RESPONSE” below)
- [ ] **Stop signs** fall (✋, red, “DO NOT CALL” below)
- [ ] Catching SQO adds AUM to score
- [ ] Catching Joined adds 1.5× AUM
- [ ] Hitting ghost or stop sign: lose life, −$5M
- [ ] Score, lives (❤️/🖤), and timer display correctly
- [ ] Timer counts down from **2:00**
- [ ] **EOQ mode** in last **10 seconds**:
  - [ ] Red tint + “EOQ MODE”
  - [ ] Objects fall faster
  - [ ] Spawn rate increases
- [ ] Game ends at 0:00 (or when lives = 0)

### Game Over

- [ ] Game over music plays
- [ ] Final score and stats (advisors caught, joined caught, ghosts hit)
- [ ] Rank displayed
- [ ] Top 3: message input appears; message saves
- [ ] Leaderboard shows; full messages visible
- [ ] **Play Again** restarts same quarter
- [ ] **Change Quarter** returns to level select

---

## 4. API Endpoint Tests (Step 8.2)

**Prerequisite:** Log in to the dashboard, then open DevTools (F12) → Console.

### 4.1 Get levels

```javascript
const r = await fetch('/api/games/pipeline-catcher/levels', { credentials: 'include' });
const d = await r.json();
console.log('Levels status:', r.status, d);
console.assert(d.levels?.length > 0, 'Should have levels');
```

### 4.2 Get game data

```javascript
const r = await fetch('/api/games/pipeline-catcher/play/2025-Q1', { credentials: 'include' });
const d = await r.json();
console.log('Game data status:', r.status, d);
console.assert(d.data?.sqos?.length >= 0, 'Should have game data');
```

### 4.3 Get leaderboard

```javascript
const r = await fetch('/api/games/pipeline-catcher/leaderboard?quarter=2025-Q1', { credentials: 'include' });
const d = await r.json();
console.log('Leaderboard status:', r.status, d);
```

### 4.4 Submit score (optional)

```javascript
const r = await fetch('/api/games/pipeline-catcher/leaderboard', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    quarter: '2025-Q1',
    score: 50000000,
    advisorsCaught: 10,
    joinedCaught: 1,
    ghostsHit: 2,
    gameDuration: 120,
    message: 'Phase 8 test'
  })
});
const d = await r.json();
console.log('Submit status:', r.status, d);
```

---

## 5. Database Verification (Step 8.3)

### 5.1 Prisma Studio – GameScore table

```powershell
npx prisma studio
```

Confirm:

- [ ] `GameScore` table exists
- [ ] Columns: `id`, `userId`, `score`, `advisorsCaught`, `joinedCaught`, `ghostsHit`, `quarter`, `gameDuration`, `message`, `playedAt`
- [ ] Rows appear after playing and submitting scores
- [ ] `userId` links correctly to `User`

### 5.2 BigQuery – SQO data for game levels

The verification script runs the same check. Manually, you can run in BigQuery:

```sql
SELECT
  FORMAT_DATE('%Y-Q%Q', DATE(Date_Became_SQO__c)) AS quarter,
  COUNT(*) AS sqo_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND DATE(Date_Became_SQO__c) >= '2025-01-01'
GROUP BY quarter
ORDER BY quarter DESC;
```

Expect one row per quarter with SQO data; counts should align with level select stats.

---

## 6. Easter Egg & Page Access

- [ ] **Direct:** `http://localhost:3000/dashboard/games/pipeline-catcher` shows level select (when logged in).
- [ ] **Easter egg:** Triple‑click “Savvy Wealth” in sidebar **or** “Savvy” in header → navigates to game.

---

## 7. Verification Results (Phase 8 run)

| Check | Status | Notes |
|-------|--------|--------|
| `npm run verify:game` | **Pass** | All 17 files OK; BigQuery returned 5 quarters (2025-Q1–2026-Q1) with SQO data |
| `npm run build` | **Manual** | Requires network (Google Fonts). Prisma generate can hit EPERM if dev server/Studio running—close them first |
| Manual game flow | — | Use checklist in §3 |
| API console tests | — | Use snippets in §4 (logged-in session) |
| Prisma Studio | — | Run `npx prisma studio` and confirm GameScore |
| BigQuery SQO query | **Pass** | Run via `npm run verify:game` or SQL in §5.2 |

---

## 8. Troubleshooting

- **Audio not playing:** Ensure you’ve interacted with the page (click/focus). Check mute and autoplay policy.
- **Levels/leaderboard 401:** Log in first; use `credentials: 'include'` for fetch.
- **BigQuery script fails:** Set `GCP_PROJECT_ID` and `GOOGLE_APPLICATION_CREDENTIALS` (or JSON creds). See `scripts/verify-pipeline-catcher.js`.
- **GameScore missing:** Run Prisma migrations and confirm `GameScore` exists in Neon.
