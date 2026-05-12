# Council Feedback — Needs Linking Sub-Tab

**Generated:** 2026-05-12
**Reviewers:** Codex (GPT-5.4), Gemini (gemini-3.1-pro-preview)

---

## Critical Issues

### C1. Row Duplication via slack_review_messages JOIN (Gemini)
The `LEFT JOIN slack_review_messages srm ON srm.call_note_id = cn.id AND srm.surface = 'dm'` may produce duplicate `call_notes` rows if multiple `slack_review_messages` exist per call_note. Messaging/notification tables frequently have multiple records per parent. This would inflate the row count and show duplicates in the UI.
**Fix:** Use `LATERAL` with `LIMIT 1` or `DISTINCT ON (cn.id)`.

### C2. jsonb_array_elements on non-array JSONB (Gemini)
`jsonb_array_elements(cn.attendees)` will throw `ERROR: cannot extract elements from a scalar` if the JSONB value is null, a string, or an object instead of an array. While the data verifier confirmed all 585 rows have array-typed attendees, defensive coding is warranted for future data.
**Fix:** Wrap with `CASE WHEN jsonb_typeof(cn.attendees) = 'array' THEN cn.attendees ELSE '[]'::jsonb END`.

### C3. SGM Self-Inclusion in Visible Reps (Codex + Gemini)
`getRepIdsVisibleToActor()` may not include the actor's own rep ID for non-admin roles. If an SGM has pending call_notes of their own, those would be invisible. Need to verify whether `getRepIdsVisibleToActor()` includes self, and if not, union the actor's own ID.

## Should Fix

### S1. Missing advisor-call filter (Codex)
The existing coaching-usage route filters for advisor calls (`cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call'`). The needs-linking query omits this filter. Without it, the new tab surfaces a different universe of calls than the parent Coaching Usage view. Internal team calls, practice sessions, etc. would appear.
**Fix:** Add `AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')` to the WHERE clause.

### S2. returnTab validation (Codex)
Reading `returnTab` from search params and interpolating into `router.push()` without validation is fragile. An invalid tab value would cause broken navigation.
**Fix:** Validate against a known tab allowlist before using.

### S3. NoteReviewPage error fallback also hardcodes queue (Codex)
`review/[callNoteId]/page.tsx` has a fallback redirect to `?tab=queue&note=unavailable` when the review page can't load. This should also respect `returnTab`.

### S4. Incomplete domain exclusions in advisor hint (Gemini)
The advisor hint extraction filters `@savvywealth.com`, `@savvyadvisors.com`, and `resource.calendar.google.com`. Missing: `noreply@`, `reply@`, `invites@` prefixes that calendar tools inject.

### S5. Humanize linkage_strategy enum in export (Gemini)
CSV export will output raw enum values like `kixie_task_link` and `crd_prefix`. Map to human-friendly labels for RevOps users.

### S6. Stale data after linking (Gemini)
After an SGM links a record via NoteReviewClient and returns to the Needs Linking tab, Next.js client-side router caching may still show the old (now-linked) record. Consider a forced re-fetch on tab mount or when returning from review.

## Design Questions

### Q1. Sub-tab vs top-level tab? (Codex)
The spec says "sub-tab of Coaching Usage" but the plan implements as a new top-level `CallIntelligenceTab`. No sub-tab infrastructure exists in `CoachingUsageTab.tsx`. The top-level approach is simpler but Coaching Usage is currently gated to `revops_admin` only — making Needs Linking a separate top-level tab lets SGMs/managers access it without seeing Coaching Usage analytics. Is a top-level tab the right UX, or should we build sub-tab infrastructure?

### Q2. Should SGMs see their own pending notes? (Codex + Gemini)
`getRepIdsVisibleToActor()` returns visible *coachee* IDs. It's unclear whether the function includes the actor's own rep ID. If an SGM has their own unlinked calls, should they appear in their queue?

### Q3. Should the tab filter for advisor calls only? (Codex)
Coaching Usage filters for `cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call'`. Should Needs Linking apply the same filter, or show ALL pending call_notes regardless of call type?

## Suggested Improvements

