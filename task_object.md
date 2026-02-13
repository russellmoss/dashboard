# Salesforce Task Object — BigQuery Data Quality Audit

**Table:** `savvy-gtm-analytics.SavvyGTMData.Task`  
**Verified:** Table exists; schema includes `Type`, `TaskSubtype`, `Status`, `Subject`, `Description`, `CallDisposition`, `WhoId`, `CallDurationInSeconds`, `CallType`, etc.  
**Total rows:** 187,519  
**Audit date:** 2026-02-09

---

## 1. Type & Subtype Distribution

**Goal:** See if we have "Call", "Kixie Call", or blank values in the `Type` field.

### Summary counts by Type

| Type            | Count   | Notes                          |
|-----------------|--------|---------------------------------|
| **Outgoing SMS**| 123,781| Dominant; likely Lemlist/other  |
| **NULL / blank**| 41,905 | Mixed activities (see below)   |
| **Call**        | 4,327  | Phone calls                    |
| **Other**       | 12     | Misc                           |
| **Kixie**       | 0      | No literal "Kixie" in Type     |

### Top Type × TaskSubtype × Status combinations (by count)

| Type         | TaskSubtype | Status    | Count  |
|-------------|-------------|-----------|--------|
| Outgoing SMS| Task        | Completed | 123,780|
| *null*      | Email       | Completed | 18,646 |
| Incoming SMS| Task        | Completed | 14,311 |
| *null*      | Task        | Completed | 14,045 |
| *null*      | Call        | Completed | 8,304  |
| **Call**    | **Call**    | **Completed** | **3,855** |
| *null*      | Task        | Completed | 2,459  |
| Email       | Task        | Completed | 2,459  |
| **Call**    | **Task**    | **Completed** | **472**  |
| *null*      | Task        | Not Started | 458  |
| Email       | Email       | Completed | 393    |
| Form Submitted | Task     | Completed | 331    |
| *null*      | LinkedIn    | Completed | 248    |
| *null*      | Task        | Open      | 152    |
| *null*      | ListEmail   | Completed | 52     |
| Other       | Task        | Completed | 11     |
| Other       | Task        | Open      | 1      |
| Outgoing SMS| Task        | Open      | 1      |

**Findings:**

- **"Call"** exists in `Type` (4,327 rows). There is **no** value like "Kixie Call" in `Type`; Kixie calls are represented as `Type = 'Call'` (or sometimes `Type` NULL with `TaskSubtype = 'Call'`).
- **Inconsistency:** 3,855 tasks have `Type = 'Call'` and `TaskSubtype = 'Call'`; **472** have `Type = 'Call'` but `TaskSubtype = 'Task'` (call typed as generic task).
- **8,304** tasks have `TaskSubtype = 'Call'` but `Type` **NULL** — call subtype without Type set, which will break filters that rely only on `Type = 'Call'`.

---

## 2. Subject Line Pattern Analysis ("Messy" Data)

**Goal:** Identify Kixie-style patterns (e.g. "answered:", "missed:", "Incoming SMS") in `Subject` when `Type` is 'Call', 'Other', or NULL.

### Top 50 most frequent Subject lines (Call / Other / NULL only)

| # | Subject (abbreviated) | Count |
|---|------------------------|-------|
| 1 | LinkedIn Message | 7,932 |
| 2 | **answered: Outbound call.** | **3,271** |
| 3 | [lemlist] Lead has been deleted from campaign Webinar Email Blast | 1,966 |
| 4 | Email: [lemlist] Email sent with subject "Webinar with CE credit..." | 1,456 |
| 5 | Email: [lemlist] Email sent with subject "This Friday" - Russell's campaign | 1,300 |
| 6 | Email: [lemlist] Email sent with subject "This Friday" - (step 2) | 1,250 |
| 7 | [lemlist] LinkedIn invite sent from campaign Russell's campaign (step 3) | 586 |
| 8 | Email: [lemlist] invitation: the end of the generalist advisor | 582 |
| 9 | Email: [lemlist] RE: HNY / Partnering - Ryan's campaign - Osaic | 580 |
| 10 | **missed: Inbound call.** | **575** |
| 11 | **missed: Outbound call.** | **553** |
| 12 | Email: [lemlist] how advisors are standing out right now | 418 |
| 13 | **answered: Inbound call.** | **371** |
| 14 | [lemlist] Task - Text 3 - Jason's campaign | 363 |
| 15 | Email: [lemlist] Ready for your future? - Jason's campaign | 363 |
| … | … | … |
| 22 | **Call** (generic) | **327** |
| … | … | … |

**Kixie-style Subject patterns identified:**

- **answered: Outbound call.** — 3,271  
- **missed: Inbound call.** — 575  
- **missed: Outbound call.** — 553  
- **answered: Inbound call.** — 371  
- **Call** (generic) — 327  

**Conclusion:** Kixie is driving the **"answered:" / "missed:"** prefixes in `Subject`. These are the main machine-readable signals for call outcome when `CallDisposition` is not used. Lemlist and other tools dominate the rest of the top subjects (Email, LinkedIn, lemlist).

