# Pattern Finder Findings: RequestDetailModal.tsx Refactor

Generated: 2026-03-27

---

## 1. src/components/requests/ Directory Structure

Files present (12 total, flat siblings, no barrel, no sub-directory, no index.ts):

  CommentThread.tsx         already-extracted tab subcomponent (223 lines)
  EditHistoryTimeline.tsx   already-extracted tab subcomponent (201 lines)
  KanbanBoard.tsx           main board orchestrator
  KanbanColumn.tsx          column subcomponent imported by KanbanBoard
  MentionPicker.tsx         UI primitive imported by CommentThread
  MentionText.tsx           UI primitive imported by CommentThread and EditHistoryTimeline
  RecentSubmissions.tsx     imported by RequestForm
  RequestAnalytics.tsx      analytics panel
  RequestCard.tsx           imported by KanbanBoard
  RequestDetailModal.tsx    subject of refactor (606 lines)
  RequestFilters.tsx        imported by KanbanBoard
  RequestForm.tsx           form component

All intra-directory imports use relative paths.
No absolute @/components/requests/ imports exist anywhere in the directory.
The directory already has two successful extractions (CommentThread, EditHistoryTimeline)
that RequestDetailModal already imports. The decomposition pattern is established.

---

## 2. What RequestDetailModal.tsx Actually Contains

606 lines broken down by concern:

  Lines 1-46:    imports + interface + TabId type + selectStyles constant
  Lines 48-81:   component declaration + useState/useEffect for data fetch
  Lines 83-176:  6 async action handlers (handleStatusChange, handlePriorityChange,
                 handlePrivacyToggle, handleArchiveToggle, handleDelete, handleCommentAdded)
  Lines 178-186: local formatDate arrow function defined inside component body
  Lines 188-605: single return statement containing all JSX:
    Backdrop + modal shell (191-208)
    Loading/error states (212-220)
    Title + type badges (223-242)
    Admin controls panel: status/priority selects + privacy toggle (244-301)
    Non-admin status/priority display (303-323)
    Meta info grid: submitter, created, affectedPage, wrikePermalink (325-361)
    Tab navigation bar (363-391)
    Details tab: description + DATA_ERROR fields + Attachments (395-515)
      formatFileSize defined inline inside .map() callback at line 464
    Comments tab: delegates to CommentThread (518-524)
    History tab: delegates to EditHistoryTimeline (526-531)
    Footer: delete confirm two-state toggle, archive, close (538-602)

The two most egregious inline items:
  1. formatDate (lines 178-186): local arrow function inside the component body
  2. formatFileSize (lines 464-468): function defined inside a .map() callback,
     recreated on every render iteration

---

## 3. The formatDate Duplication Problem

Three separate local formatDate implementations exist in the requests directory:

  RequestDetailModal.tsx line 178: const formatDate = (dateString: string) => ...
    Defined inside component body (component-scope arrow function)

  CommentThread.tsx line 138: const formatDate = (dateString: string) => ...
    Also defined inside component body (same scoping mistake)

  EditHistoryTimeline.tsx line 70: function formatDate(dateString: string): string
    Defined at module scope (better scoping, same body)

All three bodies are identical: new Date(dateString).toLocaleDateString('en-US',
{ month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' })
None imports from src/lib/utils/format-helpers.

CRITICAL INCONSISTENCY: src/lib/utils/format-helpers.ts already exports formatDate
(lines 2-34) with timezone-safe YYYY-MM-DD parsing, but its output is date-only
('Jan 15, 2025') -- it omits hour and minute.

format-helpers.ts also exports formatDateTime (line 36) which includes time but
uses new Date(string) directly without timezone-safe YYYY-MM-DD parsing.

Neither shared utility is a drop-in replacement for what the requests directory
needs (timestamp formatting). This gap is the root cause of the three local copies.

Fix options:
  A) Add formatTimestamp to src/lib/utils/format-helpers.ts combining
     timezone-safe YYYY-MM-DD parsing with hour+minute output.
     Import in all three files. Consistent with all other modals in the codebase.

  B) Create src/components/requests/request-utils.ts with
     export function formatRequestTimestamp(dateString: string): string
     Import in all three files. Follows explore-formatters.ts precedent
     for feature-local utilities with different behavior from shared ones.

---

## 4. The formatFileSize Problem

Defined at RequestDetailModal.tsx line 464, inside the attachments .map() callback:

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

Redefined on every iteration of every render. No equivalent exists anywhere
else in the codebase. Minimum fix: hoist to module scope in the same file.
Better fix: add to src/lib/utils/format-helpers.ts for codebase-wide reuse.

---

