# Weekly Goals vs. Actuals — Feature Spec & Build Guide Reference

## Overview

This document defines the requirements for a new **"Weekly Goals vs. Actuals"** tab in the SGA Hub of the dashboard at `https://dashboard-eta-lime-45.vercel.app/dashboard/sga-hub`.

This tab **deprecates the current "Weekly Goals" tab**, which is connected to the `WeeklyGoal` table in Neon. That table will be dropped and recreated (still called `WeeklyGoal`) with a new schema to support the features below.

---

## 1. User Roles & Access

### SGA View
- Can see **only their own data**.
- Can set and edit their own goals (subject to editability rules below).

### Admin / RevOps Admin View
- Can see **every SGA's data**.
- Has a **rollup view** showing all SGA data aggregated and graphed together.
- Can also drill into **individual SGA views** with full tabular and graphical representations.
- Has **all the same drilldown capabilities** as the SGA view.
- Has the **ability to edit goals** on behalf of SGAs.

---

## 2. Week Definition ("Monday-ized" Weeks)

All weeks run **Monday through Sunday**.

Example based on today being **3/9/2026** (a Monday):

| Section | Date Range |
|---------|------------|
| Last Week | 3/2/2026 – 3/8/2026 |
| This Week | 3/9/2026 – 3/15/2026 |
| Next Week | 3/16/2026 – 3/22/2026 |

---

## 3. Three Sections

### 3.1 Last Week

**Purpose:** Historical review. Goals and actuals are locked — no editing.

**Displays:**

