# Council Feedback — Step 5b-1-UI

> Codex (gpt-5.4) + Gemini (gemini-3.1-pro-preview) adversarial review of
> `exploration-results.md` + `agentic_implementation_guide.md`.
> Plus my own cross-checks against the actual codebase state.

---

## Critical Issues (will break build, cause data loss, or violate the spec)

### C1. Phase 4 SQL replaces — instead of extends — the existing `EvaluationDetail` shape
**Source:** Codex, confirmed by reading `src/types/call-intelligence.ts:28-59` + `src/lib/queries/call-intelligence-evaluations.ts:237-285`.

The current query uses these aliases/columns that the guide WOULD HAVE clobbered:
- `e.id AS evaluation_id` (not `e.id`)
- `cn.call_started_at` (requires `JOIN call_notes cn ON cn.id = e.call_note_id` — NOT in the guide)
- `e.assigned_manager_id_snapshot` (not `e.manager_id`)
- `mgr.full_name AS assigned_manager_full_name` (uses `reps.full_name`, not concat of first/last)
- `e.scheduled_reveal_at` (not `e.reveal_scheduled_for`)
- `e.revealed_at`, `e.reveal_override_action`, `e.reveal_override_delay_minutes`
- `e.reveal_policy_snapshot`, `e.reveal_delay_minutes_snapshot`, `e.reveal_reminder_minutes_snapshot` (NOT `e.reveal_policy`)
- `e.overall_score` (not `e.score AS overall_score`)
- `cn.summary_markdown AS call_summary_markdown`
- `sga.full_name AS rep_full_name`

Also: `reps.full_name` is the column in this DB; the guide's `NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), '')` was wrong. Use `editor.full_name` directly.

**Severity:** Critical — Phase 4 as written would break Step 5a-UI's queue, eval-detail, and reveal-actions wiring.

### C2. Phase 2 validation gate fails — Phase 2 imports a Phase 3 type
**Source:** Codex.

`src/components/call-intelligence/citation-helpers.ts` imports `Citation` from `@/types/call-intelligence`. That type isn't created until Phase 3. The Phase 2 gate runs `tsc` and would fail. The guide acknowledges this but the gate text is contradictory ("may emit Cannot find name" vs "Phase 2 done"). Should reorder so Phase 2 has no broken imports.

### C3. `collectChunkIds` walker is unsafe — picks up false positives
**Source:** Codex + Gemini concur.

The proposed condition `if (typeof obj.chunk_id === 'string' && obj.kb_source === undefined)` is wrong. KB sources sit AS siblings under `citation.kb_source`, not nested. The check would pick up any object anywhere in `ai_original` carrying a `chunk_id` string — even if it's not a citation. Also: no dedup. Fix: walk specifically into `citation.kb_source` shapes, validate the full kb_source key set, dedupe with a `Set`.

### C4. OCC freeze isn't actually shared across InlineEdit components
**Source:** Codex.

Each `InlineEdit*` component owns its own `isEditing`/`draft` state. A 409 in one editor cannot freeze the others without a shared parent prop. Fix: hoist a `mutationLock: { kind: 'idle' | 'pending' | 'conflict-pending-reload' | 'authority-lost' }` state into `EvalDetailClient`, propagate as a `disabled` prop into every InlineEdit\* component plus the reveal-action buttons.

### C5. Stale-version race around `expected_edit_version`
**Source:** Codex.

`handleEdit()` posts with `detail.edit_version` then `await load()`. During the refetch, other inline editors or the reveal-action buttons can submit using the pre-refresh `detail.edit_version` (existing pattern at `EvalDetailClient.tsx:201`). Same fix as C4: shared mutation lock that all editors and reveal actions respect.

### C6. Citations are destroyed on canonical edits
**Source:** Gemini.

`EditEvaluationRequest.narrative` validates as plain `string`. When a manager edits the narrative, the canonical row LOSES its citations array. Test `(g)` claims "citation persistence" but only on the immutable `ai_original` side — the canonical narrative goes citation-less after first edit. This is a product decision: (a) accept the loss + rely on audit toggle as historical lens, or (b) coordinate with sales-coaching to extend `EditEvaluationRequest` with `narrative_citations: Citation[]`.

**Routes to Bucket 2.**

### C7. Manager comment visibility is unguarded for reps
**Source:** Gemini.

