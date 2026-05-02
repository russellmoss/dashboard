# Council Feedback — Kixie Call Transcription Pipeline

Generated: 2026-04-27. Plan reviewed: `docs/plans/2026-04-27-001-feat-kixie-call-transcription-pipeline-plan.md`. Raw responses in `docs/council-reviews/2026-04-27-{codex,gemini}-kixie-transcription.md`.

## Convergence: Issues Both Reviewers Independently Flagged

These have the highest signal — both Codex and Gemini caught them without coordination.

1. **Idempotency / state machine is broken.** `taskId` row existence as the dedup key means a partial row (transcript yes, notes no) is permanently skipped on retry. Need explicit `status` enum + retry tracking + retryable-failure semantics.

2. **Hallucinated verbatim numbers.** "Capture numbers verbatim" via prompt instruction alone is not enforceable. Need (a) `<quotes>` XML extraction step in the prompt before structured note generation, and (b) post-hoc numeric-verification: extract all numbers from transcript AND notes, flag any number in notes absent from transcript.

3. **Phase 1 ships dead UI for weeks.** Empty-state Notes section visible to users while Phase 2 is being built creates trust debt. Ship Phase 1+2 together behind a feature flag.

4. **No human-in-the-loop edit step before SFDC writeback.** SGAs will find errors. Without an editable surface in the dashboard before pushing to production CRM, they reject the tool entirely.

5. **Compliance / data-security blindspot.** Anthropic ZDR/Enterprise, AssemblyAI DPA, Kixie two-party consent on existing recordings, GCS bucket security baseline (IAM, UBLA, CMEK, lifecycle, audit). All assumed but none verified in the plan.

6. **`errorState` as freeform string.** Both demand an enum. Both also note the missing fields: `processingStartedAt`, `retryCount`, `lastAttemptAt`, `nextRetryAt`, `lastSuccessfulStage`.

## Critical Issues (will break shipping or burn money or violate compliance)

### From Codex (10 items)

