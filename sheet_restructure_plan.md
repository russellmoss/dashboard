# Sheet Restructure Plan — Q2 Forecast Source-Detail Section

> Generated 2026-03-12
> Based on: `source_inventory.md`, `current_sheet_structure.md`, BQ volume data

---

## 2.1 — New Source Taxonomy (BQ-Backed)

Sources with **>25 prospects since 2025-01-01** qualify for their own detail section.

### Outbound (3 sources)
| Original_source | Records Since 2025 | Contacted | MQLs | SQLs | Status |
|---|---|---|---|---|---|
| Provided List (Lead Scoring) | 38,455 | 28,529 | 805 | 229 | **Qualifies** |
| LinkedIn (Self Sourced) | 25,377 | 23,092 | 1,105 | 315 | **Qualifies** |
| Fintrx (Self-Sourced) | 1,817 | 989 | 31 | 17 | **Qualifies (NEW)** |

### Marketing (5 sources, 2 qualify as PRIMARY)
| Original_source | Records Since 2025 | Contacted | MQLs | SQLs | Status |
|---|---|---|---|---|---|
| Direct Traffic | 1,140 | 390 | 94 | 56 | **Qualifies** |
| Job Applications | 775 | 53 | 158 | 39 | **Qualifies (NEW)** |
| LinkedIn Ads | 23 | 10 | 6 | 4 | Below threshold (SUB) |
| Google Ads | 9 | 3 | 4 | 1 | Below threshold (SUB) |
| LinkedIn Savvy | 6 | 5 | 3 | 2 | Below threshold (SUB) |
| Blog | 1 | 0 | 1 | 1 | Below threshold (SUB) |

### Outbound + Marketing (2 sources)
| Original_source | Records Since 2025 | Contacted | MQLs | SQLs | Status |
|---|---|---|---|---|---|
| Events | 1,063 | 476 | 108 | 63 | **Qualifies** |
| Provided List (Marketing) | 1,562 | 1,169 | 30 | 4 | **Qualifies** |

### Re-Engagement (1 source)
| Original_source | Records Since 2025 | Contacted | MQLs | SQLs | Status |
|---|---|---|---|---|---|
| Re-Engagement | 93 | 29 | 27 | 31 | **Qualifies** |

### Partnerships (1 source + 2 tiny)
| Original_source | Records Since 2025 | Contacted | MQLs | SQLs | Status |
|---|---|---|---|---|---|
| Recruitment Firm | 304 | 73 | 157 | 92 | **Qualifies** |
| Partnerships | 3 | 0 | 0 | 0 | Below threshold |
| Employee Referral | 2 | 2 | 0 | 0 | Below threshold |

### Advisor Referrals (1 source)
| Original_source | Records Since 2025 | Contacted | MQLs | SQLs | Status |
|---|---|---|---|---|---|
| Advisor Referral | 35 | 10 | 16 | 15 | **Qualifies** |

### Other (2 sources)
| Original_source | Records Since 2025 | Contacted | MQLs | SQLs | Status |
|---|---|---|---|---|---|
| Other | 847 | 454 | 41 | 7 | **Qualifies** |
| Unknown | 95 | 23 | 2 | 0 | **Qualifies** (>25 but 0 SQLs) |

---

## 2.2 — Proposed New Source-Detail Layout

### == Outbound ==
| # | Source | Type | Change from Current |
|---|---|---|---|
| 1 | **Provided List (Lead Scoring)** | PRIMARY | RENAME from "Provided Lead List (Lead Scoring)" |
| 2 | **LinkedIn (Self Sourced)** | PRIMARY | Unchanged |
| 3 | **Fintrx (Self-Sourced)** | PRIMARY | **NEW** — was uncaptured in sheet |

### == Marketing ==