The guide's GET `/transcript-comments` route filters only by page-20 RBAC. Reps assigned to page 20 (if any role accesses it that way) would see manager comments — including private notes like "Reps don't usually push back here". Need explicit role filter at the endpoint OR an explicit reveal-policy gate.

**Bucket 2 (need to confirm visibility model).**

### C8. CI byte-equality test (acceptance test `m`) doesn't work in CI
**Source:** Codex + Gemini concur.

The schema-mirror script reads from a sibling repo path. CI containers don't checkout sibling repos. The test as written either fails or skips via `SKIP_SCHEMA_MIRROR_CHECK=1` — i.e., the acceptance test cannot actually pass in production CI as designed.

**Routes to Bucket 2 (operations decision: vendored canonical, npm package, GH raw, submodule, or skip).**

### C9. Auto-redirect on Authority-Lost destroys local drafts
**Source:** Gemini.

`setTimeout(() => router.push(...), 1500)` after an authority-lost banner is too short; managers mid-paragraph lose work. Fix: replace setTimeout-driven redirect with an explicit "Return to queue" button. (Optionally also persist drafts to localStorage.)

---

## Should Fix (pattern drift, inconsistencies, latent bugs)

### S1. 404 dispatch is too generic
**Source:** Codex.

Throwing `EvaluationNotFoundError` for any 404 means `DELETE /transcript-comments/:id` and any future GETs misclassify. Fix: scope the 404 arm to paths matching `/evaluations/:id/`, otherwise throw `BridgeTransportError`.

### S2. Stale "context merge" note in Phase 5
**Source:** Codex (verified against current `index.ts:123` + `errors.ts:27`).

The bridge ALREADY merges `context.expectedEditVersion` into `EvaluationConflictError`. The guide's "tiny side-quest" wording in Phase 5 is misleading and should be removed.

### S3. `error.message.includes('Authority lost')` is brittle
**Source:** Codex + Gemini concur.

If sales-coaching changes the message text, the redirect logic silently regresses. Fix: defensively branch on the message but also log a warning when neither "Authority lost" nor a generic conflict pattern matches. Long-term: ask sales-coaching to add a `conflict_reason: 'stale_version' | 'authority_lost'` field. Track as Bucket 3 (out of scope for this PR).

### S4. NULL handling — actually safe (drop the worry)
**Source:** Codex correctly notes that `CONCAT()` ignores nulls in Postgres.

But this codebase uses `reps.full_name` (single column), not `first_name`/`last_name`. The guide's CONCAT was wrong altogether — use `editor.full_name` directly.

### S5. Settings tab link placement
**Source:** Codex.

Don't place the link inside the form's submit row; keep it in a separate section to avoid being confused with form action UI. The guide says "after the existing form" but should explicitly say "outside the submit row."

### S6. Pre-migration 024 fallback for `coaching_nudge`
**Source:** Gemini.

Evals before migration 024 have `evaluations.coaching_nudge = NULL`. Without a fallback, the canonical view shows no coaching nudge. Fix: in the canonical render, COALESCE to `ai_original.coachingNudge` when the column is null.

### S7. v2 JSONB UX — hide unavailable sections
**Source:** Gemini.

For v2 evals (5 known in production), missing `coachingNudge`, `additionalObservations`, and `repDeferrals` sections render as empty boxes. Fix: when a section's data is empty AND the schema version doesn't support it, hide the section entirely or show "Not evaluated in this AI version" in italics.

### S8. Inactive editor display
**Source:** Gemini.

If the editor has left the company (`reps.is_active = false`), showing their name implies they're still active. Fix: include `editor.is_active` in the SELECT, render "(inactive)" suffix when false.

### S9. Duplicate refinement dead-end
**Source:** Gemini.

The 409 toast says "track it on My Refinements" but the manager wanted to file ANOTHER suggestion. Fix: change the modal state to "You already have an open refinement for this text. [View / Edit Existing →]" — link to my-refinements page.

### S10. Type drift on `ai_original_schema_version`
**Source:** my cross-check.

Existing `EvaluationDetail.ai_original_schema_version: number | null`. The guide wrote it as `number`. Fix: keep nullable. AuditToggle should treat null as "unknown version" → fallback message.

### S11. RawDetailRow Omit list
**Source:** my cross-check.

