# Exploration Results — Needs Linking Sub-Tab

**Generated:** 2026-05-12
**Feature:** Add a "Needs Linking" sub-tab to the Coaching Usage view at `/dashboard/call-intelligence`. Surfaces `call_notes` not confidently attached to a Salesforce record.
**Scope:** Dashboard-only. No upstream sales-coaching schema changes needed.

## Pre-Flight Summary

The feature adds a "Needs Linking" sub-tab to the Coaching Usage view at `/dashboard/call-intelligence`. Three critical spec corrections emerged: (1) `confidence_tier` is **not** a scalar column on `call_notes` — it lives inside `slack_review_messages.sfdc_suggestion` JSONB; (2) `lead_contact_name` and `summary_name` are not valid `linkage_strategy` enum values — only `crd_prefix`, `attendee_email`, `calendar_title`, `manual_entry`, and `kixie_task_link` exist; (3) `manual_entry` rows are already SGM-resolved (rep selected an SFDC record) and must be **excluded**. The recommended v1 orphan predicate simplifies to `status='pending'` as the sole filter — this yields 224 all-time rows (67 in last 14 days). No schema migrations are needed. The feature requires 3 new files (query, API route, component) and modifications to 3 existing files (types, client orchestrator, server page). An RBAC gap exists: SGMs currently have zero coachee linkage in the coaching DB, so `getRepIdsVisibleToActor()` returns an empty set for SGMs today — this is a data-setup issue, not a code bug.

---

## 1. Schema Status — sales-coaching Neon

### Confirmed Columns on `call_notes` (585 non-deleted rows)

| Column | Exists | Type | Population | Notes |
|---|---|---|---|---|
| `call_started_at` | ✅ | timestamptz NOT NULL | 100% | |
| `source` | ✅ | text NOT NULL | 100% | `granola` (503) or `kixie` (82) |
| `title` | ✅ | text NOT NULL | 100% | Max 78 chars |
| `invitee_emails` | ✅ | text[] NOT NULL | 100% (36 empty arrays) | Google Calendar resource accounts must be filtered |
| `attendees` | ✅ | jsonb NOT NULL | 100% (1 empty array) | Shape: `[{name, email}]` |
| `rep_id` | ✅ | uuid NOT NULL | 100% | FK to `reps.id` |
| `linkage_strategy` | ✅ | text NOT NULL | 100% | 3 values in live data (see below) |
| `status` | ✅ | text NOT NULL | 100% | 4 values (see below) |
| **`confidence_tier`** | ❌ | — | — | **Does not exist as a column.** Lives in `slack_review_messages.sfdc_suggestion` JSONB |

### Value Distributions

**`linkage_strategy`** (only 3 values exist in live data):
| Value | Count | % |
|---|---|---|
| `manual_entry` | 502 | 85.8% |
| `kixie_task_link` | 82 | 14.0% |
| `crd_prefix` | 1 | 0.2% |

`calendar_title`, `attendee_email` exist in the CHECK constraint but have zero rows. `lead_contact_name` and `summary_name` are NOT valid enum values — they are `source_signal` labels in `sfdc_suggestion` JSONB.

**`status`:**
| Value | Count | % |
|---|---|---|
| `rejected` | 283 | 48.4% |
| `pending` | 224 | 38.3% |
| `approved` | 51 | 8.7% |
| `sent_to_sfdc` | 27 | 4.6% |

### `manual_entry` Resolution Status

| status | Count | has sfdc_record_id | Conclusion |
|---|---|---|---|
| `rejected` | 282 | 0 | SGM-resolved (declined) — **exclude** |
| `pending` | 192 | 0 | Unresolved — **include** |
| `sent_to_sfdc` | 26 | 10 | Resolved — **exclude** |
| `approved` | 2 | 0 | Resolved — **exclude** |

### JSONB Shapes

**`attendees`:** `[{"name": "Lena Allouche", "email": "lena.allouche@savvywealth.com"}]`. Kixie: 2 elements (rep + prospect). Granola: variable count. Filter out `@savvywealth.com`, `@savvyadvisors.com`, `resource.calendar.google.com`.

**`invitee_emails`:** `text[]`. 36 empty arrays. Email strings only, no names. Same domain filtering needed.

### Advisor Hint Extraction Priority
1. First non-internal attendee's `name` field from `attendees` JSONB
2. First non-internal email from `invitee_emails` array
3. Fallback: `title` (always populated)

---

## 2. Corrected Orphan Definition

The spec's filter criteria have three errors. Corrected predicate:

**v1 (recommended — simple, no JOIN needed for filtering):**
```sql
WHERE cn.source_deleted_at IS NULL
  AND cn.status = 'pending'
```
Volume: 224 all-time, 67 in last 14 days.

