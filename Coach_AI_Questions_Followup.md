# Coach AI Implementation - Codebase Follow-Up Questions

> **Purpose**: Additional codebase exploration based on gaps identified from initial analysis and SMS research integration needs
> **For**: Claude Code to work through and answer
> **Instructions**: Answer each question and then APPEND the answers to the original document at `C:\Users\russe\Documents\Dashboard\Coach_AI_Questions.md` under a new section "# PHASE 9: FOLLOW-UP QUESTIONS"

---

# PHASE 9: SMS Activity Integration

The SMS analysis research revealed critical behavioral metrics that should inform coaching. We need to understand how to integrate this data.

## 9.1 SGA Activity Tab Integration
**Goal**: Understand the existing Activity tab and how SMS metrics could be added

**Q9.1.1**: Examine `src/app/dashboard/sga-activity/` and `src/components/sga-activity/`. Document:
- What metrics are currently displayed in the Activity tab?
- How is activity data fetched (which API endpoints)?
- Is SMS data already being displayed? If so, what fields?
- Could Coach AI reuse these components or data sources?

**Answer:**
✅ **COMPLETE** - The Activity tab is a comprehensive dashboard with these components:

**Metrics Currently Displayed:**
| Component | Metrics |
|-----------|---------|
| `ActivityTotalsCards` | Cold Calls, Outbound Calls, SMS Sent, SMS Received, LinkedIn Messages, Emails |
| `RateCards` | SMS Response Rate (leads texted → leads responded), Call Answer Rate |
| `ScheduledCallsCards` | Initial Calls Scheduled (this week/next week), Qualification Calls Scheduled |
| `ActivityDistributionTable` | Activity counts by day of week per channel (Call, SMS, LinkedIn, Email) |

**API Endpoints:**
- `POST /api/sga-activity/dashboard` - Main dashboard data (all metrics)
- `POST /api/sga-activity/activity-records` - Drill-down records with pagination
- `POST /api/sga-activity/scheduled-calls` - Scheduled call records
- `GET /api/sga-activity/filters` - SGA filter options

**SMS Data Already Displayed:**
- `smsOutbound` - Outbound SMS count
- `smsInbound` - Inbound SMS count
- `SMSResponseRate` - Contains: outboundCount, inboundCount, responseRate, responseRatePercent

**Reusability for Coach AI:**
- ✅ `getActivityTotals()` - Provides cold calls, outbound calls, SMS counts
- ✅ `getSMSResponseRate()` - Provides SMS response rate calculation
- ✅ Activity distribution data - Shows activity patterns by day/channel
- ✅ Can filter by SGA via `task_executor_name` parameter

**Q9.1.2**: Examine the SGA Activity API routes. What data transformations happen server-side?

**Answer:**
✅ **COMPLETE** - Key transformations in `src/lib/queries/sga-activity.ts`:

1. **Channel Classification** - Complex priority-based channel classification (lines 629-701):
   - Priority 1: Explicit subjects ("LinkedIn Message", "Outgoing SMS")
   - Priority 2: Subject patterns (text, linkedin keywords)
   - Priority 3: Raw channel group
   - Priority 4: Description-based classification
   - Priority 5: Email fallback (only for ambiguous Call channel)

2. **Date Range Handling** - `getDateRange()` converts filter types to start/end dates:
   - Presets: this_week, last_30, last_60, last_90, qtd, all_time, custom
   - Current week is capped to today (not future dates)

3. **SMS Response Rate** - Unique person-based calculation (lines 886-961):
   ```sql
   -- Count distinct leads_texted and leads_responded
   SAFE_DIVIDE(leads_responded, leads_texted) as response_rate
   ```

4. **Activity Distribution** - Calculates per-day averages (not just totals):
   - Counts occurrences of each day in the period
   - Average = total_activities / num_occurrences

---

## 9.2 SMS Metrics Data Access
**Goal**: Determine how to access SMS behavioral metrics for coaching

**Q9.2.1**: Is there existing code that queries `vw_sga_activity_performance`? Search the codebase for references to this view.

**Answer:**
✅ **COMPLETE** - Yes, the view is used in `src/lib/queries/sga-activity.ts`:

```typescript
const ACTIVITY_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance';
```

It's used in 10 query functions:
1. `getScheduledInitialCalls` - Uses FUNNEL_VIEW, not activity view
2. `getScheduledQualificationCalls` - Uses FUNNEL_VIEW
3. `getActivityDistribution` - Uses ACTIVITY_VIEW
4. `getSMSResponseRate` - Uses ACTIVITY_VIEW
5. `getCallAnswerRate` - Uses ACTIVITY_VIEW
6. `getActivityBreakdown` - Uses ACTIVITY_VIEW
7. `getActivityRecords` - Uses ACTIVITY_VIEW
8. `getActivityTotals` - Uses ACTIVITY_VIEW
9. `getSGAActivityFilterOptions` - Uses both ACTIVITY_VIEW and FUNNEL_VIEW

**Q9.2.2**: The SMS analysis used these key metrics. For each, determine if the data is currently accessible in the dashboard:

**Answer:**
| SMS Metric | Available? | How to Access | Notes |
|------------|------------|---------------|-------|
| Response time to lead replies | ❌ NOT AVAILABLE | Would need new query on Task timestamps | Need: inbound SMS timestamp - last outbound SMS timestamp per lead |
| Link presence in first SMS | ❌ NOT AVAILABLE | Would need Task.Description parsing | Task description contains SMS body content |
| Time of day of first SMS (golden window 8-10 AM) | ⚠️ PARTIAL | `task_created_date_est` available | Need new query to extract hour and filter first SMS per lead |
| AM/PM bookend strategy usage | ❌ NOT AVAILABLE | Would need complex query | Check for SMS in AM (before 12pm) AND PM (after 3pm) same day |
| Text count per lead (persistence) | ❌ NOT AVAILABLE | Would need COUNT(SMS) per lead | Group by task_who_id, count outbound SMS |

**Recommendation**: Create new BigQuery queries for SMS behavioral metrics:
1. `getSGASMSBehaviorMetrics(sgaName, dateRange)` - Returns all behavioral metrics
2. These queries would join Task table with Lead for response time calculations

---

# PHASE 10: Markdown/Rich Text Rendering

## 10.1 AI Response Rendering
**Goal**: Understand how to render AI-generated coaching content

**Q10.1.1**: Does the codebase have existing markdown rendering capabilities?

**Answer:**
✅ **COMPLETE** - **No dedicated markdown library currently installed.**

Searched for:
- `react-markdown` - Not found
- Markdown components - Not found

**Current AI response rendering pattern** (from `ExploreResults.tsx`):
- Responses rendered as plain text in template explanation cards
- Uses standard HTML elements with Tailwind CSS
- `templateSelection.explanation` shown in `<span>` tags

