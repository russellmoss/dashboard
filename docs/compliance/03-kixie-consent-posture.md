# Unit 0.3 — Kixie Call Recording Consent Posture Audit

**Status:** ⬜ Pending
**Approver:** TBD (Legal review required)
**Date signed off:** —

## Goal

Audit Savvy's existing Kixie call recordings to confirm:
1. Recordings were captured with appropriate two-party consent for the states involved
2. Consent disclosure (if applicable) covers AI processing of the recording
3. Existing recordings can lawfully be used for transcription + AI note generation
4. Identify any gap requiring updated disclosure language going forward

## Two-Party Consent State Matrix (2026)

12 states require **all-party (two-party) consent** to record a phone call. The federal default and the other 38 states require only **one-party consent** (the recorder's consent suffices).

| Two-Party Consent States | Notes |
|---|---|
| California | CIPA — civil + criminal liability |
| Connecticut | |
| Delaware | |
| Florida | |
| Illinois | Eavesdropping statute (2014 amendment) |
| Maryland | |
| Massachusetts | Strict — no exception even when one party knows |
| Michigan | Participant-monitoring exception (case law) |
| Montana | |
| New Hampshire | |
| Oregon | Federal preemption issues for law enforcement |
| Pennsylvania | |
| Washington | |

**Interstate calls:** Federal courts apply the **stricter law** (party with the higher-protection state's law usually wins). Standard industry practice: treat all calls as if the strictest applicable jurisdiction governs.

**Implication for Savvy:** Because Savvy's SGAs talk to advisors anywhere in the U.S., we must operate as if **all calls are governed by two-party consent** unless the call participant set is verifiably both in one-party states.

Sources:
- [Justia — 50 State Survey: Recording Phone Calls and Conversations](https://www.justia.com/50-state-surveys/recording-phone-calls-and-conversations/)
- [Recording Law — Two-Party Consent States 2026](https://www.recordinglaw.com/party-two-party-consent-states/)
- [NextPhone — Call Recording Laws by State 2026](https://www.getnextphone.com/blog/call-recording-laws-by-state)

## What "Consent" Looks Like Operationally

Two-party consent is satisfied when **all parties on the call are aware that the call is being recorded** before recording begins. Industry-standard methods:

1. **Verbal disclosure** at call start: *"Hi this is [SGA name] from Savvy Wealth — please note this call may be recorded for quality and training purposes."*
2. **Beep tones** at the start of the recording (some jurisdictions accept these alone)
3. **Written disclosure** in pre-call email (acceptable in some jurisdictions but generally insufficient on its own)

**For AI processing:** The standard "recorded for quality and training purposes" language has historically covered internal QA and training of human staff. Whether it covers AI processing (transcription + LLM analysis + structured note generation) is **legally untested but generally interpreted broadly** if the data stays within the company's vendor stack and is not sold or shared.

## Audit Checklist

### Step 1 — Confirm Kixie configuration

Log into Kixie admin. Verify:
- [ ] Call recording is enabled for the SGA team
- [ ] An audible disclosure or beep tone is configured (Kixie Settings → Recording → Disclosure)
- [ ] If verbal-only disclosure, verify SGAs have been trained to deliver it
- [ ] Document the current configuration

### Step 2 — Sample 5 recent recordings

Listen to the first 30 seconds of 5 random recent answered outbound calls:

| Task ID | Date | Disclosure heard? | Notes |
|---|---|---|---|
| ___ | ___ | [ ] Yes [ ] No | |
| ___ | ___ | [ ] Yes [ ] No | |
| ___ | ___ | [ ] Yes [ ] No | |
| ___ | ___ | [ ] Yes [ ] No | |
| ___ | ___ | [ ] Yes [ ] No | |

If 4/5 or 5/5 have disclosure, posture is acceptable. If ≤3/5, pause and address with Legal.

### Step 3 — Legal review of existing-recording usage for AI processing

Forward this document + the audit results to Savvy's legal counsel. Ask specifically:

> *"We're proposing to take existing call recordings (made under our standard 'recorded for quality and training' disclosure) and run them through an AI transcription + summarization pipeline. The output is structured notes used internally for sales handoff. Recordings and transcripts stay within our vendor stack (AssemblyAI, Anthropic) under their respective DPAs. Does this fall within the scope of the original consent, or do we need additional disclosure / opt-in for AI processing specifically?"*

**Document Legal's response:** ___________

### Step 4 — Forward-going disclosure update

Even if Legal greenlights existing recordings, consider updating the disclosure language for **new** recordings to be explicit:

> *"...this call may be recorded for quality, training, and AI-assisted note generation purposes."*

Adds 4 words. Removes any future ambiguity. Recommend implementing in Kixie Settings before Phase 1+2 ship.

### Step 5 — Identify any "do not record" advisor flags

Some advisors may have requested no-recording during prior calls. Verify:
- [ ] Kixie supports a per-contact "do not record" flag
- [ ] If yes, the pipeline must respect it (skip transcription for any Task linked to a flagged advisor)
- [ ] Add a note to the data-verifier Phase 1 task: confirm a flag exists in the Salesforce + Kixie schema

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Existing recordings lack disclosure → unlawful in 2-party states | LOW (standard practice is to enable Kixie's beep) | HIGH (criminal liability in CA/MA/etc.) | Audit Step 2; Legal review Step 3 |
| Standard disclosure doesn't cover AI processing | UNKNOWN | MEDIUM (probable consent-in-fact, but legally untested) | Update forward-going disclosure (Step 4); consult Legal |
| Advisor objects after the fact | LOW | LOW (delete on request, follow GDPR/CCPA-style data subject rights) | Build a "delete transcript" admin action in dashboard |

## Sign-Off

**Audit completed:** [ ] Yes
**Disclosure verified on sampled recordings:** ___ / 5
**Legal review completed:** [ ] Yes (date: ___________, reviewer: ___________)
**Forward-going disclosure update implemented in Kixie:** [ ] Yes [ ] No (rationale: ___________)
**Decision:** [ ] Existing recordings may be processed by AI pipeline | [ ] Only new recordings (post-disclosure-update) may be processed | [ ] Not approved (rationale: ___________)

**Approver:** ___________________________ (Legal counsel)
**Date:** ___________
