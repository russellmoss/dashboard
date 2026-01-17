# Savvy Funnel Analytics Dashboard

A Next.js 14 dashboard application that replaces Tableau for funnel analytics, providing real-time insights into lead conversion rates, pipeline performance, and team metrics.

## 🎯 Project Overview

This dashboard connects directly to BigQuery to visualize data from the `vw_funnel_master` view, which serves as the single source of truth for all funnel analytics. The application provides:

- **Real-time Funnel Metrics**: SQLs, SQOs, Joined advisors, and pipeline AUM
- **Full Funnel View**: Toggle between Focused View (SQL, SQO, Joined) and Full Funnel View (Prospects, Contacted, MQL, SQL, SQO, Joined)
- **Conversion Rate Analysis**: Track conversion rates across all funnel stages (Contacted→MQL→SQL→SQO→Joined)
- **Trend Visualization**: Monthly and quarterly trend charts for conversion rates and volumes
- **Channel & Source Performance**: Drill down into performance by marketing channel and lead source
- **Team Performance**: Filter and analyze performance by SGA (Sales Growth Advisor) and SGM (Sales Growth Manager)
- **SGA Hub**: Self-service dashboard for SGAs to track weekly goals, quarterly progress, and closed lost follow-ups
- **SGA Management**: Admin/Manager interface to view and manage all SGAs' goals and performance
- **Drill-Down Capabilities**: Click on any metric value to see underlying records, then click records to view full details
- **Data Export**: Export tables to CSV and Google Sheets
- **User Management**: Role-based access control with admin, manager, SGM, SGA, and viewer roles

## 📊 Data Source

The dashboard queries the `vw_funnel_master` BigQuery view (`savvy-gtm-analytics.Tableau_Views.vw_funnel_master`), which:

- **Joins Leads and Opportunities**: Combines Salesforce Lead and Opportunity data with proper deduplication
- **Handles Attribution**: Tracks SGA/SGM ownership at both lead and opportunity levels
- **Calculates Conversion Flags**: Pre-computes progression flags (contacted_to_mql_progression, mql_to_sql_progression, etc.)
- **Manages Eligibility**: Tracks which records are eligible for conversion rate calculations
- **Deduplicates Opportunities**: Ensures opportunity-level metrics (SQO, Joined, AUM) count once per opportunity

### Key Fields from `vw_funnel_master`:

- **Date Fields**: `FilterDate`, `stage_entered_contacting__c`, `converted_date_raw`, `Date_Became_SQO__c`, `advisor_join_date__c`
- **Conversion Flags**: `is_contacted`, `is_mql`, `is_sql`, `is_sqo`, `is_joined`
- **Progression Flags**: `contacted_to_mql_progression`, `mql_to_sql_progression`, `sql_to_sqo_progression`, `sqo_to_joined_progression`
- **Eligibility Flags**: `eligible_for_contacted_conversions`, `eligible_for_mql_conversions`, `eligible_for_sql_conversions`, `eligible_for_sqo_conversions`
- **Deduplication**: `is_sqo_unique`, `is_joined_unique`, `is_primary_opp_record`
- **Attribution**: `SGA_Owner_Name__c`, `SGM_Owner_Name__c`, `Original_source`, `Channel_Grouping_Name`

## 🏗️ Architecture

### Tech Stack

- **Framework**: Next.js 14 (App Router)
- **UI Components**: Tremor React (charts and tables), Recharts (trend charts)
- **Styling**: Tailwind CSS
- **Authentication**: NextAuth.js (Email/Password)
- **Database**: Google BigQuery
- **Deployment**: Vercel (ready)

### Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   │   ├── dashboard/     # Dashboard endpoints (funnel-metrics, conversion-rates, etc.)
│   │   ├── sga-hub/       # SGA Hub endpoints (weekly-goals, quarterly-progress, drill-down, etc.)
│   │   ├── admin/         # Admin endpoints (sga-overview, refresh-cache)
│   │   ├── cron/          # Cron endpoints (refresh-cache for scheduled invalidation)
│   │   ├── auth/          # Authentication endpoints
│   │   └── users/         # User management endpoints
│   ├── dashboard/         # Dashboard pages
│   │   ├── page.tsx       # Main Funnel Performance dashboard
│   │   ├── sga-hub/       # SGA Hub page (for SGA role)
│   │   ├── sga-management/# SGA Management page (for admin/manager)
│   │   └── settings/      # Settings page
│   └── login/             # Authentication page
├── components/
│   ├── dashboard/         # Dashboard-specific components (Scorecards, Charts, Tables, RecordDetailModal)
│   ├── sga-hub/           # SGA Hub components (WeeklyGoalsTable, QuarterlyProgressCard, MetricDrillDownModal, etc.)
│   ├── layout/            # Header, Sidebar, Navigation
│   ├── settings/          # User management components
│   └── ui/                # Reusable UI components
├── lib/
│   ├── queries/           # BigQuery query functions (all wrapped with caching)
│   │   ├── conversion-rates.ts
│   │   ├── funnel-metrics.ts
│   │   ├── source-performance.ts
│   │   ├── drill-down.ts  # Drill-down queries
│   │   ├── weekly-actuals.ts
│   │   ├── quarterly-progress.ts
│   │   └── closed-lost.ts
│   ├── cache.ts           # Caching utilities (cachedQuery, CACHE_TAGS, TTL constants)
│   ├── sheets/            # Google Sheets export functionality
│   ├── utils/             # Helper functions (date formatting, CSV export, SGA Hub helpers)
│   ├── bigquery.ts        # BigQuery client
│   ├── auth.ts            # NextAuth configuration
│   ├── api-client.ts      # API client for frontend
│   └── users.ts           # User management
├── types/                 # TypeScript type definitions
│   ├── dashboard.ts
│   ├── sga-hub.ts
│   ├── drill-down.ts      # Drill-down type definitions
│   └── filters.ts
└── config/                # Constants (table names, record types)
```

## 🚀 Caching Strategy

This dashboard implements a multi-layer caching strategy using Next.js `unstable_cache()` to improve performance and reduce BigQuery costs.

### Why We Cache

1. **Performance**: BigQuery queries can take 2-5 seconds. Caching reduces response times to <100ms for cached requests
2. **Cost Reduction**: BigQuery charges per query. Caching reduces query volume by ~95% during cache hit periods
3. **User Experience**: Faster page loads and smoother interactions
4. **Scalability**: Reduces load on BigQuery during peak usage

### How It Works

The caching system uses **Next.js `unstable_cache()`** with **tag-based invalidation**:

- **Cache Layer**: All query functions in `src/lib/queries/` are wrapped with `cachedQuery()`
- **Cache Keys**: Automatically generated from function name + parameters (different filters = different cache entries)
- **Cache Tags**: Two tags for organized invalidation:
  - `dashboard` - Main dashboard routes (funnel-metrics, conversion-rates, source-performance, etc.)
  - `sga-hub` - SGA Hub routes (weekly-actuals, quarterly-progress, closed-lost, etc.)
- **TTL (Time To Live)**:
  - **Standard routes**: 12 hours (`DEFAULT_CACHE_TTL`)
  - **Detail records**: 6 hours (`DETAIL_RECORDS_TTL`) - shorter due to large result sets

### What's Cached

✅ **Cached** (all query functions):
- Funnel metrics (SQLs, SQOs, Joined, AUM)
- Conversion rates (scorecard + trend data)
- Channel and source performance
- Detail records (with 6-hour TTL)
- Weekly actuals
- Quarterly progress
- Closed lost records
- Drill-down queries

❌ **Not Cached**:
- `agent-query.ts` - AI agent dynamic SQL exploration (must always be fresh)
- `export-records.ts` - Export operations (user-specific, real-time)
- User management endpoints
- Authentication endpoints

### Cache Invalidation

The cache is automatically invalidated to ensure data freshness:

1. **Automatic Daily**: 12 AM EST (after 11:30 PM daily BigQuery transfer)
   - Runs via Vercel Cron: `0 5 * * *` (5 AM UTC = 12 AM EST)
   - Ensures morning users always get fresh data

2. **Manual Admin Refresh**: 
   - Admin users see a refresh button in the header (compact variant) and filters section (detailed variant)
   - Calls `POST /api/admin/refresh-cache` to invalidate all cache tags
   - Useful for testing or when data needs immediate refresh

3. **API Endpoint**: `POST /api/admin/refresh-cache` (admin only)
   - Invalidates both `dashboard` and `sga-hub` cache tags
   - Returns success/error status

### Implementation Details

**Adding Caching to New Query Functions**:

```typescript
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

// Internal function (not exported)
const _getMyData = async (filters: MyFilters): Promise<MyData> => {
  // ... query logic
};

