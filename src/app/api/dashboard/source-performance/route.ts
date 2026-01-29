import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getChannelPerformance, getSourcePerformance } from '@/lib/queries/source-performance';
import { getChannelForecastGoals, getSourceForecastGoals } from '@/lib/queries/forecast-goals';
import { getUserPermissions } from '@/lib/permissions';
import { forbidRecruiter } from '@/lib/api-authz';
import { DashboardFilters } from '@/types/filters';
import { 
  ChannelPerformance, 
  SourcePerformance,
  ChannelPerformanceWithGoals,
  SourcePerformanceWithGoals 
} from '@/types/dashboard';

export const dynamic = 'force-dynamic';

// Helper to merge channel performance with goals
function mergeChannelGoals(
  channels: ChannelPerformance[],
  goals: { channel: string; prospects: number; mqls: number; sqls: number; sqos: number; joined: number }[]
): ChannelPerformanceWithGoals[] {
  const goalsMap = new Map(goals.map(g => [g.channel, g]));
  
  return channels.map(channel => ({
    ...channel,
    goals: goalsMap.get(channel.channel) || undefined,
  }));
}

// Helper to merge source performance with goals
function mergeSourceGoals(
  sources: SourcePerformance[],
  goals: { source: string; channel: string; prospects: number; mqls: number; sqls: number; sqos: number; joined: number }[]
): SourcePerformanceWithGoals[] {
  // Match on both source and channel since a source can appear in multiple channels
  const goalsMap = new Map(goals.map(g => [`${g.source}::${g.channel}`, g]));
  
  return sources.map(source => ({
    ...source,
    goals: goalsMap.get(`${source.source}::${source.channel}`) || undefined,
  }));
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user?.email || '');
    // Block recruiters from main dashboard endpoints
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;
    
    const body = await request.json();
    const filters: DashboardFilters = body.filters;
    const groupBy: 'channel' | 'source' = body.groupBy || 'source';
    
    // Note: SGA/SGM filters are NOT automatically applied to main dashboard
    // (Non-recruiter users can see all data on the funnel performance dashboard)
    
    if (groupBy === 'channel') {
      // Fetch channel performance and goals in parallel
      // Use allSettled so goals failure doesn't break the entire request
      const [channelsResult, channelGoalsResult] = await Promise.allSettled([
        getChannelPerformance(filters),
        getChannelForecastGoals(filters).catch((error) => {
          // Log but don't fail - goals are optional
          console.error('Channel forecast goals query failed (non-critical):', error);
          return [];
        }),
      ]);
      
      // If channels failed, throw error
      if (channelsResult.status === 'rejected') {
        throw channelsResult.reason;
      }
      
      const channels = channelsResult.value;
      const channelGoals = channelGoalsResult.status === 'fulfilled' ? channelGoalsResult.value : [];
      
      const channelsWithGoals = mergeChannelGoals(channels, channelGoals);
      
      return NextResponse.json({ channels: channelsWithGoals });
    } else {
      // Fetch source performance and goals in parallel
      // Pass channel filter to goals query if filtering by channel
      // Use allSettled so goals failure doesn't break the entire request
      const [sourcesResult, sourceGoalsResult] = await Promise.allSettled([
        getSourcePerformance(filters),
        getSourceForecastGoals(filters, filters.channel).catch((error) => {
          // Log but don't fail - goals are optional
          console.error('Source forecast goals query failed (non-critical):', error);
          return [];
        }),
      ]);
      
      // If sources failed, throw error
      if (sourcesResult.status === 'rejected') {
        throw sourcesResult.reason;
      }
      
      const sources = sourcesResult.value;
      const sourceGoals = sourceGoalsResult.status === 'fulfilled' ? sourceGoalsResult.value : [];
      
      const sourcesWithGoals = mergeSourceGoals(sources, sourceGoals);
      
      return NextResponse.json({ sources: sourcesWithGoals });
    }
  } catch (error) {
    console.error('Source performance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
