# Phase 1 Deploy Runbook

**ALL commands run from `C:\Users\russe\Documents\Dashboard` (repo root).**
**Target:** `savvy` (production).
**Deploy window:** Friday 6 PM Eastern.
**Estimated end-to-end time:** 20-40 min (dry-run + deploy + PSG assign + smoke test).

> ⚠️ HARD GATE: Dry-run must pass with zero errors before real deploy fires.
> ⚠️ This runbook covers Phase 1 ONLY. Phase 2 has its own runbook at `phase2_build/DEPLOY_RUNBOOK.md`, next week.

---

## 0. Preconditions (T-15 min)

```bash
# Verify prod target
sf org display --target-org savvy --json | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.result.instanceUrl);"
# Expected: https://savvywealth.my.salesforce.com

# Integrity checks
ls sfdx/sfdx-project.json
ls sfdx/force-app/main/default/objects/Referral__c/Referral__c.object-meta.xml
ls sfdx/rollback/destructiveChanges.xml

# Baseline snapshot
node -e "
const c = JSON.parse(require('fs').readFileSync('.sf-audit/creds.json','utf8'));
const https = require('https');
const queries = {
  tasks_24h: \"SELECT COUNT(Id) c FROM Task WHERE CreatedDate = LAST_N_DAYS:1\",
  adv_ref_opps: \"SELECT COUNT(Id) c FROM Opportunity WHERE Final_Source__c='Advisor Referral'\",
  won_accts: \"SELECT COUNT(Id) c FROM Account WHERE Won_Opportunities__c > 0\"
};
(async () => {
  const out = {captured_at: new Date().toISOString()};
  for (const [k, q] of Object.entries(queries)) {
    const url = new URL(c.u + '/services/data/v66.0/query/');
    url.searchParams.set('q', q);
    out[k] = await new Promise((res) => https.get(url.toString(), {headers:{Authorization:'Bearer '+c.t}}, r => {let b=''; r.on('data',d=>b+=d); r.on('end',()=>{res(JSON.parse(b).records[0].c);});}));
  }
  require('fs').writeFileSync('.sf-audit/phase1_predeploy_'+Date.now()+'.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})();
"
```

Expected baseline (as of 2026-04-22): `adv_ref_opps=52, won_accts=99`.

---

## 1. DRY-RUN GATE (hard gate)

```bash
cd sfdx && sf project deploy start \
  --target-org savvy \
  --source-dir force-app \
  --dry-run \
  --wait 60 \
  --test-level RunLocalTests \
  --verbose 2>&1 | tee ../.sf-audit/phase1_dryrun_$(date +%Y%m%d_%H%M).log
```

**Expected:** `Status: Succeeded`, zero errors.

**STOP AND REPORT if any failure.** Do not proceed to step 2.

---

## 2. REAL DEPLOY

```bash
cd sfdx && sf project deploy start \
  --target-org savvy \
  --source-dir force-app \
  --wait 60 \
  --test-level RunLocalTests \
  --verbose 2>&1 | tee ../.sf-audit/phase1_deploy_$(date +%Y%m%d_%H%M).log
```

Expected duration: 10-15 min (plus Apex test time from RunLocalTests).

---

## 3. VERIFY PSG status

```bash
node -e "
const c = JSON.parse(require('fs').readFileSync('.sf-audit/creds.json','utf8'));
const https = require('https');
const url = new URL(c.u + '/services/data/v66.0/query/');
url.searchParams.set('q', \"SELECT Id, DeveloperName, Status FROM PermissionSetGroup WHERE DeveloperName = 'Referral_RevOps'\");
https.get(url.toString(), {headers:{Authorization:'Bearer '+c.t}}, r => {
  let b=''; r.on('data',d=>b+=d); r.on('end',()=>{console.log(JSON.stringify(JSON.parse(b).records, null, 2));});
});
"
```

Wait until Status = `Updated` (usually <5 min). Then proceed.

---

## 4. ASSIGN RevOps PSG

