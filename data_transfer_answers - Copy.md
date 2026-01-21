# Data Transfer Implementation - Codebase Analysis Answers

> **Instructions**: Fill in each section as you analyze the codebase. Use code snippets, file paths, and specific details.
> 
> **Date Analyzed**: [Fill in]
> **Analyzed By**: Cursor.ai

---

## Section 1: Current Caching Strategy

### 1.1 Cache Configuration

**File Location(s)**: 
<!-- e.g., src/lib/cache.ts -->

**Cache Tags**:
```typescript
// Paste the CACHE_TAGS definition here
```

**TTL Values**:
| Cache Type | TTL | File Location |
|------------|-----|---------------|
| Dashboard queries | ? | ? |
| Detail records | ? | ? |
| Filter options | ? | ? |

### 1.2 Cache Wrapper Pattern

**cachedQuery Function Location**: 
<!-- File path -->

**Implementation**:
```typescript
// Paste the cachedQuery function here
```

**Functions Using This Wrapper**:
- [ ] List each function
- [ ] 

### 1.3 Cache Invalidation

**revalidateTag() Usage**:
| File | Tags Invalidated | Trigger |
|------|------------------|---------|
| ? | ? | ? |

---

## Section 2: Current Cron Jobs

### 2.1 Vercel Cron Configuration

**vercel.json cron config**:
```json
// Paste the crons section here
```

**Schedule in EST**: 

### 2.2 Cron Route Implementation

**File**: `src/app/api/cron/refresh-cache/route.ts`

```typescript
// Paste the full route implementation here
```

**Authentication Method**: 

**Actions Performed**:
1. 
2. 

### 2.3 Current Schedule Analysis

| Cron Expression | UTC Time | EST Time | Purpose |
|-----------------|----------|----------|---------|
| ? | ? | ? | ? |

**Friday-specific crons?**: Yes / No

---

## Section 3: Current Admin Refresh Feature

### 3.1 Admin Refresh API Endpoint

**File**: `src/app/api/admin/refresh-cache/route.ts`

```typescript
// Paste the full route implementation here
```

**Auth Required**: 
**Authorization Check**: 
**Response Format**:
```json
// Example response
```

### 3.2 DataFreshnessIndicator Component

**File**: `src/components/dashboard/DataFreshnessIndicator.tsx`

**Key Props**:
```typescript
// Interface/props
```

**How it fetches freshness**:

**Current Refresh Button Behavior**:
1. 
2. 
3. 

**Permission Check**:
```typescript
// How isAdmin is determined
```

### 3.3 Data Freshness API

**Endpoint**: 
**Response**:
```json
// Example response
```

**How last sync time is determined**:

---

## Section 4: BigQuery Data Transfer Configuration

### 4.1 Transfer Config Details

**Query Run**:
```sql
-- Query used
```

**Results**:
| Field | Value |
|-------|-------|
| Schedule | ? |
| Objects Synced | ? |
| Destination Dataset | ? |
| Owner | ? |

### 4.2 Recent Transfer Runs

**Average Duration**: 
**Typical Run Time**: 
**Success Rate**: 

### 4.3 Transfer Config Resource ID

**Confirmed Resource Path**:
```
projects/154995667624/locations/northamerica-northeast2/transferConfigs/68d12521-0000-207a-b4fa-ac3eb14e17d8
```

---

## Section 5: Permission System

### 5.1 User Roles

**Roles Defined**:
- admin
- manager
- sgm
- sga
- viewer

**Definition Location**: 

### 5.2 Permission Checks

**getUserPermissions Function**:
```typescript
// Paste implementation
```

**Recommended Roles for Data Transfer Access**:
- [ ] admin
- [ ] manager
- [ ] other?

### 5.3 Current Admin Checks

**How isAdmin is determined in DataFreshnessIndicator**:
```typescript
// Code snippet
```

---

## Section 6: Environment Variables

### 6.1 BigQuery Credentials

| Variable | Purpose | Used In |
|----------|---------|---------|
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | ? | ? |
| `GCP_PROJECT_ID` | ? | ? |

### 6.2 Cron Secret

**Variable**: `CRON_SECRET`
**Used In**: 
**Validation**:
```typescript
// How it's validated
```

### 6.3 New Env Vars Needed

| Variable | Purpose | Required? |
|----------|---------|-----------|
| ? | ? | ? |

---

## Section 7: BigQuery Client Setup

### 7.1 Current BigQuery Client

**File**: `src/lib/bigquery.ts`

