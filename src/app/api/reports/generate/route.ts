import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { streamText, generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { authOptions, getSessionUserId } from '@/lib/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { notifyReportComplete } from '@/lib/reporting/finalize';
import { REPORT_AGENTS, buildReportSystemPrompt, buildUserMessage, getPromptVersionHash } from '@/lib/reporting/agents';
import { normalizeReportOutput } from '@/lib/reporting/normalize';
import { STRUCTURE_CONVERSION_PROMPT } from '@/lib/reporting/prompts/structure-conversion';
import { VERIFICATION_PROMPT } from '@/lib/reporting/prompts/verification';
import { ReportOutputSchema, VerificationResultSchema } from '@/lib/reporting/schema';
import { createReportingTools, webSearch } from '@/lib/reporting/tools';
import { getSessionPermissions } from '@/types/auth';
import type { ReportType, ReportOutput } from '@/types/reporting';

export const maxDuration = 300; // Requires Vercel Pro
export const dynamic = 'force-dynamic';

const VALID_TYPES: ReportType[] = ['analyze-wins', 'sga-performance', 'sgm-analysis', 'competitive-intel'];

interface GenerateReportInput {
  type: ReportType;
  customPrompt: string | null;
  parameters: Record<string, string> | null;
}

function logJobPhase(
  jobId: string,
  phase: string,
  startTime: number,
  context?: Record<string, unknown>
) {
  logger.info('[report-job] phase', {
    jobId,
    phase,
    elapsedMs: Date.now() - startTime,
    ...context,
  });
}

function extractJsonPayload(text: string): unknown {
  return JSON.parse(text.replace(/^```json\n?|```$/g, '').trim());
}

function parseStructuredReport(raw: string, type: ReportType): ReportOutput {
  const parsed = extractJsonPayload(raw);
  const normalized = normalizeReportOutput(parsed, type);
  return ReportOutputSchema.parse(normalized) as ReportOutput;
}

async function runReportGeneration(
  jobId: string,
  userEmail: string,
  { type, customPrompt, parameters }: GenerateReportInput
) {
  const startTime = Date.now();

  try {
    logJobPhase(jobId, 'started', startTime, { type, hasCustomPrompt: Boolean(customPrompt) });
    const agent = REPORT_AGENTS[type];
    const {
      runBigQuery,
      describeReportingSchema,
      runSgmAnalysisSection,
      runCompetitiveIntelSection,
      runAnalyzeWinsSection,
      runSgaPerformanceSection,
      getQueryLog,
    } = createReportingTools(type);

    const tools: Record<string, typeof runBigQuery | typeof describeReportingSchema | typeof runSgmAnalysisSection | typeof runCompetitiveIntelSection | typeof runAnalyzeWinsSection | typeof runSgaPerformanceSection | typeof webSearch> = {
      describeReportingSchema,
    };
    if (type === 'sgm-analysis') {
      tools.runSgmAnalysisSection = runSgmAnalysisSection;
    } else if (type === 'analyze-wins') {
      tools.runAnalyzeWinsSection = runAnalyzeWinsSection;
    } else if (type === 'sga-performance') {
      tools.runSgaPerformanceSection = runSgaPerformanceSection;
    } else if (type === 'competitive-intel') {
      tools.runCompetitiveIntelSection = runCompetitiveIntelSection;
    } else {
      tools.runBigQuery = runBigQuery;
    }
    if (type === 'competitive-intel') {
      tools.webSearch = webSearch;
    }

    const userMessage = buildUserMessage(type, customPrompt, parameters);
    logJobPhase(jobId, 'pass1.begin', startTime, {
      toolNames: Object.keys(tools),
      maxSteps: agent.maxSteps,
    });

    let narrative = '';
    let pass1Usage: Awaited<ReturnType<typeof streamText>['usage']> | null = null;
    let pass1AttemptError: unknown = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (attempt > 1) {
          logJobPhase(jobId, 'pass1.retry.begin', startTime, { attempt });
        }

        if (attempt === 1) {
          const pass1Result = await streamText({
            model: anthropic('claude-sonnet-4-6'),
            system: buildReportSystemPrompt(type),
            prompt: userMessage,
            tools,
            stopWhen: stepCountIs(agent.maxSteps),
            onStepFinish: async () => {
              await prisma.reportJob.update({
                where: { id: jobId },
                data: { stepsCompleted: { increment: 1 } },
              });
            },
          });

          narrative = await pass1Result.text;
          pass1Usage = await pass1Result.usage;
        } else {
          const fallbackResult = await generateText({
            model: anthropic('claude-sonnet-4-6'),
            system: buildReportSystemPrompt(type),
            prompt: userMessage,
            tools,
            stopWhen: stepCountIs(agent.maxSteps),
            onStepFinish: async () => {
              await prisma.reportJob.update({
                where: { id: jobId },
                data: { stepsCompleted: { increment: 1 } },
              });
            },
          });

          narrative = fallbackResult.text;
          pass1Usage = fallbackResult.usage;
        }

        pass1AttemptError = null;
        break;
      } catch (error) {
        pass1AttemptError = error;
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('[report-job] pass1 stream failed', {
          jobId,
          elapsedMs: Date.now() - startTime,
          attempt,
          error: message,
        });

        if (!message.includes('No output generated') || attempt === 2) {
          throw error;
        }
      }
    }

    if (!narrative && pass1AttemptError) {
      throw pass1AttemptError;
    }

    const queryLog = getQueryLog();
    logJobPhase(jobId, 'pass1.complete', startTime, {
      narrativeChars: narrative.length,
      queryCount: queryLog.length,
      totalTokens: pass1Usage?.totalTokens ?? 0,
    });

    await prisma.reportJob.update({
      where: { id: jobId },
      data: { queryLog: queryLog as object },
    });
    logJobPhase(jobId, 'queryLog.persisted', startTime, { queryCount: queryLog.length });

    let verifiedNarrative = narrative;

    logJobPhase(jobId, 'verification.begin', startTime, { queryCount: queryLog.length });
    const verificationResult = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: VERIFICATION_PROMPT,
      prompt: `Narrative:\n${narrative}\n\nQuery Results:\n${JSON.stringify(
        queryLog.map(q => ({
          description: q.description,
          sql: q.sql,
          rows: q.rows,
          rowCount: q.rowCount,
        })),
        null,
        0
      )}`,
    });
    logJobPhase(jobId, 'verification.response', startTime, {
      responseChars: verificationResult.text.length,
      totalTokens: verificationResult.usage?.totalTokens ?? 0,
    });

    try {
      const verification = VerificationResultSchema.parse(
        JSON.parse(verificationResult.text.replace(/^```json\n?|```$/g, '').trim())
      );
      logJobPhase(jobId, 'verification.parsed', startTime, {
        verified: verification.verified,
        issueCount: verification.issues.length,
        errorIssueCount: verification.issues.filter(issue => issue.severity === 'error').length,
      });

      await prisma.reportJob.update({
        where: { id: jobId },
        data: { verificationResult: verification as object },
      });
      logJobPhase(jobId, 'verification.persisted', startTime);

      if (!verification.verified && verification.issues.some(issue => issue.severity === 'error') && verification.corrections) {
        logJobPhase(jobId, 'verification.corrections.begin', startTime, {
          correctionChars: verification.corrections.length,
        });
        const correctionResult = await generateText({
          model: anthropic('claude-sonnet-4-6'),
          system: `You are correcting specific factual errors in a report narrative.
Apply ONLY the corrections listed below. Do not change anything else about the narrative.
Preserve all structure, formatting, and analysis - only fix the specific numbers flagged.`,
          prompt: `Original narrative:\n${narrative}\n\nCorrections to apply:\n${verification.corrections}`,
        });
        verifiedNarrative = correctionResult.text;
        logJobPhase(jobId, 'verification.corrections.complete', startTime, {
          correctedNarrativeChars: verifiedNarrative.length,
          totalTokens: correctionResult.usage?.totalTokens ?? 0,
        });
      }
    } catch (error) {
      logger.warn('[report-job] verification parse failed', {
        jobId,
        elapsedMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      // Verification is best-effort. Continue with the original narrative if parsing fails.
    }

    logJobPhase(jobId, 'pass2.begin', startTime, {
      narrativeChars: verifiedNarrative.length,
      queryCount: queryLog.length,
    });
    const pass2Result = await generateText({
      model: anthropic('claude-sonnet-4-6'),
      system: STRUCTURE_CONVERSION_PROMPT,
      prompt: `
Here is the report narrative:
${verifiedNarrative}

Here are the query results that produced it:
${JSON.stringify(
  queryLog.map(q => ({
    description: q.description,
    sql: q.sql,
    rows: q.rows,
    rowCount: q.rowCount,
  })),
  null,
  0
)}

Convert this into the ReportOutput JSON schema.
Report type: "${type}"
`,
    });
    logJobPhase(jobId, 'pass2.response', startTime, {
      responseChars: pass2Result.text.length,
      totalTokens: pass2Result.usage?.totalTokens ?? 0,
    });

    let reportJson: ReportOutput;
    try {
      logJobPhase(jobId, 'pass2.parse.begin', startTime);
      reportJson = parseStructuredReport(pass2Result.text, type);
      logJobPhase(jobId, 'pass2.parse.complete', startTime, {
        sectionCount: reportJson.sections.length,
        keyMetricCount: reportJson.keyMetrics.length,
        recommendationCount: reportJson.recommendations.length,
      });
    } catch (validationError) {
      logger.warn('[report-job] pass2 parse failed', {
        jobId,
        elapsedMs: Date.now() - startTime,
        error: validationError instanceof Error ? validationError.message : String(validationError),
      });
      try {
        logJobPhase(jobId, 'pass2.retry.begin', startTime);
        const retryResult = await generateText({
          model: anthropic('claude-sonnet-4-6'),
          system: STRUCTURE_CONVERSION_PROMPT,
          prompt: `
Your previous JSON output failed validation with this error:
${validationError instanceof Error ? validationError.message : String(validationError)}

Here is the report narrative:
${verifiedNarrative}

Here are the query results:
${JSON.stringify(queryLog.map(q => ({ description: q.description, rows: q.rows })), null, 0)}

Fix the JSON and try again. Output ONLY the corrected JSON.
`,
        });
        logJobPhase(jobId, 'pass2.retry.response', startTime, {
          responseChars: retryResult.text.length,
          totalTokens: retryResult.usage?.totalTokens ?? 0,
        });

        reportJson = parseStructuredReport(retryResult.text, type);
        logJobPhase(jobId, 'pass2.retry.parse.complete', startTime, {
          sectionCount: reportJson.sections.length,
          keyMetricCount: reportJson.keyMetrics.length,
          recommendationCount: reportJson.recommendations.length,
        });
      } catch (retryError) {
        logger.error('[report-job] pass2 retry failed', retryError, {
          jobId,
          elapsedMs: Date.now() - startTime,
        });
        await prisma.reportJob.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            error: `Structured formatting failed after retry: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
            reportJson: { rawNarrative: verifiedNarrative } as object,
            durationMs: Date.now() - startTime,
          },
        });
        return;
      }
    }

    const totalTokens = (pass1Usage?.totalTokens ?? 0) + (pass2Result.usage?.totalTokens ?? 0);
    logJobPhase(jobId, 'persist.begin', startTime, {
      totalTokens,
      sectionCount: reportJson.sections.length,
    });

    await prisma.reportJob.update({
      where: { id: jobId },
      data: {
        status: 'complete',
        reportJson: reportJson as object,
        extractedMetrics: reportJson.keyMetrics as object,
        totalTokens,
        durationMs: Date.now() - startTime,
        completedAt: new Date(),
      },
    });
    logJobPhase(jobId, 'persist.complete', startTime, {
      totalTokens,
      completed: true,
    });

    logJobPhase(jobId, 'notify.begin', startTime, { userEmail });
    await notifyReportComplete(jobId, userEmail);
    logJobPhase(jobId, 'notify.complete', startTime);
  } catch (error) {
    logger.error('[runReportGeneration] Error:', error);
    await prisma.reportJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Failed to generate report',
        durationMs: Date.now() - startTime,
      },
    });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    const recruiterBlock = forbidRecruiter(permissions);
    if (recruiterBlock) return recruiterBlock;

    const cpBlock = forbidCapitalPartner(permissions);
    if (cpBlock) return cpBlock;

    if (!permissions.allowedPages.includes(17)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const userId = getSessionUserId(session);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { type, customPrompt, parameters } = await req.json();

    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: `Invalid report type: ${type}` }, { status: 400 });
    }

    const agent = REPORT_AGENTS[type as ReportType];
    if (agent.requiredParams) {
      for (const param of agent.requiredParams) {
        if (!parameters?.[param]) {
          return NextResponse.json({ error: `Missing required parameter: ${param}` }, { status: 400 });
        }
      }
    }

    const job = await prisma.reportJob.create({
      data: {
        type,
        customPrompt: customPrompt || null,
        parameters: parameters || null,
        requestedById: userId,
        status: 'running',
        promptVersion: getPromptVersionHash(type as ReportType),
      },
    });

    logger.info('[report-job] queued', {
      jobId: job.id,
      type,
      requestedById: userId,
      hasCustomPrompt: Boolean(customPrompt),
    });

    void runReportGeneration(job.id, session.user.email, {
      type: type as ReportType,
      customPrompt: customPrompt || null,
      parameters: parameters || null,
    });

    return NextResponse.json(
      {
        id: job.id,
        status: 'running',
      },
      { status: 202 }
    );
  } catch (error) {
    logger.error('[POST /api/reports/generate] Error:', error);
    return NextResponse.json({ error: 'Failed to queue report generation' }, { status: 500 });
  }
}
