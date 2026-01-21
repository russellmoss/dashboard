# Data Transfer Implementation - Codebase Analysis Questions

## Instructions for Cursor.ai

Work through each question below sequentially. For each question:
1. Search/read the relevant files in the codebase
2. Use MCP connection to BigQuery if needed to verify configurations
3. Write your findings in `data_transfer_answers.md` with the same section numbering
4. Include relevant code snippets where helpful
5. Note any discrepancies or concerns you discover

---

## Section 1: Current Caching Strategy

### 1.1 Cache Configuration
- Where is the cache configuration defined? (look for `CACHE_TAGS`, TTL values, etc.)
- What are the current cache tags being used?
- What are the current TTL (Time To Live) values for:
  - Dashboard queries
  - Detail records
  - Filter options
- Where is `unstable_cache` or similar Next.js caching being used?

### 1.2 Cache Wrapper Pattern
- Find and document the `cachedQuery` wrapper function
- Which query functions use this wrapper?
- How does the cache key generation work?

### 1.3 Cache Invalidation
- What triggers cache invalidation currently?
- Find all places where `revalidateTag()` is called
- What tags are invalidated and when?

---

## Section 2: Current Cron Jobs

### 2.1 Vercel Cron Configuration
- What is the current cron schedule in `vercel.json`?
- What endpoint does the cron job call?
- What timezone is the cron schedule based on (UTC)?

### 2.2 Cron Route Implementation
- Find and document `/api/cron/refresh-cache/route.ts`
- How does it authenticate requests?
- What actions does it perform?
- Are there any other cron-related routes?

### 2.3 Current Schedule Analysis
- Convert the current cron schedule to EST
- Does it align with the BigQuery data transfer schedule?
- Are there any Friday-specific cron jobs currently?

---

## Section 3: Current Admin Refresh Feature

### 3.1 Admin Refresh API Endpoint
- Find and document `/api/admin/refresh-cache/route.ts`
- What authentication/authorization does it require?
- What does it actually do when called?
- What response does it return?

### 3.2 DataFreshnessIndicator Component
- Find and fully document `src/components/dashboard/DataFreshnessIndicator.tsx`
- How does it fetch freshness data?
- How does the current "Refresh" button work?
- What permissions check does it perform (isAdmin)?
- What feedback does it show the user?

### 3.3 Data Freshness API
- Find the API endpoint that provides data freshness info
- What data does it return?
- How does it determine when data was last synced?

---

## Section 4: BigQuery Data Transfer Configuration

### 4.1 Transfer Config Details (Use MCP/BigQuery)
Using your BigQuery MCP connection, query for:
```sql
-- Run this or equivalent to get transfer config details
SELECT * FROM `region-northamerica-northeast2`.INFORMATION_SCHEMA.TRANSFER_CONFIGS
WHERE transfer_config_id = '68d12521-0000-207a-b4fa-ac3eb14e17d8'
```

Document:
- Current schedule setting
- Which objects are being synced (Lead, Opportunity, Task, etc.)
- Destination dataset
- Transfer config owner

### 4.2 Recent Transfer Runs (Use MCP/BigQuery)
Query recent transfer runs to understand:
- How long do transfers typically take?
- What time do they currently run?
- Success/failure rate

### 4.3 Transfer Config Resource ID
Confirm the full transfer config resource path:
```
projects/154995667624/locations/northamerica-northeast2/transferConfigs/68d12521-0000-207a-b4fa-ac3eb14e17d8
```

---

## Section 5: Permission System

### 5.1 User Roles
- Find where user roles are defined
- What roles exist? (admin, manager, sgm, sga, viewer)
- Where is role checking implemented?

### 5.2 Permission Checks
- Find `getUserPermissions` function
- How does it determine a user's role?
- Which roles should have access to trigger data transfers?

### 5.3 Current Admin Checks
- How does DataFreshnessIndicator check if user is admin?
- Are there other places that check for admin/manager permissions?

---

## Section 6: Environment Variables

### 6.1 BigQuery Credentials
- Document all BigQuery-related environment variables
- Where is `GOOGLE_APPLICATION_CREDENTIALS_JSON` used?
- Is there a separate credential for data transfers or same one?

### 6.2 Cron Secret
- How is `CRON_SECRET` used?
- Where is it validated?

### 6.3 Any Missing Env Vars
- What new environment variables might we need for data transfer triggering?

---

