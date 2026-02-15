# Per-User Read-Only vs. Edit Enforcement — Codebase Investigation

> **Purpose:** This document contains phased investigation questions that Claude Code must execute against the Savvy Dashboard repo (`russellmoss/dashboard`) **before** writing the implementation guide for per-user read-only vs. edit enforcement. Each phase targets a specific architectural concern. Answers should be recorded inline so this document becomes the codebase knowledge base for implementation.
>
> **Scope:** This document covers **read-only vs. edit toggles** — the ability for an admin to grant a user access to a page but restrict them to view-only mode, preventing all create/update/delete actions. This is the companion to the "Per-User Page Access Overrides" investigation document, which covers page visibility toggles.
>
> **Prerequisite:** The page access overrides investigation should be completed first. This document assumes that:
> 1. A `UserPageOverride` table (or equivalent) exists in Prisma/Neon
> 2. Per-user `allowedPages` resolution is already implemented
> 3. The JWT/session pipeline already carries resolved permissions
>
> This investigation extends that foundation by adding a `canEdit` dimension per page per user.
>
> **Target pages for edit enforcement:** SGA Hub, SGA Management, Settings (user management), and GC Hub. These are the four pages with known mutation functionality.
>
> **How to use:** Execute each phase sequentially. Use `cat`, `grep`, `find`, and file reads against the repo. Record exact file paths, line numbers, function signatures, and code snippets. Do NOT skip any question — gaps here become bugs in implementation.

---

## Phase 1: Mutation Inventory — SGA Hub (Page 8)

**Goal:** Produce a complete catalog of every user-editable action on the SGA Hub page so we know exactly what to disable in read-only mode.

### 1.1 — SGA Hub Component Tree
- **File:** `src/app/dashboard/sga-hub/SGAHubContent.tsx`
- **Question:** Map the complete component tree. For each tab (Leaderboard, Weekly Goals, Closed Lost Follow-Up, Quarterly Progress, Activity), list:
  1. The component responsible for rendering it
  2. Whether it contains any forms, editable fields, buttons that trigger mutations, or inline editing
  3. The specific user actions available (e.g., "set weekly goal," "mark as contacted," "add note")
- **Why:** We need a complete action inventory to know what to disable. Missing even one mutation means a read-only user can still edit something.
- **Finding:**

**File structure:**
```
src/app/dashboard/sga-hub/
  - page.tsx
  - SGAHubContent.tsx (912 lines, main orchestrator)

src/components/sga-hub/ (24 components)
  - SGAHubTabs.tsx (tab navigation)
  - LeaderboardTable.tsx, LeaderboardFilters.tsx
  - WeeklyGoalsTable.tsx, WeeklyGoalEditor.tsx
  - ClosedLostFollowUpTabs.tsx, ClosedLostTable.tsx, ClosedLostFilters.tsx
  - ReEngagementOpportunitiesTable.tsx, ReEngagementFilters.tsx
  - AdminQuarterlyProgressView.tsx, QuarterlyProgressCard.tsx, QuarterlyProgressChart.tsx
  - TeamGoalEditor.tsx, BulkGoalEditor.tsx, IndividualGoalEditor.tsx
  - AdminSGATable.tsx, SGABreakdownTable.tsx, SQODetailTable.tsx
  - MetricDrillDownModal.tsx, ClickableMetricValue.tsx, StatusSummaryStrip.tsx, TeamProgressCard.tsx
```

**Tab-by-tab component tree:**

| Tab | Components | Has Mutations? | User Actions |
|-----|------------|----------------|--------------|
| **Leaderboard** | `LeaderboardFilters`, `LeaderboardTable` | ❌ NO | Filter data, click SQO to drill down (read-only) |
| **Weekly Goals** | `WeeklyGoalsTable`, `WeeklyGoalEditor` | ✅ YES | Edit weekly goals (initial calls, qualification calls, SQO targets) |
| **Closed Lost Follow-Up** | `ClosedLostFollowUpTabs` → `ClosedLostTable`, `ReEngagementOpportunitiesTable` | ❌ NO | View records, click to drill down (read-only) |
| **Quarterly Progress** | SGA view: `QuarterlyProgressCard`, `QuarterlyProgressChart`, `SQODetailTable`<br>Admin view: `AdminQuarterlyProgressView` → `TeamGoalEditor`, `AdminSGATable`, `StatusSummaryStrip`, `TeamProgressCard` | ✅ YES (Admin only) | Admins: Edit manager quarterly goal, bulk/individual SGA goal editing<br>SGAs: Export only (read-only) |
| **Activity** | `SGAActivityContent` (embedded from sga-activity page) | ❌ NO | View activity data, filter (read-only) |

**Summary:** Only 2 tabs have mutations: **Weekly Goals** (all users) and **Quarterly Progress** (admin view only).

### 1.2 — SGA Hub API Mutations
- **Question:** Run `grep -rn "POST\|PUT\|PATCH\|DELETE" src/app/api/sga-hub/` and list every mutation endpoint. For each, note:
  1. The HTTP method and path
  2. What it modifies (database table, external service, etc.)
  3. What permission check it currently performs
  4. Which UI component calls it
- **Why:** API routes are the enforcement backstop. Even if we disable buttons in the UI, a read-only user could hit the API directly. Every mutation endpoint needs a `canEdit` check.
- **Finding:**

**Mutation endpoints found:**

| # | Endpoint | Method | DB Table | Permission Check | UI Component |
|---|----------|--------|----------|------------------|--------------|
| 1 | `/api/sga-hub/weekly-goals` | POST | `WeeklyGoal` | Own goals: `['admin', 'manager', 'sga', 'sgm', 'revops_admin']`<br>Other's goals: `['admin', 'manager', 'revops_admin']` | `WeeklyGoalEditor.tsx:71`, `IndividualGoalEditor.tsx:95`, `BulkGoalEditor.tsx:88` |
| 2 | `/api/sga-hub/quarterly-goals` | POST | `QuarterlyGoal` | `['admin', 'manager', 'revops_admin']` only | `IndividualGoalEditor.tsx:125`, `BulkGoalEditor.tsx:101` |
| 3 | `/api/sga-hub/manager-quarterly-goal` | POST | `ManagerQuarterlyGoal` | `['admin', 'manager', 'revops_admin']` only | `TeamGoalEditor.tsx` via `dashboardApi.setManagerQuarterlyGoal()` |

**Non-mutation POSTs (queries with filter bodies):**
- `/api/sga-hub/leaderboard` — GET-like query with POST body for complex filters
- All other routes are GET-only: `closed-lost`, `re-engagement`, `admin-quarterly-progress`, `drill-down/*`, `weekly-actuals`, `quarterly-progress`, `sqo-details`, `leaderboard-sga-options`

### 1.3 — Weekly Goals Edit Flow
- **Question:** Trace the complete flow for editing a weekly goal:
  1. What component renders the edit UI? Paste the relevant JSX/form elements.
  2. What state management is involved (useState, form library, etc.)?
  3. What API endpoint does it call on submit?
  4. What does the API route check before allowing the write?
  5. Is there a loading/disabled state pattern already in place that we could reuse for read-only mode?
- **Why:** Weekly Goals is the most prominent edit feature in SGA Hub. Understanding this flow end-to-end gives us the pattern for disabling edits across the page.
- **Finding:**

**Complete flow traced:**

1. **Edit button in table** (`WeeklyGoalsTable.tsx:304-323`):
```tsx
{goal.canEdit ? (
  <Button size="xs" variant="secondary" onClick={() => onEditGoal(goal)}>
    Edit
  </Button>
) : (
  <div className="flex items-center gap-1">
    <span className="text-gray-400 text-xs">Edit</span>
    <InfoTooltip content="You can only edit goals for current or future weeks" />
  </div>
)}
```
The `canEdit` property is computed per-goal in `SGAHubContent.tsx:346`:
```tsx
canEdit: isAdmin || isCurrentWeek || isFutureWeek,
```

2. **Modal state** (`SGAHubContent.tsx:51-52, 360-367`):
```tsx
const [showGoalEditor, setShowGoalEditor] = useState(false);
const [editingGoal, setEditingGoal] = useState<WeeklyGoalWithActuals | null>(null);

const handleEditGoal = (goal: WeeklyGoalWithActuals) => {
  setEditingGoal(goal);
  setShowGoalEditor(true);
};
```

3. **Editor modal** (`WeeklyGoalEditor.tsx`):
   - Uses `useState` for each field (no form library)
   - Submits via `fetch('/api/sga-hub/weekly-goals', { method: 'POST', ... })`
   - Has `loading` state that disables Submit button

4. **API permission check** (`weekly-goals/route.ts:83-122`):
   - Authenticates session
   - If editing own goals: allows `['admin', 'manager', 'sga', 'sgm', 'revops_admin']`
   - If editing another user's goals (via `targetUserEmail`): restricts to `['admin', 'manager', 'revops_admin']`

5. **Existing disabled pattern** — YES, reusable:
   - `WeeklyGoalEditor.tsx:189,196` — Cancel/Save buttons use `disabled={loading}`
   - `WeeklyGoalsTable.tsx:304` — Edit button conditionally rendered based on `goal.canEdit`
   - Pattern: Use ternary to render disabled state OR hide entirely

**Key insight for read-only mode:** The existing `goal.canEdit` pattern is time-based. A new permission-based `canEditPage` check would sit at a higher level — hide the Edit button entirely (or disable it) for read-only users, regardless of whether the week is current/future.

### 1.4 — Closed Lost Follow-Up Actions
- **Question:** Examine the Closed Lost Follow-Up tab components. What actions can a user take? Specifically:
  1. Can they mark records as "contacted" or update status?
  2. Can they add notes or comments?
  3. Are there any bulk actions (select multiple, update all)?
  4. What API endpoints do these actions call?
- **Why:** This tab may have mutation actions that aren't obvious from the name. Need a complete inventory.
- **Finding:**

**Result: Closed Lost Follow-Up is ENTIRELY READ-ONLY.**

Verified via:
- `grep -n "export async function" src/app/api/sga-hub/closed-lost/route.ts` → Only `GET` handler (line 21)
- `grep -n "export async function" src/app/api/sga-hub/re-engagement/route.ts` → Only `GET` handler (line 16)
- `grep -n "onClick\|fetch\|POST\|PUT\|DELETE" src/components/sga-hub/ClosedLostTable.tsx` → Only sort/filter/drill-down clicks
- `grep -n "onClick\|fetch\|POST\|PUT\|DELETE" src/components/sga-hub/ReEngagementOpportunitiesTable.tsx` → Only sort/drill-down clicks

**User actions available (all read-only):**
1. View Closed Lost records with filtering/sorting
2. View Re-Engagement opportunities with filtering/sorting
3. Click records to open RecordDetailModal (read-only view)
4. Toggle "Show all" for admins vs SGAs

**No mutations exist:** No status updates, no notes, no bulk actions, no editable fields.

### 1.5 — SGA Hub Admin vs. SGA Actions
- **Question:** Are there any actions on SGA Hub that are already restricted to admin/manager roles? For example, can an SGA edit another SGA's goals, or only their own? Document every existing role-based action restriction within SGA Hub components.
- **Why:** Read-only mode interacts with existing role-based restrictions. If admins can already do things SGAs can't, we need to understand that matrix so `canEdit: false` doesn't conflict with existing logic.
- **Finding:**

**Role-based action matrix:**

| Action | SGA | SGM | Manager | Admin | RevOps Admin |
|--------|-----|-----|---------|-------|--------------|
| Edit own weekly goals (current/future weeks) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit own weekly goals (past weeks) | ❌ | ❌ | ✅ | ✅ | ✅ |
| Edit other users' weekly goals | ❌ | ❌ | ✅ | ✅ | ✅ |
| Set individual quarterly goals | ❌ | ❌ | ✅ | ✅ | ✅ |
| Bulk edit goals for multiple SGAs | ❌ | ❌ | ✅ | ✅ | ✅ |
| Set manager quarterly goal | ❌ | ❌ | ✅ | ✅ | ✅ |
| View AdminQuarterlyProgressView | ❌ | ❌ | ✅ | ✅ | ✅ |
| Export CSV | ✅ | ✅ | ✅ | ✅ | ✅ |

**Key code references:**

1. `isAdmin` check (`SGAHubContent.tsx:37`):
```tsx
const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager' || permissions?.role === 'revops_admin';
```

2. Time-based edit restriction for non-admins (`SGAHubContent.tsx:346`):
```tsx
canEdit: isAdmin || isCurrentWeek || isFutureWeek,
```

3. API-level restrictions:
   - `weekly-goals/route.ts:113-115`: SGAs can only edit own goals
   - `quarterly-goals/route.ts:147-149`: Admin/manager/revops_admin only
   - `manager-quarterly-goal/route.ts:91-93`: Admin/manager/revops_admin only

**Key insight for `canEdit` implementation:**
A per-page `canEdit: false` override should block ALL mutations for that user on SGA Hub, regardless of role. This is additive to existing role restrictions (not a replacement). A manager with `canEdit: false` for page 8 should lose all edit capabilities, even though their role normally allows them.

---

## Phase 1 Summary — SGA Hub Mutation Inventory

