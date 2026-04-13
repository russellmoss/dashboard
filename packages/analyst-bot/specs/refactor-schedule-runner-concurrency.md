# Refactor Plan — Schedule Runner Concurrency & Async Dispatch

**Scope:** `packages/analyst-bot/src/schedule-runner.ts`, `packages/analyst-bot/src/schedule-store.ts`
**Estimated diff:** ~30 lines of app code + 1 SQL migration + 1 Cloud Run flag
**Trigger:** 2026-04-13 incident — duplicate delivery of the Weekly SGA report (one success DM + one quota-exceeded failure DM) caused by two parallel invocations of `/internal/run-schedules` finding the same row as "due".

---

## Problem 1 — No locking, concurrent invocations double-run

### Current behavior
`schedule-store.ts:268-275`
```ts
export async function getDueSchedules(): Promise<ScheduleRecord[]> {
  const result = await getPool().query(
    `SELECT * FROM bot_schedules
     WHERE is_active = TRUE AND next_run_at <= NOW()
     ORDER BY next_run_at ASC`
  );
  return result.rows.map(rowToSchedule);
}
```
`schedule-runner.ts:339-363` — serial for-loop, `markScheduleRun` only called AFTER each run completes. Gap between "row is due" and "next_run_at advanced" = full report runtime (multiple minutes). Any second invocation in that window picks up the same row.

### Observed failure (2026-04-13 12:41 UTC)
```
12:41:52.385Z  [cron] Schedule run complete: { ran: 1, succeeded: 1, failed: 0 }  ← run A (doc written, DM sent)
12:41:53.798Z  [google-docs] embedChartImage failed: Quota exceeded ...           ← run B mid-flight
12:41:54.545Z  [cron] Schedule run complete: { ran: 1, succeeded: 0, failed: 1 }  ← run B (user got failure DM)
```

### Fix — Atomic claim-on-read

Replace `getDueSchedules` with an `UPDATE … RETURNING` that advances `next_run_at` at the moment the row is claimed. Whoever wins the UPDATE gets the row; everyone else sees zero rows.

**`schedule-store.ts` — new function `claimDueSchedules`:**
```ts
/**
 * Atomically claim all due schedules. Advances next_run_at to the post-run
 * value in the same statement, so concurrent callers cannot double-claim.
 * On success, call markScheduleCompleted(id) to record last_run_at.
 * On crash mid-run, the schedule simply skips to its next cycle — matches
 * existing "failure advances anyway" semantics.
 */
export async function claimDueSchedules(): Promise<ScheduleRecord[]> {
  const result = await getPool().query(
    `UPDATE bot_schedules
       SET next_run_at = compute_next_run_at(frequency, deliver_at_hour, schedule_day, next_run_at)
     WHERE id IN (
       SELECT id FROM bot_schedules
        WHERE is_active = TRUE AND next_run_at <= NOW()
        FOR UPDATE SKIP LOCKED
     )
     RETURNING *`
  );
  return result.rows.map(rowToSchedule);
}
```

Two implementation paths for `compute_next_run_at`:

**Option A (preferred) — SQL helper function.** Port the JS `computeNextRunAt` logic to a Postgres function. Keeps the claim truly atomic in one round-trip.

**Option B (faster to ship) — Two-step claim.** If porting the date logic is painful, do it in a short transaction:
```ts
const client = await getPool().connect();
try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `SELECT * FROM bot_schedules
      WHERE is_active = TRUE AND next_run_at <= NOW()
      FOR UPDATE SKIP LOCKED`
  );
  for (const row of rows) {
    const next = computeNextRunAt(row.frequency, row.deliver_at_hour, row.schedule_day);
    await client.query(`UPDATE bot_schedules SET next_run_at = $1 WHERE id = $2`, [next, row.id]);
  }
  await client.query('COMMIT');
  return rows.map(rowToSchedule);
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```
`SKIP LOCKED` is the key primitive — second caller's `SELECT` skips rows locked by the first caller, returns empty set, no double-run.

**`schedule-runner.ts`:**
- Line 8: `import { getDueSchedules, markScheduleRun }` → `import { claimDueSchedules, markScheduleCompleted }`
- Line 342: `const due = await getDueSchedules();` → `const due = await claimDueSchedules();`
- Split `markScheduleRun` into two: `claimDueSchedules` advances `next_run_at` (done at claim time); `markScheduleCompleted(id, success: boolean)` updates `last_run_at` and `failure_count` only.

