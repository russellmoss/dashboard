# Data Verifier Findings -- Needs Linking Sub-Tab
Feature: Needs Linking sub-tab in Call Intelligence / Coaching Usage view
Database scope: neon_sales_coaching (project falling-hall-15641609)
Date: 2026-05-12

---

## 1. Column Existence Check -- call_notes

Table has 90 columns confirmed. Feature-required columns:

Column            | Exists | Type        | Nullable | Notes
---               | ---    | ---         | ---      | ---
id                | YES    | uuid        | NO       | PK FK target
call_started_at   | YES    | timestamptz | NO       | 100pct populated
source            | YES    | text        | NO       | granola or kixie only
title             | YES    | text        | NO       | max 78 chars
invitee_emails    | YES    | text[]      | NO       | 36 empty arrays 549 with 1+ email
attendees         | YES    | jsonb       | NO       | 1 empty array 584 non-empty
rep_id            | YES    | uuid        | NO       | FK to reps.id
linkage_strategy  | YES    | text        | NO       | 100pct populated
status            | YES    | text        | NO       | 100pct populated
confidence_tier   | NO BLOCKER | n/a     | n/a      | Does not exist on call_notes

Soft-delete: source_deleted_at. All queries: WHERE source_deleted_at IS NULL

---

## 2. Population Rates (non-soft-deleted rows N=585)

All 8 target columns: 100% populated. No NULL-handling needed at query time.

Column                  | Rate
---                     | ---
linkage_strategy        | 100%
status                  | 100%
call_started_at         | 100%
source                  | 100%
title (non-empty)       | 100%
invitee_emails (present)| 100%
attendees               | 100%
rep_id                  | 100%

---

## 3. Value Distributions

### linkage_strategy -- only 3 distinct values; spec names 6

Value           | Count | %
---             | ---   | ---
manual_entry    | 502   | 85.81%
kixie_task_link | 82    | 14.02%
crd_prefix      | 1     | 0.17%

SPEC MISMATCH: calendar_title, lead_contact_name, summary_name do not exist in live DB.
These are aspirational/stale strategy names.
The predicate linkage_strategy IN (calendar_title, lead_contact_name, summary_name, manual_entry)
currently matches only manual_entry rows.

### status

Value        | Count | %
---          | ---   | ---
rejected     | 283   | 48.38%
pending      | 224   | 38.29%
approved     | 51    | 8.72%
sent_to_sfdc | 27    | 4.62%

### source

Value   | Count | %
---     | ---   | ---
granola | 503   | 85.98%
kixie   | 82    | 14.02%

---

## 4. manual_entry Deep Dive: SGM-Resolved vs Unresolved

Cross-tab: manual_entry rows by status (N=502):

status       | Count | has sfdc_record_id | has approved_by
---          | ---   | ---                | ---
rejected     | 282   | 0                  | 20
pending      | 192   | 0                  | 0
sent_to_sfdc | 26    | 10                 | 26
approved     | 2     | 0                  | 2

Interpretation:
- sent_to_sfdc (26): Reviewed and pushed to SFDC. RESOLVED. approved_by always set. EXCLUDE.
- approved (2): Human confirmed linkage, not yet pushed. approved_by set. EXCLUDE.
- rejected (282): SGM reviewed and declined. RESOLVED. Including these re-queues already-reviewed calls. EXCLUDE.
- pending (192): No sfdc_record_id, no approved_by. GENUINELY UNRESOLVED. INCLUDE.

Recommendation: Restrict manual_entry rows to status=pending only.
The spec confidence_tier filter intended to flag low-confidence rows;
status=pending achieves the same intent -- pending means the waterfall did not
confidently resolve the SFDC record and the SGM has not reviewed it.

kixie_task_link + pending (32 rows): Most have sfdc_record_id set per sample.
These represent Kixie pipeline ingestion-in-progress, not SFDC orphans. EXCLUDE from queue.

---

## 5. BLOCKER: confidence_tier Column Does Not Exist