### I1. LATERAL join for slack_review_messages (Gemini) — HIGH IMPACT
Replace the LEFT JOIN with a LATERAL subquery to prevent row duplication and get the most recent slack message's confidence tier.

### I2. Centralize VALID_TABS (Codex) — MEDIUM IMPACT
Define VALID_TABS in one shared constant used by both page.tsx and CallIntelligenceClient.tsx to prevent drift.

### I3. Business days vs calendar days (Gemini) — LOW IMPACT
`days_since_call` uses calendar days. For SLA tracking, business days may be more meaningful. Low priority for v1.

### I4. Empty state polish (Gemini) — LOW IMPACT
After clearing the queue, show a tailored "no calls need linking" state. Already handled in the guide.

---

## Codex Misread (Not an Issue)

**C4 (Codex): SQL aliases don't match DTO shape.** Codex flagged that snake_case SQL aliases won't map to camelCase DTO fields. However, the guide already includes an explicit mapping step in the query function: `rows.map((r) => ({ callNoteId: r.call_note_id, ... }))`. Not a real issue.

**C4b (Codex): NeedsLinkingRow nullability wrong.** Codex said `call_started_at` can be null. The data verifier confirmed it's `NOT NULL` (100% populated, DB constraint). `repName` is from a LEFT JOIN but `full_name` is NOT NULL on `reps` — the only risk is if `rep_id` points to a non-existent rep (FK violation, shouldn't happen). Still, the `repName` type could be `string | null` for safety. Minor.

## Gemini Misread (Not an Issue)

**G1 (Gemini): Flooding with manual_entry records.** Gemini said to exclude `manual_entry` from the query because it means "SGM already selected SFDC record." This misinterprets the data. The data verifier showed that `manual_entry + pending` = 192 rows with ZERO `sfdc_record_id`. `manual_entry` is the DEFAULT linkage_strategy for records that entered via manual entry (as opposed to auto-linking). Only when the status changes from `pending` to `approved`/`sent_to_sfdc`/`rejected` is the record resolved. The `status='pending'` filter correctly includes unresolved manual_entry rows. Adding `AND linkage_strategy != 'manual_entry'` would EXCLUDE 192 of 224 actually-unlinked records.

---

## Raw Responses

### Codex (GPT-5.4)

#### CRITICAL ISSUES
1. Navigation model: sub-tab vs top-level tab confusion
2. SGM data hidden: getRepIdsVisibleToActor may not include self
3. NeedsLinkingRow nullability: fields marked non-null that could be null from LEFT JOINs
4. SQL aliases don't match DTO shape (DISMISSED — mapping exists in guide)

#### SHOULD FIX
1. Return flow incomplete on page.tsx error fallback
2. ExportButton header mapping (DISMISSED — guide already pre-maps)
3. VALID_TABS drift
4. Role model inconsistency (coaching-usage = revops_admin, needs-linking = broader)
5. Missing advisor-call filter
6. returnTab validation
7. No-rep-row branch (DISMISSED — guide handles with isPrivileged check)

#### DESIGN QUESTIONS
1. Sub-tab vs top-level tab?
2. SGM self-inclusion?
3. Should match coaching usage filter?
4. Pending manual_entry? (DISMISSED — data verifier confirms they're unresolved)

#### SUGGESTED IMPROVEMENTS
1. Keep as sub-tab or separate tab based on product intent
2. Define NeedsLinkingRawRow + NeedsLinkingRow for type safety
3. Don't use getRepIdsVisibleToActor blindly for SGMs
4. Centralize VALID_TABS
5. Validate returnTab as enum

### Gemini (gemini-3.1-pro-preview)

#### CRITICAL ISSUES
1. Flooding with manual_entry (DISMISSED — data verifier proves status='pending' is correct)
2. jsonb_array_elements safety
3. Row duplication via slack_review_messages join

#### SHOULD FIX
1. Missing high-confidence filter (N/A — confidence is display-only)
2. Timezone shift on 14-day filter
3. Incomplete domain exclusions

#### DESIGN QUESTIONS
1. SGM self-inclusion and hierarchy
2. Title fallback usefulness
3. Stale cache after linking

#### SUGGESTED IMPROVEMENTS
1. Humanize enum values in export
2. Business days vs calendar days
3. Empty state UI