// Export cached version
export const getMyData = cachedQuery(
  _getMyData,
  'getMyData',           // Explicit key name (required)
  CACHE_TAGS.DASHBOARD   // Or CACHE_TAGS.SGA_HUB
  // Optional: DETAIL_RECORDS_TTL for large result sets
);
```

**Cache Behavior**:
- Different filter combinations automatically get different cache keys
- Same filters = cache hit (fast response)
- Different filters = cache miss (queries BigQuery, then caches result)
- Cache misses are logged for monitoring

**Monitoring**:
- Cache misses are logged with `[Cache Miss]` prefix
- Check logs to see cache hit rates and identify frequently missed queries

## ✅ Current Status

### Completed Phases

- ✅ **Phase 1**: Project setup and infrastructure
- ✅ **Phase 2**: BigQuery connection layer with parameterized queries
- ✅ **Phase 3**: Authentication and permissions system
- ✅ **Phase 4**: All API routes (funnel-metrics, conversion-rates, source-performance, detail-records, forecast, open-pipeline, filters)
- ✅ **Phase 5**: All dashboard components (Scorecards, ConversionRateCards, ConversionTrendChart, tables, filters)
- ✅ **Phase 6**: Main dashboard page with data fetching and state management
- ✅ **Phase 6.5**: Post-implementation enhancements (pagination, sorting, multi-field search, Full Funnel View badges, MQLs/goal columns)
- ✅ **Phase 7**: Integration testing and verification
- ✅ **Phase 8**: Tech debt cleanup and documentation updates
- ✅ **Phase 9**: SGA Hub feature (weekly goals, quarterly progress, closed lost follow-ups)
- ✅ **Phase 10**: SGA Management feature (admin/manager interface for SGA oversight)
- ✅ **Phase 11**: Drill-down feature (clickable metrics with record detail integration)
- ✅ **Phase 12**: Google Sheets export functionality

### Known Issues

_No known issues at this time._

## 🎯 Goals & Objectives

### Primary Goals

1. **Replace Tableau Dependencies**: Provide a self-hosted, customizable alternative to Tableau dashboards
2. **Real-time Data Access**: Direct BigQuery integration for up-to-date metrics without manual refreshes
3. **Role-based Access**: Secure access control with different permission levels (admin, manager, SGM, SGA, viewer)
4. **Performance Tracking**: Monitor conversion rates across all funnel stages with trend analysis
5. **Team Analytics**: Enable SGA and SGM filtering to track individual and team performance

### Conversion Rate Tracking

The dashboard tracks four key conversion rates, each tied to specific date dimensions:

1. **Contacted → MQL**: Based on `stage_entered_contacting__c`
   - Numerator: Leads that became MQL (`is_mql = 1`)
   - Denominator: All leads that were contacted

2. **MQL → SQL**: Based on `converted_date_raw` (numerator) and `stage_entered_contacting__c` (denominator)
   - Numerator: SQLs that converted (`is_sql = 1`)
   - Denominator: MQLs that became MQLs in the period

3. **SQL → SQO**: Based on `Date_Became_SQO__c` (numerator) and `converted_date_raw` (denominator)
   - Numerator: SQOs that became SQO (`is_sqo_unique = 1`, recruiting record type)
   - Denominator: SQLs that converted in the period

4. **SQO → Joined**: Based on `advisor_join_date__c` (numerator) and `Date_Became_SQO__c` (denominator)
   - Numerator: Advisors that joined (`is_joined_unique = 1`)
   - Denominator: SQOs that became SQO in the period

### Key Metrics

- **Volume Metrics**: SQLs, SQOs, Joined advisors
- **Pipeline Metrics**: Open Pipeline AUM, Joined AUM
- **Conversion Rates**: All four stage-to-stage conversion rates
- **Channel Performance**: Performance breakdown by marketing channel
- **Source Performance**: Performance breakdown by lead source

### SGA Hub Features

The SGA Hub provides a self-service dashboard for Sales Growth Advisors to track their performance:

- **Weekly Goals Tracking**: Set and track weekly goals for Initial Calls, Qualification Calls, and SQOs
- **Weekly Goals vs Actuals**: Compare goals to actual performance with visual indicators (green = ahead, red = behind)
- **Quarterly Progress**: Track quarterly SQO goals with pacing calculations (ahead/on-track/behind)
- **Closed Lost Follow-ups**: View closed lost opportunities organized by time since last contact (30-60 days, 60-90 days, etc.)
- **SQO Details**: Detailed view of all SQOs in the current quarter with AUM, channel, and source information
- **Drill-Down Capabilities**: Click on any metric value to see underlying records, then click records to view full details
- **Data Export**: Export weekly goals, quarterly progress, and closed lost data to CSV

### SGA Management Features

The SGA Management page (Admin/Manager only) provides oversight of all SGAs:

- **SGA Overview Table**: View all SGAs' current week and quarter performance at a glance
- **Goal Management**: Set weekly and quarterly goals for individual SGAs or in bulk
- **Drill-Down Access**: Click on any metric value to drill down into underlying records
- **Record Detail Integration**: Click on drill-down records to view full opportunity/lead details
- **Improved Readability**: Full metric names (Initial Calls, Qualification Calls) instead of abbreviations
- **Enhanced UX**: Clickable metric values with hover effects for better interactivity

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- Google Cloud service account with BigQuery access
- Access to `savvy-gtm-analytics` BigQuery project

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/russellmoss/dashboard.git
   cd dashboard
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env.local` file:
   ```env
   NEXTAUTH_SECRET=your-secret-here
   NEXTAUTH_URL=http://localhost:3000
   GCP_PROJECT_ID=savvy-gtm-analytics
   GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account-key.json
   ```

