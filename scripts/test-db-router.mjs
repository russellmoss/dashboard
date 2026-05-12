#!/usr/bin/env node
// scripts/test-db-router.mjs
//
// Harness for the /auto-feature DB Router (Phase 0.5).
//
// Runs ONLY the router logic and prompt-construction step. Does NOT spawn
// Phase 1 exploration agents and does NOT execute Phases 2-4.
//
// Usage:
//   node scripts/test-db-router.mjs "<feature description>"
//   node scripts/test-db-router.mjs --decision <path-to-yaml> "<feature>"
//
// Modes:
//   default:          invokes `claude -p` (Claude Code headless) with the
//                     router classification prompt, captures YAML stdout,
//                     parses it, constructs the three teammate prompts.
//   --decision <p>:   skips the LLM classifier; reads decision YAML from
//                     the given path. Useful for deterministic prompt-
//                     construction testing.
//
// Output (to stdout, in order):
//   1. The `db-router-decision.md` content (YAML block).
//   2. The three constructed Phase 1 teammate prompts under headers
//      "=== code-inspector prompt ===", "=== data-verifier prompt ===",
//      "=== pattern-finder prompt ===".
//
// Exit codes: 0 = success, non-zero = error.

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.cwd());
const DOC_HEADS = {
  bigquery: '.claude/bq-views.md',
  neon_savvy_dashboard: '.claude/neon-savvy-dashboard.md',
  neon_sales_coaching: '.claude/neon-sales-coaching.md',
};
const HEAD_LINES = 150;

// ---------- CLI parsing ----------
const argv = process.argv.slice(2);
let decisionPath = null;
let feature = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--decision') {
    decisionPath = argv[i + 1];
    i++;
  } else if (a.startsWith('--')) {
    fail(`Unknown flag: ${a}`);
  } else if (feature === null) {
    feature = a;
  } else {
    fail(`Unexpected positional argument: ${a}`);
  }
}
if (!feature) fail('Usage: node scripts/test-db-router.mjs [--decision <path>] "<feature description>"');

// ---------- Read doc heads ----------
function readHead(relPath) {
  const full = join(ROOT, relPath);
  if (!existsSync(full)) fail(`Missing context doc: ${relPath}`);
  const lines = readFileSync(full, 'utf8').split(/\r?\n/);
  return lines.slice(0, HEAD_LINES).join('\n');
}

