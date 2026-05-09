# Pattern Finder Findings -- Step 5b-1-UI

> Pre-flight: `.claude/bq-patterns.md` read (required by agent instructions).
> BQ patterns (DATE/TIMESTAMP wrappers, dedup flags, ARR COALESCE, cohort vs period,
> channel grouping) are not relevant to the coaching-DB surface of Step 5b-1-UI.
> No new BQ patterns found or re-documented here.

---

## Pattern A -- Bridge Client Method

**Canonical citation:** `src/lib/sales-coaching-client/index.ts:196-241`

Every public method follows this exact shape. Example: resolveContentRefinement

    resolveContentRefinement: (email, refinementId, body) =>
      bridgeRequest({
        method: 'POST',
        path: `/api/dashboard/content-refinements/${encodeURIComponent(refinementId)}/resolve`,
        email, requestSchema: ContentRefinementResolveRequest,
        responseSchema: ContentRefinementResolveResponse, body,
      }),

**How to apply to 5b-1-UI:** Add three new methods to `salesCoachingClient`:
1. editEvaluation(email, evaluationId, body) -- PATCH /api/dashboard/evaluations/:id/edit
   context: { evaluationId, expectedEditVersion: body.expected_edit_version }
   so EvaluationConflictError carries OCC metadata on 409.
2. createTranscriptComment(email, evaluationId, body) -- POST .../transcript-comments
3. createContentRefinement(email, body) -- POST /api/dashboard/content-refinements

PostOptions.method is typed as 'POST' | 'PATCH' -- no new HTTP verbs needed for 5b-1.
CRITICAL: salesCoachingClient has import 'server-only' at line 2 of index.ts.
Client components must NEVER import it directly. Call only from API route handlers.

---

## Pattern B -- Zod Schema + Type Naming Convention

**Canonical citation:** `src/lib/sales-coaching-client/schemas.ts:358-463` and `index.ts:7-30`

Rules:
- Schema values: PascalCase, no suffix (EditEvaluationRequest, EditEvaluationResponse)
- Inferred types: T suffix (EditEvaluationRequestT, EditEvaluationResponseT)
- Only ErrorResponseSchema uses the Schema suffix -- the catch-all error envelope
- All objects use .strict() to reject unknown fields

All five 5b-1 schemas already exist in schemas.ts (lines 299-463):
  EditEvaluationRequest/Response, TranscriptCommentCreateRequest/Response,
  ContentRefinementCreateRequest/Response, MyContentRefinementsResponse
No new schemas needed. Import T-suffixed types when adding methods to index.ts.

---

## Pattern C -- Error / Conflict Feedback (inline div, no toast library)

**Canonical citation:** `EvalDetailClient.tsx:216-227` and `:244`

409 conflict pattern (EvalDetailClient.tsx:216-222):
  if (res.status === 409) {
    setConflict({
      expectedVersion: json.edit_version_expected ?? detail.edit_version,
      message: json.error ?? 'Conflict -- another manager edited this.',
    });
    return;  // do NOT auto-reload -- let user decide
  }

General error: setActionError(json.error ?? `HTTP ${res.status}`)

Render (EvalDetailClient.tsx:244):
  <div className=px-4 py-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded>
    {error}
  </div>

No toast library. package.json: no sonner, react-hot-toast, @radix-ui/react-toast.
All error feedback uses useState<string | null> + conditional inline div.
Conflict state is its own typed object (ConflictState | null), separate from action error.

How to apply: One useState<string|null> for general errors;
separate useState<ConflictState|null> for OCC conflicts. Never mix them.

---

## Pattern D -- Dark Mode Cards (hand-rolled Tailwind, not Tremor props)

**Canonical citation:** EvalDetailClient.tsx:275, QueueTab.tsx:94, AdminRefinementsTab.tsx

  <Card className=dark:bg-gray-800 dark:border-gray-700>

Tremor does not auto-apply dark mode. Every Card must carry this className pair.
Never pass dark as a Tremor prop -- it does not exist on Card.

---

## Pattern E -- Two-Pane Sticky Layout

NO PRECEDENT in call-intelligence. No grid-cols-2 + sticky sidebar exists.

Fresh pattern for 5b-1-UI:
  <div className=grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 items-start>
    <div className=space-y-2> {/* left: transcript */} </div>
    <div className=sticky top-4 space-y-4> {/* right: eval detail */} </div>
  </div>

Use items-start so the sticky column does not stretch to match transcript height.
top-4 matches the py-6 outer padding on EvalDetailClient.
Nest inside existing <div className=space-y-4 px-4 py-6> wrapper EvalDetailClient uses.

---

## Pattern F -- Modal Pattern

**Canonical citations:**
- Variant 1 (inline state, null=closed): AdminRefinementsTab.tsx:176-216
- Variant 2 (extracted component, isOpen prop): src/components/dashboard/TransferConfirmModal.tsx

