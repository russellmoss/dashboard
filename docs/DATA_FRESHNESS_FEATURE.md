# Data Freshness Feature

## Overview

The Data Freshness feature displays when data was last synced from Salesforce to BigQuery, helping users understand if the dashboard data is current or stale.

## What It Does

The feature shows two indicators:
1. **Compact Indicator** (Header): A small status dot with "Updated X minutes ago" text
2. **Detailed Indicator** (GlobalFilters): Full timestamp with icon and background color: "Last synced: Jan 16, 2026 at 3:39 PM"

## How It Works

### Data Source

The feature uses BigQuery's `__TABLES__` metadata table to determine when data was last loaded:

```sql
SELECT 
  MAX(last_data_load) as last_updated,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), HOUR) as hours_ago,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), MINUTE) as minutes_ago
FROM (
  SELECT TIMESTAMP_MILLIS(last_modified_time) as last_data_load
  FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__`
  WHERE table_id IN ('Lead', 'Opportunity')
)
```

This query:
- Checks the `last_modified_time` from the `__TABLES__` metadata for Lead and Opportunity tables
- Uses the most recent timestamp between the two tables
- Calculates hours and minutes since the last data load

**Why `__TABLES__` metadata?**
- `last_modified_time` in `__TABLES__` represents when data was last loaded into BigQuery (sync completion time)
- This answers "When was the data last synced from Salesforce?" which is what users need to know
- Using `MAX(LastModifiedDate)` from actual records would show when records were last modified in Salesforce, not when they were synced

### Status Thresholds

The feature categorizes data freshness into four statuses:

| Status | Time Range | Color | Icon |
|--------|------------|-------|------|
| **fresh** | < 1 hour | Green | CheckCircle |
| **recent** | 1-6 hours | Yellow | Clock |
| **stale** | 6-24 hours | Orange | AlertCircle |
| **very_stale** | > 24 hours | Red | AlertTriangle |

### Where It Appears

1. **Header** (Compact Variant):
   - Positioned in the top-right, before user info
   - Shows: Status dot + "Updated X minutes ago"
   - Hidden on small screens (`hidden sm:flex`)

2. **GlobalFilters** (Detailed Variant):
   - Positioned below the filter controls
   - Shows: Icon + "Last synced: [date] at [time]" with background color
   - Displays "(stale)" label when data is > 24 hours old

## Technical Implementation

### Files Created

- `src/lib/queries/data-freshness.ts` - BigQuery query logic
- `src/app/api/dashboard/data-freshness/route.ts` - API endpoint
- `src/lib/utils/freshness-helpers.ts` - Utility functions for formatting
- `src/components/dashboard/DataFreshnessIndicator.tsx` - React component

### Files Modified

- `src/types/dashboard.ts` - Added `DataFreshness` and `DataFreshnessStatus` types
- `src/lib/api-client.ts` - Added `getDataFreshness()` method
- `src/components/layout/Header.tsx` - Added compact indicator
- `src/components/dashboard/GlobalFilters.tsx` - Added detailed indicator

### API Endpoint

**GET** `/api/dashboard/data-freshness`

**Response:**
```json
{
  "lastUpdated": "2026-01-16T20:39:22.827Z",
  "hoursAgo": 0,
  "minutesAgo": 44,
  "isStale": false,
  "status": "fresh"
}
```

**Caching:**
- Cache-Control: `public, s-maxage=300, stale-while-revalidate=600`
- API response cached for 5 minutes
- Component auto-refreshes every 5 minutes

**Authentication:**
- Requires authenticated session
- Returns 401 Unauthorized if not logged in

### Component Features

- **Auto-refresh**: Fetches new data every 5 minutes
- **Loading state**: Shows spinner while fetching
- **Error handling**: Returns null on error (fails silently)
- **Timezone-aware**: Converts UTC timestamps to user's local timezone
- **Dark mode**: Full support with appropriate color schemes
- **Tooltips**: Hover to see full details

## User Experience

### Benefits

1. **Transparency**: Users know when data was last updated
2. **Trust**: Clear indication of data freshness
3. **Decision-making**: Helps users understand if data is current enough for their needs

### Stale Data Warning

When data is > 24 hours old:
- Status changes to "very_stale" (red)
- Shows "(stale)" label in detailed variant
- `isStale: true` flag in API response

## Troubleshooting

### API Returns 401 Unauthorized
- **Cause**: User not logged in
- **Solution**: Ensure user is authenticated

### API Returns 500 Error
- **Cause**: BigQuery connection or query issue
- **Solution**: 
  - Check BigQuery credentials are configured
  - Verify `__TABLES__` query works in BigQuery console
  - Check server logs for specific error

### Timestamp Shows in UTC
- **Cause**: Browser timezone not detected
- **Solution**: `formatAbsoluteTime()` uses `toLocaleString()` which should automatically use browser timezone

### Component Doesn't Auto-refresh
- **Cause**: useEffect cleanup issue
- **Solution**: Verify `setInterval` is set to 5 * 60 * 1000 (5 minutes)

## Future Enhancements (Optional)

1. **Manual refresh button**: Allow users to manually refresh the timestamp
2. **Notification on stale**: Show toast/banner when data becomes stale
3. **Per-page freshness**: Track freshness for specific data types (leads vs opportunities)
4. **Admin visibility**: Show more details for admin users (individual table times, row counts)
