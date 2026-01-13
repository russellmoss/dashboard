# Savvy Funnel Analytics Dashboard

A Next.js 14 dashboard application that replaces Tableau for funnel analytics, providing real-time insights into lead conversion rates, pipeline performance, and team metrics.

## 🎯 Project Overview

This dashboard connects directly to BigQuery to visualize data from the `vw_funnel_master` view, which serves as the single source of truth for all funnel analytics. The application provides:

- **Real-time Funnel Metrics**: SQLs, SQOs, Joined advisors, and pipeline AUM
- **Conversion Rate Analysis**: Track conversion rates across all funnel stages (Contacted→MQL→SQL→SQO→Joined)
- **Trend Visualization**: Monthly and quarterly trend charts for conversion rates and volumes
- **Channel & Source Performance**: Drill down into performance by marketing channel and lead source
- **Team Performance**: Filter and analyze performance by SGA (Sales Growth Advisor) and SGM (Sales Growth Manager)
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
│   ├── api/               # API routes (dashboard endpoints, auth, users)
│   ├── dashboard/         # Main dashboard page and settings
│   └── login/             # Authentication page
├── components/
│   ├── dashboard/         # Dashboard-specific components
│   ├── layout/            # Header, Sidebar, Navigation
│   ├── settings/          # User management components
│   └── ui/                # Reusable UI components
├── lib/
│   ├── queries/           # BigQuery query functions
│   ├── utils/             # Helper functions (date formatting, CSV export)
│   ├── bigquery.ts        # BigQuery client
│   ├── auth.ts            # NextAuth configuration
│   └── users.ts           # User management
├── types/                 # TypeScript type definitions
└── config/                # Constants (table names, record types)
```

## ✅ Current Status

### Completed Phases

- ✅ **Phase 1**: Project setup and infrastructure
- ✅ **Phase 2**: BigQuery connection layer with parameterized queries
- ✅ **Phase 3**: Authentication and permissions system
- ✅ **Phase 4**: All API routes (funnel-metrics, conversion-rates, source-performance, detail-records, forecast, open-pipeline, filters)
- ✅ **Phase 5**: All dashboard components (Scorecards, ConversionRateCards, ConversionTrendChart, tables, filters)
- ✅ **Phase 6**: Main dashboard page with data fetching and state management

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

- **Query Functions**: `src/lib/queries/conversion-rates.ts` - Contains both scorecard and trend chart queries
- **Dashboard Page**: `src/app/dashboard/page.tsx` - Main dashboard with data fetching
- **API Routes**: `src/app/api/dashboard/*` - Backend endpoints for data retrieval
- **Components**: `src/components/dashboard/*` - Reusable dashboard components

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

## 🐛 Known Issues

_No known issues at this time._

## 🔮 Future Enhancements

- Add forecast comparison charts
- Implement caching for API routes
- Add export functionality for all tables
- Create additional dashboard pages (Channel Drilldown, Open Pipeline, Partner Performance, Experimentation, SGA Performance)

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
**Status**: Phase 5 & 6 Complete