4. **Run the development server**:
   ```bash
   npm run dev
   ```

5. **Open your browser**:
   Navigate to `http://localhost:3000`

### Default Login

- **Email**: `russell.moss@savvywealth.com`
- **Password**: `Savvy1234!`
- **Role**: Admin (full access)

## 📝 Development

### Key Files

- **Query Functions**: 
  - `src/lib/queries/conversion-rates.ts` - Conversion rate queries
  - `src/lib/queries/drill-down.ts` - Drill-down record queries
  - `src/lib/queries/weekly-actuals.ts` - Weekly actuals queries
  - `src/lib/queries/quarterly-progress.ts` - Quarterly progress queries
- **Dashboard Pages**: 
  - `src/app/dashboard/page.tsx` - Main Funnel Performance dashboard
  - `src/app/dashboard/sga-hub/page.tsx` - SGA Hub (for SGA role)
  - `src/app/dashboard/sga-management/page.tsx` - SGA Management (for admin/manager)
- **API Routes**: 
  - `src/app/api/dashboard/*` - Dashboard endpoints
  - `src/app/api/sga-hub/*` - SGA Hub endpoints (weekly-goals, quarterly-progress, drill-down, etc.)
- **Components**: 
  - `src/components/dashboard/*` - Dashboard components (Scorecards, Charts, RecordDetailModal)
  - `src/components/sga-hub/*` - SGA Hub components (WeeklyGoalsTable, MetricDrillDownModal, etc.)

### Building

```bash
npm run build
```

### Testing

The dashboard has been tested against Q4 2025 data with the following expected values:
- SQLs: 193
- SQOs: 144
- Joined: 17
- Open Pipeline AUM: ~$12.3B

## 🔒 Security

- **Authentication**: Email/password authentication with bcrypt password hashing
- **Authorization**: Role-based access control (admin, manager, SGM, SGA, viewer)
- **Data Filtering**: Automatic SGA/SGM filtering based on user permissions
- **SQL Injection Protection**: All queries use BigQuery parameterized queries
- **Sensitive Data**: User credentials and service account keys are excluded from version control

## 📚 Documentation

- **[Build Instructions](./docs/savvy-dashboard-build-instructions.md)**: Comprehensive guide for building and deploying the dashboard
- **[BigQuery View](./vw_funnel_master.sql)**: SQL definition of the `vw_funnel_master` view
- **[SGA Hub Implementation](./docs/SGA_HUB_IMPLEMENTATION.md)**: SGA Hub feature implementation guide
- **[SGA Management Upgrade](./SGA_MGMT_UPGRADE_IMPLEMENTATION.md)**: Drill-down feature implementation guide
- **[Ground Truth](./docs/GROUND-TRUTH.md)**: Verified values for calculation validation
- **[Glossary](./docs/GLOSSARY.md)**: Business definitions and terminology
- **[Calculations](./docs/CALCULATIONS.md)**: Detailed calculation formulas

## 🐛 Known Issues

_No known issues at this time._

## 🔮 Future Enhancements

- Add forecast comparison charts
- Create additional dashboard pages (Channel Drilldown, Open Pipeline, Partner Performance, Experimentation)
- Add pagination to drill-down modals (if records exceed 100)
- Add filtering/sorting within drill-down modals
- Add cache hit rate monitoring dashboard

## 📄 License

Proprietary - Savvy Wealth Internal Use Only

## 👥 Contributors

- Russell Moss - Initial development

## 🔗 Links

- **Repository**: https://github.com/russellmoss/dashboard
- **BigQuery Project**: `savvy-gtm-analytics`
- **Main View**: `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`

---

**Last Updated**: January 2026  
**Status**: All core phases complete (1-12), Full Funnel View implemented, SGA Hub & SGA Management implemented, Drill-Down feature complete, Caching implementation complete
