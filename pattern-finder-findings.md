# Pattern Finder Findings - Per-Dimension AI Narrative

Saved to file. Full findings returned as assistant message above.

## Key file paths referenced:

- src/lib/sales-coaching-client/index.ts (bridge client, editEvaluation pattern)
- src/app/api/call-intelligence/evaluations/[id]/edit/route.ts (auth model)
- src/components/call-intelligence/citation-helpers.ts (readCitedItems, isFieldSupportedByAiOriginalVersion)
- src/app/dashboard/call-intelligence/evaluations/[id]/EvalDetailClient.tsx (CitedTextLine, isAdmin gate)
- src/components/call-intelligence/InsightsEvalDetailModal.tsx (CitedText, secondary impl)
- src/components/call-intelligence/CitationPill.tsx (citation pill component)
- src/components/call-intelligence/InlineEditDimensionScore.tsx (inline edit widget)
- src/types/call-intelligence.ts (EvaluationDetail type)
- src/lib/sales-coaching-client/schemas.ts (CitedTextDashSchema, DimensionScoreDashSchema)
- src/lib/permissions.ts (canEditRubrics, RUBRIC_EDITOR_ROLES)
- src/app/dashboard/call-intelligence/CallIntelligenceClient.tsx (isAdmin tab gating)
- scripts/backfill-coaching-what-id.cjs (backfill pattern: .cjs, --commit, WHERE IS NULL)
- scripts/sms-reclassify-step2-classify.js (batch AI pattern: sleep(200), 429 retry)
- scripts/check-schema-mirror.cjs (bridge mirror CI check)
- .claude/skills/sync-bridge-schema/SKILL.md (mirror sync workflow)
