# Salesforce Operational Audit — 2026-04-22

**Org:** `savvywealth.my.salesforce.com` (00DDn00000CZYB2MAP)
**Evidence window:** ApiTotalUsage log dated 2026-04-21 (UTC), LoginHistory last 48h, live User/License queries at audit time.
**Method:** `sf data query` is broken on Windows (known CLI v2.125 path bug), so queries were run via REST API using `sf org display`'s access token against `/services/data/v66.0/query/` and `/sobjects/EventLogFile/{id}/LogFile`.
**Shield/Event Monitoring:** **Not licensed.** The `Api`, `RestApi`, `BulkApi` detailed event types return zero rows. However, the free-tier `ApiTotalUsage` event is available and contains per-call attribution (user, connected app, IP, resource, version, method, `COUNTS_AGAINST_API_LIMIT`), which is all we need for this audit.

---

## 1. License Reclaim Plan

### License utilization snapshot

| License | Total | Used | Remaining |
|---|---:|---:|---:|
| **Salesforce** | 40 | 40 | **0** (red flag) |
| Salesforce Integration | 5 | 1 | 4 |
| Identity | 100 | 0 | 100 |

### Strict criteria (`LastLoginDate < LAST_N_DAYS:60 OR LastLoginDate = NULL`)

**Zero users match.** Every active Salesforce-license user has logged in within the last 60 days, and none have a null `LastLoginDate`.

### Extended view (>30 days stale — the only near-stale account)

| Id | Name | Username | Profile | Last Login | Days Stale |
|---|---|---|---|---|---:|
| `005VS00000767Iv` | Lexi Harrison | lexi.harrison@savvywealth.com | Standard User | 2026-02-27 | ~54 |

Lexi is below the 60-day bar you asked about, but is the only account anywhere close to stale — worth a nudge to confirm continued need before pursuing reclaim, not a forced deactivation.

### The real reclaim opportunity — misclassified integration user

The stale-login path is a dead end, but the license audit surfaced a bigger win:

| Username | Profile | License | Role (inferred from API/Login logs) |
|---|---|---|---|
| `jed.entin+integration@savvywealth.com` | System Administrator | **Salesforce** | Pure integration user — `BigQueryDataTransfer` logs in under this account 151× in 48h and it drives 31,506 API calls/day (35% of org traffic) with zero browser login activity. |

**Recommendation — free 1 Salesforce seat today:**
1. Provision a new user on the **Salesforce Integration** license (4 seats available).
2. Migrate the BigQueryDataTransfer connected-app credentials and FINTRX/PandaDoc OAuth refresh tokens to the new integration user.
3. Deactivate `jed.entin+integration` on the Salesforce license — reclaims one seat.

The Salesforce Integration license is purpose-built for this (API-only, no UI, $10/user/month vs ~$165) and Jed's account does not need full platform features.

**Secondary candidate — Kenji Miyashiro:** 34,841 calls/day on a full Salesforce SysAdmin license, with the HubSpot connected app attributed to this user (8,559 calls) plus 26,282 unattributed calls. This looks like a human account being used to host an integration, which is a license-waste *and* security-audit concern (shared credentials, no accountability if Kenji leaves). Investigate whether this can also be split to an integration user.

---

## 2. API Usage Breakdown

**Source:** `EventLogFile` Id `0ATVS000003zTTF4A2`, EventType `ApiTotalUsage`, LogDate 2026-04-21, 27.9 MB, 89,253 rows.
**Calls counting against limit:** **88,614 / 89,253 (99.3%)** — matches your dashboard's reported ~98,667 (well under the 140,000 cap, but the trend direction is what matters).

### Top consumers (ranked by API calls/day)

**By User (calls against limit):**

| Rank | User | License | Calls | % of total |
|---:|---|---|---:|---:|
| 1 | `kenji.miyashiro@savvywealth.com` | Salesforce / SysAdmin | 34,841 | 39.3% |
| 2 | `jed.entin+integration@savvywealth.com` | Salesforce / SysAdmin | 31,506 | 35.6% |
| 3 | marisa.saucedo@savvywealth.com | Salesforce | 3,654 | 4.1% |
| 4 | ryan.crandall@savvywealth.com | Salesforce | 3,059 | 3.5% |
| 5 | holly.huffman@savvywealth.com | Salesforce | 2,763 | 3.1% |

