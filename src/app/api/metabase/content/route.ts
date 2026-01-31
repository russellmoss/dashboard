// src/app/api/metabase/content/route.ts
// ═══════════════════════════════════════════════════════════════════════
// METABASE CONTENT API
// Fetches saved questions and dashboards from Metabase
// ═══════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import {
  getMetabaseQuestions,
  getMetabaseDashboards,
  isMetabaseApiConfigured,
  getQuestionEmbedUrl,
  getDashboardEmbedUrl,
  validateMetabaseConfig,
} from '@/lib/metabase';

const PAGE_ID = 14; // Chart Builder page

export async function GET() {
  // Verify authentication
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check permissions
  const permissions = getSessionPermissions(session);

  if (!permissions || !permissions.allowedPages.includes(PAGE_ID)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Check if Metabase API is configured
  if (!isMetabaseApiConfigured()) {
    return NextResponse.json({
      questions: [],
      dashboards: [],
      configured: false,
      message: 'Metabase API credentials not configured',
    });
  }

  try {
    // Fetch questions and dashboards in parallel
    const [questions, dashboards] = await Promise.all([
      getMetabaseQuestions(),
      getMetabaseDashboards(),
    ]);

    // Check if embedding is configured (has secret key)
    const embedConfig = validateMetabaseConfig();
    const canEmbed = embedConfig.valid;

    // Generate signed embed URLs if embedding is configured
    const questionsWithEmbedUrls = questions.map(q => ({
      ...q,
      embedUrl: canEmbed ? getQuestionEmbedUrl(q.id) : null,
    }));

    const dashboardsWithEmbedUrls = dashboards.map(d => ({
      ...d,
      embedUrl: canEmbed ? getDashboardEmbedUrl(d.id) : null,
    }));

    return NextResponse.json({
      questions: questionsWithEmbedUrls,
      dashboards: dashboardsWithEmbedUrls,
      configured: true,
      embeddingEnabled: canEmbed,
    });
  } catch (error) {
    console.error('Error fetching Metabase content:', error);
    return NextResponse.json({
      questions: [],
      dashboards: [],
      configured: true,
      error: 'Failed to fetch content from Metabase',
    });
  }
}
