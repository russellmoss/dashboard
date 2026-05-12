# Call Intelligence — Current State & Enhancement Plan

**Author:** Russell Moss
**Date:** 2026-05-12
**Status:** Discovery doc — not yet a build plan
**Scope:** Dashboard `/dashboard/call-intelligence/*` surfaces + the upstream sales-coaching eval pipeline

---

## Part 1 — What exists today (consumer-facing)

The Call Intelligence section lives at `src/app/dashboard/call-intelligence/` and is rendered by `CallIntelligenceClient.tsx`. Access is gated by `allowedPages.includes(20)`. Sub-tabs are role-gated: managers/admins see Insights and Rubrics; revops_admin and admin see Cost Analysis and Coaching Usage.

### 1.1 Queue tab — the evaluation workbench

**File:** `src/app/dashboard/call-intelligence/tabs/QueueTab.tsx`
**API:** `GET /api/call-intelligence/queue?status=[pending|revealed|all]` (60s cache)

The queue is the home screen for SGMs and reviewers. It lists call evaluations that the AI has produced and that need (or have had) human review.

- Columns: Date, Time, Rep (SGA), Manager (SGM), Advisor, Reviewer, Status, Edit Version, Scheduled Reveal, Call ID.
- Filters: Pending / Revealed / All; fuzzy multi-token search by rep or advisor name; sortable by any column.
- Role-aware framing: SGM/SGA users see "My Evaluations" (their own coachee-view rows); managers/admins see the team queue.
- The "scheduled reveal" timestamp is when the AI feedback becomes visible to the rep — the SGM's window to edit before the rep sees it.

The unit of work here is **the call**, not the deal. That is a structural limitation we will address in Part 2.

### 1.2 Call detail / Note Review — individual call workbench

**File:** `src/app/dashboard/call-intelligence/review/[callNoteId]/page.tsx` + `NoteReviewClient.tsx`

Opening a queue row routes to a full-page note review (not a modal). It shows:

- Advisor name/email, Rep (SGA), Manager (SGM), call date, source (Granola or Kixie).
- Funnel-status checkboxes: SQL, SQO, Closed Lost, Pushed to SFDC.
- AI Feedback / Manager Edit toggles.
- Tabs: Summary, AI notes (markdown), coaching feedback, transcript.
- An **SFDC search** input (`NoteReviewClient.tsx:30–38`) that accepts a Salesforce URL, 15/18-char ID, CRD, email, or name and resolves to Contact / Lead / Opportunity. This is the only place a call is currently linked to SFDC.
- Save-on-blur editor with 800ms debounce and 409-conflict detection.

### 1.3 Insights tab — the heatmap + drill-down stack

**File:** `src/app/dashboard/call-intelligence/tabs/InsightsTab.tsx`

A three-layer modal stack drills from team-level patterns into a single utterance. Filters across all layers: rep focus, date range (7d / 30d / 90d / custom), role (SGA / SGM), and a "source" sweep selector (see §1.6).

- **Layer 0 (heatmap):** Dimension scores (1–4 scale, color-coded) sliced by role / rubric / pod / lead. Pulls from `GET /api/call-intelligence/insights/evals`.
- **Layer 1 (eval list):** Click a heatmap cell to see the underlying calls.
- **Layer 2 (eval detail, `EvalDetailClient.tsx`):** The full evaluation with **per-dimension AI body** (schema v6, lines 99–101). The body is a 2–3 sentence rationale explaining why this call earned this dimension score — example: *"At [47] the rep pivoted to fees without confirming the client's risk tolerance, scoring Competent rather than Exemplary."*
- **Layer 3 (transcript):** Utterances with timestamps, citations highlighted.

The InsightsTab also surfaces **knowledge-gap clusters** — buckets of unsubstantiated claims grouped by `expected_source` KB path prefix, with sample evidence and per-rep counts.

### 1.4 Coaching Usage tab — RevOps consumption view

**File:** `src/app/dashboard/call-intelligence/tabs/CoachingUsageTab.tsx`
**API:** `GET /api/admin/coaching-usage?range=[7d|30d|90d|all]` (5-min cache)
**Visibility:** RevOps Admin only.

This is the "is anyone actually using this?" surface. Table of advisor-facing calls with: Date, Advisor, SGA, SGM, Stage (SFDC opportunity), SQL/SQO, Closed Lost, Pushed to SFDC, AI Feedback, Manager Edit.

