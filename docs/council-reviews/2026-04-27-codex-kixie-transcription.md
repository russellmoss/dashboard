# Codex Adversarial Review — Kixie Call Transcription + AI Notes Pipeline

- **Date:** 2026-04-27
- **Model:** gpt-5.4 (via council-mcp `ask_codex`)
- **Review type:** Adversarial / red-team review of implementation plan
- **Plan reviewed:** `docs/plans/2026-04-27-001-feat-kixie-call-transcription-pipeline-plan.md`

---

## CRITICAL ISSUES (will break shipping or burn money or violate compliance)

1. `docs/plans/2026-04-27-001-feat-kixie-call-transcription-pipeline-plan.md` treats `taskId` row existence as idempotency, but Unit 2.2 says “not in `call_transcripts`” and Unit 2.7 says partial rows get written on failure. That means a row with `transcriptText` present and `notesMarkdown` null can be permanently skipped by the poller. Exact failure mode: Claude 529 after AssemblyAI success writes `errorState='NOTES_FAILED'`; next run excludes the task because the row exists; notes never recover unless an operator manually patches it.

2. The cost guard is not safe under concurrency. `TranscriptionCostDaily.upsert(... increment ...)` is only atomic for the increment, not for “read remaining budget, decide, then spend.” Two concurrent executions can both see `$12` remaining, both launch a `$9` call, and you spend `$18`. Add manual run + scheduled run and your cap is fiction. Same bug if Job task parallelism is increased later.

3. The plan underestimates Anthropic failure-cost exposure. “Per-call cap” based on estimated duration does nothing against retry storms inside one call. `packages/analyst-bot/src/claude.ts` retries 429/529 and even 400. If the new transcriber copies that pattern, one bad prompt/input can burn 2-4x the expected notes cost. Your guard checks before the call, not per API attempt.

4. Cloud Run Job is the wrong primitive if you care about resumability and observability of per-call failures. A Job crash mid-batch loses in-memory progress, then the next execution has to rediscover work from DB state, which your idempotency model currently does badly. Jobs are fine for bounded batch work; they are bad for “thousands of heterogeneous items with retries, backoff, and partial completion.” You rejected the Service/webhook path too quickly.

5. Phase 3 writeback is a compliance hole. You are planning to push AI-generated notes straight into production Salesforce `Task` records with no human review, no provenance flag, no model/version stamp in SFDC, no “AI-generated” marker in the field body, and no quality gate. Failure mode: hallucinated compensation/AUM/disclosure content lands in the CRM system of record and is treated as factual.

6. GCS retention copy plus public Kixie URL ingest creates a second PII store with no actual retention/security design. “GCS/Postgres defaults” is not a security plan. Missing: bucket IAM, UBLA, public access prevention, CMEK decision, lifecycle rule, object-level audit, and whether storing call audio longer than operationally necessary violates internal policy. This is not optional when you are duplicating call recordings.

7. Prompt caching economics are shaky. You quoted Sonnet prompt caching savings, but your run profile is `50–500` calls and you also expect AssemblyAI polling of ~minutes per call while processing in series. With a 5-minute TTL, later calls in the same run can miss cache unless the notes stage is dense enough. If you switch to 1-hour TTL you pay 2x write cost. The plan has no math showing this is net-positive over one combined call.

8. The two-step Claude design is probably negative ROI. You’re adding an extra network hop, extra retries, extra logging complexity, and extra failure modes to save maybe half a cent to two cents on non-discovery calls. Your own numbers are ~$0.005 classifier + ~$0.02 notes. At 1,300 calls/month, even saving notes on 30% of calls is roughly `$7.80/month`. That is not enough money to justify another model call on a production pipeline.

9. The 9-section schema has no enforcement against fabricated numbers. “Capture numbers verbatim” is not guaranteed by an LLM. Exact failure mode: transcript says “around 25 million maybe a bit less,” model outputs `Transferable AUM: $25M` as if exact. Once pushed to SFDC, that becomes false structured data with false precision.

10. `Promise.all` on AssemblyAI submit-by-URL + GCS upload is underspecified. If AssemblyAI succeeds and GCS copy fails, does the call proceed? If yes, you violated your own retention/audit requirement. If no, you wasted transcription spend and must retry only the GCS leg later. If both run inside one `Promise.all`, one rejection masks the other result unless you deliberately preserve it. This is classic partial-success sloppiness.

## SHOULD FIX (pattern drift, inconsistencies, real but non-blocking issues)

1. The plan keeps citing `packages/analyst-bot/` as the precedent, but that package is a Cloud Run Service shape, not a Job execution model. Reusing its Dockerfile and deploy script is fine; reusing its runtime assumptions is not.

2. `packages/analyst-bot/src/claude.ts` retries `400`. If you cargo-cult that, invalid prompt/request payloads will be retried pointlessly. That burns Anthropic money and run time.

3. Phase 1 shipping an empty Notes UI is probably trust debt. Users see dead chrome for weeks, assume the feature is fake, and stop checking it. “Real empty state is a real test” is product-theater, not value.

4. `07:00 UTC` is `03:00 EDT` on April 27, 2026, not `02:00 EST`. The plan already has timezone sloppiness. That is minor here, but it is exactly the kind of sloppiness that later causes scheduler misunderstandings.

5. The plan says “monthly spend ceiling” in requirements, but the schema/design only describes a daily aggregate table. That is inconsistent.

6. The AssemblyAI SDK warning is waved away too casually. “Not a Phase 2 v1 concern” is not analysis. If the SDK’s polling/wait wrapper is inefficient or leaky under 500-call backfill runs, you will discover it in production.

