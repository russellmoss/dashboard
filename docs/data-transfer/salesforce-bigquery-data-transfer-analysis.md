# Salesforce to BigQuery Data Transfer Analysis

## Executive Summary

This document analyzes our current Salesforce data transfer strategy for the Lead and Opportunity objects, evaluates user needs for fresher data, and provides cost-based recommendations for improving data freshness while maintaining fiscal responsibility.

**Key Finding:** Our BigQuery costs are effectively **$0/month**. The barrier to more frequent data transfers is **not cost** — it's Salesforce API limits and operational complexity.

---

## Current State Overview

### Data Volumes

| Object | Records | Size | Monthly Storage Cost |
|--------|---------|------|---------------------|
| Lead | 93,867 | 68.89 MB | $0.001 |
| Opportunity | 2,741 | 2.26 MB | $0.000 |
| **Total** | **96,608** | **71.15 MB** | **< $0.01** |

### Current Sync Configuration

| Parameter | Current Setting |
|-----------|-----------------|
| Sync Frequency | Every 24 hours |
| Last Sync | 12 hours ago (as of analysis) |
| Data Transfer Cost | $0 (Salesforce connector is free) |
| Sync Method | Full table refresh via BigQuery Data Transfer Service |

### Data Freshness Status

| Object | Records Modified (24h) | Sync Lag | Status |
|--------|------------------------|----------|--------|
| Lead | 670 records | 176 minutes | 🟠 Stale |
| Opportunity | 19 records | 395 minutes | 🟠 Stale |

---

## User Needs Assessment

### The Problem

Sales managers and RevOps users have expressed that **24-hour data transfers do not support their operational needs**. Specific pain points include:

1. **Morning Stand-ups**: Managers review pipeline in morning meetings but see data from the previous day's sync, missing activity from the prior afternoon/evening.

2. **End-of-Day Reporting**: When pulling reports at 4pm EST, data may be 20+ hours old if the sync ran at 4am.

3. **Real-Time Deal Tracking**: When an SQO moves to "Signed" or "Joined," managers want to see this reflected immediately for celebration/recognition and accurate pipeline views.

4. **Weekly Goals Tracking**: SGAs checking their progress against weekly goals see outdated numbers, making it difficult to course-correct mid-week.

### Activity Patterns Analysis

Based on our 30-day analysis of when Salesforce records are modified:

| Time Window (EST) | Typical Activity | Notes |
|-------------------|------------------|-------|
| 6am - 8am | High lead activity | Clay/FinTrx enrichment, scheduled automations |
| 8am - 12pm | Peak business hours | SDR/SGA prospecting activity |
| 12pm - 5pm | Sustained activity | Sales calls, opportunity updates |
| 5pm - 9pm | Moderate activity | West coast wrap-up, evening follow-ups |
| 8pm - 9pm Sunday | Weekly enrichment spike | Clay/FinTrx bulk enrichment (~75k leads) |
| 9pm - 6am | Low activity | Minimal manual activity |

**Key Insight**: **Clay and FinTrx data enrichment processes** run weekly, primarily on Monday at 1am UTC (8pm Sunday EST). These processes modify ~75,000 lead records in approximately 50 seconds via bulk API operations.

| User | Account | Records Modified | Duration | Purpose |
|------|---------|------------------|----------|---------|
| Jed Entin | jed.entin@savvywealth.com | 75,317 | 50 seconds | Clay/FinTrx bulk enrichment |
| Savvy Marketing | kenji.miyashiro@savvywealth.com | 190 | ~8 minutes | Clay/FinTrx enrichment |

**Enrichment Tools in Use:**
- **Clay**: Lead enrichment and data augmentation
- **FinTrx**: Financial services industry data enrichment (recently added)

These enrichment jobs account for the majority of weekly Lead modifications. The high volume (75k+ records) in a short window (50 seconds) indicates bulk API usage, which is efficient for Salesforce API limits but creates a spike in modification timestamps. This is **expected behavior** and does not indicate a problem — it's intentional data enrichment managed by the RevOps team.

### Funnel Velocity

How quickly do records actually move through our funnel?

| Metric | 7-Day Total | Daily Average |
|--------|-------------|---------------|
| New Leads | 1,340 | 191.4 |
| Leads Converted | 20 | 2.9 |
| New Opportunities | 21 | 3.0 |
| Opportunities Modified | 384 | 54.9 |

**Interpretation**: With ~55 opportunity modifications per day and ~3 new opportunities, the actual *high-value* changes that managers care about are relatively low volume. However, those 3 new opportunities and stage changes are exactly what managers want to see in real-time.

---

## Cost Analysis

### Current Costs

| Cost Category | Monthly Amount |
|---------------|----------------|
| Data Transfer (Salesforce connector) | $0.00 |
| BigQuery Storage (71 MB) | $0.00 |
| BigQuery Queries (current usage) | $0.00 |
| **Total** | **$0.00** |

### Projected Costs by Sync Frequency

