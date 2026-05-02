# Unit 0.1 — Anthropic Enterprise / ZDR Verification

**Status:** ⬜ Pending
**Approver:** TBD
**Date signed off:** —

## Goal

Verify that Anthropic's data-handling agreement covers Savvy's processing of prospect financial PII (advisor AUM, fee structures, client details from sales calls) at an acceptable risk level. Decide whether Savvy's existing Anthropic account terms are sufficient or whether Enterprise / Zero Data Retention (ZDR) tier is needed.

## What Anthropic's Default Commercial Terms Already Guarantee

From `https://www.anthropic.com/legal/commercial-terms` (verified 2026-04-27):

> **Section B (Customer Content):** "As between the parties and to the extent permitted by applicable law, Anthropic agrees that Customer (a) retains all rights to its Inputs, and (b) owns its Outputs."

> **Model Training:** "Anthropic may not train models on Customer Content from Services."

> **Section C (DPA reference):** "Data submitted through the Services will be processed in accordance with the [Anthropic Data Processing Addendum](https://www.anthropic.com/legal/data-processing-addendum) ('DPA'), which is incorporated into these Terms by reference."

**Key takeaway:** The training prohibition is **default**, not opt-in. There is no checkbox to flip — it's contractually guaranteed by the Commercial Terms.

## What ZDR Adds

ZDR (Zero Data Retention) is an Enterprise-tier add-on that eliminates the **default 30-day retention window** that Anthropic uses for trust-and-safety review. Without ZDR, Anthropic retains API requests/responses for up to 30 days for abuse monitoring before deletion. With ZDR, requests are not retained at all.

For prospect-financial-PII processing, ZDR is preferred but not strictly required — the 30-day retention is for Anthropic's own abuse review, not for training, sale, or sharing.

## Verification Steps

### Step 1 — Confirm the current Anthropic account tier

```bash
# In Anthropic Console (https://console.anthropic.com/settings/billing):
# - Identify the current plan: "Build" / "Scale" / "Enterprise"
# - Check whether a DPA has been signed (Settings → Compliance, if available)
```

**Document:** Plan tier = `___________` (fill in)

### Step 2 — Read the Anthropic DPA

Anthropic auto-incorporates the DPA via Commercial Terms. Read it in full at: https://www.anthropic.com/legal/data-processing-addendum

**Verify:**
- [ ] DPA covers customer-controller processing of personal data
- [ ] Sub-processor list reviewed (linked from DPA)
- [ ] Cross-border transfer mechanisms (SCCs / DPF) acceptable
- [ ] Breach notification SLA acceptable

### Step 3 — Decide: ZDR Required?

For Savvy's risk profile, the question is whether the 30-day retention window is acceptable given:
- Recordings contain advisor financial details, AUM numbers, employer info
- Anthropic does not use the data for training (already guaranteed)
- Anthropic's retention is for trust-and-safety only, not human review or other purposes
- Anthropic's SOC 2 Type 2 + ISO 27001 posture covers retention security

**Recommendation:** Default Commercial Terms are sufficient for Phase 0 ship. If Savvy's compliance/legal team has a specific concern with the 30-day window (e.g., cross-state advisor PER restrictions), upgrade to Enterprise + ZDR. Document either way.

### Step 4 — If pursuing ZDR, contact Anthropic Sales

Email: `sales@anthropic.com` (or via the Console "Contact Sales" link)

Request:
- Enterprise plan pricing
- ZDR addendum scope
- Implementation: ZDR is enabled by Anthropic operationally on a per-organization or per-project basis once the contract is in place
- Lead time: typically 2-4 weeks for Enterprise contract execution

### Step 5 — Document decision

Fill in below. Either path (default terms OR ZDR) is acceptable as long as the decision is documented.

---

## Sign-Off

**Decision:** [ ] Accept default Anthropic Commercial Terms (with auto-incorporated DPA) | [ ] Pursue Enterprise + ZDR

**Rationale:**
_________________________________________________________________

**DPA reference:** https://www.anthropic.com/legal/data-processing-addendum (revision date: ___________)

**Approver:** ___________________________
**Date:** ___________
**Signature / acknowledgment:** ___________

## References

- [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms)
- [Anthropic Data Processing Addendum](https://www.anthropic.com/legal/data-processing-addendum)
- [Anthropic Trust Center](https://trust.anthropic.com)
