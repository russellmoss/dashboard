---
name: document-neon-schema
description: "Build or refresh the curated Neon schema docs at .claude/neon-*.md. Spawns parallel agents that introspect a Neon DB via MCP, map Dashboard consumers, sample JSONB shapes, and (for sales-coaching) read the upstream repo. Produces a markdown doc covering table purpose, grain, dangerous columns, JSONB shapes, business glossary, and 'use this not that' warnings — the runtime gate for Claude before writing Neon SQL."
---

# Document Neon Schema — Curated Schema Context Builder

You are building (or refreshing) the curated schema context document for one of the two Neon Postgres databases backing the Dashboard app. The output is a markdown file at `.claude/neon-<db-name>.md` that becomes the runtime gate (alongside live `mcp__Neon__describe_table_schema`) for any Claude session about to write SQL against this DB.

The Neon MCP already exposes raw columns and types on demand. **Do not duplicate that.** This document captures what the schema *cannot* tell you: business purpose, grain, intent traps, JSONB shape, which tables are live vs dormant, why an oddly-named column exists, and where consumers live.

## Inputs

`$ARGUMENTS` — which DB to document. Required. One of:

| Argument | Neon project | Project ID |
|---|---|---|
| `savvy-dashboard` | savvy-dashboard-db | `lingering-grass-54841964` |
| `sales-coaching` | sales_coaching | `falling-hall-15641609` |

If the user provides no argument or something else, list the two options and ask. If the user types both ("do both", "back to back"), run this skill twice in sequence — `savvy-dashboard` first, then `sales-coaching` — and pause briefly between runs to surface any methodology fixes you want to apply on the second run.

---

## Phase 0: Confirm the project and prior doc

1. Call `mcp__Neon__describe_project` with the project ID to confirm reachability and capture: default branch ID, default database name, endpoint host, PG version, history retention.
2. If `.claude/neon-<db-name>.md` already exists, **read it first**. You are refreshing, not rewriting blind. Preserve human edits, hand-written warnings, and any cross-references; replace only sections that drift with the live schema.
3. State to the user, in one sentence, what you found ("Refreshing existing doc with N tables vs. M previously" or "Building fresh doc; no prior file at `.claude/neon-<db>.md`").

---

## Phase 1: Parallel Agent Investigation

Spawn agents in parallel. Tool access matters:

- Agents that need live SQL/introspection (`schema-introspector`, `jsonb-shape-sampler`) MUST use a subagent type with `mcp__*` access — typically `data-verifier` or `general-purpose`. The Neon MCP tools are `mcp__Neon__*`.
- Agents doing read-only code/repo work (`consumer-mapper`, `prisma-aligner`, `upstream-archaeologist`, `bridge-mapper`) can use lighter subagents (`code-inspector`, `pattern-finder`, or `Explore`).

### Agent 1: Schema Introspector (data-verifier)

Runs for **both** DBs. Prompt:

```
You have access to the Neon MCP (mcp__Neon__*). Document the live schema of Neon project <projectId> ("<db-name>"). Use the default branch and default database.

Produce a report with:

1. **Inventory** — for every table in every schema (especially `public`, `neon_auth` if present):
   - schema.table
   - row count (use `mcp__Neon__run_sql` with `SELECT reltuples::bigint FROM pg_class WHERE oid = 'schema.table'::regclass` for fast estimates; fall back to COUNT(*) for tables under 100k rows)
   - column count
   - has_jsonb_columns (yes/no)
   - has_primary_key (yes/no)

2. **Per-table detail** — for each table, call `describe_table_schema` and capture:
   - columns: name, type, nullable, default, comment if any
   - primary key columns
   - foreign keys (referencing table + columns)
   - indexes (name, columns, unique)
   - check constraints

3. **JSONB columns** — list every JSONB / JSON column across all tables with `(schema.table.column, sample_count)`. Do NOT sample shapes here — that's a separate agent's job. Just inventory them.

4. **Cardinality red flags** — flag any table where row_count > 1M (hot table), row_count = 0 (possibly dead), or column_count > 50 (likely needs decomposition or has an EAV-style payload).

5. **Empty schemas / extensions** — list non-default schemas (e.g. neon_auth, drizzle, _prisma_migrations) and any installed extensions (`SELECT extname FROM pg_extension`).

Output as one markdown file at `<scratch>/neon-introspector-<db-name>.md`. Do NOT skip tables. If you hit MCP rate limits, batch and retry — produce a complete inventory.
```

### Agent 2: Consumer Mapper (code-inspector)

Runs for **both** DBs. Prompt for **savvy-dashboard**:

```
The savvy-dashboard-db Neon DB is consumed by the Dashboard Next.js app at C:\Users\russe\Documents\Dashboard. For each of the following tables, identify every file that reads from or writes to it:

[paste table list from Phase 0 inventory]

For each table, produce:
- **Read sites** — file paths and line numbers (Prisma `db.<Model>.findX`, raw `prisma.$queryRaw`, etc.)
- **Write sites** — file paths and line numbers (`create`, `update`, `delete`, `upsert`, INSERT/UPDATE/DELETE)
- **API routes** — `src/app/api/**/route.ts` files that surface this table's data
- **Server actions / cron jobs / scripts** — any `scripts/`, `packages/`, or non-route consumers
- **Hot vs dormant** — based on consumer count: 0 consumers = DORMANT (flag for cleanup investigation), 1-2 = niche, 3+ = hot

Pay special attention to tables NOT in `prisma/schema.prisma` (raw-SQL-only tables). These need extra investigation because Prisma autocomplete won't surface them.

Output to `<scratch>/neon-consumers-savvy-dashboard.md`.
```

For **sales-coaching**, the same agent role but pointed at the **bridge** layer:

```
The sales_coaching Neon DB is primarily owned by the sales-coaching repo (sibling at C:\Users\russe\Documents\sales-coaching). The Dashboard app reads from it via a bridge client at src/lib/sales-coaching-client/. Identify every file in C:\Users\russe\Documents\Dashboard that touches this DB indirectly:

- Map every method on `salesCoachingClient` (in src/lib/sales-coaching-client/) — what endpoint it hits, what schema it parses
- Map every consumer of those methods — API routes, components, queries (especially under src/app/dashboard/call-intelligence/ and src/lib/queries/call-intelligence/)
- Identify the bridge schema mirror at src/lib/sales-coaching-client/schemas.ts — list every exported type/schema and what upstream table it maps to (best-effort, cross-reference with table list)
- Flag any direct Neon access to sales_coaching from the Dashboard (there should be NONE — if you find any, that's a finding)

Output to `<scratch>/neon-consumers-sales-coaching.md`.
```

### Agent 3: Prisma Aligner (code-inspector) — savvy-dashboard ONLY

Prompt:

```
Compare the live Neon schema for savvy-dashboard-db (project lingering-grass-54841964) against prisma/schema.prisma.

Produce:
1. **Prisma-managed tables** — every model in schema.prisma, mapped to its live table name (Prisma's @@map / table-name conventions).
2. **Raw-SQL-only tables** — tables in Neon that have NO corresponding Prisma model. List them with row counts and brief purpose guess from name.
3. **Drift** — for Prisma-managed tables, flag any column where Prisma's type differs from the live column type, or where a column exists in one but not the other.
4. **@relation intent** — for each Prisma `@relation`, capture the human-meaningful description it implies (e.g. "User has many DashboardRequest as submitter via submittedBy").

Read both files yourself rather than re-introspecting Neon — the schema-introspector agent's output at <scratch>/neon-introspector-savvy-dashboard.md is your source for the live side.

Output to `<scratch>/neon-prisma-alignment.md`.
```

### Agent 4: Upstream Archaeologist (general-purpose) — sales-coaching ONLY

This agent needs broad search access. Prompt:

```
The sales_coaching Neon DB is owned by the sales-coaching repo at C:\Users\russe\Documents\sales-coaching. For each table in the inventory at <scratch>/neon-introspector-sales-coaching.md, find out from the sales-coaching repo:

1. **Origin** — which migration file created it (look in db/migrations/, prisma/migrations/, drizzle/migrations/, or raw SQL files)
2. **Purpose** — what the table is for, based on:
   - README files
   - design docs (look in docs/, design/, .docs/, internal-docs/)
   - CLAUDE.md or AGENTS.md
   - the migration's own comments
   - route handlers / server code that writes to it
3. **Grain** — what does one row represent? (one evaluation, one rep-day, one transcript turn, etc.)
4. **Lifecycle** — is it append-only, mutable, or routinely truncated? Any TTL / archival pattern?
5. **Cross-table relationships** — how does it connect to evaluations, reps, knowledge_base_chunks, call_notes (the core entities)?

Pay special attention to:
- `evaluations`, `dimension_scores`, `eval_correction_*` — the evaluation/correction pipeline
- `knowledge_base_chunks` and `kb_vocab_*` — the KB structure (note: PK is `id`/`body_text`, NOT `chunk_id`)
- `call_notes`, `call_transcripts`, `transcript_comments` — the call surface
- `coaching_briefs`, `coaching_teams`, `coaching_team_members`, `coaching_observers` — org structure
- `notification_outbox`, `sfdc_write_log`, `coaching_doc_outbox` — outbound integration tables
- `neon_auth.*` — Neon Auth managed tables, don't document internals

If you can't determine purpose for a table after a thorough search, mark it UNKNOWN with what you DID find (last-modified date, who wrote it via git blame, etc.).

Output to `<scratch>/neon-upstream-archaeology.md`.
```

