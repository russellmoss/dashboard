#!/usr/bin/env node
// One-shot backfill: mirror slack_review_messages.sfdc_suggestion's "likely"
// top-candidate Opportunity Id onto call_notes.sfdc_what_id for unlinked
// granola rows.
//
// Why
//   When a granola call's DM ranked an Opportunity as the recommended
//   "likely" candidate but the rep never approved (no push, no manual
//   re-link), call_notes.sfdc_what_id stays NULL. The Coaching Usage
//   resolver consults the suggestion at query time as a fallback, but
//   downstream consumers that read call_notes directly (or a future
//   removal of the resolver-side fallback) would still see NULL. Backfill
//   makes the call_notes row self-describing.
//
// Safety
//   - Idempotent: only updates rows where sfdc_what_id IS NULL.
//   - Scope-locked: granola + non-deleted + suggestion's top candidate has
//     confidence_tier='likely' AND primary_record_type='Opportunity'.
//   - Dry-run by default: pass --commit to actually write.
//   - Leaves sfdc_record_type unchanged. The Coaching Usage resolver does
//     not depend on sfdc_record_type, and writing it could touch other
//     code paths that look at the (record_id, record_type) pair.

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const COMMIT = process.argv.includes('--commit');

async function main() {
  const url = process.env.SALES_COACHING_DATABASE_URL_UNPOOLED
    || process.env.SALES_COACHING_DATABASE_URL;
  if (!url) {
    console.error('SALES_COACHING_DATABASE_URL_UNPOOLED is required (see .env.local).');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    const eligibleSql = `
      SELECT cn.id,
             cn.call_started_at,
             (srm.sfdc_suggestion->'candidates'->0->>'what_id')           AS suggested_what_id,
             (srm.sfdc_suggestion->'candidates'->0->>'primary_label')     AS suggested_label,
             (srm.sfdc_suggestion->'candidates'->0->>'display_subtitle')  AS suggested_subtitle
      FROM call_notes cn
      JOIN slack_review_messages srm
        ON srm.call_note_id = cn.id AND srm.surface = 'dm'
      WHERE cn.source = 'granola'
        AND cn.source_deleted_at IS NULL
        AND cn.sfdc_what_id IS NULL
        AND srm.sfdc_suggestion IS NOT NULL
        AND (srm.sfdc_suggestion->'candidates'->0->>'confidence_tier')   = 'likely'
        AND (srm.sfdc_suggestion->'candidates'->0->>'primary_record_type') = 'Opportunity'
        AND (srm.sfdc_suggestion->'candidates'->0->>'what_id') IS NOT NULL
      ORDER BY cn.call_started_at DESC
    `;
    const { rows } = await pool.query(eligibleSql);
    console.log(`Eligible call_notes: ${rows.length}\n`);
    for (const r of rows) {
      console.log(`  ${r.id}  ${new Date(r.call_started_at).toISOString()}  → ${r.suggested_what_id}  (${r.suggested_label} — ${r.suggested_subtitle})`);
    }

    if (!COMMIT) {
      console.log('\nDry run — no changes written. Re-run with --commit to apply.');
      return;
    }
    if (rows.length === 0) {
      console.log('\nNothing to update.');
      return;
    }

    const updateSql = `
      UPDATE call_notes cn
      SET sfdc_what_id = (srm.sfdc_suggestion->'candidates'->0->>'what_id')
      FROM slack_review_messages srm
      WHERE srm.call_note_id = cn.id AND srm.surface = 'dm'
        AND cn.source = 'granola'
        AND cn.source_deleted_at IS NULL
        AND cn.sfdc_what_id IS NULL
        AND srm.sfdc_suggestion IS NOT NULL
        AND (srm.sfdc_suggestion->'candidates'->0->>'confidence_tier')   = 'likely'
        AND (srm.sfdc_suggestion->'candidates'->0->>'primary_record_type') = 'Opportunity'
        AND (srm.sfdc_suggestion->'candidates'->0->>'what_id') IS NOT NULL
      RETURNING cn.id, cn.sfdc_what_id
    `;
    const res = await pool.query(updateSql);
    console.log(`\nUpdated ${res.rowCount} row(s):`);
    for (const r of res.rows) console.log(`  ${r.id} → sfdc_what_id=${r.sfdc_what_id}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
