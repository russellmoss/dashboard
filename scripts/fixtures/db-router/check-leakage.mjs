#!/usr/bin/env node
// Regression suite for the /auto-feature DB Router (deterministic --decision mode).
//
// For each case<N>.yaml fixture:
//   1. Invoke `node scripts/test-db-router.mjs --decision <yaml> "<feature>"`,
//      capture stdout to case<N>.out (overwrites the prior capture).
//   2. Assert four properties on the captured output:
//      - classification flags match the expected in-scope matrix
//      - P1: data-verifier prompt has no BQ leakage when BQ is out of scope
//      - P2: data-verifier prompt has no Neon leakage when both Neon DBs are out of scope
//      - P3: code-inspector + pattern-finder prompts have zero MCP tool references
//
// This is deterministic — it skips the live LLM classifier. The YAML fixtures
// ARE the decisions; the test exercises only the prompt-construction path.
// Run it any time the harness, the doc heads, or the router prompt changes.
//
// Exit 0 = all 6 cases pass; non-zero = any failure (CI-friendly).

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(FIXTURES_DIR, '..', '..', '..');
const HARNESS = resolve(REPO_ROOT, 'scripts', 'test-db-router.mjs');

const cases = [
  { n: 1, bq: false, sd: false, sc: true  },
  { n: 2, bq: true,  sd: false, sc: false },
  { n: 3, bq: false, sd: true,  sc: false },
  { n: 4, bq: false, sd: false, sc: true  },
  { n: 5, bq: true,  sd: false, sc: true  },
  { n: 6, bq: false, sd: true,  sc: false },
];

const BQ_LEAK_TOKENS = ['schema-context', 'vw_funnel_master', '.claude/bq-'];
const NEON_LEAK_TOKENS = ['mcp__Neon__describe_table_schema', '.claude/neon-'];
const MCP_TOOL_TOKENS = ['mcp__Neon__describe_table_schema', 'schema-context.', 'mcp__', 'schema-context'];

function extractFeature(yamlText) {
  const m = yamlText.match(/^feature:\s*"([^"]*)"/m);
  return m ? m[1] : 'fixture';
}

function splitSections(text) {
  const parts = {};
  const re = /^=== (.+?) ===\n/gm;
  const matches = [...text.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i][1];
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    parts[name] = text.slice(start, end);
  }
  return parts;
}

function findHits(text, tokens) {
  return tokens.filter(t => text.includes(t));
}

function regenerate(caseNum) {
  const yamlPath = resolve(FIXTURES_DIR, `case${caseNum}.yaml`);
  const outPath = resolve(FIXTURES_DIR, `case${caseNum}.out`);
  const yamlText = readFileSync(yamlPath, 'utf8');
  const feature = extractFeature(yamlText);
  const result = spawnSync(
    process.execPath,
    [HARNESS, '--decision', yamlPath, feature],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  if (result.error || result.status !== 0) {
    const code = result.error?.code ? ` [${result.error.code}]` : '';
    const msg = result.error?.message || result.stderr || '(no output)';
    throw new Error(`Harness failed for case${caseNum}${code}: ${msg}`);
  }
  writeFileSync(outPath, result.stdout);
  return result.stdout;
}

const results = [];

for (const c of cases) {
  let text;
  try {
    text = regenerate(c.n);
  } catch (e) {
    results.push({ case: c.n, allPass: false, checks: [{ name: 'regenerate', pass: false, detail: e.message }] });
    continue;
  }

  const sections = splitSections(text);
  const dec = sections['db-router-decision.md'] || '';
  const ci = sections['code-inspector prompt'] || '';
  const dv = sections['data-verifier prompt'] || '';
  const pf = sections['pattern-finder prompt'] || '';

  const checks = [];

  const bqInScope = /bigquery:\s*\n\s*in_scope:\s*true/.test(dec);
  const sdInScope = /neon_savvy_dashboard:\s*\n\s*in_scope:\s*true/.test(dec);
  const scInScope = /neon_sales_coaching:\s*\n\s*in_scope:\s*true/.test(dec);
  checks.push({
    name: 'classification',
    pass: bqInScope === c.bq && sdInScope === c.sd && scInScope === c.sc,
    detail: `expected bq=${c.bq} sd=${c.sd} sc=${c.sc}; got bq=${bqInScope} sd=${sdInScope} sc=${scInScope}`,
  });

  if (!c.bq) {
    const hits = findHits(dv, BQ_LEAK_TOKENS);
    checks.push({ name: 'P1 no BQ leak in data-verifier', pass: hits.length === 0, detail: hits.length ? `hits: ${hits.join(', ')}` : 'clean' });
  } else {
    checks.push({ name: 'P1 no BQ leak in data-verifier', pass: true, detail: 'BQ in scope — N/A' });
  }

  if (!c.sd && !c.sc) {
    const hits = findHits(dv, NEON_LEAK_TOKENS);
    checks.push({ name: 'P2 no Neon leak in data-verifier', pass: hits.length === 0, detail: hits.length ? `hits: ${hits.join(', ')}` : 'clean' });
  } else {
    checks.push({ name: 'P2 no Neon leak in data-verifier', pass: true, detail: 'a Neon DB in scope — N/A' });
  }

  {
    const hits = findHits(ci, MCP_TOOL_TOKENS);
    checks.push({ name: 'P3 no MCP refs in code-inspector', pass: hits.length === 0, detail: hits.length ? `hits: ${hits.join(', ')}` : 'clean' });
  }

  {
    const hits = findHits(pf, MCP_TOOL_TOKENS);
    checks.push({ name: 'P3 no MCP refs in pattern-finder', pass: hits.length === 0, detail: hits.length ? `hits: ${hits.join(', ')}` : 'clean' });
  }

  const allPass = checks.every(ch => ch.pass);
  results.push({ case: c.n, allPass, checks });
}

let any_fail = false;
console.log('\n=== DB Router Regression Suite ===\n');
for (const r of results) {
  console.log(`Case ${r.case}: ${r.allPass ? 'PASS' : 'FAIL'}`);
  for (const ch of r.checks) {
    console.log(`  ${ch.pass ? 'PASS' : 'FAIL'} - ${ch.name} (${ch.detail})`);
    if (!ch.pass) any_fail = true;
  }
}
console.log('\n=== Summary ===');
console.log(any_fail ? 'OVERALL: FAIL' : 'OVERALL: PASS — all 6 cases meet acceptance criteria');
process.exit(any_fail ? 1 : 0);