#### Marketing — Organic
| # | Source | Type | Change from Current |
|---|---|---|---|
| 4 | **Direct Traffic** | PRIMARY | PROMOTE from SUB → PRIMARY (add monthly forecast) |
| 5 | **Job Applications** | PRIMARY | **NEW** — replaces Ashby (different BQ source name) |
| 6 | Google Ads + LinkedIn Ads | PRIMARY | Unchanged (composite of 2 BQ sources) |
| 7 | LinkedIn Savvy | SUB | Unchanged |
| 8 | Blog | SUB | Unchanged |
| 9 | Google Ads | SUB | Unchanged (move here from Paid) |
| 10 | LinkedIn Ads | SUB | Unchanged (move here from Paid) |

**Removed from Marketing:**
- Search (0 records) — REMOVE
- LinkedIn Social (0 records) — REMOVE
- LinkedIn (Content) (0 records) — REMOVE
- LinkedIn (Automation) (0 records) — REMOVE
- Website (0 records) — REMOVE
- Advisor Waitlist (0 records) — REMOVE
- Ashby (0 records under this name) — REPLACE with Job Applications
- Meta (0 records) — REMOVE

**Note on "Marketing Organic" vs "Marketing Paid" split:**
The current sheet splits Marketing into Organic (rows 134–252) and Paid (rows 253–320). In the new BQ taxonomy, all Marketing sources map to a single `Finance_View = 'Marketing'`. Recommend **collapsing into one Marketing section** since:
- The Organic/Paid distinction doesn't exist in the BQ view
- Most "Paid" sub-sources (Meta, individual Google Ads, LinkedIn Ads) are being removed or are SUB-sources
- Job Applications (replacing Ashby) isn't really "Paid"

*Decision for Russell: Keep Organic/Paid split, or merge into one Marketing group?*

### == Outbound + Marketing ==
| # | Source | Type | Change from Current |
|---|---|---|---|
| 11 | **Events** | PRIMARY | Unchanged |
| 12 | **Provided List (Marketing)** | PRIMARY | PROMOTE from SUB → PRIMARY (add monthly forecast) |

**Removed:**
- Direct Mail (0 records) — REMOVE
- Webinar (0 records) — REMOVE

### == Re-Engagement ==
| # | Source | Type | Change from Current |
|---|---|---|---|
| 13 | **Re-Engagement** | PRIMARY | Unchanged |

### == Partnerships ==
| # | Source | Type | Change from Current |
|---|---|---|---|
| 14 | **Recruitment Firm** | PRIMARY | Unchanged |

**Note:** Employee Referral (2 records) and Partnerships (3 records) are too small for their own rows. They'll appear in BQ totals for the Partnerships Finance_View group but won't have dedicated source-detail rows.

### == Advisor Referrals ==
| # | Source | Type | Change from Current |
|---|---|---|---|
| 15 | **Advisor Referral** | PRIMARY | Unchanged |

### == Other ==
| # | Source | Type | Change from Current |
|---|---|---|---|
| 16 | **Other** | PRIMARY | Unchanged |
| 17 | Unknown | SUB | Unchanged |

### Layout Summary

| Metric | Current | New | Delta |
|---|---|---|---|
| Total source blocks | 25 | 17 | -8 |
| PRIMARY sources | 11 | 13 | +2 |
| SUB-sources | 14 | 4 | -10 |
| Sources with 0 BQ records | 10 | 0 | -10 |
| New sources added | — | 2 | +2 |
| Sources promoted SUB→PRIMARY | — | 2 | +2 |

---

## 2.3 — Old Source → New Source Migration Map

