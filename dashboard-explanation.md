# Savvy Wealth GTM Dashboard: A Deep Dive into AI-Powered Analytics Architecture

> Built in one week using "vibe coding" with Claude Code and Cursor.ai, this dashboard demonstrates how modern AI-assisted development can rapidly deliver enterprise-grade analytics solutions.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Security & Authentication](#security--authentication)
3. [BigQuery Integration & Data Pipeline](#bigquery-integration--data-pipeline)
4. [Intelligent Caching Strategy](#intelligent-caching-strategy)
5. [View Management with Cursor.ai MCP](#view-management-with-cursorai-mcp)
6. [Semantic Layer & AI Integration](#semantic-layer--ai-integration)
7. [Neon Database & Data Persistence](#neon-database--data-persistence)
8. [Visualization with Tremor & Recharts](#visualization-with-tremor--recharts)
9. [Drilldown Capabilities](#drilldown-capabilities)
10. [Salesforce Integration](#salesforce-integration)
11. [Geographic Visualization (Map Feature)](#geographic-visualization-map-feature)
12. [Metabase Integration (Self-Serve Chart Builder)](#metabase-integration-self-serve-chart-builder)
13. [The Vibe Coding Philosophy](#the-vibe-coding-philosophy)
14. [The Before: Why Build Instead of Buy](#the-before-why-build-instead-of-buy)
15. [The Builder: From Farmer to Full-Stack](#the-builder-from-farmer-to-full-stack)
16. [The Workflow: How Claude Code and Cursor.ai Work Together](#the-workflow-how-claude-code-and-cursorai-work-together)
17. [Failures, Dead Ends, and Debugging with AI](#failures-dead-ends-and-debugging-with-ai)
18. [Quantifiable Outcomes](#quantifiable-outcomes)
19. [Target Audience & Publication](#target-audience--publication)

---

## Architecture Overview

The Savvy Wealth GTM Dashboard is a Next.js 14 application that serves as a comprehensive analytics platform for go-to-market operations. The architecture follows a modern, serverless-first approach:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                        │
│  Next.js App Router │ Tremor UI │ Recharts │ React-Leaflet │ Server Components  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER                                           │
│  NextAuth JWT │ Role-Based Access │ Rate Limiting │ API Routes │ Middleware     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│    SEMANTIC LAYER    │  │    CACHE LAYER       │  │    QUERY LAYER       │
│  Claude AI (Sonnet)  │  │  Next.js unstable    │  │  Parameterized SQL   │
│  Template Selection  │  │  _cache + TTL        │  │  Row-Level Security  │
│  Natural Language    │  │  Tag Invalidation    │  │  Dynamic Filtering   │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘
                    │                   │                   │
                    └───────────────────┼───────────────────┘
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                          │
│  Google BigQuery (Analytics) │ Neon PostgreSQL (App Data) │ Upstash Redis       │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL INTEGRATIONS                                  │
│  Salesforce (CRM) │ Metabase (Self-Serve) │ SendGrid │ Wrike │ Google Sheets    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Tech Stack:**
- **Frontend**: Next.js 14 (App Router), React 18, TypeScript
- **UI Components**: Tremor React, Recharts, Tailwind CSS
- **Authentication**: NextAuth.js with JWT sessions
- **Primary Database**: Google BigQuery (analytics data warehouse)
- **App Database**: Neon PostgreSQL (users, sessions, saved reports)
- **ORM**: Prisma
- **AI**: Anthropic Claude API (Sonnet model)
- **Caching**: Next.js `unstable_cache` with tag-based invalidation
- **Rate Limiting**: Upstash Redis
- **Maps**: Leaflet + React-Leaflet
- **Deployment**: Vercel

---

## Security & Authentication

### Multi-Provider Authentication

The dashboard implements enterprise-grade authentication via NextAuth.js with dual authentication providers:

**1. Google OAuth (Primary)**
```typescript
// Restricted to company domain for security
GoogleProvider({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  authorization: {
    params: {
      hd: 'savvywealth.com', // Domain restriction
      login_hint: '@savvywealth.com'
    }
  }
})
```

**2. Credentials Provider (Backup)**
- Email/password authentication with bcryptjs hashing
- Rate-limited: 5 attempts per 15 minutes via Upstash Redis
- Password reset flow via SendGrid email

### JWT Session Strategy

Sessions are managed via JWT tokens with a 24-hour maximum age, embedding user data directly in the token to minimize database queries:

```typescript
jwt: async ({ token, user, trigger }) => {
  if (user) {
    token.id = user.id;
    token.email = user.email;
    token.name = user.name;
    token.role = user.role;
    token.externalAgency = user.externalAgency;
  }
  return token;
}
```

The session callback derives permissions directly from the JWT, eliminating the need for database lookups on every request—a critical performance optimization.

### Role-Based Access Control (RBAC)

The system implements granular role-based permissions defined in `/src/lib/permissions.ts`:

| Role | Dashboard Pages | Export | Manage Users | Manage Requests |
|------|----------------|--------|--------------|-----------------|
| `revops_admin` | Full access (pages 1,3,7-15) | ✓ | ✓ | ✓ |
| `admin` | Most pages (excludes Chart Builder) | ✓ | ✓ | ✗ |
| `manager` | Same as admin | ✓ | ✗ | ✗ |
| `sgm` | Limited (1,3,7,10,13,15) | ✓ | ✗ | ✗ |
| `sga` | Sales-focused (1,3,7,8,10,11,13,15) | ✓ | ✗ | ✗ |
| `viewer` | Read-only (1,3,7,10,13,15) | ✗ | ✗ | ✗ |
| `recruiter` | Recruiter Hub only (7,12) | ✓ | ✗ | ✗ |

### Row-Level Security

Data filtering is automatically applied based on user role:

```typescript
// SGA users see only their own leads/opportunities
if (role === 'sga') {
  filters.sga = user.name; // Maps to SGA_Owner_Name__c in Salesforce
}

// SGM users see their team's data
if (role === 'sgm') {
  filters.sgm = user.name; // Maps to SGM_Owner_Name__c in Salesforce
}

// Recruiters see only their external agency's data
if (role === 'recruiter') {
  filters.externalAgency = user.externalAgency; // Maps to External_Agency__c
}
```

### Defense-in-Depth Middleware

API routes implement multiple security layers:

```typescript
// /src/lib/api-authz.ts
export function forbidRecruiter(session: Session | null): NextResponse | null {
  if (session?.user?.role === 'recruiter') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}
```

---

## BigQuery Integration & Data Pipeline

### Connection Architecture

BigQuery serves as the primary analytics data warehouse, with a singleton connection pattern for efficiency:

```typescript
// /src/lib/bigquery.ts
let bigQueryClient: BigQuery | null = null;

export function getBigQueryClient(): BigQuery {
  if (!bigQueryClient) {
    // Dual credential support for local dev vs. Vercel production
    const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
      ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
      : undefined;

    bigQueryClient = new BigQuery({
      projectId: process.env.BIGQUERY_PROJECT_ID,
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/bigquery',
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/drive' // For external tables
      ]
    });
  }
  return bigQueryClient;
}
```

### Core Data Views

The dashboard queries several key views in BigQuery:

| View | Purpose |
|------|---------|
| `vw_funnel_master` | Master view containing all funnel stages, Salesforce IDs, dates, eligibility flags, and channel mappings |
| `vw_daily_forecast` | Daily forecast data for trending analysis |
| `q4_2025_forecast` | Quarterly forecast goals and targets |
| `new_mapping` | Channel and source mapping reference data |

### Parameterized Queries

All queries use parameterized inputs to prevent SQL injection and improve cache efficiency:

```typescript
export async function runQuery<T>(
  query: string,
  params?: Record<string, any>
): Promise<T[]> {
  const client = getBigQueryClient();
  const options = {
    query,
    params,
    location: 'US',
  };
  const [rows] = await client.query(options);
  return rows as T[];
}

// Example usage with dynamic filtering
const { conditions, params } = buildQueryParams(filters);
const query = `
  SELECT COUNT(*) as count
  FROM \`${FULL_TABLE}\`
  WHERE Date_Became_MQL__c IS NOT NULL
  ${conditions}
`;
return runQuery<{ count: number }>(query, params);
```

---

## Intelligent Caching Strategy

### Cost Optimization Through Caching

BigQuery charges per query based on data scanned. The dashboard implements aggressive caching to minimize costs while maintaining data freshness:

```typescript
// /src/lib/cache.ts
const DEFAULT_CACHE_TTL = 14400; // 4 hours
const DETAIL_RECORDS_TTL = 7200; // 2 hours for large result sets

export function cachedQuery<T extends (...args: any[]) => Promise<any>>(
  queryFn: T,
  keyName: string,
  tag: string
): T {
  return unstable_cache(
    queryFn,
    [keyName],
    {
      revalidate: DEFAULT_CACHE_TTL,
      tags: [tag]
    }
  ) as T;
}
```

### TTL Strategy

The cache TTL is carefully calibrated to the data pipeline:

- **4-hour TTL**: Shorter than the 6-hour BigQuery data transfer interval, ensuring fresh data after each sync
- **10-minute buffer**: Cron job refreshes cache 10 minutes after data transfer completes
- **2-hour TTL for large datasets**: Detail records (up to 95k rows) use shorter TTL to balance memory usage

### Cache Key Generation

Cache keys are automatically generated from function arguments, meaning different filter combinations maintain separate cache entries:

```typescript
// Different users with different filters hit different cache entries
export const getFunnelMetrics = cachedQuery(
  async (filters: DashboardFilters) => {
    // Query logic
  },
  'getFunnelMetrics',
  CACHE_TAGS.DASHBOARD
);
```

### Tag-Based Invalidation

Cache tags enable surgical invalidation:

```typescript
// /src/app/api/admin/refresh-cache/route.ts
export async function POST() {
  revalidateTag(CACHE_TAGS.DASHBOARD);
  revalidateTag(CACHE_TAGS.SGA_HUB);
  return NextResponse.json({ success: true });
}
```

---

## View Management with Cursor.ai MCP

### The Ultimate Business Context Advantage

One of the most powerful aspects of our architecture is that **BigQuery view definitions live directly in our codebase**. This means Cursor.ai has complete visibility into:

1. The SQL logic that transforms raw Salesforce data
2. All business rules encoded in CASE statements
3. Date calculations and cohort definitions
4. Channel/source mapping logic

### How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CURSOR.AI IDE                               │
│                                                                     │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐ │
│  │  View SQL Files │───▶│   Claude LLM    │───▶│  MCP Connection │ │
│  │  (in codebase)  │    │  (understands   │    │  to BigQuery    │ │
│  │                 │    │   full context) │    │                 │ │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘ │
│                                                         │          │
└─────────────────────────────────────────────────────────│──────────┘
                                                          │
                                                          ▼
                                              ┌─────────────────────┐
                                              │  Google BigQuery    │
                                              │  (Views Updated)    │
                                              └─────────────────────┘
```

### Benefits of This Approach

1. **Full Business Context**: The LLM understands not just the dashboard code, but the underlying data transformations
2. **Rapid Iteration**: Changes to views can be made, tested, and deployed within minutes
3. **Consistency**: View logic and dashboard code stay in sync because they're in the same repository
4. **Precision**: Claude can make surgical SQL changes because it sees the complete picture

### Example: Modifying a View

When a business requirement changes (e.g., "we need to add Lead Score Tier to the funnel metrics"), the workflow is:

1. Ask Cursor.ai to modify the view definition
2. Claude understands the existing schema and proposes the exact SQL change
3. Deploy via MCP connection to BigQuery
4. Update the TypeScript types and queries in the same session
5. The entire change is coherent and tested

---

## Semantic Layer & AI Integration

### Architecture Overview

The semantic layer translates natural language questions into SQL queries via Claude AI:

```typescript
// /src/lib/semantic-layer/agent-prompt.ts
const SYSTEM_PROMPT = `You are a GTM analytics assistant. Given a user question,
select the appropriate query template and parameters.

Available Metrics:
- prospects: Count of new prospects
- contacted: Count of contacted leads
- mqls: Marketing Qualified Leads
- sqls: Sales Qualified Leads
- sqos: Sales Qualified Opportunities
- joined: Closed-won deals
- aum: Assets Under Management

Available Dimensions:
- channel: Marketing channel (Paid, Organic, Referral, etc.)
- source: Traffic source
- sga_owner: Sales Growth Associate
- sgm_owner: Sales Growth Manager
...
`;
```

### Query Templates

The semantic layer supports 9 query templates:

| Template | Description | Visualization |
|----------|-------------|---------------|
| `single_metric` | Single KPI value | Metric Card |
| `metric_by_dimension` | Breakdown by channel/source | Bar Chart |
| `conversion_by_dimension` | Conversion rates by dimension | Bar Chart |
| `time_series` | Trend over time | Line Chart |
| `period_comparison` | Cohort mode conversions | Grouped Bar |
| `leaderboard` | Rankings by metric | Table |
| `funnel_stages` | Funnel progression | Funnel Chart |
| `distribution` | Value distribution | Histogram |
| `unsupported` | Out-of-scope questions | Error Message |

### The Query Flow

```typescript
// /src/app/api/agent/query/route.ts
export async function POST(request: Request) {
  // 1. Authenticate
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();

  // 2. Extract question
  const { question } = await request.json();

  // 3. Call Claude for template selection
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SEMANTIC_LAYER_PROMPT,
    messages: [{ role: 'user', content: question }]
  });

  // 4. Compile template to SQL
  const sql = compileQuery(templateSelection);

  // 5. Execute against BigQuery
  const results = await runQuery(sql);

  // 6. Determine visualization
  const visualization = determineVisualization(templateSelection, results.length);

  // 7. Return response with data and chart type
  return NextResponse.json({ data: results, visualization, sql });
}
```

### Streaming Responses

For real-time feedback, the API supports Server-Sent Events:

```typescript
// Streaming chunks provide progressive feedback
const chunks = [
  { type: 'thinking', content: 'Analyzing question...' },
  { type: 'template_selected', content: 'Using time_series template' },
  { type: 'query_compiled', content: sql },
  { type: 'executing', content: 'Running query...' },
  { type: 'result', content: { data, visualization } },
  { type: 'complete' }
];
```

---

## Neon Database & Data Persistence

### Why Neon PostgreSQL?

While BigQuery handles analytics, Neon PostgreSQL serves as the application database for:

- **User Management**: Accounts, roles, permissions
- **Session Storage**: NextAuth sessions and tokens
- **Saved Reports**: User-created report configurations
- **Password Reset Tokens**: Secure token storage with expiration
- **Game Scores**: Gamification features for team engagement

### Prisma Schema

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL") // Neon pooled connection
}

model User {
  id             String    @id @default(cuid())
  email          String    @unique
  name           String?
  password       String?
  role           Role      @default(viewer)
  externalAgency String?   // For recruiter row-level security
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  accounts       Account[]
  sessions       Session[]
  savedReports   SavedReport[]
}

enum Role {
  revops_admin
  admin
  manager
  sgm
  sga
  viewer
  recruiter
}
```

### Connection Pooling for Serverless

Neon's pooled connections are essential for Vercel's serverless architecture:

```typescript
// /src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

---

## Visualization with Tremor & Recharts

### Dual Library Strategy

The dashboard uses two complementary visualization libraries:

**Tremor React** - For metric cards and KPI displays:
```tsx
<Card>
  <Text>Total MQLs</Text>
  <Metric>{formatNumber(metrics.mqls)}</Metric>
  <BadgeDelta deltaType={metrics.mqlDelta > 0 ? 'increase' : 'decrease'}>
    {metrics.mqlDelta}%
  </BadgeDelta>
</Card>
```

**Recharts** - For complex interactive charts:
```tsx
<ResponsiveContainer width="100%" height={400}>
  <ComposedChart data={trendData}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="month" />
    <YAxis yAxisId="left" />
    <YAxis yAxisId="right" orientation="right" />
    <Tooltip />
    <Legend />
    <Bar yAxisId="left" dataKey="sqls" fill="#8884d8" />
    <Line yAxisId="right" dataKey="conversionRate" stroke="#82ca9d" />
  </ComposedChart>
</ResponsiveContainer>
```

### Theme Support

Full dark/light mode support via next-themes:

```typescript
// /src/config/theme.ts
export const CHART_COLORS = {
  light: {
    primary: '#3B82F6',
    secondary: '#10B981',
    accent: '#F59E0B',
    // ...
  },
  dark: {
    primary: '#60A5FA',
    secondary: '#34D399',
    accent: '#FBBF24',
    // ...
  }
};
```

---

## Drilldown Capabilities

### From Aggregates to Individual Records

Every metric in the dashboard can be drilled down to see the underlying records:

```tsx
// /src/components/dashboard/VolumeDrillDownModal.tsx
<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
    <DialogHeader>
      <DialogTitle>
        {metricName} Detail Records ({records.length} total)
      </DialogTitle>
    </DialogHeader>
    <DetailRecordsTable
      records={records}
      onRecordClick={handleRecordClick}
    />
  </DialogContent>
</Dialog>
```

### Click-to-Drill Pattern

1. **Click a bar** in a chart → Opens modal with filtered records
2. **Click a metric card** → Shows all records that make up that number
3. **Click a table row** → Opens full record detail modal

### Record Detail Modal

The detail modal shows comprehensive information:

```tsx
// /src/components/dashboard/RecordDetailModal.tsx
<div className="grid grid-cols-2 gap-4">
  <div>
    <h3>Contact Information</h3>
    <p>Name: {record.advisorName}</p>
    <p>Email: {record.email}</p>
    <p>Phone: {record.phone}</p>
  </div>
  <div>
    <h3>Funnel Progress</h3>
    <FunnelProgressIndicator stages={record.stages} />
  </div>
  <div>
    <h3>AUM Information</h3>
    <p>Stated AUM: {formatCurrency(record.statedAum)}</p>
    <p>Opportunity AUM: {formatCurrency(record.opportunityAum)}</p>
  </div>
</div>
```

---

## Salesforce Integration

### Bidirectional Data Flow

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   Salesforce    │────────▶│   BigQuery      │────────▶│   Dashboard     │
│   (Source of    │  Fivetran│   (Data         │  API    │   (Visualize    │
│    Truth)       │  Sync    │    Warehouse)   │  Query  │    & Analyze)   │
└─────────────────┘         └─────────────────┘         └─────────────────┘
        ▲                                                        │
        │                                                        │
        └────────────────── Direct Links ────────────────────────┘
```

### Direct Salesforce Record Links

Every record in the dashboard links back to Salesforce:

```typescript
// /src/types/record-detail.ts
interface RecordDetail {
  id: string;
  fullProspectId: string | null;     // Salesforce Lead ID
  fullOpportunityId: string | null;  // Salesforce Opportunity ID
  // Computed URLs
  leadUrl?: string;
  opportunityUrl?: string;
  salesforceUrl?: string;
}

// URL construction
const getSalesforceUrl = (record: RecordDetail) => {
  const baseUrl = 'https://savvywealth.lightning.force.com';
  if (record.fullOpportunityId) {
    return `${baseUrl}/${record.fullOpportunityId}`;
  }
  if (record.fullProspectId) {
    return `${baseUrl}/${record.fullProspectId}`;
  }
  return null;
};
```

### AI Explore → Salesforce

The AI Explore feature also provides Salesforce links in results:

```tsx
// When AI returns individual records, each row includes a Salesforce link
<Table>
  {results.map(row => (
    <TableRow key={row.id}>
      <TableCell>{row.advisorName}</TableCell>
      <TableCell>{row.status}</TableCell>
      <TableCell>
        <a href={row.salesforceUrl} target="_blank" rel="noopener">
          Open in Salesforce →
        </a>
      </TableCell>
    </TableRow>
  ))}
</Table>
```

---

## Geographic Visualization (Map Feature)

### Advisor Location Mapping

The dashboard includes an interactive map showing advisor locations across the United States:

```tsx
// /src/components/advisor-map/AdvisorMapClient.tsx
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';

export function AdvisorMapClient({ advisors }: { advisors: AdvisorLocation[] }) {
  return (
    <MapContainer
      center={[39.8283, -98.5795]} // Continental US center
      zoom={4}
      style={{ height: '600px', width: '100%' }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors'
      />
      {advisors.map(advisor => (
        <Marker
          key={advisor.id}
          position={[advisor.latitude, advisor.longitude]}
          icon={getMarkerIcon(advisor.geocodingAccuracy)}
        >
          <Popup>
            <AdvisorPopupContent advisor={advisor} />
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
```

### Geocoding Accuracy Indicators

Markers are color-coded based on geocoding precision:

| Accuracy Level | Color | Meaning |
|---------------|-------|---------|
| ROOFTOP | Blue | Exact address match |
| RANGE_INTERPOLATED | Blue | Street-level accuracy |
| GEOMETRIC_CENTER | Orange | City-level approximation |
| APPROXIMATE | Orange | Region-level estimate |

### Interactive Features

- **Click markers** to see advisor details in a popup
- **Auto-fit bounds** to zoom to visible advisors
- **Drilldown** from map markers to full record details
- **Address editing** for manual geocoding corrections

---

## Metabase Integration (Self-Serve Chart Builder)

### Embedded Analytics

The dashboard integrates Metabase for self-serve chart building, allowing RevOps to create ad-hoc visualizations without developer involvement:

```typescript
// /src/lib/metabase.ts
export function getDashboardEmbedUrl(
  dashboardId: number,
  params: Record<string, any> = {},
  theme: 'light' | 'dark' = 'light'
): string {
  const token = jwt.sign(
    {
      resource: { dashboard: dashboardId },
      params,
      exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
    },
    METABASE_SECRET_KEY,
    { algorithm: 'HS256' }
  );

  return `${METABASE_SITE_URL}/embed/dashboard/${token}#theme=${theme}`;
}
```

### JWT-Based Security

Metabase embeds use signed JWT tokens:

- **60-minute expiration** for security
- **Parameter passing** for filtered views
- **Theme support** for consistent dark/light mode

### Chart Builder UI

```tsx
// /src/components/chart-builder/ChartBuilderEmbed.tsx
export function ChartBuilderEmbed() {
  const [activeTab, setActiveTab] = useState<'questions' | 'dashboards'>('questions');
  const { data: content } = useMetabaseContent();

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList>
        <TabsTrigger value="questions">Charts</TabsTrigger>
        <TabsTrigger value="dashboards">Dashboards</TabsTrigger>
      </TabsList>

      <TabsContent value="questions">
        <div className="grid grid-cols-3 gap-4">
          {content.questions.map(question => (
            <ChartCard
              key={question.id}
              name={question.name}
              type={question.display}
              embedUrl={getQuestionEmbedUrl(question.id)}
              metabaseUrl={`${METABASE_URL}/question/${question.id}`}
            />
          ))}
        </div>
      </TabsContent>
    </Tabs>
  );
}
```

### Use Cases

1. **RevOps**: Create custom charts for specific stakeholder requests
2. **Managers**: Build team-specific dashboards
3. **Executives**: Self-serve exploration without waiting for development

---

## The Vibe Coding Philosophy

### What is "Vibe Coding"?

Vibe coding is a development approach that leverages AI assistants (Claude Code, Cursor.ai) to maintain a continuous, conversational development flow. Instead of context-switching between documentation, Stack Overflow, and code, developers maintain a single conversation that understands the full codebase.

### How We Built This in One Week

```
Week 1 Timeline:
├── Day 1: Auth setup, BigQuery connection, basic schema
├── Day 2: Core dashboard pages, funnel metrics API
├── Day 3: Caching layer, role-based filtering
├── Day 4: Charts with Tremor/Recharts, drilldown modals
├── Day 5: AI Explore feature, semantic layer
├── Day 6: Map feature, Metabase integration
└── Day 7: Polish, testing, deployment
```

### Key Enablers

1. **Full Codebase Context**: Claude Code and Cursor.ai see everything—SQL views, TypeScript types, API routes, and components
2. **MCP Connections**: Direct deployment to BigQuery from the IDE
3. **Rapid Iteration**: Changes can be made, tested, and deployed in minutes
4. **Consistency**: AI ensures types, API contracts, and SQL all stay in sync

### Continuous Rapid Iteration

The dashboard continues to evolve rapidly:

- New metrics and dimensions added weekly
- View logic updated as business rules change
- UI improvements based on user feedback
- All changes maintain consistency because the AI understands the full system

### The Compound Advantage

Each feature builds on the last:

1. BigQuery views establish the data foundation
2. Semantic layer makes views queryable in natural language
3. Caching makes queries cost-effective
4. Security ensures appropriate access
5. Visualizations make data actionable
6. Drilldowns provide accountability

When AI understands all these layers, changes propagate correctly across the entire stack.

---

## The Before: Why Build Instead of Buy

We were using Looker Studio before building this dashboard. It was a great free tool, but it lacked customization and the ability to rapidly and intuitively drill down into underlying data. The drag-and-drop GUI editor was a constraint — it's vastly easier to converse with an LLM in natural language and build what you want than to learn complex BI tools.

The trigger to build was Tableau. While more powerful than Looker Studio, that power comes with greater complexity and frustration. I could have spent a month learning Tableau's nuances. Or I could vibe code something more powerful in a fraction of the time — and in doing so, begin forming a knowledge base of business logic from which I could run more powerful analyses rapidly, because Cursor.ai and Claude Code would have the ultimate business logic context. You can't get that building with a GUI BI tool.

---

## The Builder: From Farmer to Full-Stack

I am not an engineer. I was a farmer who became a winery General Manager with an owner's mindset and a scarcity mindset. I learned to vibe code out of necessity — I had real-world problems running a small struggling winery that I knew software could solve, but there were no off-the-shelf solutions because wineries are such a niche industry.

My first project was an online reputation management solution that took the winery from an obscure blip to being ranked number one on Google and LLMs within six months of implementation. That early success gave me the courage to keep pushing LLMs and my own knowledge further, to the point where I was developing scalable enterprise solutions with vibes.

### Prior Technical Background

I knew HTML, CSS, and some JavaScript from casual online courses I took while teaching at Cornell — just because I wanted to learn them. I also knew some R and Python from my academic background (two master's degrees in science and a lectureship in viticulture at Cornell), since those are strong languages for statistical and spatial analysis. That was the extent of my coding experience before picking up Claude Code and Cursor.

---

## The Workflow: How Claude Code and Cursor.ai Work Together

### Phase 1: Data Exploration (Cursor.ai + BigQuery MCP)

I have an MCP connection to BigQuery through Cursor.ai. I start with data exploration — examining Salesforce data in BigQuery and generating markdown documents about what I find. This includes exploring data types, field completeness, how fields relate to each other (e.g., how stages relate to date fields, what IDs join one record to another), and mapping out the full data landscape.

From that exploration, I build a full funnel view and then validate it against a known Salesforce report where I already know what the numbers should be. If the view reports something different from the known truth, I iterate with the LLM until we achieve correctness.

### Phase 2: Planning (Claude Projects + Wispr Flow)

I take the data exploration markdown and add it to a Claude Project as part of the knowledge base. Then I give Claude the context on what I'm trying to build. I am extremely verbose so that it has as much context as possible.

I use Wispr Flow (voice-to-text) to talk my requirements into Claude — I literally pace around like a mad man and stream-of-consciousness describe what I want to achieve. This includes functionalities, security concerns, deployment ideas, and tech stack preferences.

I feed Claude the voice-transcribed requirements along with the data exploration markdown, then have Claude ask me follow-up questions before it generates a step-by-step phased markdown plan for agentic development.

### Phase 3: Cross-Validation (Cursor.ai)

I take Claude's phased development plan, review and iterate on it, then feed it to Cursor.ai. Cursor queries BigQuery via MCP to validate that the plan aligns with the actual data structure, business rules, and edge cases. This cross-validation step between Claude and Cursor catches issues before a single line of production code is written.

### Phase 4: Execution (Claude Code)

With the final agentic development markdown in the directory, I point Claude Code at it and tell it to execute — stopping at the end of each phase to run all validation and verification steps. Claude Code tells me what validation I must do in the UI/UX and provides JavaScript for the developer console to ensure everything is operational.

---

## Failures, Dead Ends, and Debugging with AI

### UI/UX Issues

The initial build is often bare bones. The UI can be really messed up because the LLM forgot a variable or misunderstood a layout requirement. That's fine — you catch it as part of the phased approach, and there are phases that are heavily focused on UI/UX verification. You describe to the LLM what's occurring, and 9 times out of 10 you correct it in a single prompt. Sometimes it takes 2-4 prompts to fully sort out, but it's generally very effective and much better than what these systems could do even a year ago.

### Data Correctness

The harder debugging is around data correctness. You maintain a Salesforce report that your team has agreed is the source of truth. If your dashboard shows 315 SQOs for Q4 2025 but the Salesforce report shows 320, you feed the LLM all 320 opportunity IDs from the true-north report. Cursor.ai queries BigQuery via MCP to determine the difference — maybe the view's date filter cuts off at noon on November 30th instead of going to midnight, and 5 records fell after the cutoff.

The newer large-context LLMs like Claude and Gemini handle this kind of analysis extremely well. For business use cases with LLMs, context is king.

---

## Quantifiable Outcomes

- **Build time**: 1-2 weeks via vibe coding vs. an estimated 1-2 months with an off-the-shelf BI tool — without pulling me away from other critical tasks at a high-growth startup
- **Adoption**: The team finds the dashboard much more intuitive for getting the information they need compared to previous tooling
- **Iteration speed**: A stakeholder requested a geographic map of end users — it was operational the next day. A complex ad-hoc report that would have taken days was generated within an hour, and was more thorough and better presented than a manual approach would have produced
- **Compounding context**: As you work with stakeholders, debugging and building new features, the codebase grows and so does the context from which the LLM can draw. It's like a child learning — your model graduates from first grade to second grade, all the way to PhD level by the time you've incorporated ML techniques and advanced reasoning

---

## Target Audience & Publication

This article is intended for LinkedIn publication, targeting people curious about vibe coding — those who may have great ideas that could be solved with software but don't know where to begin and may be intimidated. The tone should be inspirational yet technical, demonstrating that if a farmer can build enterprise-grade analytics, anyone with domain expertise and determination can do the same.

---

## Conclusion

The Savvy Wealth GTM Dashboard demonstrates what's possible when modern AI-assisted development tools meet enterprise requirements — and when domain expertise meets determination. This wasn't built by a team of engineers; it was built by a former farmer and winery GM who learned to vibe code out of necessity.

The technical architecture speaks for itself:

- **Saves money** through intelligent BigQuery caching
- **Maintains security** through JWT auth and row-level permissions
- **Enables self-service** through Metabase integration
- **Provides accountability** through Salesforce record linking
- **Scales with the business** through the semantic layer and AI exploration

But equally important is the methodology that made it possible:

- **Data exploration first** — understand your domain before writing code
- **Verbose planning with Claude Projects** — give the AI maximum context
- **Cross-validation between tools** — use Cursor.ai to validate Claude's plans against real data
- **Phased execution with Claude Code** — systematic verification at every step
- **Iterative debugging** — embrace failures as learning opportunities for both you and the model

The compounding advantage is real. Every feature built, every bug fixed, every stakeholder conversation adds to the knowledge base from which the LLM operates. What starts as a simple dashboard becomes a comprehensive business intelligence platform — one that understands your domain as deeply as you do.

If a farmer can build enterprise-grade analytics in a week, imagine what you can build with your domain expertise and these tools.

---

*Built with Claude Code and Cursor.ai using the "vibe coding" methodology.*