### Migration
No schema change needed for Option B. Option A adds one Postgres function:
```sql
CREATE OR REPLACE FUNCTION compute_next_run_at(
  freq TEXT, hour_or_min INT, day TEXT, from_ts TIMESTAMPTZ
) RETURNS TIMESTAMPTZ AS $$ ... $$ LANGUAGE plpgsql IMMUTABLE;
```

### Test plan
1. Unit: call `claimDueSchedules` twice in parallel against a test DB with one due row → second call returns `[]`.
2. Manual: `gcloud scheduler jobs run analyst-bot-run-schedules` twice in quick succession → logs show `ran: 1` once and `ran: 0` once, single DM delivered.
3. Crash recovery: kill the Cloud Run container mid-run → verify `next_run_at` is already advanced and row is not stuck (schedule just skips this cycle — acceptable).

---

## Problem 2 — Endpoint exceeds scheduler's 120s attemptDeadline

### Current behavior
`slack.ts:2050-2069` awaits `runDueSchedules(webClient)` synchronously before responding. Multi-section reports take 5-10+ minutes. Cloud Scheduler's `attemptDeadline: 120s` → scheduler logs 504 / timeout and (with `maxRetryDuration: 0s`) may retry, amplifying Problem 1.

### Fix — Fire-and-forget with CPU-always-on

**Step 1 — Cloud Run: enable CPU-always-allocated** so background work keeps executing after the HTTP response returns:
```bash
gcloud run services update savvy-analyst-bot \
  --project=savvy-gtm-analytics --region=us-east1 \
  --no-cpu-throttling
```
Cost impact: minimal on this workload (single-instance, low QPS, already provisioned). Alternative: wire up Cloud Tasks — better hygiene, but more infra.

**Step 2 — `slack.ts:2050` — return 202 immediately:**
```ts
receiver.router.post('/internal/run-schedules', async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // Respond immediately so Cloud Scheduler sees success within its 120s deadline.
  // Actual work runs in the background (requires --no-cpu-throttling on Cloud Run).
  res.status(202).json({ accepted: true });

  try {
    const { WebClient } = require('@slack/web-api');
    const webClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    const summary = await runDueSchedules(webClient);
    console.log(`[cron] Schedule run complete:`, summary);
  } catch (err) {
    console.error('[cron] run-schedules error:', (err as Error).message);
  }
});
```

### Test plan
1. `gcloud scheduler jobs run analyst-bot-run-schedules` → scheduler lastAttemptTime shows `status.code: 0` (success) within ~1s.
2. Logs show `[cron] Schedule run complete: …` 5-10 min later, after the HTTP 202 has already returned.
3. Scheduler dashboard: no more false-positive 504 failures.

---

## Rollout order

1. Deploy Problem 2 first (smaller, unlocks clean scheduler telemetry):
   - `--no-cpu-throttling` update to Cloud Run
   - Edit `slack.ts`, deploy
   - Verify clean scheduler success at next `:15` fire
2. Deploy Problem 1:
   - Add `claimDueSchedules` + split `markScheduleCompleted` in `schedule-store.ts`
   - Switch `schedule-runner.ts` to the new API
   - Deploy, verify via double-fire test

Order matters because Problem 2's fix removes the scheduler-driven retry loop that would otherwise mask Problem 1 during testing.

---

## What this does NOT change

- `bot_schedules` schema (for Option B). Option A adds one IMMUTABLE Postgres function only.
- Slack app surface, admin view, schedule CRUD APIs.
- `runSingleSchedule` internals (report generation, Google Docs calls, DM formatting).
- `CRON_SECRET` auth on the endpoint (already fixed 2026-04-13).

## Risks

- **Option A**: porting `computeNextRunAt` to SQL is mildly annoying (weekly/monthly day logic, month-end clamping). Test thoroughly against the existing JS behavior.
- **`--no-cpu-throttling`**: switches Cloud Run billing from request-based to instance-based. Validate cost on a staging instance for 24h before committing.
- **202 + background work**: if the container is scaled to zero and a new request comes in mid-run, the in-flight report may be killed. Mitigation: set `--min-instances=1` on `savvy-analyst-bot` (likely already the case; verify).
- **Behavioral change on crash mid-run**: with claim-on-read, a crashed run loses that cycle (next_run_at already advanced). Currently: also loses the cycle (markScheduleRun in catch block). So no regression — but worth noting in the PR description.