| # | Old Sheet Source | Old Row | Old Type | Status | New Source Name | New Finance_View | Action |
|---|---|---|---|---|---|---|---|
| 1 | Provided Lead List (Lead Scoring) | 107 | PRIMARY | RENAME | Provided List (Lead Scoring) | Outbound | Update B107 + fix hardcoded formula string |
| 2 | LinkedIn (Self Sourced) | 120 | PRIMARY | KEEP | LinkedIn (Self Sourced) | Outbound | No change |
| 3 | Blog | 136 | SUB | KEEP | Blog | Marketing | No change |
| 4 | Search | 149 | SUB | REMOVE | — | — | Delete row block (0 BQ records) |
| 5 | LinkedIn Savvy | 162 | SUB | KEEP | LinkedIn Savvy | Marketing | No change |
| 6 | LinkedIn Social | 175 | SUB | REMOVE | — | — | Delete row block (0 BQ records) |
| 7 | LinkedIn (Content) | 188 | SUB | REMOVE | — | — | Delete row block (0 BQ records) |
| 8 | LinkedIn (Automation) | 201 | SUB | REMOVE | — | — | Delete row block (0 BQ records) |
| 9 | Direct Traffic | 214 | SUB | PROMOTE | Direct Traffic | Marketing | Add monthly forecast (H/J/L) |
| 10 | Website | 227 | SUB | REMOVE | — | — | Delete row block (0 BQ records) |
| 11 | Advisor Waitlist | 240 | PRIMARY | REMOVE | — | — | Delete row block (0 BQ records); redistribute forecast |
| 12 | Google Ads + LinkedIn Ads | 256 | PRIMARY | KEEP | Google Ads + LinkedIn Ads | Marketing | No change (composite) |
| 13 | Ashby | 269 | PRIMARY | REPLACE | Job Applications | Marketing | Replace source name; adjust forecast values |
| 14 | Google Ads | 282 | SUB | KEEP | Google Ads | Marketing | No change |
| 15 | Meta | 295 | SUB | REMOVE | — | — | Delete row block (0 BQ records) |
| 16 | LinkedIn Ads | 308 | SUB | KEEP | LinkedIn Ads | Marketing | No change |
| 17 | Events | 323 | PRIMARY | KEEP | Events | Outbound + Marketing | No change |
| 18 | Direct Mail | 336 | SUB | REMOVE | — | — | Delete row block (0 BQ records) |
| 19 | Webinar | 349 | SUB | REMOVE | — | — | Delete row block (0 BQ records) |
| 20 | Provided List (Marketing) | 362 | SUB | PROMOTE | Provided List (Marketing) | Outbound + Marketing | Add monthly forecast (H/J/L) |
| 21 | Re-Engagement | 377 | PRIMARY | KEEP | Re-Engagement | Re-Engagement | No change |
| 22 | Recruitment Firm | 392 | PRIMARY | KEEP | Recruitment Firm | Partnerships | No change |
| 23 | Advisor Referral | 407 | PRIMARY | KEEP | Advisor Referral | Advisor Referrals | No change |
| 24 | Other | 422 | PRIMARY | KEEP | Other | Other | No change |
| 25 | Unknown | 435 | SUB | KEEP | Unknown | Other | No change |
| — | *(new)* | — | — | ADD | **Fintrx (Self-Sourced)** | Outbound | New PRIMARY block after LinkedIn (Self Sourced) |

---

## 2.4 — Forecast Value Migration

### Sources Being Renamed (forecast values carry over)

| Old Source | Monthly Created (H/J/L) | Monthly Rates | G SQO | Action |
|---|---|---|---|---|
| Provided Lead List (Lead Scoring) | 2900 / 3200 / 3200 | C→Con=80%, C→MQL=2%, MQL→SQL=44%, SQL→SQO=50% | 33 | Keep all values, rename source |

### Sources Being Replaced (forecast values transfer)

| Old Source | Old Monthly Created | Old G SQO | New Source | Action |
|---|---|---|---|---|
| Ashby | 5 / 5 / 5 | 2 | Job Applications | Transfer Ashby forecast to Job Applications. Russell may want to adjust rates since Job Applications has different conversion profile than Ashby. |

### Sources Being Removed (forecast values need redistribution)

