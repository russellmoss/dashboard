# Saved Reports Feature - Agentic Implementation Plan

**Feature Name**: Saved Reports (Custom Reporting)  
**Version**: 1.0  
**Created**: January 20, 2026  
**Status**: Ready for Implementation

---

## Executive Summary

This plan implements a "Saved Reports" feature allowing users to:
1. Save filter presets with custom names and descriptions
2. Select which dashboard features (scorecards, charts, tables) to display
3. Set a default report that auto-loads on dashboard visit
4. Duplicate existing reports
5. Access admin-created template reports

**Key Files to Create/Modify**:
- 1 new Prisma model (SavedReport)
- 5 new API routes
- 3 new UI components
- 2 modified existing components (GlobalFilters, dashboard page)
- 1 new type definition file (saved-reports.ts)
- Updates to api-client.ts

**Critical Corrections Made** (based on codebase review):
1. ✅ Fixed Prisma import: Use `import { prisma } from '@/lib/prisma'` (named export)
2. ✅ Fixed logger import: Use `import { logger } from '@/lib/logger'`
3. ✅ Fixed permissions check: Use `getUserPermissions()` from `@/lib/permissions`, not `user.role` directly
4. ✅ Fixed unique constraint: Prisma doesn't support WHERE in `@@unique` - enforce in application logic
5. ✅ Fixed API client location: Add to existing `dashboardApi` object in `api-client.ts`, not separate file
6. ✅ Fixed session permissions: Use `getSessionPermissions()` from `@/types/auth` for client-side checks
7. ✅ Fixed dependency arrays: `loadDefaultReport` depends on `applyReport`
8. ✅ Added .cursorrules update section for future development awareness
9. ✅ Integrated verification checkpoints after each phase for safe implementation

**Verification Checkpoints**:
- ✅ Checkpoint 1: After Phase 1 (Database) - Verify migration and schema
- ✅ Checkpoint 2: After Phase 2 (Types) - Verify TypeScript compilation
- ✅ Checkpoint 3: After Phase 3 (API Routes) - Verify all endpoints work
- ✅ Checkpoint 4: After Phase 4 (API Client) - Verify functions exist
- ✅ Checkpoint 5: After Phase 5 (UI Components) - Verify components render
- ✅ Checkpoint 6: After Phase 6 (Dashboard Integration) - Full end-to-end testing

---

## Table of Contents

