# Output Summary: Helen Kamens Top-Touch January Leads

**Source:** BigQuery job output `bquxjob_129388b6_19c42f762d8.json`  
**Query:** Top 3 Helen Kamens January scored-list leads by outbound touch count, then all task rows for those leads from `vw_sga_activity_performance` (non-Marketing, non-Other).

**Purpose:** Assess whether claims like *"Helen Kamens puts by far the most outbound touches per lead on Scored Jan (14.49 avg)"* are valid, or whether double-counting / misclassification explains implausibly high numbers (e.g. "14 touches before MQL is impossible").

---

## 1. What the output shows

- **Scope:** The query returns the **top 3 leads by touch count** for Helen Kamens on the January scored list. The JSON contains **~1,576 task rows**; in the sampled file, all rows are for **one lead** (`00QVS00000R6o102AB`) with **497** `total_outbound_for_this_lead`.
- **Task mix for that lead (from sampled rows):**
  - **Outgoing SMS** – genuine SGA outbound.
  - **Incoming SMS** – inbound (lead reply); correctly not “outbound” in the touch-count CTE, but the final SELECT joins to *all* activities (no direction filter), so both appear in the export.
  - **Email: [lemlist] Email sent with subject "…"** – one actual email send.
  - **"[lemlist] Clicked on link …"** – many rows with subjects like:
    - `[lemlist] Clicked on link http://savvywealth.com/ from campaign Helen's January 2025 Lead List - (step 1)`
    - `[lemlist] Clicked on link https://calendly.com/kamens-savvy/30min from campaign …`

**Counts in the file (approximate):**

| Task type | Approx. count | Interpretation |
|-----------|----------------|----------------|
| `[lemlist] Clicked on link …` | **~1,555** | Lead behavior (link click), not SGA send |
| `Email: [lemlist] Email sent with subject …` | **~9** | Actual email sends |
| `Outgoing SMS` | **~8** | Actual outbound SMS |
| `Inbound` (e.g. Incoming SMS) | **~2** | Lead-initiated |

So for this one lead, **497 “outbound” tasks** in the touch-count logic are dominated by **lemlist link-click tasks**, not 497 human outbound actions.

---

## 2. Why “14.49 avg outbound touches” is inflated

### 2.1 Lemlist link-click tasks are counted as outbound Email touches

- In `vw_sga_activity_performance_v2.sql`, any task with **Subject LIKE '%[lemlist]%'** is assigned:
  - **activity_channel_group = 'Email'**
  - **direction = 'Outbound'** (no Inbound keyword in subject)
- So **every** lemlist-created task—including **"[lemlist] Clicked on link …"**—is treated as an **outbound Email** touch.
- **"[lemlist] Clicked on link …"** is **lead behavior** (the prospect clicked a link in an email). Lemlist creates **one Salesforce Task per link click** (and possibly per link URL or per open). That is **not** SGA outbound effort; it is **engagement tracking**.

### 2.2 Effect on touch counts

- **One email send** can produce:
  - 1 task: `Email: [lemlist] Email sent with subject …`
  - N tasks: `[lemlist] Clicked on link …` (one per click, possibly per link or per open).
- So “outbound touches” are **not** “number of times the SGA contacted the lead”; they are **number of task rows** that match the view’s Email + Outbound logic, including **automated tracking events**.
- For Helen Kamens (and any SGA using lemlist email campaigns), leads who **click links** get **many extra “Email” tasks**. Those tasks:
  - Are counted in `COUNT(DISTINCT a.task_id)` in the exploration doc.
  - Pull **averages** (e.g. 14.49 or 19.49 per lead) **up**, especially for SGAs with email-heavy, link-rich campaigns.

So the claim *"Helen Kamens puts 14.49 avg outbound touches per lead on Scored Jan"* is **not** wrong in a strict SQL sense (that is what the view + query produce), but it **is** misleading for “effort” or “touches before MQL” because a large share of those “touches” are **link-click events**, not SGA-initiated contacts.

---

## 3. Are we double-counting or misclassifying?

| Issue | Verdict | Notes |
|-------|--------|--------|
| **Double-counting** (same action counted more than once) | **No** | Each task_id is distinct; we’re not literally counting one action twice. |
| **Misclassification** (wrong type of event counted as “outbound touch”) | **Yes** | **Lemlist “Clicked on link” tasks** are **lead behavior**, not SGA outbound. Counting them as outbound Email touches inflates “touches per lead” and makes numbers like “14 touches before MQL” look plausible in the data even though they don’t represent 14 human touches. |

So: **not double-counting**, but **yes misclassification** of **link-click tracking as outbound effort**.

---

## 4. Recommendations

1. **Exclude lemlist link-click tasks from “outbound touch” metrics**  
   When defining “outbound touches” for effort or touches-before-MQL:
   - Exclude tasks where `task_subject LIKE '%[lemlist]%Clicked on link%'` (or equivalent), **or**
   - Exclude `Subject LIKE '%Clicked on link%'` so all link-click tracking (lemlist or other tools) is excluded.  
   That way “touches” = SGA-initiated actions (sends, calls, SMS, etc.), not lead clicks.

2. **Re-run Helen Kamens (and any email-heavy SGA) with the exclusion**  
   Recompute “avg outbound touches per lead” and “touches before MQL” after excluding link-click tasks. The averages should drop (likely into a range that makes “X touches before MQL” plausible as human touches).

3. **Optional: separate “email sends” vs “email engagement” in the view**  
   Long-term, the view could classify “[lemlist] Clicked on link” (and similar) into a bucket like “Email (engagement)” or “Tracking” and **exclude that bucket** from “outbound touch” KPIs, while still keeping the data available for engagement analytics.

---

## 5. Bottom line

- The **raw numbers** (e.g. 14.49 or 19.49 avg outbound touches for Helen Kamens) are **correct** given the current logic: the view counts every non-Marketing, non-Other task, and lemlist **link-click** tasks are Email + Outbound, so they are included.
- The **interpretation** that those numbers represent “SGA outbound effort” or “touches before MQL” in a human sense is **wrong** for email-heavy SGAs: a large portion of the count is **link-click tracking**, not SGA-initiated touches.
- So the claim *"Helen Kamens puts by far the most outbound touches per lead (14.49 avg)"* is **misleading**: she likely has the most **task rows** per lead (driven by lemlist link-click events), not necessarily the most **human touches**. To make “touches” meaningful for effort or for “14 touches before MQL,” **link-click tasks should be excluded** from the touch definition used in that analysis.
