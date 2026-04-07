# SGA Outbound Volume Capacity Report

**Analysis date**: 2026-04-06
**Period**: October 2025 - March 2026 (6 months)
**Purpose**: Estimate monthly outbound call and SMS capacity at 18 and 20 SGAs

---

## Executive Summary

Over the last 6 months, SGAs averaged **75.8 outbound calls** and **1,625 outbound SMS** per month. The team has been ramping — the Feb-Mar run rate is significantly higher at ~100 calls and ~1,825 SMS per SGA. SMS is the dominant outreach channel at **21x the volume of calls**.

### Capacity Projections

| Scenario | Outbound Calls/Mo | Outbound SMS/Mo |
|----------|-------------------|-----------------|
| **18 SGAs (conservative)** | 1,364 | 29,254 |
| **18 SGAs (steady-state)** | ~1,800 | ~32,850 |
| **20 SGAs (conservative)** | 1,516 | 32,504 |
| **20 SGAs (steady-state)** | ~2,000 | ~36,500 |

*Conservative = 6-month blended average. Steady-state = Feb-Mar 2026 run rate.*

---

## Monthly Team Trend

| Month | SGAs | Cold Calls | Scheduled Calls | Total Calls | Calls/SGA | Outbound SMS | SMS/SGA |
|-------|------|-----------|----------------|------------|----------|-------------|--------|
| Oct 2025 | 9 | 26 | 441 | 467 | 51.9 | 10,424 | 1,158 |
| Nov 2025 | 9 | 23 | 301 | 324 | 36.0 | 8,729 | 970 |
| Dec 2025 | 11 | 46 | 687 | 733 | 66.6 | 14,251 | 1,296 |
| Jan 2026 | 12 | 7 | 641 | 648 | 54.0 | 21,043 | 1,754 |
| Feb 2026 | 13 | 34 | 1,250 | 1,284 | 98.8 | 24,639 | 1,895 |
| Mar 2026 | 16 | 94 | 1,524 | 1,618 | 101.1 | 28,067 | 1,754 |

**Key observations:**
- Team grew from 9 to 16 active SGAs over the period
- Per-SGA call volume nearly doubled from Oct (52) to Mar (101)
- SMS per SGA stabilized around 1,750-1,900 since Jan 2026
- Cold calls are a small fraction (~5%) of total outbound calls

---

## Individual SGA Performance

### SGAs with 3+ months of data (used for projections)

| SGA | Months | Avg Calls/Mo | Avg SMS/Mo |
|-----|--------|-------------|-----------|
| Jason Ainsworth | 4 | 176.3 | 1,499.0 |
| Marisa Saucedo | 6 | 120.3 | 1,910.3 |
| Helen Kamens | 6 | 105.7 | 1,301.8 |
| Russell Armitage | 6 | 105.5 | 1,693.0 |
| Brian O'Hara | 4 | 69.5 | 1,939.0 |
| Eleni Stefanopoulos | 6 | 66.8 | 1,691.5 |
| Perry Kalmeta | 6 | 59.0 | 1,018.8 |
| Ryan Crandall | 6 | 51.5 | 1,767.3 |
| Amy Waller | 6 | 48.2 | 854.3 |
| Channing Guyer | 6 | 41.8 | 1,558.2 |
| Holly Huffman | 3 | 41.0 | 2,256.7 |
| Craig Suchodolski | 6 | 23.8 | 2,012.7 |

**Variance**: Calls range 7x (24-176/mo) while SMS only range 2.6x (854-2,257/mo). SMS volume is much more consistent, likely because it's heavily driven by automated lemlist sequences.

### New SGAs excluded from averages (<3 months)

| SGA | Months | Avg Calls/Mo | Avg SMS/Mo | Note |
|-----|--------|-------------|-----------|------|
| Katie Bassford | 2 | 86.5 | 1,790.0 | Strong early ramp |
| Rashard Wade | 1 | 56.0 | 160.0 | First month |
| Dan Clifford | 1 | 2.0 | 43.0 | Just started |
| Kai Jean-Simon | 1 | 1.0 | 0.0 | Just started |

---

## Methodology

### Definitions (exact dashboard logic)

| Metric | Classification Logic |
|--------|---------------------|
| **Cold Call** | `activity_channel_group = 'Call' AND is_true_cold_call = 1` |
| **Scheduled Call** | `activity_channel_group = 'Call' AND is_true_cold_call = 0 AND direction = 'Outbound' AND subject NOT LIKE '%[lemlist]%'` |
| **Outbound SMS** | `activity_channel_group = 'SMS' AND direction = 'Outbound'` |

- **Active SGA**: `User.IsSGA__c = TRUE AND IsActive = TRUE` with 11-name exclusion list (ACTIVE_SGAS_CTE)
- **Marketing exclusion**: `COALESCE(is_marketing_activity, 0) = 0`
- **Date field**: `task_activity_date` (aligns with SFDC DUE_DATE)
- **Dedup**: `SELECT DISTINCT task_id` to prevent double-counting

### Caveats

1. **SMS includes automated sequences**: Outbound SMS counts include lemlist campaign texts. The dashboard METRIC_CASE only excludes lemlist from Scheduled_Call, not from SMS. Manual vs automated SMS cannot be separated with current classification.

2. **Projection assumes linear scaling**: Multiplying per-SGA averages by headcount assumes new hires will perform at the team average. In practice, new hires ramp over 2-3 months.

3. **"Active months" = months with activity**: An SGA is only counted in months where they logged at least 1 classified task. This inflates per-SGA averages slightly for SGAs who had zero-activity months that were excluded.

---

## Files

| File | Purpose |
|------|---------|
| `analysis-plan.md` | Full analysis plan with definitions, scope, and methodology |
| `report.md` | This report — results and projections |
| `run-analysis.sql` | 4 executable BigQuery queries to reproduce all results |