Variant 1 (inline):
  const [declineModal, setDeclineModal] = useState<DeclineModalState | null>(null);
  {declineModal && (
    <div className=fixed inset-0 bg-black/40 flex items-center justify-center z-50>
      <div className=bg-white dark:bg-gray-800 rounded-lg shadow-lg max-w-md w-full p-6>
        {declineModal.error && <div className=text-xs text-red-600>...</div>}
        <div className=flex justify-end gap-2>
          <button onClick={() => setDeclineModal(null)}>Cancel</button>
          <button disabled={declineModal.submitting}>Submit</button>
        </div>
      </div>
    </div>
  )}

Variant 2 (extracted component):
  export function SomeModal({ isOpen }) {
    if (!isOpen) return null;
    return <div className=fixed inset-0 bg-black/40 flex items-center justify-center z-50>...</div>;
  }

Use Variant 1 for simple single-action modals.
Use Variant 2 when modal has internal state that should reset cleanly on close.
---

## Pattern G -- Toast / Notification Feedback

NO TOAST LIBRARY EXISTS. package.json: no sonner, react-hot-toast, @radix-ui/react-toast.
All feedback uses Pattern C (inline div with state). Do not introduce a toast library.

---

## Pattern H -- Inline Editing (display/input toggle)

**Canonical citation:** `src/components/sga-hub/TeamGoalEditor.tsx:24-50`

  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState<string>(currentVal?.toString() ?? '');

  {isEditing ? (
    <> <input autoFocus value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
       <Button onClick={handleSave}>Save</Button> <Button onClick={handleCancel}>Cancel</Button>
    </>
  ) : (
    <span>{currentVal ?? '--'} <Button icon={Edit2} onClick={() => setIsEditing(true)} /></span>
  )}

Note: TeamGoalEditor uses alert() for validation. For 5b-1-UI, use Pattern C instead.
How to apply: Toggle isEditing on comment icon click; render <textarea autoFocus>.
For eval score fields, same toggle with <select> or <input type=number>. No library.

---

## Pattern I -- Optimistic Concurrency Control (OCC)

**Canonical citation:** `EvalDetailClient.tsx:190-233`

  body: JSON.stringify({ expected_edit_version: detail.edit_version })
  if (res.status === 409) {
    setConflict({ expectedVersion: ..., message: json.error ?? 'Conflict.' });
    return;  // do NOT auto-reload
  }
  await load();  // on success

editEvaluation bridge carries context: { evaluationId, expectedEditVersion }
so EvaluationConflictError.expectedVersion is populated from request context.
Server 409 only returns { ok: false, error: evaluation_conflict, message } -- no version.
Conflict banner must offer a Reload CTA calling load(). Do NOT auto-reload.
---

## Pattern J -- Sub-Route Navigation

**Canonical citations:**
- useRouter().push() for row clicks: QueueTab.tsx:164-174
- next/link for back nav: EvalDetailClient.tsx:268-273

Table row click with a11y keyboard support:
  <tr role=link tabIndex={0} onClick={() => router.push(href)}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(href); }
    }}
    className=cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50>

Back navigation via Link:
  <Link href=`/dashboard/call-intelligence?tab=${returnTab}`
    className=inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline>
    <ArrowLeft className=w-4 h-4 /> Back to queue
  </Link>

5b-1 renders within EvalDetailClient -- no new route needed.
returnTab is already threaded from the RSC page.tsx.

---

## Pattern K -- Date Formatting

**Canonical citations:**
- src/lib/utils/freshness-helpers.ts:8-23 -- formatRelativeTime(minutesAgo: number): string
- src/lib/utils/freshness-helpers.ts:32-47 -- formatAbsoluteTime(isoTimestamp: string): string
- QueueTab.tsx:30-49 -- local formatDate/formatDateOnly/formatTimeOnly (one-off helpers)

formatRelativeTime takes pre-computed minutes (not an ISO string):
  formatRelativeTime((Date.now() - new Date(isoTs).getTime()) / 60000)

date-fns v3.6.0 is installed but formatDistanceToNow is NOT used in call-intelligence.

INCONSISTENCY FLAGGED: QueueTab, EvalDetailClient, freshness-helpers all define
separate date helpers with no shared import across call-intelligence components.
Codebase drift. Prefer formatAbsoluteTime() from freshness-helpers for 5b-1-UI.
formatRelativeTimestamp(isoTs: string) does not exist -- plant in freshness-helpers if needed.

---

## Pattern L -- Selectable Text (transcript selection for citation)

NO PRECEDENT. window.getSelection() does not appear anywhere in the codebase.

Fresh pattern for 5b-1-UI:
  <div onMouseUp={() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;
    onTextSelected({ utteranceIndex, text });
  }}>
    {utterance.text}
  </div>