### Agent 5: JSONB Shape Sampler (data-verifier) — sales-coaching primarily, savvy-dashboard if JSONB columns exist

Prompt:

```
The schema-introspector agent has produced an inventory of JSONB columns at <scratch>/neon-introspector-<db>.md. For each JSONB column with sample_count > 0:

1. Sample 3-5 representative rows: `SELECT <column> FROM <table> WHERE <column> IS NOT NULL ORDER BY random() LIMIT 5` — or for known-important tables (evaluations.dimension_scores, evaluations.narrative, notification_outbox.payload), use deterministic samples (most recent, oldest, longest).

2. Document the shape:
   - Required top-level keys (present in all samples)
   - Optional keys (present in some)
   - Value types for each key (string, number, array, nested object)
   - Enum-like fields with their observed values
   - Whether the structure is a flat record, an array of records, or a nested tree

3. Note shape variants — if the same column has materially different shapes across rows, document each variant and what triggers it (e.g., "if dimension == 'open' then payload has 'confidence_score', else it doesn't").

4. Flag fields whose names suggest sensitive data (PII, credentials, tokens). Do NOT print sample values for these; just note shape.

Output as TypeScript-style interfaces for clarity, e.g.:

```ts
// evaluations.dimension_scores — JSONB
interface DimensionScores {
  [dimensionKey: string]: {
    score: number; // 0-5 typical
    body?: string; // optional after schema v6
    confidence?: number;
  };
}
```

Output to `<scratch>/neon-jsonb-shapes-<db>.md`.
```

---

## Phase 2: Synthesize into the Final Doc

Once all agents complete, read all `<scratch>/neon-*<db-name>.md` files and synthesize into `.claude/neon-<db-name>.md`.

### Output Template

```markdown
# Neon Schema Context — <db-name>

**Project ID:** `<projectId>`
**Default branch / database:** `<branch>` / `<db>`
**Postgres version:** `<pg_version>`
**Endpoint host:** `<proxy_host>`
**Last refreshed:** <YYYY-MM-DD>

> **HARD GATE:** Before writing any SQL against this Neon DB or modifying a table here, you MUST (a) call `mcp__Neon__describe_table_schema` for the live column list, AND (b) consult the relevant table section in this doc for business purpose, grain, and known traps. Do not guess column names. Do not assume a JSONB shape without checking the JSONB Shapes section.

---

## At a Glance

| Stat | Value |
|---|---|
| Total tables | N |
| Prisma-managed | N (this DB only; sales-coaching has 0) |
| Raw-SQL-only | N |
| Tables with JSONB | N |
| Hot tables (>1M rows) | list |
| Dormant tables (0 consumers) | list — flagged for cleanup review |

## How Consumers Connect

[1-2 paragraphs: where the connection string lives, how Prisma / bridge / raw access works, any pooler considerations]

---

## Domain Map

[A grouped view of tables by domain. For savvy-dashboard: Auth & Identity, Forecast, Dashboard Requests, Bot State, Games, MCP. For sales-coaching: Evaluation Pipeline, Knowledge Base, Call Surface, Coaching Org, Outbox / Integrations, Neon Auth, Internal/Audit.]

Each domain section:

### Domain: <Name>

**Purpose:** one-paragraph why this domain exists.

| Table | Grain | Hot? | Notes |
|---|---|---|---|
| `public.evaluations` | one row per evaluation | hot | JSONB-heavy; see traps |

---

## Per-Table Detail

[For every table: an H3 with table name, then:

#### `schema.table_name`

**Purpose:** one paragraph.
**Grain:** one row per X.
**Lifecycle:** append-only | mutable | TTL'd.
**Primary key:** column(s).
**Foreign keys:** target_table(target_col) ← my_col.
**Consumers (read):** file:line — call site description
**Consumers (write):** file:line — call site description
**Traps:**
- Trap 1 (e.g., "knowledge_base_chunks PK is `id`/`body_text`, NOT `chunk_id` — feedback_coaching_db_schema_traps").
- Trap 2.
**Use this when:** ... **Use X instead when:** ...

For dormant tables (0 consumers found): mark `**Status:** DORMANT — no consumers found in Dashboard repo as of <date>. May be owned upstream; verify before deleting.`
]

---

## JSONB Shapes

[For every JSONB column with samples: TypeScript interface + 1-paragraph narrative + variant notes. Include observed enum values.]

---

## Business Glossary

[A flat list of business terms → table + column. e.g.:
- "won deal" → not a column in this DB; defined on the BQ side. See [[feedback-won-deal-definition]].
- "evaluation score" → `evaluations.score` (legacy) OR `evaluations.dimension_scores.{key}.score` (current).
- "rep" → `public.reps.id` (auth identity is `neon_auth.user.id` linked via reps.user_id).
]

---

## Known Anti-Patterns & Traps

[Bulleted list of every trap surfaced by agents. Each entry: 1-line statement + WHY (with feedback memory link if applicable). Examples for sales-coaching:
- `evaluations.dimension_scores` is JSONB, not a join — never JOIN on it; cast with ->> first.
- `knowledge_base_chunks` PK is `id`, body column is `body_text` — there is no `chunk_id`. (See feedback-coaching-db-schema-traps.)
- `call_transcripts` uses `speaker_role` + seconds offsets — NOT speaker name + timestamps.
- Don't query `evaluations.narrative` for structured fields — it's an LLM-authored prose JSONB.
]

---

## Migration & Schema Authority

**This DB is owned by:** [Dashboard's Prisma migrations | sales-coaching repo migrations at <path>]
**Schema changes flow:** [describe — e.g., "Authoring side is sales-coaching; Dashboard mirrors the Zod schema via src/lib/sales-coaching-client/schemas.ts and `/sync-bridge-schema`."]
**Drift detection:** [e.g., `npm run check:schema-mirror` runs in CI]

---

## Cross-References

- Live live introspection: `mcp__Neon__describe_table_schema`, `get_database_tables`
- Schema drift check: `mcp__Neon__compare_database_schema` (between branches)
- Slow queries: `mcp__Neon__list_slow_queries`
- Related memory: [[reference-neon-projects]], [[feedback-coaching-db-schema-traps]], any others from MEMORY.md that intersect
- Related docs: `prisma/schema.prisma`, `docs/ARCHITECTURE.md`, BQ context at `.claude/bq-*.md`
```