| # | User Action | Component File | API Endpoint | HTTP Method | Current Auth Check |
|---|-------------|----------------|--------------|-------------|-------------------|
| 1 | Edit own weekly goal | `WeeklyGoalEditor.tsx:71` | `/api/sga-hub/weekly-goals` | POST | Role in [admin,manager,sga,sgm,revops_admin] |
| 2 | Edit other user's weekly goal (admin) | `IndividualGoalEditor.tsx:95` | `/api/sga-hub/weekly-goals` | POST | Role in [admin,manager,revops_admin] + targetUserEmail |
| 3 | Bulk edit weekly goals (admin) | `BulkGoalEditor.tsx:88` | `/api/sga-hub/weekly-goals` | POST | Role in [admin,manager,revops_admin] |
| 4 | Set individual quarterly goal (admin) | `IndividualGoalEditor.tsx:125` | `/api/sga-hub/quarterly-goals` | POST | Role in [admin,manager,revops_admin] |
| 5 | Bulk set quarterly goals (admin) | `BulkGoalEditor.tsx:101` | `/api/sga-hub/quarterly-goals` | POST | Role in [admin,manager,revops_admin] |
| 6 | Set manager quarterly goal (admin) | `TeamGoalEditor.tsx:37` | `/api/sga-hub/manager-quarterly-goal` | POST | Role in [admin,manager,revops_admin] |

**Read-only tabs (no mutations):** Leaderboard, Closed Lost Follow-Up, Activity

---

## Phase 2: Mutation Inventory — SGA Management (Page 9)

**Goal:** Complete catalog of editable actions on the SGA Management page.

### 2.1 — SGA Management Component Structure
- **File:** `src/app/dashboard/sga-management/`
- **Question:** List all files in this directory and subdirectories. Paste the main page component and the primary content component. What is the purpose of this page — what can managers/admins do here that they can't do in SGA Hub?
- **Why:** Need to understand the page's purpose and scope before inventorying its mutations.
- **Finding:**

**File structure:**
```
src/app/dashboard/sga-management/
  - page.tsx (30 lines - server component with role check)
  - SGAManagementContent.tsx (565 lines - client component)

NO dedicated components directory
NO dedicated API directory
```

**Purpose:** SGA Management is an **admin-only dashboard** for managing all SGAs' goals at once. It provides:
1. A table view of all SGAs with their current week/quarter goals and actuals
2. "Edit Weekly" and "Edit Quarterly" buttons per SGA row
3. A "Bulk Edit" button to set goals for multiple SGAs at once
4. Summary stats (total SGAs, behind pacing count)