**Confidence tier as display column (LEFT JOIN, not filter):**
```sql
LEFT JOIN slack_review_messages srm ON srm.call_note_id = cn.id AND srm.surface = 'dm'
-- Display: srm.sfdc_suggestion->'candidates'->0->>'confidence_tier'
-- Available for ~87/224 pending rows; NULL for the rest
```

**Rationale:**
- `status='pending'` captures all unresolved calls regardless of linkage strategy
- `manual_entry` = rep already selected SFDC record → exclude (non-pending are resolved)
- `kixie_task_link` + non-pending = ingestion-resolved → exclude
- `rejected` = SGM reviewed and declined → exclude
- `confidence_tier` is display-only (not a filter), available via JOIN for ~87/224 pending rows

---

## 3. Files to Modify

| File | Change |
|---|---|
| `src/types/call-intelligence.ts` | Add `'needs-linking'` to `CallIntelligenceTab` union (line 210). Add `NeedsLinkingRow` interface. |
| `src/app/dashboard/call-intelligence/CallIntelligenceClient.tsx` | Add `'needs-linking'` to `VALID_TABS` (line 22). Add tab button with expanded visibility. Add render branch for `NeedsLinkingTab`. |
| `src/app/dashboard/call-intelligence/page.tsx` | Add `'needs-linking'` to server-side `VALID_TABS` (line 12). |

## 4. Files to Create

| File | Purpose |
|---|---|
| `src/lib/queries/call-intelligence/needs-linking.ts` | Direct-pg query function. RBAC via `repIds: string[]` param. Returns `NeedsLinkingRow[]`. |
| `src/app/api/call-intelligence/needs-linking/route.ts` | API route. Auth: `allowedPages(20)` + role gate `['manager', 'admin', 'revops_admin', 'sgm']`. RBAC via `getRepIdsVisibleToActor()`. No caching (actor-scoped). |
| `src/app/dashboard/call-intelligence/tabs/NeedsLinkingTab.tsx` | Component with table, "last 14 days" / "all" toggle, ExportButton, row action linking to review page. |

## 5. Files with Zero Changes (confirmed)

| File | Reason |
|---|---|
| `src/app/api/admin/coaching-usage/route.ts` | Existing API route — byte-for-byte preserved |
| `src/app/dashboard/call-intelligence/tabs/CoachingUsageTab.tsx` | Existing component — byte-for-byte preserved |
| `src/lib/queries/call-intelligence/visible-reps.ts` | RBAC function — no changes needed |
| `src/lib/permissions.ts` | Page 20 already includes SGM |
| `src/lib/cache.ts` | No new cache tags (Needs Linking is uncached) |

## 6. Type Changes

### New `NeedsLinkingRow` interface (in `src/types/call-intelligence.ts`)
```typescript
export interface NeedsLinkingRow {
  callNoteId: string;
  callDate: string;          // ISO timestamp from call_started_at
  source: string;            // 'granola' | 'kixie'
  advisorHint: string;       // Extracted from attendees/invitee_emails/title
  repName: string;           // reps.full_name
  managerName: string | null; // manager reps.full_name (nullable — 5 reps have no manager)
  linkageStrategy: string;   // call_notes.linkage_strategy
  confidenceTier: string | null; // from slack_review_messages JSONB (nullable — only 87/224 have it)
  daysSinceCall: number;     // Computed SQL-side
}
```

### `CallIntelligenceTab` union extension
```typescript
export type CallIntelligenceTab = 'queue' | 'record-notes' | 'coaching-usage' | 'insights' | 'settings' | 'usage-analytics' | 'cost-analysis' | 'needs-linking';
```

## 7. Construction Site Inventory

Since `NeedsLinkingRow` is a **new type** (not extending existing types), there is only **one construction site**: the query function in `src/lib/queries/call-intelligence/needs-linking.ts` where raw pg rows are mapped to `NeedsLinkingRow[]`.

No existing code constructs `NeedsLinkingRow` objects.

## 8. Recommended Phase Order

1. **Phase 1 — Types**: Add `NeedsLinkingRow` interface and extend `CallIntelligenceTab` union
2. **Phase 2 — Query Layer**: Create `needs-linking.ts` query function with direct-pg, RBAC, advisor hint extraction
3. **Phase 3 — API Route**: Create `/api/call-intelligence/needs-linking/route.ts` with auth, role gate, RBAC
4. **Phase 4 — Component**: Create `NeedsLinkingTab.tsx` with table, toggle, export, row action
5. **Phase 5 — Integration**: Wire into `CallIntelligenceClient.tsx` and `page.tsx` with tab navigation
6. **Phase 6 — Return Navigation Fix**: Fix `NoteReviewClient.tsx` hardcoded return URL to support `?returnTab=needs-linking`
7. **Phase 7 — Documentation sync**

## 9. Risks and Blockers

