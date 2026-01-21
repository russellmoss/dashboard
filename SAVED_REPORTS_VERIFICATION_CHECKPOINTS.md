# Saved Reports Implementation - Verification Checkpoints

## Risk Assessment

| Phase | Risk Level | Why | Consequence if Broken |
|-------|------------|-----|----------------------|
| Phase 1: Database | 🔴 HIGH | Foundation - everything depends on this | All subsequent phases fail |
| Phase 2: Types | 🟡 MEDIUM | TypeScript will catch most issues | Compile errors, but fixable |
| Phase 3: API Routes | 🔴 HIGH | Backend logic, permissions, data integrity | Silent failures, data corruption |
| Phase 4: API Client | 🟡 MEDIUM | Just fetch wrappers | Easy to debug |
| Phase 5: UI Components | 🟡 MEDIUM | Isolated components | Visual bugs, but contained |
| Phase 6: Dashboard Integration | 🔴 HIGH | Complex state management, many moving parts | Dashboard breaks entirely |

---

## Checkpoint 1: After Phase 1 (Database Schema)

### What Could Go Wrong
- Migration fails due to syntax error
- Relation to User model breaks existing queries
- Indexes not created properly
- Field types incorrect (e.g., Json vs String)

### Verification Steps

**1.1 Run Migration**
```bash
npx prisma migrate dev --name add_saved_reports
```
- [ ] Migration completes without errors
- [ ] No warnings about data loss

**1.2 Verify Schema in Prisma Studio**
```bash
npx prisma studio
```
- [ ] `SavedReport` table appears in the list
- [ ] All columns exist with correct types:
  - `id` (String)
  - `userId` (String, nullable)
  - `name` (String)
  - `description` (String, nullable)
  - `filters` (Json)
  - `featureSelection` (Json, nullable)
  - `viewMode` (String, nullable)
  - `dashboard` (String)
  - `reportType` (String)
  - `isDefault` (Boolean)
  - `isActive` (Boolean)
  - `createdAt` (DateTime)
  - `updatedAt` (DateTime)
  - `createdBy` (String, nullable)

**1.3 Verify User Relation Still Works**
```bash
npx prisma studio
```
- [ ] Click on `User` table
- [ ] Verify existing users still load
- [ ] Verify `savedReports` relation appears (may show as empty array)

**1.4 Test Direct Database Insert (Optional but Recommended)**

In Prisma Studio or via a quick script:
```typescript
// Quick test script - run via: npx ts-node scripts/test-saved-report.ts
import { prisma } from '../src/lib/prisma';

async function test() {
  // Get a test user
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log('No users found - create a user first');
    return;
  }

  // Create a test report
  const report = await prisma.savedReport.create({
    data: {
      userId: user.id,
      name: 'Test Report',
      filters: { startDate: '2026-01-01', endDate: '2026-01-20' },
      dashboard: 'funnel_performance',
      reportType: 'user',
      createdBy: user.email,
    },
  });
  
  console.log('Created report:', report);
  
  // Clean up
  await prisma.savedReport.delete({ where: { id: report.id } });
  console.log('Deleted test report');
}

test().catch(console.error);
```

- [ ] Script runs without errors
- [ ] Report is created and deleted successfully

### 🚫 STOP HERE IF ANY CHECK FAILS
Do not proceed to Phase 2 until all database checks pass.

---

## Checkpoint 2: After Phase 2 (Type Definitions)

### What Could Go Wrong
- Type imports fail
- Interface doesn't match Prisma schema
- Export not found errors

### Verification Steps

**2.1 TypeScript Compilation**
```bash
npx tsc --noEmit
```
- [ ] No TypeScript errors related to `saved-reports.ts`
- [ ] No errors in files that import from `@/types/saved-reports`

**2.2 Verify Imports Work**

Create a quick test file or check in your IDE:
```typescript
// Test in any file
import { 
  SavedReport, 
  FeatureSelection, 
  DEFAULT_FEATURE_SELECTION,
  getEffectiveFeatureSelection 
} from '@/types/saved-reports';

// Should not show any red squiggles
const test: FeatureSelection = DEFAULT_FEATURE_SELECTION;
console.log(test.scorecards.fullFunnel); // Should autocomplete
```