**What it does that SGA Hub doesn't:**
- Shows ALL SGAs in one table (SGA Hub focuses on the logged-in user's data)
- Quick access to edit any SGA's goals without switching views
- Bulk editing across multiple SGAs simultaneously

**Access control** (`page.tsx:24-27`):
```tsx
// Only admin, manager, and revops_admin can access this page
if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
  redirect('/dashboard');
}
```

### 2.2 — SGA Management Mutations
- **Question:** Run `grep -rn "POST\|PUT\|PATCH\|DELETE" src/app/api/sga-management/` (or the relevant API directory). Also search the component files for `fetch(` calls, form submissions, and button onClick handlers that trigger data changes. For each mutation found:
  1. What action does the user take in the UI?
  2. What API endpoint is called?
  3. What data is modified?
  4. What permission check exists today?
- **Why:** Same rationale as SGA Hub — complete mutation inventory for enforcement.
- **Finding:**

**Key finding: SGA Management has NO dedicated API endpoints.**

All mutations reuse the same SGA Hub API endpoints:
- `/api/sga-hub/weekly-goals` — POST
- `/api/sga-hub/quarterly-goals` — POST

The only API specific to SGA Management is read-only:
- `/api/admin/sga-overview` — GET only (fetches all SGAs' overview data)

**Mutation actions on page:**

| # | User Action | Component | API Endpoint | Permission Check |
|---|-------------|-----------|--------------|------------------|
| 1 | Click "Edit Weekly" on SGA row | `AdminSGATable.tsx:294` → `IndividualGoalEditor` | `/api/sga-hub/weekly-goals` | admin/manager/revops_admin |
| 2 | Click "Edit Quarterly" on SGA row | `AdminSGATable.tsx:305` → `IndividualGoalEditor` | `/api/sga-hub/quarterly-goals` | admin/manager/revops_admin |
| 3 | Click "Bulk Edit" button | `SGAManagementContent.tsx:242` → `BulkGoalEditor` | `/api/sga-hub/weekly-goals` or `/api/sga-hub/quarterly-goals` | admin/manager/revops_admin |

**Important insight:** Because SGA Management reuses SGA Hub's API endpoints, the API-level `canEdit` enforcement for page 8 (SGA Hub) will automatically protect page 9 (SGA Management) as well — IF we implement `canEdit` checks per API endpoint rather than per page.

### 2.3 — SGA Management Table/Form Patterns
- **Question:** Does SGA Management use editable tables, inline editing, modal forms, or a different pattern? Paste examples of the edit UI components. Are there any shared components with SGA Hub?
- **Why:** The UI disable pattern depends on the edit pattern. Inline editable cells need a different approach than modal forms or dedicated edit pages.
- **Finding:**

**Pattern: Modal forms (no inline editing)**

SGA Management uses the **exact same modal components** as SGA Hub's admin view:
- `BulkGoalEditor` (from `@/components/sga-hub/BulkGoalEditor.tsx`)
- `IndividualGoalEditor` (from `@/components/sga-hub/IndividualGoalEditor.tsx`)

**Edit trigger buttons** (`AdminSGATable.tsx:288-308`):
```tsx
<Button size="xs" variant="secondary" icon={Pencil}
  onClick={(e) => {
    e.stopPropagation();
    onEditGoal(overview.userEmail, 'weekly');
  }}>
  Edit Weekly
</Button>
<Button size="xs" variant="secondary" icon={Pencil}
  onClick={(e) => {
    e.stopPropagation();
    onEditGoal(overview.userEmail, 'quarterly');
  }}>
  Edit Quarterly
</Button>
```

**Bulk edit trigger** (`SGAManagementContent.tsx:242`):
```tsx
<Button onClick={() => setShowBulkEditor(true)} icon={Settings}>
  Bulk Edit Goals
</Button>
```

**Shared components with SGA Hub:**
- `AdminSGATable` — shared, used in both SGA Hub (Quarterly Progress admin view) and SGA Management
- `BulkGoalEditor` — shared
- `IndividualGoalEditor` — shared
- `MetricDrillDownModal` — shared (for viewing, not editing)
- `RecordDetailModal` — shared (for viewing, not editing)

**Key insight for read-only implementation:** Disabling edits on SGA Management is straightforward:
1. Hide/disable the "Bulk Edit Goals" button
2. Hide/disable the "Edit Weekly" and "Edit Quarterly" buttons in AdminSGATable
3. Since the same components are used in SGA Hub, changes will apply to both pages

---

## Phase 2 Summary — SGA Management Mutation Inventory

| # | User Action | Component File | API Endpoint | HTTP Method | Current Auth Check |
|---|-------------|----------------|--------------|-------------|-------------------|
| 1 | Edit individual SGA weekly goal | `AdminSGATable.tsx:294` → `IndividualGoalEditor` | `/api/sga-hub/weekly-goals` | POST | Page-level role check (admin/manager/revops_admin) + API role check |
| 2 | Edit individual SGA quarterly goal | `AdminSGATable.tsx:305` → `IndividualGoalEditor` | `/api/sga-hub/quarterly-goals` | POST | Page-level role check + API role check |
| 3 | Bulk edit weekly/quarterly goals | `SGAManagementContent.tsx:242` → `BulkGoalEditor` | Same as above | POST | Page-level role check + API role check |

**Key insight:** SGA Management reuses SGA Hub's API endpoints. Implementing `canEdit` at the API level for `/api/sga-hub/*` will protect both pages simultaneously.

---

## Phase 3: Mutation Inventory — Settings / User Management (Page 7)

**Goal:** Complete catalog of editable actions on the Settings page, specifically user management.

### 3.1 — Settings Page Tabs/Sections
- **File:** `src/app/dashboard/settings/`
- **Question:** List all tabs or sections on the Settings page. Which sections involve data mutation? Which are display-only?
- **Why:** Settings likely has multiple sections (user management, maybe profile, maybe app config). Only the mutation sections need read-only enforcement. Display sections are already "read-only" by nature.
- **Finding:**

**File structure:**
```
src/app/dashboard/settings/
  - page.tsx (67 lines - client component)

src/components/settings/
  - UserManagement.tsx (228 lines - user list and actions)
  - UserModal.tsx (create/edit user form)
  - DeleteConfirmModal.tsx
  - ResetPasswordModal.tsx
  - ChangePasswordModal.tsx (self-service)

src/app/api/users/
  - route.ts (GET list, POST create)
  - [id]/route.ts (GET one, PUT update, DELETE)
  - [id]/reset-password/route.ts (POST)
  - me/change-password/route.ts (POST - self-service)
```

**Page sections:**

| Section | Visibility | Has Mutations? | Description |
|---------|------------|----------------|-------------|
| **My Account** | All users | ✅ YES (self-service) | "Change My Password" button |
| **User Management** | `canManageUsers` only | ✅ YES (admin) | Full CRUD: Add, Edit, Delete, Reset Password |

**Conditional rendering** (`page.tsx:57-59`):
```tsx
{permissions?.canManageUsers && (
  <UserManagement currentUserEmail={session?.user?.email || ''} />
)}
```

### 3.2 — User Management CRUD
- **Question:** Document every user management action available on the Settings page:
  1. Create user — what component, what API endpoint, what form fields?
  2. Edit user — what component, what API endpoint, what can be changed?
  3. Delete/deactivate user — what component, what API endpoint?
  4. Reset password — what component, what API endpoint?
  5. Any other actions (bulk operations, import/export users)?

  For each, note which roles can currently perform the action.
- **Why:** User management is sensitive. A read-only override on Settings should prevent all user CRUD while still allowing the user to view the user list and perhaps their own profile.
- **Finding:**

**Admin CRUD actions (require `canManageUsers: true`):**

| # | Action | Component | API Endpoint | Method | Permission Check |
|---|--------|-----------|--------------|--------|------------------|
| 1 | Create user | `UserModal.tsx:112` | `/api/users` | POST | `canManageUsers` |
| 2 | Edit user | `UserModal.tsx:112` | `/api/users/[id]` | PUT | `canManageUsers` |
| 3 | Delete user | `DeleteConfirmModal.tsx:25` | `/api/users/[id]` | DELETE | `canManageUsers` + not self |
| 4 | Reset password | `ResetPasswordModal.tsx:40` | `/api/users/[id]/reset-password` | POST | `canManageUsers` |

**UI action buttons** (`UserManagement.tsx:171-196`):
```tsx
<button onClick={() => handleResetPassword(user)} title="Reset Password">
  <Key className="w-4 h-4" />
</button>
<button onClick={() => handleEditUser(user)} title="Edit User">
  <Pencil className="w-4 h-4" />
</button>
{user.email !== currentUserEmail && (
  <button onClick={() => handleDeleteUser(user)} title="Delete User">
    <Trash2 className="w-4 h-4" />
  </button>
)}
```

**Add User button** (`UserManagement.tsx:120`):
```tsx
<Button icon={Plus} onClick={handleAddUser}>Add User</Button>
```

**Bulk operations:** None exist currently.

**Roles with `canManageUsers: true`:** `admin`, `revops_admin` only (per `ROLE_PERMISSIONS`).

### 3.3 — Settings Self-Service vs. Admin Actions
- **Question:** Are there any actions on Settings that a user performs on their own account (e.g., change own password, update profile)? These should probably NOT be blocked by read-only mode — a user should always be able to manage their own credentials.
- **Why:** Read-only on Settings is nuanced. "Can't manage other users" ≠ "can't change my own password." We need to distinguish between admin actions and self-service actions.
- **Finding:**

**Self-service action (available to ALL users):**

| Action | Component | API Endpoint | Method | Permission Check |
|--------|-----------|--------------|--------|------------------|
| Change own password | `ChangePasswordModal.tsx:58` | `/api/users/me/change-password` | POST | Session only (any logged-in user) |

**UI trigger** (`page.tsx:48-54`):
```tsx
<button onClick={() => setShowChangePassword(true)}
  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg">
  Change My Password
</button>
```

**API authorization** (`me/change-password/route.ts:11-15`):
```tsx
if (!session?.user?.email) {
  return NextResponse.json({ error: 'You must be logged in...' }, { status: 401 });
}
// No role check - any authenticated user can change their own password
```

**Key distinction for read-only implementation:**
- **Self-service actions** (Change My Password): Should NEVER be blocked by `canEdit: false`. Users must always be able to manage their own credentials.
- **Admin actions** (User CRUD): Should be blocked by `canEdit: false` for the Settings page.

**Recommendation:** The `canEdit` check for Settings page should only apply to the User Management section, NOT to the My Account section. Implementation approach:
1. Keep "Change My Password" button always enabled
2. Hide/disable the entire User Management section OR individual action buttons based on `canEdit`

### 3.4 — canManageUsers Flag
- **Question:** How is the existing `canManageUsers` permission flag used in Settings components? Run `grep -rn "canManageUsers" src/` and list every usage. Does it hide UI elements, disable them, or both?
- **Why:** `canManageUsers` is conceptually similar to what we're building — it already controls edit capability. Understanding how it's implemented gives us a proven pattern to follow for the broader `canEdit` concept.
- **Finding:**

**All usages of `canManageUsers`:**

| Location | Type | Usage Pattern |
|----------|------|---------------|
| `page.tsx:57` | UI | Conditional render: `{permissions?.canManageUsers && (<UserManagement />)}` |
| `users/route.ts:25` (GET) | API | Returns 403 if false |
| `users/route.ts:65` (POST) | API | Returns 403 if false |
| `users/[id]/route.ts:30` (GET) | API | Returns 403 if false |
| `users/[id]/route.ts:81` (PUT) | API | Returns 403 if false |
| `users/[id]/route.ts:160` (DELETE) | API | Returns 403 if false |
| `users/[id]/reset-password/route.ts:28` | API | Returns 403 if false |
| `permissions.ts` (8 places) | Config | Role definitions |
| `types/user.ts:25` | Type | Interface definition |

**Pattern analysis:**

1. **UI pattern: HIDE entire section** (not disable)
   - The User Management component is not rendered at all if `canManageUsers` is false
   - Pattern: `{flag && <Component />}`

2. **API pattern: Check and return 403**
   ```tsx
   if (!permissions.canManageUsers) {
     return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
   }
   ```

**Key insight for `canEdit` implementation:**
The `canManageUsers` pattern is **binary hide/show**, not disable. This is simpler but provides no indication to the user that functionality exists but is restricted. For `canEdit`, we may want a different approach:
- Option A: Same pattern (hide) — simpler, but user doesn't know the functionality exists
- Option B: Show but disable — more complex, but user sees what they're missing

**Recommendation:** For consistency with existing patterns, use the **hide pattern** for `canEdit`. However, add a visual indicator (banner/badge) so users know they're in read-only mode.

---

## Phase 3 Summary — Settings / User Management Mutation Inventory

| # | User Action | Component File | API Endpoint | HTTP Method | Current Auth Check | Self-Service? |
|---|-------------|----------------|--------------|-------------|-------------------|---------------|
| 1 | Change own password | `ChangePasswordModal.tsx:58` | `/api/users/me/change-password` | POST | Session only | ✅ YES |
| 2 | Create user | `UserModal.tsx:112` | `/api/users` | POST | `canManageUsers` | ❌ NO |
| 3 | Edit user | `UserModal.tsx:112` | `/api/users/[id]` | PUT | `canManageUsers` | ❌ NO |
| 4 | Delete user | `DeleteConfirmModal.tsx:25` | `/api/users/[id]` | DELETE | `canManageUsers` | ❌ NO |
| 5 | Reset user password | `ResetPasswordModal.tsx:40` | `/api/users/[id]/reset-password` | POST | `canManageUsers` | ❌ NO |

**Key decisions for Settings `canEdit` implementation:**
1. Self-service actions (row 1) should ALWAYS be allowed, regardless of `canEdit`
2. Admin actions (rows 2-5) should be blocked when `canEdit: false`
3. The existing `canManageUsers` pattern (hide entire section) can be extended for `canEdit`

---

## Phase 4: Mutation Inventory — GC Hub (Page 16)

**Goal:** Complete catalog of editable actions on the GC Hub page.

### 4.1 — GC Hub Component Structure
- **File:** `src/app/dashboard/gc-hub/`
- **Question:** List all files in this directory and subdirectories. Is the GC Hub fully implemented or still in progress? What tabs or sections exist? What data does it display?
- **Why:** GC Hub is newer — it may have a cleaner component structure that's easier to add read-only support to, or it may still be under construction.
- **Finding:**

**File structure:**
```
src/app/dashboard/gc-hub/
  - page.tsx (35 lines - server component with allowedPages check)
  - GCHubContent.tsx (328 lines - main client component)

src/components/gc-hub/ (10 components)
  - GCHubTabs.tsx (tab navigation)
  - GCHubFilterBar.tsx (date/account/advisor filters)
  - GCHubAdminBar.tsx (sync status + "Sync Now" button - admin only)
  - GCHubScorecards.tsx (summary metrics)
  - GCHubAdvisorTable.tsx (main advisor table)
  - GCHubAdvisorModal.tsx (advisor detail modal with edit capabilities)
  - GCHubOverrideModal.tsx (edit/add period modal)
  - AdvisorCountChart.tsx, RevenueChart.tsx, RevenuePerAdvisorChart.tsx (charts)

src/app/api/gc-hub/ (8 routes)
  - advisors/route.ts (GET list - uses POST for filter body)
  - advisor-detail/route.ts (GET detail)
  - filters/route.ts (GET filter options)
  - summary/route.ts (GET summary metrics)
  - sync-status/route.ts (GET sync status)
  - override/route.ts (PUT - MUTATION)
  - period/route.ts (POST/DELETE - MUTATIONS)
  - manual-sync/route.ts (POST - MUTATION)
```

**Implementation status:** Fully implemented with complete CRUD functionality.

**Tabs/sections:**
- **Summary tab**: Scorecards + charts (read-only view)
- **Advisors tab**: Advisor table with drill-down to advisor modal

**User types:**
- `admin` / `revops_admin`: Full access including edit capabilities
- `capital_partner`: View-only with anonymized data and date restrictions

### 4.2 — GC Hub Inline Editing
- **Question:** The GC Hub implementation guide mentioned inline data editing with audit trails. Search for:
  1. Editable table cells or inline edit components
  2. API endpoints for saving inline edits
  3. Audit trail logging for edits
  4. Any existing "edit mode" toggle pattern

  Run `grep -rn "edit\|inline\|save\|update\|mutation" src/app/dashboard/gc-hub/ src/components/gc-hub/ src/app/api/gc-hub/` (adjust paths as needed).
- **Why:** If GC Hub already has an "edit mode" concept, we can leverage that pattern for the read-only enforcement rather than building something new.
- **Finding:**

**GC Hub already has a `canEdit` prop pattern!** This is a model for other pages.

**Mutation API endpoints:**

| # | Endpoint | Method | Purpose | Permission Check | Audit Trail |
|---|----------|--------|---------|------------------|-------------|
| 1 | `/api/gc-hub/override` | PUT | Edit period values (revenue, commissions) | `role === 'admin' \|\| 'revops_admin'` | ✅ `isManuallyOverridden`, `overriddenBy`, `overriddenAt`, `overrideReason` |
| 2 | `/api/gc-hub/period` | POST | Add new period for advisor | Same + `allowedPages.includes(16)` | ✅ Logged via `logger.info` |
| 3 | `/api/gc-hub/period` | DELETE | Delete period | Same + `allowedPages.includes(16)` | ✅ Logged via `logger.info` |
| 4 | `/api/gc-hub/manual-sync` | POST | Trigger data sync from source | `role === 'admin' \|\| 'revops_admin'` | ✅ `GcSyncLog` table entry |

**UI edit pattern** (`GCHubAdvisorModal.tsx`):
```tsx
// Props interface (line 28)
canEdit?: boolean;

// Usage (lines 266, 296, 323) - conditionally show buttons
{canEdit && (
  <button onClick={() => setOverridePeriod({...})}>Add period</button>
)}
{canEdit && (
  <th>Actions</th>
)}
{canEdit && (
  <button onClick={() => setOverridePeriod({...})}><Pencil /></button>
)}
```

**How `canEdit` is passed** (`GCHubContent.tsx:319-323`):
```tsx
{selectedAdvisor && (isAdmin || isCapitalPartner) && (
  <GCHubAdvisorModal
    advisorName={selectedAdvisor}
    onClose={() => setSelectedAdvisor(null)}
    canEdit={isAdmin}  // Only admin/revops_admin can edit
  />
)}
```

**Key insight:** GC Hub's `canEdit` pattern is exactly what we need for the broader implementation. It:
1. Passes edit capability as a prop from parent to child
2. Conditionally renders edit buttons (hide, not disable)
3. Has API-level enforcement as a backstop

### 4.3 — GC Hub Capital Partner vs. Admin Actions
- **Question:** What actions can a `capital_partner` user take on GC Hub vs. an `admin`/`revops_admin`? Are there already different permission levels within the GC Hub? Document the existing edit permission matrix.
- **Why:** GC Hub may already have a two-tier system (capital partners see anonymized/restricted data, admins see everything). The read-only toggle needs to work within this existing matrix.
- **Finding:**

**Two-tier permission system already exists:**

| Capability | `capital_partner` | `admin` / `revops_admin` |
|------------|-------------------|--------------------------|
| View Summary tab | ✅ | ✅ |
| View Advisors tab | ✅ | ✅ |
| See real advisor names | ❌ (anonymized) | ✅ |
| Date range restriction | ✅ (min start date enforced) | ❌ (full range) |
| View advisor detail modal | ✅ | ✅ |
| Add period | ❌ | ✅ |
| Edit period values | ❌ | ✅ |
| Delete period | ❌ | ✅ |
| Trigger sync | ❌ | ✅ |
| Export CSV | ✅ | ✅ |

**Role checks in code** (`GCHubContent.tsx:38-39`):
```tsx
const isAdmin = permissions?.role === 'admin' || permissions?.role === 'revops_admin';
const isCapitalPartner = permissions?.role === 'capital_partner';
```

**Admin bar visibility** (`GCHubContent.tsx:255-256`):
```tsx
{isAdmin && (
  <GCHubAdminBar syncStatus={syncStatus} onSyncComplete={handleSyncComplete} />
)}
```

**Key insight for `canEdit` implementation:**
GC Hub's existing two-tier system (capital_partner = view-only, admin = full edit) is **exactly analogous** to what `canEdit: false` should do. The pattern is proven:
1. Pass `canEdit` prop from parent content component
2. Child components conditionally render edit UI based on prop
3. API routes check role as a backstop

For per-user `canEdit` overrides, we extend this:
- Instead of `canEdit={isAdmin}`, use `canEdit={isAdmin && pageCanEdit}`
- Where `pageCanEdit` comes from the user's resolved permissions

---

## Phase 4 Summary — GC Hub Mutation Inventory

| # | User Action | Component File | API Endpoint | HTTP Method | Current Auth Check |
|---|-------------|----------------|--------------|-------------|-------------------|
| 1 | Edit period values | `GCHubOverrideModal.tsx:144` | `/api/gc-hub/override` | PUT | admin/revops_admin role |
| 2 | Add period | `GCHubOverrideModal.tsx:144` | `/api/gc-hub/period` | POST | admin/revops_admin + page 16 |
| 3 | Delete period | `GCHubOverrideModal.tsx:229` | `/api/gc-hub/period` | DELETE | admin/revops_admin + page 16 |
| 4 | Trigger sync | `GCHubAdminBar.tsx:27` | `/api/gc-hub/manual-sync` | POST | admin/revops_admin role |

**Key finding:** GC Hub ALREADY implements the `canEdit` prop pattern we need. This is the template for implementing read-only mode across other pages.

---

## Phase 5: Existing Patterns for Conditional UI Disabling

**Goal:** Find any existing patterns in the codebase for disabling UI elements based on permissions, so we can reuse them rather than inventing a new approach.

### 5.1 — Disabled/ReadOnly Props Survey
- **Question:** Run `grep -rn "disabled=\|readOnly=\|isDisabled\|isReadOnly\|canEdit\|editable" src/components/ src/app/dashboard/` and categorize the results:
  1. Components that accept a `disabled` or `readOnly` prop
  2. Places where edit capability is conditionally rendered based on role or permission
  3. Any shared wrapper components for "view vs. edit" modes
- **Why:** If there's an existing pattern (e.g., a `<EditableField disabled={!canEdit}>` component), we should use it everywhere for consistency. If not, we need to design one.
- **Finding:**

**Categories of disabled/canEdit usage found:**

**1. Loading/async state disabling (most common):**
```tsx
disabled={loading}
disabled={saving || deleting}
disabled={isExporting}
disabled={isRefreshing || transferState !== 'idle'}
```
Pattern: `disabled={asyncState}` — used 50+ times across components.

**2. `canEdit` prop pattern (role-based):**

| Component | Definition | Usage |
|-----------|------------|-------|
| `AdvisorDrillDownModal.tsx:126` | `const canEdit = userRole ? ['admin', 'revops_admin', 'manager'].includes(userRole) : false;` | `{canEdit && (<Pencil />)}` |
| `GCHubAdvisorModal.tsx:28` | `canEdit?: boolean;` (prop) | `{canEdit && (<Button>Add period</Button>)}` |
| `SavedReportsDropdown.tsx:210` | `canEdit: boolean;` (prop) | `{canEdit && (<Button>Edit</Button>)}` |
| `WeeklyGoalsTable.tsx:304` | `goal.canEdit` (data property) | `{goal.canEdit ? (<Button>) : (<DisabledText>)}` |

**3. No shared wrapper component exists** — Each component implements its own conditional rendering.

**Key patterns identified:**
- **Hide pattern**: `{canEdit && <Component />}` — button not rendered at all
- **Conditional render pattern**: `{canEdit ? <Button> : <DisabledLabel>}` — shows disabled state
- **Prop-based**: Parent computes `canEdit`, passes to children

### 5.2 — canManageUsers Implementation Pattern
- **Question:** Deep dive into how `canManageUsers` is used in the Settings UI. When `canManageUsers` is false:
  1. Are action buttons hidden entirely, or shown but disabled/grayed out?
  2. Is there a visual indicator that the user is in "view-only" mode?
  3. How is this prop passed from the page component down to child components?
  4. Is the check at the parent level (don't render the section) or at the individual button level?
- **Why:** This is the closest existing analog to what we're building. The UX pattern used here should inform the `canEdit` pattern.
- **Finding:**

**Already documented in Phase 3.4.** Summary:

1. **Hide pattern** — Entire UserManagement section not rendered when `canManageUsers` is false
2. **No visual indicator** — Non-admin users don't see the section at all, so no "view-only" message needed
3. **Check at parent level** — `page.tsx` does `{permissions?.canManageUsers && <UserManagement />}`
4. **Not prop-drilled** — Component not rendered at all, so no need to pass the flag down

### 5.3 — canManageRequests Pattern
- **Question:** Similarly, examine how `canManageRequests` works in the Dashboard Requests page. When a non-revops_admin views Requests, what can they see vs. do? How is the distinction implemented in components?
- **Why:** Another existing edit-permission pattern to learn from.
- **Finding:**

**`canManageRequests` is the most comprehensive permission-flag implementation in the codebase.**

**How it's passed (prop drilling 4+ levels):**
```
page.tsx → RequestsPageContent → KanbanBoard → KanbanColumn → RequestCard
                              → RequestFilters
                              → RequestDetailModal
```

**What it controls:**

| UI Element | When `false` | When `true` |
|------------|-------------|-------------|
| Analytics tab | Hidden | Visible |
| Status filters | Hidden | Visible |
| Drag-and-drop cards | Disabled (`isDraggable={canManageRequests}`) | Enabled |
| Status change dropdown | Hidden | Visible |
| Archive/Unarchive buttons | Hidden | Visible |
| Private badge on cards | Hidden | Visible |

**Code patterns:**
```tsx
// Tab filtering (RequestsPageContent.tsx:38)
const visibleTabs = TABS.filter((tab) => !tab.adminOnly || canManageRequests);

// Drag enable (RequestCard.tsx:70)
isDraggable={canManageRequests}

// Conditional render (RequestDetailModal.tsx:245)
{canManageRequests && (<StatusDropdown />)}
```

**Pattern characteristics:**
1. **Extensive prop drilling** — Passed down 4+ levels
2. **Mixed hide/disable** — Some elements hidden, some disabled
3. **No visual indicator** — No banner saying "view-only mode"
4. **API enforcement** — All mutation endpoints also check `canManageRequests`

### 5.4 — Form Component Library
- **Question:** What form components does the codebase use? Search for:
  1. Form libraries (react-hook-form, formik, etc.)
  2. Custom form components in `src/components/ui/` or `src/components/shared/`
  3. Common input components used across pages

  For whatever is found, does the component support a `disabled` or `readOnly` prop out of the box?
- **Why:** If all forms use a common component library that supports `disabled`, enforcement is straightforward — pass the prop. If forms are hand-rolled, each one needs individual attention.
- **Finding:**

**No form library used** — Forms are built with native HTML elements and Tremor components.

**Component sources:**
1. **Tremor React (`@tremor/react`)**: `Button`, `TextInput`, `Card`, `Table`, etc.
2. **Native HTML**: `<input>`, `<select>`, `<button>`, `<form>`

**Tremor components support `disabled`:**
```tsx
// From WeeklyGoalEditor.tsx
<TextInput type="text" value={...} onChange={...} />
<Button type="submit" disabled={loading}>Save Goal</Button>
```

**`src/components/ui/` contents (no form inputs):**
- `CacheClearButton.tsx`
- `DashboardErrorBoundaries.tsx`
- `ErrorBoundary.tsx`
- `ExportButton.tsx`
- `InfoTooltip.tsx`
- `LoadingSpinner.tsx`
- `Skeletons.tsx`
- `ThemeToggle.tsx`

**Implication for `canEdit` implementation:**
Since there's no shared form component library, each form/modal must be updated individually to accept and respect a `canEdit` or `disabled` prop. However, the pattern is consistent — pass `disabled={!canEdit}` to Tremor/native inputs.

---

## Phase 5 Summary — Existing Patterns

**Three permission flags already exist with established patterns:**

| Flag | UI Pattern | API Pattern | Prop Drilling? |
|------|------------|-------------|----------------|
| `canManageUsers` | Hide entire section | Check + 403 | No (section not rendered) |
| `canManageRequests` | Hide/disable individual elements | Check + 403 | Yes (4+ levels) |
| `canExport` | Hide export buttons | Check + 403 | Yes (2-3 levels) |

**Existing `canEdit` implementations:**
- GC Hub: `canEdit={isAdmin}` prop passed to modal
- Advisor Map: `canEdit` computed from role in component
- Weekly Goals: `goal.canEdit` property on data objects

**Recommended pattern for per-page `canEdit`:**
1. Compute at page level from resolved permissions
2. Pass as prop to child components (like `canManageRequests`)
3. Use hide pattern (`{canEdit && <Button>}`) for consistency
4. Add API enforcement as backstop

---

## Phase 6: API-Level Edit Enforcement

**Goal:** Design the API-side enforcement layer so that read-only restrictions can't be bypassed by calling APIs directly.

### 6.1 — Full API Mutation Map
- **Question:** Produce a complete map of every POST/PUT/PATCH/DELETE API route in the application, grouped by the page it serves. Run:
  ```bash
  grep -rn "export async function POST\|export async function PUT\|export async function PATCH\|export async function DELETE" src/app/api/
  ```
  For each mutation endpoint, note:
  1. The file path and HTTP method
  2. Which page (by ID) it belongs to
  3. The current permission check (role-based, allowedPages, or none)
- **Why:** This is the master list. Every mutation endpoint for pages 7, 8, 9, and 16 needs a `canEdit` check. Endpoints for other pages may need it later.
- **Finding:**

**TARGET PAGES — Mutation endpoints requiring `canEdit` enforcement:**

**Page 7 (Settings / User Management):**
| Endpoint | Method | Current Check | Needs `canEdit`? |
|----------|--------|---------------|------------------|
| `/api/users` | POST | `canManageUsers` | ✅ YES |
| `/api/users/[id]` | PUT | `canManageUsers` | ✅ YES |
| `/api/users/[id]` | DELETE | `canManageUsers` | ✅ YES |
| `/api/users/[id]/reset-password` | POST | `canManageUsers` | ✅ YES |
| `/api/users/me/change-password` | POST | Session only | ❌ NO (self-service) |

**Page 8 (SGA Hub) + Page 9 (SGA Management) — shared endpoints:**
| Endpoint | Method | Current Check | Needs `canEdit`? |
|----------|--------|---------------|------------------|
| `/api/sga-hub/weekly-goals` | POST | Role check | ✅ YES |
| `/api/sga-hub/quarterly-goals` | POST | admin/manager/revops_admin | ✅ YES |
| `/api/sga-hub/manager-quarterly-goal` | POST | admin/manager/revops_admin | ✅ YES |

**Page 16 (GC Hub):**
| Endpoint | Method | Current Check | Needs `canEdit`? |
|----------|--------|---------------|------------------|
| `/api/gc-hub/override` | PUT | admin/revops_admin | ✅ YES |
| `/api/gc-hub/period` | POST | admin/revops_admin + page 16 | ✅ YES |
| `/api/gc-hub/period` | DELETE | admin/revops_admin + page 16 | ✅ YES |
| `/api/gc-hub/manual-sync` | POST | admin/revops_admin | ✅ YES |

**OTHER PAGES — Query endpoints using POST (NOT mutations):**
- `/api/dashboard/*` — data queries with filter bodies
- `/api/sga-hub/leaderboard` — data query
- `/api/gc-hub/advisors`, `/api/gc-hub/summary`, etc. — data queries
- `/api/sga-activity/*` — data queries
- `/api/recruiter-hub/*` — data queries

**OTHER MUTATIONS (not in target pages for now):**
- `/api/dashboard-requests/*` — controlled by `canManageRequests`
- `/api/saved-reports/*` — user's own reports
- `/api/advisor-map/overrides` — admin map edits
- `/api/explore/feedback` — feedback submission
- `/api/notifications/*` — read state

**Summary: 11 mutation endpoints need `canEdit` enforcement** (excluding self-service password change).

### 6.2 — Shared API Auth Utilities
- **Question:** What shared utilities exist for API route authentication? Search for:
  1. `src/lib/api-authz.ts` — paste complete file
  2. Any helper functions used across multiple API routes for auth
  3. Common patterns like `getServerSession(authOptions)` + permission check

  Run `grep -rn "getServerSession\|forbidRecruiter\|forbidCapitalPartner\|requireAuth\|checkPermission" src/app/api/` to find the patterns.
- **Why:** The `canEdit` check should be a shared utility (e.g., `requireEditAccess(session, pageId)`) called consistently across all mutation routes. Need to know what utilities already exist to extend.
- **Finding:**

**`src/lib/api-authz.ts` — complete file:**
```typescript
import { NextResponse } from 'next/server';
import type { UserPermissions } from '@/types/user';

/**
 * Defense-in-depth helper for API routes.
 * Use after `getUserPermissions()`:
 *
 *   const forbidden = forbidRecruiter(permissions);
 *   if (forbidden) return forbidden;
 */
export function forbidRecruiter(permissions: UserPermissions) {
  if (permissions.role !== 'recruiter') return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * Returns a 403 Forbidden response if the user is a capital partner.
 */
export function forbidCapitalPartner(permissions: UserPermissions) {
  if (permissions.role !== 'capital_partner') return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

**Usage pattern in API routes (50+ usages):**
```typescript
const forbidden = forbidRecruiter(permissions);
if (forbidden) return forbidden;
const cpForbidden = forbidCapitalPartner(permissions);
if (cpForbidden) return cpForbidden;
```

**Common auth pattern across all API routes:**
```typescript
const session = await getServerSession(authOptions);
if (!session?.user?.email) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
const permissions = getSessionPermissions(session);
if (!permissions) {
  return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
}
// Then role/permission checks...
```

### 6.3 — Proposed API Enforcement Pattern
- **Question:** Based on the existing auth patterns found in 6.2, propose the ideal function signature and implementation location for a `requireEditAccess()` utility. Should it:
  1. Live in `src/lib/api-authz.ts` alongside `forbidRecruiter()`?
  2. Accept `(session, pageId)` and return `NextResponse | null` (same pattern as forbid functions)?
  3. Check the resolved permissions from the session, or make a DB query?

  Write a pseudocode implementation.
- **Why:** Getting the API enforcement pattern right means every API route just adds one line: `const forbidden = requireEditAccess(session, 8); if (forbidden) return forbidden;`
- **Finding / Proposal:**

**Proposed function: `forbidPageEdit()`**

**Location:** `src/lib/api-authz.ts` (alongside existing forbid functions)

**Signature:**
```typescript
export function forbidPageEdit(
  permissions: UserPermissions,
  pageId: number
): NextResponse | null
```

**Implementation (pseudocode):**
```typescript
/**
 * Returns 403 if user cannot edit on the specified page.
 * Checks the resolved permissions from session (no DB query needed).
 *
 * Usage:
 *   const forbidden = forbidPageEdit(permissions, 8);
 *   if (forbidden) return forbidden;
 */
export function forbidPageEdit(
  permissions: UserPermissions,
  pageId: number
): NextResponse | null {
  // Check if user can edit this page
  // Option A: Check editablePages array
  if (!permissions.editablePages?.includes(pageId)) {
    return NextResponse.json(
      { error: 'Forbidden — read-only access to this page' },
      { status: 403 }
    );
  }
  return null;

  // OR Option B: Check pageEditOverrides map
  // const canEdit = permissions.pageEditOverrides?.[pageId] ?? true;
  // if (!canEdit) return NextResponse.json(...);
  // return null;
}
```

**Usage in API routes:**
```typescript
// In /api/sga-hub/weekly-goals/route.ts
import { forbidPageEdit } from '@/lib/api-authz';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  // ... existing auth checks ...
  const permissions = getSessionPermissions(session);

  // NEW: Check page edit permission
  const editForbidden = forbidPageEdit(permissions, 8); // SGA Hub = page 8
  if (editForbidden) return editForbidden;

  // ... rest of handler ...
}
```

**Why this pattern:**
1. **Consistent with existing `forbidRecruiter()`/`forbidCapitalPartner()` pattern**
2. **No DB query** — uses resolved permissions already in session
3. **Single line addition** to each mutation route
4. **Clear error message** — user knows they have read-only access
5. **Composable** — can be combined with existing forbid checks

**Alternative: Higher-order wrapper (not recommended)**
```typescript
// Could wrap entire handler, but more complex and less flexible
export const withPageEditCheck = (pageId: number, handler: Handler) => async (req) => {
  const permissions = ...;
  if (!canEditPage(permissions, pageId)) return 403;
  return handler(req);
};
```
This is more "magical" and harder to debug. The explicit `forbidPageEdit()` pattern is cleaner.

---

## Phase 6 Summary — API Enforcement

**11 mutation endpoints need `canEdit` enforcement:**
- Page 7: 4 endpoints (user CRUD)
- Page 8/9: 3 endpoints (SGA goals)
- Page 16: 4 endpoints (GC Hub edits)

**Proposed implementation:**
1. Add `forbidPageEdit(permissions, pageId)` to `src/lib/api-authz.ts`
2. Add one-line check to each mutation route
3. Uses session permissions (no DB query needed per request)

---

## Phase 7: Data Model Extension

**Goal:** Extend the page access override data model to support read-only vs. edit.

### 7.1 — Review Page Access Override Schema
- **Question:** Review the `UserPageOverride` model (or equivalent) created by the page access investigation. Paste the current schema. What fields does it have?
- **Why:** We need to add a `canEdit` boolean (or equivalent) to this model. Need to see the current state before proposing the extension.
- **Finding:**

**No `UserPageOverride` model exists yet in the database.**

The first investigation (`permissions-upgrade.md`) proposed this model but it was NOT implemented. The current `prisma/schema.prisma` has no page override table.

**Proposed schema from first investigation (to be implemented):**
```prisma
model UserPageOverride {
  id        String   @id @default(cuid())
  userId    String
  pageId    Int
  hasAccess Boolean
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, pageId])
}
```

**Extension for `canEdit` — Add one field:**
```prisma
model UserPageOverride {
  id        String   @id @default(cuid())
  userId    String
  pageId    Int
  hasAccess Boolean  @default(true)
  canEdit   Boolean  @default(true)   // NEW: false = read-only
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, pageId])
}
```

**Key design decisions:**
- `canEdit` defaults to `true` — if you have access, you can edit (unless explicitly set to false)
- `canEdit: false` with `hasAccess: true` = read-only access
- `canEdit: true` with `hasAccess: false` = no access (canEdit is irrelevant)
- Single table handles both access AND edit overrides per page per user

### 7.2 — canEdit Default Behavior
- **Question:** What should the default `canEdit` value be when:
  1. A user has no override for a page (using role defaults) — should they have edit access by default?
  2. A user is granted page access via an override — should edit come with it by default?
  3. A user's role already has a permission flag like `canManageUsers: false` — does `canEdit: true` on the Settings page override that, or do both need to be true?

  Think through the interaction between existing boolean permission flags (`canManageUsers`, `canManageRequests`, `canExport`) and the new per-page `canEdit`. Propose a resolution hierarchy.
- **Why:** This is the trickiest design question. `canEdit` per-page and `canManageUsers` per-role can conflict. We need a clear rule: "the most restrictive wins" or "per-page overrides take precedence."
- **Finding / Proposal:**

**Proposed defaults:**

1. **No override for a page (role defaults):** `canEdit = true`
   - If the role grants access to a page, the user can edit by default
   - Rationale: Maintain current behavior — roles work as they always have

2. **Access granted via override:** `canEdit = true` (unless explicitly set otherwise)
   - When admin grants page access, they can optionally toggle read-only
   - Rationale: Adding access implies you want the user to use the page

3. **Interaction with role-level flags:** **Most restrictive wins (AND logic)**
   - `canEdit: true` on page 7 does NOT override `canManageUsers: false`
   - Both must be true for the user to perform user management actions
   - Rationale: Per-page `canEdit` is a restriction layer, not an elevation layer

**Proposed resolution hierarchy:**

```
Can user EDIT on page X?