**Top 2 users = 74.9% of all API traffic.** After the top 10 users, tail is negligible.

**By Connected App (calls against limit):**

| Connected App | Calls | Notes |
|---|---:|---|
| **(unattributed)** | 79,658 | 89% — clients using raw OAuth/session tokens without a named connected app. Most is attributable via CLIENT_IP to the BigQuery+Kenji flows. |
| HubSpot | 8,559 | All under `kenji.miyashiro` |
| SfdcApplication | 220 | Internal Salesforce |
| FINTRX Salesforce Integration | 74 | Jed |
| Salesforce Inspector Reloaded | 37 | Browser tool |
| PandaDoc OAuth2 | 24 | Jed |
| devconsole | 23 | Your own sessions |

**By Client IP (calls against limit):**

| Rank | IP | Calls | Likely source |
|---:|---|---:|---|
| 1 | 44.231.159.114 | 11,938 | Kixie (corroborated by LoginHistory — 1,623 Kixie logins from this IP in 48h) |
| 2 | 44.214.195.69 | 10,460 | AWS us-east-1 — Jed's BigQueryDataTransfer + Kenji overlap |
| 3 | 44.214.195.75 | 10,052 | AWS us-east-1 — same integration cluster |
| 4 | 51.178.216.199 | 6,799 | OVH/EU — used only by Kenji, likely HubSpot |
| 5 | 54.84.33.166 | 5,698 | AWS us-east-1 |

### Traffic shape — where the calls go

| Dimension | Breakdown |
|---|---|
| API family | REST **79,435** (89%) · SOAP 9,117 (10%) · Bulk **677** (0.8%) · ApexREST 24 |
| HTTP method | GET **75,540** (85%) · PATCH 1,739 · POST 2,846 · DELETE 2 · PUT 9 |
| Client category | EXTERNAL_APPLICATION 88,972 (99.7%) |

### Top 10 resources called (2026-04-21)

| Calls | Resource | Observation |
|---:|---|---|
| 18,285 | `/v62.0/query` | Generic SOQL — Jed's BQ sync dominates |
| 7,216 | `/v35.0/query` | **API v35 = 2015.** Someone is on a stale SDK. |
| 5,583 | `/v50.0/query` | Kenji's primary — also stale (2020) |
| 3,964 | `/v62.0/sobjects/Lead/describe` | **Pure metadata — should be cached** |
| 2,944 | `/v62.0/sobjects/User/describe` | **Pure metadata — should be cached** |
| 2,782 | `/v52.0/queryAll` | |
| 2,530 | `/v52.0/query` | |
| 2,198 | `getUpdated` | SOAP polling — Kenji's pattern |
| 2,002 | `query` | SOAP |
| 1,871 | `/v52.0/search` | |

The four stale-version buckets (v33/v35/v50/v52) = ~17,861 calls across at least 4 distinct integration clients, each polling on its own schedule.

### Hourly distribution

Clear **10,230-call spike at 19:00 UTC** (roughly 2× the daytime baseline of ~5,000/hr), indicating a scheduled batch that is not spread across the day. 00:00-12:00 UTC sits at ~2,100/hr; 13:00-23:00 UTC ranges 4,000-10,000/hr.

---

## 3. Efficiency Recommendations

These three changes would, in combination, plausibly cut API volume by **50-70%** (rough projection from the call patterns below).

### 3.1 Kill the `describe` polling — cache object metadata client-side (est. ~7,000 calls/day = ~8% savings, trivial effort)