// ---------- Classifier (via claude -p) ----------
function classifyViaClaude(featureText) {
  const heads = Object.fromEntries(
    Object.entries(DOC_HEADS).map(([k, p]) => [k, readHead(p)])
  );

  const sysPrompt = `You are the /auto-feature DB Router. Decide which databases a feature touches based on the doc heads provided. Output ONLY a valid YAML block (no prose, no markdown fences) matching the exact shape requested.`;

  const userPrompt = `Feature: "${featureText}"

Use these doc heads (At a Glance + Domain Map) as ground truth:

=== .claude/bq-views.md (head) ===
${heads.bigquery}

=== .claude/neon-savvy-dashboard.md (head) ===
${heads.neon_savvy_dashboard}

=== .claude/neon-sales-coaching.md (head) ===
${heads.neon_sales_coaching}

Output a single YAML document with this exact shape. Emit preread_paths and mcp_tools entries ONLY for in-scope DBs. If zero DBs are in scope, use empty mappings ({}). Do NOT wrap in code fences.

feature: "<verbatim feature description>"
databases:
  bigquery:
    in_scope: true|false
    reason: "<one sentence>"
  neon_savvy_dashboard:
    in_scope: true|false
    reason: "<one sentence>"
  neon_sales_coaching:
    in_scope: true|false
    reason: "<one sentence>"
preread_paths:
  # only in-scope DBs (omit out-of-scope keys)
  # bigquery: [.claude/bq-views.md, .claude/bq-field-dictionary.md, .claude/bq-patterns.md, .claude/bq-activity-layer.md, .claude/bq-salesforce-mapping.md]
  # neon_savvy_dashboard: [.claude/neon-savvy-dashboard.md]
  # neon_sales_coaching: [.claude/neon-sales-coaching.md]
mcp_tools:
  # only in-scope DBs (omit out-of-scope keys)
  # bigquery: [schema-context.describe_view, schema-context.get_rule, schema-context.get_metric, schema-context.resolve_term, schema-context.lint_query]
  # neon_savvy_dashboard: [mcp__Neon__describe_table_schema]
  # neon_sales_coaching: [mcp__Neon__describe_table_schema]
`;

  const fullPrompt = `${sysPrompt}\n\n${userPrompt}`;
  // Pipe prompt via stdin, not argv: Windows CreateProcessW caps the command
  // line at ~32K UTF-16 chars, and the doc-head payload exceeds that.
  const result = spawnSync('claude', ['-p'], {
    input: fullPrompt,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const code = result.error?.code ? ` [${result.error.code}]` : '';
    const errMsg = result.error?.message || result.stderr || result.stdout || '(no output)';
    fail(`claude -p failed (exit ${result.status})${code}: ${errMsg}`);
  }
  return result.stdout.trim();
}

// ---------- Minimal YAML parser (only what we need) ----------
// Spec is tightly controlled — a small hand parser is more robust than adding js-yaml.
function parseDecision(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const out = {
    feature: '',
    databases: {
      bigquery: { in_scope: false, reason: '' },
      neon_savvy_dashboard: { in_scope: false, reason: '' },
      neon_sales_coaching: { in_scope: false, reason: '' },
    },
    preread_paths: {},
    mcp_tools: {},
  };
  let section = null;     // 'databases' | 'preread_paths' | 'mcp_tools' | null
  let currentDb = null;   // 'bigquery' | 'neon_savvy_dashboard' | 'neon_sales_coaching'
  let listFor = null;     // when accumulating list items under preread_paths/mcp_tools

  const stripFenceLine = (l) => l.replace(/^```yaml\s*$/, '').replace(/^```\s*$/, '');

  for (let raw of lines) {
    const line = stripFenceLine(raw);
    if (!line.trim()) continue;
    if (line.trim().startsWith('#')) continue;

    // top-level: feature, databases:, preread_paths:, mcp_tools:
    if (/^feature:\s*/.test(line)) {
      out.feature = line.replace(/^feature:\s*/, '').replace(/^["']|["']$/g, '');
      section = null; currentDb = null; listFor = null;
      continue;
    }
    if (/^databases:\s*$/.test(line)) { section = 'databases'; currentDb = null; listFor = null; continue; }
    if (/^preread_paths:\s*(\{\s*\})?\s*$/.test(line)) { section = 'preread_paths'; currentDb = null; listFor = null; continue; }
    if (/^mcp_tools:\s*(\{\s*\})?\s*$/.test(line)) { section = 'mcp_tools'; currentDb = null; listFor = null; continue; }

    if (section === 'databases') {
      const dbMatch = line.match(/^  (bigquery|neon_savvy_dashboard|neon_sales_coaching):\s*$/);
      if (dbMatch) { currentDb = dbMatch[1]; continue; }
      const inScopeMatch = line.match(/^    in_scope:\s*(true|false)\s*$/);
      if (inScopeMatch && currentDb) { out.databases[currentDb].in_scope = inScopeMatch[1] === 'true'; continue; }
      const reasonMatch = line.match(/^    reason:\s*(.*)$/);
      if (reasonMatch && currentDb) {
        out.databases[currentDb].reason = reasonMatch[1].replace(/^["']|["']$/g, '');
        continue;
      }
      continue;
    }

    if (section === 'preread_paths' || section === 'mcp_tools') {
      const dbKeyMatch = line.match(/^  (bigquery|neon_savvy_dashboard|neon_sales_coaching):\s*(.*)$/);
      if (dbKeyMatch) {
        listFor = dbKeyMatch[1];
        out[section][listFor] = [];
        // inline list (e.g., bigquery: [a, b, c])
        const inline = dbKeyMatch[2].trim();
        if (inline.startsWith('[') && inline.endsWith(']')) {
          const items = inline.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
          out[section][listFor] = items;
          listFor = null;
        }
        continue;
      }
      const itemMatch = line.match(/^    -\s*(.+)\s*$/);
      if (itemMatch && listFor) {
        out[section][listFor].push(itemMatch[1].trim().replace(/^["']|["']$/g, ''));
        continue;
      }
    }
  }
  return out;
}

// ---------- Prompt construction ----------
function constructPrompts(decision, decisionYamlText, featureText) {
  const inScopeDbs = Object.entries(decision.databases)
    .filter(([, v]) => v.in_scope)
    .map(([k]) => k);

  const allPrereads = [];
  const allMcpTools = [];
  for (const db of inScopeDbs) {
    for (const p of (decision.preread_paths[db] || [])) {
      if (!allPrereads.includes(p)) allPrereads.push(p);
    }
    for (const t of (decision.mcp_tools[db] || [])) {
      if (!allMcpTools.includes(t)) allMcpTools.push(t);
    }
  }

  // Full decision YAML (for data-verifier — sees MCP tools)
  const fullYamlBody = decisionYamlText.replace(/^```yaml\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const fullDecisionBlock = `\`\`\`yaml\n${fullYamlBody}\n\`\`\``;

  // Redacted decision YAML (for code-inspector and pattern-finder — must contain no MCP tool references).
  // Strip the entire `mcp_tools:` block so tool names never appear in those agents' prompts.
  function stripMcpToolsBlock(yamlBody) {
    const lines = yamlBody.split(/\r?\n/);
    const out = [];
    let inMcp = false;
    for (const line of lines) {
      if (/^mcp_tools:\s*(\{\s*\})?\s*$/.test(line)) { inMcp = true; continue; }
      if (inMcp) {
        // Stop skipping once we hit a top-level key (no indent) that isn't part of mcp_tools.
        if (/^[A-Za-z_]/.test(line)) { inMcp = false; out.push(line); continue; }
        continue; // skip indented mcp_tools lines
      }
      out.push(line);
    }
    return out.join('\n').replace(/\n+$/, '');
  }
  const redactedDecisionBlock = `\`\`\`yaml\n${stripMcpToolsBlock(fullYamlBody)}\n\`\`\``;

  // Per-agent instruction lines
  const codeInspectorInstr = allPrereads.length === 0
    ? 'No database context required for this feature.'
    : `Pre-read these files before investigating: ${allPrereads.join(', ')}. Do not default to other context sources unless none are listed.`;

  const patternFinderInstr = codeInspectorInstr;

  let dataVerifierInstr;
  if (allPrereads.length === 0 && allMcpTools.length === 0) {
    dataVerifierInstr = 'No database context required for this feature.';
  } else {
    dataVerifierInstr =
      `Use these MCP tools as primary schema context: ${allMcpTools.join(', ') || '(none)'}. ` +
      `Fall back to these pre-read paths if MCP is unavailable or incomplete: ${allPrereads.join(', ') || '(none)'}. ` +
      `Do not use any MCP tool or context source that is not listed above for the database investigation portion of this task.`;
  }

  // DB Context block builder — agents without MCP access see the redacted YAML.
  function buildDbContextBlock(instr, { redactMcp }) {
    const block = redactMcp ? redactedDecisionBlock : fullDecisionBlock;
    return `## DB Context (from Phase 0.5 router)\n\n${block}\n\n${instr}\n`;
  }

  const codeInspectorPrompt = `${buildDbContextBlock(codeInspectorInstr, { redactMcp: true })}
## Task

Investigate the codebase for the following feature: ${featureText}

Find:
- Every TypeScript type/interface that needs new fields
- Every file that CONSTRUCTS objects of those types (construction sites)
- Every query function, API route, and component that needs changes
- Both export paths: ExportButton (auto via Object.keys) and ExportMenu/MetricDrillDownModal (explicit column mappings)
- Any components that manually construct typed records from raw data (e.g., ExploreResults.tsx drilldown handler)

If what you find in the code contradicts the pre-read docs (when applicable), trust the code, proceed with what the code shows, and note the discrepancy in your findings.

Save findings to \`code-inspector-findings.md\` in the project root.`;

  const dataVerifierPrompt = `${buildDbContextBlock(dataVerifierInstr, { redactMcp: false })}
## Task

Verify the data layer for the following feature: ${featureText}

For every in-scope database listed in the DB Context block, do the following work using the listed MCP tools as primary:
- Confirm source fields, tables, or columns exist in the relevant views or schemas.
- Run appropriate data-quality checks against in-scope sources: existence, population rate (\`COUNTIF(field IS NOT NULL) / COUNT(*)\` style or equivalent), value distribution, max-length on text fields, and edge cases (NULLs, empty strings, newlines, special characters). Sample JSONB shapes when the in-scope schema exposes them.
- Always use parameterized queries — never string interpolation.
- If a schema modification or migration is needed in any in-scope source, document exactly what needs to change and flag it as a blocker.

Do NOT investigate or query databases that are out of scope per the DB Context block.

Save findings to \`data-verifier-findings.md\` in the project root.`;

  const patternFinderPrompt = `${buildDbContextBlock(patternFinderInstr, { redactMcp: true })}
## Task

Find implementation patterns for the following feature: ${featureText}

Trace how existing similar fields flow end-to-end, for the in-scope data source(s) only:
- Data source (per DB Context block) → query function SELECT → transform → return type → API route → component → export/CSV
- Document date handling patterns: \`extractDate()\` vs \`extractDateValue()\` — which files use which
- Document NULL handling and type coercion patterns for the in-scope data sources (e.g., the wrapper helpers used to coerce raw query output to typed records)
- Document CSV export column mapping patterns for both export paths
- Flag any inconsistencies between files that should follow the same pattern

Save findings to \`pattern-finder-findings.md\` in the project root.`;

  return { codeInspectorPrompt, dataVerifierPrompt, patternFinderPrompt };
}

// ---------- Helpers ----------
function fail(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(2);
}

function ensureFenced(yamlText) {
  // If the LLM emitted raw YAML without fences, wrap it.
  const trimmed = yamlText.trim();
  if (trimmed.startsWith('```')) return trimmed;
  return '```yaml\n' + trimmed + '\n```';
}

// ---------- Main ----------
let decisionYamlText;
if (decisionPath) {
  const full = resolve(decisionPath);
  if (!existsSync(full)) fail(`--decision file not found: ${decisionPath}`);
  decisionYamlText = readFileSync(full, 'utf8').trim();
} else {
  decisionYamlText = classifyViaClaude(feature);
}

decisionYamlText = ensureFenced(decisionYamlText);
const inner = decisionYamlText.replace(/^```yaml\s*\n?/, '').replace(/\n?```\s*$/, '');
const decision = parseDecision(inner);

const { codeInspectorPrompt, dataVerifierPrompt, patternFinderPrompt } = constructPrompts(
  decision, decisionYamlText, decision.feature || feature
);

process.stdout.write('=== db-router-decision.md ===\n');
process.stdout.write(decisionYamlText + '\n\n');
process.stdout.write('=== code-inspector prompt ===\n');
process.stdout.write(codeInspectorPrompt + '\n\n');
process.stdout.write('=== data-verifier prompt ===\n');
process.stdout.write(dataVerifierPrompt + '\n\n');
process.stdout.write('=== pattern-finder prompt ===\n');
process.stdout.write(patternFinderPrompt + '\n');
process.exit(0);