7. No dead-letter / quarantine state taxonomy. `errorState` is a string dumping ground. You need explicit retryable vs terminal states, retry count, lastAttemptAt, nextRetryAt, and source-of-failure fields.

8. No transcript quality thresholds. Diarization can fail, mp3s can be low quality, voicemails can still be >60s, and speaker attribution can flip. There is no `confidence`, `duration`, `words`, or “insufficient note quality” flag in `call_transcripts`.

9. The 73% `WhoId -> vw_funnel_master` join rate is not operationalized. Missing join means notes may not surface where users expect, and your observability only mentions it loosely.

10. “Activity API responds with notes within 200ms when present” is fantasy unless you verify query path cost after adding Prisma fan-in. The current UI path in [src/components/dashboard/ActivityTimeline.tsx](/C:/Users/russe/Documents/Dashboard/src/components/dashboard/ActivityTimeline.tsx:1) is simple; the API merge path can still become the slow point.

11. No rate-limit budget design for AssemblyAI or Anthropic. Sequential v1 hides it. The moment someone asks for speed and sets concurrency to 5 or 10, you can walk straight into 429s with no token-bucket control.

12. No regression plan for prompt changes beyond `promptVersion` storage. That is bookkeeping, not evaluation.

## DESIGN QUESTIONS (need human input — number each Q1, Q2, ...)

Q1. Is the actual business need “structured notes for discovery calls only” or “all answered outbound calls”? If discovery-only is the real target, stop classifying with Claude and use deterministic gating first: call duration, key phrases, owner/team, maybe subject metadata. Then only invoke the expensive note generator on likely-eligible calls.

Q2. Is retention copy of raw audio actually required? If not legally or operationally required, delete Unit 2.3 entirely. It adds storage cost, security scope, and incident surface for little product value.

Q3. If retention is required, what is the retention policy in exact days and who approved it? “Indefinite” is the wrong default for recorded calls.

Q4. Do you want resumable work items or a daily batch? If resumability matters, move to Cloud Run Service + Cloud Tasks or Pub/Sub and make each call its own retriable unit. If simplicity matters more, keep the Job but stop pretending it is robust.

Q5. Are AI notes allowed to auto-write into production Salesforce without human review? If yes, who signs off on that risk?

Q6. What exact states make a transcript retryable? Example: `TRANSCRIPTION_FAILED`, `NOTES_FAILED`, `SFDC_PUSH_FAILED`, `KIXIE_403`, `KIXIE_404`, `COST_CAP_SKIPPED`, `LOW_DURATION_SKIPPED`, `LOW_CONFIDENCE_REVIEW_REQUIRED`.

Q7. What percentage of calls are actually discovery calls? That number determines whether two-step Claude is justified. Without it, the cost argument is hand-waving.

Q8. Do you need the notes in markdown, JSON, or both? If SFDC is the downstream system of record, markdown is presentation, not structure. JSON with explicit fields is safer for validation and later analytics.

Q9. Is “skip <60s” really the right default? Long voicemail and short but meaningful connects both exist. If this is a hard filter, what false-negative rate is acceptable?

Q10. Are the mp3 URLs stable enough for delayed fetch? Public unauthenticated CloudFront URLs are convenient until they are not. If Kixie rotates behavior or hotlinking protection, your whole design degrades at once.

## SUGGESTED IMPROVEMENTS (ranked by impact:effort ratio)

1. Replace “not in `call_transcripts`” with stateful eligibility logic. Process rows where `notesMarkdown IS NULL AND retryable=true`, not just missing rows. Highest impact, low effort.

2. Add explicit work-state columns: `status`, `retryCount`, `lastAttemptAt`, `nextRetryAt`, `lastSuccessfulStage`, `providerRequestIds`. Without this, you cannot operate the pipeline.

3. Kill the classifier-first Claude call unless discovery-call incidence is low enough to save real money. One combined call is simpler and probably cheaper in total engineering cost.

4. If you keep two-step, make the first step deterministic where possible. Cheap heuristics before LLMs beat LLMs before LLMs.

5. Move cost-cap enforcement into a transactional reservation model. Reserve estimated cents before call start, reconcile actual after completion, release unused remainder. Otherwise caps are advisory only.

6. Use `Promise.allSettled` for GCS + AssemblyAI and persist each leg’s outcome separately. Do not let one rejection erase the state of the other.

7. Add numeric-verification post-processing. Extract all numbers from transcript and from notes; flag any note numbers absent from transcript before writeback. Crude regex is fine as v1 and catches the worst hallucinations.

8. Do not auto-push to SFDC initially. Gate Phase 3 behind manual review or at least a dashboard approval action until you have quality metrics.

9. Add prompt regression fixtures with scored assertions, not snapshots alone. Snapshots are too weak and too noisy. Assert section presence, character cap, and number consistency.

10. Drop Phase 1 standalone ship unless you can turn on real data within days. Otherwise merge Phase 1 and 2 behind a feature flag and avoid dead UI.

11. Add a provider abstraction now. Anthropic model deprecations and pricing changes are routine. Hardcoding Sonnet 4.6 everywhere is future churn.

12. For backfill, do not start at 500 calls/run blind. Start with 25, then 100, then 250 while measuring actual wall time, cache hit rate, 429s, and cost drift.

## VERDICT (1-2 sentence summary: ship as-is, ship with fixes, redesign needed)

Ship with fixes if you narrow scope and harden state management; otherwise this will silently skip recoverable failures, overshoot cost caps under concurrency, and write unverified AI text into production Salesforce. The current plan is overconfident on idempotency, underdesigned on operations/security, and probably overengineered on the two-step Claude path.