| Scenario | Daily Queries | Monthly Query Cost |
|----------|---------------|-------------------|
| Current (24h sync, 12h cache) | 5 | $0.00 |
| 12h sync, 6h cache | 9 | $0.00 |
| 6h sync, 1h cache | 54 | $0.02 |
| 1h sync, no cache | 108 | $0.04 |

**Critical Finding**: Even with hourly syncs and no caching, our monthly BigQuery costs would be approximately **$0.04**. Cost is not a limiting factor.

### Why Costs Are So Low

1. **Small Data Volume**: 71 MB total is trivial for BigQuery
2. **Efficient Queries**: Our dashboard uses optimized queries against `vw_funnel_master`
3. **Effective Caching**: 12-hour cache prevents redundant BigQuery scans
4. **Free Tier**: First 1 TB of queries per month is free; we use < 0.001 TB

---

## Constraints & Limitations

### Salesforce API Limits

The primary constraint for more frequent data transfers is **Salesforce API call limits**, not BigQuery costs.

| Salesforce Edition | Daily API Limit | Estimated Calls per Sync | Max Syncs per Day |
|-------------------|-----------------|-------------------------|-------------------|
| Professional | 15,000 | ~2,000-5,000 | 3-7 |
| Enterprise | 100,000 | ~2,000-5,000 | 20-50 |
| Unlimited | 500,000 | ~2,000-5,000 | 100+ |

**Recommendation**: Check your Salesforce edition and current API usage before increasing sync frequency. Run this in Salesforce: `Setup → Company Information → API Requests, Last 24 Hours`

### BigQuery Data Transfer Service Limits

| Limit | Value |
|-------|-------|
| Minimum sync interval | 15 minutes |
| Maximum concurrent transfers | 10 per project |
| Transfer timeout | 24 hours |

### Operational Considerations

1. **Sync Duration**: Each sync takes 5-15 minutes depending on data volume
2. **Overlapping Syncs**: If sync frequency exceeds sync duration, jobs may queue
3. **Error Handling**: More frequent syncs = more opportunities for transient failures
4. **Monitoring Overhead**: More syncs require more monitoring attention

---

## Recommendation: Implement On-Demand Refresh

### Proposed Solution

Rather than simply increasing sync frequency (which has API limits), we recommend implementing a **hybrid approach**:

1. **Scheduled Syncs**: Increase from 24h to **6-hour intervals** during business hours
2. **On-Demand Refresh**: Add a "Refresh Data" button for managers to trigger syncs as needed

### Proposed Sync Schedule

| Time (EST) | Day | Type |
|------------|-----|------|
| 6:00 AM | Mon-Fri | Scheduled (catch overnight changes) |
| 12:00 PM | Mon-Fri | Scheduled (morning activity) |
| 6:00 PM | Mon-Fri | Scheduled (afternoon activity) |
| 6:00 AM | Sat-Sun | Scheduled (weekend coverage) |
| Any time | Any day | On-demand (manager-triggered) |

This provides:
- Maximum 6-hour data staleness during business hours
- 4 scheduled syncs per weekday (vs. current 1)
- Flexibility for managers to get real-time data when needed

### On-Demand Refresh Feature Specification

#### User Interface

```
┌─────────────────────────────────────────────────────┐
│  Data last synced: 2 hours ago                      │
│  [🔄 Refresh Data]  ← Button for managers/admins    │
└─────────────────────────────────────────────────────┘
```

#### Access Control

| Role | Can Trigger Refresh |
|------|---------------------|
| Admin | ✅ Yes |
| Manager | ✅ Yes |
| SGM | ❌ No (can request from manager) |
| SGA | ❌ No |
| Viewer | ❌ No |

#### Safeguards

1. **Rate Limiting**: Maximum 1 manual refresh per 15 minutes (Data Transfer minimum)
2. **Cooldown Display**: Show "Next refresh available in X minutes" after trigger
3. **Status Feedback**: Show "Sync in progress..." with estimated completion time
4. **Audit Logging**: Log who triggered refreshes and when

#### Technical Implementation

The on-demand refresh would:
1. Call BigQuery Data Transfer Service API to trigger an immediate run
2. Wait for transfer completion (poll status)
3. Invalidate dashboard cache (`revalidateTag()`)
4. Refresh the data freshness indicator

```typescript
// Pseudocode for on-demand refresh
async function triggerDataRefresh() {
  // 1. Check rate limit (15 min cooldown)
  if (lastRefresh < 15 minutes ago) {
    throw new Error('Please wait before refreshing again');
  }
  
  // 2. Trigger BigQuery Data Transfer
  await dataTransferService.triggerRun(transferConfigId);
  
  // 3. Poll for completion (timeout after 10 min)
  await waitForTransferCompletion(transferConfigId);
  
  // 4. Invalidate dashboard cache
  revalidateTag('dashboard');
  revalidateTag('sga-hub');
  
  // 5. Return success
  return { success: true, syncedAt: new Date() };
}
```

---

## Caching Strategy Adjustments

### Current Caching Strategy

| Cache Type | TTL | Purpose |
|------------|-----|---------|
| Dashboard queries | 12 hours | Reduce BigQuery costs |
| Detail records | 6 hours | Balance freshness vs. cost for large queries |
| Filter options | 12 hours | Rarely change |

