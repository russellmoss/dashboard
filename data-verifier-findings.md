# Data Verifier Findings: Knowledge Gap Clusters Rewrite (Section 6)

Date: 2026-05-12
DB: Neon Postgres (sales-coaching), live queries via pg driver
Spec: insights-refinements.md section 6
All live probes confirmed against live data, not inferred from code.

---

## A. Existing Helper Analysis

File: src/lib/queries/call-intelligence/knowledge-gap-clusters.ts

### A1. Current gap_hits CTE -- columns selected

  topics.topic (kb_vocab_topics canonical vocab value; becomes bucket in rewrite)
  e.rep_id
  r.full_name AS rep_name
  e.id AS evaluation_id
  1 AS gap_count
  0 AS deferral_count
  NULL::text AS kb_coverage

NOT selected today but required by rewrite:
  kg.item->>text AS evidence_text
  kg.item->citations AS citations (jsonb)
  kg.item->>expected_source AS expected_source_full

Column name mapping for rewrite:
  topics.topic       -> bucket              (rename + semantic: vocab-match to path-segment)
  evaluation_id      -> evaluation_id       (no change)
  gap_count/deferral_count/kb_coverage -> unchanged
  [absent]           -> evidence_text, citations, expected_source_full (new)

### A2. Current deferral_hits CTE

Selected: topics.topic, d.rep_id, r.full_name AS rep_name, d.evaluation_id,
0 AS gap_count, 1 AS deferral_count, d.kb_coverage.

Does NOT join via kb_chunk_ids to knowledge_base_chunks.topics. Uses CROSS JOIN
topics (the kb_vocab_topics CTE) with EXISTS LIKE match against d.topic text.

Filters is_synthetic_test_data = false: YES (line 129 of current helper).

Missing for rewrite:
  d.deferral_text AS evidence_text (field exists in DB but not selected)
  d.utterance_index (not selected)
  The LATERAL join to knowledge_base_chunks via kb_chunk_ids is entirely absent

### A3. Is the topics CTE present?

YES. First CTE, lines 68-77. Reads from kb_vocab_topics table and builds synonyms
array from KB_VOCAB_SYNONYMS. Rewrite removes this CTE and the ::jsonb param.
KB_VOCAB_SYNONYMS stays as theming data.

### A4. LATERAL + unnest(topics) patterns against knowledge_base_chunks

Only two files in src/ reference knowledge_base_chunks:
  src/lib/queries/call-intelligence/knowledge-gap-clusters.ts (no LATERAL)
  src/lib/queries/call-intelligence-evaluations.ts (simple WHERE id = ANY, no LATERAL)

The LATERAL pattern is novel in this codebase. No existing code to copy from.

---

## B. knowledge_base_chunks Column Inventory (LIVE)

Full results from information_schema.columns (22 columns):

  id                   uuid                      NOT NULL
  drive_file_id        text                      NOT NULL
  chunk_role           text                      NOT NULL
  chunk_index          integer                   NOT NULL
  doc_id               text                      NOT NULL
  chunk_type           text                      NOT NULL
  topics               ARRAY (text[])            NOT NULL
  call_stages          ARRAY (text[])            NOT NULL
  rubric_dimensions    ARRAY (text[])            NOT NULL
  objection_type       text                      NULLABLE
  owner                text                      NOT NULL
  last_verified        date                      NOT NULL
  body_text            text                      NOT NULL
  embedding            USER-DEFINED (vector)     NOT NULL
  drive_revision_id    text                      NOT NULL
  is_active            boolean                   NOT NULL
  deleted_at           timestamp with time zone  NULLABLE
  deleted_reason       text                      NULLABLE
  path_changed_at      timestamp with time zone  NULLABLE
  synced_at            timestamp with time zone  NULLABLE
  created_at           timestamp with time zone  NOT NULL
  updated_at           timestamp with time zone  NOT NULL

Spec confirmations:
  id: uuid, NOT NULL, PK. CONFIRMED. No chunk_id column exists.
  topics: ARRAY (text[]), NOT NULL. CONFIRMED.
  is_active: boolean, NOT NULL. CONFIRMED.
  chunk_index: integer, NOT NULL. CONFIRMED. Used in LATERAL ORDER BY chunk_index.

Additional columns not in spec (ignore for rewrite, available for future sub-filters):
  chunk_type, doc_id, drive_file_id, owner, embedding (vector), call_stages, rubric_dimensions.

---
## C. knowledge_gaps JSONB Item Shape (LIVE)

### C1. Key distribution, last 90 days, all evaluations

  citations        765/765   100%
  text             765/765   100%
  expected_source  642/765   83.9%

No other keys present. No kb_source, confidence, severity at item level.
Structure exactly matches three keys the spec expects.

765 items spans all evaluations (no advisor filter). Advisor-eligible = 450 (see E3).

### C2. Sample items