Existing `RawDetailRow extends Omit<EvaluationDetail, 'overall_score'> { overall_score: number | string | null }`. The guide planned to extend the Omit with two new fields. Better: keep Omit on `'overall_score'` only, and assemble `transcript_comments` + `chunk_lookup` AFTER the spread — they aren't in `RawDetailRow` at all because the SQL doesn't return them.

---

## Design Questions (need human input — Bucket 2)

1. **Citation persistence on canonical edits** (C6).
   - **Option A:** Accept loss; the audit toggle is the historical lens.
   - **Option B:** Coordinate with sales-coaching to extend the request schema to accept `narrative_citations`/etc.
   - **Option C:** Auto-strip with a one-time confirmation modal.

2. **Comment visibility** (C7).
   - **Option A:** Managers + admins only. Reps never see manager comments.
   - **Option B:** Reps see comments only after eval is revealed.
   - **Option C:** Reps see all comments immediately.

3. **Authority-Lost UX** (C9).
   - **Option A:** Banner with "Return to queue" button.
   - **Option B:** Auto-redirect after 1.5s.
   - **Option C:** Banner + button + draft-to-localStorage save.

4. **CI schema mirror source** (C8).
   - **Option A:** Skip in CI; mark `(m)` "verified in dev only".
   - **Option B:** Vendor a snapshot file.
   - **Option C:** GitHub raw URL.
   - **Option D:** npm package.

5. **Audit toggle layout** (Gemini Q2).
   - **Option A:** Global side-by-side two-column.
   - **Option B:** Per-field "AI Original" popover.

6. **Citation pill display** (Gemini Q1).
   - **Option A:** Render every citation as a separate pill.
   - **Option B:** Group same-type pills.
   - **Option C:** Dedupe by `kb_source.chunk_id` + `utterance_index`.

7. **Refinement modal SLA copy** (Gemini Q4).
   - **Option A:** No expectation copy.
   - **Option B:** Add "RevOps reviews requests weekly" line.

8. **My Refinements scope** (Gemini Q5).
   - **Option A:** Self only.
   - **Option B:** Manager's team.

9. **Toast library decision** (carryover from exploration §8.1).
   - **Option A:** Inline banners only.
   - **Option B:** Add `sonner`.

10. **Mobile KB panel placement** (Gemini G4).
    - **Option A:** Bottom-sheet drawer overlay.
    - **Option B:** Append-in-place inside top eval panel (current plan; risks off-screen).

---

## Suggested Improvements (ranked by impact)

### High impact
- **I1.** Hoist mutation lock state to a single source in `EvalDetailClient`. Resolves C4 + C5 simultaneously.
- **I2.** localStorage draft preservation for narrative/list edits.
- **I3.** Comment deep-linking from a "comment trail" panel.

### Medium impact
- **I4.** Clamp citation pill rendering to a small `max` (e.g., 3 + "+N more").
- **I5.** Audit toggle "Compare differences" diff-highlight sub-mode.
- **I6.** Resilient conflict detection — coordinate with sales-coaching for `conflict_reason`.

### Low impact
- **I7.** Sub-field audit popover.
- **I8.** Status badge polish in My Refinements.

---

## Cross-Checks

1. ✅ All BigQuery field names — N/A (no BQ in this feature).
2. ⚠️ All TypeScript interface changes — found drift on `EvaluationDetail` (existing field set is richer than the guide assumed). Resolved in Bucket 1 fixes.
3. ✅ All SQL uses `$N` parameterized — confirmed no string interpolation.
4. ✅ Sheets export — N/A (this feature has no CSV export).
5. ✅ Duration penalty math — N/A (not a forecast feature).
6. ⚠️ Existing query field names: `reps.full_name`, `assigned_manager_id_snapshot`, `cn.summary_markdown AS call_summary_markdown`. Resolved in Bucket 1.
7. ⚠️ Construction site count: TWO (DB helper + API route merge). The guide claimed one. Both intentional — clarify in the guide.

---

## Raw Responses

### Codex (gpt-5.4) — full text

