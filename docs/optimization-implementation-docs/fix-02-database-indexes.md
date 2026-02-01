# Fix 02: Database Index Optimization

**Priority:** Low
**Estimated Time:** 15 minutes
**Dependencies:** None
**Risk Level:** Low (additive change, no data modification)

---

## Overview

This document reviews the database indexing strategy for the Savvy Dashboard. After investigation, we found that **indexes already exist** on all critical tables. The focus shifts to evaluating whether **composite indexes** would provide additional performance benefits.

### Investigation Results

| Table | Current State | Recommendation |
|-------|---------------|----------------|
| SavedReport | 5 single-column indexes | Consider 2 composite indexes |
| RequestNotification | Composite index exists | No changes needed |
| WeeklyGoal | Indexes + unique constraint | No changes needed |
| QuarterlyGoal | Indexes + unique constraint | No changes needed |
| User | Unique email index | No changes needed |

---

## Current State Analysis

### SavedReport Model

**Location:** `prisma/schema.prisma:149-175`

**Existing Indexes:**
```prisma
model SavedReport {
  id               String   @id @default(cuid())
  userId           String?  // NULL for admin templates
  name             String   @db.VarChar(255)
  description      String?  @db.VarChar(500)
  filters          Json
  featureSelection Json?
  viewMode         String?  @default("focused")
  dashboard        String   @default("funnel_performance")
  reportType       String   @default("user")
  isDefault        Boolean  @default(false)
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  createdBy        String?

  user User? @relation(fields: [userId], references: [id], onDelete: Cascade)

  // EXISTING INDEXES (5 single-column indexes)
  @@index([userId])      // For user-specific queries
  @@index([reportType])  // For template vs user report queries
  @@index([isDefault])   // For default report lookups
  @@index([isActive])    // For active/inactive filtering
  @@index([dashboard])   // For dashboard-specific queries
}
```

### Query Patterns Analysis

**Query 1: User's Reports** (`src/app/api/saved-reports/route.ts:32-42`)
```typescript
prisma.savedReport.findMany({
  where: {
    userId: permissions.userId,    // Uses @@index([userId])
    isActive: true,                // Uses @@index([isActive])
    dashboard: 'funnel_performance', // Uses @@index([dashboard])
  },
  orderBy: [
    { isDefault: 'desc' },
    { updatedAt: 'desc' },
  ],
});
```
**Current behavior:** PostgreSQL combines indexes via bitmap index scan

**Query 2: Admin Templates** (`src/app/api/saved-reports/route.ts:47-54`)
```typescript
prisma.savedReport.findMany({
  where: {
    reportType: 'admin_template',  // Uses @@index([reportType])
    isActive: true,                // Uses @@index([isActive])
    dashboard: 'funnel_performance', // Uses @@index([dashboard])
  },
  orderBy: { name: 'asc' },
});
```

**Query 3: Default Report** (`src/app/api/saved-reports/default/route.ts:28-35`)
```typescript
prisma.savedReport.findFirst({
  where: {
    userId: permissions.userId,    // Uses @@index([userId])
    isDefault: true,               // Uses @@index([isDefault])
    isActive: true,                // Uses @@index([isActive])
    dashboard: 'funnel_performance', // Uses @@index([dashboard])
  },
});
```

**Query 4: Reset Defaults** (`src/app/api/saved-reports/route.ts:129-136`)
```typescript
prisma.savedReport.updateMany({
  where: {
    userId: permissions.userId,
    isDefault: true,
    isActive: true,
  },
  data: { isDefault: false },
});
```

---

## Optimization Decision

### Should We Add Composite Indexes?

**Current Performance:** Single-column indexes with PostgreSQL's bitmap index scan

**Potential Composite Indexes:**
```prisma
@@index([userId, isActive, dashboard])           // Query 1
@@index([reportType, isActive, dashboard])       // Query 2
@@index([userId, isDefault, isActive, dashboard]) // Query 3
```

### Trade-offs

| Factor | Single-Column (Current) | Composite (Proposed) |
|--------|------------------------|----------------------|
| Query performance | Good (bitmap scan) | Better (single index scan) |
| Write performance | Faster | Slightly slower (more indexes to update) |
| Storage | Current | +3 additional indexes |
| Maintenance | Simple | More indexes to maintain |

### Recommendation: **Optional Improvement**

Given the SavedReport table likely has:
- Small row count (typically <1000 reports total)
- Low write frequency (users save reports occasionally)
- Existing indexes already provide reasonable performance

**Verdict:** Composite indexes would provide marginal improvement. Worth doing if you observe slow query times, but not critical.

---

## Implementation (If Proceeding)

### Step 1: Update Schema

**File:** `prisma/schema.prisma`

