'use strict';
/**
 * generate-env-inventory.cjs
 * Reads .env.example and scans src/ for process.env references,
 * then produces docs/_generated/env-vars.md
 * Run with: node scripts/generate-env-inventory.cjs
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(PROJECT_ROOT, '.env.example');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const OUTPUT_FILE = path.join(PROJECT_ROOT, 'docs', '_generated', 'env-vars.md');

// ── Category mapping ─────────────────────────────────────────────────────────

const CATEGORY_RULES = [
  { prefix: 'NEXTAUTH_',            category: 'Auth (NextAuth)' },
  { prefix: 'GOOGLE_CLIENT_',       category: 'Auth (Google OAuth)' },
  { prefix: 'DATABASE_',            category: 'Database' },
  { prefix: 'GCP_',                 category: 'BigQuery / GCP' },
  { prefix: 'GOOGLE_APPLICATION_',  category: 'BigQuery / GCP' },
  { prefix: 'GOOGLE_SHEETS_',       category: 'Google Sheets Export' },
  { prefix: 'GC_',                  category: 'GC Hub (Google Sheets IDs)' },
  { prefix: 'ANTHROPIC_',           category: 'AI (Anthropic)' },
  { prefix: 'CRON_',                category: 'Cron Jobs' },
  { prefix: 'SENDGRID_',            category: 'Email (SendGrid)' },
  { prefix: 'EMAIL_',               category: 'Email (SendGrid)' },
  { prefix: 'UPSTASH_',             category: 'Rate Limiting (Upstash)' },
  { prefix: 'SENTRY_',              category: 'Error Monitoring (Sentry)' },
  { prefix: 'NEXT_PUBLIC_SENTRY_',  category: 'Error Monitoring (Sentry)' },
  { prefix: 'WRIKE_',               category: 'Wrike Integration' },
  { prefix: 'METABASE_',            category: 'Metabase (Chart Builder)' },
  { prefix: 'NEXT_PUBLIC_METABASE_',category: 'Metabase (Chart Builder)' },
  { prefix: 'NEXT_PUBLIC_',         category: 'Next.js Public' },
];

function getCategory(name) {
  // Sort rules by prefix length descending to match most-specific first
  const sorted = CATEGORY_RULES.slice().sort((a, b) => b.prefix.length - a.prefix.length);
  for (const rule of sorted) {
    if (name.startsWith(rule.prefix)) return rule.category;
  }
  return 'Other';
}

// ── Parse .env.example ───────────────────────────────────────────────────────

function parseEnvFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const vars = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comment lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const name = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    // Must be a valid env var name (all caps, underscores, digits)
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;

    const hasValue = value.length > 0;
    // Detect placeholder vs real default
    const isPlaceholder = hasValue && (
      value.startsWith('your-') ||
      value.startsWith('sk-ant-') ||
      value.includes('YOUR_') ||
      value.includes('xxxx') ||
      value.includes('your_') ||
      value === 'http://localhost:3000' ||
      value.startsWith('https://your-') ||
      value.startsWith('SG.xxxx') ||
      value.endsWith('-here') ||
      value.includes('@yourcompany.com')
    );

    vars.push({
      name,
      value,
      hasValue,
      isPlaceholder,
      category: getCategory(name),
    });
  }

  return vars;
}

// ── Scan src/ for process.env references ────────────────────────────────────

function getAllSourceFiles(dir) {
  const results = [];
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return results;
  }
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...getAllSourceFiles(fullPath));
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(item.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function scanProcessEnvRefs(srcDir) {
  const files = getAllSourceFiles(srcDir);
  const refs = new Map(); // varName → Set of file paths

  const pattern = /process\.env\.([A-Z][A-Z0-9_]*)/g;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const varName = match[1];
      if (!refs.has(varName)) refs.set(varName, new Set());
      const relPath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
      refs.get(varName).add(relPath);
    }
    pattern.lastIndex = 0; // Reset regex state
  }

  return refs;
}

// ── Main ────────────────────────────────────────────────────────────────────

const envVars = parseEnvFile(ENV_FILE);
const envVarNames = new Set(envVars.map(v => v.name));
const codeRefs = scanProcessEnvRefs(SRC_DIR);

// Mark which env vars are referenced in code
for (const v of envVars) {
  v.inCode = codeRefs.has(v.name);
}

// Find undocumented refs (in code but not in .env.example)
const undocumented = [];
for (const [varName, files] of codeRefs.entries()) {
  if (!envVarNames.has(varName)) {
    undocumented.push({ name: varName, files: [...files].sort() });
  }
}
undocumented.sort((a, b) => a.name.localeCompare(b.name));

// Group by category
const categories = {};
for (const v of envVars) {
  if (!categories[v.category]) categories[v.category] = [];
  categories[v.category].push(v);
}

// Build markdown
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
const totalVars = envVars.length;
const totalCodeRefs = codeRefs.size;

let md = `# Environment Variables Inventory (Auto-Generated)\n\n`;
md += `> This file is auto-generated by \`npm run gen:env\`. Do not edit manually.\n`;
md += `> Generated: ${now}\n`;
md += `> Total: ${totalVars} variables in .env.example, ${totalCodeRefs} unique \`process.env\` references in \`src/\`\n\n`;

// Table of all env vars grouped by category
md += `## Variables by Category\n\n`;
md += `| Variable | Category | Has Value | In Code |\n`;
md += `|----------|----------|-----------|--------|\n`;

for (const [catName, catVars] of Object.entries(categories)) {
  for (const v of catVars) {
    const hasValueStr = v.hasValue ? (v.isPlaceholder ? 'placeholder' : 'default') : 'empty';
    const inCodeStr = v.inCode ? '✓' : '—';
    md += `| \`${v.name}\` | ${catName} | ${hasValueStr} | ${inCodeStr} |\n`;
  }
}

md += '\n';

// Undocumented section
if (undocumented.length > 0) {
  md += `## ⚠️ Undocumented — In Code but Missing from .env.example\n\n`;
  md += `These variables are referenced via \`process.env\` in \`src/\` but are not defined in \`.env.example\`.\n`;
  md += `They may be automatically injected (e.g., \`VERCEL_URL\`, \`NODE_ENV\`) or may indicate missing documentation.\n\n`;
  md += `| Variable | Referenced In |\n`;
  md += `|----------|---------------|\n`;
  for (const u of undocumented) {
    const filesStr = u.files.slice(0, 3).join(', ') + (u.files.length > 3 ? ` (+${u.files.length - 3} more)` : '');
    md += `| \`${u.name}\` | ${filesStr} |\n`;
  }
  md += '\n';
} else {
  md += `## ✓ All process.env References Documented\n\n`;
  md += `No undocumented \`process.env\` references found in \`src/\`.\n\n`;
}

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, md, 'utf8');
console.log(`✓ Generated env-vars.md: ${totalVars} variables, ${undocumented.length} undocumented references`);