```
## CRITICAL ISSUES (will break build, cause data loss, or violate the spec)

- Phase 4's `getEvaluationDetail()` plan does not preserve the current Step 5a contract. The live `EvaluationDetail` shape still includes `evaluation_id`, `call_started_at`, `assigned_manager_id_snapshot`, `assigned_manager_full_name`, `reveal_override_action`, `reveal_override_delay_minutes`, `reveal_policy_snapshot`, `reveal_delay_minutes_snapshot`, `reveal_reminder_minutes_snapshot`, `call_summary_markdown`, and `transcript`. The guide's SQL instead selects `e.id`, `e.manager_id`, `e.score AS overall_score`, `e.reveal_policy`, `e.reveal_scheduled_for` and drops multiple existing fields.

- The plan's "one construction site" claim is incomplete. The DB helper is one constructor today, but once `transcript_comments` and `chunk_lookup` are merged in the route, the API route becomes a second constructor. There is also an unchecked cast site in EvalDetailClient.tsx:175.

- The guide's Phase 2/Phase 3 ordering breaks its own validation gate. citation-helpers.ts imports Citation before it exists. That is a real compile error.

- The citation walker is unsafe. The proposed collectChunkIds() adds any object anywhere in ai_original with a string chunk_id unless that same object also has a kb_source key. The check is not enforcing "inside a KB citation"; it's just sweeping the whole tree for chunk_id. False positives + duplicates.

- The OCC "freeze until Reload" behavior is not actually implemented by the plan. Each InlineEdit* owns its own isEditing state; a 409 in one cannot freeze the others without a shared disabled prop.

- There is a real stale-version race around expected_edit_version. handleEdit() posts with detail.edit_version then await load(); during the refetch other editors can submit using the pre-refresh edit_version.

## SHOULD FIX

- Generic 404 arm misclassifies non-evaluation 404s. The bridge already merges context into EvaluationConflictError today; the guide's "side-quest" note is stale. Branching on error.message.includes('Authority lost') is brittle. NULL CONCAT is actually safe in Postgres. Returning 404 from the PATCH route is safe. Settings-tab link should sit outside the submit row. check:schema-mirror is not CI-safe.

## DESIGN QUESTIONS

1. Real conflict_reason discriminator from upstream?
2. Resource-specific 404s vs catch-all?
3. Where should schema-mirror truth live for CI?

## SUGGESTED IMPROVEMENTS

1. Rewrite Phase 4 around "preserve Step 5a shape, then add Step 5b fields."
2. Replace generic 404/409 heuristics with structured bridge errors.
3. Make edit locking global in EvalDetailClient.
4. Tighten citation extraction to walk only citation.kb_source objects, dedupe with Set.
```

### Gemini (gemini-3.1-pro-preview) — full text

```
## CRITICAL ISSUES

1. Citation Destruction on Canonical Edit: EditEvaluationRequest.narrative is plain string; citations are wiped on save. Fix: extend request schema with narrative_citations array OR support markdown with embedded citations.

2. Accidental Exposure of Manager Comments: GET /transcript-comments must enforce role-based visibility. Reps must not see "Reps don't usually push back here" comments. Need RLS or strict endpoint filter.

3. Data Loss via OCC/Authority-Lost Interrupts: 1.5s auto-redirect destroys unsaved drafts. Show modal instead: "Authority reassigned to [Name]. You have unsaved changes. [Copy my notes to clipboard] | [Return to Queue]".

4. Broken Mobile Layout for KB Panel: Stacked layout + KB panel inside top pane = off-screen render. Use Bottom Sheet overlay on mobile.

5. CI Schema Drift Test Failure: Sibling-repo path doesn't work in containerized CI. Fix: published npm package, API endpoint, or GitHub raw file.

## SHOULD FIX

1. Duplicate Refinement Dead End → "View / Edit Existing Request" CTA.
2. Pre-Migration 024 Canonical Fallbacks → COALESCE(canonical.coaching_nudge, ai_original.coachingNudge).
3. V2 JSONB Schema Rendering UX → hide missing sections or show "Not evaluated in this AI version".
4. Inactive Editor Confusion → "(inactive)" suffix when reps.is_active = false.
5. Phase 4 Missing Columns Verification → confirm reveal_policy/reveal_scheduled_for exist on evaluations.

## DESIGN QUESTIONS

1. Citation Clutter & Deduplication.
2. Audit Toggle Cognitive Load (diff/highlight vs static columns).
3. KB Owner Model (single text vs owners array).
4. Refinement Expectations (SLAs).
5. My Refinements Scope (self vs team).

## SUGGESTED IMPROVEMENTS

1. Auto-save / LocalStorage Drafts.
2. Audit Toggle Sub-Field Granularity (per-field popover).
3. Comment Deep-Linking back to transcript.
```
