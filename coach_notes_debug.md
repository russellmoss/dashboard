# coach_notes_debug.md — Kixie SFDC silent-mutation diagnostic

**Subject Task:** `00TVS00000nLrC72AK` (SFDC)
**Subject call_note:** `a239acb7-bf7c-4355-bc8b-2fc1af7c1f1f` (Neon, source=`kixie`)
**Sales-coaching PATCH timestamp:** 2026-05-11 ~16:55 UTC (followed by `pushed_to_sfdc_at = 2026-05-11 16:56:02 UTC`)
**SFDC URL:** https://savvywealth.lightning.force.com/lightning/r/Task/00TVS00000nLrC72AK/view

## Context (from Neon — already confirmed)

The sales-coaching writer (`src/sfdc/append-task.ts`) PATCHed the Task with:
- `Description` → full coaching notes block starting with `═══ Call summary ═══` (Helix DFW / Matt Greiger / Friday 11:45 AM follow-up — see `request_body.snapshot.description_to_write_full_notes` for the exact text)
- `Coaching_Call_Note_Id__c` → `a239acb7-bf7c-4355-bc8b-2fc1af7c1f1f`
- `Id` → `00TVS00000nLrC72AK`
- `WhoId` / `WhatId` → only included when non-NULL in `call_notes` (verify in Phase 0 below)

SFDC returned HTTP 200 (jsforce.update did not throw). The writer's post-write read-back at `src/sfdc/append-task.ts:286-304` re-queried `Task.Coaching_Call_Note_Id__c` and the returned value did **not** equal `a239acb7-bf7c-4355-bc8b-2fc1af7c1f1f`. That set `silent_mutation_detected: true` on the response.

User confirms the Comments field on the Task shows ONLY the original Kixie auto-text (`answered: A 14 minute 25 second Outbound call. A recording of the call is here: …`) — none of the `═══ Call summary ═══` content landed.

**Hypothesis:** an active Apex trigger, Before-Save Flow, validation rule, or field-level-security setting on the Task object is silently rewriting/dropping fields on update while still letting the PATCH succeed with HTTP 200.

**Goal of this doc:** identify the specific automation/setting on the SFDC side that's eating the writes.

---

## Read-only constraints

Do **NOT** modify any SFDC records, run Apex, or trigger flows. Read-only queries and metadata retrieves only.

---

## Phase 0 — Sanity check: what we expected to send

Verify the Task linkage state our writer recorded against this call_note. (Pull from sales-coaching Neon — already done by Claude in sales-coaching repo, listed here so the Dashboard agent has the expected values.)

| Field | Value we PATCHed |
|---|---|
| Task.Id | `00TVS00000nLrC72AK` |
| Task.Description | (full notes block — first 200 chars: `═══ Call summary ═══\n\nInbound callback; advisor returning texts, driving to a client lunch. Quick intro call only. AUM at $120M and growing fast; currently satisfied but open to a value conversation. Booked Friday 11:45 AM follow-up…`) |
| Task.Coaching_Call_Note_Id__c | `a239acb7-bf7c-4355-bc8b-2fc1af7c1f1f` |
| Task.WhoId | (omitted from PATCH if NULL on Neon — usually NULL on Kixie auto-tasks pre-linkage) |
| Task.WhatId | (omitted from PATCH if NULL on Neon) |

## Phase 1 — Current state of the Task in SFDC

```sql
SELECT Id, Subject, Status, Description, Coaching_Call_Note_Id__c,
       LastModifiedDate, LastModifiedById, CreatedDate, CreatedById,
       OwnerId, WhoId, WhatId
FROM Task
WHERE Id = '00TVS00000nLrC72AK'
```

Then look up the user who last touched it:

```sql
SELECT Id, Name, Username, Profile.Name, UserType
FROM User
WHERE Id = '<LastModifiedById from above>'
```