1. Check hasAccess (page access override or role default)
   → If no access: DENY (can't edit if can't view)

2. Check per-page canEdit override
   → If explicitly set to false: DENY (read-only override)
   → If not set: continue to step 3

3. Check role-level page-specific flags
   → Page 7 (Settings): check canManageUsers → if false: DENY
   → Page 13 (Requests): check canManageRequests → if false: DENY
   → Pages 8, 9, 16: check role in [admin, manager, revops_admin] for admin actions
   → If check fails: DENY

4. Default: ALLOW
```

**Key principle:** `canEdit: false` can only restrict, never grant. It's additive to existing role restrictions.

**Example scenarios:**

| User | Role | Override | canManageUsers | Result on Settings (page 7) |
|------|------|----------|----------------|----------------------------|
| Alice | admin | none | true (from role) | Can edit |
| Bob | admin | page 7: canEdit=false | true (from role) | **Read-only** (override restricts) |
| Carol | viewer | none | false (from role) | No access (no page access) |
| Dave | viewer | page 7: hasAccess=true, canEdit=true | false (from role) | **Read-only** (canManageUsers still false) |

**Important:** Dave's scenario shows that `canEdit: true` on the override doesn't grant `canManageUsers`. The role flag still applies.

### 7.3 — Permission Resolution with canEdit
- **Question:** Examine the current `getPermissionsFromToken()` function. Propose how to extend the return type to include per-page edit permissions. Options:
  - **Option A:** Add `editablePages: number[]` alongside `allowedPages`
  - **Option B:** Change `allowedPages` from `number[]` to `{pageId: number, canEdit: boolean}[]`
  - **Option C:** Add a separate `pageEditOverrides: Record<number, boolean>` field

  For each option, assess: impact on JWT size, impact on existing code that reads `allowedPages`, ease of checking "can this user edit page X" in both client and API contexts.
- **Why:** The data shape of the resolved permissions determines how easy or hard enforcement is everywhere downstream. The wrong shape means awkward checks in 20+ files.
- **Finding / Recommendation:**

**Option A: Add `editablePages: number[]` alongside `allowedPages`**

```typescript
interface UserPermissions {
  allowedPages: number[];      // existing
  editablePages: number[];     // NEW: subset of allowedPages where canEdit=true
  // ... other fields
}
```

| Aspect | Assessment |
|--------|------------|
| JWT size | +50-100 bytes (duplicate page IDs) |
| Existing code impact | **Zero** — `allowedPages` unchanged |
| Client check | `permissions.editablePages.includes(pageId)` |
| API check | `permissions.editablePages.includes(pageId)` |
| Semantic clarity | Good — clear what it means |

**Option B: Change `allowedPages` to `{pageId, canEdit}[]`**

```typescript
interface UserPermissions {
  allowedPages: { pageId: number; canEdit: boolean }[];  // BREAKING CHANGE
  // ... other fields
}
```

| Aspect | Assessment |
|--------|------------|
| JWT size | +24 bytes per page (object overhead) |
| Existing code impact | **MASSIVE** — every `allowedPages.includes(x)` breaks |
| Client check | `allowedPages.find(p => p.pageId === x)?.canEdit` |
| API check | Same as above |
| Semantic clarity | Excellent — bundled information |

**Option C: Add `pageEditOverrides: Record<number, boolean>`**

```typescript
interface UserPermissions {
  allowedPages: number[];                           // existing, unchanged
  pageEditOverrides?: Record<number, boolean>;      // NEW: {pageId: canEdit}
  // ... other fields
}
```

| Aspect | Assessment |
|--------|------------|
| JWT size | +30-60 bytes (only overridden pages stored) |
| Existing code impact | **Zero** — `allowedPages` unchanged |
| Client check | `pageEditOverrides?.[pageId] !== false` |
| API check | `pageEditOverrides?.[pageId] !== false` |
| Semantic clarity | Moderate — requires understanding "default=true" |

---

**RECOMMENDATION: Option A (`editablePages: number[]`)**

**Rationale:**
1. **Zero impact on existing code** — `allowedPages` remains unchanged, so 50+ call sites don't need updates
2. **Simple check semantics** — `editablePages.includes(8)` is cleaner than `pageEditOverrides?.[8] !== false`
3. **Consistent pattern** — mirrors how `allowedPages` already works
4. **JWT size acceptable** — at most 12 page IDs × 2 bytes = 24 bytes overhead (pages are small integers)
5. **API enforcement straightforward** — `forbidPageEdit()` checks `permissions.editablePages.includes(pageId)`

**Extended `UserPermissions` interface:**
```typescript
export interface UserPermissions {
  role: UserRole;
  allowedPages: number[];      // unchanged
  editablePages: number[];     // NEW: pages where user can edit
  sgaFilter: string | null;
  sgmFilter: string | null;
  recruiterFilter: string | null;
  capitalPartnerFilter?: string | null;
  canExport: boolean;
  canManageUsers: boolean;
  canManageRequests: boolean;
  userId?: string | null;
}
```

**Resolution logic in `getPermissionsFromToken()` / session callback:**
```typescript
// Compute editablePages
const editablePages = allowedPages.filter(pageId => {
  // Check for explicit canEdit=false override
  const override = userPageOverrides?.find(o => o.pageId === pageId);
  if (override && override.canEdit === false) return false;
  // Default: if you have access, you can edit
  return true;
});
```

---

## Phase 7 Summary — Data Model Extension

| Aspect | Decision |
|--------|----------|
| Schema | Add `canEdit Boolean @default(true)` to `UserPageOverride` model |
| Default behavior | `canEdit = true` unless explicitly overridden |
| Resolution hierarchy | Most restrictive wins (override + role flags must both allow) |
| Permission data shape | `editablePages: number[]` alongside existing `allowedPages` |

---

## Phase 8: Client-Side Read-Only Enforcement Patterns

**Goal:** Design the client-side patterns for rendering pages in read-only mode.

### 8.1 — UI Disable Strategy Survey
- **Question:** For each of the four target pages, categorize the edit UI elements into:
  1. **Buttons** (e.g., "Save," "Create User," "Add Goal") — these can be hidden or disabled
  2. **Form inputs** (text fields, dropdowns, checkboxes) — these can be set to `readOnly` or `disabled`
  3. **Inline editable cells** (click-to-edit table cells) — these need the click handler removed
  4. **Drag-and-drop or sortable elements** — these need interaction disabled
  5. **Delete/destructive actions** (trash icons, remove buttons) — these should be hidden entirely

  Produce a count for each category per page.
- **Why:** The disable strategy depends on the UI element type. A single "pass `readOnly` prop" approach won't work if there are 5 different interaction patterns.
- **Finding:**

**UI Element Category by Page:**

| Category | SGA Hub (Page 8) | SGA Management (Page 9) | Settings (Page 7) | GC Hub (Page 16) |
|----------|------------------|------------------------|-------------------|------------------|
| **Buttons** (hide/disable) | 3: Edit Goal, Save Goal, Set Manager Goal | 3: Edit Weekly, Edit Quarterly, Bulk Edit | 4: Add User, Edit, Reset Password, Save | 4: Add Period, Edit Period, Delete Period, Sync Now |
| **Form inputs** (readOnly) | 6: Initial Calls, Qual Calls, SQO target × 2 editors | 6: Same inputs via shared editors | 8: Name, email, role, password fields | 4: Revenue, Commissions, Reason, Period dropdown |
| **Inline editable cells** | 0 | 0 | 0 | 0 |
| **Drag-and-drop** | 0 | 0 | 0 | 0 |
| **Delete actions** (hide) | 0 | 0 | 1: Delete User | 1: Delete Period |

**Key insight:** All edit actions are button-triggered forms in modals. No inline editing or drag-and-drop. This simplifies implementation — just hide/disable the trigger buttons and form save buttons.

**Strategy per page:**
- **SGA Hub:** Hide "Edit" buttons in `WeeklyGoalsTable`, disable admin editor buttons in `AdminQuarterlyProgressView`
- **SGA Management:** Hide "Edit Weekly," "Edit Quarterly," and "Bulk Edit" buttons
- **Settings:** Hide "Add User" button and per-user action icons (Edit, Delete, Reset Password)
- **GC Hub:** Already has `canEdit` prop — hide "Add period," "Edit," "Delete" in modal; hide "Sync Now" in admin bar

### 8.2 — Read-Only Visual Indicator
- **Question:** Search the codebase for any existing "view mode" or "read-only" banners/badges/indicators. Run `grep -rn "view.only\|read.only\|view.mode\|edit.mode" src/`. Also check if there are any toast or alert patterns that could be reused to show "You have view-only access to this page."
- **Why:** Users need to know they're in read-only mode — otherwise they'll think the UI is broken when buttons are missing or disabled. We need a clear, consistent visual indicator.
- **Finding:**

**No existing "read-only mode" banner or indicator exists in the codebase.**

Search results:
- "view mode" references are unrelated (funnel display mode, activity distribution view)
- "read-only" appears only in role descriptions ("Viewer - Read-only")
- No dedicated Banner, Toast, or Alert components exist

**Existing alert patterns (can be adapted):**
- Lucide icons (`AlertCircle`, `AlertTriangle`) used inline with text
- Pattern: `<div className="rounded-lg bg-{color}-50 border ..."><Icon /><Text /></div>`
- Example from `GCHubContent.tsx:231-235` (error banner):
```tsx
<div role="alert" className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
  <Text className="text-red-700 dark:text-red-300">{error}</Text>