**Scopes Requested**:
```typescript
// Paste scopes array
```

### 7.2 Data Transfer Client

**@google-cloud/bigquery-data-transfer installed?**: Yes / No

**package.json dependencies**:
```json
// Relevant dependencies
```

**Separate Client Needed?**: Yes / No

---

## Section 8: UI Components

### 8.1 Dashboard Header

**Component Location**: 
**DataFreshnessIndicator Placement**: 
**Variants Used**: compact / detailed

### 8.2 Loading/Progress States

**Existing Spinner Component**: 
**Toast/Alert System**: 

### 8.3 Confirmation Dialogs

**Existing Dialog Component**: Yes / No
**Location**: 
**How to Use**:

---

## Section 9: Logging and Monitoring

### 9.1 Current Logging

**Logger Location**: `src/lib/logger.ts`

**Log Levels Available**:
- info
- warn
- error
- ?

### 9.2 Error Handling Patterns

**Sentry Configured?**: Yes / No
**Standard Error Response Pattern**:
```typescript
// Example
```

---

## Section 10: Vercel Configuration

### 10.1 Function Timeouts

**vercel.json functions config**:
```json
// Paste here
```

**Max Duration Available**: 
**Routes with Custom Timeout**:

### 10.2 Cron Limitations

**Max Cron Jobs**: 
**Minimum Interval**: 
**Other Limitations**:

---

## Section 11: Specific Implementation Questions

### 11.1 Rate Limiting

**Existing Rate Limiting?**: Yes / No
**Recommended Approach for Cooldown**:

💡 **Recommendation**:

### 11.2 Transfer Status Polling

**Recommended Polling Interval**: 
**Timeout Duration**: 
**Handling Long Transfers**:

### 11.3 Objects to Sync

**Confirmed Objects**:
- [ ] Lead
- [ ] Opportunity
- [ ] Task
- [ ] Other: ?

---

## Section 12: Schedule Verification

### 12.1 Current BigQuery Transfer Schedule

**Current Schedule**: 
**Timezone**: 
**Last Successful Run**: 

### 12.2 Proposed New Schedule - UTC Conversion

| EST Time | UTC Time | Days |
|----------|----------|------|
| 5:00 AM | 10:00 AM | Daily |
| 11:00 AM | 4:00 PM | Daily |
| 5:00 PM | 10:00 PM | Daily |
| 11:00 PM | 4:00 AM (+1 day) | Daily |
| 2:37 PM | 7:37 PM | Friday |
| 3:37 PM | 8:37 PM | Friday |
| 5:37 PM | 10:37 PM | Friday |

### 12.3 Cron Expressions

**Daily 6-hour syncs** (for cache invalidation alignment):
```
# 5 AM EST (10 AM UTC)
0 10 * * *

# 11 AM EST (4 PM UTC)
0 16 * * *

# 5 PM EST (10 PM UTC)
0 22 * * *

# 11 PM EST (4 AM UTC next day)
0 4 * * *
```

**Friday special syncs**:
```
# 2:37 PM EST (7:37 PM UTC)
37 19 * * 5

# 3:37 PM EST (8:37 PM UTC)
37 20 * * 5

# 5:37 PM EST (10:37 PM UTC)
37 22 * * 5
```

---

## Section 13: Dependencies Check

### 13.1 Package.json Analysis

**@google-cloud/bigquery-data-transfer**: Installed / Not Installed
**@google-cloud/bigquery**: Version ?

### 13.2 Version Compatibility

**Next.js Version**: 
**Compatibility Concerns**:

---

## Summary

### 1. Architecture Summary

<!-- How does the current caching and refresh system work end-to-end? -->

### 2. Gap Analysis

**What's Missing**:
1. 
2. 
3. 

### 3. Risk Assessment

⚠️ **Potential Risks**:
1. 
2. 

### 4. Recommended Approach

💡 **Data Transfer Trigger Endpoint**:

💡 **Updated UI**:

💡 **New Cron Schedule**:

💡 **Cache Invalidation Strategy**:

### 5. Files to Modify

| File | Changes Needed |
|------|----------------|
| ? | ? |

### 6. New Files to Create

| File | Purpose |
|------|---------|
| ? | ? |

### 7. Environment Variables

| Variable | Purpose | Where to Set |
|----------|---------|--------------|
| ? | ? | Vercel + .env |

### 8. Testing Strategy

1. 
2. 
3. 

---

## Additional Notes

<!-- Any other observations, concerns, or recommendations -->
