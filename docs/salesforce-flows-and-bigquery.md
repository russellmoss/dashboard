# Salesforce Flows and BigQuery: Can We See Them?

## Short answer

**No — not by default.** BigQuery currently holds **record data** from Salesforce (Lead, Opportunity, etc.) via the BigQuery Data Transfer Service / your ETL. It does **not** hold Salesforce **metadata** (Flows, Process Builders, Apex, page layouts, etc.). So existing Flows are not visible or queryable in BQ unless you add a custom step to get them there.

**Yes — it’s possible** to make Flow definitions (and other metadata) available so they can be used to assist you, including via MCP to BQ, by either loading that metadata into BigQuery or keeping it in the repo.

---

## What’s in BigQuery today

- **Record data:** Lead, Opportunity, User, and any other objects your sync pipeline sends to BQ. You can query these with MCP BigQuery (e.g. `SavvyGTMData.Opportunity`, `SavvyGTMData.Lead`).
- **No metadata:** Flow definitions, Process Builders, Apex classes, custom metadata types, etc. live only in the Salesforce org unless you explicitly export or sync them elsewhere.

So **existing Flows are not in BQ** unless you build a process to put them there.

---

## Options to “see” Flows for assistance (including MCP)

### Option 1: Put Salesforce metadata in the repo (recommended if you use source control)

If you use **Salesforce DX** (or similar) and keep metadata in Git:

1. **Retrieve Flows** into your repo, e.g.:
   - `sf project retrieve start --metadata Flow`
   - or retrieve specific flows: `sf project retrieve start --metadata "Flow:Your_Flow_Api_Name"`
2. Flows are stored as XML under something like `force-app/main/default/flows/` (or your `metadata/` equivalent).
3. **Commit and push** so the Flow XML files are in the same repo as your Dashboard (or a repo the AI can read).

Then the AI can **read those files directly** (no BQ involved) to help with Flow design, mapping, and “Create Re-Engagement” / re-engagement logic. MCP BQ is still used for **data** (e.g. Opportunity, Lead); Flow **logic** comes from the repo.

**Pros:** No new infra; works with your current DX/source control; easy to keep in sync with the org.  
**Cons:** Requires that Flows are actually retrieved and committed (manual or CI).

---

### Option 2: Export Flow definitions and add them to the repo or a doc

1. **From Setup:** Setup → Flows → open a Flow → use “View API Name” / “Download” if available.
2. **From VS Code / CLI:** `sf project retrieve start --metadata Flow` (or per-flow) and commit the generated XML.
3. **From Metadata API:** Use the Metadata API (or a script that calls it) to list and retrieve `Flow` metadata, then save the XML/JSON to a folder in the repo (e.g. `docs/salesforce-flows/`) or paste a specific Flow into a markdown doc.

Then the AI can use those files or that doc to assist with Flow design. Again, this does **not** require BQ for Flows.

**Pros:** Simple; no BQ changes; good for one-off or key Flows.  
**Cons:** Manual (or scripted) export; can get stale if not refreshed.

---

### Option 3: Sync Flow metadata into BigQuery (so MCP BQ can “see” them)

If you want Flow definitions **queryable in BigQuery** (e.g. for MCP or reporting):

1. **Retrieve Flow definitions** using the Salesforce **Metadata API** (or SF CLI):
   - List Flows: `Metadata API` → `listMetadata(type: 'Flow')`.
   - Retrieve: `readMetadata('Flow', [list of flow names])` → returns XML/JSON per Flow.
2. **Transform and load** into BigQuery:
   - Parse the Flow XML/JSON into a structured form (e.g. flow API name, label, process type, last modified, and a column with full definition JSON or XML).
   - Load into a table, e.g. `your_project.your_dataset.salesforce_flow_metadata` with columns such as:
     - `flow_api_name` (STRING)
     - `flow_label` (STRING)
     - `process_type` (STRING) — e.g. AutoLaunched, Screen, etc.
     - `definition_json` or `definition_xml` (STRING) — full definition
     - `last_modified_date` (TIMESTAMP)
3. **Schedule** this (e.g. Cloud Function, Cloud Run, or scheduled job) so the table is updated periodically.

Then you (or the AI via MCP BigQuery) can run SQL against that table to list Flows, see definitions, and assist with design. The **data** in BQ (Opportunity, Lead) stays as-is; you’re adding a **separate** metadata table.

**Pros:** Single place (BQ) for both record data and Flow metadata; queryable; can be automated.  
**Cons:** Custom pipeline to build and maintain; Metadata API and auth to handle.

---

## Recommendation

- **For day-to-day assistance with Flows (e.g. re-engagement, Create Re-Engagement button):**  
  Use **Option 1 or 2** — get Flow definitions into the **repo** (or a doc the AI can read). The AI can then read the XML/files directly; MCP BQ remains for querying **data** (Opportunity, Lead, etc.).

- **If you want Flows queryable in BQ** (e.g. “list all Flows,” “find Flows that reference Opportunity,” or future tooling):  
  Use **Option 3** — build a small Metadata API → BQ pipeline and load Flow metadata into a dedicated BQ table. Then MCP BQ can be used to “see” and reason about Flows from that table.

---

## Summary

| Question | Answer |
|----------|--------|
| Are existing Flows visible in BQ today? | **No.** BQ has record data only, not Flow metadata. |
| Can we transfer Flows to BQ so MCP can see them? | **Yes.** By building a custom sync: Metadata API → transform → load into a BQ table (e.g. `salesforce_flow_metadata`). |
| Easiest way to get Flow help (including MCP on data)? | Put Flow definitions in the **repo** (SFDX retrieve + commit) or in a doc; use MCP BQ for **data** (Opportunity, Lead). |

If you tell me which path you prefer (repo only vs. also BQ), I can outline concrete steps (e.g. exact `sf` commands, suggested BQ schema, and a minimal script shape for Option 3).

---

## Using extracted Flows as a pattern library for new builds

**Yes.** Extracting your current Flows (via Metadata API or SF CLI) and keeping them in the repo (or in BQ) gives you a **reference set** so new Flows can match existing patterns and conventions.

### How it helps

When you build something new (e.g. “Create Re-Engagement” button flow, or Re-Engaged → Recruiting Opportunity flow), the AI (or a developer) can:

1. **Read existing Flow definitions** — naming, structure, how record-triggered vs screen vs autolaunched are used.
2. **Reuse patterns** — how you handle errors, null checks, Get Records vs formula resources, how you set field mappings (e.g. Recruiting → Re-Engagement).
3. **Match conventions** — API names, labels, descriptions, how you branch on record type or stage.
4. **Stay consistent** — new Flows look and behave like the ones you already have (same decision logic, same variable naming, same fault paths).

So: **extract current Flows → treat them as a pattern library → use them when designing new Flows** so new builds are similar to what you already have.

### Practical workflow

1. **Extract** — Use the API (or `sf project retrieve start --metadata Flow`) to pull all Flows (or the ones that are good references) into the repo, e.g. `force-app/main/default/flows/` or `docs/salesforce-flows/`.
2. **Keep in sync** — Re-run the retrieve when you add or change Flows so the pattern library stays current.
3. **Reference when building** — When designing a new Flow (e.g. “Create Re-Engagement,” or “When Re-Engaged create Recruiting opp”), point to:
   - The **field-mapping docs** (e.g. `re-engagement-record-type.md`), and  
   - The **extracted Flow XML** for similar flows (e.g. the current close-lost flow that creates a re-engagement opp) so the new Flow follows the same structure and patterns.

That way new Flows are consistent with your existing ones and easier to maintain.
