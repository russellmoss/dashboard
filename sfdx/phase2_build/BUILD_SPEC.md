# Phase 2 Build Spec — Task Reference Call (Simplified)

**Target org:** `savvy` (production, `https://savvywealth.my.salesforce.com`)
**Deploy window:** NEXT WEEK (NOT this weekend — Phase 1 ships first)
**Deploy method:** `sf project deploy start --source-dir phase2_build/force-app`
**Scope decision basis:** Steven confirmed separate tasks per advisor is acceptable → no multi-select, no junction object, no screen flow, no PS gating.

---

## 1. Scope

Single custom Lookup field on Task + a Reference_Call record type + a Log Reference Call quick action. A reference call for multiple advisors = multiple Tasks, one per advisor. Anyone can log.

**Not in scope:** Junction object, multi-select UX, Opportunity fields for reference attribution, permission set gating.

---

## 2. Components inventory (15 files)

| Type | Name | Purpose |
|---|---|---|
| RecordType | `Task.General` | Default for all existing task creation paths |
| RecordType | `Task.Reference_Call` | New RT for reference-call tasks |
| CustomField | `Task.Referenced_Advisor__c` | Lookup → Account, filtered, required only on Reference_Call RT layout |
| Layout | `Task-Task Layout` | Unmodified re-deploy (General RT needs layout assignment) |
| Layout | `Task-Reference Call Layout` | New Task layout, includes `Referenced_Advisor__c` as Required |
| Layout | `Account-Account Layout` (modified) | + `LogReferenceCall` platformAction |
| Layout | `Account-RF  Account Layout` (modified) | + `LogReferenceCall` platformAction |
| Layout | `Opportunity-Opportunity Layout` (modified) | + `LogReferenceCall` platformAction (Recruiting RT only) |
| Layout | `Lead-Lead Layout` (modified) | + `LogReferenceCall` platformAction |
| Layout | `Contact-Contact Layout` (modified) | + `LogReferenceCall` platformAction |
| QuickAction | `Global.LogReferenceCall` | LogACall-type, bound to `Task.Reference_Call` RT, pre-fills `Referenced_Advisor__c` as required |
| Profile (delta) × 9 | 9 profiles | Layout assignments + RT visibilities (both RTs visible, General default) |

**Excluded:** Re-Engagement Opportunity Layout (Re-Engagement RT doesn't need the button per product decision).

---

## 3. Data model

```
Account (Standard_Recruiting RT, Won_Opportunities__c > 0 — the referenced advisor)
  └──< Task (Reference_Call RT)    via  Task.Referenced_Advisor__c (Lookup)
```

One Task per advisor referenced. If a team member gets references from 3 advisors on a single prospect outreach, they create 3 Tasks (one per advisor). This is Steven's confirmed design pattern.

---

## 4. Permission model

**No permission sets and no permission set group for Phase 2.**

All 9 profiles have Reference_Call RT visible (non-default). Anyone with Task create permission today can:
1. See the "Log Reference Call" button on parent records (Account, Opp, Lead, Contact)
2. Open the quick action composer
3. Must pick a joined advisor to save (lookup filter enforces)

No gating, no canary population — deploy = org-wide availability.

---

## 5. Deploy sequence

1. Custom field `Task.Referenced_Advisor__c`
2. Record types `Task.General`, `Task.Reference_Call`
3. Layouts: `Task-Task Layout` (unmodified), `Task-Reference Call Layout` (new), modified parent layouts (Account × 2, Opp, Lead, Contact)
4. Quick action `Global.LogReferenceCall`
5. Profile deltas × 9 (bind RTs to layouts)

Salesforce resolves dependencies automatically on `--source-dir phase2_build/force-app`.

---

## 6. Smoke test (Russell, within 5 min of deploy)

| # | Action | Expected | Failure → |
|---|---|---|---|
| 1 | Open any Account in Lightning | Page loads, no errors | ROLLBACK |
| 2 | Activity composer → Log a Call | Standard composer, no RT picker dialog, no new fields | ROLLBACK |
| 3 | Save test Log a Call | Task saves, RecordType = `General` | ROLLBACK |
| 4 | Look for "Log Reference Call" button | Visible on Account, Opp (Recruiting), Lead, Contact layouts | ROLLBACK |
| 5 | Click "Log Reference Call" | Composer opens with Reference_Call RT; Subject + Referenced Advisor required | ROLLBACK |
| 6 | Try to save without filling Referenced Advisor | Save blocked, required error | ROLLBACK |
| 7 | Search Referenced Advisor picker for a NON-joined advisor (e.g. a Recruitment_Firm account) | Not in results (filter working) | ROLLBACK |
| 8 | Pick a joined advisor + save | Task saves; RecordType = `Reference_Call`; Referenced_Advisor__c populated | ROLLBACK |

**One-hour volume check:**
```sql
SELECT CreatedBy.Profile.Name, COUNT(Id) FROM Task WHERE CreatedDate = LAST_N_DAYS:1 AND CreatedDate > <deploy-timestamp> GROUP BY CreatedBy.Profile.Name
```
Expected: ~1,567/day = ~65/hr Standard User baseline. If post-deploy hourly rate drops to <20, suspect composer friction — consider rollback.

---

## 7. Rollback (<15 min target)

Pre-staged: `sfdx/phase2_build/rollback/`

### Sequence

1. **Revert parent layouts to pre-Phase-2 state** (reverts to Phase-1-modified state — keeps Referrals related list intact for Account layouts):
   ```
   cd sfdx && sf project deploy start --target-org savvy \
     --source-dir phase2_build/rollback/force-app \
     --wait 15 --test-level NoTestRun
   ```

2. **Delete Phase 2 components:**
   ```
   cd sfdx && sf project deploy start --target-org savvy \
     --manifest phase2_build/rollback/package.xml \
     --post-destructive-changes phase2_build/rollback/destructiveChanges.xml \
     --wait 15 --test-level NoTestRun
   ```

Destructive manifest deletes:
- `QuickAction: Global.LogReferenceCall`
- `Layout: Task-Reference Call Layout`
- `CustomField: Task.Referenced_Advisor__c`
- `RecordType: Task.Reference_Call, Task.General`

---

## 8. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Lightning RT picker fires on regular Log a Call after Task RTs introduced | High | Smoke test step 2-3 catches immediately; existing `NewTask`/`LogACall` are RT-null so should adopt General silently; rollback pre-staged |
| Layout changes overwrite unknown mods if prod Account layouts changed between Phase 1 → Phase 2 | Medium | Re-retrieve parent layouts just before Phase 2 deploy; diff against cached; if drift, merge manually |
| Lookup filter on polymorphic WhatId... wait, this is a regular Account Lookup, not polymorphic | N/A | No issue — regular lookup filter fully supported |
| Task_Reference__c from old design somehow lingers | N/A | Archived to `sfdx/phase2_deprecated/`, never deployed |

---

## 9. Decisions encoded

| # | Decision | Source |
|---|---|---|
| D1 | Separate Task per advisor, no multi-select | Steven via Slack |
| D2 | No PS gating, RT visible on all 9 profiles | Steven |
| D3 | `Referenced_Advisor__c` required only on Reference_Call RT layout | User |
| D4 | LogReferenceCall on Opportunity Recruiting RT only, not Re-Engagement | User |
| D5 | Task-Task Layout re-deployed unmodified for RT assignment | User |
| D6 | Phase 2 deploys NEXT week, not bundled with Phase 1 | User |

---

**End of Phase 2 spec.**