call_notes.confidence_tier does not exist as a scalar column.
Full search for columns with name containing confidence returned:

Table            | Column                        | Type
---              | ---                           | ---
call_notes       | likely_call_type_confidence   | text
call_notes       | speaker_mapping_confidence    | double precision
call_notes       | transcript_confidence         | double precision
kb_corrections_log | diagnosis_confidence        | numeric

confidence_tier DOES exist inside slack_review_messages.sfdc_suggestion JSONB
as a per-candidate field. Values: likely, possible, unlikely.

Distribution in slack_review_messages.sfdc_suggestion.candidates (dm surface):

confidence_tier | Count (candidate entries)
---             | ---
null            | 2307
unlikely        | 254
likely          | 75
possible        | 38

Of 224 pending call_notes rows, only 87 have a slack_review_messages row.
The remaining 137 have no waterfall data; confidence_tier = null even via JOIN.

Options:
Option 1 (RECOMMENDED for v1): Use status=pending as sole criterion. 224 all-time, 67 last 14 days.
  No schema change. Achieves spec intent.
Option 2: LEFT JOIN slack_review_messages (surface=dm), read candidates[0].confidence_tier.
  Covers only 87/224 pending rows; rest appear as null tier. Adds complexity.
Option 3: Add confidence_tier scalar column to call_notes via migration in sales-coaching repo.
  Flag as blocker if scalar filter is a hard requirement.

---

## 6. reps Table Schema

Column         | Type    | Nullable | Notes
---            | ---     | ---      | ---
id             | uuid    | NO       | PK
full_name      | text    | NO       | Use for rep name display
role           | text    | NO       | SGA SGM manager admin (uppercase SGA/SGM in this DB)
manager_id     | uuid    | YES      | Self-FK to reps.id
is_active      | boolean | NO       | Always filter is_active=true
is_system      | boolean | NO       | Always filter is_system=false
email          | text    | NO       | Available if needed
coaching_scope | text    | YES      | Values: SGA SGM both null

Manager name via self-join: LEFT JOIN reps mgr ON mgr.id = rep.manager_id.
27 of 33 active non-system reps have manager_id set (81.8%). 5 have no manager.

Role enum boundary: reps.role uses coaching enum (SGA SGM manager admin) with uppercase.
Do not conflate with the Dashboard role enum (lowercase sga/sgm).

---

## 7. JSONB Shapes for Advisor Hint Extraction

### attendees (jsonb, 100% array type)

All 585 rows are arrays. 584 non-empty, 1 empty.

Observed element shape (consistent across all sampled rows, both sources):
  { name: Lena Allouche, email: lena.allouche@savvywealth.com }

- Kixie: 2-element array (1 internal rep + 1 external prospect).
- Granola: variable count, mix of internal and external participants.

### invitee_emails (text[])

36 rows are empty arrays. Max array length 37. Mix of internal and external emails.
Google Calendar resource accounts (c_...@resource.calendar.google.com) must be excluded.

Advisor hint extraction priority:
1. Filter attendees where email not in @savvywealth.com / @savvyadvisors.com /
   resource.calendar.google.com. Take first match name field.
2. Filter invitee_emails to first non-internal email (email only, no name).
3. Last resort: title (always populated, max 78 chars).

---

## 8. Needs Linking Filter Volume Estimates

Using status=pending (RECOMMENDED):

Time window  | Row count
---          | ---
Last 14 days | 67
Last 30 days | 108
Last 90 days | 194
All time     | 224

Oldest pending row: 2025-10-15 (7 months ago). 14-day default with all toggle is appropriate.

Using spec combined filter (status=pending OR linkage_strategy IN list) without confidence_tier:

Time window  | Row count
---          | ---
Last 14 days | 147
All time     | 534

The 534 all-time count is inflated by 282 manual_entry+rejected already-reviewed rows.

---

## 9. RBAC: getRepIdsVisibleToActor Compatibility

Source: src/lib/queries/call-intelligence/visible-reps.ts