C1. **Idempotency hole** — partial rows permanently skipped (Convergence #1).
C2. **Cost guard not concurrency-safe** — read-decide-spend isn't atomic. Two concurrent runs both pass the check and overspend.
C3. **Retry-storm exposure inside one call** — per-call cap doesn't protect against Claude retries inside a single attempt.
C4. **Cloud Run Job wrong primitive for resumable work** — Job crash mid-batch loses in-memory state; Service+Tasks/Pub-Sub better for thousands-of-items-with-retries shape.
C5. **Phase 3 SFDC writeback has no provenance/quality gate** — auto-push of AI text to production CRM with no model stamp, no AI-generated marker, no quality threshold.
C6. **GCS retention copy creates second PII store with no security design** — bucket IAM, UBLA, public-access prevention, CMEK, lifecycle, audit all undefined.
C7. **Prompt caching economics shaky for batch profile** — 5-min TTL may not cover serial run with AssemblyAI poll latency between calls; 1-hour TTL costs 2x write. No math justifying net-positive.
C8. **Two-step Claude is probably negative ROI** — at $0.005 + $0.02/call and 30% non-discovery skip rate at 1,300 calls/mo, savings are ~$7.80/mo. Engineering complexity dwarfs that.
C9. **No enforcement against fabricated numbers** (Convergence #2).
C10. **`Promise.all` masks partial-success** — if AssemblyAI succeeds and GCS fails, partial state is dropped. Use `Promise.allSettled`, persist each leg separately.

### From Gemini (6 items)

G1. **Compliance / vendor agreements** (Convergence #5). FINRA/SEC risk shipping prospect financials without ZDR/DPA/BAA.
G2. **Missing state machine / zombie jobs** (Convergence #1).
G3. **Diarization speaker inversion** — AssemblyAI gives "Speaker A/B" with no SGA-vs-Advisor knowledge. Without explicit identification step, an SGA can be credited with $25M AUM.
G4. **18-month Kixie cliff is active loss right now** — decouple GCS download from transcription. Run mp3-only download script TODAY for all 2,902 backfill candidates.
G5. **No HITL edit step** (Convergence #4).
G6. **Hallucinated verbatim numbers** (Convergence #2).

## Should-Fix (real but non-blocking)

S1. **`packages/analyst-bot` is Service shape, not Job** — copying its runtime assumptions without thinking is wrong (Codex).
S2. **Don't cargo-cult retry-on-400** — `analyst-bot/src/claude.ts` retries 400; that wastes money on invalid prompts (Codex).
S3. **Phase 1 standalone empty-UI ship** (Convergence #3).
S4. **Timezone sloppiness** — `07:00 UTC` is `03:00 EDT` on April 27 2026, not `02:00 EST` (Codex).
S5. **Monthly ceiling vs daily aggregate inconsistency** — requirements say monthly, design only has daily (Codex).
S6. **AssemblyAI SDK production warning waved away** — instrument and have a fallback path to direct REST (Codex).
S7. **`errorState` should be enum** (Convergence #6).
S8. **No transcript quality thresholds** — confidence, word-count, actual-duration, "insufficient quality" flag (Codex).
S9. **27% no-funnel-match not operationalized** — orphaned task UI bucket needed (both).
S10. **No rate-limit budget design** for AssemblyAI/Anthropic concurrency (Codex).
S11. **No prompt regression evaluation** — `promptVersion` is bookkeeping, not testing. Need eval framework (both).
S12. **Hardcoded model versioning** — schema needs `modelId` alongside `promptVersion` (Gemini).
S13. **Backfill cost-cap deadlock** — daily $30 cap + backfill = months. Needs separate budget (Gemini).
S14. **Markdown to SFDC Long Text Area renders badly** — verify field type or convert markdown→plain/HTML (Gemini).
S15. **`TranscriptionCostDaily` table is premature optimization** — use SUM aggregate query (Gemini).
S16. **Silence/hold-music handling** — prompt instruction needed to skip dead air (Gemini).

## Design Questions (need user input)

DQ1. **Discovery-only or all answered outbound?** If discovery-only is the real target, deterministic pre-filtering (duration, subject, owner) beats classifier-Claude. Need actual % of calls that are discovery.

DQ2. **Is GCS retention copy of raw audio required?** If yes, retention policy in days? If no, drop it and the security scope.

DQ3. **Resumable model: Service+Tasks vs Job?** Codex argues Service+Tasks for true work-item resumability. Adds complexity.

DQ4. **Auto-write to SFDC: gated, manual, or never?** Both reviewers strongly recommend gating behind manual approval initially.

DQ5. **9-section schema additions/edits?** Gemini suggests "Next Steps / Action Items" as section 10. Both ask if "Unprompted Questions" should be inline vs separate.

DQ6. **Markdown vs JSON output format?** Codex argues JSON-with-fields is safer than markdown for SFDC writeback and analytics.

DQ7. **<60s skip threshold defensible?** Both note long voicemails and short meaningful connects exist. False-negative rate acceptable?

DQ8. **HITL edit affordance scope** — full editable markdown? structured field-by-field edits? approve-as-is button?

DQ9. **The 6 open questions from /plan** — min duration, SFDC field name, daily cost caps, backfill scope, scheduler timing, GCS retention. Council partially answered but user must decide.

## Suggested Improvements (ranked by impact:effort)

I1. State machine + retryable eligibility — replaces "not in table" filter. (HIGH:LOW)
I2. Numeric verification post-processor — regex extract, flag mismatches. (HIGH:LOW)
I3. Speaker identification step in prompt — explicit SGA-vs-Advisor mapping. (HIGH:LOW)
I4. Cost-cap reservation model — atomic reserve-spend-reconcile. (HIGH:MED)
I5. Single-call Claude (drop classifier) — simpler, cheaper in total. (HIGH:LOW)
I6. Decouple mp3 download from transcription — preserve at-risk recordings TODAY. (HIGH:LOW)
I7. HITL edit step in dashboard — gates Phase 3 writeback. (HIGH:MED)
I8. GCS bucket security baseline spec — IAM, UBLA, CMEK, lifecycle. (HIGH:LOW)
I9. `<quotes>` extraction step in prompt — verbatim sentences before structured output. (HIGH:LOW)
I10. Compliance pre-flight gate (Phase 0) — verify Anthropic ZDR, AssemblyAI DPA, Kixie consent BEFORE pipeline ships. (CRITICAL:LOW)
I11. Prompt regression eval (Phase 4+) — Promptfoo/Braintrust with 20 ground-truth calls. (HIGH:MED, defer to v2)
I12. `modelId` + provenance marker in SFDC — track which model+prompt produced which row. (MED:LOW)

## Lead Cross-Checks

✅ All BQ field names cited in plan match data-verifier-findings.md.
✅ Single ActivityRecord construction site — plan handles correctly.
✅ All SQL examples use `@paramName` — no string interpolation.
⚠️ Plan Phase 3 Unit 3.2 says "JWT bearer flow recommended" but no JWT cert infrastructure exists today. Should be a unit, not a footnote.
⚠️ Test fixture for Unit 1.2 should COALESCE-test the NULL `REGEXP_EXTRACT` no-match case.
✅ Duration-penalty math (`computeAdjustedDeal()`) — irrelevant to this feature.
✅ CSV/Sheets export — correctly out of scope; notes are modal-only.

## Verdicts

**Codex:** Ship with fixes if you narrow scope and harden state management; otherwise this will silently skip recoverable failures, overshoot cost caps under concurrency, and write unverified AI text into production Salesforce.

**Gemini:** Redesign with fixes. Core vendor selection is fine, but pipeline lacks state management, has FINRA/PII compliance blindspot, Phase 1/3 rollout strategy will alienate sales team without HITL editing.

**Synthesis:** Both agree the architecture is fundamentally sound (Cloud Run + AssemblyAI + Claude + Postgres) but operational details — state machine, cost-cap, idempotency, compliance, HITL, hallucination guards — are underdesigned. None of this requires re-architecting; all of it requires writing. Apply the Bucket 1 fixes, get user input on Bucket 2, then /work can execute.