## Section 7: BigQuery Client Setup

### 7.1 Current BigQuery Client
- Find and document `src/lib/bigquery.ts`
- How is the client initialized?
- What scopes are requested?

### 7.2 Data Transfer Client
- Is `@google-cloud/bigquery-data-transfer` already installed?
- Check `package.json` for existing dependencies
- Will we need a separate client initialization for data transfers?

---

## Section 8: UI Components

### 8.1 Dashboard Header
- Where is the dashboard header component?
- Where does DataFreshnessIndicator appear?
- Are there multiple instances (compact vs detailed)?

### 8.2 Loading/Progress States
- How do other components show loading states?
- Is there a spinner or progress component we can reuse?
- How are success/error messages displayed? (toast, alert, etc.)

### 8.3 Confirmation Dialogs
- Is there an existing confirmation dialog component?
- How do other features handle "are you sure?" prompts?

---

## Section 9: Logging and Monitoring

### 9.1 Current Logging
- Find the logger implementation (`src/lib/logger.ts`)
- How are events logged?
- Where do logs go (Vercel, external service)?

### 9.2 Error Handling Patterns
- How do API routes handle and report errors?
- Is there Sentry or similar error tracking?

---

## Section 10: Vercel Configuration

### 10.1 Function Timeouts
- What are the current function timeout settings in `vercel.json`?
- Which routes have custom `maxDuration`?
- What is the maximum allowed duration on your Vercel plan?

### 10.2 Cron Limitations
- How many cron jobs can you have?
- What's the minimum cron interval allowed?
- Are there any cron job limitations to be aware of?

---

## Section 11: Specific Implementation Questions

### 11.1 Rate Limiting
- Is there any existing rate limiting implementation?
- How would we track "last refresh time" to enforce cooldown?
- Should this be per-user or global?

### 11.2 Transfer Status Polling
- When a transfer is triggered, how long should we poll for completion?
- What's the polling interval (every 10 seconds? 30 seconds?)
- How do we handle timeout if transfer takes too long?

### 11.3 Objects to Sync
Confirm these are the objects we need to transfer:
- Lead
- Opportunity  
- Task
- Any others currently in the transfer config?

---

## Section 12: Schedule Verification

### 12.1 Current BigQuery Transfer Schedule
Using MCP, verify:
- What is the exact current schedule?
- What timezone is it set to?
- When was the last successful run?

### 12.2 Proposed New Schedule
We want to implement:
- **Daily**: 5:00 AM, 11:00 AM, 5:00 PM, 11:00 PM EST (every 6 hours)
- **Friday additions**: 2:37 PM, 3:37 PM, 5:37 PM EST

Convert these to UTC for cron configuration:
- 5:00 AM EST = ? UTC
- 11:00 AM EST = ? UTC
- 5:00 PM EST = ? UTC
- 11:00 PM EST = ? UTC
- 2:37 PM EST = ? UTC (Friday only)
- 3:37 PM EST = ? UTC (Friday only)
- 5:37 PM EST = ? UTC (Friday only)

### 12.3 Cron Expression
Write the cron expressions needed for `vercel.json`:
- Daily 6-hour syncs
- Friday special syncs

---

## Section 13: Dependencies Check

### 13.1 Package.json Analysis
Check if these packages are installed:
- `@google-cloud/bigquery-data-transfer`
- `@google-cloud/bigquery`

### 13.2 Version Compatibility
- What version of Next.js is the project using?
- Are there any compatibility concerns with the data transfer client?

---

## Summary Questions

After completing all sections, provide:

1. **Architecture Summary**: How does the current caching and refresh system work end-to-end?

2. **Gap Analysis**: What's missing that we need to build?

3. **Risk Assessment**: What could go wrong with the implementation?

4. **Recommended Approach**: Based on the codebase, what's the cleanest way to implement:
   - The new data transfer trigger endpoint
   - The updated UI with warnings and progress
   - The new cron schedule
   - The cache invalidation tied to transfer completion

5. **Files to Modify**: List all files that will need changes

6. **New Files to Create**: List all new files we'll need

7. **Environment Variables**: List any new env vars needed

8. **Testing Strategy**: How should we test this before deploying?

---

## Output Format

Create `data_transfer_answers.md` with:
- Same section numbering as this document
- Clear answers with code snippets where relevant
- Any concerns or blockers highlighted with ⚠️
- Recommendations marked with 💡
