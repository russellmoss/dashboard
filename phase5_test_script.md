# Phase 5 Test Script — Campaign Filtering

**Run this after Phases 1–4 are complete.** Check off each item as you verify it.

---

## 1. BigQuery (already verified)

- [x] **Phase 5.2 count query**: Savvy Pirate contacted 1/1/2026–2/6/2026 = **74** (confirmed via MCP 2026-02-06)

---

## 2. API — Filters endpoint

1. Start app: `npm run dev`
2. Open dashboard in browser and log in.
3. Open DevTools → **Network**.
4. Reload or change a filter so a request to `/api/dashboard/filters` is sent.
5. Open that request → **Response**.
6. **Check:**
   - [ ] Response has a `campaigns` array.
   - [ ] At least one entry has `label: "Savvy Pirate"` and `value: "701VS00000YdiVVYAZ"`.
   - [ ] No 4xx/5xx on this request.

---

## 3. UI — GlobalFilters

1. On dashboard, find the filter row with Channel, Source, SGA, SGM, etc.
2. **Check:**
   - [ ] A **Campaign** dropdown is present (e.g. after Experimentation Tag).
   - [ ] First option is **All Campaigns**.
   - [ ] List includes **Savvy Pirate** and other campaigns.
   - [ ] Choosing a campaign and clicking **Apply filters** updates the page (no console errors).

---

## 4. UI — Advanced filters (Campaigns)

1. Click **Advanced Filters** (or equivalent).
2. In the modal, find the **Attribution** section.
3. **Check:**
   - [ ] **Campaigns** multi-select is present (e.g. after Experimentation Tags).
   - [ ] Search box filters the list.
   - [ ] **Select All** / **Deselect All** changes selection.
   - [ ] Selecting one or more campaigns and applying updates the dashboard; active filter count reflects it.

---

## 5. Critical path — Savvy Pirate

1. Set **Date range**: 1/1/2026 – 2/6/2026 (or use preset that includes this range).
2. Set **Campaign**: **Savvy Pirate**.
3. Click **Apply filters**.
4. **Check:**
   - [ ] **Contacted** scorecard shows a number (expected **74** if date range is exactly 1/1/2026–2/6/2026).
   - [ ] Click the Contacted scorecard to open drill-down.
   - [ ] Drill-down table has a **Campaign** column.
   - [ ] Rows in that column show **Savvy Pirate** (or “-” only if something is wrong).
5. Open a record (click row or View).
6. **Check:**
   - [ ] Record detail modal has **Campaign** in the Attribution section with **Savvy Pirate**.

---

## 6. Export

1. With Savvy Pirate + date range applied, open drill-down for any metric.
2. Export to CSV (or your export option).
3. **Check:**
   - [ ] File has a campaign column (e.g. `campaignName` or “Campaign”).
   - [ ] Values are **Savvy Pirate** for those rows (or “-” where applicable).

---

## 7. Regression (no campaign filter)

1. Set **Campaign** back to **All Campaigns**.
2. Click **Apply filters**.
3. **Check:**
   - [ ] Dashboard loads; scorecards and tables update.
   - [ ] Experimentation Tag filter still works.
   - [ ] Channel / Source / SGA / SGM filters still work.
   - [ ] No console errors during filter changes.

---

## 8. Sign-off

- [ ] All sections above checked.
- [ ] No blocking bugs; any minor issues recorded: _______________________

**Date run:** _______________  
**Run by:** _______________