### Recommended Caching Strategy (with 6h syncs + on-demand)

| Cache Type | New TTL | Rationale |
|------------|---------|-----------|
| Dashboard queries | **4 hours** | Shorter than sync interval to show fresh data |
| Detail records | **2 hours** | More frequent access to current records |
| Filter options | 12 hours | No change needed |
| On-demand refresh | **Immediate invalidation** | Bust cache when user triggers refresh |

### Cache Invalidation Flow

```
Scheduled Sync (every 6h)
    │
    ▼
┌─────────────────────┐
│ BigQuery Data       │
│ Transfer Completes  │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ Vercel Cron Job     │──► revalidateTag('dashboard')
│ (aligned to sync)   │──► revalidateTag('sga-hub')
└─────────────────────┘

On-Demand Refresh
    │
    ▼
┌─────────────────────┐
│ Manager clicks      │
│ "Refresh Data"      │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ API triggers        │
│ Data Transfer       │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ Transfer completes  │──► revalidateTag('dashboard')
│                     │──► revalidateTag('sga-hub')
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ User sees fresh     │
│ data immediately    │
└─────────────────────┘
```

---

## Risk Assessment

### Risks of Increasing Sync Frequency

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Hit Salesforce API limits | Medium | High | Monitor usage, set alerts at 80% |
| Sync job failures | Low | Medium | Implement retry logic, alerting |
| Overlapping syncs | Low | Low | Data Transfer Service handles queuing |
| Increased monitoring burden | Medium | Low | Set up automated alerts |

### Risks of On-Demand Refresh

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Users spam refresh button | Medium | Medium | 15-minute rate limit |
| Sync takes too long, user confused | Medium | Low | Show progress indicator |
| API rate limit exhaustion | Low | High | Track daily usage, warn at threshold |

### Risks of NOT Improving Freshness

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Managers lose trust in dashboard | High | High | This proposal |
| Users revert to Salesforce reports | High | Medium | This proposal |
| Missed real-time insights | Medium | Medium | This proposal |

---

## Implementation Roadmap

### Phase 1: Increase Scheduled Sync Frequency (Week 1)

1. Update BigQuery Data Transfer Service schedule to 6-hour intervals
2. Align Vercel Cron cache invalidation to new schedule
3. Reduce dashboard cache TTL from 12h to 4h
4. Monitor Salesforce API usage for 1 week

**Estimated Effort**: 2-4 hours
**Risk**: Low

### Phase 2: Implement On-Demand Refresh (Week 2-3)

1. Create API endpoint to trigger Data Transfer run
2. Add "Refresh Data" button to dashboard header
3. Implement rate limiting (15-minute cooldown)
4. Add progress indicator and completion notification
5. Update DataFreshnessIndicator component

**Estimated Effort**: 8-16 hours
**Risk**: Medium

### Phase 3: Monitor and Optimize (Week 4+)

1. Track refresh button usage patterns
2. Monitor Salesforce API consumption
3. Gather user feedback on data freshness
4. Adjust sync schedule based on actual usage patterns

**Estimated Effort**: Ongoing
**Risk**: Low

---

## Decision Matrix

| Option | Cost Impact | User Satisfaction | Implementation Effort | API Risk |
|--------|-------------|-------------------|----------------------|----------|
| Keep 24h sync | $0 | ❌ Low | None | None |
| 12h sync | $0 | 😐 Medium | Low | Low |
| 6h sync | $0 | ✅ Good | Low | Medium |
| 6h sync + on-demand | $0 | ✅✅ Excellent | Medium | Medium |
| 1h sync | $0 | ✅✅ Excellent | Low | High |

**Recommendation**: **6-hour scheduled syncs + on-demand refresh** provides the best balance of user satisfaction, implementation effort, and API risk management.

---

## Appendix: Key Metrics Summary

### Storage & Costs
- Total data volume: 71.2 MB
- Monthly storage cost: < $0.01
- Monthly query cost: < $0.05 (even with aggressive querying)
- Data transfer cost: $0 (free)

### Data Velocity
- New leads per day: ~191
- Lead conversions per day: ~3
- New opportunities per day: ~3
- Opportunity modifications per day: ~55

### Current Usage
- Dashboard queries per day: ~5
- Unique dashboard users (last 14 days): 1-2
- Peak usage hours: 2pm-4pm EST

---

## Conclusion

**The data clearly shows that cost is not a barrier to improving data freshness.** Our BigQuery costs are effectively zero, and will remain negligible even with significantly more frequent syncs.

The primary considerations are:
1. **Salesforce API limits** — Must be monitored but likely not a blocker for Enterprise edition
2. **User experience** — On-demand refresh provides maximum flexibility
3. **Operational complexity** — Manageable with proper monitoring

**We recommend proceeding with 6-hour scheduled syncs and an on-demand refresh feature**, which will dramatically improve data freshness while maintaining near-zero costs and acceptable API usage.

---

*Document prepared: January 17, 2026*
*Data sources: BigQuery INFORMATION_SCHEMA, SavvyGTMData tables*
*Analysis period: Last 30 days*