```bash
# Get Russell/Kenji/Jed user IDs
node -e "
const c = JSON.parse(require('fs').readFileSync('.sf-audit/creds.json','utf8'));
const https = require('https');
const url = new URL(c.u + '/services/data/v66.0/query/');
url.searchParams.set('q', \"SELECT Id, Email FROM User WHERE Email IN ('russell.moss@savvywealth.com','kenji.miyashiro@savvywealth.com','jed.entin@savvywealth.com')\");
https.get(url.toString(), {headers:{Authorization:'Bearer '+c.t}}, r => {
  let b=''; r.on('data',d=>b+=d); r.on('end',()=>{console.log(JSON.parse(b).records);});
});
"

# Get PSG Id
node -e "
const c = JSON.parse(require('fs').readFileSync('.sf-audit/creds.json','utf8'));
const https = require('https');
const url = new URL(c.u + '/services/data/v66.0/query/');
url.searchParams.set('q', \"SELECT Id FROM PermissionSetGroup WHERE DeveloperName='Referral_RevOps'\");
https.get(url.toString(), {headers:{Authorization:'Bearer '+c.t}}, r => {
  let b=''; r.on('data',d=>b+=d); r.on('end',()=>{console.log(JSON.parse(b).records);});
});
"

# Assign (substitute IDs):
sf data create record -s PermissionSetAssignment -v "AssigneeId=<russell-id> PermissionSetGroupId=<psg-id>" -o savvy
sf data create record -s PermissionSetAssignment -v "AssigneeId=<kenji-id> PermissionSetGroupId=<psg-id>" -o savvy
sf data create record -s PermissionSetAssignment -v "AssigneeId=<jed-id> PermissionSetGroupId=<psg-id>" -o savvy
```

---

## 5. SMOKE TEST (Russell, <5 min)

Execute 7 steps from `BUILD_SPEC.md` section 6. If any fails → run Rollback (section 6).

---

## 6. ROLLBACK (<15 min)

```bash
# 6a. Remove PSG assignments
# Find PSAs:
node -e "
const c = JSON.parse(require('fs').readFileSync('.sf-audit/creds.json','utf8'));
const https = require('https');
const url = new URL(c.u + '/services/data/v66.0/query/');
url.searchParams.set('q', \"SELECT Id, Assignee.Email FROM PermissionSetAssignment WHERE PermissionSetGroup.DeveloperName = 'Referral_RevOps'\");
https.get(url.toString(), {headers:{Authorization:'Bearer '+c.t}}, r => {
  let b=''; r.on('data',d=>b+=d); r.on('end',()=>{console.log(JSON.parse(b).records);});
});
"
# Delete each: sf data delete record -s PermissionSetAssignment -i <psa-id> -o savvy

# 6b. Revert layouts
cd sfdx && sf project deploy start \
  --target-org savvy \
  --source-dir rollback/force-app \
  --wait 15 --test-level NoTestRun \
  --verbose 2>&1 | tee ../.sf-audit/phase1_rollback_layouts_$(date +%Y%m%d_%H%M).log

# 6c. Delete new components
cd sfdx && sf project deploy start \
  --target-org savvy \
  --manifest rollback/package.xml \
  --post-destructive-changes rollback/destructiveChanges.xml \
  --wait 15 --test-level NoTestRun \
  --verbose 2>&1 | tee ../.sf-audit/phase1_rollback_delete_$(date +%Y%m%d_%H%M).log
```

---

## 7. Post-success confirmation

After Russell approves smoke test pass, post to SGA Slack:

> Heads-up — new Referrals object in Salesforce (RevOps use only). You'll see a Referrals related list on Account pages. No change to your daily workflow. Ping me if anything looks off.

---

## Command cheat sheet

| Purpose | Command |
|---|---|
| Dry-run | `cd sfdx && sf project deploy start --target-org savvy --source-dir force-app --dry-run --wait 60 --test-level RunLocalTests --verbose` |
| Real deploy | `cd sfdx && sf project deploy start --target-org savvy --source-dir force-app --wait 60 --test-level RunLocalTests --verbose` |
| Revert layouts | `cd sfdx && sf project deploy start --target-org savvy --source-dir rollback/force-app --wait 15 --test-level NoTestRun` |
| Destructive delete | `cd sfdx && sf project deploy start --target-org savvy --manifest rollback/package.xml --post-destructive-changes rollback/destructiveChanges.xml --wait 15 --test-level NoTestRun` |