### Critical — Spec Corrections Required
1. **`confidence_tier` not a column** — Include as display-only column via LEFT JOIN to `slack_review_messages`. Do NOT use as filter criteria. Will be NULL for ~61% of pending rows.
2. **`manual_entry` exclusion** — Spec says include; data says these are resolved. Must exclude non-pending ones; `status='pending'` handles this.
3. **Invalid linkage_strategy values** — `lead_contact_name`, `summary_name` don't exist as enum values. Predicate simplified to `status='pending'`.

### RBAC Data Gap
SGMs currently have zero coachee linkage in `coaching_teams`/`coaching_observers`/`reps.manager_id`. `getRepIdsVisibleToActor()` returns empty array for SGMs. The code is correct but the data hasn't been set up. This is a data-setup task, not a code change. The tab will work correctly once SGM→SGA relationships are populated.

### NoteReviewClient Return Navigation
`NoteReviewClient.tsx` hardcodes return to `?tab=queue`. SGMs arriving from Needs Linking will be dropped at the wrong tab. Fix: use `searchParams` to read `returnTab` and construct the correct return URL.

### No `14d` in AllowedRange
`src/lib/coachingDb.ts` `AllowedRange` type is `'7d' | '30d' | '90d' | 'all'`. Needs Linking wants 14-day default. Recommendation: use independent `showAll: boolean` parameter instead of shared range enum.

### Cache Isolation
Do NOT reuse `CACHE_TAGS.COACHING_USAGE` — it's keyed for revops_admin-only data. Needs Linking is actor-scoped (per-user visible rep set). Use `export const dynamic = 'force-dynamic'` with no caching.

### `VALID_TABS` Server/Client Mismatch (Pre-existing)
`page.tsx` line 12 omits `'cost-analysis'` from `VALID_TABS` but `CallIntelligenceClient.tsx` line 22 includes it. Fix when adding `'needs-linking'` to both.

## 10. SQL Query (Reference)

```sql
SELECT
  cn.id AS call_note_id,
  cn.call_started_at,
  cn.source,
  cn.linkage_strategy,
  COALESCE(
    (SELECT a->>'name'
       FROM jsonb_array_elements(cn.attendees) AS a
      WHERE NULLIF(TRIM(a->>'name'), '') IS NOT NULL
        AND LOWER(COALESCE(a->>'email','')) NOT LIKE '%@savvywealth.com'
        AND LOWER(COALESCE(a->>'email','')) NOT LIKE '%@savvyadvisors.com'
        AND LOWER(COALESCE(a->>'email','')) NOT LIKE '%@resource.calendar.google.com'
      LIMIT 1),
    (SELECT eml FROM unnest(cn.invitee_emails) AS eml
      WHERE LOWER(eml) NOT LIKE '%@savvywealth.com'
        AND LOWER(eml) NOT LIKE '%@savvyadvisors.com'
        AND LOWER(eml) NOT LIKE '%@resource.calendar.google.com'
      LIMIT 1),
    cn.title
  ) AS advisor_hint,
  sga.full_name AS rep_name,
  sgm.full_name AS manager_name,
  srm.sfdc_suggestion->'candidates'->0->>'confidence_tier' AS top_confidence_tier,
  FLOOR(EXTRACT(EPOCH FROM (now() - cn.call_started_at)) / 86400)::int AS days_since_call
FROM call_notes cn
LEFT JOIN reps sga ON sga.id = cn.rep_id AND sga.is_system = false
LEFT JOIN reps sgm ON sgm.id = sga.manager_id AND sgm.is_system = false
LEFT JOIN slack_review_messages srm ON srm.call_note_id = cn.id AND srm.surface = 'dm'
WHERE cn.source_deleted_at IS NULL
  AND cn.status = 'pending'
  AND cn.rep_id = ANY($1::uuid[])
  AND ($2::boolean OR cn.call_started_at >= date_trunc('day', now()) - interval '14 days')
ORDER BY cn.call_started_at DESC NULLS LAST
```

## 11. Key Patterns to Follow

| Pattern | Source File | Convention |
|---|---|---|
| Date coercion (Neon) | coaching-usage route.ts:373 | `instanceof Date ? .toISOString() : String(x)` |
| RBAC scope | insights/reps/route.ts | `getRepIdsVisibleToActor()` with `isPrivileged` shortcut |
| Role gate | insights/heatmap/route.ts:54-93 | `if (!['manager','admin','revops_admin','sgm'].includes(role))` |
| No caching | — | `export const dynamic = 'force-dynamic'` (actor-scoped data) |
| Export | ExportButton + export-csv.ts | Pre-map to human-friendly keys, pass to `<ExportButton>` |
| Direct-pg query | coachingDb.ts | `getCoachingPool()` → `pool.query<T>()` |
| Days-since-call | — | Compute SQL-side: `FLOOR(EXTRACT(EPOCH FROM (now() - ts)) / 86400)::int` |
