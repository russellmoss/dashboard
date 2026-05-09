#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Verify that src/lib/sales-coaching-client/schemas.ts is byte-for-byte equal to
 * russellmoss/sales-coaching@main:src/lib/dashboard-api/schemas.ts.
 *
 * Sources upstream from (in priority order):
 *   1. SALES_COACHING_SCHEMAS_PATH env var → local file (fast path for sibling-repo dev)
 *   2. SALES_COACHING_SCHEMAS_GH_RAW_URL env var → custom URL override
 *   3. Default GH raw URL (russellmoss/sales-coaching@main) — needs GH_TOKEN/GITHUB_TOKEN if repo is private
 *
 * Skip entirely with SKIP_SCHEMA_MIRROR_CHECK=1 (do not use in CI).
 *
 * Exit codes:
 *   0 — byte-equal (or skipped)
 *   1 — drift detected
 *   2 — fetch/IO failure
 */

const { readFileSync } = require('fs');
const path = require('path');
const https = require('https');

const REPO = 'russellmoss/sales-coaching';
const BRANCH = 'master';
const REL_PATH = 'src/lib/dashboard-api/schemas.ts';
const DEFAULT_RAW_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${REL_PATH}`;

const localPath = path.resolve(__dirname, '..', 'src/lib/sales-coaching-client/schemas.ts');

function readLocal() {
  try {
    return readFileSync(localPath, 'utf8');
  } catch (err) {
    console.error(`Could not read local mirror at ${localPath}: ${err.message}`);
    process.exit(2);
  }
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'check-schema-mirror' };
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `token ${token}`;

    https
      .get(url, { headers }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // Follow one redirect (GH raw can redirect to assets host)
          const next = res.headers.location;
          if (!next) return reject(new Error(`Redirect with no Location header (${res.statusCode}).`));
          return resolve(fetchUrl(next));
        }
        if (res.statusCode !== 200) {
          return reject(
            new Error(
              `GH raw fetch failed: ${res.statusCode} ${res.statusMessage}. ` +
                (process.env.GH_TOKEN || process.env.GITHUB_TOKEN
                  ? 'Token is set but request was rejected — verify token has repo access.'
                  : 'Set GH_TOKEN or GITHUB_TOKEN env var (private repo). ' +
                    'Or set SALES_COACHING_SCHEMAS_PATH to a local sibling-repo file path for offline runs.'),
            ),
          );
        }
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

async function fetchUpstream() {
  if (process.env.SKIP_SCHEMA_MIRROR_CHECK) {
    console.log('Schema mirror check skipped (SKIP_SCHEMA_MIRROR_CHECK=1).');
    process.exit(0);
  }

  if (process.env.SALES_COACHING_SCHEMAS_PATH) {
    return readFileSync(process.env.SALES_COACHING_SCHEMAS_PATH, 'utf8');
  }

  const url = process.env.SALES_COACHING_SCHEMAS_GH_RAW_URL || DEFAULT_RAW_URL;
  return fetchUrl(url);
}

(async () => {
  const local = readLocal();
  let upstream;
  try {
    upstream = await fetchUpstream();
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  if (local === upstream) {
    console.log(`Schema mirror byte-equal with ${REPO}@${BRANCH}:${REL_PATH} ✓`);
    process.exit(0);
  }

  console.error(`Schema mirror DRIFT detected vs ${REPO}@${BRANCH}:${REL_PATH}.`);
  console.error('');
  console.error('Local:    src/lib/sales-coaching-client/schemas.ts');
  console.error(`Upstream: ${REPO}@${BRANCH}:${REL_PATH}`);
  console.error('');
  console.error('Fix:');
  console.error('  In Claude Code:  /sync-bridge-schema');
  console.error('  Or manually:     curl -L -H "Authorization: token $GH_TOKEN" \\');
  console.error(`                       "${DEFAULT_RAW_URL}" \\`);
  console.error('                       > src/lib/sales-coaching-client/schemas.ts');
  console.error('  Then re-run:     npm run check:schema-mirror');
  process.exit(1);
})();