Fire callback to set citation state in parent. Do not manipulate the Selection.
Clear citation state on cancel or modal close.
---

## Pattern M -- Pills / Citation Badges

**Closest precedents:**
- Speaker attribution pills: src/app/dashboard/explore/CallDetailModal.tsx:247-256
- Status badges: QueueTab.tsx:51-58

Speaker pill classes (CallDetailModal.tsx:247-256):
  base:    inline-block px-2 py-0.5 text-xs rounded-full
  Rep:     bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200
  Advisor: bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200

Status badge base (QueueTab.tsx:57):
  inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium

For citation pills (utterance index links):
  bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200
Render as button if clicking should scroll to utterance; span otherwise.

MINOR DRIFT: QueueTab uses inline-flex items-center; CallDetailModal uses inline-block.
Prefer inline-flex for vertical alignment consistency.

---

## Pattern N -- Side Panel / Drawer

NO PRECEDENT. No @radix-ui packages in package.json. No slide-in drawer exists.

Fresh pattern for 5b-1-UI (append-in-place in sticky right pane, no animation for MVP):
  {pendingComment && (
    <div className=border-t border-gray-200 dark:border-gray-700 pt-4 mt-4>
      <h4 className=text-sm font-semibold dark:text-white mb-2>
        Add comment (utterance {pendingComment.utteranceIndex})
      </h4>
      <textarea rows={3} className=block w-full rounded border-gray-300 dark:bg-gray-900 text-sm />
      {commentError && <div className=text-xs text-red-600 dark:text-red-400>{commentError}</div>}
      <div className=mt-2 flex justify-end gap-2>
        <button onClick={() => setPendingComment(null)}>Cancel</button>
        <button onClick={handleSubmitComment}>Post comment</button>
      </div>
    </div>
  )}

With Pattern E two-pane layout, the composer lives in the right sticky pane.
Side-panel effect comes from layout, not a drawer component.
---

## Pattern O -- Coaching DB Reads (pg Pool, not Prisma)

**Canonical citations:**
- Pool singleton: src/lib/coachingDb.ts:36-46
- Query pattern: src/lib/queries/call-intelligence-evaluations.ts:237-284

Pool singleton via globalThis (coachingDb.ts:36-46):
  function getCoachingPool(): Pool {
    if (!globalThis.__coachingPool) {
      globalThis.__coachingPool = new Pool({
        connectionString: process.env.SALES_COACHING_DATABASE_URL_UNPOOLED,
        ssl: { rejectUnauthorized: false }, max: 5,
        idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000,
      });
    }
    return globalThis.__coachingPool;
  }

Query pattern (call-intelligence-evaluations.ts:238-283):
  if (!UUID_RE.test(evaluationId)) return null;  // validate UUID before DB hit
  const { rows } = await pool.query<RawRow>(sql, [evaluationId]);  // positional params
  // pg-node returns NUMERIC as string -- always coerce:
  overall_score: row.overall_score === null ? null : Number(row.overall_score)

Direct pool queries only for data not in the sales-coaching HTTP API.
Transcript comments + my-content-refinements go through salesCoachingClient (HTTP bridge).
call_transcripts LEFT JOIN already in getEvaluationDetail (line 269).
Add new DB functions to call-intelligence-evaluations.ts.

---

## Pattern P -- Data Refresh (useCallback load + await load())

**Canonical citation:** EvalDetailClient.tsx:163-184 and :227

  const load = useCallback(async () => {
    setLoading(true); setError(null); setConflict(null);
    try {
      const res = await fetch(`/api/call-intelligence/evaluations/${id}`,
                              { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? `HTTP ${res.status}`); return; }
      setDetail(json as EvaluationDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  // After successful mutation: await load()

No SWR, no React Query. Refresh is always await load() after a successful mutation.

For independent comment refresh: define loadComments = useCallback(...) scoped to
evaluationId, and call await loadComments() after comment POST.
Keep separate from main load() to avoid full-page re-render on comment add.

---

## Consistency Report

| Pattern | Consistent? | Notes |
|---------|-------------|-------|
| RSC auth guard | Yes | getServerSession -> getSessionPermissions -> redirect -> Client |
| Dark mode Cards | Yes | dark:bg-gray-800 dark:border-gray-700 on every Card |
| Modal backdrop | Yes | fixed inset-0 bg-black/40 flex items-center justify-center z-50 |
| Error inline div | Yes | text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded |
| Date helpers | Drift | QueueTab, EvalDetailClient, freshness-helpers all define separate helpers |
| load() refresh | Yes | useCallback + useEffect + await load() after mutation |
| OCC version | Yes | Always reads detail.edit_version from React state |
| Pill base classes | Minor drift | QueueTab inline-flex; CallDetailModal inline-block |
| No external libs | Yes | No SWR, React Query, toast, Radix UI in call-intelligence |