## 5. Similar Modal Patterns -- Size and Factoring Comparison

  RequestDetailModal.tsx         606 lines  (subject)
  RecordDetailModal.tsx          480 lines  (src/components/dashboard/) -- best peer
  MetricDrillDownModal.tsx       510 lines  (src/components/sga-hub/)
  ActivityDrillDownModal.tsx     369 lines  (src/components/sga-activity/)
  VolumeDrillDownModal.tsx       127 lines  (src/components/dashboard/)

RecordDetailModal.tsx (480 lines) is the most instructive peer.
Key patterns that RequestDetailModal should adopt:

  a) Imports formatDate from '@/lib/utils/format-helpers' -- does NOT define locally.
     9 of 9 modal files outside requests/ use the shared import.

  b) Defines PRIVATE HELPER COMPONENTS at module scope ABOVE the main export:
       function SectionHeader({ icon, title }) { ... }   lines 37-46
       function DetailRow({ label, value, highlight }) { ... }  lines 49-68
       function DateRow({ label, value }) { ... }  lines 71-86
     All unexported, co-located in the same file, NOT split to separate files.

  c) Imports heavier subcomponents from named sibling files:
       FunnelProgressStepper from './FunnelProgressStepper'
       RecordDetailSkeleton from './RecordDetailSkeleton'

  d) Implements ESC key handler and document.body.style.overflow = 'hidden'.
     RequestDetailModal has neither. Behavioral gap discovered during comparison.

MetricDrillDownModal.tsx (510 lines):
  - Imports formatDate from '@/lib/utils/format-helpers'
  - Defines private type-guard functions at module scope above the export
  - Single large component body, all rendering inline, no subcomponent files

ActivityDrillDownModal.tsx: also imports formatDate from '@/lib/utils/format-helpers'.

PATTERN: All 9 modal files outside src/components/requests/ import the shared
formatDate. Only the requests directory defines it locally -- three times,
identically. This is the strongest signal that a fix is overdue.

---

## 6. ExploreResults.tsx Decomposition Precedent (Commit 55c2af3, 2026-03-27)

Decomposed from 1,779 lines to 1,139 lines. Four new flat sibling files created:

  src/components/dashboard/explore-formatters.ts
    formatExploreNumber, formatCellValue
    Named [feature]-formatters.ts, co-located in same directory
    NOT placed in src/lib/utils/ because behavior differed from shared utilities

  src/components/dashboard/explore-visualizations.tsx
    6 visualization renderer functions (pure React.ReactNode, no hooks)
    Named [feature]-visualizations.tsx

  src/components/dashboard/ResponseFeedback.tsx
    Self-contained UI component with its own local state
    Named PascalCase .tsx as a proper named export

  src/lib/utils/sql-helpers.ts
    generateExecutableSql deduplicated from QueryInspector.tsx
    Placed in src/lib/utils/ because it was duplicated between two existing files

Rules established by that refactor:
  1. Feature-specific formatters incompatible with shared utilities:
     co-located [feature]-formatters.ts in same directory
  2. Pure rendering functions with no hooks: [feature]-visualizations.tsx
  3. Self-contained stateful components: PascalCase .tsx named export
  4. Logic duplicated between two existing files: src/lib/utils/
  5. No barrel index.ts added. No sub-directory created. All flat siblings.
  6. Main file retains orchestration + state only.

---

## 7. src/lib/utils/ File Inventory

  date-helpers.ts         date math + formatCurrency, formatPercent, formatNumber
                          NOTE: formatCurrency lives here despite misleading filename
  export-csv.ts           CSV generation utility
  filter-helpers.ts       filter object manipulation
  format-helpers.ts       formatDate (date-only, timezone-safe) + formatDateTime
  freshness-helpers.ts    data freshness indicators
  goal-helpers.ts         goal calculation helpers
  sga-hub-csv-export.ts   feature-scoped CSV export ([feature]-[type].ts naming)
  sga-hub-helpers.ts      feature-scoped data helpers
  sgm-hub-helpers.ts      feature-scoped data helpers
  sql-helpers.ts          extracted from ExploreResults decomposition

format-helpers.ts currently has only formatDate and formatDateTime.
Missing: formatTimestamp (date+time with timezone safety), formatFileSize.

---

## 8. Import/Export Conventions

Within src/components/requests/:
  - Relative imports only: import { X } from './X'
  - No barrel file exists, none should be added
    (only src/components/games/pipeline-catcher/ has a barrel in all of src/components/)
  - Each file has exactly one public named export
  - Private helpers are unexported module-scope functions or components

Codebase-wide for shared utilities:
  - import { formatDate } from '@/lib/utils/format-helpers'
  - import { formatCurrency, formatNumber } from '@/lib/utils/date-helpers'
  - All 9 modal files outside requests/ use the shared formatDate import

---