Existing function handles:
- admin / revops_admin: all active non-system reps (correct for global queue)
- manager_id hierarchy: direct reports
- coaching_team_members via coaching_teams.lead_rep_id: pod overlay
- coaching_observers scope all_sgm / all_sga

RBAC gap -- SGM coachee visibility:
- Zero coaching_teams rows have a SGM as lead_rep_id.
- Zero manager_id relationships link any SGM to any SGA in live data.
- Active coaching_observers (4 rows): 2 admins, 2 managers. Zero SGM-scoped rows.
- An SGM calling getRepIdsVisibleToActor today receives zero visible rep IDs.

Resolution paths (implementation team must choose):
(a) Create coaching_observers rows with scope=all_sga for each SGM.
(b) Add a new branch to getRepIdsVisibleToActor for role=SGM mapping to SGAs.
(c) Role-based shortcut: any active SGM sees all active SGAs.

This RBAC wiring is required before the tab can enforce SGM-scoped visibility.

Live RBAC table counts:
- coaching_teams (active): 2
- coaching_team_members: 7
- coaching_observers (active): 4 (2 admins, 2 managers; no SGMs)
- Active reps: 17 SGA, 8 SGM, 5 admin, 3 manager

---

## 10. Review Route and NoteReviewClient

Both confirmed to exist:
- src/app/dashboard/call-intelligence/review/[callNoteId]/page.tsx
- src/app/dashboard/call-intelligence/review/[callNoteId]/NoteReviewClient.tsx

The Open SFDC search action routing to /dashboard/call-intelligence/review/[callNoteId]
points at an existing route. No new routes are needed for this action.

---

## 11. Text Field Max Lengths

Field            | Max Length
---              | ---
title            | 78 chars
linkage_strategy | 15 chars (kixie_task_link)
status           | 12 chars (sent_to_sfdc)
source           | 7 chars (granola)

No truncation risk for any field in table column display.

---

## 12. Edge Cases

Check                       | Result
---                         | ---
Empty title                 | 0 rows
Whitespace-only title       | 0 rows
title with newlines         | 0 rows
title over 200 chars        | 0 rows
Empty invitee_emails array  | 36 rows (6.2%) -- fallback needed
Empty attendees array       | 1 row (0.17%)
attendees not an array      | 0 rows
call_started_at NULL        | 0 rows
days since call formula     | EXTRACT(DAY FROM NOW() - call_started_at)::int confirmed working

---

## 13. Schema Migration Requirements

Requirement                                    | Status                              | Blocking?
---                                            | ---                                 | ---
Add confidence_tier scalar to call_notes       | NOT required with status=pending    | Only blocks if scalar filter is hard req
New API route for needs-linking data           | Implementation task (no existing endpoint) | Not a schema migration
reps, coaching_teams, team_members, observers  | No column changes needed            | No schema blocker

---

## Summary of Key Blockers and Flags

1. BLOCKER (spec mismatch): confidence_tier is not a column on call_notes.
   It lives inside slack_review_messages.sfdc_suggestion JSONB as a per-candidate field.
   Cannot be used as a scalar WHERE clause.
   Recommendation: simplify orphan definition to status=pending for v1.

2. SPEC MISMATCH: linkage_strategy values calendar_title, lead_contact_name, summary_name
   do not exist in live DB. Only manual_entry (86%), kixie_task_link (14%), crd_prefix (<1%).
   The spec strategy list is aspirational or stale.

3. RBAC gap: SGMs have no coachee linkage in current data.
   No coaching_observers rows for SGMs. No manager_id or coaching_team links SGMs to SGAs.
   SGM-scoped visibility must be explicitly wired before the tab can enforce it.

4. manual_entry + rejected rows (282) must be excluded.
   status=pending naturally excludes them. Do not include rejected or sent_to_sfdc rows.

5. Advisor hint requires JSONB parsing with internal domain filtering.
   Exclude @savvywealth.com, @savvyadvisors.com, resource.calendar.google.com accounts.
