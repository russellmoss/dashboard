# $40M–$100M AUM Advisor Signal Investigation — Findings
**Run Date**: 2026-03-04
**Executed By**: Claude Code (autonomous agent)
**SQL Source**: pipeline/sql/aum_40_100m_signal_profiling.sql
**Status**: FAILED — Environment Setup

---

## Environment Setup — FAILED

### SQL File Check
- **Expected path**: `pipeline/sql/aum_40_100m_signal_profiling.sql`
- **Result**: FILE NOT FOUND
- **Action**: Investigation halted per agent guide instructions ("If either check fails: stop, report the error, do not proceed.")

### Files Found in Repository
Two simpler SQL files exist but do **not** contain the multi-phase query structure required by this guide:

1. `opportunities_aum_40m_100m.sql` (project root) — Simple SELECT of closed-lost opportunities with AUM $40M–$100M from `SavvyGTMData.Opportunity`. No Phase 1 table build, no FINTRX joins, no signal profiling CTEs.
2. `scripts/opportunities_aum_40m_100m.sql` — Identical copy of the above.

### What's Missing
The guide requires a SQL file containing:
- **Phase 1**: `CREATE OR REPLACE TABLE savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile` — a wide enrichment table joining SFDC opportunities to FINTRX signals (ria_contacts_current, Firm_historicals, contact_registered_employment_history)
- **Phase 2 queries (2A–2G)**: Cohort overview, signal distributions by outcome, tenure × outcome, firm AUM × firm size × outcome, AUM band × license type, closed-lost reason breakdown, exclusion analysis

None of these exist in any SQL file in the repository.

### Resolution Required
Before this investigation can proceed, the full `aum_40_100m_signal_profiling.sql` file must be authored and placed at `pipeline/sql/aum_40_100m_signal_profiling.sql`. This file should contain all Phase 1 and Phase 2 query blocks referenced in the agent guide.

---

## Investigation Validation Summary

| Step | Status | Row Count | Key Validation |
|------|--------|-----------|----------------|
| Environment Setup | **FAIL** | N/A | SQL file not found |
| Phase 1 Table Build | NOT RUN | — | Blocked by env setup |
| 2A Cohort Overview | NOT RUN | — | Blocked by Phase 1 |
| 2B Signal Distributions | NOT RUN | — | Blocked by Phase 1 |
| 2C Tenure × Outcome | NOT RUN | — | Blocked by Phase 1 |
| 2D Firm AUM × Size | NOT RUN | — | Blocked by Phase 1 |
| 2E AUM Band × License | NOT RUN | — | Blocked by Phase 1 |
| 2F Lost Reasons | NOT RUN | — | Blocked by Phase 1 |
| 2G Exclusion Analysis | NOT RUN | — | Blocked by Phase 1 |

**Overall Investigation Status**: INCOMPLETE
**Findings Confidence**: N/A
**Ready for Tier Implementation**: No — SQL file must be created first