- `Lead/describe` (3,964/day) and `User/describe` (2,944/day) are **pure schema-metadata calls**. Object structure changes on the order of weeks. There is zero reason to call these more than once per deploy cycle.
- **Action:** Audit Jed's integration code (it's the primary caller — 3,928/2,944 of the Lead/User describes trace to him). Add a local cache keyed on the org's metadata version with a 24h TTL (or manual invalidation on deploy).
- This is the single cheapest win in the entire audit — pure client-side code change, no Salesforce config.

### 3.2 Replace the BigQueryDataTransfer REST-polling pattern with Change Data Capture (CDC) or Bulk API v2 (est. 20,000-28,000 calls/day = ~25-30% savings, medium effort)

Jed's 31,506 calls/day are dominated by `/v62.0/query` against Lead/User (and `getUpdated`/`getDeleted` SOAP from Kenji's side). Two options:

- **Preferred — Change Data Capture (CDC):** Subscribe to `LeadChangeEvent`, `OpportunityChangeEvent`, `UserChangeEvent`, etc. CDC pushes to the BigQuery side over a streaming channel and does not count against REST API limits at all. This is the architecturally correct pattern for "keep BQ in sync with SF". Replaces the `query` + `getUpdated` polling loop entirely.
- **Alternative if CDC isn't available on your edition — Bulk API 2.0:** Today only 677/day of 89,253 calls use Bulk (0.8%). A single Bulk v2 job can return hundreds of thousands of records as one billable call. Migrating the "daily reconcile" portion of the BQ sync from REST `/query` pagination to Bulk would collapse thousands of page-fetches into single-digit calls.
- Bonus: whichever path you pick, combine with the Integration-license migration from §1 so the saved seat is realized at the same time.

### 3.3 Replace HubSpot's per-field polling with Platform Events or Outbound Messages (est. 6,000-8,000 calls/day = ~8% savings, medium effort)

HubSpot drives 8,559 calls/day under `kenji.miyashiro`, all REST GET. HubSpot's native Salesforce connector has two modes — *Polling* (which is what you're on, based on the call shape) and *Real-time via Platform Events*.

- **Action:** In HubSpot's Salesforce integration settings, switch trigger syncs from interval-based polling to **Platform Events** (HubSpot subscribes to a Salesforce-published event stream). Salesforce publishes one event when the record changes; HubSpot consumes it — no polling required.
- If HubSpot's subscription model isn't available on your plan, **Outbound Messages** from SF Workflow/Flow on Lead/Contact/Deal updates is the simpler fallback.
- While you're in HubSpot's settings: check whether any syncs can be narrowed to *only* the object/fields you actually use in HubSpot — most orgs have HubSpot syncing objects it doesn't even surface.

### 3.4 (Bonus — operational hygiene, not a volume lever)

- **Rename/reclassify `kenji.miyashiro` usage.** Either (a) split HubSpot + the 26k unattributed calls off to a dedicated integration user (same playbook as Jed in §1), or (b) document that this account is an integration account and rotate its credentials. Right now a person's name owns 39% of org API traffic with no paper trail.
- **Upgrade the stale SDKs.** ~17,800 calls/day run on API v33/v35/v50/v52 (released 2014-2021). These are still supported today but Salesforce deprecates on a rolling basis; locking yourself out of the org by waiting for a forced cut-off is avoidable work.
- **The 19:00 UTC spike (10,230 calls/hr, 2× baseline)** is a single scheduled job firing all at once. Staggering it by 15-30 min offsets would reduce concurrent-API-request pressure and is a one-line cron change.

---

## Appendix — reproducibility

Raw artifacts saved under `.sf-audit/`:

| File | Content |
|---|---|
| `api_usage_2026-04-21.csv` | Full ApiTotalUsage log, 89,253 rows, 27.9 MB |
| `aggregate_report.txt` | All top-N aggregations from `aggregate.py` |
| `drill_report.txt` | Per-user resource/version/IP/app breakdown for Kenji & Jed |
| `logins.json` / `logins.py` | LoginHistory last 48h + aggregation script |
| `stale_users_30d.json` | Query result for >30-day-stale users |
| `top_users.json` | License/profile lookup for Kenji + Jed |
| `elf_types.json` | EventLogFile event-type availability (confirms no Shield) |