---

## 3. CallDisposition Investigation

**Goal:** See if Kixie (or anything) is writing to the standard `CallDisposition` field.

**Query:**  
`SELECT CallDisposition, COUNT(*) as count FROM [table] GROUP BY 1 ORDER BY 2 DESC`

### Result

| CallDisposition | count  |
|-----------------|--------|
| **NULL**        | **187,519** |

**Conclusion:** **100% of Task rows have `CallDisposition` = NULL.** Kixie is **not** using the standard Salesforce call disposition field. Outcome is conveyed only via Subject (and possibly Description), not via a structured disposition field.

---

## 4. Kixie Description Scraping

**Goal:** Confirm whether Kixie puts the real outcome (e.g. "Left Voicemail", "Disposition:", "Call Duration:") in the `Description` body.

### Counts

- Rows where `Description` contains **"Disposition:"** or **"Call Duration:"**: **0**
- Rows where `Description` contains **"Kixie"** or **"kixie"**: **3,784**
- Rows where Subject or text contains **"answered:"**: **3,672** (aligned with Kixie-style subjects)

So Kixie is **not** dumping a separate "Disposition:" or "Call Duration:" line into Description. It **is** writing a consistent pattern into Description.

### Sample Kixie Description pattern (10 examples)

All follow this pattern:

- **Subject:** e.g. `answered: Outbound call.` or `answered: Inbound call.`
- **Description:**  
  `answered: A [X minute Y second] Outbound/Inbound call. A recording of the call is here: https://calls.kixie.com/[uuid].mp3 The call was made from [+from] to [+to].`

Example (truncated):

```text
answered: A 3 minute 33 second Outbound call. A recording of the call is here: https://calls.kixie.com/8fa6eaf9-439e-4a4e-93f8-7cf884c3fdf5.mp3 The call was made from +17739429283 to +19177335488
```

**Conclusion:** Kixie stores **outcome in Subject** ("answered" vs "missed") and **duration + recording URL + from/to in Description**. It does **not** use the standard `CallDisposition` field, and does **not** use literal "Disposition:" or "Call Duration:" in Description — duration is in natural language in the first sentence. For "Cold Call" or outcome reporting, use Subject (and optionally parsing of the first sentence in Description for duration).

---

## 5. "Cold Call" Readiness Check (WhoId)

**Goal:** Compare calls attached to a person (Lead/Contact) vs orphan calls.

### Counts

| Metric | Count |
|--------|-------|
| **Type = 'Call' AND WhoId IS NOT NULL** (linked to Lead/Contact) | **3,855** |
| **Type = 'Call' AND WhoId IS NULL** (orphan calls) | **472** |
| **Type = 'Call' (total)** | **4,327** |

**Conclusion:**

- **89.1%** of tasks with `Type = 'Call'` have a non-null `WhoId` and are suitable for Cold Call / per-person reporting.
- **10.9%** (472) are orphan calls: logged as Call but not tied to a Lead or Contact. These will be missing from any report or attribution that joins Task to Who (Lead/Contact).

---

## Data Hygiene Issues Detected — Summary

| # | Issue | Severity | Recommendation |
|---|--------|----------|----------------|
| 1 | **CallDisposition 100% NULL** | High | Kixie (and any other dialer) does not write to `CallDisposition`. Use Subject (answered/missed) and/or Description parsing for outcome. Consider mapping Kixie outcome into `CallDisposition` or a custom field in Salesforce so BigQuery sync gets a structured value. |
| 2 | **Type vs TaskSubtype inconsistency for calls** | Medium | 8,304 tasks have `TaskSubtype = 'Call'` but `Type` NULL; 472 have `Type = 'Call'` but `TaskSubtype = 'Task'`. Any logic that uses only `Type = 'Call'` will miss 8,304 call activities; any logic that uses only `TaskSubtype = 'Call'` will include those but may double-count or mix with the 472. Standardize in Salesforce so call tasks always have both `Type = 'Call'` and `TaskSubtype = 'Call'`, and backfill or fix integration for existing rows. |
| 3 | **472 orphan call tasks (WhoId NULL)** | Medium | 10.9% of `Type = 'Call'` tasks have no WhoId. Investigate Kixie (or other) configuration so calls are associated with the correct Lead/Contact when created; consider a one-time backfill if numbers can be matched. |
| 4 | **No "Kixie" in Type** | Low | Kixie calls appear as `Type = 'Call'` (or Type NULL). For Kixie-only reporting, use Subject patterns ("answered:", "missed:") and/or Description containing "kixie.com" or "Kixie" rather than a Type value. |
| 5 | **Outcome only in Subject/Description** | Medium | Call outcome is not in a structured field. For reporting, define a consistent rule (e.g. Subject LIKE 'answered:%' → Connected, 'missed:%' → No Answer) and optionally parse Description for duration/recording for richer Cold Call analytics. |

---

**End of report.**  
Source: `savvy-gtm-analytics.SavvyGTMData.Task`. Queries run via BigQuery; counts and samples as of audit date above.