KPIs across the top: active coaching users (distinct rep IDs), total advisor calls, push-to-SFDC %, AI feedback %, manager-edit %.

The recent **"Contact-Account-best-opp arm + likely-Opp backfill"** work (`/api/admin/coaching-usage/route.ts:56`) is the linkage logic that lets us tag a Granola call with its SFDC opportunity even when the SGM never pushed the note — it falls back through Contact → Account → best-open-Opp arms to find the most likely deal. **This is the seed for the opportunity rollup work in Part 2.**

### 1.5 Rubrics tab — the scorecard editor

**File:** `src/app/dashboard/call-intelligence/tabs/RubricsTab.tsx`
**API:** `GET /api/call-intelligence/rubrics`

Lists rubric versions (draft / active / archived) per role (SGA / SGM). Each row shows version, name, status, created date/author, and view / edit / delete buttons. Drafts are always deletable; archived rubrics are deletable if no evaluation references exist; active rubrics are read-only. System rubrics (`created_by_is_system=true`) are read-only.

A rubric is an array of **dimensions**. Each dimension is a slug (e.g. `discovery`, `objection_handling`), an `order`, and four `levels` (`'1'` through `'4'`) each with a 1–2000 char descriptor. The model scores each dimension 1–4 and provides per-dimension citations + body text.

### 1.6 Cost Analysis tab — AI spend per advisor call

**File:** `src/app/dashboard/call-intelligence/tabs/CostAnalysisTab.tsx`
**API:** `GET /api/call-intelligence/cost-analysis?start_date=&end_date=`
**Visibility:** Admin only.

Time-series area chart (daily spend in micro-USD vs API call count) plus a by-feature breakdown table. Presets: month-to-date (default), last 7/30/90 days, custom range. Recent build added "total AI spend + $/advisor call" as the headline KPIs.

---

## Part 2 — How AI evaluation works (the rubric + RAG pipeline)

### 2.1 Where the work happens

**Triggers and eval execution live in sales-coaching, not Dashboard.** When a transcript lands (Granola or Kixie), the upstream service runs Claude Sonnet with the active rubric and a pre-retrieved KB context window. The result is written to `evaluations.ai_original` (JSONB) in the coaching DB.

Dashboard is read-side only. The bridge client (`src/lib/sales-coaching-client/`) provides typed access; `GET /api/call-intelligence/evaluations/[id]` walks `ai_original` plus canonical edit columns (`dimension_scores`, `rep_deferrals`, `knowledge_gaps`, `strengths`, `weaknesses`, `additional_observations`) and hydrates citations for the UI.

### 2.2 What the model produces

For each call the model emits:

| Field | What it is |
|---|---|
| `dimension_scores[dim]` | 1–4 integer + citations + (v6+) a 2–3 sentence `body` rationale |
| `knowledge_gaps[]` | Topics the rep asserted without supporting evidence; each gap has `text`, `citations`, and an optional `expected_source` KB path |
| `rep_deferrals[]` | Direct quotes where the rep handed a question off ("let me connect you with compliance"); tagged with `topic`, `deferral_text`, `citations`, and `kb_coverage` (covered / partial / missing) |
| `strengths` / `weaknesses` / `additional_observations` | Free-text observations with citations |

