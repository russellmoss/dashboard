// src/app/api/explore/feedback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter } from '@/lib/api-authz';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // 1. Authentication - same pattern as agent/query/route.ts
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Use permissions from session (derived from JWT, no DB query)
    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    // Block recruiters - they can't access Explore so shouldn't submit feedback
    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    // 2. Parse request body
    const body = await request.json();
    const { 
      questionId, 
      templateId, 
      question, 
      feedback, 
      comment, 
      compiledQuery, 
      executableSql,
      resultSummary,
      error
    } = body;

    // 3. Validate required fields
    // Note: templateId can be 'error' if query failed before template selection
    if (!questionId || !templateId || !question || !feedback) {
      return NextResponse.json(
        { error: 'Missing required fields: questionId, templateId, question, feedback' },
        { status: 400 }
      );
    }

    // 4. Validate feedback type
    if (feedback !== 'positive' && feedback !== 'negative') {
      return NextResponse.json(
        { error: 'Feedback must be "positive" or "negative"' },
        { status: 400 }
      );
    }

    // 5. For negative feedback, require comment
    if (feedback === 'negative' && (!comment || comment.trim() === '')) {
      return NextResponse.json(
        { error: 'Comment is required for negative feedback' },
        { status: 400 }
      );
    }

    // 6. Save to database
    const feedbackRecord = await prisma.exploreFeedback.create({
      data: {
        userId: session.user.email || null,
        questionId,
        templateId,
        question,
        feedback,
        comment: comment && comment.trim() !== '' ? comment.trim() : null,
        compiledQuery: compiledQuery || null,
        executableSql: executableSql && executableSql.trim() !== '' ? executableSql.trim() : null,
        resultSummary: resultSummary || null,
        error: error && error.trim() !== '' ? error.trim() : null,
      },
    });

    // 7. Log success - same pattern as agent/query/route.ts
    logger.info('Explore feedback saved', {
      feedbackId: feedbackRecord.id,
      userId: session.user.email,
      feedback,
      templateId,
    });

    return NextResponse.json({ 
      success: true, 
      id: feedbackRecord.id 
    });
  } catch (error) {
    // 8. Error handling - same pattern as agent/query/route.ts
    logger.error('Error saving explore feedback', error);
    return NextResponse.json(
      { error: 'Failed to save feedback' },
      { status: 500 }
    );
  }
}