## 9. Recommended Decomposition for RequestDetailModal.tsx

Target: ~300-350 lines (down from 606).
No new component files needed. One new utility file (request-utils.ts) optional.

Step 1 -- Resolve formatDate/formatFileSize duplication

  Preferred: Create src/components/requests/request-utils.ts:
    export function formatRequestTimestamp(dateString: string): string
    export function formatFileSize(bytes: number): string
  Import in RequestDetailModal.tsx, CommentThread.tsx, EditHistoryTimeline.tsx.
  Eliminates 3 duplicate local definitions and the inline-in-.map() definition.

  Alternative: Add formatTimestamp to src/lib/utils/format-helpers.ts.
  More consistent with all other modal files. Requires extending shared utility.

Step 2 -- Extract private helper components (same file, above main export, unexported)

  Following RecordDetailModal.tsx pattern (SectionHeader, DetailRow, DateRow):

  function AdminControls({ request, isUpdating, onStatusChange,
                          onPriorityChange, onPrivacyToggle }) { ... }
  function DataErrorFields({ request }) { ... }
  function AttachmentList({ attachments, requestId }) { ... }
  function FooterActions({ request, canManageRequests, showDeleteConfirm,
                          isUpdating, onDelete, onArchive, onClose,
                          onShowDeleteConfirm }) { ... }

  All unexported. All in RequestDetailModal.tsx above the main export.
  No separate files. Follows RecordDetailModal precedent exactly.

Step 3 -- Main component retains: state, effects, action handlers, top-level JSX

  Action handlers remain in main body and passed as props to private helpers.
  Admin panel becomes: <AdminControls ... />
  Details tab body becomes: <DataErrorFields /> and <AttachmentList />
  Footer becomes: <FooterActions ... />

What does NOT need a separate file:
  AdminControls, DataErrorFields, AttachmentList, FooterActions (private helpers)
  Tab navigation bar (~25 lines, too small)
  CommentThread and EditHistoryTimeline are already correctly separate -- no change

---

## 10. Inconsistencies Flagged

1. formatDate defined locally in 3 requests/ files. All other modals use shared utility.
   Root cause: format-helpers.ts formatDate omits hour/minute; formatDateTime lacks
   timezone-safe YYYY-MM-DD parsing. Gap in shared utility caused three local copies.

2. formatFileSize defined inside a .map() callback (RequestDetailModal.tsx line 464).
   Recreated on every render iteration. No equivalent anywhere else in codebase.

3. RequestDetailModal lacks ESC key handler and body overflow lock present in
   RecordDetailModal.tsx. Behavioral gap discovered during comparison.

4. CommentThread.tsx defines formatDate as a component-body arrow function (line 138).
   EditHistoryTimeline.tsx defines it at module scope (line 70).
   Same function, inconsistent scoping within the same directory.
   EditHistoryTimeline.tsx is the better pattern of the two.

---

## Key Files Referenced

- C:/Users/russe/Documents/Dashboard/src/components/requests/RequestDetailModal.tsx
  606 lines. Local formatDate at line 178, formatFileSize inside .map() at line 464,
  all JSX inline with no private helper components.

- C:/Users/russe/Documents/Dashboard/src/components/requests/CommentThread.tsx
  Duplicate formatDate at line 138 as component-body arrow function.

- C:/Users/russe/Documents/Dashboard/src/components/requests/EditHistoryTimeline.tsx
  Duplicate formatDate at line 70 as module-scope function (better scoping).

- C:/Users/russe/Documents/Dashboard/src/components/requests/RequestCard.tsx
  Clean single-concern sibling. No inline helpers. No local formatters.

- C:/Users/russe/Documents/Dashboard/src/components/dashboard/RecordDetailModal.tsx
  Best peer: private helper components at module scope above export, shared formatDate
  import, ESC handler, body overflow lock. 480 lines.

- C:/Users/russe/Documents/Dashboard/src/components/sga-hub/MetricDrillDownModal.tsx
  510-line peer modal using shared formatDate and module-scope type guards.

- C:/Users/russe/Documents/Dashboard/src/lib/utils/format-helpers.ts
  formatDate (date-only, timezone-safe) + formatDateTime (no YYYY-MM-DD safety).
  Missing: formatTimestamp (date+time, timezone-safe) and formatFileSize.

- C:/Users/russe/Documents/Dashboard/src/components/dashboard/explore-formatters.ts
  Feature-local formatter file from ExploreResults decomposition. Template for
  request-utils.ts if the feature-local approach is chosen.

- C:/Users/russe/Documents/Dashboard/src/components/dashboard/ResponseFeedback.tsx
  Extracted self-contained component from ExploreResults decomposition.
  Template for how a stateful subcomponent should be extracted.
