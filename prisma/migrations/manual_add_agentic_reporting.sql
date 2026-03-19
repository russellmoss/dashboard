-- Migration: Add Agentic Reporting Models
-- Apply manually in Neon SQL Editor

CREATE TABLE "ReportJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedById" TEXT NOT NULL,
    "customPrompt" TEXT,
    "parameters" JSONB,
    "reportJson" JSONB,
    "queryLog" JSONB,
    "extractedMetrics" JSONB,
    "verificationResult" JSONB,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "stepsCompleted" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER,
    "durationMs" INTEGER,
    "error" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReportJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReportShare" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "sharedWithId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportShare_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReportConversation" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportConversation_pkey" PRIMARY KEY ("id")
);

-- Indexes for ReportJob
CREATE INDEX "ReportJob_type_requestedById_createdAt_idx" ON "ReportJob"("type", "requestedById", "createdAt" DESC);
CREATE INDEX "ReportJob_requestedById_idx" ON "ReportJob"("requestedById");
CREATE INDEX "ReportJob_status_idx" ON "ReportJob"("status");
CREATE INDEX "ReportJob_type_idx" ON "ReportJob"("type");

-- Indexes for ReportShare
CREATE UNIQUE INDEX "ReportShare_reportId_sharedWithId_key" ON "ReportShare"("reportId", "sharedWithId");
CREATE INDEX "ReportShare_reportId_idx" ON "ReportShare"("reportId");
CREATE INDEX "ReportShare_sharedWithId_idx" ON "ReportShare"("sharedWithId");

-- Indexes for ReportConversation
CREATE INDEX "ReportConversation_reportId_createdAt_idx" ON "ReportConversation"("reportId", "createdAt");

-- Foreign Keys
ALTER TABLE "ReportJob" ADD CONSTRAINT "ReportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ReportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportShare" ADD CONSTRAINT "ReportShare_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReportConversation" ADD CONSTRAINT "ReportConversation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ReportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
