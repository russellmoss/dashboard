# Data Verifier Findings — Kixie Call Transcription Pipeline

Generated: 2026-04-27. Synthesis from prior /plan research. BQ queries cited were run live during /plan via schema-context MCP for field validation.

Source plan: `docs/plans/2026-04-27-001-feat-kixie-call-transcription-pipeline-plan.md`.

## Critical Correction From User's Original Assumption

User's seed plan said `Direction = 'Outbound' AND CallDisposition IN ('Answered', 'Connected', 'Meaningful Connect')`. **This is wrong.**

| Field | Status | Notes |
|---|---|---|
| `SavvyGTMData.Task.CallDisposition` | NULL on 100% of rows | Standard SF field; Kixie does not write to it |
| `SavvyGTMData.Task.CallDispose__c` | <300 rows in 18mo (vs 6,222 calls) | Custom field; sparse, unreliable |
| `SavvyGTMData.Task.Subject` | Reliable signal | `'answered: Outbound call.'` is canonical |
| `SavvyGTMData.Task.Description` | 100% kixie URL coverage on answered outbound | mp3 URL source |
| `SavvyGTMData.Task.Type / TaskSubtype` | `'Call'` value | Use OR — both populated inconsistently |
| `SavvyGTMData.Task.CallDurationInSeconds` | Populated | Filter for voicemails |
| `SavvyGTMData.Task.WhoId` | 93.3% populated | Join key to vw_funnel_master |

## Correct Filter SQL

```sql
WHERE IsDeleted = FALSE
  AND (Type = 'Call' OR TaskSubtype = 'Call')
  AND LOWER(Subject) LIKE 'answered:%'
  AND CallDurationInSeconds >= @minDuration
  AND REGEXP_CONTAINS(Description, r'https://calls\.kixie\.com/[0-9a-f-]+\.mp3')
```

## Volume + Cost Estimates (verified)

| Bucket | Count (18mo) | % | Notes |
|---|---|---|---|
| All answered outbound | 6,222 | 100% | `Subject LIKE 'answered:%'` |
| <60s | 3,320 | 53.4% | Skip by default |
| 60s–10min | 1,737 | 27.9% | Sweet spot |
| 10–30min | 906 | 14.6% | Discovery calls |
| 30–60min | 254 | 4.1% | Deal-review calls |
| >60min | 5 | 0.1% | Outliers |
| **After ≥60s filter** | **2,902** | — | Backfill scope |

**Cost** (AssemblyAI Universal-2 + diarization @ $0.17/hr, Claude Sonnet 4.6 ~$0.02/call):
- Backfill skip <60s: ~$290
- Backfill all: ~$622
- Forward run rate: ~900–1,300/mo (March 2026 = 1,290)
- Steady-state monthly: ~$60–100

## Description Field Format

10 sampled values, 100% match:

```
answered: A {N} {minute|second} Outbound call. A recording of the call is here:
  https://calls.kixie.com/{uuid}.mp3
  The call was made from +{phone} to +{phone}
```

**Reliable regex:**
```
https://calls\.kixie\.com/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp3
```

Looser fallback:
```
https://calls\.kixie\.com/[0-9a-f-]+\.mp3
```

## Edge Cases

- One Voicemail Task observed where `Subject = 'Voicemail'` but body began `"answered: A 37 second Outbound call..."`. `Subject` filter alone catches the intended cases cleanly. Optional broadening: `OR LOWER(Description) LIKE '%calls.kixie.com%'`.
- WhoId NULL on 6.7% of answered outbound calls — no funnel context but transcripts still storable.

## Funnel Master Join Coverage

- WhoId populated 93.3%; among populated, 78.1% join to `vw_funnel_master`. Overall: **72.9%** linkage from all answered outbound calls to funnel.
- 27% of transcripts will lack stage/SGA-attribution context.
- Non-blocking for transcription. Limits analytics enrichment.

## View Modifications

**None needed** for any phase. Plan reads directly from `SavvyGTMData.Task` and writes to a new Postgres table. `vw_sga_activity_performance` and friends are unmodified.

## Schema-Context MCP Verification

All field references confirmed via:
- `describe_view` on `SavvyGTMData.Task`
- `describe_view` on `Tableau_Views.vw_funnel_master`
- `.claude/bq-activity-layer.md`
- `.claude/schema-config.yaml`

No fields guessed. Exact Salesforce casing captured.

## Risks

- **Kixie 18-month archive cutoff is UNVERIFIED.** Help center pages returned empty. Mitigation: spot-check 3 sample URLs of varying ages before backfill (Plan Unit 2.10).
- **Funnel match rate 73%, not 95%+** — flag for analytics expectations, not a transcription blocker.

## Data Quality

- NULLs on optional fields handled by COALESCE convention.
- No special-character issues in sampled Descriptions.
- `Description` field caps at ~32K chars in Salesforce — well within BQ STRING limits.

## Population Rate Spot-Check (last 30 days)

```sql
-- Verified during /plan exploration
SELECT
  COUNT(*) AS total_answered_outbound,
  COUNTIF(REGEXP_CONTAINS(Description, r'https://calls\.kixie\.com/')) AS with_kixie_url,
  COUNTIF(WhoId IS NOT NULL) AS with_whoid,
  AVG(CallDurationInSeconds) AS avg_duration_sec
FROM `savvy-gtm-analytics.SavvyGTMData.Task`
WHERE IsDeleted = FALSE
  AND (Type = 'Call' OR TaskSubtype = 'Call')
  AND LOWER(Subject) LIKE 'answered:%'
  AND CreatedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
```

Result: 839 total / 839 with_kixie_url / 783 with_whoid / 254s avg duration. Coverage validated.
