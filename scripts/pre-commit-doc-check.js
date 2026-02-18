'use strict';
/**
 * pre-commit-doc-check.js
 * Pre-commit hook: detects doc-relevant code changes and generates a Claude Code prompt.
 * Called by .husky/pre-commit.
 *
 * Behavior:
 *   - Warns (stderr) + generates prompt when doc-relevant code changed WITHOUT doc updates
 *   - Shows positive note when doc-relevant code changed WITH doc updates
 *   - Silent when no doc-relevant files changed
 *   - ALWAYS exits 0 — this is a reminder, never a gate
 *
 * Usage: node scripts/pre-commit-doc-check.js [--verbose]
 */

const { execSync } = require('child_process');
const path = require('path');

const verbose = process.argv.includes('--verbose');

function stderr(msg) {
  process.stderr.write(msg);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get list of staged file paths from git. Returns [] on any error. */
function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.trim().split('\n').filter(f => f.length > 0);
  } catch (e) {
    // Not in a git repo, or no commits yet, or git not found
    return [];
  }
}

/** Convert kebab-case or snake_case to Title Case. */
function toTitleCase(str) {
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Extract the feature area from an API route path.
 *  e.g. "src/app/api/gc-hub/advisors/route.ts" → "gc-hub"
 *       "src/app/api/dashboard-requests/[id]/route.ts" → "dashboard-requests"
 */
function extractApiFeature(filePath) {
  const m = filePath.match(/^src\/app\/api\/([^/]+)/);
  return m ? m[1] : 'unknown';
}

/** Return true if a staged file is a documentation file (docs/ or .cursorrules). */
function isDocFile(f) {
  return (
    f.startsWith('docs/') ||
    f === '.cursorrules'
  );
}

// ── Category definitions (checked in ORDER — first match wins) ───────────────
//
// Mirrors the lookup table in .cursorrules "Documentation Maintenance" section.
//
const CATEGORIES = [
  {
    id: 'prisma',
    name: 'Prisma Schema',
    emoji: '🗄️',
    test: f => f === 'prisma/schema.prisma',
    docTarget: 'Section 2 (Database Models) in docs/ARCHITECTURE.md',
    genCommand: 'npm run gen:models',
  },
  {
    id: 'env',
    name: 'Environment Variables',
    emoji: '🔑',
    test: f => f === '.env.example',
    docTarget: 'Section 10 (Deployment & Operations, env vars table) in docs/ARCHITECTURE.md',
    genCommand: 'npm run gen:env',
  },
  {
    id: 'permissions',
    name: 'Permissions / Roles',
    emoji: '🔐',
    test: f => f === 'src/lib/permissions.ts',
    docTarget: 'Section 5 (Role Hierarchy / Permission Properties) in docs/ARCHITECTURE.md',
    genCommand: null,
  },
  {
    id: 'config',
    name: 'Config Constants',
    emoji: '⚙️',
    test: f => f === 'src/config/constants.ts',
    docTarget: 'Relevant section in docs/ARCHITECTURE.md referencing these constants',
    genCommand: null,
  },
  {
    id: 'semantic-layer',
    name: 'Semantic Layer',
    emoji: '🧠',
    test: f => f.startsWith('src/lib/semantic-layer/'),
    docTarget: 'Section 9 (Self-Serve Analytics / Semantic Layer) in docs/ARCHITECTURE.md',
    genCommand: null,
  },
  {
    id: 'auth',
    name: 'Auth Logic',
    emoji: '🔒',
    // Auth routes are a subset of API routes — match here to get Section 5 doc target
    test: f => f.startsWith('src/app/api/auth/'),
    docTarget: 'Section 5 (Authentication) in docs/ARCHITECTURE.md',
    genCommand: 'npm run gen:api-routes',
  },
  {
    id: 'api-routes',
    name: 'API Routes',
    emoji: '📡',
    test: f => /^src\/app\/api\/.+\/route\.ts$/.test(f),
    docTarget: 'Relevant feature section in docs/ARCHITECTURE.md',
    genCommand: 'npm run gen:api-routes',
  },
  {
    id: 'page-routes',
    name: 'Page Routes',
    emoji: '📄',
    test: f => /^src\/app\/.+\/page\.tsx$/.test(f),
    docTarget: 'Section 5 (Page Access Control) in docs/ARCHITECTURE.md',
    genCommand: null,
  },
];

// ── Categorize staged files ──────────────────────────────────────────────────

function categorize(stagedFiles) {
  const matches = {}; // categoryId → [filePaths]
  const unmatched = [];

  for (const file of stagedFiles) {
    let matched = false;
    for (const cat of CATEGORIES) {
      if (cat.test(file)) {
        if (!matches[cat.id]) matches[cat.id] = [];
        matches[cat.id].push(file);
        matched = true;
        break; // first match wins
      }
    }
    if (!matched) {
      unmatched.push(file);
    }
  }

  return { matches, unmatched };
}

// ── Build the Claude Code prompt ─────────────────────────────────────────────

function buildPrompt(matches) {
  const lines = [];
  lines.push('The following files were changed and documentation may need updating.');
  lines.push('Read each changed file listed below, then update docs/ARCHITECTURE.md accordingly.');
  lines.push('');

  // API routes — grouped by feature area
  if (matches['api-routes'] || matches['auth']) {
    const allApiFiles = [
      ...(matches['auth'] || []),
      ...(matches['api-routes'] || []),
    ];
    // Group by feature
    const byFeature = {};
    for (const f of allApiFiles) {
      const feature = extractApiFeature(f);
      if (!byFeature[feature]) byFeature[feature] = [];
      byFeature[feature].push(f);
    }
    lines.push('Changed API routes:');
    for (const [feature, files] of Object.entries(byFeature)) {
      const section = toTitleCase(feature);
      const show = files.slice(0, 15);
      for (const f of show) {
        lines.push(`- Read ${f} — update the ${section} section in docs/ARCHITECTURE.md`);
      }
      if (files.length > 15) {
        lines.push(`  (and ${files.length - 15} more ${section} files)`);
      }
    }
    // Auth-specific note
    if (matches['auth']) {
      lines.push('  Also update Section 5 (Authentication) in docs/ARCHITECTURE.md for auth route changes.');
    }
    lines.push('');
  }

  // Page routes
  if (matches['page-routes']) {
    lines.push('Changed page routes:');
    const show = matches['page-routes'].slice(0, 15);
    for (const f of show) {
      lines.push(`- Read ${f} — update Section 5 (Page Access Control) in docs/ARCHITECTURE.md`);
    }
    if (matches['page-routes'].length > 15) {
      lines.push(`  (and ${matches['page-routes'].length - 15} more page files)`);
    }
    lines.push('');
  }

  // Prisma schema
  if (matches['prisma']) {
    lines.push('Changed Prisma schema:');
    lines.push('- Read prisma/schema.prisma — check if any models were added, removed, or renamed.');
    lines.push('  Update Section 2 (Database Models) in docs/ARCHITECTURE.md.');
    lines.push('');
  }

  // Env vars
  if (matches['env']) {
    lines.push('Changed environment variables:');
    lines.push('- Read .env.example — check for new or removed variables.');
    lines.push('  Update Section 10 (Deployment & Operations, env vars table) in docs/ARCHITECTURE.md.');
    lines.push('');
  }

  // Permissions
  if (matches['permissions']) {
    lines.push('Changed permissions / roles:');
    lines.push('- Read src/lib/permissions.ts — update Section 5 (Role Hierarchy / Permission Properties)');
    lines.push('  and the Page Access Control table in docs/ARCHITECTURE.md.');
    lines.push('');
  }

  // Semantic layer
  if (matches['semantic-layer']) {
    lines.push('Changed semantic layer:');
    const show = matches['semantic-layer'].slice(0, 15);
    for (const f of show) {
      lines.push(`- Read ${f} — update Section 9 (Self-Serve Analytics / Semantic Layer) in docs/ARCHITECTURE.md`);
    }
    if (matches['semantic-layer'].length > 15) {
      lines.push(`  (and ${matches['semantic-layer'].length - 15} more files)`);
    }
    lines.push('');
  }

  // Config constants
  if (matches['config']) {
    lines.push('Changed config constants:');
    lines.push('- Read src/config/constants.ts — update any sections in docs/ARCHITECTURE.md');
    lines.push('  that reference these constants.');
    lines.push('');
  }

  // Gen commands
  const genCommands = [];
  for (const cat of CATEGORIES) {
    if (matches[cat.id] && cat.genCommand && !genCommands.includes(cat.genCommand)) {
      genCommands.push(cat.genCommand);
    }
  }
  if (genCommands.length > 0) {
    lines.push('After updating docs/ARCHITECTURE.md, run:');
    for (const cmd of genCommands) {
      lines.push(cmd);
    }
    lines.push('');
  }

  lines.push('Rules:');
  lines.push('- Read each file BEFORE updating docs');
  lines.push('- Match the existing format in docs/ARCHITECTURE.md');
  lines.push('- Do NOT modify any source code files');

  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const stagedFiles = getStagedFiles();

  if (verbose) {
    stderr(`[pre-commit-doc-check] --verbose mode\n`);
    stderr(`Total staged files: ${stagedFiles.length}\n`);
    if (stagedFiles.length > 0) {
      stderr(`Staged:\n${stagedFiles.map(f => `  ${f}`).join('\n')}\n`);
    }
  }

  if (stagedFiles.length === 0) {
    if (verbose) stderr('No staged files. Nothing to check.\n');
    return;
  }

  const { matches, unmatched } = categorize(stagedFiles);
  const docFilesStaged = stagedFiles.some(isDocFile);
  const hasDocRelevant = Object.keys(matches).length > 0;

  if (verbose) {
    stderr(`\nCategory matches:\n`);
    for (const cat of CATEGORIES) {
      if (matches[cat.id]) {
        stderr(`  ${cat.name}: ${matches[cat.id].length} file(s)\n`);
      }
    }
    stderr(`Unmatched (ignored): ${unmatched.length}\n`);
    if (unmatched.length > 0) {
      stderr(`${unmatched.map(f => `  ${f}`).join('\n')}\n`);
    }
    stderr(`Doc files staged: ${docFilesStaged}\n`);
    stderr(`Has doc-relevant code: ${hasDocRelevant}\n`);
  }

  // No doc-relevant changes — silent pass
  if (!hasDocRelevant) {
    if (verbose) stderr('\nNo doc-relevant changes detected. \u2713\n');
    return;
  }

  // Doc-relevant changes WITH doc updates — positive note
  if (docFilesStaged) {
    stderr('\n\u2713 Doc-relevant changes detected \u2014 docs also updated. Nice!\n\n');
    return;
  }

  // Doc-relevant changes WITHOUT doc updates — warn + generate prompt
  stderr('\n');
  stderr('\u26A0\uFE0F  Documentation may need updating\n');
  stderr('\u2501'.repeat(34) + '\n');
  stderr('\n');

  // List changed categories
  stderr('Changed:\n');
  for (const cat of CATEGORIES) {
    if (!matches[cat.id]) continue;
    const files = matches[cat.id];
    const count = `(${files.length} file${files.length !== 1 ? 's' : ''})`;
    stderr(`  ${cat.emoji}  ${cat.name} ${count}:\n`);
    const show = files.slice(0, 10);
    for (const f of show) {
      stderr(`     - ${f}\n`);
    }
    if (files.length > 10) {
      stderr(`     ... and ${files.length - 10} more\n`);
    }
  }

  // Gen commands to run
  const genCommands = [];
  for (const cat of CATEGORIES) {
    if (matches[cat.id] && cat.genCommand && !genCommands.includes(cat.genCommand)) {
      genCommands.push(cat.genCommand);
    }
  }
  if (genCommands.length > 0) {
    stderr('\nRun these inventory commands:\n');
    for (const cmd of genCommands) {
      stderr(`  ${cmd}\n`);
    }
  }

  // Claude Code prompt
  stderr('\n');
  stderr('\u250C' + '\u2500'.repeat(45) + '\u2510\n');
  stderr('\u2502  Claude Code Prompt (copy-paste this):       \u2502\n');
  stderr('\u2514' + '\u2500'.repeat(45) + '\u2518\n');
  stderr('\n');
  stderr(buildPrompt(matches));
  stderr('\n\n');
}

try {
  main();
} catch (e) {
  // Never crash — never block a commit
  if (verbose) {
    process.stderr.write(`[pre-commit-doc-check] Unexpected error: ${e.message}\n`);
  }
}

process.exit(0);