- [ ] All imports resolve
- [ ] IntelliSense/autocomplete works for types

### 🚫 STOP HERE IF ANY CHECK FAILS
Do not proceed to Phase 3 until types compile correctly.

---

## Checkpoint 3: After Phase 3 (API Routes) - CRITICAL

### What Could Go Wrong
- Authentication not working
- Permissions check failing
- Prisma queries incorrect
- JSON serialization issues
- Wrong HTTP status codes

### Verification Steps

**3.1 Start Development Server**
```bash
npm run dev
```
- [ ] Server starts without errors
- [ ] No TypeScript errors in API route files

**3.2 Test GET /api/saved-reports (Unauthenticated)**

Using browser, Postman, or curl:
```bash
curl http://localhost:3000/api/saved-reports
```
- [ ] Returns `401 Unauthorized` (not 500 error)

**3.3 Test GET /api/saved-reports (Authenticated)**

Log into your app in the browser, then:
1. Open DevTools → Network tab
2. Run in Console:
```javascript
fetch('/api/saved-reports')
  .then(r => r.json())
  .then(console.log)
  .catch(console.error);
```

- [ ] Returns `200 OK`
- [ ] Response has structure: `{ userReports: [], adminTemplates: [] }`
- [ ] No errors in server console

**3.4 Test POST /api/saved-reports (Create Report)**

In browser DevTools Console (while logged in):
```javascript
fetch('/api/saved-reports', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Test Report from Console',
    description: 'Testing API',
    filters: {
      startDate: '2026-01-01',
      endDate: '2026-01-20',
      datePreset: 'custom',
      year: 2026,
      channel: null,
      source: null,
      sga: null,
      sgm: null,
      stage: null,
      experimentationTag: null,
      metricFilter: 'all'
    },
    featureSelection: {
      scorecards: { fullFunnel: true, volume: true },
      conversionRates: true,
      charts: { conversionTrends: true, volumeTrends: true },
      tables: { channelPerformance: true, sourcePerformance: true, detailRecords: true }
    },
    viewMode: 'focused',
    isDefault: false
  })
})
  .then(r => r.json())
  .then(data => {
    console.log('Created:', data);
    window.testReportId = data.report.id; // Save for later tests
  })
  .catch(console.error);
```

- [ ] Returns `201 Created`
- [ ] Response has `report` object with all fields
- [ ] `report.id` is a valid cuid
- [ ] Check Prisma Studio - report appears in database

**3.5 Test GET /api/saved-reports/[id]**

```javascript
fetch(`/api/saved-reports/${window.testReportId}`)
  .then(r => r.json())
  .then(console.log);
```

- [ ] Returns `200 OK`
- [ ] Returns the correct report

**3.6 Test PUT /api/saved-reports/[id] (Update)**

```javascript
fetch(`/api/saved-reports/${window.testReportId}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Updated Test Report',
    description: 'Updated description'
  })
})
  .then(r => r.json())
  .then(console.log);
```

- [ ] Returns `200 OK`
- [ ] Name and description are updated
- [ ] Check Prisma Studio - changes persisted

**3.7 Test POST /api/saved-reports/[id]/set-default**

```javascript
fetch(`/api/saved-reports/${window.testReportId}/set-default`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
})
  .then(r => r.json())
  .then(console.log);
```

- [ ] Returns `200 OK`
- [ ] Report now has `isDefault: true`

**3.8 Test GET /api/saved-reports/default**

```javascript
fetch('/api/saved-reports/default')
  .then(r => r.json())
  .then(console.log);