</div>
```

**Proposed read-only indicator:**
```tsx
// ReadOnlyBanner.tsx (new shared component)
import { EyeOff } from 'lucide-react';

export function ReadOnlyBanner() {
  return (
    <div role="status" className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 flex items-center gap-2">
      <EyeOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
      <span className="text-sm text-amber-700 dark:text-amber-300">
        You have view-only access to this page
      </span>
    </div>
  );
}
```

**Placement:** Below the page header, above the filter bar (similar to error banner placement).

### 8.3 — Component Prop Drilling vs. Context
- **Question:** For the four target pages, how deep is the component tree from the page-level component to the individual edit buttons/inputs? Count the levels for:
  1. SGA Hub → Weekly Goals → individual goal edit field
  2. Settings → User Management → UserModal → save button
  3. SGA Management → whatever the deepest edit element is
  4. GC Hub → inline edit cell

  Would prop drilling `canEdit` through all levels be reasonable, or should we use React Context?
- **Why:** If `canEdit` needs to reach components 5+ levels deep, a `usePageEditPermission(pageId)` hook or React Context is cleaner than drilling props. If it's only 2-3 levels, props are fine.
- **Finding / Recommendation:**

**Component tree depth analysis:**

| Page | Path to Edit Button | Depth |
|------|---------------------|-------|
| **SGA Hub** | SGAHubContent → WeeklyGoalsTable → Edit button (row) | 2 levels |
| **SGA Hub** | SGAHubContent → AdminQuarterlyProgressView → TeamGoalEditor | 3 levels |
| **SGA Hub** | SGAHubContent → AdminQuarterlyProgressView → AdminSGATable → Edit buttons | 3 levels |
| **Settings** | page.tsx → UserManagement → action icons | 2 levels |
| **Settings** | page.tsx → UserManagement → UserModal → Save button | 3 levels |
| **SGA Management** | SGAManagementContent → AdminSGATable → Edit buttons | 2 levels |
| **SGA Management** | SGAManagementContent → BulkGoalEditor → Save button | 2 levels |
| **GC Hub** | GCHubContent → GCHubAdvisorModal → Edit buttons | 2 levels |
| **GC Hub** | GCHubContent → GCHubAdvisorModal → GCHubOverrideModal → Save | 3 levels |
| **GC Hub** | GCHubContent → GCHubAdminBar → Sync button | 2 levels |

**Maximum depth: 3 levels**

**Recommendation: Prop drilling is sufficient**

Rationale:
1. **Maximum depth is 3 levels** — manageable without Context
2. **Existing `canManageRequests` pattern** uses prop drilling 4+ levels successfully
3. **GC Hub already uses `canEdit` prop** — proven pattern
4. **Context adds complexity** — requires Provider wrapping, potentially confusing for future maintainers
5. **Props are explicit** — easier to trace data flow in components

**Proposed pattern:**
```tsx
// In page content component (e.g., SGAHubContent.tsx)
const canEditPage = permissions?.editablePages?.includes(8) ?? false;

