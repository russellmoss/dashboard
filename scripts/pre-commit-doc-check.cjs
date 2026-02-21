'use strict';
/**
 * pre-commit-doc-check.js
 * Pre-commit hook: detects doc-relevant code changes and generates a Claude Code prompt.
 * Called by .husky/pre-commit.
 *
 * Config-driven: reads categories, docsDir, agentConfigFile, and architectureFile
 * from agent-docs.config.json
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
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { loadConfig, PROJECT_ROOT } = require('./_config-reader.cjs');
const { detectEngine, invokeClaudeCode } = require('./_claude-engine.cjs');
const { printAutoFixSummary, printPromptFallback } = require('./_terminal-output.cjs');
const { logEntry } = require('./_audit-log.cjs');

const verbose = process.argv.includes('--verbose');
const config = loadConfig();

function stderr(msg) {
  process.stderr.write(msg);
}

// ── Build CATEGORIES dynamically from config ─────────────────────────────────

function buildTestFunction(cat) {
  switch (cat.patternType) {
    case 'exact':
      return (f) => f === cat.filePattern;
    case 'startsWith':
      return (f) => f.startsWith(cat.filePattern);
    case 'regex':
      return (f) => new RegExp(cat.filePattern).test(f);
    default:
      return (f) => f === cat.filePattern;
  }
}

const CATEGORIES = (config.categories || []).map(cat => ({
  id: cat.id,
  name: cat.name,
  emoji: cat.emoji || '📦',
  test: buildTestFunction(cat),
  docTarget: cat.docTarget
    ? `${cat.docTarget} in ${config.architectureFile || 'docs/ARCHITECTURE.md'}`
    : `Relevant section in ${config.architectureFile || 'docs/ARCHITECTURE.md'}`,
  genCommand: cat.genCommand || null,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get list of staged file paths from git. Returns [] on any error. */
function getStagedFiles() {
  try {
    const out = execSync('git diff --cached --name-only', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.trim().split('\n').filter(f => f.length > 0);
  } catch { /* git not available or not in repo */
    return [];
  }
}

/** Return true if a staged file is a documentation file. */
function isDocFile(f) {
  const docsDir = config.docsDir || 'docs/';
  const agentConfig = config.agentConfigFile || '.cursorrules';
  return f.startsWith(docsDir) || f === agentConfig;
}

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
  const archFile = config.architectureFile || 'docs/ARCHITECTURE.md';
  const lines = [];
  lines.push('The following files were changed and documentation may need updating.');
  lines.push(`Read each changed file listed below, then update ${archFile} accordingly.`);
  lines.push('');

  // Group files by category and build instructions
  for (const cat of CATEGORIES) {
    if (!matches[cat.id]) continue;

    const files = matches[cat.id];
    lines.push(`Changed ${cat.name}:`);

    const show = files.slice(0, 15);
    for (const f of show) {
      lines.push(`- Read ${f} — update ${cat.docTarget}`);
    }
    if (files.length > 15) {
      lines.push(`  (and ${files.length - 15} more files)`);
    }
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
    lines.push(`After updating ${archFile}, run:`);
    for (const cmd of genCommands) {
      lines.push(cmd);
    }
    lines.push('');
  }

  lines.push('Rules:');
  lines.push('- Read each file BEFORE updating docs');
  lines.push(`- Match the existing format in ${archFile}`);
  lines.push('- Do NOT modify any source code files');

  return lines.join('\n');
}

/**
 * Build a prompt specifically for Claude Code narrative updates.
 * Targets only narrativeTargets files, not agent configs.
 */