| Old Source | Old Monthly Created | Old G SQO | Suggested Redistribution |
|---|---|---|---|
| Advisor Waitlist | 1 / 1 / 1 | 3 | Add to Direct Traffic (both Marketing, Direct Traffic is being promoted to PRIMARY). Or to "Other" if Russell prefers. |
| Search | 0 / 0 / 0 | 0 | Nothing to redistribute |
| LinkedIn Social | — | 0 | Nothing to redistribute |
| LinkedIn (Content) | — | 0 | Nothing to redistribute |
| LinkedIn (Automation) | — | 0 | Nothing to redistribute |
| Website | — | 0 | Nothing to redistribute |
| Meta | — | 0 | Nothing to redistribute |
| Direct Mail | — | 0 | Nothing to redistribute |
| Webinar | — | 0 | Nothing to redistribute |

**Only 2 sources have non-zero forecast values that need attention:** Advisor Waitlist (SQO=3) and Ashby (SQO=2).

### New Sources (Russell to fill in forecast)

| New Source | Finance_View | BQ Volume Context | Suggested Starting Forecast |
|---|---|---|---|
| Fintrx (Self-Sourced) | Outbound | 1,817 total, 989 contacted, 31 MQLs, 17 SQLs since 2025 | Russell to input based on expected activity |
| Provided List (Marketing) — promoted | O+M | 1,562 total, 1,169 contacted, 30 MQLs, 4 SQLs since 2025 | Russell to input; historically low SQL conversion |
| Direct Traffic — promoted | Marketing | 1,140 total, 390 contacted, 94 MQLs, 56 SQLs since 2025 | Russell to input; good MQL→SQL pipeline |

### Unchanged Sources (no forecast changes needed)

| Source | Monthly Created | G SQO | Notes |
|---|---|---|---|
| LinkedIn (Self Sourced) | 4060 / 4480 / 4480 | 89 | Largest forecast contributor |
| Google Ads + LinkedIn Ads | 1 / 2 / 2 | 5 | All rates=100% (forecasting at SQO level) |
| Events | 90 / 90 / 90 | 12 | Rates: 50%/25%/48%/77% |
| Re-Engagement | 5 / 5 / 5 | 14 | Rates: 100%/100%/100%/92% (forecasting at SQO level) |
| Recruitment Firm | 8 / 8 / 8 | 21 | Rates: 100%/100%/100%/85.7% |
| Advisor Referral | 1 / 1 / 2 | 3 | C→Con=79%, rest=100% |
| Other | 15 / 15 / 15 | 0 | MQL→SQL=0% (no pipeline) |

---

## Net Impact on Total Forecast SQOs

| Category | Current SQOs | After Restructure | Delta |
|---|---|---|---|
| Unchanged sources | 144 | 144 | 0 |
| Renamed (Provided Lead List → Provided List) | 33 | 33 | 0 |
| Replaced (Ashby → Job Applications) | 2 | 2* | 0 |
| Removed (Advisor Waitlist) | 3 | 0 | -3 |
| New (Fintrx, Direct Traffic promoted, PL Marketing promoted) | 0 | TBD | +TBD |
| **Total** | **~182** | **179 + TBD** | **-3 + TBD** |

*Russell needs to decide: redistribute Advisor Waitlist's 3 SQOs, or accept the -3.

---

## Decisions for Russell

Before executing Phase 3, please confirm:

1. **Marketing section structure**: Merge Organic + Paid into one Marketing group, or keep the split?
2. **Advisor Waitlist SQOs (3)**: Redistribute to Direct Traffic, or accept the loss?
3. **Ashby → Job Applications**: Transfer Ashby's forecast values as-is, or adjust rates for Job Applications' different conversion profile?
4. **Fintrx (Self-Sourced)**: Want to add forecast values now, or leave blank initially?
5. **Direct Traffic + Provided List (Marketing)**: Want to add forecast values now, or leave blank initially?
6. **Unknown (SUB-source, 95 records, 0 SQLs)**: Keep or remove?
7. **Small Marketing SUB-sources (Blog=1, LinkedIn Savvy=6, Google Ads=9, LinkedIn Ads=23)**: Keep for historical reference, or remove since they show near-zero data?
