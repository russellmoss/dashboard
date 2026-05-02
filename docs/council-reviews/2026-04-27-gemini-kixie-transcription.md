# Council Review — Kixie Call Transcription + AI Notes Pipeline

- **Date:** 2026-04-27
- **Reviewer:** Google Gemini (`gemini-3.1-pro-preview`)
- **Type:** Adversarial review (find business logic errors, data quality risks, product gaps, operational landmines)
- **Subject:** Kixie call transcription + AI-generated 9-section discovery note pipeline (AssemblyAI Universal-2 + Claude Sonnet 4.6, 3-phase plan: Postgres `CallTranscript` table -> Cloud Run Job transcriber -> SFDC writeback)

---

Here is the ruthless, adversarial review of your Kixie + AI pipeline.

## CRITICAL ISSUES (will break shipping or burn money or violate compliance)

1. **Compliance & Vendor Zero-Retention Policies (FINRA/SEC Risk)**
   You are shipping highly sensitive prospect financials and client details to Anthropic and AssemblyAI. If you are using standard API tiers, your data might be subject to logging or model training. You *must* confirm Enterprise agreements with zero-data-retention (ZDR) and Business Associate Agreements (BAA) / Data Processing Agreements (DPA) are in place. Furthermore, ensure Kixie's baseline call recording respects two-party consent states; transcribing illegal recordings compounds the liability.
2. **Missing State Machine & Zombie Job Risk**
   The schema lacks a `status` enum (e.g., `PENDING`, `DOWNLOADING`, `TRANSCRIBING`, `GENERATING_NOTES`, `COMPLETED`, `FAILED`) and a `processingStartedAt` timestamp. Without these, your daily Cloud Run cron will crash on a timeout, fail silently, and you will have no way to distinguish an in-progress 45-minute call from a dead job.
3. **Diarization Speaker Inversion**
   AssemblyAI labels "Speaker A" and "Speaker B". It does not know who the SGA is. If you blindly map A/B to SGA/Advisor, you will write notes where the SGA is credited with having $25M in AUM.
   *Fix:* The Claude prompt *must* include a pre-processing step: *"Identify which speaker is the SGA (asking recruiting questions) and which is the Advisor (answering with their metrics). Map them, then write the notes."*
4. **Emergency Kixie Data Loss (The 18-month cliff)**
   If the Kixie 18-month deletion limit is real, you are actively losing transcripts every day you delay.
   *Fix:* Decouple the GCS MP3 download from the transcription. Run a script *today* to download all 2,902 backfill MP3s to your GCS bucket. Transcribe them at your leisure.
5. **No HITL (Human-In-The-Loop) / SGA Edit Step**
   Phase 3 pushes directly to Salesforce. SGAs *will* find hallucinations, missing nuances, or verbatim number errors. If they cannot edit the AI notes *before* they are locked into SFDC, they will reject the tool entirely.
   *Fix:* The dashboard must allow SGAs to edit the generated Markdown before it gets PATCH'd to Salesforce.
6. **Hallucinated "Verbatim" Numbers**
   LLMs are notoriously bad at retaining exact numeral formatting and context when summarizing. "$25M" becomes "$2.5M", or it conflates "fee-based" with "brokerage" revenue.
   *Fix:* Use Anthropic's XML prompting capability. Force Claude to output a `<quotes>` block extracting exact verbatim sentences containing numbers *before* it generates the final structured summary.

## SHOULD FIX (pattern drift, real but non-blocking issues)