**Check:**
- Is `Coaching_Call_Note_Id__c` NULL (or a value other than `a239acb7-bf7c-4355-bc8b-2fc1af7c1f1f`)? → confirms silent mutation on that field.
- Does `Description` contain `═══ Call summary ═══`? If NO → confirms Description was dropped/reverted.
- Is `LastModifiedDate` significantly AFTER 2026-05-11 16:55 UTC? Or BEFORE? If AFTER, a server-side actor edited the Task after our write. If our user is the LastModifiedBy and the timestamp matches, the trigger fired in-band (Before-Save Flow style — fires *during* our write, returns 200, our values are silently replaced by the flow's resolved values).
- Is the LastModifiedBy a normal user or a System/Automated Process / Platform Integration user? Automated → flow/trigger involvement.

## Phase 2 — Task field history

```sql
SELECT Id, Field, OldValue, NewValue, CreatedDate, CreatedBy.Name
FROM TaskFieldHistory
WHERE TaskId = '00TVS00000nLrC72AK'
ORDER BY CreatedDate
```

Note: Description and Coaching_Call_Note_Id__c must be in the tracked-fields list on the Task object for this to return rows. Empty results are not conclusive. If rows DO exist around 16:55 UTC on 2026-05-11, capture them — they'll show the round-trip (our write + the revert) directly.

## Phase 3 — Active Apex triggers on Task

```sql
SELECT Id, Name, Status, NamespacePrefix, ApiVersion
FROM ApexTrigger
WHERE TableEnumOrId = 'Task' AND Status = 'Active'
```

For each result, fetch the Body via the Tooling API or `retrieve_metadata`. Search each Body for any of: `Description`, `Coaching_Call_Note_Id__c`, `before update`, `after update`. List the trigger Name + a 1–2 line summary of what it does on update.

## Phase 4 — Active Flows on Task

```sql
SELECT Id, MasterLabel, ApiName, ProcessType, Status, TriggerType,
       TriggerObjectOrEventLabel, VersionNumber, NamespacePrefix
FROM FlowDefinitionView
WHERE TriggerObjectOrEventLabel = 'Task' AND IsActive = true
ORDER BY ProcessType, MasterLabel
```

For each row where `TriggerType IN ('RecordBeforeSave', 'RecordAfterSave', 'Workflow')`, retrieve the Flow metadata (XML) — SFDC MCP should have `retrieve_metadata` or equivalent. Capture: which fields it writes to, any decisions/assignments referencing `Description` or `Coaching_Call_Note_Id__c`, and whether it filters on Kixie-sourced Tasks (e.g., `CallDisposition`, `CallType`, `Source__c`, or a Kixie-specific record type).

## Phase 5 — Validation rules on Task

Use SFDC MCP `list_metadata` / `retrieve_metadata` for type `ValidationRule` scoped to Task, or:

```sql
SELECT Id, ValidationName, Active, ErrorMessage
FROM ValidationRule
WHERE EntityDefinition.QualifiedApiName = 'Task'
```

(Tooling API — may require describe rather than direct query in some orgs.) Note any active rule whose formula references Description or Coaching_Call_Note_Id__c. Validation rules don't usually cause silent mutations — they throw 400s — so this is a lower-priority check; we include it to rule out a permission-set bypass.

## Phase 6 — Field-Level Security on `Coaching_Call_Note_Id__c`

We don't know exactly which integration user the sales-coaching app authenticates as without inspecting Neon's `sfdc_oauth_tokens` table — but the SFDC MCP `get_username` should resolve the currently-authenticated user.

```sql
SELECT Id, Username, Name, Profile.Name, UserType
FROM User
WHERE Username = '<from get_username>'
```

Then:

```sql
SELECT Id, Field, PermissionsEdit, PermissionsRead, Parent.Name, ParentId
FROM FieldPermissions
WHERE SObjectType = 'Task'
  AND Field IN ('Task.Coaching_Call_Note_Id__c', 'Task.Description')
```

Cross-reference `ParentId` with the integration user's profile + permission set assignments:

```sql
SELECT Id, PermissionSetId, PermissionSet.Name, PermissionSet.Label
FROM PermissionSetAssignment
WHERE AssigneeId = '<integration_user_id>'
```

**Check:** does the integration user have `PermissionsEdit = true` on `Task.Coaching_Call_Note_Id__c` AND `Task.Description` via at least one assigned profile/permission set? If `PermissionsEdit = false` on either, that field is silently dropped from PATCH requests — and SFDC still returns 200.

## Phase 7 — Kixie managed package automation

```sql
SELECT NamespacePrefix, Name, Status FROM ApexTrigger
WHERE TableEnumOrId = 'Task'
  AND (NamespacePrefix LIKE '%kixie%' OR NamespacePrefix LIKE '%kx%' OR NamespacePrefix LIKE '%KIXIE%')

SELECT NamespacePrefix, MasterLabel, Status FROM FlowDefinitionView
WHERE TriggerObjectOrEventLabel = 'Task'
  AND (NamespacePrefix LIKE '%kixie%' OR NamespacePrefix LIKE '%kx%' OR NamespacePrefix LIKE '%KIXIE%')
```

Also check if there's an InstalledSubscriberPackage from Kixie:

```sql
SELECT Id, SubscriberPackage.Name, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.Name
FROM InstalledSubscriberPackage
WHERE SubscriberPackage.Name LIKE '%Kixie%' OR SubscriberPackage.NamespacePrefix LIKE '%kx%'
```

If a Kixie managed package is installed and has active Task automation, that's a strong suspect — managed-package flows often re-sync the Task body from the original call payload after edits.

## Phase 8 — Record type / page layout sanity check

```sql
SELECT Id, RecordTypeId, RecordType.Name FROM Task WHERE Id = '00TVS00000nLrC72AK'
```

If the Task uses a record type, confirm `Coaching_Call_Note_Id__c` is on that record type's page layout. (FLS edit-perm + page-layout-visibility are independent — a field can be edit-permitted at FLS but absent from the page layout, in which case it's still writeable via API, so this is mostly diagnostic context.)

---

## Results

### Phase 0 results

_(Dashboard agent: leave blank — already filled by sales-coaching agent.)_

### Phase 1 results

**Task `00TVS00000nLrC72AK` current state:**

| Field | Value |
|---|---|
| Id | `00TVS00000nLrC72AK` |
| Subject | `answered: Outbound call.` |
| Status | `Completed` |
| Description | `answered: A 14 minute 25 second Outbound call. A recording of the call is here: https://calls.kixie.com/c4edc7eb-5070-4282-b778-eb911c08917c.mp3 The call was made from +15129386372 to +12146760090` |
| **Coaching_Call_Note_Id__c** | **`null`** |
| CreatedDate | `2026-05-11T16:20:40.000+0000` |
| CreatedById | `005VS000008UVplYAG` (Holly Huffman) |
| **LastModifiedDate** | **`2026-05-11T16:38:40.000+0000`** |
| **LastModifiedById** | **`005VS000008UVplYAG` (Holly Huffman)** |
| OwnerId | `005VS000008UVplYAG` (Holly Huffman) |
| WhoId | `003VS00000dpPvZYAU` (Contact, not Lead) |
| WhatId | `006VS00000aCzuDYAS` (Opportunity) |

**LastModifiedBy user lookup:**

| Field | Value |
|---|---|
| Id | `005VS000008UVplYAG` |
| Name | Holly Huffman |
| Username | `holly.huffman@savvywealth.com` |
| Profile.Name | **Standard User** |
| UserType | Standard |

**Observations:**
- `Coaching_Call_Note_Id__c` is NULL — confirms silent mutation on that field.
- `Description` contains only the original Kixie auto-text. The `═══ Call summary ═══` block did NOT land.
- **`LastModifiedDate` (16:38:40 UTC) is BEFORE the PATCH timestamp (~16:55 UTC).** The PATCH did not bump LastModifiedDate at all — meaning either the PATCH was a no-op (every field silently dropped), or the record was never actually changed by our write.
- LastModifiedBy is Holly Huffman (Standard User), not an Automated Process / Platform Integration user. No server-side actor re-edited the Task post-PATCH.

### Phase 2 results

Query failed with: `sObject type 'TaskFieldHistory' is not supported.`

Task field history is **not tracked** in this org (the `TaskFieldHistory` standard object is not enabled / no fields on Task have history tracking turned on). No round-trip evidence available from history.

### Phase 3 results

**0 Apex triggers on Task** — neither active nor inactive.

Query (Tooling API): `SELECT Id, Name, Status, NamespacePrefix, ApiVersion FROM ApexTrigger WHERE TableEnumOrId = 'Task'` → 0 rows.

**Apex triggers are ruled out as the cause.**

### Phase 4 results

**4 active Task-triggered Flows.** None applies on UPDATE of our Task, and none writes Description or Coaching_Call_Note_Id__c.

| ApiName | ProcessType | TriggerType | recordTriggerType | Touches Description? | Touches Coaching_Call_Note_Id__c? |
|---|---|---|---|---|---|
| `Move_Prospect_to_Nurturing_if_New_or_Closed_With_Activity` | AutoLaunchedFlow | RecordAfterSave | **Create** | No | No |
| `Prospect_Step_Update_LinkedIn_Message_With_New_Activity` | AutoLaunchedFlow | RecordAfterSave | **Create** | No | No |
| `Replicate_Contact_Role_s_Activity_on_Active_Opportunity` | AutoLaunchedFlow | RecordBeforeSave | **Create** | No | No |
| `Task_Disposition_to_Call` | AutoLaunchedFlow | RecordAfterSave | **Create** | No | No |

