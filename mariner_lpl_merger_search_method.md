# Mariner Advisor Network / LPL Acquisition — Advisor Search Methodology

**Date:** 2026-04-16
**Target:** Identify the ~367 advisors described in the LPL-Mariner Advisor Network acquisition announcement (~$31B AUM).
**Firm of record:** Mariner Advisor Network, SEC CRD **283824**, SEC File **801-107913**.

---

## TL;DR

- **167** Investment Adviser Representatives are registered at CRD 283824 — confirmed independently by FINRA BrokerCheck, SEC IAPD, and FINTRX.
- **+1** net-new from SEC reconciliation (James Parenti, CRD 1031840 — FINTRX had stale primary-firm data).
- **Total confirmed IARs: 167 (SEC) + context on their status.**
- Enriched table `savvy-gtm-analytics.FinTrx_data_CA.LPL_Mariner_merger` (369 rows) segments each advisor into an outreach priority:
  - **Priority 1 — `transitioning_to_pag`: 148** (SEC IAR + dual-registered). RIA affiliation being moved to Private Advisor Group — the highest-disruption group and our outreach focus.
  - **Priority 2 — `iar_staying_at_lpl`: 19** (SEC IAR + IA-only). Stay at LPL but gain a new supervisor.
  - **Priority 3 — `bd_only_staying_at_lpl`: 202** (not in SEC IAR list). Excluded from outreach — low-disruption, largely unidentifiable with confidence, and includes the 114 flagged false positives.
- The remaining **~200 advisors** in the "367" figure are **pure broker-dealer reps under LPL (BD CRD 6413)** supervised via an internal Office of Supervisory Jurisdiction (OSJ) arrangement with Mariner. **No public registry captures OSJ supervisory relationships**, so they cannot be identified from public data until post-close filings surface them.

---

## Step-by-Step Method

### Step 1 — FINRA BrokerCheck firm search (CRD 283824)
- Public endpoint: `api.brokercheck.finra.org/search/individual?firm=283824`
- With `includePrevious=false`: **167 current advisors**
- With `includePrevious=true`: 311 (adds former advisors who left the firm)
- Output: `mariner_advisor_network_CRD283824_individuals.csv`