1. **Hardcoded Model Versioning**
   "Sonnet 4.6" does not exist (it's 3.5 Sonnet). Regardless, Anthropic deprecates models. Your schema needs `modelId` (e.g., `claude-3-5-sonnet-20241022`) alongside `promptVersion`. When you migrate, you need to know which model generated which row to debug degradation.
2. **Phase 1 "Empty State" Rollout Plan**
   Shipping a UI with "AI notes not yet generated" for thousands of calls while waiting for Phase 2 is terrible product strategy. Users will look at it twice, assume the feature is broken vaporware, and never look at it again. Ship Phase 1 and 2 simultaneously.
3. **Backfill vs. Daily Cost Guard Deadlocks**
   Do not mix backfill processing with daily processing cost caps. If you have a $30/day limit, your daily run-rate (40 calls) will eat the cap, and your backfill will take 3 months to complete. Run the backfill as a separate standalone job with its own dedicated budget allocation.
4. **Error States are Strings**
   `errorState` should be an explicit Enum (`KIXIE_ARCHIVED`, `DOWNLOAD_FAILED`, `TRANSCRIPTION_FAILED`, `LLM_FAILED`, `COST_CAP`). Enforce this in Prisma. Free-text strings will make alerting and retries a nightmare.
5. **The 27% Funnel Unmapped Gap**
   73% match rate means >1,600 calls have no funnel context. For these, the SGA might not even be properly attributed. Your UI must explicitly bucket "Unmapped Prospects" so operators can manually link the `taskId` to a Prospect/Opportunity in Salesforce, otherwise, that data is orphaned.
6. **SFDC Custom Field Type Limitation**
   You are using Long Text Area (32K). If Claude outputs markdown (bolding, bullets), pushing raw markdown to SFDC looks like garbage unless the SFDC field is Rich Text, or you convert Markdown to HTML before the PATCH. Verify SFDC field type compatibility.

## DESIGN QUESTIONS (need human input — number each Q1, Q2, ...)

*   **Q1:** What is the actual definition of "Transferable AUM"? Is the SGA explicitly verifying non-solicit agreements on the call? If not, Claude is just guessing based on stated AUM. How should the AI flag "Stated vs. Legally Transferable"?
*   **Q2:** Does the 9-section schema need a "Next Steps / Action Items" section? SGMs usually care most about "What do I need to do on the follow-up call?"
*   **Q3:** What do SGMs actually want for "non-discovery" calls? (A full transcript summary, or just a 1-sentence disposition like "Rescheduled to Friday"?)
*   **Q4:** If an SGA spends 30 minutes complaining about their current firm (Catalyst/Pain), what is the threshold for truncation in the "What to Sell" section? Do we want a summary, or do we want the raw emotional quotes?
*   **Q5:** Who "owns" the SFDC record if the SGA and SGM disagree with the AI's assessment? What is the conflict resolution mechanism?

## SUGGESTED IMPROVEMENTS (ranked by impact:effort ratio)

1. **Add `CallType` and `CallDisposition` inference:** Since Kixie's `CallDisposition` is NULL, have Claude infer the disposition (e.g., `Voicemail`, `Gatekeeper`, `Not Interested`, `Discovery Completed`) as a distinct JSON field. Extremely high value for analytics. (High Impact / Low Effort)
2. **Prompt Regression Evaluation:** Set up a prompt eval framework (e.g., Promptfoo, Braintrust). Take 20 ground-truth calls, manually write the perfect notes, and diff them against Claude's output whenever you tweak the prompt. (High Impact / Med Effort)
3. **Silence/Hold Music Handling:** Add a system prompt instruction to Claude: *"Ignore extended hold music, automated system menus, or empty chatter at the beginning/end of the transcript."* (Med Impact / Low Effort)
4. **Drop the `TranscriptionCostDaily` table:** It's premature optimization. Just run an indexed `SUM(transcriptionCostCents)` on `CallTranscript` where `createdAt > CURRENT_DATE` in your Cloud Run job before starting. (Med Impact / Low Effort)
5. **Add "Advisor Questions" inline:** Unprompted questions shouldn't necessarily be an isolated Section 9. They are often best contextualized inside "Where to Dig" or "Move Mindset". Keep the schema flexible. (Low Impact / Low Effort)

## VERDICT
**Redesign with fixes.**
The core vendor selection (AssemblyAI + Claude) is highly cost-effective and accurate, but the pipeline lacks critical state management, presents a severe FINRA/PII compliance blindspot, and the Phase 1/3 rollout strategy will alienate your sales team by removing human-in-the-loop editing. Secure the MP3 backfill immediately, add HITL to the dashboard, and fix the Prisma schema state machine before writing a line of pipeline code.
