---
name: sync-bridge-schema
description: Re-sync src/lib/sales-coaching-client/schemas.ts byte-for-byte from sales-coaching's main branch. Use when CI fails on check:schema-mirror, when the user mentions schema drift, or when sales-coaching has merged a bridge schema change you need to pull into Dashboard.
---

# Sync Bridge Schema

Pulls the canonical Zod schemas from `russellmoss/sales-coaching@main:src/lib/dashboard-api/schemas.ts` and writes them to `src/lib/sales-coaching-client/schemas.ts` in this repo.

## When to invoke

- CI step `check:schema-mirror` failed (or `npm run check:schema-mirror` reports DRIFT locally).
- The user mentions schema drift, byte-equality failure, or "the mirror is out of date".
- The user just merged or is about to merge a bridge schema change in sales-coaching and wants Dashboard caught up.
- A Dashboard PR is adding a new bridge endpoint and you want to be sure the local mirror matches main before adding the corresponding client method.

## How to run

### Step 1 — Determine the source

Two acceptable sources, in priority order:

1. **Local sibling repo** (fastest, no network/auth needed). Default path: `C:/Users/russe/Documents/sales-coaching/src/lib/dashboard-api/schemas.ts`. Use this if it exists and the user has the sibling checked out.
2. **GitHub raw via `gh api`** (works anywhere). Uses the user's `gh` auth which is already set up. Run:
   ```bash
   gh api repos/russellmoss/sales-coaching/contents/src/lib/dashboard-api/schemas.ts \
     -H 'Accept: application/vnd.github.raw' \
     --ref main
   ```

### Step 2 — Write the file verbatim

Overwrite `src/lib/sales-coaching-client/schemas.ts` with the upstream content. Do NOT merge, transform, or hand-edit. The mirror is byte-for-byte by design.

For the local sibling case:
```bash
cp C:/Users/russe/Documents/sales-coaching/src/lib/dashboard-api/schemas.ts \
   C:/Users/russe/Documents/Dashboard/src/lib/sales-coaching-client/schemas.ts
```

For the GH case, capture the `gh api` output and use Write to overwrite the file in one shot.

### Step 3 — Verify byte-equality

```bash
npm run check:schema-mirror
```

Expected: `Schema mirror byte-equal with russellmoss/sales-coaching@main:src/lib/dashboard-api/schemas.ts ✓`

### Step 4 — Verify build

```bash
npm run build 2>&1 | tail -30
```

Type errors after sync usually mean an upstream schema changed shape and the Dashboard client (`src/lib/sales-coaching-client/index.ts`) or a route handler now references a moved/renamed export. Inspect the diff:

```bash
git diff --staged src/lib/sales-coaching-client/schemas.ts
```

Flag to the user any:
- New exports → may need a new method on `salesCoachingClient` and/or a new Dashboard API route.
- Removed exports → existing code is broken; surface the call sites that need to be updated.
- Renamed exports → import sites need updating.
- Field shape changes (e.g., a request now requires a new field) → call sites that build that request body need updating.

### Step 5 — Stage but don't commit

```bash
git add src/lib/sales-coaching-client/schemas.ts
```

Don't commit yourself. The user is in the middle of work and will commit when ready (often as part of the larger PR they're working on).

## Authentication notes

If `gh` returns 401/403:
- Tell the user to run `gh auth login` (or `gh auth refresh`).
- The fallback is the local sibling-repo path at `C:/Users/russe/Documents/sales-coaching/`.

If neither works, surface the error to the user — don't paper over it with stale data.

## Reporting back

After the sync, give the user a one-liner:
- "Mirror synced. 2 new exports added (`FooRequest`, `FooResponse`) — you'll likely need a `salesCoachingClient.foo()` method to consume them."
- Or "Mirror synced. No new exports; one inferred type renamed (`BarT` → `BarResponseT`). Updated 2 call sites." (if applicable)
- Or "Mirror was already in sync — no changes needed."

Keep the user moving; don't editorialize.