function buildNarrativePrompt(matches, cfg) {
  const archFile = cfg.architectureFile || 'docs/ARCHITECTURE.md';
  const targets = [
    archFile,
    ...(cfg.autoFix?.narrative?.additionalNarrativeTargets || ['README.md']),
  ];

  const lines = [
    'The following code files were changed. Update the documentation to reflect these changes.',
    '',
    `Files you MUST update: ${targets.join(', ')}`,
    '',
  ];

  for (const cat of CATEGORIES) {
    if (!matches[cat.id]) continue;
    const files = matches[cat.id];
    lines.push(`Changed ${cat.name} (${files.length} file${files.length !== 1 ? 's' : ''}):`);
    const show = files.slice(0, 15);
    for (const f of show) {
      lines.push(`  - ${f}`);
    }
    if (files.length > 15) {
      lines.push(`  ... and ${files.length - 15} more`);
    }
    lines.push('');
  }

  lines.push('RULES:');
  lines.push('- Read each changed source file BEFORE updating docs');
  lines.push(`- Match the existing format and section structure in ${archFile}`);
  lines.push('- Do NOT modify any source code files');
  lines.push('- Do NOT modify .cursorrules, CLAUDE.md, or any agent config files');
  lines.push('- Do NOT create new files — only update existing ones');
  lines.push(`- Only update these files: ${targets.join(', ')}`);

  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
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
    if (verbose) stderr('\nNo doc-relevant changes detected. ✓\n');
    return;
  }

  // Doc-relevant changes WITH doc updates — positive note
  if (docFilesStaged) {
    stderr('\n✓ Doc-relevant changes detected — docs also updated. Nice!\n\n');
    return;
  }

  // ── Doc-relevant changes WITHOUT doc updates — auto-fix mode ──

  const autoFixResults = [];
  let engineUsed = null;
  let engineError = null;
  let autoFixRan = false;

  // Step 1: Auto-run generators
  if (config.autoFix?.generators !== false) {
    const genCommands = [];
    for (const cat of CATEGORIES) {
      if (matches[cat.id] && cat.genCommand && !genCommands.includes(cat.genCommand)) {
        genCommands.push(cat.genCommand);
      }
    }

    for (const cmd of genCommands) {
      try {
        execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'pipe' });
        autoFixResults.push({ file: cmd, action: 'regenerated' });
        autoFixRan = true;
      } catch (e) {
        if (verbose) stderr(`  Generator failed: ${cmd}: ${e.message}\n`);
      }
    }

    // Stage generated files
    if (autoFixRan) {
      try {
        const genDir = config.generatedDir || 'docs/_generated/';
        execSync(`git add ${genDir}`, { cwd: PROJECT_ROOT, stdio: 'pipe' });
      } catch {
        // Non-fatal — generated files may not have changed
      }
    }
  }

  // Step 2: Narrative update via Claude Code
  const triggeredIds = Object.keys(matches);
  const narrativeTriggers = config.autoFix?.narrative?.narrativeTriggers || ['api-routes', 'prisma', 'env'];
  const hasNarrativeTrigger = triggeredIds.some(id => narrativeTriggers.includes(id));

  if (hasNarrativeTrigger && config.autoFix?.narrative?.enabled !== false) {
    const engine = detectEngine();

    if (engine) {
      engineUsed = engine;
      const prompt = buildNarrativePrompt(matches, config);
      const result = invokeClaudeCode(prompt, PROJECT_ROOT, (msg) => stderr(`  ${msg}\n`));

      if (result.success) {
        // Compute narrative targets
        const archFile = config.architectureFile || 'docs/ARCHITECTURE.md';
        const targets = [
          archFile,
          ...(config.autoFix?.narrative?.additionalNarrativeTargets || ['README.md']),
        ];

        // Review mode
        if (config.autoFix?.narrative?.review === true) {
          // Check if terminal is available
          let canInteract = false;
          try {
            const ttyPath = process.platform === 'win32' ? 'CON' : '/dev/tty';
            const fd = fs.openSync(ttyPath, 'r');
            fs.closeSync(fd);
            canInteract = true;
          } catch {
            // No TTY available (CI, piped input) — auto-accept
          }

          if (canInteract) {
            stderr('\n📋 Review AI doc changes:\n');
            for (const target of targets) {
              try {
                const diff = execSync(`git diff -- ${target}`, {
                  cwd: PROJECT_ROOT,
                  encoding: 'utf8',
                  stdio: ['pipe', 'pipe', 'pipe'],
                });
                if (diff.trim()) {
                  stderr(`\n--- ${target} ---\n`);
                  stderr(diff);
                }
              } catch {
                // File may not exist or no changes
              }
            }

            // Read from /dev/tty, not stdin (git hooks have stdin as /dev/null)
            const ttyPath = process.platform === 'win32' ? 'CON' : '/dev/tty';
            const ttyFd = fs.openSync(ttyPath, 'r');
            const ttyInput = fs.createReadStream(null, { fd: ttyFd });
            const rl = readline.createInterface({ input: ttyInput, output: process.stderr });

            const answer = await new Promise((resolve) => {
              rl.question('  Stage these changes? (y/n): ', resolve);
            });
            rl.close();
            ttyInput.destroy();

            if (answer.toLowerCase() !== 'y') {
              // Discard changes
              for (const target of targets) {
                try { execSync(`git checkout -- ${target}`, { cwd: PROJECT_ROOT, stdio: 'pipe' }); } catch { /* ignore */ }
              }
              stderr('  AI changes discarded.\n');
              engineError = 'Changes rejected by review.';
            }
          }
        }

        // Stage narrative targets (unless rejected by review)
        if (!engineError) {
          for (const target of targets) {
            try {
              execSync(`git add ${target}`, { cwd: PROJECT_ROOT, stdio: 'pipe' });
              autoFixResults.push({ file: target, action: 'narrative updated by Claude Code' });
            } catch {
              // File may not exist
            }
          }
          autoFixRan = true;

          // Write signal file for prepare-commit-msg hook
          const signalDir = path.join(PROJECT_ROOT, '.agent-guard');
          if (!fs.existsSync(signalDir)) fs.mkdirSync(signalDir, { recursive: true });
          fs.writeFileSync(path.join(signalDir, '.auto-fix-ran'), '', 'utf8');
        }
      } else {
        engineError = result.error;
      }
    } else {
      engineError = 'Claude Code not found on PATH. Install: npm i -g @anthropic-ai/claude-code';
    }
  }

  // Step 3: Output results
  if (autoFixResults.length > 0 && !engineError) {
    printAutoFixSummary(autoFixResults);
  } else {
    // Fall back to prompt mode (existing behavior)
    const reason = engineError || null;

    stderr('\n');
    stderr('⚠️  Documentation may need updating\n');
    stderr('━'.repeat(34) + '\n');
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

    printPromptFallback(reason, buildPrompt(matches));
  }

  // Step 4: Audit log
  logEntry(PROJECT_ROOT, {
    mode: autoFixRan ? 'auto-fix' : (Object.keys(matches).length > 0 ? 'prompt' : 'skip'),
    engine: engineUsed,
    generatorResults: autoFixResults.filter(r => r.action === 'regenerated'),
    narrativeResults: autoFixResults.filter(r => r.action.includes('narrative')),
  });
}

main().catch((e) => {
  if (verbose) {
    process.stderr.write(`[pre-commit-doc-check] Unexpected error: ${e.message}\n`);
  }
}).finally(() => {
  process.exit(0);
});