**Knowledge gap vs deferral** is a critical distinction: a gap is an *unsubstantiated claim* (the rep said something they couldn't back up); a deferral is an *explicit handoff* (the rep punted to another team). Both are surfaced in the Insights sweep selector.

### 2.3 The RAG pattern — pre-indexed, cite-on-eval, hydrate-on-view

- **Pre-indexed KB** (Neon table `knowledge_base_chunks`): each chunk has `id` (UUID PK), `body_text`, `topics[]`, `owner`, `doc_id`, `drive_url`, `doc_title`, `is_active`. The KB is owned and indexed upstream in sales-coaching (synced from Google Drive).
- **Cite-on-eval:** during evaluation, retrieved chunks are passed into the prompt; the model embeds `kb_source` references (`chunk_id`, `doc_id`, `drive_url`, `doc_title`) inside each citation it produces.
- **Hydrate-on-view:** when Dashboard renders an eval, the API route walks the full JSONB tree, collects unique `chunk_id`s, and calls `getKbChunksByIds()` to fetch chunk text from `knowledge_base_chunks`. Returned as `chunk_lookup` so the UI can inline the chunk content next to the citation.

There is no real-time retrieval at view time. Citations are baked at eval time; the UI just resolves them.

### 2.4 Sweep types (Insights filter)

The "source" filter in Insights is a `InsightsSourceFilter` enum:

- `all` — gaps + deferrals
- `gaps_only` — unsubstantiated claims only
- `deferrals_only` — explicit handoffs only
- `deferrals_kb_missing` — handoffs where the KB has no coverage (KB roadmap signal)
- `deferrals_kb_covered` — handoffs where the KB *does* cover it (training / enablement signal)

`deferrals_kb_missing` is the most actionable cut — it directly tells the content team what's missing.

---

## Part 3 — What's wrong with the current model

Three structural gaps make the existing surfaces less useful than they could be.

1. **The unit of work is the call, not the deal.** Every page indexes on a single call. There is no place to see an advisor's full conversation arc — every Granola call + every Kixie call + every SFDC stage change — in one timeline. Risk and momentum only become meaningful when stacked across multiple calls.
2. **No cross-call search.** Every insight in the product is pre-computed (heatmaps, gap clusters, sweep filters). The long-tail questions — "every call in the last 90 days where an advisor named [competitor RIA]," "how are SGMs responding to comp objections this quarter" — are unanswerable without writing SQL.
3. **No clip library.** The eval pipeline already detects objections, deferrals, and KB gaps. The 30-second transcript window around each hit is the single most valuable training asset in the product, and there's nowhere to surface, tag, or share it.

There's also a soft gap: **orphaned Granola calls** (an SGM never pushes the call to SFDC) currently live in the coaching DB but disappear from any opportunity-level view. The Coaching Usage tab partially addresses this with the Contact-Account-best-opp linkage arms, but there's no "needs linking" inbox where an SGM can quickly attach orphans.

---

## Part 4 — Enhancement plan

### 4.1 Reframe risk + positive as a unified "signal" model

Stop building risk and positive as two parallel features. A signal is a single record with:

- **direction:** risk | momentum
- **confidence:** 0–1 from the extractor
- **source:** transcript | activity | stage_age | sfdc_event
- **decay:** how the signal weakens over time (a 30-day-old objection means less than a fresh one)
- **citation:** call_id + utterance_index *or* SFDC event ID

Signals stack on the **opportunity**, not the call. The same opportunity can have a "comp objection" risk signal from call 1 and a "transition logistics question" momentum signal from call 3 — and the deal view shows both with timestamps.

**Risk signals** (only fire post-discovery — pre-discovery noise drowns the signal):

- Verbal hesitation patterns: "let me think," "talk to my partner," "not the right time"
- Unresolved comp / payout / equity objection
- Compliance or regulatory concern raised
- No SGM-confirmed next step at end of call
- Time-in-stage exceeds stage benchmark
- Missed or declined meeting (activity signal, not transcript)
- Re-emergence of a competitor mention after it was previously addressed

**Momentum signals** (lean into these — advisors usually go silent rather than push back, so "hot" is more useful than "stalling"):

- Asks about transition logistics, tech stack, or onboarding timeline
- Asks about contract specifics or legal review
- Brings spouse or partner into a call
- Proposes a start date or specific next step
- Sends docs proactively (ADV, book details)
- Asks comp questions in a "negotiating" frame, not an "objecting" frame

The objection-vs-negotiating distinction is subtle and LLM-grounded — exactly what the existing eval pipeline is good at. Extend the upstream sweep prompt to emit a `signals[]` array alongside `dimension_scores` and `knowledge_gaps`.

### 4.2 The four surfaces (priority-ordered)

#### Surface 1 — Opportunity page (new — unblocks everything else)

Route: `/dashboard/call-intelligence/opportunity/[opportunityId]`

- Header: advisor name, current SFDC stage, days in stage, last contact date, assigned SGM/SGA.
- Timeline: every Granola call + every Kixie call + every SFDC stage transition + every Wrike task, on one vertical axis.
- Signal density visualization: green dots for momentum, red for risk, sized by confidence.
- AI-generated "deal state" paragraph: signals composed into prose. ("Strong momentum on transition logistics in the last two calls; one unresolved equity objection from call 1 is still open.")
- One suggested next action.
- A linked-calls sidebar showing every call attached to this opportunity, with click-through to the existing call detail page.

This is the prerequisite for everything else. Until calls roll up to opportunities, signal extraction is just per-call metadata that nobody can act on.

#### Surface 2 — Hot list / Risk list (replaces "deal board" thinking)

Two ranked queues for SGMs, side-by-side:

- **Leaning in:** opportunities with momentum signals in the last 14 days and no scheduled next step. Sort by signal recency × confidence.
- **Slipping:** opportunities with stacking risk signals or time-in-stage breach. Sort by risk signal density.

This is where missed-meeting signals show up — at the opportunity level, not the call level. Orphaned Granola calls (no SFDC linkage) appear in a third "Needs linking" inbox at the top.

#### Surface 3 — Extend Call Detail with a Signals strip

On the existing call detail page, add a Signals strip above the rubric:

- Risk badges on the left, momentum badges on the right.
- Each badge is clickable and jumps to the cited utterance in the transcript.
- A "clip this" action on transcript selections auto-suggests a theme tag (objection / deferral / momentum subtype) and queues the 30-second window for the clip library.

#### Surface 4 — Team view (extend existing Insights)

Keep the heatmap. Add:

- Top objections this period (cluster the comp / equity / book-ownership objections by frequency).
- Top KB gaps surfaced (already partially there via `deferrals_kb_missing`; promote it to a top-level card — this drives the KB roadmap).
- Momentum signal volume as a leading indicator for next quarter's joins.

### 4.3 Auto-clustered clip library

The eval pipeline already detects every objection, deferral, and KB gap with citations. Auto-cluster the 30-second windows around each hit by theme (e.g. "I don't want to give up my book," "what about my existing payout?"). Managers can promote clusters or individual clips to a **Gold Standard** library.

This is the differentiator vs. Gong's manual library — the clustering is automatic because the upstream evaluator already structures the data.

New SGA onboarding shifts from "shadow live calls" to "listen to the top 5 ways Steven handles 'I don't want to give up my book.'"

### 4.4 Cross-call search + corpus-level Ask

Highest-ROI gap in the long run. Two surfaces:

- **Search bar at the top of the Call Intelligence section.** Lexical first ("every call mentioning [competitor RIA]"), then semantic on transcripts and AI bodies.
- **A dedicated `/dashboard/call-intelligence/ask` surface.** Free-text questions over the full eval corpus: "How are SGMs responding to comp objections this quarter?" "Which advisors mentioned equity vesting in Q1?" Powered by the same RAG pattern as the eval pipeline — retrieve the relevant evaluations / transcript chunks, ground the answer in citations back to specific calls.

This unlocks RevOps and leadership use cases that the pre-computed sweeps can never cover.

### 4.5 What we are NOT building

- **Talk:listen ratio.** This is a B2B discovery-call metric and matters much less for recruiting conversations where the SGM is *supposed* to talk a lot (pitching Savvy's value prop). If we want an SGM quality metric, "question-to-pitch ratio in the first 10 minutes" is more meaningful — but it's a v2 question, not v1.

---

## Part 5 — Build order

1. **Opportunity rollup.** Extend the Contact-Account-best-opp linkage arms (already partially built for Coaching Usage) into a real `opportunity_call_links` table. Build the opportunity detail page. Add the "needs linking" inbox.
2. **Signal extraction.** Extend the upstream sweep prompt to emit a `signals[]` array with direction, confidence, source, decay, citation. Backfill historical evals (offline script, same pattern as schema v6 body backfill).
3. **Hot list / Risk list / Signals strip.** Three UIs on top of the same `signals` table. Cheap once #1 and #2 are done.
4. **Auto-clustered clip library.** Cluster transcript windows around existing gap/deferral hits by theme. Add the "promote to Gold Standard" workflow.
5. **Cross-call search + Ask.** The hardest piece and the highest leverage. Do it last so the corpus is well-structured by then (signals + clips + opportunity links all make the retrieval cleaner).

---

## Open questions

- **Orphan home.** When an SGM doesn't push a Granola call to SFDC, where does it live in the IA? Current answer: nowhere visible. Proposed answer: "Needs linking" inbox at the top of the Hot list. Worth confirming with SGM leadership before building.
- **Signal extraction location.** Run signal extraction in the same upstream Claude call as the rubric eval (cheaper, atomic) or a separate downstream sweep (more iterable, easier to backfill)? Lean toward separate — signals will evolve faster than the rubric and need independent versioning.
- **Decay function.** Linear, exponential, or step? Probably exponential with a stage-aware half-life (a comp objection in Discovery decays faster than one in Negotiation).
- **Confidence threshold for surfacing.** What's the minimum confidence at which a signal shows up on the Hot list vs. only in the call detail Signals strip? Probably ~0.7 for list surfacing, all for detail view.
