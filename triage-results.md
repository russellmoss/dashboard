# Triage Results — Council Feedback (Needs Linking Sub-Tab)

Generated: 2026-05-12.

## Bucket 1 — Applied Autonomously (6 fixes)

1. **C1 — Row duplication fix**: Replaced `LEFT JOIN slack_review_messages` with `LEFT JOIN LATERAL (...) LIMIT 1` to prevent row duplication when multiple slack messages exist per call_note. (Gemini)
2. **C2 — JSONB safety**: Added `CASE WHEN jsonb_typeof(cn.attendees) = 'array'` guard before `jsonb_array_elements()` to prevent fatal PG error on non-array JSONB values. (Gemini)
3. **S1 — Advisor-call filter**: Added `AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')` to match the coaching-usage view's call universe. (Codex)
4. **S2 — returnTab validation**: Added `VALID_RETURN_TABS` allowlist in NoteReviewClient to prevent broken navigation from arbitrary search params. (Codex)
5. **S4 — Domain exclusions**: Added `noreply@`, `reply@`, `invites@` prefix exclusions to advisor hint extraction. (Gemini)
6. **S5 — Strategy labels**: Added `STRATEGY_LABELS` mapping to humanize enum values in table display and CSV export. (Gemini)

## Bucket 2 — Needs Human Input (3 questions)

1. **Q1 — Sub-tab vs top-level tab?** The spec says "sub-tab of Coaching Usage" but no sub-tab infrastructure exists. Implementing as a top-level tab is simpler and lets SGMs access it without seeing Coaching Usage analytics (which is revops_admin-only). Tradeoff: top-level adds visual clutter to the tab bar; sub-tab is more organizationally correct but requires building new infrastructure.

2. **Q2 — SGM self-inclusion?** `getRepIdsVisibleToActor()` returns coachee IDs. It may not include the actor's own rep ID. If an SGM has their own unlinked calls, should they see them? Recommendation: yes, union the actor's own ID.

3. **Q3 — Advisor-call filter?** Coaching Usage filters for `cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call'`. Should Needs Linking apply the same filter (already applied in Bucket 1), or should it show ALL pending call_notes including internal calls? The Bucket 1 fix assumes advisor-calls-only matches the Coaching Usage scope — override if you want all calls.

## Bucket 3 — Noted, Not Applied (4 items)

1. **I2 — Centralize VALID_TABS**: Good hygiene but scope expansion. Fix in separate cleanup PR.
2. **I3 — Business days**: Calendar days match existing patterns. Business day calculation adds complexity for minimal v1 benefit.
3. **S3 — Error fallback hardcode**: `review/[callNoteId]/page.tsx` also hardcodes `?tab=queue` on error. Edge case — address in follow-up.
4. **G1 — Exclude manual_entry (DISMISSED)**: Gemini misread the data. manual_entry+pending rows (192) are genuinely unresolved (sfdc_record_id=0). Excluding them would drop 86% of the queue.