// Pass to child components
<WeeklyGoalsTable canEdit={canEditPage} ... />
<AdminQuarterlyProgressView canEdit={canEditPage} ... />

// In child component
function WeeklyGoalsTable({ canEdit, ... }) {
  return (
    <Button onClick={...} disabled={!canEdit || !goal.canEdit}>
      Edit
    </Button>
  );
}
```

**Alternative (if depth increases later):** A `usePageCanEdit(pageId)` hook that reads from session:
```tsx
function usePageCanEdit(pageId: number): boolean {
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  return permissions?.editablePages?.includes(pageId) ?? false;
}
```
This can be added later if prop drilling becomes unwieldy.

### 8.4 — Shared ReadOnly Wrapper Component
- **Question:** Evaluate whether a shared component like `<ReadOnlyGuard pageId={8}>` that wraps editable sections would be viable. This component would:
  1. Check `canEdit` for the given page from session permissions
  2. If read-only: render children with `pointer-events: none` and reduced opacity, plus a tooltip "View only"
  3. If editable: render children normally

  Search for any existing wrapper/guard component patterns in the codebase that could serve as a template. Check `src/components/shared/` or `src/components/ui/`.
- **Why:** A shared wrapper reduces the per-page implementation effort significantly. Instead of modifying every button and input, you wrap sections in `<ReadOnlyGuard>`.
- **Finding / Recommendation:**

**Existing wrapper/guard patterns in codebase:**

No wrapper/guard components exist in `src/components/ui/` or `src/components/shared/`. Components found:
- `ErrorBoundary.tsx` — catches errors, renders fallback (different pattern)
- `InfoTooltip.tsx` — tooltip wrapper, but for info display only
- `LoadingSpinner.tsx`, `Skeletons.tsx` — loading states

**Assessment of `<ReadOnlyGuard>` approach:**

| Aspect | Assessment |
|--------|------------|
| Pros | Single wrapper reduces per-component changes; CSS-based disable is simple |
| Cons | `pointer-events: none` blocks ALL interaction (even scrolling); Accessibility issues (hidden from keyboard); Inconsistent with hide pattern used elsewhere |

**Recommendation: Do NOT use a ReadOnlyGuard wrapper**

Reasons:
1. **Existing pattern is "hide"** — `canManageUsers`, `canManageRequests`, `canEdit` (GC Hub) all hide buttons rather than disable them
2. **Accessibility** — `pointer-events: none` doesn't properly communicate "disabled" to screen readers
3. **Inconsistent UX** — Some elements grayed out vs. some hidden is confusing
4. **Modals already handle their own state** — Edit modals have their own Save button disable logic; adding a wrapper doesn't help

**Recommended approach instead:**
1. **Hide pattern at button level** — `{canEdit && <Button>Edit</Button>}`
2. **Disable pattern for Save buttons** — `<Button disabled={!canEdit || loading}>Save</Button>`
3. **Conditional render for sections** — `{canEdit && <AddPeriodButton />}`

This matches GC Hub's existing `canEdit` implementation and the `canManageRequests` pattern.

---

## Phase 8 Summary — Client-Side Patterns

| Decision | Recommendation |
|----------|---------------|
| UI element strategy | Hide trigger buttons; disable Save buttons in modals |
| Visual indicator | New `ReadOnlyBanner` component (amber warning style) |
| Prop vs Context | Prop drilling (max 3 levels) |
| Wrapper component | Not recommended — use existing hide/disable patterns |

---

## Phase 9: Admin UI for Edit Toggle Management

**Goal:** Design how admins will manage the read-only vs. edit setting per user per page.

### 9.1 — Page Access Override UI State
- **Question:** Review the UI built for page access overrides (from the first investigation doc). How is the per-user page toggle currently presented? Is it:
  1. A list of toggles in the UserModal?
  2. A dedicated permissions management page?
  3. A matrix/grid view?

  Paste the relevant component code or describe the layout.
- **Why:** The edit toggle should live alongside the page access toggle. If page access is a simple on/off switch per page, the edit toggle could be a secondary toggle that only appears when access is "on." Need to see the existing UI to extend it.
- **Finding:**

**No page access override UI exists yet.**

The first investigation (`permissions-upgrade.md`) proposed adding page overrides to the system but did NOT implement the UI. The current `UserModal.tsx` only contains:
- Name, Email, Password fields
- Role dropdown
- External Agency field (for recruiter/capital_partner)
- Active checkbox

**Current UserModal structure (no permission toggles):**
```tsx
<form>
  <input name="name" />
  <input name="email" />
  <input name="password" />
  <select name="role" />       // Determines default permissions
  <input name="externalAgency" />  // For recruiter/capital_partner
  <checkbox name="isActive" />
  // NO page access toggles
  // NO edit permission toggles
</form>
```

**Implication:** Both page access AND edit toggles need to be designed together as a single feature addition to UserModal.

### 9.2 — Toggle UX Design
- **Question:** For each page in the override UI, the admin now needs to set two things: "can access" and "can edit." Evaluate three UI patterns:
  1. **Two separate toggles per page** — one for access, one for edit (edit disabled when access is off)
  2. **Three-state selector per page** — "No Access" / "View Only" / "Full Access"
  3. **Access toggle + edit checkbox** — toggle for access, checkbox for "allow editing" that appears when access is on

  Which pattern fits best with the existing UI component library and design patterns in the codebase? Check what toggle/switch/checkbox components are available.
- **Why:** UX matters here. Admins will be managing permissions for potentially dozens of users. The interaction needs to be fast and intuitive.
- **Finding / Recommendation:**

**Available UI components:**
- Native `<input type="checkbox">` — used in UserModal for "Active" toggle
- Native `<select>` — used for role selection
- Tremor `<Switch>` — NOT currently used in codebase
- No custom toggle components exist

**Pattern evaluation:**

| Pattern | Pros | Cons | Implementation Effort |
|---------|------|------|----------------------|
| **Two toggles** | Clear, explicit | Cluttered (2× elements per page); Edit toggle state ambiguous when access=off | Medium |
| **Three-state selector** | Clean, single element | Non-standard UX (users expect on/off); Harder to scan | Medium |
| **Access toggle + edit checkbox** | Access primary, edit secondary; Checkbox only visible when relevant | Conditional visibility adds complexity | Medium |

**Recommendation: Pattern 3 — Access toggle + conditional edit checkbox**

Mockup:
```
┌────────────────────────────────────────────────────────┐
│ Page Permissions (override role defaults)              │
├────────────────────────────────────────────────────────┤
│ Page               │ Access │ Can Edit                 │
├────────────────────┼────────┼──────────────────────────┤
│ SGA Hub            │ [✓]    │ [✓] Allow editing        │
│ SGA Management     │ [ ]    │ (grayed out)             │
│ Settings           │ [✓]    │ [ ] View only            │
│ GC Hub             │ [✓]    │ [✓] Allow editing        │
└────────────────────────────────────────────────────────┘
```

**Rules:**
- Access checkbox controls page visibility
- "Can Edit" checkbox only enabled when Access is checked
- Both default to role settings; changes create overrides
- Visual indicator (e.g., "Modified" badge) when override differs from role default

**Implementation approach:**
```tsx
// In UserModal, add a new section after the Role selector:
<div className="space-y-2">
  <label className="text-sm font-medium">Page Permission Overrides</label>
  <p className="text-xs text-gray-500">Override role defaults (leave unchanged to use role defaults)</p>
  {EDITABLE_PAGES.map(page => (
    <div key={page.id} className="flex items-center gap-4">
      <input type="checkbox"
        checked={overrides[page.id]?.hasAccess ?? roleDefaults.includes(page.id)}
        onChange={...} />
      <span className="w-32">{page.name}</span>
      <input type="checkbox"
        disabled={!(overrides[page.id]?.hasAccess ?? roleDefaults.includes(page.id))}
        checked={overrides[page.id]?.canEdit ?? true}
        onChange={...} />
      <span className="text-xs">Can edit</span>
    </div>
  ))}