- **MQL Goal** vs. **MQL Actuals** (drilldownable)
- **SQL Goal** vs. **SQL Actuals** (drilldownable)
- **SQO Goal** vs. **SQO Actuals** (drilldownable)
- **Initial Calls Goal** vs. **Initial Calls Actuals** (drilldownable) — actual initial calls that occurred during that week
- **Qualification Calls Goal** vs. **Qualification Calls Actuals** (drilldownable) — actual qualification calls that occurred with an SGM during that week, related to SQL'ed candidates attached to the SGA
- **Leads Sourced** scorecard — count of all people the SGA created in the CRM during that week (see [Section 5: Identifying Self-Sourced Leads](#5-identifying-self-sourced-leads-in-bigquery)) — shown against goal (locked/not editable)
- **Leads Contacted** scorecard — with a **toggle for "All" and "Self-Sourced"**:
  - "All" = total leads contacted in that period
  - "Self-Sourced" = of self-sourced leads only, how many were contacted during that period
  - Shown against goal (locked/not editable)

**Editability:** None. All goals are **frozen** once a week becomes "last week."

### 3.2 This Week

**Purpose:** Active tracking. Goals are still editable. Actuals update in real time.

**Displays:**

- **MQL Goal** (editable) vs. **MQL Actuals** (drilldownable)
- **SQL Goal** (editable) vs. **SQL Actuals** (drilldownable)
- **SQO Goal** (editable) vs. **SQO Actuals** (drilldownable)
- **Initial Calls Goal** (editable) vs. **Initial Calls Actuals** (drilldownable)
- **Qualification Calls Goal** (editable) vs. **Qualification Calls Actuals** (drilldownable)
- **Leads Sourced** scorecard — count of all people the SGA created in the CRM during this week — shown against goal (editable)
- **Leads Contacted** scorecard — with a **toggle for "All" and "Self-Sourced"** — shown against goal (editable)

**Editability:** All 7 goals (MQL, SQL, SQO, Initial Calls, Qualification Calls, Leads Sourced, Leads Contacted) are **editable** during the current week.

### 3.3 Next Week

**Purpose:** Forward planning. Setting goals for the upcoming week. Actuals limited to what's already on the books.

**Displays:**

- **MQL Goal** (editable)
- **SQL Goal** (editable)
- **SQO Goal** (editable)
- **Initial Calls Goal** (editable) vs. **Initial Calls Actuals** — calls already scheduled/on the books for next week (drilldownable)
- **Qualification Calls Goal** (editable) vs. **Qualification Calls Actuals** — qualification calls already scheduled for next week (drilldownable)
- **Leads Sourced Goal** (editable) — how many leads the SGA plans to create next week
- **Leads Contacted Goal** (editable) — how many leads the SGA plans to reach out to next week

**Editability:** All 7 goals are editable. The intention is SGAs set next week's goals during the current week, but can still overwrite them once next week becomes the current week.

---

## 4. Goal Editability Rules Summary

| Goal Field | Next Week | This Week | Last Week |
|------------|-----------|-----------|-----------|
| MQL Goal | Editable | Editable | Locked |
| SQL Goal | Editable | Editable | Locked |
| SQO Goal | Editable | Editable | Locked |
| Initial Calls Goal | Editable | Editable | Locked |
| Qualification Calls Goal | Editable | Editable | Locked |
| Leads Sourced Goal | Editable | Editable | Locked |
| Leads Contacted Goal | Editable | Editable | Locked |

---

## 5. Identifying Self-Sourced Leads in BigQuery

### Definition

A self-sourced lead is one that an SGA personally sourced (via FinTrx or LinkedIn), as opposed to leads assigned from provided lists, events, or inbound channels.

### Identification Logic

Filter on `Final_Source__c` in the `savvy-gtm-analytics.SavvyGTMData.Lead` table:

```sql
SELECT Id, FirstName, LastName, SGA_Owner_Name__c, Final_Source__c, CreatedDate
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND CreatedDate >= @week_start
  AND CreatedDate < @week_end
```

### Key Fields

- **`Final_Source__c`** — the authoritative field. Two values qualify as self-sourced:
  - `Fintrx (Self-Sourced)` — leads pulled from the FinTrx platform
  - `LinkedIn (Self Sourced)` — leads sourced via LinkedIn
- **`SGA_Owner_Name__c`** — attributes the lead to the specific SGA. 100% populated on self-sourced leads.
- **`CreatedDate`** — use for weekly windowing.

### Fields to Avoid

| Field | Why |
|-------|-----|
| `CreatedById` | Shows "Savvy Operations" (system user) for bulk-loaded FinTrx records — not the actual SGA |
| `SGA_Self_List_name__c` | Only populated on ~27% of FinTrx self-sourced leads and 0% of LinkedIn — unreliable as a filter |
| `SGA_Owner_Name__c` alone | Populated on *all* lead types, not just self-sourced — must pair with `Final_Source__c` |

---

## 6. Drilldown Behavior

All numeric actuals (MQLs, SQLs, SQOs, Initial Calls, Qualification Calls, Leads Sourced, Leads Contacted) should be **clickable numbers** that:

1. Open a **modal** showing a table of all records that occurred in that timeframe.
2. Each row in that modal table should be **further drilldownable** to view the full details of that individual record.

This applies to all three sections (Last Week, This Week, Next Week) wherever actuals are displayed. For Next Week, the drilldown into Initial Calls and Qualification Calls shows who is actually scheduled for next week.

---

## 7. Graphs — Goals vs. Actuals Over Time

Three line graphs, each showing weekly goals vs. actuals over time.

### Graph 1: Pipeline Metrics
- **Metrics (toggleable on/off):** MQL, SQL, SQO
- Each metric has a **goal line** and an **actuals line**

### Graph 2: Call Metrics
- **Metrics (toggleable on/off):** Initial Calls Scheduled, Qualification Calls Scheduled
- Each metric has a **goal line** and an **actuals line**

### Graph 3: Lead Activity Metrics
- **Metrics (toggleable on/off):** Leads Created, Leads Contacted
- Each metric has a **goal line** and an **actuals line**

### Graph Defaults & Controls
- Default view: **trailing 90 days**
- Date range is **customizable** — user can shrink or expand the window to focus on different time periods

---

## 8. Admin / RevOps Admin Rollup View

In addition to being able to view individual SGA data, Admin and RevOps Admin users get:

- A **rollup view** with all SGA data aggregated together — both in tabular and graphical form.
- Ability to **switch between rollup and individual SGA views**.
- Individual SGA views retain all functionality: drilldowns, goal editing, graphs.
- Graphs in rollup view show the same three graph types (Pipeline, Calls, Lead Activity) with aggregated data across all SGAs.

---

## 9. Database Changes

### Table: `WeeklyGoal` (Neon — Drop & Recreate)

The existing `WeeklyGoal` table will be **dropped and recreated** with a new schema. The table name stays the same.

### New Schema Requirements (to be determined during data exploration)

The new `WeeklyGoal` table needs to store, at minimum:

- `sga_user_id` — foreign key to the SGA user
- `week_start_date` — the Monday of the goal week
- `mql_goal` — integer
- `sql_goal` — integer
- `sqo_goal` — integer
- `initial_calls_goal` — integer
- `qualification_calls_goal` — integer
- `leads_sourced_goal` — integer
- `leads_contacted_goal` — integer
- `created_at` / `updated_at` — timestamps

> **Note:** The exact schema will be finalized after data exploration and codebase review. The above is the minimum set of fields implied by the feature requirements.

---

## 10. Data Sources Summary

| Data Point | Source | Key Fields / Notes |
|------------|--------|--------------------|
| MQL / SQL / SQO Actuals | TBD (data exploration needed) | Likely Salesforce via BigQuery or Neon |
| Initial Calls Actuals | TBD (data exploration needed) | Actual initial calls that occurred or are scheduled |
| Qualification Calls Actuals | TBD (data exploration needed) | Calls with SGM related to SQL'ed candidates attached to the SGA |
| Leads Sourced (all) | BigQuery: `savvy-gtm-analytics.SavvyGTMData.Lead` | Count by `SGA_Owner_Name__c` + `CreatedDate` window |
| Leads Sourced (self-sourced) | BigQuery: `savvy-gtm-analytics.SavvyGTMData.Lead` | Filter `Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')` |
| Leads Contacted | TBD (data exploration needed) | Contact activity within the time period |
| Goals (all 7 metrics) | Neon: `WeeklyGoal` table | Keyed by SGA + week_start_date |

---

## 11. Open Questions for Data Exploration

These are items to resolve during codebase and data exploration before building:

1. **MQL / SQL / SQO actuals source** — Where do these currently come from in the codebase? BigQuery? Neon? Salesforce direct?
2. **Initial Calls / Qualification Calls data source** — What table(s) and fields define these? How do we identify "initial" vs "qualification" call types? How do we associate qualification calls with an SGM and SQL'ed candidates?
3. **Leads Contacted definition** — What constitutes a "contact"? Is this an activity record? Email sent? Call made? What table/field tracks this?
4. **Leads Contacted "self-sourced" toggle** — For the self-sourced filter on leads contacted, do we join back to the Lead table on `Final_Source__c`, or is there a contact activity table that carries the source forward?
5. **Existing SGA Hub tab structure** — How are tabs currently implemented? What components/routes need to change?
6. **Current WeeklyGoal table schema** — What does the existing table look like so we can plan the migration cleanly?
7. **User role detection** — How does the dashboard currently determine if a user is SGA vs Admin vs RevOps Admin?
8. **SGA user ↔ SGA_Owner_Name__c mapping** — How do we map the dashboard user to the `SGA_Owner_Name__c` value in BigQuery?

---

## 12. Next Steps

1. **Data exploration** — Query BigQuery and Neon to answer the open questions in Section 11.
2. **Codebase exploration** — Review the existing SGA Hub, Weekly Goals tab, API routes, and component structure.
3. **Build guide creation** — Using the findings from steps 1 and 2, create a detailed build guide with schema definitions, API endpoints, component hierarchy, and implementation order.
