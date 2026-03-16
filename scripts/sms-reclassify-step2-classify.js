/**
 * Step 2: Classify unclassified SMS messages using Claude API
 *
 * Reads messages with classification_status = 'needs_classification' from
 * sms_intent_classified, batches them through Claude Haiku for intent
 * classification, and updates the table in place.
 *
 * Run: node scripts/sms-reclassify-step2-classify.js [--limit 1000] [--batch-size 50] [--dry-run]
 */

const { BigQuery } = require('@google-cloud/bigquery');
const Anthropic = require('@anthropic-ai/sdk');
const dotenv = require('dotenv');
const path = require('path');

// Load .env.local for ANTHROPIC_API_KEY
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const bigquery = new BigQuery({
  projectId: PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0', 10);
const BATCH_SIZE = parseInt(args.find((_, i, a) => a[i - 1] === '--batch-size') || '40', 10);

const VALID_INTENTS = [
  'Value Prop',
  'Scheduling/Logistics',
  'Nudge/Bump',
  'Rapport Building',
  'Objection Handling',
  'Other',
];

const SYSTEM_PROMPT = `You are classifying SMS messages sent by financial advisor recruiters (SGAs) at Savvy Wealth. Each message was sent to a financial advisor prospect.

Classify each message into EXACTLY ONE of these categories:
- Value Prop: Communicates benefits, differentiators, or value of Savvy's offering (equity, platform, support, payouts, independence)
- Scheduling/Logistics: Attempts to set a meeting, confirm timing, or coordinate next steps
- Nudge/Bump: Short follow-up to re-engage after silence ("just checking in", "circling back")
- Rapport Building: Personal connection, acknowledgment, congratulations, or relationship development
- Objection Handling: Addresses concerns, hesitations, or pushback from the prospect
- Other: Does not fit above categories, or insufficient content to classify

Rules:
- If a message contains BOTH a value prop AND a scheduling request, classify as "Value Prop" (the primary intent is selling)
- If a message is a simple "Hi [Name], [one line follow up]" with no substance, classify as "Nudge/Bump"
- Outbound messages from SGA should be classified by the SGA's intent
- Inbound messages from prospects should be classified by the prospect's intent

You will receive a JSON array of objects with "id" and "text" fields.
Respond with ONLY a JSON array of objects with "id" and "intent" fields. No other text.`;

async function main() {
  console.log('Step 2: Classifying unclassified SMS messages via Claude...');
  console.log(`  Batch size: ${BATCH_SIZE} | Limit: ${LIMIT || 'all'} | Dry run: ${DRY_RUN}\n`);

  // Fetch unclassified messages
  let sql = `
    SELECT task_id, clean_body, sms_type
    FROM \`savvy-gtm-analytics.savvy_analytics.sms_intent_classified\`
    WHERE classification_status = 'needs_classification'
    ORDER BY task_created_date DESC
  `;
  if (LIMIT > 0) sql += ` LIMIT ${LIMIT}`;

  console.log('Fetching unclassified messages...');
  const [rows] = await bigquery.query(sql);
  console.log(`  Found ${rows.length.toLocaleString()} messages to classify\n`);

  if (rows.length === 0) {
    console.log('Nothing to classify. Done.');
    return;
  }

  if (DRY_RUN) {
    console.log('Dry run — showing first 3 messages:');
    rows.slice(0, 3).forEach(r => console.log(`  [${r.task_id}] ${r.clean_body?.substring(0, 100)}`));
    return;
  }

  // Process in batches
  let classified = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

    try {
      const results = await classifyBatch(batch);

      if (results.length > 0) {
        await writeBatchResults(results);
        classified += results.length;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (classified / (elapsed || 1)).toFixed(1);
      process.stdout.write(
        `\r  Batch ${batchNum}/${totalBatches} | Classified: ${classified.toLocaleString()} | ` +
        `Errors: ${errors} | ${rate} msg/s | ${elapsed}s elapsed`
      );
    } catch (err) {
      errors++;
      console.error(`\n  Batch ${batchNum} error: ${err.message}`);

      // Rate limit — back off
      if (err.status === 429) {
        console.log('  Rate limited, waiting 30s...');
        await sleep(30000);
        i -= BATCH_SIZE; // retry this batch
      }
    }

    // Small delay between batches to avoid rate limits
    await sleep(200);
  }

  console.log(`\n\nDone. Classified ${classified.toLocaleString()} messages (${errors} errors).`);

  // Show updated status counts
  const [stats] = await bigquery.query(`
    SELECT classification_status, COUNT(*) AS cnt
    FROM \`savvy-gtm-analytics.savvy_analytics.sms_intent_classified\`
    GROUP BY classification_status
    ORDER BY cnt DESC
  `);
  console.log('\n--- Updated status distribution ---');
  for (const row of stats) {
    console.log(`  ${row.classification_status}: ${Number(row.cnt).toLocaleString()}`);
  }
}

async function classifyBatch(batch) {
  const input = batch.map(r => ({
    id: r.task_id,
    text: (r.clean_body || '').substring(0, 500), // cap length
  }));

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: JSON.stringify(input),
    }],
  });

  const text = response.content[0]?.text || '';

  // Parse JSON response — handle markdown code blocks
  const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error(`\n  Failed to parse response: ${text.substring(0, 200)}`);
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  // Validate intents
  return parsed
    .filter(r => r.id && r.intent)
    .map(r => ({
      task_id: r.id,
      sms_intent: VALID_INTENTS.includes(r.intent) ? r.intent : 'Other',
    }));
}

async function writeBatchResults(results) {
  // Update via MERGE statement
  // First, write results to a temp table, then merge
  const tempTableId = `_tmp_intent_batch_${Date.now()}`;
  const dataset = bigquery.dataset('savvy_analytics');
  const tempTable = dataset.table(tempTableId);

  // Create temp table
  await tempTable.create({
    schema: {
      fields: [
        { name: 'task_id', type: 'STRING' },
        { name: 'sms_intent', type: 'STRING' },
      ],
    },
  });

  // Insert batch results
  await tempTable.insert(results);

  // Merge into main table
  const mergeSql = `
    MERGE \`savvy-gtm-analytics.savvy_analytics.sms_intent_classified\` T
    USING \`savvy-gtm-analytics.savvy_analytics.${tempTableId}\` S
    ON T.task_id = S.task_id
    WHEN MATCHED THEN UPDATE SET
      T.sms_intent = S.sms_intent,
      T.classification_status = 'classified',
      T.classified_at = CURRENT_TIMESTAMP()
  `;

  const [job] = await bigquery.createQueryJob({ query: mergeSql });
  await job.getQueryResults();

  // Drop temp table
  await tempTable.delete();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
