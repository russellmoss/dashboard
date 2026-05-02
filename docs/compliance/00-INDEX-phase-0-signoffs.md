# Phase 0 — Compliance & Pre-Flight Sign-Offs

**Project:** Kixie Call Transcription + AI Notes Pipeline
**Plan:** `docs/plans/2026-04-27-001-feat-kixie-call-transcription-pipeline-plan.md`
**Created:** 2026-04-27
**Status:** 🟡 In Progress

This is the master tracker for Phase 0. **No engineering work proceeds beyond the decoupled mp3 backfill download (Unit 1.6) until all four units below are signed off.** The mp3 backfill itself is gated only on Unit 0.3 (Kixie consent) since GCS storage of recordings doesn't introduce vendor-AI scope; everything past that needs all four.

## Phase 0 Sign-Off Checklist

| Unit | Topic | Status | Approver | Date |
|---|---|---|---|---|
| 0.1 | Anthropic Enterprise / ZDR verification | ⬜ Pending | TBD | — |
| 0.2 | AssemblyAI DPA + zero-retention configuration | ⬜ Pending | TBD | — |
| 0.3 | Kixie consent posture audit | ⬜ Pending | TBD (Legal) | — |
| 0.4 | GCS bucket security policy approval | ⬜ Pending | TBD | — |

When complete, change ⬜ to ✅, fill in approver name + date, and update top-of-file status to 🟢 Complete.

## Why Phase 0 Exists

Both adversarial reviewers (Codex + Gemini) flagged that the original plan shipped prospect financial PII to Anthropic and AssemblyAI without verifying:
- Vendor data-handling agreements
- Two-party consent posture for existing Kixie recordings
- Security baseline for the GCS audio retention bucket

This is FINRA/SEC risk for a financial services firm. Phase 0 verifies these BEFORE any code that calls vendor APIs runs in production.

## Unit Summaries

### Unit 0.1 — Anthropic
**Doc:** `01-anthropic-zdr.md`
**Goal:** Verify default training-prohibition (already true per Commercial Terms), evaluate whether Enterprise/ZDR tier is required for prospect financial data, document the answer.
**Key finding (preliminary):** Anthropic's standard Commercial Terms already prohibit training on customer content. ZDR (zero data retention beyond the 30-day trust-and-safety window) requires an Enterprise contract. Decision needed: is the default policy sufficient for our risk profile, or do we need ZDR?

### Unit 0.2 — AssemblyAI
**Doc:** `02-assemblyai-dpa.md`
**Goal:** Sign DPA (or confirm one exists), enable zero-retention or ephemeral processing if needed, confirm SOC 2 / GDPR posture covers our use case.
**Key finding (preliminary):** AssemblyAI publicly states SOC 2 Type 2, GDPR-assessed, PCI-DSS 4.0 Level 1. DPA + retention specifics are in their Trust Center (require account access).

### Unit 0.3 — Kixie consent
**Doc:** `03-kixie-consent-posture.md`
**Goal:** Audit existing Kixie recordings against the 12-state two-party-consent law set. Confirm disclosure language is in place. If gap, work with Legal on remediation language.
**Key finding (preliminary):** Sampled Kixie call descriptions don't show a consent-disclosure pattern in metadata. Verbal disclosure at call-start (if any) is in the audio itself. Need to listen to 5 recent recordings to verify.

### Unit 0.4 — GCS bucket security
**Doc:** `04-gcs-call-recordings-policy.md`
**Setup commands:** `04-gcs-bucket-setup-commands.sh` (DO NOT execute until Unit 0.4 is signed off)
**Goal:** Approve the bucket security spec (UBLA, public-access prevention, CMEK, lifecycle, audit logs) and document the approver.
**Key finding (preliminary):** Bucket does not yet exist. Spec is ready; commands written but not run. User decision Q2 = 1-year auto-delete already captured.

## What Happens After Sign-Off

Once all 4 units are ✅:
1. Update top-of-file status to 🟢 Complete
2. Run `04-gcs-bucket-setup-commands.sh` to create the bucket
3. Run the decoupled mp3 backfill (Unit 1.6) to start preserving Kixie recordings
4. Begin Phase 1+2 implementation (`/work` on the plan)

## Operational Note

**Do not block on Anthropic Enterprise/ZDR if the default training-prohibition is judged sufficient for our risk profile.** The Commercial Terms quote in 01-anthropic-zdr.md is concrete contractual language — many companies operate under that without ZDR. Document the decision either way.