1. [Phase 1: Database Schema](#phase-1-database-schema)
   - Step 1.1: Add SavedReport Model
   - Step 1.2: Run Prisma Migration
   - **Step 1.3: ✅ CHECKPOINT 1 - Database Schema Verification**
2. [Phase 2: Type Definitions](#phase-2-type-definitions)
   - Step 2.1: Create SavedReport Types
   - Step 2.2: Export from Types Index
   - **Step 2.3: ✅ CHECKPOINT 2 - Type Definitions Verification**
3. [Phase 3: API Routes](#phase-3-api-routes)
   - Step 3.1: Create GET/POST /api/saved-reports
   - Step 3.2: Create GET/PUT/DELETE /api/saved-reports/[id]
   - Step 3.3: Create POST /api/saved-reports/[id]/set-default
   - Step 3.4: Create POST /api/saved-reports/[id]/duplicate
   - Step 3.5: Create GET /api/saved-reports/default
   - **Step 3.6: ✅ CHECKPOINT 3 - API Routes Verification**
4. [Phase 4: API Client](#phase-4-api-client)
   - Step 4.1: Add Saved Reports API Client Functions
   - **Step 4.2: ✅ CHECKPOINT 4 - API Client Verification**
5. [Phase 5: UI Components](#phase-5-ui-components)
   - Step 5.1: Create SaveReportModal Component
   - Step 5.2: Create SavedReportsDropdown Component
   - Step 5.3: Create DeleteConfirmModal Component
   - **Step 5.4: ✅ CHECKPOINT 5 - UI Components Verification**
6. [Phase 6: Dashboard Integration](#phase-6-dashboard-integration)
   - Step 6.1: Update GlobalFilters Component
   - Step 6.2: Update Dashboard Page
   - **Step 6.3: ✅ CHECKPOINT 6 - Dashboard Integration Verification**
7. [Phase 7: Testing & Validation](#phase-7-testing--validation)
   - Step 7.1: Manual Testing Checklist
   - Step 7.2: Edge Cases to Test
   - Step 7.3: Final Verification - Full Flow Test
   - Step 7.4: Rollback Plan
8. [Phase 8: Update .cursorrules for Future Development](#phase-8-update-cursorrules-for-future-development)
9. [Appendix: Complete Code References](#appendix-complete-code-references)

---

## Phase 1: Database Schema

### Step 1.1: Add SavedReport Model to Prisma Schema

**File**: `prisma/schema.prisma`

**Action**: Add the following model at the end of the file, after the `ExploreFeedback` model:

```prisma
model SavedReport {
  id               String   @id @default(cuid())
  userId           String?  // NULL for admin templates
  name             String   @db.VarChar(255)
  description      String?  @db.VarChar(500)
  filters          Json     // Complete DashboardFilters object
  featureSelection Json?    // Optional FeatureSelection object (null = show all)
  viewMode         String?  @default("focused") // 'focused' | 'fullFunnel'
  dashboard        String   @default("funnel_performance")
  reportType       String   @default("user") // 'user' | 'admin_template'
  isDefault        Boolean  @default(false)
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  createdBy        String?  // Email of creator

  // Relations
  user User? @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([reportType])
  @@index([isDefault])
  @@index([isActive])
  @@index([dashboard])
  // Note: Unique constraint for one default per user must be enforced in application logic
  // Prisma doesn't support WHERE clauses in @@unique constraints
}
```

**Action**: Update the `User` model to add the relation:

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         String   @default("viewer")
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  createdBy    String?
  
  // Add this relation
  savedReports SavedReport[]
}
```

### Step 1.2: Run Prisma Migration

**Command**:
```bash
npx prisma migrate dev --name add_saved_reports
```

**Verification**:
```bash
npx prisma studio
# Verify SavedReport table exists with all columns
```

### Step 1.3: ✅ CHECKPOINT 1 - Database Schema Verification

**⚠️ CRITICAL**: Do not proceed to Phase 2 until all checks pass.

**Risk Level**: 🔴 HIGH - Foundation - everything depends on this

**What Could Go Wrong**:
- Migration fails due to syntax error
- Relation to User model breaks existing queries
- Indexes not created properly
- Field types incorrect (e.g., Json vs String)

**Verification Steps**:

**1.3.1 Run Migration**
```bash
npx prisma migrate dev --name add_saved_reports
```
- [ ] Migration completes without errors
- [ ] No warnings about data loss

**1.3.2 Verify Schema in Prisma Studio**
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

**1.3.3 Verify User Relation Still Works**
```bash
npx prisma studio
```
- [ ] Click on `User` table
- [ ] Verify existing users still load
- [ ] Verify `savedReports` relation appears (may show as empty array)

**1.3.4 Test Direct Database Insert (Optional but Recommended)**

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

**🚫 STOP HERE IF ANY CHECK FAILS**  
Do not proceed to Phase 2 until all database checks pass.

---

## Phase 2: Type Definitions

### Step 2.1: Create SavedReport Types

**File**: `src/types/saved-reports.ts` (CREATE NEW FILE)

```typescript
import { DashboardFilters } from './filters';
import { ViewMode } from './dashboard';

/**
 * Feature Selection - Controls which dashboard components are visible
 * Grouped by component granularity (not individual cards)
 */
export interface FeatureSelection {
  scorecards: {
    fullFunnel: boolean;  // Prospects, Contacted, MQLs (only available in fullFunnel mode)
    volume: boolean;      // SQLs, SQOs, Signed, Joined, Open Pipeline
  };
  conversionRates: boolean;  // All 4 conversion rate cards
  charts: {
    conversionTrends: boolean;
    volumeTrends: boolean;
  };
  tables: {
    channelPerformance: boolean;
    sourcePerformance: boolean;
    detailRecords: boolean;
  };
}

/**
 * Default feature selection - all features visible
 */
export const DEFAULT_FEATURE_SELECTION: FeatureSelection = {
  scorecards: {
    fullFunnel: true,
    volume: true,
  },
  conversionRates: true,
  charts: {
    conversionTrends: true,
    volumeTrends: true,
  },
  tables: {
    channelPerformance: true,
    sourcePerformance: true,
    detailRecords: true,
  },
};

/**
 * Report type discriminator
 */
export type ReportType = 'user' | 'admin_template';

/**
 * Saved Report - stored in database
 */
export interface SavedReport {
  id: string;
  userId: string | null;
  name: string;
  description: string | null;
  filters: DashboardFilters;
  featureSelection: FeatureSelection | null;
  viewMode: ViewMode | null;
  dashboard: string;
  reportType: ReportType;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

/**
 * Create/Update SavedReport payload
 */
export interface SavedReportInput {
  name: string;
  description?: string;
  filters: DashboardFilters;
  featureSelection?: FeatureSelection;
  viewMode?: ViewMode;
  isDefault?: boolean;
  reportType?: ReportType; // Only admins can set 'admin_template'
}

/**
 * API response for list of saved reports
 */
export interface SavedReportsResponse {
  userReports: SavedReport[];
  adminTemplates: SavedReport[];
}

/**
 * API response for single saved report
 */
export interface SavedReportResponse {
  report: SavedReport;
}

/**
 * Get effective feature selection (with defaults)
 */
export function getEffectiveFeatureSelection(
  featureSelection: FeatureSelection | null | undefined
): FeatureSelection {
  if (!featureSelection) {
    return DEFAULT_FEATURE_SELECTION;
  }
  
  // Merge with defaults to handle any missing fields (backward compatibility)
  return {
    scorecards: {
      fullFunnel: featureSelection.scorecards?.fullFunnel ?? true,
      volume: featureSelection.scorecards?.volume ?? true,
    },
    conversionRates: featureSelection.conversionRates ?? true,
    charts: {
      conversionTrends: featureSelection.charts?.conversionTrends ?? true,
      volumeTrends: featureSelection.charts?.volumeTrends ?? true,
    },
    tables: {
      channelPerformance: featureSelection.tables?.channelPerformance ?? true,
      sourcePerformance: featureSelection.tables?.sourcePerformance ?? true,
      detailRecords: featureSelection.tables?.detailRecords ?? true,
    },
  };
}
```

### Step 2.2: Export from Types Index

**File**: `src/types/index.ts`

**Action**: Add export (create file if doesn't exist, or add to existing):

```typescript
export * from './saved-reports';
```

### Step 2.3: ✅ CHECKPOINT 2 - Type Definitions Verification

**⚠️ CRITICAL**: Do not proceed to Phase 3 until all checks pass.

**Risk Level**: 🟡 MEDIUM - TypeScript will catch most issues

**What Could Go Wrong**:
- Type imports fail
- Interface doesn't match Prisma schema
- Export not found errors

**Verification Steps**:

**2.3.1 TypeScript Compilation**
```bash
npx tsc --noEmit
```
- [ ] No TypeScript errors related to `saved-reports.ts`
- [ ] No errors in files that import from `@/types/saved-reports`

**2.3.2 Verify Imports Work**

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

**🚫 STOP HERE IF ANY CHECK FAILS**  
Do not proceed to Phase 3 until types compile correctly.

---

## Phase 3: API Routes

### Step 3.1: Create GET /api/saved-reports (List Reports)

**File**: `src/app/api/saved-reports/route.ts` (CREATE NEW FILE)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getUserPermissions } from '@/lib/permissions'; // Required for admin permission checks

/**
 * GET /api/saved-reports
 * Returns user's saved reports + all admin templates
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Fetch user's reports
    const userReports = await prisma.savedReport.findMany({
      where: {
        userId: user.id,
        isActive: true,
        dashboard: 'funnel_performance',
      },
      orderBy: [
        { isDefault: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    // Fetch admin templates (userId is NULL, reportType is 'admin_template')
    const adminTemplates = await prisma.savedReport.findMany({
      where: {
        reportType: 'admin_template',
        isActive: true,
        dashboard: 'funnel_performance',
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      userReports: userReports.map(r => ({
        ...r,
        filters: r.filters as any,
        featureSelection: r.featureSelection as any,
      })),
      adminTemplates: adminTemplates.map(r => ({
        ...r,
        filters: r.filters as any,
        featureSelection: r.featureSelection as any,
      })),
    });
  } catch (error) {
    logger.error('[GET /api/saved-reports] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch saved reports' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/saved-reports
 * Create a new saved report
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const { name, description, filters, featureSelection, viewMode, isDefault, reportType } = body;

    // Validate required fields
    if (!name || !filters) {
      return NextResponse.json(
        { error: 'Name and filters are required' },
        { status: 400 }
      );
    }

    // Validate name length
    if (name.length > 255) {
      return NextResponse.json(
        { error: 'Name must be 255 characters or less' },
        { status: 400 }
      );
    }

    // Check if admin template and user has permission
    const permissions = await getUserPermissions(session.user.email);
    const isAdminTemplate = reportType === 'admin_template';
    if (isAdminTemplate && !['admin', 'manager'].includes(permissions.role)) {
      return NextResponse.json(
        { error: 'Only admins can create templates' },
        { status: 403 }
      );
    }

    // If setting as default, unset any existing default for this user
    // CRITICAL: Must enforce one default per user in application logic (Prisma doesn't support WHERE in @@unique)
    if (isDefault && !isAdminTemplate) {
      await prisma.savedReport.updateMany({
        where: {
          userId: user.id,
          isDefault: true,
          isActive: true,
        },
        data: { isDefault: false },
      });
    }

    // Create the report
    const report = await prisma.savedReport.create({
      data: {
        userId: isAdminTemplate ? null : user.id,
        name: name.trim(),
        description: description?.trim() || null,
        filters,
        featureSelection: featureSelection || null,
        viewMode: viewMode || 'focused',
        dashboard: 'funnel_performance',
        reportType: isAdminTemplate ? 'admin_template' : 'user',
        isDefault: isDefault && !isAdminTemplate ? true : false,
        createdBy: session.user.email,
      },
    });

    logger.info('[POST /api/saved-reports] Created report', {
      reportId: report.id,
      userId: user.id,
      reportType: report.reportType,
    });

    return NextResponse.json({ 
      report: {
        ...report,
        filters: report.filters as any,
        featureSelection: report.featureSelection as any,
      }
    }, { status: 201 });
  } catch (error) {
    logger.error('[POST /api/saved-reports] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create saved report' },
      { status: 500 }
    );
  }
}
```

### Step 3.2: Create GET/PUT/DELETE /api/saved-reports/[id]

**File**: `src/app/api/saved-reports/[id]/route.ts` (CREATE NEW FILE)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getUserPermissions } from '@/lib/permissions';

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/saved-reports/[id]
 * Get a specific saved report
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const report = await prisma.savedReport.findUnique({
      where: { id: params.id },
    });

    if (!report || !report.isActive) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Check access: user owns it OR it's an admin template
    const canAccess = report.userId === user.id || report.reportType === 'admin_template';
    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({ report });
  } catch (error) {
    logger.error('[GET /api/saved-reports/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch saved report' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/saved-reports/[id]
 * Update a saved report
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const existingReport = await prisma.savedReport.findUnique({
      where: { id: params.id },
    });

    if (!existingReport || !existingReport.isActive) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Check edit permission: user owns it OR (it's admin template AND user is admin/manager)
    const permissions = await getUserPermissions(session.user.email);
    const isOwner = existingReport.userId === user.id;
    const isAdminEditingTemplate = 
      existingReport.reportType === 'admin_template' && 
      ['admin', 'manager'].includes(permissions.role);
    
    if (!isOwner && !isAdminEditingTemplate) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, filters, featureSelection, viewMode, isDefault } = body;

    // Validate name if provided
    if (name && name.length > 255) {
      return NextResponse.json(
        { error: 'Name must be 255 characters or less' },
        { status: 400 }
      );
    }

    // If setting as default, unset any existing default for this user
    if (isDefault && existingReport.reportType === 'user') {
      await prisma.savedReport.updateMany({
        where: {
          userId: user.id,
          isDefault: true,
          isActive: true,
          id: { not: params.id },
        },
        data: { isDefault: false },
      });
    }

    const report = await prisma.savedReport.update({
      where: { id: params.id },
      data: {
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(filters && { filters }),
        ...(featureSelection !== undefined && { featureSelection }),
        ...(viewMode && { viewMode }),
        ...(isDefault !== undefined && existingReport.reportType === 'user' && { isDefault }),
      },
    });

    logger.info('[PUT /api/saved-reports/[id]] Updated report', {
      reportId: report.id,
      userId: user.id,
    });

    return NextResponse.json({ report });
  } catch (error) {
    logger.error('[PUT /api/saved-reports/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update saved report' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/saved-reports/[id]
 * Soft delete a saved report
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const existingReport = await prisma.savedReport.findUnique({
      where: { id: params.id },
    });

    if (!existingReport || !existingReport.isActive) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Check delete permission: user owns it OR (it's admin template AND user is admin/manager)
    const permissions = await getUserPermissions(session.user.email);
    const isOwner = existingReport.userId === user.id;
    const isAdminDeletingTemplate = 
      existingReport.reportType === 'admin_template' && 
      ['admin', 'manager'].includes(permissions.role);
    
    if (!isOwner && !isAdminDeletingTemplate) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Soft delete
    await prisma.savedReport.update({
      where: { id: params.id },
      data: { isActive: false },
    });

    logger.info('[DELETE /api/saved-reports/[id]] Deleted report', {
      reportId: params.id,
      userId: user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[DELETE /api/saved-reports/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete saved report' },
      { status: 500 }
    );
  }
}
```

### Step 3.3: Create POST /api/saved-reports/[id]/set-default

**File**: `src/app/api/saved-reports/[id]/set-default/route.ts` (CREATE NEW FILE)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
// Note: getUserPermissions not needed for this route (no admin permission checks required)

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/saved-reports/[id]/set-default
 * Set a report as the user's default
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const report = await prisma.savedReport.findUnique({
      where: { id: params.id },
    });

    if (!report || !report.isActive) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Only user reports can be set as default (not admin templates)
    if (report.reportType === 'admin_template') {
      return NextResponse.json(
        { error: 'Admin templates cannot be set as default' },
        { status: 400 }
      );
    }

    // Check ownership
    if (report.userId !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Unset any existing default
    await prisma.savedReport.updateMany({
      where: {
        userId: user.id,
        isDefault: true,
        isActive: true,
      },
      data: { isDefault: false },
    });

    // Set this report as default
    const updatedReport = await prisma.savedReport.update({
      where: { id: params.id },
      data: { isDefault: true },
    });

    logger.info('[POST /api/saved-reports/[id]/set-default] Set default', {
      reportId: params.id,
      userId: user.id,
    });

    return NextResponse.json({ 
      report: {
        ...updatedReport,
        filters: updatedReport.filters as any,
        featureSelection: updatedReport.featureSelection as any,
      }
    });
  } catch (error) {
    logger.error('[POST /api/saved-reports/[id]/set-default] Error:', error);
    return NextResponse.json(
      { error: 'Failed to set default report' },
      { status: 500 }
    );
  }
}
```

### Step 3.4: Create POST /api/saved-reports/[id]/duplicate

**File**: `src/app/api/saved-reports/[id]/duplicate/route.ts` (CREATE NEW FILE)

**Note**: This route does not require `getUserPermissions` import as it only checks basic access (user owns report OR it's an admin template), not admin role permissions.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/saved-reports/[id]/duplicate
 * Duplicate an existing report (user reports or admin templates)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const sourceReport = await prisma.savedReport.findUnique({
      where: { id: params.id },
    });

    if (!sourceReport || !sourceReport.isActive) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Check access: user owns it OR it's an admin template
    const canAccess = sourceReport.userId === user.id || sourceReport.reportType === 'admin_template';
    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Optional: allow custom name from request body
    const body = await request.json().catch(() => ({}));
    const customName = body.name;

    // Generate new name
    const newName = customName || `${sourceReport.name} (Copy)`;

    // Create duplicate (always as user report, never as template)
    const duplicatedReport = await prisma.savedReport.create({
      data: {
        userId: user.id,
        name: newName.substring(0, 255), // Ensure max length
        description: sourceReport.description,
        filters: sourceReport.filters as any,
        featureSelection: sourceReport.featureSelection as any,
        viewMode: sourceReport.viewMode,
        dashboard: sourceReport.dashboard,
        reportType: 'user', // Always user report
        isDefault: false,
        createdBy: session.user.email,
      },
    });

    logger.info('[POST /api/saved-reports/[id]/duplicate] Duplicated report', {
      sourceReportId: params.id,
      newReportId: duplicatedReport.id,
      userId: user.id,
    });

    return NextResponse.json({ 
      report: {
        ...duplicatedReport,
        filters: duplicatedReport.filters as any,
        featureSelection: duplicatedReport.featureSelection as any,
      }
    }, { status: 201 });
  } catch (error) {
    logger.error('[POST /api/saved-reports/[id]/duplicate] Error:', error);
    return NextResponse.json(
      { error: 'Failed to duplicate report' },
      { status: 500 }
    );
  }
}
```

### Step 3.5: Create GET /api/saved-reports/default

**File**: `src/app/api/saved-reports/default/route.ts` (CREATE NEW FILE)

**Note**: This route does not require `getUserPermissions` import as it only fetches the user's own default report, no admin checks needed.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * GET /api/saved-reports/default
 * Get the user's default saved report (if any)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const defaultReport = await prisma.savedReport.findFirst({
      where: {
        userId: user.id,
        isDefault: true,
        isActive: true,
        dashboard: 'funnel_performance',
      },
    });

    return NextResponse.json({ 
      report: defaultReport ? {
        ...defaultReport,
        filters: defaultReport.filters as any,
        featureSelection: defaultReport.featureSelection as any,
      } : null
    });
  } catch (error) {
    logger.error('[GET /api/saved-reports/default] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch default report' },
      { status: 500 }
    );
  }
}
```

### Step 3.6: ✅ CHECKPOINT 3 - API Routes Verification

**⚠️ CRITICAL**: Do not proceed to Phase 4 until all checks pass.

**Risk Level**: 🔴 HIGH - Backend logic, permissions, data integrity

**What Could Go Wrong**:
- Authentication not working
- Permissions check failing
- Prisma queries incorrect
- JSON serialization issues
- Wrong HTTP status codes

**Verification Steps**:

**3.6.1 Start Development Server**
```bash
npm run dev
```
- [ ] Server starts without errors
- [ ] No TypeScript errors in API route files

**3.6.2 Test GET /api/saved-reports (Unauthenticated)**

Using browser, Postman, or curl:
```bash
curl http://localhost:3000/api/saved-reports
```
- [ ] Returns `401 Unauthorized` (not 500 error)

**3.6.3 Test GET /api/saved-reports (Authenticated)**

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

**3.6.4 Test POST /api/saved-reports (Create Report)**

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

**3.6.5 Test GET /api/saved-reports/[id]**

```javascript
fetch(`/api/saved-reports/${window.testReportId}`)
  .then(r => r.json())
  .then(console.log);
```

- [ ] Returns `200 OK`
- [ ] Returns the correct report

**3.6.6 Test PUT /api/saved-reports/[id] (Update)**

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

**3.6.7 Test POST /api/saved-reports/[id]/set-default**

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

**3.6.8 Test GET /api/saved-reports/default**

```javascript
fetch('/api/saved-reports/default')
  .then(r => r.json())
  .then(console.log);
```

- [ ] Returns `200 OK`
- [ ] Returns the report we just set as default

**3.6.9 Test POST /api/saved-reports/[id]/duplicate**

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

**3.6.10 Test DELETE /api/saved-reports/[id]**

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

**3.6.11 Test Admin Template (If You Have Admin Access)**

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

**3.6.12 Clean Up Test Data**

In Prisma Studio, delete the test reports created during testing.

**🚫 STOP HERE IF ANY CHECK FAILS**  
Do not proceed to Phase 4 until all API routes work correctly.

---

## Phase 4: API Client

### Step 4.1: Add Saved Reports API Client Functions

**File**: `src/lib/api-client.ts` (UPDATE EXISTING FILE)

**Action**: Add imports at the top of the file (with other type imports, around line 16-35):

```typescript
import {
  SavedReport,
  SavedReportInput,
} from '@/types/saved-reports';
```

**Action**: Add the following functions to the `dashboardApi` object (after the existing functions, before the closing brace around line 300):

```typescript
  // Saved Reports API functions
  getSavedReports: () =>
    apiFetch<{ userReports: SavedReport[]; adminTemplates: SavedReport[] }>('/api/saved-reports'),

  getSavedReport: (id: string) =>
    apiFetch<{ report: SavedReport }>(`/api/saved-reports/${encodeURIComponent(id)}`)
      .then(data => data.report),

  createSavedReport: (input: SavedReportInput) =>
    apiFetch<{ report: SavedReport }>('/api/saved-reports', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then(data => data.report),

  updateSavedReport: (id: string, input: Partial<SavedReportInput>) =>
    apiFetch<{ report: SavedReport }>(`/api/saved-reports/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }).then(data => data.report),

  deleteSavedReport: (id: string) =>
    apiFetch<{ success: boolean }>(`/api/saved-reports/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  setDefaultReport: (id: string) =>
    apiFetch<{ report: SavedReport }>(`/api/saved-reports/${encodeURIComponent(id)}/set-default`, {
      method: 'POST',
    }).then(data => data.report),

  duplicateSavedReport: (id: string, newName?: string) =>
    apiFetch<{ report: SavedReport }>(`/api/saved-reports/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ name: newName }),
    }).then(data => data.report),

  getDefaultReport: () =>
    apiFetch<{ report: SavedReport | null }>('/api/saved-reports/default')
      .then(data => data.report),
```

**Note**: The `apiFetch` function is already defined in this file and handles error handling and URL construction automatically.

**Important**: Prisma automatically serializes JSON fields when returning from database. The type casting (`as any`) in API responses is for TypeScript type safety - Prisma's `Json` type maps to `JsonValue` which TypeScript handles correctly, but explicit casting ensures compatibility with our TypeScript interfaces.

---

## Phase 5: UI Components ✅ COMPLETE

### Step 5.1: Create SaveReportModal Component ✅

**File**: `src/components/dashboard/SaveReportModal.tsx` (CREATED)

**Key Features Implemented**:
- Granular feature selection with individual checkboxes for each scorecard metric
- Individual conversion rate card selection
- Separate "Open Pipeline" section
- Uses `getEffectiveFeatureSelection` for backward compatibility
- Admin template option (for admins only)
- Default report option (for user reports only)

```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { X, Save, Star } from 'lucide-react';
import { Button } from '@tremor/react';
import { DashboardFilters } from '@/types/filters';
import { ViewMode } from '@/types/dashboard';
import {
  FeatureSelection,
  DEFAULT_FEATURE_SELECTION,
  SavedReport,
  getEffectiveFeatureSelection,
} from '@/types/saved-reports';

interface SaveReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    name: string,
    description: string,
    filters: DashboardFilters,
    featureSelection: FeatureSelection,
    viewMode: ViewMode,
    isDefault: boolean,
    isAdminTemplate: boolean
  ) => Promise<void>;
  currentFilters: DashboardFilters;
  currentViewMode: ViewMode;
  currentFeatureSelection: FeatureSelection;
  editingReport?: SavedReport | null;
  isAdmin?: boolean;
  isSaving?: boolean;
}

export function SaveReportModal({
  isOpen,
  onClose,
  onSave,
  currentFilters,
  currentViewMode,
  currentFeatureSelection,
  editingReport,
  isAdmin = false,
  isSaving = false,
}: SaveReportModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [featureSelection, setFeatureSelection] = useState<FeatureSelection>(
    DEFAULT_FEATURE_SELECTION
  );
  const [isDefault, setIsDefault] = useState(false);
  const [isAdminTemplate, setIsAdminTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens or editingReport changes
  useEffect(() => {
    if (isOpen) {
      if (editingReport) {
        setName(editingReport.name);
        setDescription(editingReport.description || '');
        // Use getEffectiveFeatureSelection to handle backward compatibility
        setFeatureSelection(
          getEffectiveFeatureSelection(editingReport.featureSelection)
        );
        setIsDefault(editingReport.isDefault);
        setIsAdminTemplate(editingReport.reportType === 'admin_template');
      } else {
        setName('');
        setDescription('');
        setFeatureSelection(getEffectiveFeatureSelection(currentFeatureSelection));
        setIsDefault(false);
        setIsAdminTemplate(false);
      }
      setError(null);
    }
  }, [isOpen, editingReport, currentFeatureSelection]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter a report name');
      return;
    }

    if (name.length > 255) {
      setError('Name must be 255 characters or less');
      return;
    }

    try {
      await onSave(
        name.trim(),
        description.trim(),
        currentFilters,
        featureSelection,
        currentViewMode,
        isDefault,
        isAdminTemplate
      );
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save report');
    }
  };

  const toggleFeature = (
    category: keyof FeatureSelection,
    feature?: string
  ) => {
    setFeatureSelection((prev) => {
      if (feature && typeof prev[category] === 'object') {
        return {
          ...prev,
          [category]: {
            ...(prev[category] as Record<string, boolean>),
            [feature]: !(prev[category] as Record<string, boolean>)[feature],
          },
        };
      } else {
        return {
          ...prev,
          [category]: !prev[category],
        };
      }
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {editingReport ? 'Edit Saved Report' : 'Save Report'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Report Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Report Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Q1 Paid Search Performance"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              maxLength={255}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this report show?"
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              maxLength={500}
            />
          </div>

          {/* Feature Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
              Visible Features
            </label>
            <div className="space-y-3 text-sm">
              {/* Scorecards - Individual checkboxes for each metric */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Scorecards
                </p>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.prospects}
                      onChange={() => toggleFeature('scorecards', 'prospects')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">Prospects</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.contacted}
                      onChange={() => toggleFeature('scorecards', 'contacted')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">Contacted</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.mqls}
                      onChange={() => toggleFeature('scorecards', 'mqls')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">MQLs</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.sqls}
                      onChange={() => toggleFeature('scorecards', 'sqls')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">SQLs</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.sqos}
                      onChange={() => toggleFeature('scorecards', 'sqos')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">SQOs</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.signed}
                      onChange={() => toggleFeature('scorecards', 'signed')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">Signed</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.scorecards.joined}
                      onChange={() => toggleFeature('scorecards', 'joined')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">Joined</span>
                  </label>
                </div>
              </div>

              {/* Open Pipeline - Separate section */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={featureSelection.scorecards.openPipeline}
                    onChange={() => toggleFeature('scorecards', 'openPipeline')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    Open Pipeline
                  </span>
                </label>
              </div>

              {/* Conversion Rates - Individual checkboxes for each rate */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Conversion Rate Cards
                </p>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.conversionRates.contactedToMql}
                      onChange={() => toggleFeature('conversionRates', 'contactedToMql')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">Contacted → MQL</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.conversionRates.mqlToSql}
                      onChange={() => toggleFeature('conversionRates', 'mqlToSql')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">MQL → SQL</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.conversionRates.sqlToSqo}
                      onChange={() => toggleFeature('conversionRates', 'sqlToSqo')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">SQL → SQO</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={featureSelection.conversionRates.sqoToJoined}
                      onChange={() => toggleFeature('conversionRates', 'sqoToJoined')}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    <span className="text-gray-600 dark:text-gray-400">SQO → Joined</span>
                  </label>
                </div>
              </div>

              {/* Charts */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Charts
                </p>
                <label className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={featureSelection.charts.conversionTrends}
                    onChange={() => toggleFeature('charts', 'conversionTrends')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-600 dark:text-gray-400">
                    Conversion Trends
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={featureSelection.charts.volumeTrends}
                    onChange={() => toggleFeature('charts', 'volumeTrends')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-600 dark:text-gray-400">
                    Volume Trends
                  </span>
                </label>
              </div>

              {/* Tables */}
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Tables
                </p>
                <label className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={featureSelection.tables.channelPerformance}
                    onChange={() => toggleFeature('tables', 'channelPerformance')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-600 dark:text-gray-400">
                    Channel Performance
                  </span>
                </label>
                <label className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={featureSelection.tables.sourcePerformance}
                    onChange={() => toggleFeature('tables', 'sourcePerformance')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-600 dark:text-gray-400">
                    Source Performance
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={featureSelection.tables.detailRecords}
                    onChange={() => toggleFeature('tables', 'detailRecords')}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-600 dark:text-gray-400">
                    Detail Records
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-2">
            {/* Set as Default */}
            {!isAdminTemplate && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                <Star className="w-4 h-4 text-amber-500" />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Set as my default report
                </span>
              </label>
            )}

            {/* Admin Template (only for admins) */}
            {isAdmin && !editingReport && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isAdminTemplate}
                  onChange={(e) => {
                    setIsAdminTemplate(e.target.checked);
                    if (e.target.checked) setIsDefault(false);
                  }}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Save as template (visible to all users)
                </span>
              </label>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            icon={Save}
            onClick={handleSave}
            loading={isSaving}
            disabled={isSaving || !name.trim()}
          >
            {editingReport ? 'Update Report' : 'Save Report'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

### Step 5.2: Create SavedReportsDropdown Component

**File**: `src/components/dashboard/SavedReportsDropdown.tsx` (CREATE NEW FILE)

```typescript
'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Star,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  FileText,
  Users,
} from 'lucide-react';
import { SavedReport } from '@/types/saved-reports';

interface SavedReportsDropdownProps {
  userReports: SavedReport[];
  adminTemplates: SavedReport[];
  activeReportId: string | null;
  onSelectReport: (report: SavedReport) => void;
  onEditReport: (report: SavedReport) => void;
  onDuplicateReport: (report: SavedReport) => void;
  onDeleteReport: (report: SavedReport) => void;
  onSetDefault: (report: SavedReport) => void;
  isLoading?: boolean;
}

export function SavedReportsDropdown({
  userReports,
  adminTemplates,
  activeReportId,
  onSelectReport,
  onEditReport,
  onDuplicateReport,
  onDeleteReport,
  onSetDefault,
  isLoading = false,
}: SavedReportsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setMenuOpenFor(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeReport =
    userReports.find((r) => r.id === activeReportId) ||
    adminTemplates.find((r) => r.id === activeReportId);

  const hasReports = userReports.length > 0 || adminTemplates.length > 0;

  const handleReportClick = (report: SavedReport) => {
    onSelectReport(report);
    setIsOpen(false);
    setMenuOpenFor(null);
  };

  const handleMenuClick = (e: React.MouseEvent, reportId: string) => {
    e.stopPropagation();
    setMenuOpenFor(menuOpenFor === reportId ? null : reportId);
  };

  const handleAction = (
    e: React.MouseEvent,
    action: () => void
  ) => {
    e.stopPropagation();
    action();
    setMenuOpenFor(null);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors min-w-[200px] justify-between"
      >
        <div className="flex items-center gap-2 truncate">
          <FileText className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
          <span className="truncate text-sm">
            {activeReport ? activeReport.name : 'Saved Reports'}
          </span>
          {activeReport?.isDefault && (
            <Star className="w-3 h-3 text-amber-500 flex-shrink-0" />
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform flex-shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
          {!hasReports ? (
            <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No saved reports yet.
              <br />
              Save your current filters to create one.
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {/* User Reports */}
              {userReports.length > 0 && (
                <div>
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    My Reports
                  </div>
                  {userReports.map((report) => (
                    <ReportItem
                      key={report.id}
                      report={report}
                      isActive={report.id === activeReportId}
                      menuOpen={menuOpenFor === report.id}
                      onSelect={() => handleReportClick(report)}
                      onMenuClick={(e) => handleMenuClick(e, report.id)}
                      onEdit={(e) => handleAction(e, () => onEditReport(report))}
                      onDuplicate={(e) =>
                        handleAction(e, () => onDuplicateReport(report))
                      }
                      onDelete={(e) =>
                        handleAction(e, () => onDeleteReport(report))
                      }
                      onSetDefault={(e) =>
                        handleAction(e, () => onSetDefault(report))
                      }
                      canEdit={true}
                      canDelete={true}
                      canSetDefault={true}
                    />
                  ))}
                </div>
              )}

              {/* Admin Templates */}
              {adminTemplates.length > 0 && (
                <div>
                  <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    Templates
                  </div>
                  {adminTemplates.map((report) => (
                    <ReportItem
                      key={report.id}
                      report={report}
                      isActive={report.id === activeReportId}
                      menuOpen={menuOpenFor === report.id}
                      onSelect={() => handleReportClick(report)}
                      onMenuClick={(e) => handleMenuClick(e, report.id)}
                      onEdit={() => {}}
                      onDuplicate={(e) =>
                        handleAction(e, () => onDuplicateReport(report))
                      }
                      onDelete={() => {}}
                      onSetDefault={() => {}}
                      canEdit={false}
                      canDelete={false}
                      canSetDefault={false}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ReportItemProps {
  report: SavedReport;
  isActive: boolean;
  menuOpen: boolean;
  onSelect: () => void;
  onMenuClick: (e: React.MouseEvent) => void;
  onEdit: (e: React.MouseEvent) => void;
  onDuplicate: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onSetDefault: (e: React.MouseEvent) => void;
  canEdit: boolean;
  canDelete: boolean;
  canSetDefault: boolean;
}

function ReportItem({
  report,
  isActive,
  menuOpen,
  onSelect,
  onMenuClick,
  onEdit,
  onDuplicate,
  onDelete,
  onSetDefault,
  canEdit,
  canDelete,
  canSetDefault,
}: ReportItemProps) {
  return (
    <div
      className={`relative flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 ${
        isActive ? 'bg-blue-50 dark:bg-blue-900/20' : ''
      }`}
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0 pr-2">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm truncate ${
              isActive
                ? 'text-blue-700 dark:text-blue-300 font-medium'
                : 'text-gray-900 dark:text-white'
            }`}
          >
            {report.name}
          </span>
          {report.isDefault && (
            <Star className="w-3 h-3 text-amber-500 flex-shrink-0" />
          )}
        </div>
        {report.description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {report.description}
          </p>
        )}
      </div>

      {/* Actions Menu */}
      <div className="relative">
        <button
          onClick={onMenuClick}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          <MoreHorizontal className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10 overflow-hidden">
            {canEdit && (
              <button
                onClick={onEdit}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>
            )}
            <button
              onClick={onDuplicate}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <Copy className="w-4 h-4" />
              Duplicate
            </button>
            {canSetDefault && !report.isDefault && (
              <button
                onClick={onSetDefault}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Star className="w-4 h-4" />
                Set as Default
              </button>
            )}
            {canDelete && (
              <button
                onClick={onDelete}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 5.3: Create DeleteConfirmModal Component

**File**: `src/components/dashboard/DeleteConfirmModal.tsx` (CREATE NEW FILE)

```typescript
'use client';

import React from 'react';
import { X, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@tremor/react';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  reportName: string;
  isDeleting?: boolean;
}

export function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  reportName,
  isDeleting = false,
}: DeleteConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="w-5 h-5" />
            <h2 className="text-lg font-semibold">Delete Report</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          <p className="text-gray-700 dark:text-gray-300">
            Are you sure you want to delete{' '}
            <span className="font-medium">"{reportName}"</span>?
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            This action cannot be undone.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="secondary" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            icon={Trash2}
            color="red"
            onClick={onConfirm}
            loading={isDeleting}
            disabled={isDeleting}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
```

### Step 5.4: ✅ CHECKPOINT 5 - UI Components Verification

**⚠️ CRITICAL**: Do not proceed to Phase 6 until all checks pass.

**Risk Level**: 🟡 MEDIUM - Isolated components

**What Could Go Wrong**:
- Components don't render
- Missing imports
- Props interface mismatch
- Styling broken

**Verification Steps**:

**5.4.1 TypeScript Compilation**
```bash
npx tsc --noEmit
```
- [ ] No errors in component files

**5.4.2 Component Verification** ✅

**Note**: Test page was created and verified, then removed as per implementation workflow.

**Verification completed**:

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

- [x] TypeScript compilation passes
- [x] All components render correctly
- [x] Granular feature selection implemented
- [x] Individual scorecard and conversion rate checkboxes working
- [x] Open Pipeline as separate section
- [x] Backward compatibility via `getEffectiveFeatureSelection`

**🚫 STOP HERE IF ANY CHECK FAILS**

---

## Phase 6: Dashboard Integration

### Step 6.1: Update GlobalFilters Component

**File**: `src/components/dashboard/GlobalFilters.tsx`

**Action**: Add imports at the top of the file:

```typescript
import { Save } from 'lucide-react';
import { Button } from '@tremor/react';
import { SavedReportsDropdown } from './SavedReportsDropdown';
import { SavedReport } from '@/types/saved-reports';
```

**Action**: Update the props interface:

```typescript
interface GlobalFiltersProps {
  filters: DashboardFilters;
  filterOptions: FilterOptions;
  onFiltersChange: (filters: DashboardFilters) => void;
  onReset: () => void;
  // Add these new props:
  savedReports: {
    userReports: SavedReport[];
    adminTemplates: SavedReport[];
  };
  activeReportId: string | null;
  onSelectReport: (report: SavedReport) => void;
  onEditReport: (report: SavedReport) => void;
  onDuplicateReport: (report: SavedReport) => void;
  onDeleteReport: (report: SavedReport) => void;
  onSetDefault: (report: SavedReport) => void;
  onSaveReport: () => void;
  isLoadingReports?: boolean;
}
```

**Action**: Add the Saved Reports UI in the header section (find the existing header div with "Filters" title):

```tsx
{/* Replace the existing header section */}
<div className="flex items-center justify-between mb-4">
  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Filters</h3>
  
  <div className="flex items-center gap-3">
    {/* Saved Reports Dropdown */}
    <SavedReportsDropdown
      userReports={savedReports.userReports}
      adminTemplates={savedReports.adminTemplates}
      activeReportId={activeReportId}
      onSelectReport={onSelectReport}
      onEditReport={onEditReport}
      onDuplicateReport={onDuplicateReport}
      onDeleteReport={onDeleteReport}
      onSetDefault={onSetDefault}
      isLoading={isLoadingReports}
    />
    
    {/* Save Report Button */}
    <Button
      icon={Save}
      size="sm"
      variant="secondary"
      onClick={onSaveReport}
      className="text-gray-700 dark:text-gray-200"
    >
      Save
    </Button>
    
    {/* Existing Reset Button */}
    <Button
      icon={RefreshCw}
      size="sm"
      variant="light"
      onClick={onReset}
      className="text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white"
    >
      Reset
    </Button>
  </div>
</div>
```

### Step 6.2: Update Dashboard Page

**File**: `src/app/dashboard/page.tsx`

This is the main integration step. Below are the specific changes needed:

**Action 1**: Add imports at the top:

```typescript
import { useSession } from 'next-auth/react';
import { SaveReportModal } from '@/components/dashboard/SaveReportModal';
import { DeleteConfirmModal } from '@/components/dashboard/DeleteConfirmModal';
import {
  SavedReport,
  FeatureSelection,
  DEFAULT_FEATURE_SELECTION,
  getEffectiveFeatureSelection,
} from '@/types/saved-reports';
import { dashboardApi } from '@/lib/api-client';
import { getSessionPermissions } from '@/types/auth';
```

**Action 2**: Add state variables (inside the component, near other useState calls):

```typescript
// Saved Reports State
const [savedReports, setSavedReports] = useState<{
  userReports: SavedReport[];
  adminTemplates: SavedReport[];
}>({ userReports: [], adminTemplates: [] });
const [activeReportId, setActiveReportId] = useState<string | null>(null);
const [featureSelection, setFeatureSelection] = useState<FeatureSelection>(
  DEFAULT_FEATURE_SELECTION
);
const [isLoadingReports, setIsLoadingReports] = useState(false);

// Modal State
const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
const [editingReport, setEditingReport] = useState<SavedReport | null>(null);
const [deletingReport, setDeletingReport] = useState<SavedReport | null>(null);
const [isSaving, setIsSaving] = useState(false);
const [isDeleting, setIsDeleting] = useState(false);

// Get session for admin check
const { data: session } = useSession();
const permissions = getSessionPermissions(session);
const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager';
```

**Action 3**: Add functions to fetch and manage saved reports:

```typescript
// Fetch saved reports
const fetchSavedReports = useCallback(async () => {
  try {
    setIsLoadingReports(true);
    const data = await dashboardApi.getSavedReports();
    setSavedReports(data);
  } catch (error) {
    console.error('Failed to fetch saved reports:', error);
  } finally {
    setIsLoadingReports(false);
  }
}, []);

// Apply a report (filters + feature selection + view mode)
// IMPORTANT: Saved report viewMode overrides current view mode
const applyReport = useCallback((report: SavedReport) => {
  setActiveReportId(report.id);
  setFilters(report.filters as DashboardFilters);
  setFeatureSelection(getEffectiveFeatureSelection(report.featureSelection));
  // Override view mode with saved report's view mode (if specified)
  if (report.viewMode) {
    setViewMode(report.viewMode as ViewMode);
  }
}, []);

// Load default report on mount
const loadDefaultReport = useCallback(async () => {
  try {
    const defaultReport = await dashboardApi.getDefaultReport();
    if (defaultReport) {
      applyReport(defaultReport);
    }
  } catch (error) {
    console.error('Failed to load default report:', error);
  }
}, [applyReport]);

// Handle selecting a report
const handleSelectReport = useCallback((report: SavedReport) => {
  applyReport(report);
}, [applyReport]);

// Handle saving a report
const handleSaveReport = useCallback(
  async (
    name: string,
    description: string,
    filters: DashboardFilters,
    featureSelection: FeatureSelection,
    viewMode: ViewMode,
    isDefault: boolean,
    isAdminTemplate: boolean
  ) => {
    setIsSaving(true);
    try {
      if (editingReport) {
        await dashboardApi.updateSavedReport(editingReport.id, {
          name,
          description,
          filters,
          featureSelection,
          viewMode,
          isDefault,
        });
      } else {
        await dashboardApi.createSavedReport({
          name,
          description,
          filters,
          featureSelection,
          viewMode,
          isDefault,
          reportType: isAdminTemplate ? 'admin_template' : 'user',
        });
      }
      await fetchSavedReports();
      setEditingReport(null);
    } finally {
      setIsSaving(false);
    }
  },
  [editingReport, fetchSavedReports]
);

// Handle editing a report
const handleEditReport = useCallback((report: SavedReport) => {
  setEditingReport(report);
  setIsSaveModalOpen(true);
}, []);

// Handle duplicating a report
const handleDuplicateReport = useCallback(
  async (report: SavedReport) => {
    try {
      await dashboardApi.duplicateSavedReport(report.id);
      await fetchSavedReports();
    } catch (error) {
      console.error('Failed to duplicate report:', error);
    }
  },
  [fetchSavedReports]
);

// Handle deleting a report
const handleDeleteReport = useCallback((report: SavedReport) => {
  setDeletingReport(report);
  setIsDeleteModalOpen(true);
}, []);

const confirmDeleteReport = useCallback(async () => {
  if (!deletingReport) return;
  
  setIsDeleting(true);
  try {
    await dashboardApi.deleteSavedReport(deletingReport.id);
    await fetchSavedReports();
    if (activeReportId === deletingReport.id) {
      setActiveReportId(null);
    }
    setIsDeleteModalOpen(false);
    setDeletingReport(null);
  } catch (error) {
    console.error('Failed to delete report:', error);
  } finally {
    setIsDeleting(false);
  }
}, [deletingReport, activeReportId, fetchSavedReports]);

// Handle setting default
const handleSetDefault = useCallback(
  async (report: SavedReport) => {
    try {
      await dashboardApi.setDefaultReport(report.id);
      await fetchSavedReports();
    } catch (error) {
      console.error('Failed to set default report:', error);
    }
  },
  [fetchSavedReports]
);

// Open save modal for new report
const handleOpenSaveModal = useCallback(() => {
  setEditingReport(null);
  setIsSaveModalOpen(true);
}, []);
```

**Action 4**: Add useEffect to load reports on mount:

```typescript
// Fetch saved reports and load default on mount
useEffect(() => {
  fetchSavedReports();
  loadDefaultReport();
}, [fetchSavedReports, loadDefaultReport]);
```

**Action 5**: Update the fetchDashboardData function to use featureSelection for conditional fetching:

Find the existing `fetchDashboardData` function and modify it to conditionally fetch based on `featureSelection`. Here's the key changes:

```typescript
const fetchDashboardData = useCallback(async () => {
  if (!filterOptions) return;
  
  setLoading(true);
  
  try {
    const dateRange = buildDateRangeFromFilters(filters);
    const currentFilters: DashboardFilters = {
      ...filters,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      metricFilter: 'prospect' as DashboardFilters['metricFilter'],
    };
    
    const promises: Promise<any>[] = [];
    
    // Conditional fetch: Only fetch metrics if any scorecard is visible
    // OR if tables need metrics data
    const needsMetrics = 
      // Full Funnel scorecards (only in fullFunnel view)
      (viewMode === 'fullFunnel' && (
        featureSelection.scorecards.prospects ||
        featureSelection.scorecards.contacted ||
        featureSelection.scorecards.mqls
      )) ||
      // Volume scorecards (available in both views)
      featureSelection.scorecards.sqls ||
      featureSelection.scorecards.sqos ||
      featureSelection.scorecards.signed ||
      featureSelection.scorecards.joined ||
      featureSelection.scorecards.openPipeline ||
      // Tables need metrics for calculations
      featureSelection.tables.channelPerformance ||
      featureSelection.tables.sourcePerformance;
    
    if (needsMetrics) {
      promises.push(
        dashboardApi.getFunnelMetrics(currentFilters, viewMode)
          .then(setMetrics)
      );
    }
    
    // Conditional fetch: Only fetch conversion rates if any rate card is visible
    // OR if charts need trends data
    const needsConversionRates = 
      featureSelection.conversionRates.contactedToMql ||
      featureSelection.conversionRates.mqlToSql ||
      featureSelection.conversionRates.sqlToSqo ||
      featureSelection.conversionRates.sqoToJoined ||
      featureSelection.charts.conversionTrends ||
      featureSelection.charts.volumeTrends;
    
    if (needsConversionRates) {
      promises.push(
        dashboardApi.getConversionRates(currentFilters, { 
          includeTrends: true, 
          granularity: trendGranularity, 
          mode: trendMode 
        })
          .then(data => {
            setConversionRates(data.rates);
            setTrends(data.trends || []);
          })
      );
    }
    
    // Conditional fetch: Channel performance
    if (featureSelection.tables.channelPerformance) {
      promises.push(
        dashboardApi.getChannelPerformance(currentFilters, viewMode)
          .then(data => setChannels(data.channels))
      );
    }
    
    // Conditional fetch: Source performance
    if (featureSelection.tables.sourcePerformance) {
      promises.push(
        dashboardApi.getSourcePerformance(currentFilters, viewMode)
          .then(data => setSources(data.sources))
      );
    }
    
    // Conditional fetch: Detail records
    if (featureSelection.tables.detailRecords) {
      promises.push(
        dashboardApi.getDetailRecords(currentFilters, 50000)
          .then(data => setDetailRecords(data.records))
      );
    }
    
    await Promise.all(promises);
  } catch (error) {
    console.error('Failed to fetch dashboard data:', error);
    const errorMessage = handleApiError(error);
  } finally {
    setLoading(false);
  }
}, [filters, trendGranularity, trendMode, filterOptions, viewMode, featureSelection]);
```

**Action 6**: Update the useEffect dependency to include featureSelection:

```typescript
useEffect(() => {
  if (filterOptions) {
    fetchDashboardData();
  }
}, [fetchDashboardData, filterOptions]);
```

**Action 7**: Update GlobalFilters component usage (find existing GlobalFilters in JSX):

```tsx
<GlobalFilters
  filters={filters}
  filterOptions={filterOptions}
  onFiltersChange={(newFilters) => {
    setFilters(newFilters);
    setActiveReportId(null); // Clear active report when manually changing filters
  }}
  onReset={() => {
    setFilters(DEFAULT_FILTERS);
    setActiveReportId(null);
    setFeatureSelection(DEFAULT_FEATURE_SELECTION);
  }}
  savedReports={savedReports}
  activeReportId={activeReportId}
  onSelectReport={handleSelectReport}
  onEditReport={handleEditReport}
  onDuplicateReport={handleDuplicateReport}
  onDeleteReport={handleDeleteReport}
  onSetDefault={handleSetDefault}
  onSaveReport={handleOpenSaveModal}
  isLoadingReports={isLoadingReports}
/>
```

**Action 8**: Update scorecard components to support individual metric visibility, then add conditional rendering.

**Step 8a**: Update `FullFunnelScorecards` component to accept `visibleMetrics` prop:

**File**: `src/components/dashboard/FullFunnelScorecards.tsx`

Add to props interface:
```typescript
interface FullFunnelScorecardsProps {
  metrics: FunnelMetricsWithGoals | null;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
  loading?: boolean;
  visibleMetrics?: {
    prospects: boolean;
    contacted: boolean;
    mqls: boolean;
  };
}
```

Update component to conditionally render individual cards:
```typescript
export function FullFunnelScorecards({
  metrics,
  selectedMetric,
  onMetricClick,
  loading = false,
  visibleMetrics = { prospects: true, contacted: true, mqls: true },
}: FullFunnelScorecardsProps) {
  if (!metrics) return null;
  
  const goals = metrics.goals;
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      {/* Prospects Card - conditional */}
      {visibleMetrics.prospects && (
        <Card className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' : ''
        }`}
        onClick={() => onMetricClick?.('prospect')}>
          {/* ... existing Prospects card JSX ... */}
        </Card>
      )}
      
      {/* Contacted Card - conditional */}
      {visibleMetrics.contacted && (
        <Card className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' : ''
        }`}
        onClick={() => onMetricClick?.('contacted')}>
          {/* ... existing Contacted card JSX ... */}
        </Card>
      )}
      
      {/* MQLs Card - conditional */}
      {visibleMetrics.mqls && (
        <Card className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' : ''
        }`}
        onClick={() => onMetricClick?.('mql')}>
          {/* ... existing MQLs card JSX ... */}
        </Card>
      )}
    </div>
  );
}
```

**Step 8b**: Update `Scorecards` component similarly for volume metrics.

**Step 8c**: Update `ConversionRateCards` component to accept `visibleRates` prop.

**Step 8d**: Add conditional rendering in dashboard page:

```tsx
{/* Full Funnel Scorecards - conditional on viewMode AND any full funnel scorecard visible */}
{viewMode === 'fullFunnel' && metrics && (
  (featureSelection.scorecards.prospects ||
   featureSelection.scorecards.contacted ||
   featureSelection.scorecards.mqls) && (
    <CardErrorBoundary>
      <FullFunnelScorecards
        metrics={metrics}
        selectedMetric={selectedMetric}
        onMetricClick={handleMetricClick}
        loading={loading}
        visibleMetrics={{
          prospects: featureSelection.scorecards.prospects,
          contacted: featureSelection.scorecards.contacted,
          mqls: featureSelection.scorecards.mqls,
        }}
      />
    </CardErrorBoundary>
  )
)}

{/* Volume Scorecards - conditional on any volume scorecard visible */}
{metrics && (
  (featureSelection.scorecards.sqls ||
   featureSelection.scorecards.sqos ||
   featureSelection.scorecards.signed ||
   featureSelection.scorecards.joined ||
   featureSelection.scorecards.openPipeline) && (
    <CardErrorBoundary>
      <Scorecards
        metrics={metrics}
        selectedMetric={selectedMetric}
        onMetricClick={handleMetricClick}
        visibleMetrics={{
          sqls: featureSelection.scorecards.sqls,
          sqos: featureSelection.scorecards.sqos,
          signed: featureSelection.scorecards.signed,
          joined: featureSelection.scorecards.joined,
          openPipeline: featureSelection.scorecards.openPipeline,
        }}
      />
    </CardErrorBoundary>
  )
)}

{/* Conversion Rate Cards - conditional on any rate card visible */}
{conversionRates && (
  (featureSelection.conversionRates.contactedToMql ||
   featureSelection.conversionRates.mqlToSql ||
   featureSelection.conversionRates.sqlToSqo ||
   featureSelection.conversionRates.sqoToJoined) && (
    <CardErrorBoundary>
      <ConversionRateCards
        conversionRates={conversionRates}
        isLoading={loading}
        visibleRates={{
          contactedToMql: featureSelection.conversionRates.contactedToMql,
          mqlToSql: featureSelection.conversionRates.mqlToSql,
          sqlToSqo: featureSelection.conversionRates.sqlToSqo,
          sqoToJoined: featureSelection.conversionRates.sqoToJoined,
        }}
      />
    </CardErrorBoundary>
  )
)}

{/* Conversion Trends Chart - conditional on featureSelection */}
{featureSelection.charts.conversionTrends && (
  <ChartErrorBoundary>
    <ConversionTrendChart
      trends={trends}
      onGranularityChange={setTrendGranularity}
      granularity={trendGranularity}
      mode={trendMode}
      onModeChange={(newMode) => {
        setTrendMode(newMode);
        // Trigger refetch when mode changes
        fetchDashboardData();
      }}
      isLoading={loading}
    />
  </ChartErrorBoundary>
)}

{/* Volume Trends Chart - conditional on featureSelection */}
{featureSelection.charts.volumeTrends && (
  <ChartErrorBoundary>
    <VolumeTrendChart
      trends={trends}
      onGranularityChange={setTrendGranularity}
      granularity={trendGranularity}
      onBarClick={handleVolumeBarClick}
      isLoading={loading}
    />
  </ChartErrorBoundary>
)}

{/* Channel Performance Table - conditional on featureSelection */}
{featureSelection.tables.channelPerformance && (
  <TableErrorBoundary>
    <ChannelPerformanceTable
      channels={channels}
      selectedChannel={selectedChannel}
      onChannelClick={handleChannelClick}
      viewMode={viewMode}
    />
  </TableErrorBoundary>
)}

{/* Source Performance Table - conditional on featureSelection */}
{featureSelection.tables.sourcePerformance && (
  <TableErrorBoundary>
    <SourcePerformanceTable
      sources={sources}
      selectedSource={selectedSource}
      onSourceClick={handleSourceClick}
      channelFilter={selectedChannel}
      viewMode={viewMode}
    />
  </TableErrorBoundary>
)}

{/* Detail Records Table - conditional on featureSelection */}
{featureSelection.tables.detailRecords && (
  <TableErrorBoundary>
    <DetailRecordsTable
      records={filteredDetailRecords}
      title="Record Details"
      filterDescription={getDetailDescription()}
      canExport={permissions?.canExport ?? false}
      viewMode={viewMode}
      advancedFilters={filters.advancedFilters}
      metricFilter="prospect"
      onRecordClick={handleRecordClick}
      stageFilter={stageFilter}
      onStageFilterChange={setStageFilter}
      availableOpportunityStages={availableOpportunityStages}
    />
  </TableErrorBoundary>
)}
```

**Action 9**: Add modals at the end of the component (before closing div):

```tsx
{/* Save Report Modal */}
<SaveReportModal
  isOpen={isSaveModalOpen}
  onClose={() => {
    setIsSaveModalOpen(false);
    setEditingReport(null);
  }}
  onSave={handleSaveReport}
  currentFilters={filters}
  currentViewMode={viewMode}
  currentFeatureSelection={featureSelection}
  editingReport={editingReport}
  isAdmin={isAdmin}
  isSaving={isSaving}
/>

{/* Delete Confirm Modal */}
<DeleteConfirmModal
  isOpen={isDeleteModalOpen}
  onClose={() => {
    setIsDeleteModalOpen(false);
    setDeletingReport(null);
  }}
  onConfirm={confirmDeleteReport}
  reportName={deletingReport?.name || ''}
  isDeleting={isDeleting}
/>
```

### Step 6.3: ✅ CHECKPOINT 6 - Dashboard Integration Verification

**⚠️ CRITICAL**: Do not proceed to Phase 7 until all checks pass.

**Risk Level**: 🔴 HIGH - Complex state management, many moving parts

**What Could Go Wrong**:
- State management bugs
- Infinite re-render loops
- Conditional rendering broken
- Data not fetching correctly
- Feature selection not working

**Verification Steps**:

**6.3.1 Page Loads Without Errors**
```bash
npm run dev
```
Navigate to `/dashboard`

- [ ] Page loads without blank screen
- [ ] No errors in browser console
- [ ] No errors in terminal

**6.3.2 Saved Reports UI Appears**

- [ ] "Saved Reports" dropdown appears in GlobalFilters
- [ ] "Save" button appears next to dropdown
- [ ] Dropdown shows "No saved reports yet" if empty

**6.3.3 Create First Report**

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

**6.3.4 Apply Saved Report**

1. Change filters to something different
2. Select "Test Report 1" from dropdown

- [ ] Filters change to saved values
- [ ] Dropdown shows "Test Report 1" as active
- [ ] Dashboard data reloads

**6.3.5 Feature Selection Works**

1. Click "Save" button
2. Uncheck "Volume Trends" chart
3. Uncheck "Detail Records" table
4. Save as "Limited Features Report"
5. Select this report from dropdown

- [ ] Volume Trends chart disappears
- [ ] Detail Records table disappears
- [ ] Other components still visible
- [ ] Check Network tab: fewer API calls made

**6.3.6 Manual Filter Change Clears Active Report**

1. Select "Test Report 1" from dropdown
2. Change any filter manually (e.g., date range)

- [ ] Dropdown no longer shows "Test Report 1" as selected
- [ ] Dropdown shows "Saved Reports" placeholder

**6.3.7 Edit Report**

1. Open dropdown
2. Click "..." menu on a report
3. Click "Edit"
4. Change name
5. Save

- [ ] Modal opens with pre-filled data
- [ ] Changes save correctly
- [ ] Dropdown shows updated name

**6.3.8 Duplicate Report**

1. Open dropdown
2. Click "..." menu on a report
3. Click "Duplicate"

- [ ] New report appears with "(Copy)" suffix
- [ ] Original report unchanged

**6.3.9 Delete Report**

1. Open dropdown
2. Click "..." menu on a report
3. Click "Delete"
4. Confirm deletion

- [ ] Confirmation modal appears
- [ ] Report disappears from dropdown after confirm
- [ ] If deleted report was active, dropdown resets

**6.3.10 Default Report Auto-Loads**

1. Set a report as default
2. Refresh the page (Cmd+R / Ctrl+R)

- [ ] Default report auto-applies on page load
- [ ] Filters match saved values
- [ ] Feature selection matches saved values

**6.3.11 Reset Button Works**

1. Apply a saved report
2. Click "Reset" button

- [ ] Filters reset to defaults
- [ ] All features become visible
- [ ] Active report clears

**6.3.12 Admin Template (If Admin)**

1. Click "Save" button
2. Check "Save as template (visible to all users)"
3. Save as "Company Template"

- [ ] Template appears in "Templates" section of dropdown
- [ ] Log in as non-admin user
- [ ] Template is visible and can be applied
- [ ] Non-admin cannot edit/delete template
- [ ] Non-admin can duplicate template

**🚫 STOP HERE IF ANY CHECK FAILS**

---

## Phase 7: Testing & Validation

### Step 7.1: Manual Testing Checklist

**Database:**
- [ ] Run migration successfully
- [ ] Verify SavedReport table exists in Neon
- [ ] Verify indexes are created

**API Routes:**
- [ ] GET /api/saved-reports returns empty arrays for new users
- [ ] POST /api/saved-reports creates a report
- [ ] GET /api/saved-reports/[id] returns the report
- [ ] PUT /api/saved-reports/[id] updates the report
- [ ] DELETE /api/saved-reports/[id] soft deletes
- [ ] POST /api/saved-reports/[id]/set-default sets default
- [ ] POST /api/saved-reports/[id]/duplicate creates copy
- [ ] GET /api/saved-reports/default returns default report

**UI Components:**
- [ ] Save Report button opens modal
- [ ] Modal shows all feature selection options
- [ ] Saving creates report and shows in dropdown
- [ ] Selecting report applies filters and features
- [ ] Edit button opens modal with pre-filled data
- [ ] Duplicate creates copy with "(Copy)" suffix
- [ ] Delete shows confirmation and removes report
- [ ] Set as Default marks report with star
- [ ] Default report loads on page refresh

**Feature Selection:**
- [ ] Unchecking scorecard hides scorecards
- [ ] Unchecking chart hides chart
- [ ] Unchecking table hides table
- [ ] Hidden features don't fetch data (check Network tab)

**Admin Templates:**
- [ ] Admin can create template
- [ ] Template appears in Templates section
- [ ] Non-admin can view and apply template
- [ ] Non-admin cannot edit/delete template
- [ ] Anyone can duplicate template

### Step 7.2: Edge Cases to Test

- [ ] Load page with no saved reports
- [ ] Create report with very long name (255 chars)
- [ ] Create report with special characters in name
- [ ] Apply report then manually change filters (should clear active report)
- [ ] Delete the currently active report
- [ ] Delete the default report
- [ ] User with no default report (should use DEFAULT_FILTERS)
- [ ] Report with null featureSelection (backward compatibility)

### Step 7.3: Final Verification - Full Flow Test

**Happy Path Test**:

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

**Edge Cases**:

1. [ ] Create report with very long name (255 chars)
2. [ ] Create report with special characters in name
3. [ ] Save report with all features unchecked (should still work)
4. [ ] Rapid clicking Save button (no duplicate reports)
5. [ ] Network error during save (graceful error handling)
6. [ ] Delete the currently active default report

**Performance Check**:

1. Open DevTools Network tab
2. Apply report with only 1 table visible

- [ ] Only necessary API calls are made
- [ ] Hidden features don't trigger fetches

### Step 7.4: Rollback Plan

If something goes seriously wrong:

**Database Rollback**:
```bash
npx prisma migrate reset
# WARNING: This will delete all data!
```

Or manually:
```sql
DROP TABLE IF EXISTS "SavedReport";
```

**Code Rollback**:
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

## Appendix: File Summary

### New Files to Create

| File Path | Purpose |
|-----------|---------|
| `src/types/saved-reports.ts` | Type definitions |
| `src/app/api/saved-reports/route.ts` | List & Create API |
| `src/app/api/saved-reports/[id]/route.ts` | Get, Update, Delete API |
| `src/app/api/saved-reports/[id]/set-default/route.ts` | Set Default API |
| `src/app/api/saved-reports/[id]/duplicate/route.ts` | Duplicate API |
| `src/app/api/saved-reports/default/route.ts` | Get Default API |
| `src/lib/api/saved-reports.ts` | API Client |
| `src/components/dashboard/SaveReportModal.tsx` | Save/Edit Modal |
| `src/components/dashboard/SavedReportsDropdown.tsx` | Dropdown Component |
| `src/components/dashboard/DeleteConfirmModal.tsx` | Delete Confirmation |

### Files to Modify

| File Path | Changes |
|-----------|---------|
| `prisma/schema.prisma` | Add SavedReport model, update User model |
| `src/components/dashboard/GlobalFilters.tsx` | Add Saved Reports UI |
| `src/app/dashboard/page.tsx` | Add state, handlers, conditional rendering |

---

## Implementation Order

1. **Phase 1**: Database schema (Step 1.1, 1.2)
2. **Phase 2**: Type definitions (Step 2.1, 2.2)
3. **Phase 3**: API routes (Steps 3.1-3.5)
4. **Phase 4**: API client (Step 4.1 - add to existing api-client.ts)
5. **Phase 5**: UI components (Steps 5.1-5.3)
6. **Phase 6**: Dashboard integration (Steps 6.1, 6.2)
7. **Phase 7**: Testing (Steps 7.1, 7.2)
8. **Phase 8**: Update .cursorrules (Step 8.1)

**Estimated Implementation Time**: 5-7 hours for an experienced developer (includes checkpoint verification time)

**Important Notes**:
- All corrections from codebase review have been applied
- Follow existing patterns for API routes, components, and state management
- Test with actual dashboard data after implementation
- Update .cursorrules last to document the feature for future development
- **CRITICAL**: Complete each checkpoint before proceeding to the next phase
- Checkpoints add ~2 hours of verification but save significant debugging time

**Risk Assessment Summary**:

| Phase | Risk Level | Checkpoint |
|-------|------------|------------|
| Phase 1: Database | 🔴 HIGH | ✅ Checkpoint 1 - Verify migration |
| Phase 2: Types | 🟡 MEDIUM | ✅ Checkpoint 2 - Verify compilation |
| Phase 3: API Routes | 🔴 HIGH | ✅ Checkpoint 3 - Verify all endpoints |
| Phase 4: API Client | 🟡 MEDIUM | ✅ Checkpoint 4 - Verify functions |
| Phase 5: UI Components | 🟡 MEDIUM | ✅ Checkpoint 5 - Verify isolation |
| Phase 6: Dashboard Integration | 🔴 HIGH | ✅ Checkpoint 6 - Full testing |

---

## Phase 8: Update .cursorrules for Future Development

### Step 8.1: Add Saved Reports Documentation to .cursorrules

**File**: `.cursorrules`

**Action**: Add a new section after the "SGA Drill-Down Feature Patterns" section (around line 1246):

```markdown
## Saved Reports Feature Patterns

### Overview

The Saved Reports feature allows users to save filter presets with custom feature selection (which dashboard components to show). Users can create personal reports, and admins can create template reports visible to all users.

**Key Files:**
- `src/types/saved-reports.ts` - Saved report type definitions and FeatureSelection interface
- `src/app/api/saved-reports/` - API routes for CRUD operations
- `src/components/dashboard/SaveReportModal.tsx` - Modal for creating/editing reports
- `src/components/dashboard/SavedReportsDropdown.tsx` - Dropdown for selecting reports
- `src/components/dashboard/DeleteConfirmModal.tsx` - Confirmation modal for deletion
- `src/app/dashboard/page.tsx` - Main dashboard integration with feature selection state

### Critical Patterns

#### 1. Feature Selection State Management

**⚠️ CRITICAL**: Feature selection controls which dashboard components are visible. State is managed in `src/app/dashboard/page.tsx`:

```typescript
const [featureSelection, setFeatureSelection] = useState<FeatureSelection>(
  DEFAULT_FEATURE_SELECTION
);
```

**Pattern**: When loading a saved report:
```typescript
const applyReport = useCallback((report: SavedReport) => {
  setActiveReportId(report.id);
  setFilters(report.filters as DashboardFilters);
  setFeatureSelection(getEffectiveFeatureSelection(report.featureSelection));
  if (report.viewMode) {
    setViewMode(report.viewMode as ViewMode);
  }
}, []);
```

**Why**: `getEffectiveFeatureSelection()` handles backward compatibility - reports without featureSelection show all features.

#### 2. Conditional Data Fetching Based on Feature Selection

**⚠️ CRITICAL**: Only fetch data for visible features to improve performance.

**Pattern**:
```typescript
const needsMetrics = 
  (viewMode === 'fullFunnel' && featureSelection.scorecards.fullFunnel) ||
  featureSelection.scorecards.volume ||
  featureSelection.tables.channelPerformance ||
  featureSelection.tables.sourcePerformance;

if (needsMetrics) {
  promises.push(dashboardApi.getFunnelMetrics(currentFilters, viewMode).then(setMetrics));
}
```

**Why**: Reduces unnecessary API calls and improves dashboard load time.

#### 3. Conditional Component Rendering

**Pattern**: Wrap each dashboard component with feature selection check:

```typescript
{featureSelection.scorecards.volume && metrics && (
  <CardErrorBoundary>
    <Scorecards ... />
  </CardErrorBoundary>
)}

{featureSelection.charts.conversionTrends && (
  <ChartErrorBoundary>
    <ConversionTrendChart ... />
  </ChartErrorBoundary>
)}
```

**Why**: Maintains ErrorBoundary pattern while respecting feature selection.

#### 4. Full Funnel Scorecards View Mode Constraint

**⚠️ CRITICAL**: Full Funnel scorecards only available when `viewMode === 'fullFunnel'`.

**Pattern**:
```typescript
{viewMode === 'fullFunnel' && featureSelection.scorecards.fullFunnel && metrics && (
  <CardErrorBoundary>
    <FullFunnelScorecards ... />
  </CardErrorBoundary>
)}
```

**Why**: Full Funnel scorecards require fullFunnel view mode. Feature selection alone isn't sufficient.

#### 5. Default Report Loading on Dashboard Mount

**Pattern**:
```typescript
useEffect(() => {
  fetchSavedReports();
  loadDefaultReport();
}, [fetchSavedReports, loadDefaultReport]);

const loadDefaultReport = useCallback(async () => {
  try {
    const defaultReport = await dashboardApi.getDefaultReport();
    if (defaultReport) {
      applyReport(defaultReport);
    }
  } catch (error) {
    console.error('Failed to load default report:', error);
  }
}, []);
```

**Why**: Users expect their default report to load automatically when visiting the dashboard.

#### 6. Active Report Clearing on Manual Filter Changes

**Pattern**:
```typescript
onFiltersChange={(newFilters) => {
  setFilters(newFilters);
  setActiveReportId(null); // Clear active report when manually changing filters
}}
```

**Why**: If user manually changes filters, they're no longer viewing a saved report. Clear the active report ID to reflect this.

#### 7. Admin Template Access Control

**Pattern**:
```typescript
// In API routes
const permissions = await getUserPermissions(session.user.email);
const isAdminTemplate = reportType === 'admin_template';
if (isAdminTemplate && !['admin', 'manager'].includes(permissions.role)) {
  return NextResponse.json({ error: 'Only admins can create templates' }, { status: 403 });
}
```

**Why**: Only admins/managers can create templates. Regular users can view and duplicate templates but cannot edit/delete them.

#### 8. One Default Per User Enforcement

**⚠️ CRITICAL**: Prisma doesn't support WHERE clauses in `@@unique` constraints. Must enforce in application logic.

**Pattern**:
```typescript
// When setting as default, unset any existing default FIRST
if (isDefault && !isAdminTemplate) {
  await prisma.savedReport.updateMany({
    where: {
      userId: user.id,
      isDefault: true,
      isActive: true,
      id: { not: params.id }, // Exclude current report if updating
    },
    data: { isDefault: false },
  });
}

// Then set this report as default
await prisma.savedReport.update({
  where: { id: params.id },
  data: { isDefault: true },
});
```

**Why**: Ensures only one default report per user. Must be done in application logic, not database constraint.

#### 9. Feature Selection Component Granularity

**Pattern**: Features are grouped by component, not individual cards:

```typescript
interface FeatureSelection {
  scorecards: {
    fullFunnel: boolean;  // Group: Prospects, Contacted, MQLs
    volume: boolean;      // Group: SQLs, SQOs, Signed, Joined, Open Pipeline
  };
  conversionRates: boolean;  // Group: All 4 rate cards
  charts: {
    conversionTrends: boolean;  // Individual
    volumeTrends: boolean;     // Individual
  };
  tables: {
    channelPerformance: boolean;  // Individual
    sourcePerformance: boolean;  // Individual
    detailRecords: boolean;      // Individual
  };
}
```

**Why**: Component structure groups cards together. Individual cards within a group cannot be hidden separately without code changes.

#### 10. Backward Compatibility for Feature Selection

**Pattern**: Use `getEffectiveFeatureSelection()` helper:

```typescript
export function getEffectiveFeatureSelection(
  featureSelection: FeatureSelection | null | undefined
): FeatureSelection {
  if (!featureSelection) {
    return DEFAULT_FEATURE_SELECTION; // Show all features
  }
  
  // Merge with defaults to handle missing fields
  return {
    scorecards: {
      fullFunnel: featureSelection.scorecards?.fullFunnel ?? true,
      volume: featureSelection.scorecards?.volume ?? true,
    },
    // ... etc
  };
}
```

**Why**: Old reports without featureSelection should show all features. New reports can selectively hide features.

### Common Pitfalls - Saved Reports

#### ❌ Not Clearing Active Report on Manual Filter Changes
- **WRONG**: User changes filters manually but `activeReportId` still set
- **RIGHT**: Clear `activeReportId` when filters change manually
- **WHY**: UI should reflect that user is no longer viewing a saved report

#### ❌ Fetching Data for Hidden Features
- **WRONG**: Always fetching all data regardless of feature selection
- **RIGHT**: Conditionally fetch based on `featureSelection` state
- **WHY**: Improves performance and reduces unnecessary API calls

#### ❌ Not Respecting View Mode Constraint for Full Funnel Scorecards
- **WRONG**: `featureSelection.scorecards.fullFunnel && metrics && <FullFunnelScorecards />`
- **RIGHT**: `viewMode === 'fullFunnel' && featureSelection.scorecards.fullFunnel && metrics && <FullFunnelScorecards />`
- **WHY**: Full Funnel scorecards require fullFunnel view mode

#### ❌ Using Database Constraint for One Default Per User
- **WRONG**: `@@unique([userId, isDefault], where: { isDefault: true })`
- **RIGHT**: Enforce in application logic with `updateMany` before setting default
- **WHY**: Prisma doesn't support WHERE clauses in `@@unique` constraints

#### ❌ Not Using getUserPermissions for Admin Checks
- **WRONG**: `user.role === 'admin'`
- **RIGHT**: `const permissions = await getUserPermissions(email); permissions.role === 'admin'`
- **WHY**: Permissions system centralizes role checks and includes additional context

#### ❌ Not Handling Null featureSelection in Saved Reports
- **WRONG**: `report.featureSelection` used directly
- **RIGHT**: `getEffectiveFeatureSelection(report.featureSelection)`
- **WHY**: Backward compatibility - old reports may have null featureSelection

### Saved Reports File Structure

```
src/
├── types/
│   └── saved-reports.ts (FeatureSelection, SavedReport, SavedReportInput, helper functions)
├── app/
│   └── api/
│       └── saved-reports/
│           ├── route.ts (GET list, POST create)
│           ├── [id]/route.ts (GET, PUT, DELETE)
│           ├── [id]/set-default/route.ts (POST)
│           ├── [id]/duplicate/route.ts (POST)
│           └── default/route.ts (GET)
├── components/
│   └── dashboard/
│       ├── SaveReportModal.tsx
│       ├── SavedReportsDropdown.tsx
│       └── DeleteConfirmModal.tsx
├── lib/
│   └── api-client.ts (dashboardApi.getSavedReports, etc.)
└── app/
    └── dashboard/
        └── page.tsx (feature selection state, conditional rendering, conditional fetching)
```

### Testing Saved Reports Features

**Before making changes:**
1. Verify feature selection state is properly initialized
2. Test default report loading on page refresh
3. Verify conditional data fetching (check Network tab)
4. Test admin template creation/editing permissions
5. Verify one default per user enforcement
6. Test backward compatibility with reports without featureSelection

**Common Test Cases:**
- Default report loads on dashboard visit
- Manual filter changes clear active report
- Hidden features don't fetch data
- Full Funnel scorecards only show in fullFunnel mode
- Admin templates visible to all users
- Non-admins cannot edit/delete admin templates
- One default per user enforced
- Reports without featureSelection show all features
```

**Action**: Add this section to `.cursorrules` file after the "SGA Drill-Down Feature Patterns" section (around line 1246).

**Important Notes for .cursorrules Update:**
- This section documents Saved Reports patterns for future development
- When modifying dashboard components, check if feature selection affects visibility
- When adding new dashboard features, consider if they should be toggleable in feature selection
- Always use `getEffectiveFeatureSelection()` when loading saved reports for backward compatibility

---

*End of Implementation Plan*
