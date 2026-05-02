# Unit 0.2 — AssemblyAI DPA + Zero-Retention Configuration

**Status:** ⬜ Pending
**Approver:** TBD
**Date signed off:** —

## Goal

Sign the AssemblyAI Data Processing Agreement (DPA), enable account-level zero data retention (or shortest-possible retention window), confirm the security/compliance posture is adequate for processing prospect financial PII via call recordings.

## What AssemblyAI's Public Posture Already Confirms

From `https://www.assemblyai.com/security` (verified 2026-04-27):

- **SOC 2 Type 1 & Type 2** certified (audit completed)
- **GDPR** compliance assessed by third party
- **PCI-DSS 4.0 Level 1** compliant (March 31, 2025)
- DPA exists ("data processing agreements as part of auditing practices")
- Trust Center hosts the sub-processor list, DPA, and additional documentation

**Not confirmed publicly:** Audio retention period default, training-on-customer-data policy, HIPAA BAA availability. **All require account-level access to the Trust Center or direct contact with AssemblyAI Sales.**

## Verification Steps

### Step 1 — Create or identify the AssemblyAI account

```
URL: https://www.assemblyai.com
Settings → Account → Billing
```

**Document:** Account email = `___________`, Plan tier = `___________`

### Step 2 — Access AssemblyAI Trust Center

URL: `https://trust.assemblyai.com` (requires login or document request)

Pull these documents:
- [ ] DPA (Data Processing Agreement)
- [ ] Sub-processor list
- [ ] SOC 2 Type 2 report (NDA may be required)
- [ ] Information Security Policy

### Step 3 — Sign DPA

If not already executed:
- AssemblyAI provides a self-serve DPA signing flow on the Trust Center, OR
- Email `legal@assemblyai.com` to initiate the contract

**Document:** DPA executed date = `___________`, version = `___________`

### Step 4 — Configure zero-retention or shortest-possible retention

AssemblyAI offers configuration options for audio + transcript retention. Defaults vary by tier.

**Action:** Contact AssemblyAI Sales (`sales@assemblyai.com`) and request:
- Confirmation that audio uploaded via API is deleted after processing completes (or shortest configurable window)
- Whether transcripts are retained for any period after delivery to customer
- Whether the account can be flagged as "no model training" — AssemblyAI's standard practice does not use customer audio for training, but get this in writing

**Document:** Audio retention setting = `___________`, Transcript retention = `___________`, Training opt-out confirmed = [ ] Yes [ ] No

### Step 5 — Verify HIPAA BAA availability (optional, not required for Savvy's use case)

Savvy's data is financial, not health, so HIPAA does not strictly apply. However, if the Trust Center confirms HIPAA BAA availability, that's a positive signal of vendor maturity around regulated data.

**Document:** HIPAA BAA available = [ ] Yes [ ] No [ ] N/A

### Step 6 — Sub-processor review

Pull the AssemblyAI sub-processor list (Trust Center). Verify:
- Cloud infrastructure (AWS / GCP) acceptable
- Any third-party AI models in their pipeline (e.g., for diarization) — confirm those don't use customer audio for training
- Cross-border transfer mechanisms acceptable

### Step 7 — Submit-by-URL implications

Plan uses `client.transcripts.transcribe({ audio: <kixie-url>, ... })` — AssemblyAI fetches the audio directly from the public Kixie CloudFront URL.

**Confirm:**
- [ ] AssemblyAI's data-handling commitments apply to URL-fetched audio identically to uploaded audio
- [ ] No additional retention on the AssemblyAI side for URL-fetched mode

If unclear, confirm with AssemblyAI Sales/Support.

---

## Sign-Off

**DPA executed:** [ ] Yes (date: ___________, version: ___________) | [ ] No (rationale: ___________)

**Audio retention configured:** [ ] Zero retention | [ ] Shortest available window: ___________ | [ ] Default

**Training-on-customer-data opt-out confirmed in writing:** [ ] Yes | [ ] No (rationale: ___________)

**Approver:** ___________________________
**Date:** ___________

## References

- [AssemblyAI Security & Compliance](https://www.assemblyai.com/security)
- [AssemblyAI Trust Center](https://trust.assemblyai.com) (requires account)
- [AssemblyAI Privacy Policy](https://www.assemblyai.com/legal/privacy-policy)
- [AssemblyAI Terms of Service](https://www.assemblyai.com/legal/terms-of-service)