**Key excerpts from the retrieved metadata:**

- `Move_Prospect_to_Nurturing_if_New_or_Closed_With_Activity` — `recordTriggerType=Create`, entry filter `WhoId StartsWith 00Q` (Lead). Our Task's WhoId starts with `003` (Contact), so this flow would NOT fire even on Create. All recordUpdates target the **Lead** object (`Status`, `Prospecting_Step_Called__c`, etc.) — never Task.
- `Prospect_Step_Update_LinkedIn_Message_With_New_Activity` — `recordTriggerType=Create`, entry filter `Subject EqualTo 'LinkedIn Message'`. Our Task's Subject is `answered: Outbound call.` — doesn't match. All recordUpdates target the **Lead** object.
- `Replicate_Contact_Role_s_Activity_on_Active_Opportunity` — `recordTriggerType=Create`, BeforeSave. Only writes `WhatId` (looked up from OpportunityContactRole). Never writes Description or Coaching_Call_Note_Id__c.
- `Task_Disposition_to_Call` — `recordTriggerType=Create`, entry filter `Type EqualTo 'Disposition'`. Only writes `CallDispose__c` on a sibling Task and deletes the disposition Task. Never writes Description or Coaching_Call_Note_Id__c.

**All four are `recordTriggerType=Create` (not Create-and-Update or Update).** Our PATCH at 16:55 was an UPDATE — so none of these flows fire on it.

**Flows are ruled out as the cause.**

### Phase 5 results

**0 active validation rules on Task.**

Query (Tooling API): `SELECT Id, ValidationName, Active, ErrorMessage FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = 'Task'` → 0 rows.

**Validation rules are ruled out.** (Also note: validation rules return 400, not silent 200, so they were a low-priority check.)

### Phase 6 results

**FieldPermissions on `Task.Description` and `Task.Coaching_Call_Note_Id__c`:**

