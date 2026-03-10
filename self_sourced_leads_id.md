# Identifying SGA Self-Sourced Leads

## Definition

A self-sourced lead is one that an SGA personally sourced (via Fintrx or LinkedIn), as opposed to leads assigned from provided lists, events, or inbound channels.

## Identification Logic

Filter on `Final_Source__c` in the `savvy-gtm-analytics.SavvyGTMData.Lead` table:

```sql
SELECT Id, FirstName, LastName, SGA_Owner_Name__c, Final_Source__c, CreatedDate
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND CreatedDate >= @week_start
  AND CreatedDate < @week_end
```

- **`Final_Source__c`** — the authoritative field. Two values qualify as self-sourced:
  - `Fintrx (Self-Sourced)` — leads pulled from the Fintrx platform
  - `LinkedIn (Self Sourced)` — leads sourced via LinkedIn
- **`SGA_Owner_Name__c`** — attributes the lead to the specific SGA. 100% populated on self-sourced leads.
- **`CreatedDate`** — use for weekly windowing.

## Fields to Avoid

| Field | Why |
|-------|-----|
| `CreatedById` | Shows "Savvy Operations" (system user) for bulk-loaded Fintrx records — not the actual SGA |
| `SGA_Self_List_name__c` | Only populated on ~27% of Fintrx self-sourced leads and 0% of LinkedIn — unreliable as a filter |
| `SGA_Owner_Name__c` alone | Populated on *all* lead types, not just self-sourced — must pair with `Final_Source__c` |