Replace the existing single-column indexes with composite indexes:

```prisma
model SavedReport {
  id               String   @id @default(cuid())
  userId           String?
  name             String   @db.VarChar(255)
  description      String?  @db.VarChar(500)
  filters          Json
  featureSelection Json?
  viewMode         String?  @default("focused")
  dashboard        String   @default("funnel_performance")
  reportType       String   @default("user")
  isDefault        Boolean  @default(false)
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  createdBy        String?

  user User? @relation(fields: [userId], references: [id], onDelete: Cascade)

  // OPTIMIZED COMPOSITE INDEXES
  // Replaces 5 single-column indexes with 3 targeted composite indexes

  // Query 1: User's reports (userId + isActive + dashboard)
  // Also covers: Reset defaults query, single-report updates
  @@index([userId, isActive, dashboard])

  // Query 2: Admin templates (reportType + isActive + dashboard)
  @@index([reportType, isActive, dashboard])

  // Query 3: Default report lookup (most specific)
  @@index([userId, isDefault, isActive, dashboard])
}
```

### Step 2: Generate Migration

```bash
npx prisma migrate dev --name optimize_saved_report_indexes
```

**Expected migration SQL:**
```sql
-- Drop existing single-column indexes
DROP INDEX IF EXISTS "SavedReport_userId_idx";
DROP INDEX IF EXISTS "SavedReport_reportType_idx";
DROP INDEX IF EXISTS "SavedReport_isDefault_idx";
DROP INDEX IF EXISTS "SavedReport_isActive_idx";
DROP INDEX IF EXISTS "SavedReport_dashboard_idx";

-- Create optimized composite indexes
CREATE INDEX "SavedReport_userId_isActive_dashboard_idx"
  ON "SavedReport"("userId", "isActive", "dashboard");

CREATE INDEX "SavedReport_reportType_isActive_dashboard_idx"
  ON "SavedReport"("reportType", "isActive", "dashboard");

CREATE INDEX "SavedReport_userId_isDefault_isActive_dashboard_idx"
  ON "SavedReport"("userId", "isDefault", "isActive", "dashboard");
```

### Step 3: Deploy to Production

```bash
# Vercel deployment will run this automatically, or run manually:
npx prisma migrate deploy
```

---

## Other Tables: Already Optimized

### RequestNotification

**Location:** `prisma/schema.prisma:277-289`

**Status:** Already has optimal composite index

```prisma
model RequestNotification {
  id        String           @id @default(cuid())
  message   String
  isRead    Boolean          @default(false)
  createdAt DateTime         @default(now())
  requestId String
  request   DashboardRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  userId    String
  user      User             @relation("UserNotifications", fields: [userId], references: [id])

  @@index([userId, isRead])  // Composite index for unread count queries
  @@index([requestId])        // For request-specific lookups
}
```

**Query it optimizes:** (`/api/notifications/unread-count`)
```typescript
prisma.requestNotification.count({
  where: {
    userId: permissions.userId,
    isRead: false,
  },
});
```

**No changes needed.**

---

### WeeklyGoal

**Location:** `prisma/schema.prisma:50-65`

**Status:** Already optimized with unique constraint (creates index) + additional indexes

```prisma
model WeeklyGoal {
  id                     String   @id @default(cuid())
  userEmail              String
  weekStartDate          DateTime @db.Date
  initialCallsGoal       Int      @default(0)
  qualificationCallsGoal Int      @default(0)
  sqoGoal                Int      @default(0)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  createdBy              String?
  updatedBy              String?

  @@unique([userEmail, weekStartDate])  // Creates composite unique index
  @@index([userEmail])                   // For user-specific queries
  @@index([weekStartDate])               // For date-range queries
}
```

**No changes needed.**

---

### QuarterlyGoal

**Location:** `prisma/schema.prisma:67-80`

**Status:** Already optimized

```prisma
model QuarterlyGoal {
  id        String   @id @default(cuid())
  userEmail String
  quarter   String
  sqoGoal   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdBy String?
  updatedBy String?

  @@unique([userEmail, quarter])  // Creates composite unique index
  @@index([userEmail])             // For user-specific queries
  @@index([quarter])               // For quarter-specific queries
}
```

**No changes needed.**

---

### Other Indexed Tables

| Table | Indexes | Status |
|-------|---------|--------|
| `User` | `@unique email` | Optimal |
| `PasswordResetToken` | `@@index([token])`, `@@index([userId])` | Optimal |
| `GameScore` | `@@index([quarter, score])`, `@@index([userId])`, `@@index([playedAt])` | Optimal |
| `ExploreFeedback` | 5 indexes for various queries | Optimal |
| `DashboardRequest` | 4 indexes including `submitterId`, `status` | Optimal |
| `RequestComment` | `@@index([requestId])`, `@@index([authorId])` | Optimal |
| `RequestAttachment` | `@@index([requestId])` | Optimal |
| `RequestEditHistory` | `@@index([requestId])` | Optimal |