```

- [ ] Returns `200 OK`
- [ ] Returns the report we just set as default

**3.9 Test POST /api/saved-reports/[id]/duplicate**

```javascript
fetch(`/api/saved-reports/${window.testReportId}/duplicate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
})
  .then(r => r.json())
  .then(data => {
    console.log('Duplicated:', data);
    window.duplicateReportId = data.report.id;
  });
```

- [ ] Returns `201 Created`
- [ ] New report has name with "(Copy)" suffix
- [ ] New report has `isDefault: false`
- [ ] Check Prisma Studio - two reports exist

**3.10 Test DELETE /api/saved-reports/[id]**

```javascript
// Delete the duplicate
fetch(`/api/saved-reports/${window.duplicateReportId}`, {
  method: 'DELETE'
})
  .then(r => r.json())
  .then(console.log);
```

- [ ] Returns `200 OK`
- [ ] Check Prisma Studio - report has `isActive: false` (soft delete)

**3.11 Test Admin Template (If You Have Admin Access)**

```javascript
fetch('/api/saved-reports', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Test Admin Template',
    filters: { /* same as above */ },
    reportType: 'admin_template'
  })
})
  .then(r => r.json())
  .then(console.log);
```

- [ ] If admin: Returns `201 Created` with `reportType: 'admin_template'`
- [ ] If not admin: Returns `403 Forbidden`

**3.12 Clean Up Test Data**

In Prisma Studio, delete the test reports created during testing.

### 🚫 STOP HERE IF ANY CHECK FAILS
Do not proceed to Phase 4 until all API routes work correctly.

---

## Checkpoint 4: After Phase 4 (API Client)

### What Could Go Wrong
- Fetch functions have wrong URLs
- Response parsing incorrect
- Error handling missing

### Verification Steps

**4.1 TypeScript Compilation**
```bash
npx tsc --noEmit
```
- [ ] No errors in `api-client.ts`

**4.2 Test API Client Functions in Browser Console**

After adding the functions to `dashboardApi`, test in browser:

```javascript
// These should work after Phase 4
// (assuming you're importing dashboardApi somewhere accessible)

// Or test by temporarily adding to window in your dashboard page:
// window.dashboardApi = dashboardApi;

// Then in console:
dashboardApi.getSavedReports().then(console.log);
dashboardApi.getDefaultReport().then(console.log);
```

- [ ] Functions exist on `dashboardApi` object
- [ ] Functions return expected data

### 🚫 STOP HERE IF ANY CHECK FAILS

---

## Checkpoint 5: After Phase 5 (UI Components)

### What Could Go Wrong
- Components don't render
- Missing imports
- Props interface mismatch
- Styling broken

### Verification Steps

**5.1 TypeScript Compilation**
```bash
npx tsc --noEmit
```
- [ ] No errors in component files

**5.2 Test Components in Isolation (Optional but Recommended)**

Create a temporary test page at `src/app/test-components/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { SaveReportModal } from '@/components/dashboard/SaveReportModal';
import { SavedReportsDropdown } from '@/components/dashboard/SavedReportsDropdown';
import { DeleteConfirmModal } from '@/components/dashboard/DeleteConfirmModal';
import { DEFAULT_FILTERS } from '@/types/filters';
import { DEFAULT_FEATURE_SELECTION } from '@/types/saved-reports';

export default function TestComponentsPage() {
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const mockReports = {
    userReports: [
      {
        id: '1',
        userId: 'user1',
        name: 'My Q1 Report',
        description: 'Testing',
        filters: DEFAULT_FILTERS,
        featureSelection: DEFAULT_FEATURE_SELECTION,
        viewMode: 'focused' as const,
        dashboard: 'funnel_performance',
        reportType: 'user' as const,
        isDefault: true,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'test@test.com',
      },
    ],
    adminTemplates: [
      {
        id: '2',
        userId: null,
        name: 'Admin Template',
        description: 'For everyone',
        filters: DEFAULT_FILTERS,
        featureSelection: DEFAULT_FEATURE_SELECTION,
        viewMode: 'fullFunnel' as const,
        dashboard: 'funnel_performance',
        reportType: 'admin_template' as const,
        isDefault: false,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'admin@test.com',
      },
    ],
  };

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-2xl font-bold">Component Test Page</h1>
      
      <div>
        <h2 className="text-lg font-semibold mb-2">SavedReportsDropdown</h2>
        <SavedReportsDropdown
          userReports={mockReports.userReports}
          adminTemplates={mockReports.adminTemplates}
          activeReportId="1"
          onSelectReport={(r) => console.log('Selected:', r)}
          onEditReport={(r) => console.log('Edit:', r)}
          onDuplicateReport={(r) => console.log('Duplicate:', r)}
          onDeleteReport={(r) => setIsDeleteModalOpen(true)}
          onSetDefault={(r) => console.log('Set default:', r)}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">SaveReportModal</h2>
        <button 
          onClick={() => setIsSaveModalOpen(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          Open Save Modal
        </button>
        <SaveReportModal
          isOpen={isSaveModalOpen}
          onClose={() => setIsSaveModalOpen(false)}
          onSave={async (...args) => {
            console.log('Save args:', args);
            setIsSaveModalOpen(false);
          }}
          currentFilters={DEFAULT_FILTERS}
          currentViewMode="focused"
          currentFeatureSelection={DEFAULT_FEATURE_SELECTION}
          isAdmin={true}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">DeleteConfirmModal</h2>
        <button 
          onClick={() => setIsDeleteModalOpen(true)}
          className="px-4 py-2 bg-red-500 text-white rounded"
        >
          Open Delete Modal
        </button>
        <DeleteConfirmModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          onConfirm={() => {
            console.log('Deleted!');
            setIsDeleteModalOpen(false);
          }}
          reportName="Test Report"
        />
      </div>
    </div>
  );
}
```

Visit `http://localhost:3000/test-components`:

- [ ] Page loads without errors
- [ ] SavedReportsDropdown renders and opens on click
- [ ] Dropdown shows "My Reports" and "Templates" sections
- [ ] Menu items (Edit, Duplicate, Delete, Set Default) appear
- [ ] SaveReportModal opens and shows all form fields
- [ ] Feature selection checkboxes work
- [ ] DeleteConfirmModal opens with correct styling
- [ ] All modals close properly
- [ ] Dark mode works (if applicable)

**5.3 Delete Test Page**

After testing, delete `src/app/test-components/page.tsx`.

### 🚫 STOP HERE IF ANY CHECK FAILS

---

## Checkpoint 6: After Phase 6 (Dashboard Integration) - CRITICAL

### What Could Go Wrong
- State management bugs
- Infinite re-render loops
- Conditional rendering broken
- Data not fetching correctly
- Feature selection not working

### Verification Steps

**6.1 Page Loads Without Errors**
```bash
npm run dev
```
Navigate to `/dashboard`

- [ ] Page loads without blank screen
- [ ] No errors in browser console
- [ ] No errors in terminal

**6.2 Saved Reports UI Appears**

- [ ] "Saved Reports" dropdown appears in GlobalFilters
- [ ] "Save" button appears next to dropdown
- [ ] Dropdown shows "No saved reports yet" if empty

**6.3 Create First Report**

1. Set some filters (e.g., specific date range, channel)
2. Click "Save" button
3. Enter name: "Test Report 1"
4. Enter description: "My first test"
5. Leave all features checked
6. Check "Set as my default report"
7. Click Save

- [ ] Modal closes after save
- [ ] New report appears in dropdown
- [ ] Report shows star icon (default)
- [ ] No errors in console

**6.4 Apply Saved Report**

1. Change filters to something different
2. Select "Test Report 1" from dropdown

- [ ] Filters change to saved values
- [ ] Dropdown shows "Test Report 1" as active
- [ ] Dashboard data reloads

**6.5 Feature Selection Works**

1. Click "Save" button
2. Uncheck "Volume Trends" chart
3. Uncheck "Detail Records" table
4. Save as "Limited Features Report"
5. Select this report from dropdown

- [ ] Volume Trends chart disappears
- [ ] Detail Records table disappears
- [ ] Other components still visible
- [ ] Check Network tab: fewer API calls made

**6.6 Manual Filter Change Clears Active Report**

1. Select "Test Report 1" from dropdown
2. Change any filter manually (e.g., date range)

- [ ] Dropdown no longer shows "Test Report 1" as selected
- [ ] Dropdown shows "Saved Reports" placeholder

**6.7 Edit Report**

1. Open dropdown
2. Click "..." menu on a report
3. Click "Edit"
4. Change name
5. Save

- [ ] Modal opens with pre-filled data
- [ ] Changes save correctly
- [ ] Dropdown shows updated name

**6.8 Duplicate Report**

1. Open dropdown
2. Click "..." menu on a report
3. Click "Duplicate"

- [ ] New report appears with "(Copy)" suffix
- [ ] Original report unchanged

**6.9 Delete Report**

1. Open dropdown
2. Click "..." menu on a report
3. Click "Delete"
4. Confirm deletion

- [ ] Confirmation modal appears
- [ ] Report disappears from dropdown after confirm
- [ ] If deleted report was active, dropdown resets

**6.10 Default Report Auto-Loads**

1. Set a report as default
2. Refresh the page (Cmd+R / Ctrl+R)

- [ ] Default report auto-applies on page load
- [ ] Filters match saved values
- [ ] Feature selection matches saved values

**6.11 Reset Button Works**

1. Apply a saved report
2. Click "Reset" button

- [ ] Filters reset to defaults
- [ ] All features become visible
- [ ] Active report clears

**6.12 Admin Template (If Admin)**

1. Click "Save" button
2. Check "Save as template (visible to all users)"
3. Save as "Company Template"

- [ ] Template appears in "Templates" section of dropdown
- [ ] Log in as non-admin user
- [ ] Template is visible and can be applied
- [ ] Non-admin cannot edit/delete template
- [ ] Non-admin can duplicate template

### 🚫 STOP HERE IF ANY CHECK FAILS

---

## Final Verification: Full Flow Test

### Happy Path Test

1. [ ] Fresh user sees empty dropdown
2. [ ] User creates first report with all features
3. [ ] User sets report as default
4. [ ] User refreshes page - default loads
5. [ ] User creates second report with limited features
6. [ ] User switches between reports
7. [ ] User duplicates a report
8. [ ] User edits a report
9. [ ] User deletes a report
10. [ ] User resets to default view

### Edge Cases

1. [ ] Create report with very long name (255 chars)
2. [ ] Create report with special characters in name
3. [ ] Save report with all features unchecked (should still work)
4. [ ] Rapid clicking Save button (no duplicate reports)
5. [ ] Network error during save (graceful error handling)
6. [ ] Delete the currently active default report

### Performance Check

1. Open DevTools Network tab
2. Apply report with only 1 table visible

- [ ] Only necessary API calls are made
- [ ] Hidden features don't trigger fetches

---

## Rollback Plan

If something goes seriously wrong:

### Database Rollback
```bash
npx prisma migrate reset
# WARNING: This will delete all data!
```

Or manually:
```sql
DROP TABLE IF EXISTS "SavedReport";
```

### Code Rollback
```bash
git checkout -- prisma/schema.prisma
git checkout -- src/types/saved-reports.ts
git checkout -- src/app/api/saved-reports/
git checkout -- src/components/dashboard/SaveReportModal.tsx
git checkout -- src/components/dashboard/SavedReportsDropdown.tsx
git checkout -- src/components/dashboard/DeleteConfirmModal.tsx
git checkout -- src/components/dashboard/GlobalFilters.tsx
git checkout -- src/app/dashboard/page.tsx
git checkout -- src/lib/api-client.ts
```

---

## Summary: Safe Implementation Order

```
Phase 1: Database → CHECKPOINT 1 (verify migration)
    ↓
Phase 2: Types → CHECKPOINT 2 (verify compilation)
    ↓
Phase 3: API Routes → CHECKPOINT 3 (verify all endpoints) ⚠️ CRITICAL
    ↓
Phase 4: API Client → CHECKPOINT 4 (verify functions)
    ↓
Phase 5: UI Components → CHECKPOINT 5 (verify isolation)
    ↓
Phase 6: Dashboard Integration → CHECKPOINT 6 (full testing) ⚠️ CRITICAL
    ↓
Phase 7: Testing Checklist
    ↓
Phase 8: .cursorrules Update
```

**Estimated time with checkpoints**: 5-7 hours (adds ~2 hours of verification but saves debugging time)