Citations can contain BOTH utterance_index AND kb_source entries in the same item:
  citations: [
    { utterance_index: 225 },
    { utterance_index: 236 },
    { kb_source: { doc_id, chunk_id, doc_title, drive_url } }
  ]

Spec type Array<{ utterance_index?: number; kb_source?: {...} }> is correct.

kb_source uses field name chunk_id (not id). Maps to knowledge_base_chunks.id.
Confirmed by comment at call-intelligence-evaluations.ts:465.

---

## D. rep_deferrals Column Inventory (LIVE)

Full results from information_schema.columns (12 columns):

  id                      uuid                      NOT NULL
  evaluation_id           uuid                      NOT NULL
  call_note_id            uuid                      NOT NULL
  rep_id                  uuid                      NOT NULL
  topic                   text                      NOT NULL
  deferral_text           text                      NOT NULL
  utterance_index         integer                   NULLABLE
  kb_coverage             text                      NOT NULL
  kb_max_similarity       numeric                   NULLABLE
  kb_chunk_ids            ARRAY (uuid[])            NOT NULL
  is_synthetic_test_data  boolean                   NOT NULL
  created_at              timestamp with time zone  NOT NULL

Spec confirmations:
  kb_chunk_ids: ARRAY (uuid[]), NOT NULL. CONFIRMED.
  utterance_index: integer, NULLABLE. Spec uses utterance_index? (optional). CONFIRMED.
  deferral_text: text, NOT NULL. CONFIRMED.
  kb_coverage: plain text (NOT a Postgres enum). Values covered/partial/missing are app-level.
  is_synthetic_test_data: boolean, NOT NULL. CONFIRMED.

Not in spec: call_note_id (direct FK), kb_max_similarity (numeric similarity score).

deferral_text population (last 90 days): 201/201 = 100%. Fully populated. Currently unused by any query.

---

## E. Live Spec Probes

### E1. Chunk topics distribution (is_active = true, 176 active chunks)

31 distinct curated tags:

  sgm_handoff: 46              discovery_call_structure: 34   move_mindset: 32
  candidate_persona: 31        aum_qualification: 27          meeting_sequencing: 21
  tech_platform: 20            operations_support: 20         objection_handling: 18
  comp_modeling: 15            marketing_program: 15          revenue_split: 14
  qualification_decision: 10   client_origin: 10              investment_management: 9
  transition_timeline: 8       culture_fit: 8                 equity_structure: 8
  tech_partners: 7             pers: 6                        firm_types: 5
  kickers: 5                   compliance: 5                  firm_specific_risk: 5
  client_onboarding: 4         disclosures: 4                 legal_protocol: 2
  client_data_portability: 2   affiliation_model: 2           garden_leave: 1
  book_ownership: 1

Spec anticipated ~10-30 distinct tags. 31 is at the upper bound but reasonable.
All tags are snake_case, no anomalies.

### E2. Deferral lateral coverage rate (last 90 days, advisor-eligible, non-synthetic)

  would_bucket: 169 / total: 169 = 100%

Every advisor-eligible non-synthetic deferral has at least one active KB chunk with
topics populated linked via kb_chunk_ids. Spec anticipated >70%. Actual: 100%.
The fallback Uncategorized: || d.topic currently hits 0 rows.

### E3. Unfiltered ceiling (data preservation check)

  gap_ceiling:      450  (advisor-eligible knowledge gaps, last 90 days)
  deferral_ceiling: 169  (non-synthetic, advisor-eligible deferrals, last 90 days)
  Combined ceiling: 619  rows the rewrite must surface without dropping any.

SPEC DECAY: Spec states 422 gaps, 147 deferrals. Live: 450 (+28), 169 (+22).
Data grew since spec was written. Normal growth, not a data integrity issue.

### E4. expected_source population rate (advisor-eligible, last 90 days)

  populated:               407 / 450 = 90.4%
  distinct_2seg_buckets:   20
  null/empty (Uncategorized): 43 rows (9.6%)

Spec cited 92% (388/422). Current 90.4% within tolerance as data grew. 20 buckets confirmed.

### E5. Top bucket distribution (advisor-eligible, last 90 days)

  profile/ideal-candidate-profile    143 gaps   13 reps
  playbook/sga-discovery             103 gaps   18 reps
  (null -- Uncategorized)             43 gaps    9 reps
  facts/process                       32 gaps   10 reps
  playbook/sgm-intro                  26 gaps    7 reps
  playbook/handoff                    21 gaps    5 reps
  playbook/platform-review            21 gaps    5 reps
  facts/compensation                  15 gaps    7 reps
  playbook/operations-overview        13 gaps    2 reps
  playbook/comp-discussion             9 gaps    3 reps
  playbook/offer-presentation          7 gaps    3 reps
  facts/company                        4 gaps    3 reps
  playbook/marketing-discussion        4 gaps    3 reps
  facts/platform                       2 gaps    2 reps
  playbook/operations                  1 gap     1 rep
  playbook/legal                       1 gap     1 rep
  playbook/compliance                  1 gap     1 rep
  facts/marketing                      1 gap     1 rep
  facts/equity                         1 gap     1 rep
  facts/competitive                    1 gap     1 rep

