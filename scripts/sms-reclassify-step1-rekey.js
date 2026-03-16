/**
 * Step 1: Re-key existing sms_intent_map classifications with task_id
 *
 * Creates savvy_analytics.sms_intent_classified by joining the existing
 * sms_intent_map (keyed on clean_body text) to the Task table, adding
 * task_id as the primary key for reliable joins.
 *
 * Run: node scripts/sms-reclassify-step1-rekey.js
 */

const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const bigquery = new BigQuery({
  projectId: PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

async function main() {
  console.log('Step 1: Re-keying existing sms_intent_map with task_id...\n');

  // Create the new table by joining Task → sms_intent_map on parsed message body
  const sql = `
    CREATE OR REPLACE TABLE \`savvy-gtm-analytics.savvy_analytics.sms_intent_classified\` AS
    WITH parsed_tasks AS (
      SELECT
        t.Id AS task_id,
        t.WhoId AS who_id,
        t.OwnerId AS owner_id,
        t.Type AS sms_type,
        t.CreatedDate AS task_created_date,
        TRIM(REGEXP_EXTRACT(t.Description, r'Message:\\s*(.+?)(?:\\n|$)')) AS clean_body
      FROM \`savvy-gtm-analytics.SavvyGTMData.Task\` t
      WHERE t.Type IN ('Outgoing SMS', 'Incoming SMS')
        AND t.Description IS NOT NULL
        AND t.IsDeleted = FALSE
    )
    SELECT
      p.task_id,
      p.who_id,
      p.owner_id,
      p.sms_type,
      p.task_created_date,
      p.clean_body,
      i.sms_intent,
      CASE
        WHEN i.sms_intent IS NOT NULL THEN 'existing'
        WHEN LENGTH(p.clean_body) < 15 THEN 'too_short'
        ELSE 'needs_classification'
      END AS classification_status,
      i.classified_at
    FROM parsed_tasks p
    LEFT JOIN \`savvy-gtm-analytics.savvy_analytics.sms_intent_map\` i
      ON p.clean_body = i.clean_body
  `;

  console.log('Creating sms_intent_classified table...');
  const [job] = await bigquery.createQueryJob({ query: sql });
  await job.getQueryResults();

  // Verify counts
  const [stats] = await bigquery.query(`
    SELECT
      classification_status,
      COUNT(*) AS cnt
    FROM \`savvy-gtm-analytics.savvy_analytics.sms_intent_classified\`
    GROUP BY classification_status
    ORDER BY cnt DESC
  `);

  console.log('\n--- sms_intent_classified created ---');
  let total = 0;
  for (const row of stats) {
    console.log(`  ${row.classification_status}: ${Number(row.cnt).toLocaleString()}`);
    total += Number(row.cnt);
  }
  console.log(`  TOTAL: ${total.toLocaleString()}`);

  // Show intent distribution for existing classifications
  const [intents] = await bigquery.query(`
    SELECT sms_intent, COUNT(*) AS cnt
    FROM \`savvy-gtm-analytics.savvy_analytics.sms_intent_classified\`
    WHERE classification_status = 'existing'
    GROUP BY sms_intent
    ORDER BY cnt DESC
  `);

  console.log('\n--- Existing intent distribution ---');
  for (const row of intents) {
    console.log(`  ${row.sms_intent}: ${Number(row.cnt).toLocaleString()}`);
  }

  console.log('\nStep 1 complete. Run step 2 to classify remaining messages.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