**Recommendation**: For Coach AI, consider:
1. Install `react-markdown` for rich text coaching insights
2. Or use structured JSON responses (like Explore) with custom React components

**Q10.1.2**: Examine `ExploreResults.tsx`. How are AI-generated responses currently displayed?

**Answer:**
✅ **COMPLETE** - Analysis of `src/components/dashboard/ExploreResults.tsx`:

**Rendering Pattern:**
1. **Template Explanation** (line 1072-1080):
   ```tsx
   <code className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800">
     {templateSelection.templateId}
   </code>
   <span>{templateSelection.explanation}</span>
   ```

2. **Error States** - Multiple error displays with icons, titles, messages, suggestions
3. **Loading States** - Skeleton placeholders with animated spinner
4. **Feedback Component** - Thumbs up/down with comment collection
5. **Follow-up Suggestions** - Rendered as clickable pills/buttons

**Key UX Patterns to Reuse:**
- Status icons (AlertCircle, Loader2, TrendingUp)
- Color-coded states (blue for info, red for error, green for success)
- Card-based layouts with headers and content sections
- Collapsible sections (`<details>` for conversation history)

**Q10.1.3**: Design a `CoachingInsightCard` component structure.

**Answer:**
✅ **COMPLETE** - Proposed component structure:

```tsx
// src/components/coach-ai/CoachingInsightCard.tsx

interface CoachingInsightCardProps {
  insight: {
    summary: string;
    pacingStatus: 'ahead' | 'on-track' | 'behind';
    sqoCount: number;
    sqoGoal: number;
    focusAreas: FocusArea[];
    wins: string[];
    actionItems: ActionItem[];
    metricHighlights: MetricHighlight[];
  };
  generatedAt: string;
  onRefresh?: () => void;
  isLoading?: boolean;
}

interface FocusArea {
  area: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  suggestion: string;
}

interface ActionItem {
  action: string;
  metric?: string;
  target?: string | number;
  timeline?: string;
}

interface MetricHighlight {
  label: string;
  value: number;
  comparison: { type: 'team_avg' | 'prev_period'; value: number };
  trend: 'up' | 'down' | 'flat';
}

// Component structure:
<Card>
  {/* Header with status badge */}
  <div className="flex justify-between items-center">
    <h3>Weekly Coaching Insight</h3>
    <Badge color={pacingStatusColors[status]}>{status}</Badge>
  </div>

  {/* Summary */}
  <p className="text-gray-700">{summary}</p>

  {/* Pacing Metrics */}
  <ProgressBar value={sqoCount} max={sqoGoal} />

  {/* Focus Areas (collapsible) */}
  <details open>
    <summary>Focus Areas ({focusAreas.length})</summary>
    {focusAreas.map(area => <FocusAreaItem {...area} />)}
  </details>

  {/* Wins */}
  {wins.length > 0 && (
    <div className="bg-green-50 p-3 rounded">
      <h4>🎉 Wins This Week</h4>
      <ul>{wins.map(win => <li>{win}</li>)}</ul>
    </div>
  )}

  {/* Action Items */}
  <div>
    <h4>Action Items</h4>
    {actionItems.map(item => <ActionItemRow {...item} />)}
  </div>

  {/* Metric Comparisons */}
  <div className="grid grid-cols-2 gap-4">
    {metricHighlights.map(m => <MetricCompareCard {...m} />)}
  </div>
</Card>
```

---

# PHASE 11: Multi-Model Strategy

## 11.1 Model Selection Architecture
**Goal**: Determine if/how to support multiple AI providers

**Q11.1.1**: Should Coach AI support multiple providers?

**Answer:**
✅ **COMPLETE** - Analysis of current integration:

**Current Anthropic-Only Integration** (`/api/agent/query/route.ts`):
```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Model used:
model: 'claude-sonnet-4-20250514',
max_tokens: 1024,
```

**Environment Variables Pattern:**
```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

**No abstraction layer exists** - Direct SDK usage in route.ts

**Recommendation**: For MVP, **stick with Anthropic only**:
1. Simpler implementation
2. Consistent with existing Explore feature
3. Claude is well-suited for coaching/advice generation
4. Add abstraction layer only if needed later

**Q11.1.2**: If we wanted to add fallback to a secondary model, what code changes would be needed?

**Answer:**
✅ **COMPLETE** - Proposed abstraction:

```typescript
// src/lib/llm/provider.ts

interface LLMProvider {
  generateCompletion(params: {
    systemPrompt: string;
    userMessage: string;
    maxTokens?: number;
  }): Promise<string>;
}

class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  async generateCompletion(params) {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: params.maxTokens || 1024,
      system: params.systemPrompt,
      messages: [{ role: 'user', content: params.userMessage }],
    });
    return response.content[0].text;
  }
}

class GeminiProvider implements LLMProvider {
  // Fallback implementation
}