SPEC DECAY: Spec states top bucket at 132 gaps, 13 reps. Live: 143 gaps (+11), 13 reps.
Acceptance criterion (c) should be updated or made label-only (drop hardcoded count).

The NULL bucket row (43 gaps) from NULLIF correctly maps to Uncategorized via COALESCE.

---

## F. Data Quality Risks

### F1. expected_source path anomalies

Leading slashes: 0 rows.
Backslash characters: 0 rows (confirmed via chr(92) probe -- initial position() probe
returned 642 as false positive due to Postgres escape-string semantics).
All sampled values are clean forward-slash-separated lowercase kebab strings.
No non-ASCII, no spaces. split_part truncation to 2 segments is safe.

### F2. rep_deferrals.kb_chunk_ids null vs empty (last 90 days, 201 rows)

  NULL kb_chunk_ids: 0
  Empty array:       0

Column is NOT NULL at schema level. All rows have at least one UUID.

### F3. knowledge_base_chunks.topics null vs empty (active chunks, 176 rows)

  NULL topics:  0  (column is NOT NULL)
  Empty array:  0

All active chunks have at least one topic. LATERAL guard clauses ARE NOT NULL AND
array_length(topics, 1) > 0 are defensive but currently unnecessary.

### F4. Duplicate topics within a single chunk

0 chunks have duplicate topics. No deduplication needed.

### F5. Empty expected_source NULLIF check

NULLIF(split_part('','/',1) || '/' || split_part('','/',2), '/') returns NULL.
Confirmed: empty input produces '/' which NULLIF converts to NULL,
then COALESCE maps to Uncategorized. The logic is correct.

### F6. rep_deferrals.topic null/empty rate (last 90 days)

  NULL or empty: 0 / 201

Uncategorized fallback via d.topic is safe -- d.topic is always populated.

---

## Summary Table -- Spec vs Live Numbers

  Metric                                 Spec says    Live 2026-05-12    Status
  Gap ceiling (advisor-eligible, 90d)    422          450                DECAYED (data grew)
  Deferral ceiling (non-synthetic, 90d)  147          169                DECAYED (data grew)
  expected_source population rate        92%          90.4%              Within tolerance
  Distinct 2-segment buckets             20           20                 CONFIRMED
  Top bucket gap count                   132          143                DECAYED (data grew)
  Top bucket rep count                   13           13                 CONFIRMED
  Top bucket label                       profile/...  profile/...        CONFIRMED
  Deferral lateral coverage              >70%         100%               EXCEEDS SPEC
  Distinct chunk topic tags              ~10-30       31                 AT UPPER BOUND
  deferral_text population               (not stated) 100%               SAFE
  kb_chunk_ids null/empty                (not stated) 0%                 SAFE
  Backslash in expected_source           (risk)       0                  SAFE

---

## Key Flags for the Implementing Agent

1. STALE ACCEPTANCE CRITERION.
   Spec criterion (c): top bucket = profile/ideal-candidate-profile (132 gaps, 13 reps).
   Live: 143 gaps, 13 reps as of 2026-05-12. Update or make label-only.

2. kb_vocab_topics TABLE NOT IN SPEC.
   The topics CTE reads from kb_vocab_topics, a table not in the spec data model.
   Verify it still exists before the rewrite removes it. Confirm no other query depends on it.

3. utterance_index IS NULLABLE AT COLUMN LEVEL.
   jsonb_build_object with null utterance_index emits {utterance_index: null}.
   Modal layer must guard against null before scrolling transcript.
   Currently 0/201 rows null in 90-day window, but schema allows it.

4. kb_coverage IS PLAIN TEXT, NOT ENUM.
   No cast issues. ::text binding is already correct.

5. deferral_text IS 100% POPULATED AND CURRENTLY UNUSED.
   Rewrite is the first query to surface it. No backfill or migration needed.

6. DEFERRAL LATERAL COVERAGE IS 100% TODAY.
   Uncategorized fallback hits 0 rows. Keep in SQL for future-proofing (chunk retirement)
   but do not build UI optimizations around it in the initial ship.

7. expected_source CAN HAVE 3+ PATH SEGMENTS.
   Example: playbook/sga-discovery/open-with-three-pillars.
   split_part truncation to 2 segments is intentional and works correctly.
   Confirmed by 20 distinct 2-segment buckets.

8. LATERAL PATTERN IS NOVEL IN THIS CODEBASE.
   No other query uses LATERAL with knowledge_base_chunks.
   Closest existing pattern: getKbChunksByIds() in
   src/lib/queries/call-intelligence-evaluations.ts (simple WHERE id = ANY lookup).