</div>
```

### 9.3 — API for Saving Edit Overrides
- **Question:** Review the API endpoint created for saving page access overrides. Can it be extended to accept `canEdit` alongside `hasAccess`, or should it be a separate endpoint? Paste the current endpoint code and propose the extension.
- **Why:** Keeping it as one endpoint (upsert page override with both `hasAccess` and `canEdit`) is cleaner than having two separate endpoints.
- **Finding / Proposal:**

**No page override API endpoint exists yet.**

The first investigation proposed the API but did not implement it. Need to design from scratch.

**Proposed API: Extend user update endpoint**

The existing `/api/users/[id]` (PUT) endpoint handles user updates. Extend it to accept page overrides.

**Current endpoint** (`src/app/api/users/[id]/route.ts:81`):
```typescript
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  // ... auth checks ...
  const { email, name, role, isActive, password, externalAgency } = await request.json();
  // ... update user ...
}
```

**Proposed extension:**
```typescript
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  // ... auth checks ...
  const {
    email, name, role, isActive, password, externalAgency,
    pageOverrides  // NEW: { [pageId]: { hasAccess: boolean, canEdit: boolean } }
  } = await request.json();

  // ... update user ...

  // Handle page overrides if provided
  if (pageOverrides && typeof pageOverrides === 'object') {
    // Delete existing overrides and insert new ones (full replace)
    await prisma.$transaction([
      prisma.userPageOverride.deleteMany({ where: { userId: params.id } }),
      prisma.userPageOverride.createMany({
        data: Object.entries(pageOverrides).map(([pageId, override]) => ({
          userId: params.id,
          pageId: parseInt(pageId, 10),
          hasAccess: override.hasAccess,
          canEdit: override.canEdit,
        })),
      }),
    ]);
  }
}
```

**Request body example:**
```json
{
  "name": "Alice Smith",
  "email": "alice@savvy.com",
  "role": "manager",
  "isActive": true,
  "pageOverrides": {
    "8": { "hasAccess": true, "canEdit": false },   // SGA Hub: view-only
    "9": { "hasAccess": true, "canEdit": false },   // SGA Management: view-only
    "7": { "hasAccess": true, "canEdit": true },    // Settings: full access
    "16": { "hasAccess": false, "canEdit": false }  // GC Hub: no access
  }
}
```

**Why single endpoint:**
1. **Atomic update** — User details and overrides saved together
2. **Simpler client code** — One API call from UserModal
3. **Consistent with existing pattern** — User CRUD is already in `/api/users/[id]`

**Alternative: Dedicated endpoint**
If keeping user CRUD and permission management separate is preferred:
```
PUT /api/users/[id]/page-overrides
Body: { "8": { hasAccess: true, canEdit: false }, ... }
```

This is cleaner for separation of concerns but requires two API calls from the UI.

**Recommendation:** Extend existing endpoint (simpler).

---

## Phase 9 Summary — Admin UI

| Aspect | Decision |
|--------|----------|
| UI location | New section in UserModal after Role selector |
| Toggle pattern | Access checkbox + conditional "Can Edit" checkbox per page |
| API approach | Extend existing `/api/users/[id]` PUT to accept `pageOverrides` |
| Data format | `{ [pageId]: { hasAccess: boolean, canEdit: boolean } }` |

---

## Phase 10: Interaction with Existing Permission Flags

**Goal:** Resolve how per-page `canEdit` interacts with existing role-level boolean permissions.

### 10.1 — Permission Flag Inventory
- **Question:** List every boolean permission flag in `UserPermissions` and `ROLE_PERMISSIONS`:
  1. `canExport` — which pages does this affect? What UI elements does it control?
  2. `canManageUsers` — which pages does this affect? What UI elements does it control?
  3. `canManageRequests` — which pages does this affect? What UI elements does it control?

  For each, run `grep -rn "canExport\|canManageUsers\|canManageRequests" src/` and list every usage location.
- **Why:** These flags already control edit-like capabilities. We need to define: does `canEdit: true` on a page override `canManageUsers: false`? Or are they independent? The answer affects the resolution logic.
- **Finding:**

**Permission flag inventory:**

**1. `canExport` — 35 usages across codebase**

| Role | Value |
|------|-------|
| revops_admin, admin, manager, sgm, sga, recruiter, capital_partner | `true` |
| viewer | `false` |

**Pages affected:** All pages with export functionality (Dashboard, SGA Hub, GC Hub, etc.)

**UI elements controlled:**
- Export to Sheets button (`ExportToSheetsButton.tsx`)
- CSV export buttons (`MetricDrillDownModal.tsx`, `SGAHubContent.tsx`, `SGAManagementContent.tsx`)
- Export buttons in drill-down modals

**Usage pattern:**
```tsx
{canExport && <ExportButton />}
// OR
<ExportButton disabled={!canExport} />
```

**2. `canManageUsers` — 12 usages**

| Role | Value |
|------|-------|
| revops_admin, admin | `true` |
| manager, sgm, sga, viewer, recruiter, capital_partner | `false` |

**Pages affected:** Settings (page 7) only

**UI elements controlled:**
- Entire User Management section (`settings/page.tsx:57`)
- User CRUD API endpoints (`/api/users/*`)

**Usage pattern:**
```tsx
{permissions?.canManageUsers && <UserManagement />}
```

**3. `canManageRequests` — 18 usages**

| Role | Value |
|------|-------|
| revops_admin | `true` |
| admin, manager, sgm, sga, viewer, recruiter, capital_partner | `false` |

**Pages affected:** Dashboard Requests (page 13) only

**UI elements controlled:**
- Drag-and-drop on Kanban cards
- Status change buttons
- Archive/Unarchive actions
- Analytics tab visibility

**Usage pattern:**
```tsx
isDraggable={canManageRequests}
{canManageRequests && <StatusDropdown />}
```

### 10.2 — Resolution Hierarchy Proposal
- **Question:** Based on the findings from 10.1, propose and document the permission resolution hierarchy. Suggested approach:

  ```
  Can user edit on page X?
  1. Check per-user page override canEdit → if explicitly set, use it
  2. Check role-level page-specific flags (canManageUsers for page 7, canManageRequests for page 13) → if false, deny edit
  3. Fall back to role default → if role allows the page, allow edit
  ```

  Does this hierarchy make sense given the existing codebase patterns? Are there edge cases where it breaks down?
- **Why:** This is the single most important design decision in this document. Getting the hierarchy wrong means confusing behavior and potential security gaps.
- **Finding / Decision:**

**DECISION: "Most restrictive wins" (AND logic)**

The per-page `canEdit` and role-level flags are **independent checks** — both must allow the action for it to succeed.

**Final resolution hierarchy:**

```
Can user perform EDIT action on page X?

Step 1: Check page ACCESS
├─ Per-user override.hasAccess exists? → Use override value
├─ Else: Use role.allowedPages.includes(pageId)
└─ If NO access: DENY (can't edit what you can't see)

Step 2: Check page EDIT permission (new)
├─ Per-user override.canEdit exists? → Use override value
└─ Else: Default to TRUE (role defaults allow edit)

Step 3: Check role-level action-specific flags
├─ Page 7 (Settings): canManageUsers must be TRUE for user CRUD
├─ Page 13 (Requests): canManageRequests must be TRUE for status changes
├─ Pages 8, 9, 16: Admin role actions require isAdmin check
└─ If flag check fails: DENY

Step 4: All checks pass → ALLOW
```

**Why AND logic (most restrictive wins):**
1. **Security principle:** Permission systems should default to restrictive
2. **Existing pattern:** `canManageUsers` doesn't "grant" access to page 7 — it's an additional check ON TOP of page access
3. **No privilege escalation:** An override cannot grant capabilities the role doesn't have
4. **Intuitive for admins:** "Check the box to give access, uncheck to remove" — no surprises

**Edge case analysis:**

| Scenario | `canEdit` Override | Role Flag | Result | Explanation |
|----------|-------------------|-----------|--------|-------------|
| Manager on Settings, user CRUD | not set | `canManageUsers: false` | ❌ DENY | Role doesn't have flag |
| Manager on Settings, user CRUD | `canEdit: true` | `canManageUsers: false` | ❌ DENY | Override can't elevate |
| Admin on Settings, user CRUD | `canEdit: false` | `canManageUsers: true` | ❌ DENY | Override restricts |
| Admin on Settings, user CRUD | not set | `canManageUsers: true` | ✅ ALLOW | Default behavior |
| SGA on SGA Hub, own goal | `canEdit: false` | (no flag) | ❌ DENY | Override restricts |
| SGA on SGA Hub, own goal | not set | (no flag) | ✅ ALLOW | Default behavior |

**No edge cases break down** — the hierarchy is consistent.

### 10.3 — canExport Interaction
- **Question:** If a user has `canEdit: false` on a page, should they still be able to export data from that page (assuming their role has `canExport: true`)? Export is technically read-only — it extracts data but doesn't modify it. But some organizations consider data export a privileged action.
- **Why:** Need a clear decision. If `canEdit: false` also blocks export, the enforcement scope is larger. If export is independent, we need to ensure the two are checked separately.
- **Finding / Decision:**

**DECISION: Export is INDEPENDENT from canEdit**

**Rationale:**
1. **Export is read-only** — It extracts existing data, doesn't modify state
2. **Existing pattern:** `canExport` is a separate role flag, not tied to any page-specific edit permissions
3. **Business need:** Users with view-only access often still need to export data for reporting
4. **Separation of concerns:** `canEdit` controls mutations; `canExport` controls data extraction

**Result:**
- User with `canEdit: false` + `canExport: true` → Can export data, cannot make changes
- User with `canEdit: true` + `canExport: false` → Can make changes, cannot export data
- The two are orthogonal

**Implementation implication:**
No changes needed to export logic. Export buttons check `canExport`, not `canEdit`.

**Alternative considered (rejected):**
"canEdit: false blocks all privileged actions including export"
- Rejected because it conflates two different concerns
- Would require changing export button logic unnecessarily
- Breaks existing user expectations

---

## Phase 10 Summary — Permission Flag Interaction

| Question | Decision |
|----------|----------|
| `canEdit` + `canManageUsers` interaction | Both must be true (AND logic) |
| `canEdit` + `canManageRequests` interaction | Both must be true (AND logic) |
| `canEdit` + `canExport` interaction | Independent (export not affected by canEdit) |
| Resolution hierarchy | Most restrictive wins; canEdit cannot elevate beyond role |

---

## Phase 11: Complete Touchpoint Map & Implementation Plan

**Goal:** Produce the final implementation plan for read-only/edit enforcement.

### 11.1 — File Change Inventory
- **Question:** Based on all findings, produce a complete list of files that need changes, grouped by:
  1. **Schema/Database:** Prisma migration to add `canEdit` to override table
  2. **Type Definitions:** Extend `UserPermissions` with edit-permission fields
  3. **Permission Logic:** Modify resolution functions to compute per-page edit permissions
  4. **API Enforcement:** New `requireEditAccess()` utility + add calls to all mutation routes
  5. **Client Components — SGA Hub:** List every component file that needs `canEdit` checks
  6. **Client Components — SGA Management:** Same
  7. **Client Components — Settings:** Same
  8. **Client Components — GC Hub:** Same
  9. **Shared Components:** ReadOnly wrapper, visual indicator, hooks
  10. **Admin UI:** Extend override management with edit toggles

  For each file, note: what changes, estimated complexity (low/medium/high), and dependencies.
- **Finding:**

**1. Schema/Database**

| File | Change | Complexity | Dependencies |
|------|--------|------------|--------------|
| `prisma/schema.prisma` | Add `UserPageOverride` model with `canEdit Boolean @default(true)` | Low | None |
| `scripts/add-user-page-override-table.sql` | NEW: SQL migration script | Low | Schema design |

**2. Type Definitions**

| File | Change | Complexity | Dependencies |
|------|--------|------------|--------------|
| `src/types/user.ts` | Add `editablePages: number[]` to `UserPermissions` interface | Low | None |

**3. Permission Logic**

| File | Change | Complexity | Dependencies |
|------|--------|------------|--------------|
| `src/lib/permissions.ts` | Modify `getPermissionsFromToken()` to compute `editablePages` from JWT | Medium | Type changes |
| `src/lib/auth.ts` | Modify JWT callback to include `pageOverrides` in token; session callback to resolve `editablePages` | Medium | DB query for overrides |
| `src/lib/users.ts` | Add `getUserPageOverrides(userId)` function | Low | Schema |

**4. API Enforcement**

| File | Change | Complexity | Dependencies |
|------|--------|------------|--------------|
| `src/lib/api-authz.ts` | Add `forbidPageEdit(permissions, pageId)` function | Low | Type changes |
| `src/app/api/sga-hub/weekly-goals/route.ts` | Add `forbidPageEdit(permissions, 8)` check | Low | api-authz |
| `src/app/api/sga-hub/quarterly-goals/route.ts` | Add `forbidPageEdit(permissions, 8)` check | Low | api-authz |
| `src/app/api/sga-hub/manager-quarterly-goal/route.ts` | Add `forbidPageEdit(permissions, 8)` check | Low | api-authz |
| `src/app/api/users/route.ts` (POST) | Add `forbidPageEdit(permissions, 7)` check | Low | api-authz |
| `src/app/api/users/[id]/route.ts` (PUT, DELETE) | Add `forbidPageEdit(permissions, 7)` check | Low | api-authz |
| `src/app/api/users/[id]/reset-password/route.ts` | Add `forbidPageEdit(permissions, 7)` check | Low | api-authz |
| `src/app/api/gc-hub/override/route.ts` | Add `forbidPageEdit(permissions, 16)` check | Low | api-authz |
| `src/app/api/gc-hub/period/route.ts` | Add `forbidPageEdit(permissions, 16)` check | Low | api-authz |
| `src/app/api/gc-hub/manual-sync/route.ts` | Add `forbidPageEdit(permissions, 16)` check | Low | api-authz |

**5. Client Components — SGA Hub (Page 8)**

| File | Change | Complexity | Dependencies |
|------|--------|------------|--------------|
| `src/app/dashboard/sga-hub/SGAHubContent.tsx` | Compute `canEditPage` from permissions; pass to child components | Medium | Type changes |
| `src/components/sga-hub/WeeklyGoalsTable.tsx` | Accept `canEdit` prop; hide Edit buttons when false | Low | Parent |
| `src/components/sga-hub/AdminQuarterlyProgressView.tsx` | Accept `canEdit` prop; hide admin edit controls | Low | Parent |
| `src/components/sga-hub/TeamGoalEditor.tsx` | Already modal — disable Save button based on parent | Low | Parent |
| `src/components/sga-hub/BulkGoalEditor.tsx` | Already modal — disable Save button based on parent | Low | Parent |
| `src/components/sga-hub/IndividualGoalEditor.tsx` | Already modal — disable Save button based on parent | Low | Parent |
| `src/components/sga-hub/AdminSGATable.tsx` | Accept `canEdit` prop; hide Edit Weekly/Quarterly buttons | Low | Parent |

**6. Client Components — SGA Management (Page 9)**

| File | Change | Complexity | Dependencies |
|------|--------|------------|--------------|
| `src/app/dashboard/sga-management/SGAManagementContent.tsx` | Compute `canEditPage` from permissions; hide Bulk Edit button; pass to AdminSGATable | Medium | Type changes |

*(AdminSGATable and editor components shared with SGA Hub — changes apply to both)*

**7. Client Components — Settings (Page 7)**

| File | Change | Complexity | Dependencies |
|------|--------|------------|--------------|
| `src/app/dashboard/settings/page.tsx` | Compute `canEditPage`; pass to UserManagement or hide section entirely | Medium | Type changes |
| `src/components/settings/UserManagement.tsx` | Accept `canEdit` prop; hide Add User button and action icons | Low | Parent |

**8. Client Components — GC Hub (Page 16)**

| File | Change | Complexity | Dependencies |
|------|--------|------------|--------------|
| `src/app/dashboard/gc-hub/GCHubContent.tsx` | Change `canEdit={isAdmin}` to `canEdit={isAdmin && editablePages.includes(16)}` | Low | Type changes |
| `src/components/gc-hub/GCHubAdminBar.tsx` | Accept `canEdit` prop; hide Sync button when false | Low | Parent |

*(GCHubAdvisorModal already has `canEdit` prop — no changes needed)*

**9. Shared Components**

| File | Change | Complexity | Dependencies |
|------|--------|------------|--------------|
| `src/components/ui/ReadOnlyBanner.tsx` | NEW: Amber warning banner component | Low | None |

**10. Admin UI**

| File | Change | Complexity | Dependencies |
|------|--------|------------|--------------|
| `src/components/settings/UserModal.tsx` | Add page permission override section with access + edit checkboxes | High | Type changes, API |
| `src/app/api/users/[id]/route.ts` | Extend PUT to handle `pageOverrides` in request body | Medium | Schema |

---

**Total file count:** ~25 files
**Estimated complexity breakdown:** 3 High, 8 Medium, 14 Low

### 11.2 — Implementation Order
- **Question:** Propose the implementation sequence. Consider:
  1. Schema + types first (foundation)
  2. Permission resolution logic (must work before anything depends on it)
  3. API enforcement (security before UI)
  4. Shared client components (ReadOnlyGuard, hooks)
  5. Per-page client enforcement (one page at a time)
  6. Admin UI (last, since it's management not enforcement)

  Which page should be tackled first as the "template" for the others?
- **Finding / Recommendation:**

**Recommended implementation order:**

**Batch 1: Foundation (must be complete before anything else)**
```
1. prisma/schema.prisma + SQL migration → Create UserPageOverride table with canEdit
2. src/types/user.ts → Add editablePages to UserPermissions
3. src/lib/users.ts → Add getUserPageOverrides() function
4. src/lib/permissions.ts + src/lib/auth.ts → Compute editablePages in session
```
*Testable: Log into dashboard, verify session.permissions.editablePages exists*

**Batch 2: API Security Layer**
```
5. src/lib/api-authz.ts → Add forbidPageEdit() function
6. All 10 mutation API routes → Add forbidPageEdit() calls
```
*Testable: Manually insert a canEdit=false override in DB, verify APIs return 403*

**Batch 3: Shared UI Components**
```
7. src/components/ui/ReadOnlyBanner.tsx → Create warning banner
```
*Testable: Import into any page, verify renders correctly*

**Batch 4: Page-by-Page Client Enforcement**

**Template page: GC Hub (Page 16)**
```
8. src/app/dashboard/gc-hub/GCHubContent.tsx → Extend canEdit logic
9. src/components/gc-hub/GCHubAdminBar.tsx → Accept canEdit prop
```
*Why GC Hub first:*
- Already has `canEdit` prop pattern (least new code)
- Isolated page (not shared with other pages)
- Smaller component tree (2-3 levels)
- Quick win to validate approach

**Second page: Settings (Page 7)**
```
10. src/app/dashboard/settings/page.tsx → Add canEditPage check
11. src/components/settings/UserManagement.tsx → Accept canEdit prop
```
*Why Settings second:*
- Simple component tree
- Tests interaction with canManageUsers flag

**Third page: SGA Hub + SGA Management (Pages 8 & 9)**
```
12. src/app/dashboard/sga-hub/SGAHubContent.tsx → Add canEditPage
13. src/components/sga-hub/WeeklyGoalsTable.tsx → Accept canEdit
14. src/components/sga-hub/AdminQuarterlyProgressView.tsx → Accept canEdit
15. src/components/sga-hub/AdminSGATable.tsx → Accept canEdit
16. src/app/dashboard/sga-management/SGAManagementContent.tsx → Add canEditPage
```
*Why SGA pages third:*
- Shared components — do both together
- More complex component tree

**Batch 5: Admin UI (last)**
```
17. src/components/settings/UserModal.tsx → Add permission override section
18. src/app/api/users/[id]/route.ts → Handle pageOverrides in PUT
```
*Why admin UI last:*
- Enforcement must work before management exists
- Allows testing via direct DB inserts during development
- Most complex UI change

### 11.3 — Testing Strategy
- **Question:** Propose a testing matrix. At minimum:
  1. For each target page: user with edit access can perform all mutations
  2. For each target page: user with read-only access sees all data but cannot mutate
  3. For each target page: read-only user hitting mutation API directly gets 403
  4. Interaction with existing flags: user with `canManageUsers: false` + `canEdit: true` on page 7 — what happens?
  5. Override removal: if edit override is removed, user falls back to role default

  How would you test these — manual testing, Playwright, API tests?
- **Finding / Recommendation:**

**Testing matrix:**

**1. API Tests (Jest/Vitest) — Security baseline**

| Test Case | API Endpoint | Setup | Expected Result |
|-----------|--------------|-------|-----------------|
| Edit allowed, no override | POST /api/sga-hub/weekly-goals | Admin user, no override | 200 OK |
| Edit blocked, canEdit=false | POST /api/sga-hub/weekly-goals | Admin user + canEdit=false override | 403 Forbidden |
| Edit blocked, no access | POST /api/sga-hub/weekly-goals | Viewer user (no page 8 access) | 403 Forbidden |
| Self-service always allowed | POST /api/users/me/change-password | Any user, canEdit=false on page 7 | 200 OK |
| canManageUsers interaction | POST /api/users | Manager (canManageUsers=false) + canEdit=true | 403 Forbidden |

**Recommended: Create test file `__tests__/api/page-edit-permissions.test.ts`**

**2. Manual Testing Checklist — UI verification**

| Page | User Setup | Check | Expected |
|------|------------|-------|----------|
| GC Hub | Admin + canEdit=false for page 16 | "Add Period" button | Hidden |
| GC Hub | Admin + canEdit=false for page 16 | "Sync Now" button | Hidden |
| GC Hub | Admin + canEdit=false for page 16 | ReadOnlyBanner | Visible |
| Settings | Admin + canEdit=false for page 7 | "Add User" button | Hidden |
| Settings | Admin + canEdit=false for page 7 | Edit/Delete icons | Hidden |
| SGA Hub | Admin + canEdit=false for page 8 | "Edit" on weekly goals | Hidden |
| SGA Hub | Admin + canEdit=false for page 8 | Admin quarterly view | Edit buttons hidden |
| SGA Management | Admin + canEdit=false for page 9 | "Bulk Edit" button | Hidden |

**3. E2E Tests (Playwright) — Full flow validation**

| Test | Steps | Assertion |
|------|-------|-----------|
| Read-only user cannot edit | Login as read-only user → Navigate to SGA Hub → Inspect page | No Edit buttons visible |
| API bypass blocked | Login as read-only user → Use DevTools to POST to API | 403 response in Network tab |
| Admin can still edit | Login as admin without override → Edit weekly goal | Success |
| Override takes effect after re-login | Set canEdit=false → Login → Check UI | Buttons hidden |

**4. Edge Case Tests**

| Scenario | Test |
|----------|------|
| Role has canManageUsers=false, override has canEdit=true | Verify user CANNOT manage users (AND logic) |
| Override removed mid-session | User should see edit on next login |
| Multiple pages with different overrides | Verify each page respects its own override |
| Export still works with canEdit=false | Verify export buttons visible, CSV download works |

**Recommended testing approach:**
1. **API tests first** — Security-critical, automated, fast
2. **Manual testing during development** — Visual verification
3. **E2E tests for regression** — Run before releases

### 11.4 — Risk Assessment
- **Question:** What are the top 3 risks specific to read-only/edit enforcement (distinct from the page access risks)? For each:
  1. What could go wrong?
  2. How severe is the impact?
  3. What mitigation exists?
- **Finding:**

**Risk 1: API Enforcement Gap — Some mutation routes miss the check**

| Aspect | Assessment |
|--------|------------|
| What could go wrong | A mutation API route doesn't have `forbidPageEdit()` call, allowing read-only users to edit via direct API access |
| Severity | **HIGH** — Security vulnerability; defeats the purpose of read-only mode |
| Likelihood | Medium — Easy to miss when adding new endpoints |
| Mitigation | 1. Thorough code review of all 10 mutation routes<br>2. API test suite that verifies 403 for read-only users on ALL mutations<br>3. Checklist for future endpoint additions |

**Risk 2: UI/API Mismatch — Button hidden but API still allows**

| Aspect | Assessment |
|--------|------------|
| What could go wrong | UI hides edit button (read-only) but API doesn't have the check; or vice versa |
| Severity | **MEDIUM** — Either confusing UX (button hidden but API works) or security gap (button shown but API rejects) |
| Likelihood | Low — If we follow the implementation order (API first, then UI) |
| Mitigation | 1. Implement API checks BEFORE UI changes<br>2. Test both UI and API for each page before moving to next |

**Risk 3: Override Not Taking Effect — JWT caching**

| Aspect | Assessment |
|--------|------------|
| What could go wrong | Admin sets canEdit=false for a user, but user continues editing because old JWT still has full permissions |
| Severity | **MEDIUM** — Delay in enforcement (up to 24 hours until JWT expires) |
| Likelihood | High — This is expected behavior given JWT-based sessions |
| Mitigation | 1. Document that changes take effect on next login<br>2. Admin UI shows warning: "Changes take effect when user logs in again"<br>3. Consider force-logout mechanism for urgent cases (future enhancement) |

**Risk 4: Interaction with canManageUsers Causes Confusion**

| Aspect | Assessment |
|--------|------------|
| What could go wrong | Admin sets canEdit=true on page 7 for a manager, expects them to be able to manage users, but canManageUsers=false from role still blocks them |
| Severity | **LOW** — Confusion, not security issue |
| Likelihood | Medium — AND logic is unintuitive without explanation |
| Mitigation | 1. Admin UI shows role's default flags<br>2. Tooltip: "Edit permission cannot grant capabilities beyond role defaults"<br>3. Clear documentation |

---

## Phase 11 Summary — Implementation Plan

| Aspect | Decision |
|--------|----------|
| Total files to modify | ~25 files |
| Implementation batches | 5 batches (Foundation → API → UI → Pages → Admin UI) |
| Template page | GC Hub (already has canEdit pattern) |
| Testing approach | API tests first, then manual, then E2E |
| Primary risk | API enforcement gaps — mitigate with test suite |

---

## Addendum A: Investigation Gaps

> **Instructions:** As you work through the phases above, if you discover information that contradicts earlier findings, reveals new files/patterns not covered by the questions, or surfaces additional concerns, record them here.

### Gap A.1 — First investigation not yet implemented
- **Discovered during:** Phase 7.1
- **Finding:** The `UserPageOverride` model proposed in the first investigation (`permissions-upgrade.md`) has NOT been implemented. No table exists in the database, no Prisma model, no API endpoints.
- **Impact on implementation:** Both page access AND edit toggles must be implemented together as a single feature. The schema and API proposed in this document should be considered the combined design.

### Gap A.2 — SGA Hub and SGA Management share components and APIs
- **Discovered during:** Phase 2.2
- **Finding:** SGA Management has no dedicated API routes — it reuses SGA Hub's `/api/sga-hub/*` endpoints. The `AdminSGATable` component is shared between both pages.
- **Impact on implementation:** Changes to `AdminSGATable.tsx` affect both pages simultaneously. API enforcement for page 8 automatically protects page 9. However, **per-page `canEdit` overrides need careful consideration** — should a user with canEdit=false on page 8 but canEdit=true on page 9 be allowed to edit? **Recommendation:** Treat pages 8 and 9 independently. The API routes serve both, so check both `permissions.editablePages.includes(8) || permissions.editablePages.includes(9)`.

---

## Addendum B: Cross-Reference with Page Access Investigation

> **Instructions:** Record any findings from this investigation that require changes to the page access override implementation (the first doc). For example, if the data model needs to be redesigned, note it here.

### Cross-Ref B.1 — Combined schema design
- **Finding:** This investigation proposes adding `canEdit Boolean @default(true)` to the `UserPageOverride` model.
- **Required change to page access implementation:** The schema in the first investigation should be updated to include the `canEdit` field from the start. Final schema:
```prisma
model UserPageOverride {
  id        String   @id @default(cuid())
  userId    String
  pageId    Int
  hasAccess Boolean  @default(true)
  canEdit   Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, pageId])
}
```

### Cross-Ref B.2 — Admin UI should be combined
- **Finding:** The admin UI for page overrides was proposed but not built in the first investigation.
- **Required change to page access implementation:** The UserModal extension should implement BOTH access toggles and edit toggles together (as designed in Phase 9.2 of this document). Do not implement page access toggles alone — wait and build the combined UI.

---

## Summary: Key Decisions Needed Before Implementation

After completing all phases, Claude Code should fill in the recommended answer for each:

| Decision | Options | Recommendation | Rationale |
|----------|---------|----------------|-----------|
| canEdit data shape in permissions | `editablePages: number[]` vs. `{pageId, canEdit}[]` vs. `Record<number, boolean>` | **`editablePages: number[]`** | Zero impact on existing code; simple check semantics; mirrors existing allowedPages pattern |
| Resolution hierarchy | Override-first vs. most-restrictive-wins vs. independent checks | **Most restrictive wins (AND)** | Security default; canEdit cannot elevate beyond role; intuitive for admins |
| canEdit + canManageUsers interaction | Independent (both must be true) vs. canEdit overrides role flags | **Both must be true (AND)** | No privilege escalation; consistent with existing role+flag model |
| canExport when canEdit is false | Allow export vs. block export | **Allow export** | Export is read-only; separate concern from mutations; existing pattern |
| Client disable strategy | Prop drilling vs. Context vs. ReadOnlyGuard wrapper | **Prop drilling** | Max 3 levels deep; explicit; matches existing canManageRequests pattern |
| Read-only visual indicator | Banner vs. toast vs. badge vs. disabled styling only | **ReadOnlyBanner component** | Amber warning style; matches existing error banner pattern; placed below header |
| Admin UI toggle pattern | Two toggles vs. three-state vs. toggle+checkbox | **Access toggle + edit checkbox** | Access primary, edit secondary; checkbox only visible when relevant |
| Template page for implementation | SGA Hub vs. Settings vs. GC Hub vs. SGA Management | **GC Hub** | Already has canEdit prop pattern; isolated; smallest component tree |

---

## Investigation Complete

This document now contains a complete analysis of the read-only vs. edit enforcement requirements for the Savvy Dashboard. All 11 phases have been executed with findings recorded inline.

**Key deliverables:**
1. ✅ Complete mutation inventory for 4 target pages (11 endpoints)
2. ✅ Existing pattern analysis (`canEdit` prop, `canManageRequests` prop drilling)
3. ✅ Data model extension proposal (`editablePages: number[]`)
4. ✅ API enforcement design (`forbidPageEdit()` function)
5. ✅ Client-side enforcement patterns (prop drilling, hide buttons)
6. ✅ Admin UI design (toggle + checkbox per page)
7. ✅ Permission interaction resolution (AND logic)
8. ✅ File change inventory (~25 files)
9. ✅ Implementation order (5 batches, GC Hub first)
10. ✅ Testing strategy (API → Manual → E2E)
11. ✅ Risk assessment (4 risks identified with mitigations)

**Next step:** Use this document as the knowledge base to write the implementation guide.