// Usage with fallback:
async function generateWithFallback(params) {
  try {
    return await anthropicProvider.generateCompletion(params);
  } catch (error) {
    logger.warn('Anthropic failed, falling back to Gemini', error);
    return await geminiProvider.generateCompletion(params);
  }
}
```

**Required changes:**
1. Create `src/lib/llm/` directory with provider abstraction
2. Add `GOOGLE_AI_API_KEY` to env variables
3. Install `@google/generative-ai` package
4. Update timeout handling for different provider SLAs

---

# PHASE 12: Notification/Email Infrastructure

## 12.1 Email Capabilities
**Goal**: Understand if weekly coaching can be emailed to SGAs

**Q12.1.1**: What email capabilities exist?

**Answer:**
✅ **COMPLETE** - Analysis of `src/lib/email.ts`:

**Provider**: SendGrid
```typescript
import sgMail from '@sendgrid/mail';
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
```

**Environment Variables:**
- `SENDGRID_API_KEY` - API key
- `EMAIL_FROM` - Sender email (use personal Gmail, not @savvywealth.com due to DMARC)

**Existing Templates:**
1. `sendPasswordResetEmail()` - HTML + plain text template
   - Professional styling with gradient headers
   - Button CTAs
   - Responsive design
   - Spam folder warning notice

**Rate Limiting**: Yes, via Upstash Redis for forgot-password:
```typescript
// src/lib/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit';
const getForgotPasswordLimiter = () => new Ratelimit({...});
```

**Q12.1.2**: What could be reused for coaching emails?

**Answer:**
✅ **COMPLETE** - From `src/app/api/auth/forgot-password/route.ts`:

**Reusable Patterns:**
1. **Rate Limiting Pattern:**
   ```typescript
   const rateLimit = await checkRateLimit(getCoachingEmailLimiter(), userEmail);
   if (!rateLimit.success) {
     return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
   }
   ```

2. **Email Sending Pattern:**
   ```typescript
   const emailSent = await sendCoachingEmail(user.email, coachingInsight, user.name);
   if (!emailSent) {
     logger.error(`Failed to send coaching email to ${user.email}`);
   }
   ```

3. **User Lookup Pattern:**
   ```typescript
   const user = await prisma.user.findUnique({ where: { email } });
   if (!user || !user.isActive) return; // Skip inactive users
   ```

**Q12.1.3**: Design an email notification system for weekly coaching.

**Answer:**
✅ **COMPLETE** - Design:

**When to Send:**
- **Day**: Monday morning (gives SGAs week-ahead planning)
- **Time**: 7:00 AM EST (before workday starts)
- **Trigger**: Cron job + Prisma lookup for users with coaching enabled

**Email Content:**
- **Subject**: "📊 Your Weekly Coaching Insight - Week of {date}"
- **Body**: Summary only (not full report)
  - Pacing status (ahead/on-track/behind)
  - Top 2-3 focus areas
  - "View full coaching →" CTA button linking to dashboard

**Opt-in/Opt-out:**
```prisma
model User {
  // Add to schema
  coachingEmailEnabled Boolean @default(true)
  coachingEmailFrequency String @default("weekly") // "weekly" | "daily" | "none"
}
```

**Implementation:**
```typescript
// src/lib/email.ts
export async function sendWeeklyCoachingEmail(
  to: string,
  userName: string,
  insight: {
    pacingStatus: string;
    sqoCount: number;
    sqoGoal: number;
    topFocusAreas: string[];
  }
): Promise<boolean> {
  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/sga-hub?tab=coaching`;

  const html = `
    <h2>Good morning, ${userName}! 👋</h2>
    <p>Here's your weekly coaching summary:</p>
    <div style="background: ${pacingColors[insight.pacingStatus]}; padding: 16px; border-radius: 8px;">
      <strong>Pacing: ${insight.pacingStatus.toUpperCase()}</strong>
      <p>${insight.sqoCount} / ${insight.sqoGoal} SQOs</p>
    </div>
    <h3>This Week's Focus:</h3>
    <ul>${insight.topFocusAreas.map(a => `<li>${a}</li>`).join('')}</ul>
    <a href="${dashboardUrl}" style="...">View Full Coaching →</a>
  `;

  return sendEmail({ to, subject, text, html });
}
```

---

# PHASE 13: Cron Job Patterns

## 13.1 Scheduled Task Infrastructure
**Goal**: Understand how to schedule weekly coaching generation

**Q13.1.1**: Document the existing cron job pattern.

**Answer:**
✅ **COMPLETE** - From `src/app/api/cron/refresh-cache/route.ts` and `vercel.json`:

**Configuration** (vercel.json):
```json
{
  "crons": [
    { "path": "/api/cron/refresh-cache", "schedule": "10 4 * * *" },
    { "path": "/api/cron/refresh-cache", "schedule": "10 10 * * *" },
    { "path": "/api/cron/refresh-cache", "schedule": "10 16 * * *" },
    { "path": "/api/cron/refresh-cache", "schedule": "10 22 * * *" },
    { "path": "/api/cron/geocode-advisors", "schedule": "0 5 * * *" }
  ]
}
```

**Authentication** (CRON_SECRET):
```typescript
const authHeader = request.headers.get('authorization');
const cronSecret = process.env.CRON_SECRET;
if (authHeader !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

**Max Duration**: Set in vercel.json functions config:
```json
"functions": {
  "src/app/api/agent/query/route.ts": { "maxDuration": 60 }
}
```

**Error Handling**:
- Try/catch with logger.error
- Returns 500 status on failure
- No automatic retry (Vercel handles retries)

**Q13.1.2**: Design a `/api/cron/generate-coaching` endpoint.

**Answer:**
✅ **COMPLETE** - Proposed implementation:

```typescript
// src/app/api/cron/generate-coaching/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { generateCoachingInsight } from '@/lib/coach-ai/generate';
import { sendWeeklyCoachingEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // 1. Validate CRON_SECRET
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Get all active SGAs
    const sgas = await prisma.user.findMany({
      where: {
        role: 'sga',
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        coachingEmailEnabled: true,
      },
    });

    logger.info(`[Coaching Cron] Starting generation for ${sgas.length} SGAs`);

    const results = {
      success: [] as string[],
      failed: [] as string[],
      emailsSent: 0,
    };

    // 3. Generate coaching for each SGA
    for (const sga of sgas) {
      try {
        // Generate insight
        const insight = await generateCoachingInsight(sga.email, sga.name);

        // Store in Prisma
        await prisma.coachingInsight.upsert({
          where: {
            userEmail_weekStartDate: {
              userEmail: sga.email,
              weekStartDate: getWeekStartDate(),
            },
          },
          create: {
            userEmail: sga.email,
            quarter: getCurrentQuarter(),
            weekStartDate: getWeekStartDate(),
            ...insight,
          },
          update: {
            ...insight,
            generatedAt: new Date(),
          },
        });

        results.success.push(sga.email);

        // 4. Send email if enabled
        if (sga.coachingEmailEnabled) {
          const emailSent = await sendWeeklyCoachingEmail(
            sga.email,
            sga.name,
            {
              pacingStatus: insight.pacingStatus,
              sqoCount: insight.sqoCount,
              sqoGoal: insight.sqoGoal,
              topFocusAreas: insight.focusAreas.slice(0, 3).map(f => f.area),
            }
          );
          if (emailSent) results.emailsSent++;
        }

      } catch (error) {
        logger.error(`[Coaching Cron] Failed for ${sga.email}`, error);
        results.failed.push(sga.email);
      }
    }

    logger.info('[Coaching Cron] Complete', results);

    return NextResponse.json({
      success: true,
      generated: results.success.length,
      failed: results.failed.length,
      emailsSent: results.emailsSent,
    });

  } catch (error) {
    logger.error('[Coaching Cron] Fatal error', error);
    return NextResponse.json({ error: 'Failed to generate coaching' }, { status: 500 });
  }
}
```

**vercel.json addition:**
```json
{
  "functions": {
    "src/app/api/cron/generate-coaching/route.ts": { "maxDuration": 300 }
  },
  "crons": [
    { "path": "/api/cron/generate-coaching", "schedule": "0 12 * * 0" }  // Sunday 7am EST
  ]
}
```

---

# PHASE 14: Admin Team Overview Design

## 14.1 Team-Level Coaching View
**Goal**: Design the admin/manager team overview

**Q14.1.1**: What patterns can be reused from `AdminQuarterlyProgressView.tsx`?

**Answer:**
✅ **COMPLETE** - Reusable patterns from `src/components/sga-hub/AdminQuarterlyProgressView.tsx`:

**State Management:**
```typescript
const [selectedSGAs, setSelectedSGAs] = useState<string[]>([]);
const [selectedPacingStatuses, setSelectedPacingStatuses] = useState<string[]>(['ahead', 'on-track', 'behind', 'no-goal']);
const [loading, setLoading] = useState(true);
```

**Filter Components:**
- `AdminQuarterlyFilters` - Quarter selector, SGA multi-select, channel/source filters, pacing status filter
- `StatusSummaryStrip` - Quick counts (ahead: X, on-track: Y, behind: Z)

**Data Fetching Pattern:**
```typescript
useEffect(() => {
  const fetchProgress = async () => {
    const progress = await dashboardApi.getAdminQuarterlyProgress({
      year, quarter, sgaNames, channels, sources
    });
    setAdminProgress(progress);
  };
  fetchProgress();
}, [year, quarter, selectedSGAs, selectedChannels, selectedSources]);
```

**Breakdown Table:**
- `SGABreakdownTable` - Sortable table with SGA rows
- Columns: SGA Name, Goal, Current, Progress %, Expected, Pacing Diff, Status
- Click handler for drill-down to SGA details

**Q14.1.2**: Design the Team Coaching Overview UI.

**Answer:**
✅ **COMPLETE** - Proposed design:

```tsx
// src/components/coach-ai/TeamCoachingOverview.tsx