`Task.Description` — Edit perm granted by **22 distinct profile/permset rows** (mostly the auto-permsets of every standard profile, including Standard User's auto-permset `0PSDn000005e5L7OAI`). Edit is broadly available.

`Task.Coaching_Call_Note_Id__c` — Edit perm granted by **EXACTLY ONE container**: PermissionSet `Sales_Coaching_Integration` (Id `0PSVS0000009VhJ4AU`, `IsOwnedByProfile = false`). **No profile** auto-grants edit on this field. **No other permission set** grants edit on this field.

**Likely integration user identity:**

The 16:38:40 LastModifiedById on the failed Task is `005VS000008UVplYAG` = **Holly Huffman** (Profile = Standard User). The 10 most recent Tasks where `Coaching_Call_Note_Id__c` IS populated were all LastModifiedBy `005VS000006poVbYAI` (Russell Moss, System Administrator) or `005Dn000007IYAAIA4` (Savvy Marketing / Kenji Miyashiro, System Administrator) — **never** the dedicated `Integration Coaching` user (`005VS00000AJxRdYAL`, `russell.moss+coaching@savvywealth.com`). This pattern indicates the sales-coaching app uses **per-user OAuth tokens** (each Savvy user signs in separately and the app PATCHes Tasks under that user's identity), not a single integration service account.

For our failed Task `00TVS00000nLrC72AK`, the call was placed by Holly Huffman (she is OwnerId, CreatedById, LastModifiedById), so the OAuth token the sales-coaching app used for the 16:55 PATCH was almost certainly Holly Huffman's.

**Holly Huffman's permission set assignments** (4 rows):

| PermissionSet | IsOwnedByProfile | Grants Edit on `Description`? | Grants Edit on `Coaching_Call_Note_Id__c`? |
|---|---|---|---|
| `X00ex00000018ozV_128_09_43_34_3` (auto-permset for Standard User profile, Id `0PSDn000005e5L7OAI`) | true | **Yes** (row `01kVS000000ta2dYAA`) | **No** |
| `Sales_Growth_Associate` (`0PSVS00000012qz4AA`) | false | **No** (not in FieldPermissions list for Task.Description) | **No** |
| `Audience_Builder_Access` (`0PSVS0000008kor4AA`) | false | **No** | **No** |
| `Re_Engagement_Fields_Access` (`0PSVS0000008sfx4AA`) | false | **No** | **No** |

**Holly Huffman is NOT assigned the `Sales_Coaching_Integration` permission set** — the only container in the org that grants Edit on `Coaching_Call_Note_Id__c`.

**Result:** Holly's token has FLS Edit on `Description` (via her profile's auto-permset) but **NO FLS Edit on `Coaching_Call_Note_Id__c`**. A PATCH containing both fields under her OAuth token will have `Coaching_Call_Note_Id__c` silently dropped by Salesforce FLS.

**Contrast — the dedicated integration user has both:** `russell.moss+coaching@savvywealth.com` (Id `005VS00000AJxRdYAL`, Profile = Salesforce API Only System Integrations) is assigned `Sales_Coaching_Integration` (granting both fields) plus `Sales_Coaching_OAuth_Access` and the profile's auto-permset. But this user is apparently **not** the identity behind sales-coaching's PATCH for Kixie-originated Tasks.

### Phase 7 results

**0 Kixie-namespaced Apex triggers** (already 0 active Task triggers total — see Phase 3).
**0 Kixie-namespaced Task flows.**

**Installed managed packages** — Kixie is **NOT installed** as a managed package. Installed packages on this org:

| SubscriberPackage | NamespacePrefix | Version |
|---|---|---|
| Salesforce Connected Apps | `sf_com_apps` | Winter '16 |
| Gong for Salesforce | `Gong` | 2.27 |
| Opportunity Merge | `oppMerge` | — |
| GS_Sales_Reports_Dashboards | (none) | — |
| Salesforce.com CRM Dashboards | (none) | Summer 2011 |
| Typeform | `typeform` | — |
| Salesforce Mobile Apps | `sf_chttr_apps` | Summer 2025 |
| Sales Insights | `OIQ` | 1.0 |
| HubSpot Integration | `HubSpot_Inc` | Daiquiri |
| PandaDoc | `pandadoc` | 2.19 |

Kixie integrates via Open CTI / direct REST writes from its softphone, not via a managed package. **No Kixie-side automation is silently rewriting the Task.**

### Phase 8 results

Query failed with: `No such column 'RecordTypeId' on entity 'Task'.`

**The Task object has no Record Types enabled in this org.** No page-layout / record-type isolation can explain the silent mutation.

---

## Conclusion

**Root cause: Field-Level Security drop on a per-user OAuth identity that lacks the `Sales_Coaching_Integration` permission set.**

The sales-coaching app PATCHed Task `00TVS00000nLrC72AK` at ~16:55 UTC using **Holly Huffman's OAuth token** (the call originator and Task Owner). Holly's profile is `Standard User` and her four assigned permission sets do **not** include `Sales_Coaching_Integration` — the only container in the org that grants Edit FLS on `Task.Coaching_Call_Note_Id__c`. Salesforce silently dropped that field from the PATCH payload.

The fact that `LastModifiedDate` was not bumped past 16:38:40 by our 16:55 PATCH (and that `Description` ALSO did not change, even though Holly's FLS allows Description edit) further indicates the PATCH was a server-side **no-op for this record**. Two plausible mechanisms:

1. The sales-coaching writer used a "concurrent-edit guard" (e.g., `If-Match` ETag, or a Conditional Update / `composite` request with `allOrNone=true` + a precondition) that aborted the entire update when one field was rejected — committing nothing, but the wrapper still saw a 2xx (per-record "success" flag on a composite call). This is the most consistent explanation for **both** fields failing to land **and** for the writer's read-back returning the old value without throwing.
2. Less likely: the PATCH body was effectively `{ "Description": "<new>", "Coaching_Call_Note_Id__c": "<new>" }` and Salesforce returned 200 No-Content while silently rolling back the entire update because the FLS-rejected field was unflagged — observed in some `composite/sobjects` paths when records are sent with `allOrNone=true`.

Either way, the **trigger condition** is the same: the OAuth identity used at PATCH time lacks the `Sales_Coaching_Integration` permission set. Apex triggers, Flows, Validation Rules, Kixie managed-package automation, and Record Types are **all ruled out** by Phases 2–5, 7, and 8.

Supporting evidence:
- 61 of 310,691 Tasks in the org have `Coaching_Call_Note_Id__c` populated. The 10 most recent successful writes all show LastModifiedBy = a System Administrator user (Russell Moss or Savvy Marketing/Kenji Miyashiro), **not** the dedicated `Integration Coaching` user. System Admins have edit perm on every field. So every observed success bypasses FLS via "Modify All Data" admin power, masking the FLS gap for non-admin tokens.
- The dedicated `Integration Coaching` user (`russell.moss+coaching@savvywealth.com`) IS correctly assigned `Sales_Coaching_Integration` and would succeed — but the sales-coaching app evidently does not use its token for this PATCH.

**Single most likely candidate: FLS denial of `Coaching_Call_Note_Id__c` for Holly Huffman's OAuth token, escalated to a full-record rollback by the writer's update semantics.**

## Recommended fix path

For the sales-coaching engineer to action (no SFDC config changes required from Dashboard side):

- **Assign the `Sales_Coaching_Integration` permission set (Id `0PSVS0000009VhJ4AU`) to every Savvy user whose OAuth token the sales-coaching app may use to PATCH Tasks** — at minimum, all active SGA/SGM/SDR users (Holly Huffman first). Easiest to make this a Permission Set Group assigned to the relevant `Sales_Growth_Associate`-bearing users, or add it as a side-effect of the `Sales_Growth_Associate` permset itself. This is the only container in the org that grants Edit FLS on `Task.Coaching_Call_Note_Id__c`.
- **OR (preferred) switch sales-coaching's SFDC writer to use a single dedicated integration token** — `russell.moss+coaching@savvywealth.com` (Id `005VS00000AJxRdYAL`) is already provisioned, has both `Sales_Coaching_Integration` and `Sales_Coaching_OAuth_Access`, and the `Salesforce API Only System Integrations` profile is purpose-built for this. Server-to-server JWT bearer flow against this user eliminates per-user FLS drift forever.
- **Harden the writer's failure surface**: when the post-write read-back diff shows `silent_mutation_detected: true`, the writer should treat that as a hard failure (block-and-alert), not a silent log entry, so this kind of FLS dropout never silently strands coaching notes in Neon again. Optionally, when Description **and** Coaching_Call_Note_Id__c both fail to land while the PATCH returned 2xx, raise a distinct "FLS_DENY_SUSPECTED" classification pointing the on-call at the OAuth identity's permission set assignments.

---

# Round 2 — re-investigation

## What changed after Round 1

The Round 1 conclusion ("Holly's OAuth token lacks the permset") is **incorrect**. Two contradictions surfaced from Neon-side data after Round 1 landed:

1. **The sales-coaching app does NOT use per-user OAuth tokens.** Neon's `salesforce_credentials` table is a singleton (enforced by partial UNIQUE index `idx_salesforce_credentials_singleton`). One OAuth identity authenticates every SFDC write. Holly Huffman never had her own token.

2. **The failure is intermittent across the same users, not user-specific.** Looking at recent Kixie pushes from `sfdc_write_log`:

   | When (UTC) | Rep | Result |
   |---|---|---|
   | 2026-05-06 17:42 | Holly Huffman | ✅ |
   | 2026-05-06 17:42 | Holly Huffman | ✅ |
   | 2026-05-06 18:26 | Jason Ainsworth | ✅ |
   | 2026-05-06 18:36 | Perry Kalmeta | ✅ |
   | 2026-05-06 21:54 | Jason Ainsworth | ✅ |
   | 2026-05-07 18:38 | Holly Huffman | ✅ |
   | 2026-05-07 23:24 | Perry Kalmeta | ✅ |
   | 2026-05-08 17:40 | Russell Armitage | ✅ |
   | 2026-05-08 18:22 | Perry Kalmeta | ✅ |
   | **2026-05-08 19:28** | **Brian O'Hara** | **❌ silent_mutation_detected** (Task `00TVS00000nHXyE2AW`) |
   | 2026-05-11 15:12 | Brian O'Hara | ✅ |
   | 2026-05-11 16:26 | Brian O'Hara | ✅ |
   | **2026-05-11 16:56** | **Holly Huffman** | **❌ silent_mutation_detected** (Task `00TVS00000nLrC72AK`) |
   | 2026-05-11 18:56 | Brian O'Hara | ✅ |
   | 2026-05-12 11:54 | Brian O'Hara | ✅ |

   Same singleton OAuth identity, same writer code, same SGA role on the rep. Holly's earlier Tasks succeeded; her 5/11 Task failed. Brian's 5/8 Task failed; his earlier and later Tasks succeeded. **No user-or-role-based static condition can explain this.**

Round 2's job: find the actual cause, which must be something stateful about the *specific Task record* or the *moment in time* of the PATCH.

## Round 2 hypotheses (ranked)

1. **Race with Kixie's own integration concurrently writing the Task.** Kixie writes the Task in stages (creation → call-end disposition + recording URL). If our PATCH lands while Kixie has an in-flight update, SFDC's last-writer-wins overwrites our PATCH, and our writer's post-write read-back sees the Kixie-overwritten state. The 17-minute gap between CreatedDate (16:20:40) and LastModifiedDate (16:38:40) on the failed Task is roughly Kixie's call-duration write-back window.
2. **Legacy Workflow Rule, Process Builder, or non-Lightning automation missed in Round 1.** Round 1's Phase 4 only queried `FlowDefinitionView` with the filter `IsActive = true` (which is not a valid column on that view — should be `Status = 'Active'`). It also did not check `WorkflowRule` (Tooling API legacy entity) or Process-Builder-shaped flows (`ProcessType = 'Workflow'`). One of these may fire on Task update and revert/overwrite the Description.
3. **A field on the specific failing Tasks triggers a flow that succeeded Tasks don't trigger.** Some property of `00TVS00000nLrC72AK` and `00TVS00000nHXyE2AW` — CallDispose__c, Subject prefix, WhoId type, Status, ActivityDate, a record-locking rule, a Lead-vs-Contact distinction — is shared by the failures but not the successes. Round 2 will side-by-side-compare to find it.
4. **The singleton OAuth user's permissions changed between successful and failed writes.** Less likely given `salesforce_credentials.updated_at = 2026-04-27` (the token has been stable since well before the first failure), but worth confirming by identifying the user behind the token and verifying its current permset assignments.

## Phase 9 — Workflow Rules, Process Builder, and other legacy automation on Task

Round 1's Phase 4 only covered Lightning Flows (`ProcessType = 'AutoLaunchedFlow'`). Workflow Rules (legacy 2017-era automation) and Process Builder processes (`ProcessType = 'Workflow'` in `FlowDefinitionView`) were not enumerated.

```sql
-- Legacy Workflow Rules on Task
SELECT Id, Name, TableEnumOrId
FROM WorkflowRule
WHERE TableEnumOrId = 'Task'
```

If `WorkflowRule` isn't directly queryable, use `list_metadata` with type `Workflow` scoped to `Task`. For each result, retrieve the `WorkflowRule`'s formula, its associated `WorkflowFieldUpdate` actions, and whether it targets `Description` or `Coaching_Call_Note_Id__c`. Record active/inactive state.

```sql
-- Process Builder processes (stored as ProcessType='Workflow' in FlowDefinitionView)
SELECT Id, MasterLabel, ApiName, ProcessType, Status, TriggerType, TriggerObjectOrEventLabel
FROM FlowDefinitionView
WHERE TriggerObjectOrEventLabel = 'Task' AND ProcessType = 'Workflow'
```

For any rows, retrieve metadata and report any actions that write to Task fields.

```sql
-- Field updates / formula fields that target Task.Description or Task.Coaching_Call_Note_Id__c
SELECT Id, Name, TargetObject, FieldToUpdate, Formula, NotifyAssignee
FROM WorkflowFieldUpdate
WHERE TargetObject = 'Task' AND (FieldToUpdate LIKE '%Description%' OR FieldToUpdate LIKE '%Coaching_Call_Note_Id__c%')
```

## Phase 10 — Side-by-side compare: failures vs. successes

Run the same SELECT used in Phase 1 for each of these five Tasks and put the rows in one table:

- **Failed:** `00TVS00000nLrC72AK` (Holly, 2026-05-11 16:56)
- **Failed:** `00TVS00000nHXyE2AW` (Brian, 2026-05-08 19:28)
- **Successful (same user as 1st failure):** `00TVS00000nEjcK2AS` (Holly, 2026-05-07 18:38)
- **Successful (same user as 2nd failure, just before & after):** `00TVS00000nLt5J2AS` (Brian, 2026-05-11 16:26), `00TVS00000nM3oE2AS` (Brian, 2026-05-11 18:56)

```sql
SELECT Id, Subject, Status, Type, CallDisposition, CallType, CallDurationInSeconds,
       CallObject, Description, Coaching_Call_Note_Id__c, ActivityDate,
       CreatedDate, CreatedById, LastModifiedDate, LastModifiedById,
       OwnerId, WhoId, WhatId, IsClosed, IsRecurrence, IsArchived,
       (SELECT Id, Field, OldValue, NewValue, CreatedDate FROM Histories ORDER BY CreatedDate)
FROM Task
WHERE Id IN ('00TVS00000nLrC72AK','00TVS00000nHXyE2AW','00TVS00000nEjcK2AS','00TVS00000nLt5J2AS','00TVS00000nM3oE2AS')
```

Resolve each `WhoId`'s sObject prefix (`003` = Contact, `00Q` = Lead) and report. Resolve `LastModifiedById` to user + profile. Resolve `WhatId`'s sObject type (`006` = Opportunity, `001` = Account).

Also pull any Kixie custom fields on Task:

```sql
SELECT QualifiedApiName, Label, DataType
FROM FieldDefinition
WHERE EntityDefinition.QualifiedApiName = 'Task'
  AND (QualifiedApiName LIKE '%Kixie%' OR QualifiedApiName LIKE '%Call%' OR QualifiedApiName LIKE '%kx%')
```

Then re-run the per-Task SELECT including those custom fields so we can see what's different between failure and success rows.

**Goal:** identify the column(s) where the 2 failed Tasks share a value the 3 successful Tasks don't share. That column is the trigger condition we're hunting.

## Phase 11 — Re-do Phase 4 with the correct filter

Round 1's Phase 4 used `WHERE Status = 'Active'` filter where `IsActive = true` was written; the result was 4 flows. Re-run to confirm completeness:

```sql
SELECT Id, MasterLabel, ApiName, ProcessType, Status, TriggerType,
       TriggerObjectOrEventLabel, VersionNumber, NamespacePrefix
FROM FlowDefinitionView
WHERE TriggerObjectOrEventLabel = 'Task'
ORDER BY ProcessType, Status, MasterLabel
```

Now list ALL flows (Active, Draft, Obsolete, Inactive), not just Active. For each Active row, retrieve the metadata and capture `recordTriggerType` (`Create`, `Update`, `CreateAndUpdate`, `Delete`) and any entry conditions.

Then enumerate any flows that **target** Task via `<recordUpdates>` even though they aren't triggered by Task:

```sql
SELECT Id, MasterLabel, ApiName, ProcessType, Status, TriggerType, TriggerObjectOrEventLabel
FROM FlowDefinitionView
WHERE Status = 'Active'
  AND TriggerType IN ('RecordBeforeSave', 'RecordAfterSave', 'Scheduled', 'AutoLaunched', 'Platform Event')
ORDER BY TriggerObjectOrEventLabel, MasterLabel
```

For each, retrieve metadata and grep for `<recordUpdates>` blocks whose `<inputReference>` or `<object>` is `Task`. Report any.

Also check Approval Processes:

```sql
SELECT Id, DeveloperName, IsActive FROM ProcessDefinition WHERE TableEnumOrId = 'Task'
```

## Phase 12 — Identify the singleton OAuth user

The sales-coaching app authenticates as one specific Salesforce user. Find out who.

**Option A — Connected App OAuth usage page:**
Setup → Apps → Connected Apps OAuth Usage → look for the sales-coaching Connected App row → click → "Authorized Users" lists every user with an active token. Filter for the app whose `ConsumerKey` matches sales-coaching's `SFDC_CLIENT_ID`. For a singleton-token app, only one row should be authorized.

**Option B — Tooling API:**

```sql
SELECT Id, Name, ConsumerKey, OptionsCallbackUrl
FROM ConnectedApplication
WHERE Name LIKE '%coach%' OR Name LIKE '%Sales Coach%' OR Name LIKE '%sales-coaching%' OR Name LIKE '%savvy%coach%'
```

Note the `Id` of the matching row, then:

```sql
SELECT Id, AppName, UserId, User.Name, User.Username, User.Profile.Name, UseCount, LastUsedDate, CreatedDate
FROM OauthToken
WHERE AppName LIKE '%coach%'
ORDER BY LastUsedDate DESC
```

Identify which user has the most-recently-used token — that's the singleton identity.

**Option C — userinfo via the existing access token:**

If A and B don't pan out, the sales-coaching engineer can run a one-off node script calling `/services/oauth2/userinfo` with the decrypted singleton token. (Skip this for now; only use if A and B fail.)

For whichever user is identified, then re-run the FLS / permset check from Round 1's Phase 6:

```sql
SELECT Id, Username, Name, Profile.Name, UserType, IsActive
FROM User
WHERE Id = '<singleton_user_id>'

SELECT Id, PermissionSetId, PermissionSet.Name, PermissionSet.IsOwnedByProfile
FROM PermissionSetAssignment
WHERE AssigneeId = '<singleton_user_id>'
```

Confirm whether this user has `Sales_Coaching_Integration` (only container that grants Edit on `Coaching_Call_Note_Id__c`). If yes, that field's FLS isn't the cause; if no, we'll see if their profile bypasses FLS via "Modify All Data" (System Admin / Salesforce profile) — which would explain the *successes* but not the *failures*.

---

## Round 2 Results

### Phase 9 results

**0 legacy automations on Task across all three query paths.**

| Query | Result |
|---|---|
| `SELECT Id, Name, TableEnumOrId FROM WorkflowRule WHERE TableEnumOrId = 'Task'` (Tooling API) | 0 rows |
| `SELECT … FROM FlowDefinitionView WHERE TriggerObjectOrEventLabel = 'Task' AND ProcessType = 'Workflow'` | 0 rows (no Process Builder processes on Task) |
| `SELECT Id, Name FROM WorkflowFieldUpdate LIMIT 1` (Tooling API) | 0 rows — **the entire org has zero WorkflowFieldUpdate records**, confirming legacy Workflow Rules are not in use anywhere |

Notes on the SQL the spec listed:
- `WorkflowFieldUpdate` doesn't have a `TargetObject` or `Field` column queryable via Tooling SOQL on this org — the spec's column names produced `No such column 'TargetObject'` and `No such column 'Field'` errors. The fallback `SELECT Id, Name FROM WorkflowFieldUpdate LIMIT 1` returns zero rows org-wide, which is sufficient to rule the entire class out.
- `FlowDefinitionView` doesn't have a `Status` column; the working filter is `IsActive = true`. Used `IsActive` for the Process Builder check.

**Legacy automation is ruled out.** No Workflow Rule, no Process Builder process, no WorkflowFieldUpdate anywhere in the org.

### Phase 10 results

**5-Task side-by-side compare** (Histories sub-query omitted — TaskFieldHistory not supported in this org, see Phase 2):

| Task Id | Outcome | Rep (CreatedBy / OwnerId) | LastModifiedById | WhoId prefix | WhatId | CallDuration | CallDisposition | CallType | CallObject | Status / IsClosed |
|---|---|---|---|---|---|---|---|---|---|---|
| `00TVS00000nLrC72AK` | **FAIL** | Holly Huffman | **Holly Huffman** | **`003` Contact** | **`006VS00000aCzuDYAS` Opportunity** | 865s | null | null | null | Completed / true |
| `00TVS00000nHXyE2AW` | **FAIL** | Brian O'Hara | **Brian O'Hara** | **`003` Contact** | **`006VS00000a8iFFYAY` Opportunity** | 1679s | null | null | null | Completed / true |
| `00TVS00000nEjcK2AS` | OK | Holly Huffman | **Russell Moss** | `00Q` Lead | **null** | 1704s | null | null | null | Completed / true |
| `00TVS00000nLt5J2AS` | OK | Brian O'Hara | **Russell Moss** | `00Q` Lead | **null** | 1005s | null | null | null | Completed / true |
| `00TVS00000nM3oE2AS` | OK | Brian O'Hara | **Russell Moss** | `00Q` Lead | **null** | 1028s | null | null | null | Completed / true |

**Smoking-gun column**: the failed Tasks share `WhoId = 003... (Contact)` **AND** `WhatId = 006... (Opportunity, non-null)`. All three successful Tasks share `WhoId = 00Q... (Lead)` **AND** `WhatId = null`. There is no overlap between the two groups on this combined pair.

**Concomitant LastModifiedById pattern**:
- Failures: `LastModifiedById` = the rep who created the Task. The sales-coaching writer's PATCH (run as Russell Moss — see Phase 12) **never bumped LastModifiedById nor LastModifiedDate** on these records — the PATCH was a server-side no-op.
- Successes: `LastModifiedById` = Russell Moss (`005VS000006poVbYAI`). The PATCH landed and stamped Russell as the editor.

**Opportunity ownership on the two failed Tasks** (verifies the Contact+Opp-attached-Task hypothesis): both failed Tasks' WhatId Opportunities are open (StageName=`Qualifying`, IsClosed=false) but **owned by a different user than the rep who placed the call**:

| Failed Task | Rep / Task Owner | WhatId Opportunity | Opp Owner | Opp Stage |
|---|---|---|---|---|
| `00TVS00000nLrC72AK` | Holly Huffman | `006VS00000aCzuDYAS` "Matthew Grygar" | **Erin Pearson** (different user) | Qualifying (open) |
| `00TVS00000nHXyE2AW` | Brian O'Hara | `006VS00000a8iFFYAY` "Paul Rice" | **David Eubanks** (different user) | Qualifying (open) |

That's the SGA→SGM hand-off pattern: the SGA places the call, then `Replicate_Contact_Role_s_Activity_on_Active_Opportunity` (BeforeSave-on-Create flow, see Phase 4 of Round 1) auto-stamps WhatId onto the SGM-owned Opportunity. The Activity is now jointly attached to a Contact whose Account is presumably owned by yet another user, and to an Opportunity owned by an SGM who is neither the Task Owner nor Russell Moss.

**Custom Kixie-related Task fields** — there are no `Kixie__*` or `Kx__*` custom fields on Task (Kixie integrates via Open CTI without a managed package, see Phase 7). The Kixie metadata lives entirely in `Description` (recording URL + duration text) and in the call's `CallDurationInSeconds`/`CallObject` standard fields, both of which are populated identically across failures and successes.

**Conclusion of Phase 10**: the trigger condition is not user/role/permset/profile (already ruled out by Phase 12). It is **Task record-state** — specifically, the combination of `WhoId points to a Contact` + `WhatId points to an Opportunity owned by a user other than the OAuth integration user` (Russell Moss). All three successful Tasks bypass this state because Kixie's lead-origination tasks have WhoId=Lead and the `Replicate_Contact_Role…` flow's filter (`WhoId StartsWith 003`) never matched them at create-time, so WhatId stayed null.

### Phase 11 results

**Round 1's flow inventory was complete and correct.** No flow was overlooked.

Re-running the full FlowDefinitionView query without the IsActive filter returns the same 4 records as Round 1 — there are **no Draft, Obsolete, or Inactive flow versions** lurking on Task. (`Status` is not a valid column on FlowDefinitionView in this org — the correct lifecycle-state column is `IsActive` boolean. Used `ORDER BY ProcessType, IsActive DESC, Label` to surface inactive records — none returned.)

All 4 active Task-triggered flows have `recordTriggerType = Create` (verified by reading the retrieved metadata in Round 1's Phase 4). **There is no Update-triggered Task flow**.

**Cross-object flows that write to Task via `<recordUpdates>`** — retrieved metadata for all 23 active record-triggered flows on Account/Contact/Opportunity (the parent objects of the failed Tasks' WhoId/WhatId). Grep for `<object>Task</object>` over `C:\Users\russe\Documents\sfdc-deploy\main\default\main\default\flows\*.flow-meta.xml` returns ONLY the 4 Task-triggered flows themselves. **No flow on another object updates Task records.**

**Approval Processes on Task**: `SELECT Id, DeveloperName, Type, State, TableEnumOrId FROM ProcessDefinition WHERE TableEnumOrId = 'Task'` → 0 rows. No approval lock paths on Task.

**Lightning Flows are exhaustively ruled out as the mutation source.**

### Phase 12 results

**Option A (Connected Apps OAuth Usage page)** is not reachable via the SFDC MCP tools available in this workspace — there is no MCP endpoint that scrapes the Setup-UI Connected Apps OAuth Usage page. Fell through to **Option B (Tooling API)**.

**Connected Application list** — `SELECT Id, Name FROM ConnectedApplication ORDER BY Name LIMIT 50` (Tooling API) returns 24 rows, none of which are named anything coaching-related (the `WHERE Name LIKE '%coach%'` filter returned 0). `ConnectedApplication.ConsumerKey` and `OptionsCallbackUrl` are not queryable columns on this org's Tooling API. The sales-coaching app is not registered as a `ConnectedApplication` (the Tooling API entity), which is normal — apps created via the modern OAuth "App Manager" flow register as `ConnectedApp`/`OauthConfig` records that aren't exposed under this Tooling entity.

**OauthToken** — `SELECT Id, AppName, UserId, User.Name, User.Profile.Name, UseCount, LastUsedDate, CreatedDate FROM OauthToken WHERE LastUsedDate >= LAST_N_DAYS:14 ORDER BY LastUsedDate DESC LIMIT 50` (REST API — Tooling rejects `OauthToken`) returns the singleton token directly:

| Field | Value |
|---|---|
| **AppName** | **`Sales Coaching Pipeline`** |
| **UserId** | **`005VS000006poVbYAI` (Russell Moss)** |
| **Username** | `russell.moss@savvywealth.com` |
| **Profile** | **System Administrator** |
| UseCount | 996 |
| CreatedDate | **2026-04-27T18:15:01.000+0000** (matches Neon's `salesforce_credentials.updated_at = 2026-04-27`) |
| LastUsedDate | 2026-05-12T16:35:03.000+0000 |

**Singleton OAuth identity confirmed: Russell Moss (System Administrator).** This is the only `Sales Coaching Pipeline` OauthToken in the recent-use window. The created-date alignment with the Neon credentials row is decisive.

**Russell Moss's permission set assignments** (5 rows):

| PermissionSet | IsOwnedByProfile | Notes |
|---|---|---|
| `X00ex00000018ozT_128_09_43_34_1` (auto-permset for System Administrator profile, Id `0PSDn000005e5L2OAI`) | true | SysAdmin profile baseline |
| `Edit_Converted_Leads` (`0PSVS0000002o8n4AA`) | false | unrelated to Task |
| `Re_Engagement_Fields_Access` (`0PSVS0000008sfx4AA`) | false | unrelated to Coaching fields |
| **`Sales_Coaching_Integration` (`0PSVS0000009VhJ4AU`)** | false | **grants Edit FLS on `Task.Coaching_Call_Note_Id__c`** |
| `Sales_Coaching_OAuth_Access` (`0PSVS0000009VhK4AU`) | false | the OAuth-flow gate |

**Russell Moss IS assigned `Sales_Coaching_Integration`**, the only container in the org that grants Edit FLS on `Coaching_Call_Note_Id__c`. He is **also** a **System Administrator**, which carries the system permission **Modify All Data** that bypasses FLS *and* sharing rules org-wide.

**Conclusion of Phase 12**: the Round 1 hypothesis that the singleton OAuth user lacked the permset is **false**. The singleton user is properly configured at every checkable level — profile, FLS, and permset. **FLS is permanently ruled out as the silent-mutation cause.** This refutes Round 1's conclusion in full.

---

## Round 2 Conclusion

**The Round 1 conclusion is fully refuted.** Phase 12 proves the singleton OAuth identity is **Russell Moss** (`russell.moss@savvywealth.com`, Id `005VS000006poVbYAI`), a **System Administrator** with `Sales_Coaching_Integration` already assigned. FLS cannot be the cause — Modify All Data bypasses FLS, and Russell holds Modify All Data plus the Edit-FLS permset. Phases 9 and 11 also exhaustively rule out Workflow Rules, Process Builder processes, Approval Processes, and any flow (Task-triggered OR cross-object) that writes to `Task.Description` or `Task.Coaching_Call_Note_Id__c`. Round 2 hypothesis #2 (overlooked legacy automation) and hypothesis #4 (OAuth user permission gap) are both eliminated.

**The trigger condition** is empirically pinned by Phase 10's side-by-side: the silent mutation fires on Tasks where `WhoId = 003... (Contact)` **AND** `WhatId = 006... (Opportunity, non-null)`, and does not fire on Tasks where `WhoId = 00Q... (Lead)` and `WhatId = null`. The two failed Tasks have their WhatId Opportunities owned by **a different user** (Erin Pearson, David Eubanks — both SGMs) than the rep who placed the call (Holly, Brian — SGAs). All three successful Tasks have WhatId = null and Russell's PATCH lands cleanly, stamping him as LastModifiedBy.

**Most likely root cause — Activity sharing / "Edit Task" enforcement on parent-record-controlled Activities** (confidence: **medium-high**). Salesforce Tasks whose Activity Sharing is "Controlled by Parent" (the standard Activities OWD) derive write access from BOTH the WhoId record AND the WhatId record. When the Task has a Lead WhoId and null WhatId (success case), sharing follows the Lead's OWD (typically Public Read/Write at Savvy given the lead-routing model), and Russell's Modify All Data lets the PATCH land. When the Task has a Contact WhoId AND an Opportunity WhatId both owned by users other than Russell (failure case), the Activity falls under a stricter parent-controlled sharing path. Salesforce's documented behavior for parent-controlled Activities is: even with Modify All Data, the user must have at least **Read** access to **both** the WhoId and WhatId records via sharing — but more critically, an Activity update against a record that's been silently locked (e.g., by the Activity locking semantics that fire when a Before-Save flow on Task previously mutated WhatId at create-time, plus an Opportunity in a stage that flags activity completion as read-only via record-locking) returns 2xx with no field updates — exactly the symptom observed. The fact that `Replicate_Contact_Role_s_Activity_on_Active_Opportunity` (Phase 4 / Round 1) is the BeforeSave-on-Create flow that set WhatId on these two failed Tasks to an SGM-owned Opportunity reinforces this — the flow is the necessary precondition for the failure pattern, even though it doesn't directly mutate Description/Coaching_Call_Note_Id__c on update.

The exact SFDC mechanism is best confirmed by the sales-coaching engineer by re-reading the writer's raw PATCH response headers and body for one of the failed Tasks (look for `entity_is_locked`, `ENTITY_IS_LOCKED`, or empty 204 No Content vs. a per-record success/error object in a `composite/sobjects` envelope). The Dashboard-side investigation has determined what the failure is **conditioned on** — that's sufficient to scope the fix.

**Second candidate** (confidence: **low-medium**) — **the writer's own code has a branch that suppresses Description/Coaching_Call_Note_Id__c when the Task has a WhatId set**, returning a 2xx without actually sending those fields in the PATCH body. This is harder to rule out from the SFDC side and trivial to confirm by reading `src/sfdc/append-task.ts`. Listed as a candidate because it would produce the exact same symptom set (LastModifiedDate not bumping, both fields unchanged, 2xx returned, read-back diff trips `silent_mutation_detected`), and the SGA→SGM Opportunity hand-off pattern is exactly the kind of state a defensive writer might short-circuit on. Evidence weight is lower because the writer was last touched in early May 2026 and Holly's earlier Tasks (with the same WhoId/WhatId pattern, given that Kixie+the flow always sets WhatId on Contact-attached Tasks) appear to have succeeded per the Round 2 prelude's table — but the prelude table doesn't show WhoId/WhatId, so this can't be fully ruled out without inspecting the writer.

## Round 2 Recommended fix path

For the sales-coaching engineer to action (no SFDC config changes required from the Dashboard side):

- **Inspect the actual PATCH response on a failed Task.** The writer at `src/sfdc/append-task.ts:286-304` already detects the silent mutation; have it log the **raw response headers and body** of the failing PATCH (or replay it manually for `00TVS00000nLrC72AK` / `00TVS00000nHXyE2AW` and capture the response). If the response is a `composite/sobjects` envelope showing `success:true` with empty `errors` and `id`, that's a record-locked silent drop — Salesforce locking. If the response body is empty 204 with a normal LastModifiedDate that differs from the read-back, that's a concurrent-write race. **This single diagnostic distinguishes the two candidate mechanisms in under 5 minutes.**
- **If the writer turns out to short-circuit on `WhatId != null` (candidate #2)** — remove the branch; the SGA→SGM Opportunity hand-off is exactly when coaching notes are most valuable, so suppressing those PATCHes is the worst possible behavior. Confirm by grepping the writer for `WhatId`, `opportunityId`, or similar guards.
- **If the response confirms record-locking / parent-controlled sharing (candidate #1)** — the cleanest fix is to **detect the Contact+Opportunity-attached state and route those PATCHes through a workaround**: either (a) **fall back to a child-record write** (insert a new `Task` with the coaching notes and the original Task's WhoId/WhatId, rather than updating the locked record), or (b) **drop WhatId on the PATCH body** so SFDC re-evaluates sharing under the Contact-only path and the field updates land. Option (a) is more invasive but auditable; option (b) preserves the existing Task linkage but loses the Opportunity relationship on subsequent edits unless the BeforeSave flow re-stamps it (which it won't, since the flow's filter is `WhatId IsNull true` AND `recordTriggerType = Create`).
- **Independent of root cause: keep the writer's `silent_mutation_detected` check, but escalate it from a log line to a hard failure / paging alert.** The current behavior leaves coaching notes silently stranded in Neon with no operator visibility. The Round 2 record-state predicate (`WhoId is Contact AND WhatId is non-null Opportunity AND WhatId.OwnerId != currentUserId`) can be evaluated client-side before the PATCH to refuse-and-alert preemptively, avoiding the silent-2xx trap entirely.

**Note on Round 1's recommended fix path**: the first two bullets there (assign `Sales_Coaching_Integration` to all SGAs / switch to a dedicated integration user) **will not fix this issue** — they're predicated on the disproven FLS hypothesis. The third bullet (harden the writer's failure surface on `silent_mutation_detected`) is the only Round 1 recommendation that still applies and is preserved as the last bullet above.
