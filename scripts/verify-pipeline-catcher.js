/**
 * Phase 8: Pipeline Catcher – Testing & Verification
 *
 * Runs:
 * - File/directory existence checks
 * - BigQuery verification query (SQO counts by quarter)
 * - Optional: API route availability (expect 401 when unauthenticated)
 *
 * Usage:
 *   node scripts/verify-pipeline-catcher.js
 *   node scripts/verify-pipeline-catcher.js --api   # also hit API routes (dev server must be running)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI';
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const FULL_TABLE = `${PROJECT_ID}.Tableau_Views.vw_funnel_master`;

const REQUIRED_PATHS = [
  'src/types/game.ts',
  'src/config/game-constants.ts',
  'src/lib/queries/pipeline-catcher.ts',
  'src/app/api/games/pipeline-catcher/levels/route.ts',
  'src/app/api/games/pipeline-catcher/play/[quarter]/route.ts',
  'src/app/api/games/pipeline-catcher/leaderboard/route.ts',
  'src/components/games/pipeline-catcher/hooks/useGameAudio.ts',
  'src/components/games/pipeline-catcher/LevelSelect.tsx',
  'src/components/games/pipeline-catcher/GameCanvas.tsx',
  'src/components/games/pipeline-catcher/GameOver.tsx',
  'src/components/games/pipeline-catcher/PipelineCatcher.tsx',
  'src/components/games/pipeline-catcher/index.ts',
  'src/app/dashboard/games/pipeline-catcher/page.tsx',
  'public/games/pipeline-catcher/audio/menu-music.mp3',
  'public/games/pipeline-catcher/audio/gameplay-music.mp3',
  'public/games/pipeline-catcher/audio/gameover-music.mp3',
  'public/games/pipeline-catcher/images/lobby-bg.png',
];

async function checkFiles() {
  console.log('\n📁 File & directory checks\n');
  let ok = 0;
  let fail = 0;
  for (const p of REQUIRED_PATHS) {
    const full = path.join(process.cwd(), p);
    const exists = fs.existsSync(full);
    console.log(`  ${exists ? '✅' : '❌'} ${p}`);
    if (exists) ok++;
    else fail++;
  }
  return { ok, fail };
}

async function runBigQueryVerification() {
  console.log('\n📊 BigQuery verification (SQO counts by quarter)\n');
  const creds = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!creds) {
    console.log('  ⚠️  No BigQuery credentials – skipping. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_JSON.');
    return { skipped: true };
  }
  try {
    const { BigQuery } = require('@google-cloud/bigquery');
    const bq = new BigQuery({
      projectId: PROJECT_ID,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || undefined,
    });
    const [rows] = await bq.query({
      query: `
        SELECT
          FORMAT_DATE('%Y-Q%Q', DATE(Date_Became_SQO__c)) AS quarter,
          COUNT(*) AS sqo_count
        FROM \`${FULL_TABLE}\`
        WHERE is_sqo_unique = 1
          AND recordtypeid = @recruitingRecordType
          AND DATE(Date_Became_SQO__c) >= @startDate
        GROUP BY quarter
        ORDER BY quarter DESC
      `,
      params: { recruitingRecordType: RECRUITING_RECORD_TYPE, startDate: '2025-01-01' },
    });
    console.log('  Quarter    | SQO count');
    console.log('  -----------|----------');
    for (const r of rows) {
      console.log(`  ${r.quarter}   | ${r.sqo_count}`);
    }
    console.log(`\n  ✅ ${rows.length} quarter(s) with SQO data`);
    return { ok: true, rows: rows.length };
  } catch (e) {
    console.log(`  ❌ BigQuery error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

async function checkApiRoutes() {
  console.log('\n🌐 API route checks (expect 401 when unauthenticated)\n');
  const base = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const endpoints = [
    { url: `${base}/api/games/pipeline-catcher/levels`, name: 'GET /levels' },
    { url: `${base}/api/games/pipeline-catcher/play/2025-Q1`, name: 'GET /play/2025-Q1' },
    { url: `${base}/api/games/pipeline-catcher/leaderboard?quarter=2025-Q1`, name: 'GET /leaderboard' },
  ];
  let ok = 0;
  let fail = 0;
  for (const { url, name } of endpoints) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const body = await res.text();
      const is401 = res.status === 401;
      const hasJson = body.startsWith('{');
      const msg = is401 && hasJson ? '401 Unauthorized (expected)' : `status ${res.status}`;
      console.log(`  ${is401 && hasJson ? '✅' : '❌'} ${name}: ${msg}`);
      if (is401 && hasJson) ok++;
      else fail++;
    } catch (e) {
      console.log(`  ❌ ${name}: ${e.message}`);
      fail++;
    }
  }
  return { ok, fail };
}

async function main() {
  console.log('═'.repeat(60));
  console.log('  Pipeline Catcher – Phase 8 Verification');
  console.log('═'.repeat(60));

  const fileResult = await checkFiles();
  const bqResult = await runBigQueryVerification();
  const checkApi = process.argv.includes('--api');
  let apiResult = null;
  if (checkApi) {
    apiResult = await checkApiRoutes();
  } else {
    console.log('\n🌐 API route checks skipped (run with --api; dev server must be running)');
  }

  console.log('\n' + '─'.repeat(60));
  console.log('  Summary');
  console.log('─'.repeat(60));
  console.log(`  Files:    ${fileResult.ok} OK, ${fileResult.fail} missing`);
  if (bqResult.skipped) {
    console.log('  BigQuery: skipped (no credentials)');
  } else {
    console.log(`  BigQuery: ${bqResult.ok ? 'OK' : 'failed'}`);
  }
  if (apiResult) {
    console.log(`  API:      ${apiResult.ok} OK, ${apiResult.fail} failed`);
  }
  console.log('');

  const success = fileResult.fail === 0 && (bqResult.skipped || bqResult.ok) && (!apiResult || apiResult.fail === 0);
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error('\n💥', err);
  process.exit(1);
});