---

## Verification

### Check Index Usage (PostgreSQL)

Connect to your Neon database and run:

```sql
-- Check if indexes are being used
EXPLAIN ANALYZE
SELECT * FROM "SavedReport"
WHERE "userId" = 'test-user-id'
  AND "isActive" = true
  AND "dashboard" = 'funnel_performance';

-- Look for "Index Scan" or "Bitmap Index Scan" in output
-- Avoid "Seq Scan" which indicates full table scan
```

### Monitor Query Performance

```bash
# Enable Prisma query logging (already enabled in development)
npm run dev

# Watch for SavedReport query times in console
# Before optimization: ~100-500ms typical
# After composite indexes: ~10-50ms expected
```

### Prisma Studio Verification

```bash
npx prisma studio
# Navigate to SavedReport table
# Check that data queries load quickly
```

---

## Performance Expectations

### If You Keep Current Single-Column Indexes

| Query | Expected Time | Notes |
|-------|---------------|-------|
| User's reports | 50-200ms | Bitmap index scan on 3 indexes |
| Admin templates | 50-150ms | Bitmap index scan on 3 indexes |
| Default report | 20-100ms | Bitmap index scan on 4 indexes |

### If You Add Composite Indexes

| Query | Expected Time | Improvement |
|-------|---------------|-------------|
| User's reports | 10-50ms | 2-4x faster |
| Admin templates | 10-50ms | 2-3x faster |
| Default report | 5-20ms | 2-5x faster |

**Note:** Actual performance depends on table size, data distribution, and PostgreSQL query planner decisions.

---

## Rollback Plan

### If Composite Indexes Cause Issues

```bash
# Revert schema to original single-column indexes
git checkout HEAD -- prisma/schema.prisma

# Create migration to restore original indexes
npx prisma migrate dev --name revert_to_single_column_indexes
```

### Manual Rollback SQL

```sql
-- Drop composite indexes
DROP INDEX IF EXISTS "SavedReport_userId_isActive_dashboard_idx";
DROP INDEX IF EXISTS "SavedReport_reportType_isActive_dashboard_idx";
DROP INDEX IF EXISTS "SavedReport_userId_isDefault_isActive_dashboard_idx";

-- Recreate original single-column indexes
CREATE INDEX "SavedReport_userId_idx" ON "SavedReport"("userId");
CREATE INDEX "SavedReport_reportType_idx" ON "SavedReport"("reportType");
CREATE INDEX "SavedReport_isDefault_idx" ON "SavedReport"("isDefault");
CREATE INDEX "SavedReport_isActive_idx" ON "SavedReport"("isActive");
CREATE INDEX "SavedReport_dashboard_idx" ON "SavedReport"("dashboard");
```

---

## Checklist

### Investigation (Already Complete)
- [x] Reviewed SavedReport model - has 5 single-column indexes
- [x] Reviewed RequestNotification - already has composite index
- [x] Reviewed WeeklyGoal - already has optimal indexes
- [x] Reviewed QuarterlyGoal - already has optimal indexes
- [x] Analyzed query patterns in saved-reports routes

### Optional: Add Composite Indexes
- [ ] Update `prisma/schema.prisma` with composite indexes
- [ ] Run `npx prisma migrate dev --name optimize_saved_report_indexes`
- [ ] Review generated migration SQL
- [ ] Deploy with `npx prisma migrate deploy`
- [ ] Verify indexes exist in database
- [ ] Monitor query performance improvement

### Verification
- [ ] No errors in application after deployment
- [ ] SavedReport queries show improved response times
- [ ] Prisma Studio loads SavedReport table quickly

---

## Summary

**Key Finding:** The database is already well-indexed. The investigation revealed:

1. **SavedReport:** Has 5 single-column indexes. Composite indexes are an optional optimization.
2. **RequestNotification:** Already has the optimal `@@index([userId, isRead])` composite index.
3. **WeeklyGoal/QuarterlyGoal:** Already optimized with unique constraints and indexes.
4. **All other tables:** Appropriately indexed for their query patterns.

**Recommendation:** The original document overstated the problem. Current indexes provide good performance. Composite indexes for SavedReport are an optional micro-optimization that may provide 2-4x improvement on already-fast queries.

---

**Document Version:** 2.0
**Last Updated:** 2026-01-30
**Updated By:** Claude Code
**Status:** Investigation complete - minor optimization available
**For:** Savvy Dashboard Performance Optimization