### Step 2 — FINTRX BigQuery direct match
- Table: `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
- Filter: `PRIMARY_RIA = '283824' OR PRIMARY_FIRM = 283824`
- Result: 166 rows (overlapping BrokerCheck + 0 net-new unique).

### Step 3 — FINTRX predecessor/historical employment search
Searched `contact_registered_employment_history` for people ever registered at the Mariner lineage CRDs:
- **283824** — Mariner Advisor Network (current)
- **140977** — Strategic Wealth Advisors Group (direct predecessor, renamed/re-registered as 283824 in July 2016)
- **109656** — Financial Services Network (absorbed OSJ; mostly moribund in FINTRX — only 2 rows)

Narrowed to currently-active people whose current firm is LPL (6413) or Mariner (283824) — added **21 historical rows**.

### Step 4 — LPL address fingerprint (the "where are the OSJ reps?" hunt)
Built address fingerprint from 103 unique Mariner street addresses (FINTRX) + BrokerCheck branch locations.

- **Tier A** (street + city + state match, LPL reps, not already matched): **179 candidates**
- **Tier B** (zip-only match): **7,034 candidates** — rejected as too noisy

Combined raw total: **385 candidates** (166 direct + 21 historical + 179 street-match + 2 BrokerCheck-only).

### Step 5 — Validation pass
Validated each candidate against two FINTRX tables:

1. **`ria_contact_firm_relationships`** — RIA firm relationships with CRDs {283824, 109656, 140977}
2. **`contact_registered_employment_history`** — any employment record at those Network CRDs

Added columns `has_firm_relationship` and `has_network_employment_history`.

**Result (among 368 after pruning 17 historical rows with non-LPL/non-Mariner current firms):**
- Pass BOTH checks: 33
- Pass ONE only: 155
- Pass NEITHER: 180 — **all 179 street-match rows plus 1 BrokerCheck-only**

### Step 6 — Address density analysis (false-positive filter)
The "pass neither" result for all 179 street matches was the red flag. Because RIA-side tables don't capture BD/OSJ supervisory relationships, "fails validation" doesn't automatically mean "false positive." We classified each matched address:

- `mariner_dense` (direct Mariner ≥ LPL-other): **18** — probably legit OSJ
- `mixed` (LPL-other ≤ 3× Mariner): **47** — probably OSJ
- `shared_building` (LPL-other > 3× Mariner): **114** — likely unrelated LPL reps at shared buildings

Flagged the 114 `shared_building` + no-validation rows as `is_likely_false_positive = TRUE`.

### Step 7 — SEC IAPD authoritative pull
- Endpoint: `api.adviserinfo.sec.gov/search/individual?firm=283824&includePrevious=false`
- **Result: 167 — exactly matching BrokerCheck.**
- Output: `mariner_IAR_list_from_SEC.csv`

### Step 8 — Deal segmentation (enrichment of `LPL_Mariner_merger`)
Appended James Parenti (SEC-confirmed, missing from the working table), joined to `ria_contacts_current` for `REP_TYPE`, and cross-referenced each CRD against the 167-CRD SEC IAR list. Added six columns: `REP_TYPE`, `is_sec_confirmed_iar`, `is_transitioning_ria`, `is_bd_only`, `advisor_segment`, `outreach_priority`.

Segmentation logic:

| `advisor_segment` | Rule | Count | Priority |
|---|---|---|---|
| `transitioning_to_pag` | SEC IAR **AND** `REP_TYPE = 'DR'` | 148 | 1 |
| `iar_staying_at_lpl` | SEC IAR **AND** `REP_TYPE != 'DR'` | 19 | 2 |
| `bd_only_staying_at_lpl` | Not in SEC IAR list | 202 | 3 |

Sanity check: 148 + 19 = 167 SEC IARs — matches.

---

## Reconciliation (SEC vs our working file)

| Bucket | Count |
|---|---|
| In BOTH (SEC ∩ our COMPLETE.csv) | 166 |
| In SEC but NOT in ours | 1 (James Parenti) |
| In ours but NOT in SEC | 202 (BD-only, historical, or false positives) |

Breakdown of the 202 "in ours not in SEC":

| Match method | Count | Interpretation |
|---|---|---|
| `primary_ria_or_firm_283824` | 2 | FINTRX PRIMARY_RIA lagging SEC |
| `historical_network_now_lpl_or_mariner` | 21 | Former Mariner, still at LPL — not current IARs |
| `lpl_street_match` / shared_building | 114 | Likely unrelated LPL reps |
| `lpl_street_match` / mixed | 47 | Possibly OSJ, not IAR-registered at Mariner |
| `lpl_street_match` / mariner_dense | 18 | Possibly OSJ, not IAR-registered at Mariner |

---

## Why We Are Confident in 167 (and not more)

Three independent sources agree exactly:

| Source | Count | Notes |
|---|---|---|
| FINRA BrokerCheck (public) | 167 current | Individual search filtered to firm 283824 |
| SEC IAPD (authoritative IA registry) | 167 active | Same endpoint, IA scope |
| FINTRX (third-party data) | 166 + 1 stale | Matches SEC after the Parenti correction |

SEC IAPD is the **regulatory source of truth for IAR registrations**. If a person were an IAR at Mariner Advisor Network, they would appear on IAPD with that firm as a current employment. They don't — so they aren't.

The "367" figure includes people whose only Mariner connection is a **supervisory/OSJ relationship** through LPL's broker-dealer. That relationship is **not a public registration** — it's an internal arrangement between LPL and Mariner. OSJ relationships are not exposed in:

- SEC IAPD (captures IA registrations only)
- FINRA BrokerCheck (captures BD registrations + IA registrations, not OSJ supervisory hierarchies)
- FINTRX (sources from the above)
- FINRA Gateway (access-controlled; still only registration data, not OSJ maps)

---

## Output Files

| File / Table | Rows | Purpose |
|---|---|---|
| `mariner_advisor_network_CRD283824_individuals.csv` | 311 | Raw BrokerCheck pull (current + previously registered) |
| `mariner_IAR_list_from_SEC.csv` | 167 | **Authoritative SEC IAR list** |
| `mariner_advisor_network_COMPLETE.csv` | 368 | Full candidate list with validation + confidence flags |
| `savvy-gtm-analytics.FinTrx_data_CA.LPL_Mariner_merger` (BigQuery) | 369 | **Segmented outreach table** with `advisor_segment` and `outreach_priority` |

---

## Outreach Strategy — Focus on Priority 1 & 2 Only

### Why exclude Priority 3 (`bd_only_staying_at_lpl`, 202 people)

1. **We cannot confidently identify them.** They're not in the SEC IAR list. They were reached only via LPL address fingerprinting, and 114 of the 202 are flagged as likely false positives from shared-building matches. Even after filtering flags, the remaining ~88 can't be verified as Mariner-OSJ without post-close filings.
2. **Their disruption is minimal.** As BD-only reps at LPL, they *stay at LPL* regardless — only the Mariner OSJ supervisory layer changes above them. Their broker-dealer, compliance stack, tech, and client-facing brand do not change. There is little "switching cost pain" for us to speak to.
3. **Targeting error cost is high.** Outreach to a flagged false positive lands in the inbox of an unrelated LPL advisor and burns our sender reputation. Priority-3 outreach is low-signal and high-noise.

Priority 1 and Priority 2 together are **167 people**, all SEC-verified, with **147/148 coverage on email, phone, and LinkedIn** for Priority 1 — ready for campaign today.

### Priority 1 vs Priority 2 — Why They Both Matter, Differently

| | Priority 1 — `transitioning_to_pag` | Priority 2 — `iar_staying_at_lpl` |
|---|---|---|
| Count | 148 | 19 |
| Who | Dual-registered (broker + IA) at Mariner Advisor Network | IA-only at Mariner Advisor Network |
| What changes at close | **RIA affiliation moves from Mariner to Private Advisor Group** (LPL's RIA), a firm they did not choose | RIA registration stays with LPL-lineage entity; supervisor/branch chain changes |
| Disruption level | **High** — new RIA brand, new compliance, possible client re-papering, ADV re-filing, website/marketing changes | Moderate — mostly invisible to clients; mostly supervisory and operational |
| Decision window | 60–90 days post-close typical | 3–6 months; less time-pressured |
| Producing | 117 / 148 (79%) | 9 / 19 (47%) |

---

## Messaging Guidance by Priority

Both cohorts are experiencing a merger they didn't initiate. The angle differs because the *texture of the disruption* differs.

### Priority 1 — "Your RIA home is changing without your vote"

**Emotional frame:** loss of control and brand identity. These advisors built client relationships under the Mariner Advisor Network RIA. That RIA is being retired for them and their registration moved into Private Advisor Group. Clients will see the change on ADVs, account statements, and website branding.

**Open with:** the disruption they're about to live through, not a generic pitch.
- "Your clients are about to see 'Private Advisor Group' on their Form ADV."
- "PAG is a fine firm — but you didn't pick it. When the RIA you're registered at changes without your input, that's the moment to ask whether you want to stay on someone else's platform or choose your own."

**Lead with the pain points that only hit Priority 1:**
- Re-papering: client notifications, updated ADV delivery, possible custodian repapering. Weeks of admin for little upside.
- Brand rebrand: marketing materials, website, email signatures, business cards.
- Compliance stack change: PAG's tech, approval workflows, and rules may differ from Mariner's.
- Economics: payout grids, equity, and platform fees can shift at the RIA level — worth an independent audit.

**Call to action:** a confidential 30-minute review *before* the close to compare staying vs. moving to an independent RIA. Frame the review as contingency planning, not as a pitch.

**Timing:** these advisors are the most decision-ready in the next 60–90 days. Hit them early and often; the day after close they are locked into PAG's onboarding flow.

### Priority 2 — "Same LPL, different boss you didn't pick"

**Emotional frame:** loss of the relationship they had with Mariner leadership, not of brand or operations. These advisors don't experience client-facing change, but they lose a culture — who they called when they had a question, the OSJ they trusted, the reason they joined Mariner and not pure LPL.

**Open with:** culture and support continuity, not branding.
- "LPL is absorbing Mariner's supervisory layer. The person you called at Mariner may not be there — or may be wearing a different hat — 90 days from now."
- "If you joined Mariner for the people, not the platform, this is the moment to evaluate where 'the people' you trust are going next."

**Different pain points:**
- Supervisory reassignment: new OSJ principal, new approval culture, possibly tighter or looser rules.
- Service tier: large enterprise LPL treats OSJ affiliates differently than a tight-knit Mariner team did.
- Cultural drift: the "why I'm not at pure LPL" reason erodes as Mariner's identity gets subsumed.

**Skip the re-papering angle** — it doesn't apply to them and leading with it signals we didn't do our homework on their situation.

**Call to action:** softer, longer-horizon. Intro call, introductions to peers who made similar moves, invitation to a roundtable. These are slower decisions; nurture over 3–6 months.

### What NOT to send to either group

- Generic "we heard about the deal" blasts with no segmentation. Both cohorts will sniff out templated outreach instantly.
- Anything implying urgency for Priority 2 — they have runway and will read "this closes in 45 days, act now" as not understanding their situation.
- Anything implying the disruption is small for Priority 1 — it is objectively not small for them.

---

---

## How to Find the Remaining ~200 (Future Work)

The OSJ reps cannot be found in public data as of 2026-04-16. Options to identify them later:

1. **Post-close regulatory filings (highest yield).** Once the LPL acquisition closes, LPL will amend its Form BD and Form U4s for the affected reps. A comparison of LPL's rep roster pre- and post-close — filtered to the Mariner OSJ branch OR supervisor code — will surface the ~200.

2. **LPL investor/press disclosures.** LPL's 8-K, earnings call supplements, or press kits around close may list the transferring advisor count and supervisory structure at branch-code or region granularity. Scrape these systematically post-close.

3. **Mariner's own marketing / advisor directory.** If Mariner Advisor Network publishes a "find an advisor" page or an advisor list on its website, scrape and reconcile against our 167. The delta is the OSJ-only population.

4. **LinkedIn / data vendors.** Search LinkedIn for "Mariner Advisor Network" in current employment — most advisors self-identify there even if the regulatory registration runs through LPL. Cross-reference names/firms with LPL reps in FINTRX for a high-confidence match. Commercial vendors (Discovery Data, Diamond Consultants, Meridian-IQ) maintain OSJ supervisory maps that public feeds lack — worth pricing.

5. **Form ADV Part 1 Schedule R / D.** Mariner's Form ADV lists relying advisers (Schedule R). Not every OSJ rep shows up there, but large producing teams sometimes do. Worth a one-time scrape of the current filing from EDGAR.

6. **Direct contact with LPL / Mariner.** For active deal outreach, the fastest path is a conversation with the Mariner Advisor Network head of recruiting or LPL's large-enterprise team — they have the full list.

**Recommendation:** Freeze the current target list at **168** (167 SEC + Parenti) for actionable outreach today. Set a calendar reminder to re-pull SEC IAPD and LPL Form BD 30 and 90 days after the LPL-Mariner close; the ~200 will materialize in public filings at that point.