### Synthesis Rules

- **Every claim cites evidence.** A "consumer" entry must have file:line. A JSONB shape must be from sampled data. A "dormant" flag must say which agent found zero consumers.
- **Preserve human edits** from the prior version when refreshing. If the prior doc had a hand-written trap that an agent didn't surface, keep it (and re-verify it's still true; if not, flag a discrepancy at the bottom of the doc).
- **Link forward to feedback memories.** If a trap is already in a feedback memory (e.g., `feedback_coaching_db_schema_traps.md`), reference it with `[[name]]` syntax. Don't restate the rationale in full.
- **No filler.** If a domain has no traps, write "No known traps." Don't pad.
- **Mark unknowns explicitly.** If an agent couldn't determine purpose, the table entry says `**Purpose:** UNKNOWN — last modified <date>, no docs / migration comments found.` Don't fabricate.

---

## Phase 3: Validation Sweep

Before reporting completion:

1. **Spot-check 3 random tables** — pick three tables (one from each domain if possible) and verify their per-table section matches what `mcp__Neon__describe_table_schema` actually returns. If you find drift, the introspector report was stale — re-run that one section.
2. **Verify all `[[memory-name]]` links** point to memory files that actually exist (check `C:\Users\russe\.claude\projects\C--Users-russe-Documents-Dashboard\memory\`). Broken links are OK if the name describes a memory worth writing later; just be sure they're not typos of existing memories.
3. **Confirm CLAUDE.md gate is in place** (Phase 4 of the user's overall workflow — but the skill can flag if missing).

---

## Phase 4: Present to User

Tell the user:

1. **Headline**: "Documented N tables across M domains for `<db-name>`. Saved to `.claude/neon-<db-name>.md`."
2. **Surprises**: 2-3 things the audit surfaced that weren't obvious before (dormant tables, JSONB shape quirks, undocumented FK chains, etc.).
3. **Open questions**: any table marked UNKNOWN, any drift between Prisma and live schema, any consumer-mapping gaps.
4. **Recommended follow-ups**: e.g., "5 dormant tables flagged — worth a cleanup pass" or "evaluations.narrative JSONB has 3 distinct shape variants — consider a discriminator field upstream."
5. **Next steps**: if running both DBs back-to-back, kick off the next run. If done, remind user the CLAUDE.md hard gate is now live.

---

## Critical Rules

- **Curated, not dumped.** This doc is for context that the live schema can't tell you. If a section is just "here are the column names and types" — cut it. The MCP already does that.
- **Live is truth.** When prior doc and live schema disagree, live wins. Update the doc, don't preserve the wrong claim.
- **No PII in JSONB samples.** If a JSONB column contains user data, document shape only — never paste sample values.
- **Don't speculate.** If you can't trace a table's purpose, mark UNKNOWN with what you DID find. Better to be visibly incomplete than confidently wrong.
- **Refresh = surgical.** When refreshing an existing doc, diff section-by-section. Don't rewrite the whole file when only a few tables changed.
- **Hard gate matters.** This doc only works if Claude consults it before writing SQL. Confirm CLAUDE.md has the gate; if missing, flag to the user as a Phase 4 follow-up.