interface TeamCoachingOverviewProps {
  quarter: string;
  onSGAClick: (sgaEmail: string) => void;
}

export function TeamCoachingOverview({ quarter, onSGAClick }: TeamCoachingOverviewProps) {
  return (
    <div className="space-y-6">
      {/* 1. Team-Wide Alerts */}
      <Card className="bg-amber-50 border-amber-200">
        <h3>⚠️ Team Alerts</h3>
        <ul>
          <li>3 SGAs are below team average on SQL→SQO conversion</li>
          <li>Average response time is 4.2 hours (target: &lt;1 hour)</li>
        </ul>
      </Card>

      {/* 2. Status Summary Strip (reuse existing component) */}
      <StatusSummaryStrip
        totalSGAs={12}
        aheadCount={4}
        onTrackCount={5}
        behindCount={3}
        noGoalCount={0}
      />

      {/* 3. Aggregated Coaching Themes */}
      <Card>
        <h3>Common Coaching Themes</h3>
        <div className="grid grid-cols-2 gap-4">
          <ThemeCard theme="Response Time" count={4} icon={<Clock />} />
          <ThemeCard theme="SQL→SQO Conversion" count={3} icon={<TrendingUp />} />
          <ThemeCard theme="Golden Window Texting" count={2} icon={<MessageSquare />} />
          <ThemeCard theme="Activity Volume" count={2} icon={<Activity />} />
        </div>
      </Card>

      {/* 4. SGA Coaching Grid */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3>Individual SGA Coaching</h3>
          <ExportButton label="Export Team Summary" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sgaCoachingList.map(sga => (
            <SGACoachingCard
              key={sga.email}
              sgaName={sga.name}
              pacingStatus={sga.pacingStatus}
              sqoCount={sga.sqoCount}
              sqoGoal={sga.sqoGoal}
              topFocusArea={sga.focusAreas[0]?.area}
              lastUpdated={sga.generatedAt}
              onClick={() => onSGAClick(sga.email)}
            />
          ))}
        </div>
      </div>

      {/* 5. Top Performers Section */}
      <Card className="bg-green-50 border-green-200">
        <h3>🏆 Top Performers to Learn From</h3>
        <div className="space-y-2">
          {topPerformers.map(sga => (
            <div className="flex justify-between">
              <span>{sga.name}</span>
              <span className="text-green-600">+{sga.pacingDiff} SQOs ahead</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
```

---

# PHASE 15: Historical Coaching Storage

## 15.1 Coaching History Model
**Goal**: Design storage for historical coaching data

**Q15.1.1**: Review and improve the proposed Prisma model.

**Answer:**
✅ **COMPLETE** - Improved model based on codebase patterns:

```prisma
// Add to prisma/schema.prisma

model CoachingInsight {
  id            String   @id @default(cuid())
  userEmail     String   // Links to User.email
  quarter       String   // "2026-Q1" format (matches QuarterlyGoal)
  weekStartDate DateTime @db.Date // Monday of the week

  // Metrics snapshot at time of generation
  sqoCount         Int
  sqoGoal          Int
  sqoRank          Int?      // Rank among all SGAs
  expectedSqos     Float     // Pacing expectation
  pacingDiff       Float     // Actual - Expected
  pacingStatus     String    // "ahead" | "on-track" | "behind"

  // AI-generated content (JSON for flexibility)
  summary       String   @db.Text
  focusAreas    Json     // Array<{area: string, priority: string, reason: string, suggestion: string}>
  wins          Json     // Array<string>
  actionItems   Json     // Array<{action: string, metric?: string, target?: string}>

  // Conversion rates snapshot (last 90 days at generation)
  contactedToMql Float?
  mqlToSql       Float?
  sqlToSqo       Float?
  teamAvgSqlToSqo Float?  // For comparison display

  // Activity metrics snapshot (last 7 days)
  weeklyContacts     Int?
  weeklyInitialCalls Int?
  weeklyQualCalls    Int?

  // SMS Behavioral metrics (if available)
  smsResponseTimeAvg   Float?
  smsGoldenWindowPct   Float?
  smsBookendStrategyPct Float?

  // Metadata
  modelUsed     String   @default("claude-sonnet-4") // Track model for debugging
  promptVersion String?  // Track prompt version for A/B testing
  generatedAt   DateTime @default(now())
  viewedAt      DateTime? // Track engagement

  // User relation
  // Note: Using email instead of id for consistency with WeeklyGoal pattern

  @@unique([userEmail, weekStartDate])
  @@index([userEmail])
  @@index([weekStartDate])
  @@index([quarter])
  @@index([pacingStatus])
  @@map("coaching_insights")
}

// Also add to User model:
model User {
  // ... existing fields ...

  // Coach AI preferences
  coachingEmailEnabled Boolean @default(true)
  coachingEmailFrequency String @default("weekly") // "weekly" | "none"
}
```

**Why These Changes:**
1. Added `expectedSqos` and `pacingDiff` for pacing display without recalculation
2. Added `promptVersion` for A/B testing prompts
3. Added `sqoRank` for leaderboard context
4. Split SMS metrics into separate fields for easier querying
5. Used `@db.Text` for long strings (summary)
6. Added `@@map("coaching_insights")` for cleaner table name
7. Added index on `pacingStatus` for filtering team views

---

# PHASE 16: Error Handling & Fallbacks

## 16.1 AI Generation Failures
**Goal**: Handle cases where AI generation fails

**Q16.1.1**: What happens in the Explore page if Claude API fails?

**Answer:**
✅ **COMPLETE** - Error handling in `src/app/api/agent/query/route.ts`:

**Timeout Handling:**
```typescript
const CLAUDE_TIMEOUT_MS = 30000; // 30 seconds
const BIGQUERY_TIMEOUT_MS = 30000;

// Timeout wrapper:
const templateSelection = await withTimeout(
  callClaude(question, conversationHistory),
  CLAUDE_TIMEOUT_MS,
  'AI response timed out. Please try a simpler question or rephrase.'
);
```

**Error Response Format:**
```typescript
// Timeout error:
{
  success: false,
  error: {
    code: 'TIMEOUT',
    message: 'AI response timed out...',
    suggestion: 'Try simplifying your question...'
  },
  visualization: 'metric'
}

// Query error:
{
  success: false,
  error: {
    code: 'QUERY_ERROR',
    message: 'Query execution failed',
    suggestion: 'Check the Query Inspector...'
  }
}

// Unsupported question:
{
  success: false,
  error: {
    code: 'UNSUPPORTED_QUESTION',
    message: templateSelection.explanation,
    suggestion: 'Try rephrasing your question...'
  }
}
```

**UI Error Display** (`ExploreResults.tsx`):
- Color-coded error icons (red, orange, gray)
- Clear error title and message
- Actionable suggestion text
- "Try Again" retry button

**Q16.1.2**: Design fallback behavior for Coach AI.

**Answer:**
✅ **COMPLETE** - Proposed fallback strategy:

```typescript
// src/lib/coach-ai/generate.ts

interface CoachingGenerationResult {
  success: boolean;
  insight?: CoachingInsight;
  error?: {
    code: string;
    message: string;
    fallbackUsed?: boolean;
  };
}

export async function generateCoachingInsight(
  sgaEmail: string,
  sgaName: string
): Promise<CoachingGenerationResult> {

  // 1. Collect metrics (can fail partially)
  const metrics = await collectCoachingMetrics(sgaEmail);
  if (metrics.error) {
    // Partial data - continue with what we have
    logger.warn(`Partial metrics for ${sgaEmail}`, metrics.error);
  }

  // 2. Try Claude generation
  try {
    const insight = await withTimeout(
      callClaudeForCoaching(sgaName, metrics),
      45000, // 45 seconds for coaching (more complex)
      'Coaching generation timed out'
    );

    return { success: true, insight };

  } catch (error) {
    logger.error(`Claude failed for ${sgaEmail}`, error);

    // 3. FALLBACK: Generate rule-based coaching
    const fallbackInsight = generateRuleBasedCoaching(sgaName, metrics);

    return {
      success: true,
      insight: fallbackInsight,
      error: {
        code: 'FALLBACK_USED',
        message: 'AI unavailable, showing basic insights',
        fallbackUsed: true,
      },
    };
  }
}

// Rule-based fallback (no AI needed)
function generateRuleBasedCoaching(name: string, metrics: CoachingMetrics): CoachingInsight {
  const focusAreas: FocusArea[] = [];
  const wins: string[] = [];

  // Simple rules for common scenarios
  if (metrics.conversionRates.sqlToSqo.rate < metrics.conversionRates.sqlToSqo.teamAvg) {
    focusAreas.push({
      area: 'SQL→SQO Conversion',
      priority: 'high',
      reason: `Your rate (${metrics.conversionRates.sqlToSqo.rate.toFixed(1)}%) is below team average (${metrics.conversionRates.sqlToSqo.teamAvg.toFixed(1)}%)`,
      suggestion: 'Review qualification criteria and discovery call techniques',
    });
  }

  if (metrics.pacingStatus === 'ahead') {
    wins.push(`You're ahead of pace with ${metrics.sqoCount} SQOs!`);
  }

  return {
    summary: `${name}, here's your weekly snapshot. ${metrics.pacingStatus === 'ahead' ? 'Great work!' : 'Keep pushing!'}`,
    pacingStatus: metrics.pacingStatus,
    sqoCount: metrics.sqoCount,
    sqoGoal: metrics.sqoGoal,
    focusAreas,
    wins,
    actionItems: focusAreas.map(f => ({ action: f.suggestion })),
  };
}
```

**UI Fallback Display:**
```tsx
{insight.fallbackUsed && (
  <div className="bg-amber-50 border-amber-200 p-3 rounded text-sm">
    ⚠️ AI coaching temporarily unavailable. Showing data-based insights.
    <button onClick={onRefresh}>Try AI again</button>
  </div>
)}
```

**Last Week's Coaching Fallback:**
```typescript
// If generation fails completely, show last week's coaching
const lastWeek = await prisma.coachingInsight.findFirst({
  where: { userEmail: sgaEmail },
  orderBy: { weekStartDate: 'desc' },
});

if (lastWeek) {
  return {
    success: true,
    insight: { ...lastWeek, stale: true },
    error: {
      code: 'SHOWING_PREVIOUS',
      message: 'Showing last week\'s coaching while we generate new insights',
    },
  };
}
```

---

# PHASE 17: Prompt Versioning & A/B Testing

## 17.1 Prompt Management
**Goal**: Plan for prompt iteration and testing

**Q17.1.1**: How should coaching prompts be versioned and managed?

**Answer:**
✅ **COMPLETE** - Proposed strategy:

**Option A: Code-Based (Recommended for MVP)**
```typescript
// src/lib/coach-ai/prompts/index.ts

export const PROMPT_VERSIONS = {
  'v1.0': {
    version: 'v1.0',
    description: 'Initial coaching prompt',
    systemPrompt: `You are a sales performance coach...`,
    active: true,
    createdAt: '2026-02-01',
  },
  'v1.1': {
    version: 'v1.1',
    description: 'Added behavioral metrics emphasis',
    systemPrompt: `You are an expert sales performance coach...`,
    active: false,
    createdAt: '2026-02-15',
  },
} as const;

export const ACTIVE_PROMPT = PROMPT_VERSIONS['v1.0'];
```

**Pros:**
- Version controlled with code
- Easy to rollback via deployment
- No database migration needed
- Full diff visibility in git

**A/B Testing Approach:**
```typescript
// src/lib/coach-ai/ab-test.ts

const AB_TEST_CONFIG = {
  enabled: true,
  variants: {
    control: { promptVersion: 'v1.0', weight: 50 },
    treatment: { promptVersion: 'v1.1', weight: 50 },
  },
};

export function selectPromptVariant(userEmail: string): string {
  // Deterministic assignment based on email hash
  const hash = hashCode(userEmail);
  const bucket = Math.abs(hash) % 100;

  let cumulative = 0;
  for (const [variant, config] of Object.entries(AB_TEST_CONFIG.variants)) {
    cumulative += config.weight;
    if (bucket < cumulative) {
      return config.promptVersion;
    }
  }
  return 'v1.0'; // fallback
}
```

**Measuring Effectiveness:**
```sql
-- Query to compare prompt effectiveness
SELECT
  prompt_version,
  AVG(CASE WHEN pacing_status = 'ahead' THEN 1 ELSE 0 END) as pct_ahead,
  AVG(CASE WHEN viewed_at IS NOT NULL THEN 1 ELSE 0 END) as pct_viewed,
  COUNT(*) as total_generated
FROM coaching_insights
WHERE generated_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY prompt_version
```

**Q17.1.2**: Design a prompt template system.

**Answer:**
✅ **COMPLETE** - Template system design:

```typescript
// src/lib/coach-ai/prompts/template.ts

interface PromptTemplate {
  version: string;
  sections: {
    role: string;
    context: string;
    metricsGuide: string;
    outputFormat: string;
    examples: string;
    conditionals: ConditionalSection[];
  };
}

interface ConditionalSection {
  condition: (metrics: CoachingMetrics) => boolean;
  content: string;
}

export function buildCoachingPrompt(
  template: PromptTemplate,
  metrics: CoachingMetrics
): string {
  const { sections } = template;

  let prompt = `
${sections.role}

${sections.context}

## Metrics Provided:
${sections.metricsGuide}

## Data for This SGA:
${JSON.stringify(metrics, null, 2)}
`;

  // Add conditional sections
  for (const conditional of sections.conditionals) {
    if (conditional.condition(metrics)) {
      prompt += `\n\n${conditional.content}`;
    }
  }

  prompt += `
## Output Format:
${sections.outputFormat}

## Examples:
${sections.examples}
`;

  return prompt;
}

// Example template with conditionals
export const coachingTemplateV1: PromptTemplate = {
  version: 'v1.0',
  sections: {
    role: `You are an expert sales performance coach for financial advisor acquisition.`,

    context: `Your job is to provide weekly coaching insights for Sales Growth Advisors (SGAs).`,

    metricsGuide: `
- sqoCount / sqoGoal: Current vs target qualified opportunities
- pacingStatus: "ahead" (>110%), "on-track" (90-110%), "behind" (<90%)
- conversionRates: Compared to team averages
- smsBehavior: Response time, golden window usage (8-10 AM)
`,

    outputFormat: `
Return valid JSON:
{
  "summary": "2-3 sentence personalized summary",
  "focusAreas": [{"area": "...", "priority": "high|medium|low", "reason": "...", "suggestion": "..."}],
  "wins": ["Achievement 1", "Achievement 2"],
  "actionItems": [{"action": "...", "metric": "...", "target": "..."}]
}
`,

    examples: `
Good: "Great week! Your SQL→SQO conversion improved 5 points."
Bad: "Keep working on conversions." (Too generic)
`,

    conditionals: [
      {
        condition: (m) => m.daysSinceCreation < 90,
        content: `## Ramp Consideration:
This SGA is on ramp (${m => m.daysSinceCreation} days). Focus on activity building and process learning rather than conversion optimization.`,
      },
      {
        condition: (m) => m.smsBehavior !== undefined,
        content: `## SMS Behavioral Coaching:
SMS metrics are available. Emphasize response time and golden window texting in your coaching.`,
      },
    ],
  },
};
```

---

# PHASE 18: Data Collection for Prompt

## 18.1 Metrics Collector Function
**Goal**: Design the function that collects all data for the coaching prompt

**Q18.1.1**: Document which BigQuery queries and Prisma calls are needed for each field.

**Answer:**
✅ **COMPLETE** - Full mapping:

```typescript
// src/lib/coach-ai/collect-metrics.ts

export async function collectCoachingMetrics(
  sgaEmail: string,
  quarter: string
): Promise<CoachingMetrics> {

  // Get SGA name from email (Prisma)
  const user = await prisma.user.findUnique({
    where: { email: sgaEmail },
    select: { name: true, createdAt: true },
  });
  const sgaName = user?.name || '';

  // Parallel queries for performance
  const [
    productionData,
    conversionData,
    activityData,
    dispositionData,
    channelData,
    goalData,
    leaderboardData,
  ] = await Promise.all([
    // 1. Production (SQO count) - BigQuery
    fetchSQOProduction(sgaName, quarter),

    // 2. Conversion rates - BigQuery (existing query)
    fetchConversionRates(sgaName, quarter),

    // 3. Activity metrics - BigQuery (existing sga-activity queries)
    fetchActivityMetrics(sgaName),

    // 4. Disposition breakdown - BigQuery
    fetchDispositions(sgaName, quarter),

    // 5. Channel performance - BigQuery
    fetchChannelPerformance(sgaName, quarter),

    // 6. Goal data - Prisma
    fetchGoalData(sgaEmail, quarter),

    // 7. Leaderboard rank - BigQuery
    fetchLeaderboardRank(sgaName, quarter),
  ]);

  return buildMetricsObject(...allData);
}
```

**Field-by-Field Source Mapping:**

| Field | Source | Query/Function |
|-------|--------|----------------|
| **Identity** | | |
| sgaName | Prisma | `prisma.user.findUnique()` |
| sgaEmail | Input param | - |
| segment | BigQuery | `vw_funnel_master.Segment__c` |
| rampStatus | BigQuery | `vw_funnel_master.Ramp_Status__c` |
| daysSinceCreation | Prisma | `user.createdAt` → calculate |
| **Production** | | |
| sqoCount | BigQuery | `getLeaderboardData()` from sga-hub.ts |
| sqoGoal | Prisma | `prisma.quarterlyGoal.findUnique()` |
| sqoRank | BigQuery | `ROW_NUMBER() OVER (ORDER BY sqo_count DESC)` |
| totalSGAs | BigQuery | `COUNT(DISTINCT sga_name)` |
| last7DaysSqos | BigQuery | Filter sqo_date >= 7 days ago |
| **Pacing** | | |
| daysElapsed | JS calc | `getQuarterInfo()` helper |
| daysInQuarter | JS calc | `getQuarterInfo()` helper |
| expectedSqos | JS calc | `(sqoGoal / daysInQuarter) * daysElapsed` |
| pacingDiff | JS calc | `sqoCount - expectedSqos` |
| pacingStatus | JS calc | Based on pacingDiff thresholds |
| **Conversion Rates** | | |
| contactedToMql | BigQuery | `getConversionRates()` - cohort mode |
| mqlToSql | BigQuery | `getConversionRates()` - cohort mode |
| sqlToSqo | BigQuery | `getConversionRates()` - cohort mode |
| teamAvg | BigQuery | Same queries without SGA filter |
| **Activity** | | |
| contacts | BigQuery | `getActivityTotals()` |
| initialCalls | BigQuery | Scheduled calls this week |
| qualCalls | BigQuery | Scheduled calls this week |
| **SMS Behavior** (optional) | | |
| responseTimeAvg | BigQuery | NEW query needed |
| goldenWindowPct | BigQuery | NEW query needed |
| bookendStrategyPct | BigQuery | NEW query needed |
| **Trends** | | |
| conversionTrend | BigQuery | Compare 90d vs lifetime |
| **Dispositions** | | |
| mqlLosses | BigQuery | `getDispositionBreakdown()` |
| sqlLosses | BigQuery | `getDispositionBreakdown()` |
| **Channels** | | |
| channels | BigQuery | `getChannelPerformance()` existing |

---

# PHASE 19: Final System Prompt Design

## 19.1 Coaching System Prompt
**Goal**: Design the final system prompt for Coach AI

**Q19.1.1**: Write a complete system prompt for individual SGA coaching.

**Answer:**
✅ **COMPLETE** - Full system prompt:

```typescript
export function generateIndividualCoachingPrompt(metrics: CoachingMetrics): string {
  return `
# Role
You are an expert sales performance coach specializing in financial advisor recruitment. Your job is to provide weekly coaching insights for Sales Growth Advisors (SGAs) at Savvy Wealth.

# Context
Savvy Wealth recruits financial advisors to join their platform. SGAs are responsible for:
1. Contacting leads (Prospects → Contacted)
2. Qualifying leads (MQL → SQL)
3. Converting qualified leads to opportunities (SQL → SQO)
4. Supporting through join process (SQO → Joined)

Key performance metric: SQO (Sales Qualified Opportunity) count vs quarterly goal.

# SGA Being Coached
Name: ${metrics.sgaName}
Segment: ${metrics.segment}
Status: ${metrics.rampStatus} (${metrics.daysSinceCreation} days since start)
Quarter: ${metrics.quarter}

# Current Performance Data

## Production
- SQOs: ${metrics.sqoCount} of ${metrics.sqoGoal} goal (${Math.round((metrics.sqoCount / metrics.sqoGoal) * 100)}%)
- Rank: #${metrics.sqoRank} of ${metrics.totalSGAs} SGAs
- Last 7 days: ${metrics.last7DaysSqos} SQOs

## Pacing
- Days: ${metrics.daysElapsed} of ${metrics.daysInQuarter}
- Expected SQOs at this point: ${metrics.expectedSqos.toFixed(1)}
- Pacing: ${metrics.pacingDiff > 0 ? '+' : ''}${metrics.pacingDiff.toFixed(1)} vs expected
- Status: ${metrics.pacingStatus.toUpperCase()}

## Conversion Rates (Last 90 Days)
| Stage | SGA Rate | Team Avg | Diff |
|-------|----------|----------|------|
| Contacted→MQL | ${metrics.conversionRates.contactedToMql.rate.toFixed(1)}% | ${metrics.conversionRates.contactedToMql.teamAvg.toFixed(1)}% | ${metrics.conversionRates.contactedToMql.diff > 0 ? '+' : ''}${metrics.conversionRates.contactedToMql.diff.toFixed(1)}pp |
| MQL→SQL | ${metrics.conversionRates.mqlToSql.rate.toFixed(1)}% | ${metrics.conversionRates.mqlToSql.teamAvg.toFixed(1)}% | ${metrics.conversionRates.mqlToSql.diff > 0 ? '+' : ''}${metrics.conversionRates.mqlToSql.diff.toFixed(1)}pp |
| SQL→SQO | ${metrics.conversionRates.sqlToSqo.rate.toFixed(1)}% | ${metrics.conversionRates.sqlToSqo.teamAvg.toFixed(1)}% | ${metrics.conversionRates.sqlToSqo.diff > 0 ? '+' : ''}${metrics.conversionRates.sqlToSqo.diff.toFixed(1)}pp |

## Activity (Last 7 Days)
- Contacts: ${metrics.activity.contacts} (avg: ${metrics.activity.avgWeeklyContacts}/week)
- Initial Calls Completed: ${metrics.activity.initialCalls}
- Qual Calls Completed: ${metrics.activity.qualCalls}

${metrics.smsBehavior ? `
## SMS Behavioral Metrics
- Response Time (median): ${metrics.smsBehavior.responseTimeMedian.toFixed(1)} hours
- Golden Window (8-10 AM): ${metrics.smsBehavior.goldenWindowPct.toFixed(0)}% of first texts
- AM/PM Bookend Strategy: ${metrics.smsBehavior.bookendStrategyPct.toFixed(0)}% of leads
- Over-Texting (>2 with no reply): ${metrics.smsBehavior.overTextPct.toFixed(0)}% of leads
` : ''}

## Top Loss Reasons
MQL Losses: ${metrics.dispositions.mqlLosses.map(d => `${d.reason} (${d.sgaPct.toFixed(0)}% vs team ${d.teamPct.toFixed(0)}%)`).join(', ')}
SQL Losses: ${metrics.dispositions.sqlLosses.map(d => `${d.reason} (${d.sgaPct.toFixed(0)}% vs team ${d.teamPct.toFixed(0)}%)`).join(', ')}

# Coaching Principles
1. BE SPECIFIC: Reference actual numbers and comparisons. "Your SQL→SQO is 5pp below team" not "improve conversions"
2. BE ACTIONABLE: Provide concrete suggestions they can implement this week
3. BE BALANCED: Acknowledge wins before addressing areas for improvement
4. BE CONTEXTUAL: ${metrics.rampStatus === 'On Ramp' ? 'This SGA is on ramp - focus on activity and learning, not just conversion optimization' : 'This is a tenured SGA - hold to higher standards'}
5. PRIORITIZE: Focus on 2-3 focus areas max - don't overwhelm

# Bad Examples (Don't do this)
- "Keep working hard" (too generic)
- "Your conversions need work" (no specifics)
- "Try to improve response time" (no target or context)

# Good Examples
- "Your SQL→SQO rate of 32% is 5pp below team average. Review your last 5 closed-lost SQLs to identify qualification gaps."
- "Great week! 3 SQOs puts you +2 ahead of pace. Your golden window texting at 45% is driving results - keep it up."
- "Response time of 4.2 hours is contributing to your below-average MQL rate. This week, aim for <1 hour during business hours."

# Output Format
Return ONLY valid JSON with this exact structure:
{
  "summary": "2-3 sentence personalized summary starting with their name. Be encouraging but honest.",
  "focusAreas": [
    {
      "area": "Name of focus area (e.g., 'SQL→SQO Conversion')",
      "priority": "high" | "medium" | "low",
      "reason": "Why this matters with specific numbers",
      "suggestion": "Concrete action to take this week"
    }
  ],
  "wins": ["Specific achievement 1", "Specific achievement 2"],
  "actionItems": [
    {
      "action": "Specific action to take",
      "metric": "Metric to track (optional)",
      "target": "Target value (optional)",
      "timeline": "When to complete (optional)"
    }
  ]
}

Maximum 3 focus areas, 3 wins, and 5 action items.
`;
}
```

**Q19.1.2**: Write a separate system prompt for team-level coaching.

**Answer:**
✅ **COMPLETE** - Team coaching prompt:

```typescript
export function generateTeamCoachingPrompt(teamMetrics: TeamCoachingMetrics): string {
  return `
# Role
You are a sales leadership coach providing weekly insights for SGA team managers at Savvy Wealth.

# Context
You're summarizing performance across ${teamMetrics.totalSGAs} SGAs. Your audience is sales leadership who needs:
1. Quick team health overview
2. Common coaching themes to address
3. Top/struggling performers to focus attention on
4. Actionable recommendations for leadership

# Team Performance Data

## Pacing Summary
| Status | Count | % |
|--------|-------|---|
| Ahead | ${teamMetrics.aheadCount} | ${((teamMetrics.aheadCount / teamMetrics.totalSGAs) * 100).toFixed(0)}% |
| On Track | ${teamMetrics.onTrackCount} | ${((teamMetrics.onTrackCount / teamMetrics.totalSGAs) * 100).toFixed(0)}% |
| Behind | ${teamMetrics.behindCount} | ${((teamMetrics.behindCount / teamMetrics.totalSGAs) * 100).toFixed(0)}% |

## Team Totals
- Total SQOs: ${teamMetrics.totalSQOs} of ${teamMetrics.teamGoal} (${((teamMetrics.totalSQOs / teamMetrics.teamGoal) * 100).toFixed(0)}%)
- Team Pacing: ${teamMetrics.teamPacingStatus}

## Conversion Rate Benchmarks
| Stage | Team Avg | Top Quartile | Bottom Quartile |
|-------|----------|--------------|-----------------|
| Contacted→MQL | ${teamMetrics.conversionBenchmarks.contactedToMql.avg.toFixed(1)}% | ${teamMetrics.conversionBenchmarks.contactedToMql.top25.toFixed(1)}% | ${teamMetrics.conversionBenchmarks.contactedToMql.bottom25.toFixed(1)}% |
| MQL→SQL | ${teamMetrics.conversionBenchmarks.mqlToSql.avg.toFixed(1)}% | ${teamMetrics.conversionBenchmarks.mqlToSql.top25.toFixed(1)}% | ${teamMetrics.conversionBenchmarks.mqlToSql.bottom25.toFixed(1)}% |
| SQL→SQO | ${teamMetrics.conversionBenchmarks.sqlToSqo.avg.toFixed(1)}% | ${teamMetrics.conversionBenchmarks.sqlToSqo.top25.toFixed(1)}% | ${teamMetrics.conversionBenchmarks.sqlToSqo.bottom25.toFixed(1)}% |

## Common Coaching Themes
${teamMetrics.commonThemes.map(t => `- ${t.theme}: ${t.sgaCount} SGAs (${t.description})`).join('\n')}

## Top Performers
${teamMetrics.topPerformers.map(p => `- ${p.name}: ${p.sqoCount} SQOs (+${p.pacingDiff} ahead)`).join('\n')}

## Struggling SGAs (Need Attention)
${teamMetrics.strugglingPerformers.map(p => `- ${p.name}: ${p.sqoCount} SQOs (${p.pacingDiff} behind) - Issue: ${p.primaryIssue}`).join('\n')}

# Output Format
Return ONLY valid JSON:
{
  "teamSummary": "2-3 sentence overall team health summary",
  "coachingThemes": [
    {
      "theme": "Theme name",
      "sgaCount": 4,
      "recommendation": "What leadership should do about this"
    }
  ],
  "topPerformerInsights": "What top performers are doing right that can be shared",
  "attentionNeeded": [
    {
      "sgaName": "Name",
      "issue": "Primary issue",
      "suggestedAction": "What manager should do"
    }
  ],
  "weeklyFocus": "Single most important thing for leadership to focus on this week"
}
`;
}
```

---

# SUMMARY OF FOLLOW-UP FINDINGS

## New Components Needed
1. `CoachingInsightCard` - Individual SGA coaching display
2. `TeamCoachingOverview` - Admin/manager team view
3. `FocusAreaItem` - Individual focus area display
4. `ActionItemRow` - Action item with metric/target
5. `MetricCompareCard` - Metric vs team comparison
6. `SGACoachingCard` - Compact SGA card for grid view
7. `ThemeCard` - Coaching theme display for team view

## New API Routes Needed
1. `POST /api/coach-ai/generate` - On-demand coaching generation
2. `GET /api/coach-ai/insight` - Get coaching for current user
3. `GET /api/coach-ai/team` - Get team coaching overview (admin only)
4. `GET /api/cron/generate-coaching` - Weekly batch generation

## New Prisma Models Needed
```prisma
model CoachingInsight {
  id, userEmail, quarter, weekStartDate,
  sqoCount, sqoGoal, sqoRank, expectedSqos, pacingDiff, pacingStatus,
  summary, focusAreas (Json), wins (Json), actionItems (Json),
  conversionRates, activityMetrics, smsBehaviorMetrics,
  modelUsed, promptVersion, generatedAt, viewedAt
}

// User additions:
coachingEmailEnabled, coachingEmailFrequency
```

## Integration Points
1. **SGA Hub** - Add "Coaching" tab (id: 11) after Activity tab
2. **Sidebar** - No change needed (SGA Hub already in nav)
3. **Permissions** - Use existing SGA/admin role checks
4. **Email** - Extend `src/lib/email.ts` with coaching email function
5. **Cron** - Add to `vercel.json` crons array
6. **BigQuery** - Reuse existing `sga-activity.ts` queries
7. **Anthropic** - Reuse pattern from `/api/agent/query`

## Open Technical Decisions
1. **SMS Behavioral Metrics**: Need to confirm which metrics are worth the query complexity
2. **Prompt A/B Testing**: Start with single prompt or build A/B from day one?
3. **Email Frequency**: Weekly only or allow daily option?
4. **Caching Strategy**: Pre-generate weekly or on-demand with cache?
5. **Team View Granularity**: All SGAs or filterable by manager/segment?

---

*Follow-up questions answered: 2026-02-01*
*Ready to append to: C:\Users\russe\Documents\Dashboard\Coach_AI_Questions.md*
