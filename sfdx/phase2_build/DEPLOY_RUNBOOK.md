# Phase 2 Deploy Runbook

**ALL commands run from `C:\Users\russe\Documents\Dashboard` (repo root).**
**Target:** `savvy` (production).
**Deploy window:** Next week, off-hours preferred (Friday 6 PM Eastern).

> ⚠️ Phase 2 does NOT run until Phase 1 is green and stable (post-canary ≥ 24 hr).
> ⚠️ Re-retrieve parent layouts (Account × 2, Opp, Lead, Contact) just before this deploy to avoid overwriting any between-phase prod changes.

---

## 0. Preconditions (T-15 min)

```bash
# Confirm prod target
sf org display --target-org savvy --json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.result.instanceUrl);"
# Expected: https://savvywealth.my.salesforce.com

# Re-retrieve layouts to catch any between-phases drift
node -e "
const c = JSON.parse(require('fs').readFileSync('.sf-audit/creds.json','utf8'));
const https = require('https');
const ids = [
  ['00hDn00000CVuHTIA1', 'account_layout_predeploy.json'],
  ['00hVS000002kq0rYAA', 'rf_account_layout_predeploy.json'],
  ['00hDn00000CVuHSIA1', 'opportunity_layout_predeploy.json'],
  ['00hDn00000CVuHRIA1', 'lead_layout_predeploy.json'],
  ['00hDn00000CVuHUIA1', 'contact_layout_predeploy.json'],
  ['00hDn00000CVuHXIA1', 'task_layout_predeploy.json']
];
let done = 0;
for (const [id, fname] of ids) {
  const url = new URL(c.u + '/services/data/v66.0/tooling/sobjects/Layout/'+id);
  https.get(url.toString(), {headers:{Authorization:'Bearer '+c.t}}, r => {
    let b=''; r.on('data',d=>b+=d); r.on('end',()=>{
      require('fs').writeFileSync('.sf-audit/'+fname, b);
      done++;
      if (done === ids.length) console.log('all retrieved');
    });
  });
}
"

# Baseline task volume snapshot
node -e "
const c = JSON.parse(require('fs').readFileSync('.sf-audit/creds.json','utf8'));
const https = require('https');
const url = new URL(c.u + '/services/data/v66.0/query/');
url.searchParams.set('q', \"SELECT CreatedBy.Profile.Name prof, COUNT(Id) c FROM Task WHERE CreatedDate = LAST_N_DAYS:1 GROUP BY CreatedBy.Profile.Name\");
https.get(url.toString(), {headers:{Authorization:'Bearer '+c.t}}, r => {
  let b=''; r.on('data',d=>b+=d); r.on('end',()=>{
    require('fs').writeFileSync('.sf-audit/phase2_baseline_'+Date.now()+'.json', b);
    console.log(b);
  });
});
"
```

**If drift detected in any layout, STOP and merge manually before proceeding.**

---

## 1. DRY-RUN (hard gate)

**Note:** Phase 2 layouts modify Account-Account Layout and Account-RF Account Layout which contain the Referrals related list from Phase 1. Dry-running Phase 2 source alone will fail with "no CustomField named Referral__c.Prospect_Account__c found" UNTIL Phase 1 is actually deployed. Two options:

**Option A (after Phase 1 real deploy — recommended):**
```bash
cd sfdx && sf project deploy start \
  --target-org savvy \
  --source-dir phase2_build/force-app \
  --dry-run \
  --wait 60 \
  --test-level RunLocalTests \
  --verbose 2>&1 | tee ../.sf-audit/phase2_dryrun_$(date +%Y%m%d_%H%M).log
```

**Option B (pre-Phase-1, combined validation):**
```bash
cd sfdx && sf project deploy start \
  --target-org savvy \
  --source-dir force-app \
  --source-dir phase2_build/force-app \
  --dry-run \
  --wait 60 \
  --test-level RunLocalTests \
  --verbose 2>&1 | tee ../.sf-audit/phase2_dryrun_$(date +%Y%m%d_%H%M).log
```

Option B was used for pre-approval validation — see `.sf-audit/phase2_dryrun_v3_*.log`.

**Expected:** `Status: Succeeded`, zero component errors.

**STOP AND REPORT if:**
- Status: Failed
- Any componentFailures entries
- Apex test failures (RunLocalTests runs existing Apex tests; if any break, investigate — they may be pre-existing)
- Layout validation errors (missing fields, RT resolution failures)

---

## 2. REAL DEPLOY

```bash
cd sfdx && sf project deploy start \
  --target-org savvy \
  --source-dir phase2_build/force-app \
  --wait 60 \
  --test-level RunLocalTests \
  --verbose 2>&1 | tee ../.sf-audit/phase2_deploy_$(date +%Y%m%d_%H%M).log
```

Expected duration: 15-25 min (Task RTs + 6 layouts + 9 profiles + Apex test run).

---

## 3. SMOKE TEST

See BUILD_SPEC.md section 6. Russell executes within 5 min of deploy completion.

**If any step fails → run Rollback (section 5) immediately.**

---

## 4. POST-DEPLOY

No PS assignments needed for Phase 2 (no PS gating). Reference_Call RT immediately available to all profiles.

Post to SGA Slack:

> Heads-up — Reference Call task type is now live in Salesforce. You'll see a "Log Reference Call" button on Account, Opportunity, Lead, and Contact pages. Required field: Referenced Advisor (picker filtered to joined advisors only). Your regular Log a Call button is unchanged. DM me if anything looks off.

---

## 5. ROLLBACK (<15 min target)

```bash
# 5a. Revert parent layouts (keeps Phase 1 Referrals related list intact)
cd sfdx && sf project deploy start \
  --target-org savvy \
  --source-dir phase2_build/rollback/force-app \
  --wait 15 --test-level NoTestRun \
  --verbose 2>&1 | tee ../.sf-audit/phase2_rollback_layouts_$(date +%Y%m%d_%H%M).log

# 5b. Delete Phase 2 components
cd sfdx && sf project deploy start \
  --target-org savvy \
  --manifest phase2_build/rollback/package.xml \
  --post-destructive-changes phase2_build/rollback/destructiveChanges.xml \
  --wait 15 --test-level NoTestRun \
  --verbose 2>&1 | tee ../.sf-audit/phase2_rollback_delete_$(date +%Y%m%d_%H%M).log

# 5c. Verify: smoke test steps 2-3 (standard Log a Call still works)
```

Destructive order:
1. `QuickAction: Global.LogReferenceCall`
2. `Layout: Task-Reference Call Layout`
3. `CustomField: Task.Referenced_Advisor__c`
4. `RecordType: Task.Reference_Call, Task.General`

---

## Command cheat sheet

| Purpose | Command |
|---|---|
| Dry-run | `cd sfdx && sf project deploy start --target-org savvy --source-dir phase2_build/force-app --dry-run --wait 60 --test-level RunLocalTests --verbose` |
| Real deploy | `cd sfdx && sf project deploy start --target-org savvy --source-dir phase2_build/force-app --wait 60 --test-level RunLocalTests --verbose` |
| Revert layouts | `cd sfdx && sf project deploy start --target-org savvy --source-dir phase2_build/rollback/force-app --wait 15 --test-level NoTestRun` |
| Destructive delete | `cd sfdx && sf project deploy start --target-org savvy --manifest phase2_build/rollback/package.xml --post-destructive-changes phase2_build/rollback/destructiveChanges.xml --wait 15 --test-level NoTestRun` |
