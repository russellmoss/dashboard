'use strict';
/**
 * Post-commit hook: Creates a Wrike task in the Dashboards kanban
 * with AI-generated description of what was done and why.
 *
 * Context sources (in priority order):
 * 1. .ai-session-context.md — written by Claude Code / Cursor (rich mode)
 * 2. Git diff analysis — fallback when no context file exists (diff-only mode)
 *
 * Non-blocking: catches all errors, never prevents commits.
 * Called from: .husky/post-commit
 */

const path = require('path');

// Load env vars from .env (WRIKE_ACCESS_TOKEN lives there, not .env.local)
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
// Also attempt .env.local for ANTHROPIC_API_KEY
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });

const { execSync } = require('child_process');
const fs = require('fs');

// ── Config (hardcoded — same as DASHBOARDS_WRIKE_CONFIG in src/types/wrike.ts) ──

const FOLDER_ID = 'MQAAAAEEBpOb';          // Dashboards project
const BACKLOG_STATUS_ID = 'IEAGT6KAJMAAAAAA'; // Requested (Active) — new tasks land here

// ── Logging ──────────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write('[wrike-commit] ' + msg + '\n');
}

// ── Git context ───────────────────────────────────────────────────────────────

function exec(cmd) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    return '';
  }
}

function getGitContext() {
  const hash = exec('git rev-parse --short HEAD');
  const fullHash = exec('git rev-parse HEAD');
  const message = exec('git log -1 --pretty=%B');
  const branch = exec('git rev-parse --abbrev-ref HEAD');
  const filesChanged = exec('git diff-tree --no-commit-id --name-status -r HEAD');
  const diffStats = exec('git diff-tree --no-commit-id --stat -r HEAD');

  let diff = '';
  try {
    const rawDiff = execSync('git diff HEAD~1 HEAD --unified=3', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    diff = rawDiff.slice(0, 4000);
  } catch (e) {
    diff = '(first commit — no parent diff available)';
  }

  return { hash, fullHash, message, branch, filesChanged, diffStats, diff };
}

// ── Session context file ──────────────────────────────────────────────────────

function readSessionContext() {
  const contextPath = path.join(process.cwd(), '.ai-session-context.md');
  try {
    if (fs.existsSync(contextPath)) {
      return fs.readFileSync(contextPath, 'utf8');
    }
  } catch (e) {
    // Fall through to diff-only mode
  }
  return null;
}

function deleteSessionContext() {
  const contextPath = path.join(process.cwd(), '.ai-session-context.md');
  try {
    if (fs.existsSync(contextPath)) {
      fs.unlinkSync(contextPath);
    }
  } catch (e) {
    // Not critical — stale context will be overwritten on next commit
  }
}

// ── Claude API prompts ────────────────────────────────────────────────────────

function buildRichPrompt(sessionContext, git) {
  return [
    'You are generating a professional task description for a Wrike kanban card.',
    'This task tracks a git commit on the Savvy Wealth recruiting funnel analytics dashboard.',
    '',
    'SESSION CONTEXT (written by the developer before committing):',
    sessionContext,
    '',
    'GIT DETAILS:',
    'Commit: ' + git.hash + ' on branch ' + git.branch,
    'Message: ' + git.message,
    'Files changed:',
    git.filesChanged,
    '',
    'Diff stats:',
    git.diffStats,
    '',
    'Write a Wrike task description in this format:',
    '## Summary',
    'What was built/fixed/changed and why (2-3 sentences).',
    '',
    '## Technical Changes',
    'Key files modified and what changed in each (bullet points, max 8).',
    '',
    '## Impact',
    'What this enables or fixes for end users or the team (1-2 sentences).',
    '',
    'Keep the total response under 400 words. Use plain text — the ## headers are section labels.',
  ].join('\n');
}

function buildDiffPrompt(git) {
  return [
    'You are generating a professional task description for a Wrike kanban card.',
    'This task tracks a git commit on the Savvy Wealth recruiting funnel analytics dashboard.',
    'Stack: Next.js 14, TypeScript, Tailwind CSS, Neon PostgreSQL (Prisma), Google BigQuery.',
    '',
    'COMMIT DETAILS:',
    'Branch: ' + git.branch,
    'Message: ' + git.message,
    '',
    'Files changed:',
    git.filesChanged,
    '',
    'Diff stats:',
    git.diffStats,
    '',
    'Condensed diff (first 4000 chars):',
    git.diff,
    '',
    'Write a Wrike task description in this format:',
    '## Summary',
    'What was changed and likely why (2-3 sentences based on the diff).',
    '',
    '## Technical Changes',
    'Key files modified and what changed (bullet points, max 8).',
    '',
    'Keep the total response under 300 words. Use plain text — the ## headers are section labels.',
  ].join('\n');
}

// ── Claude API call ───────────────────────────────────────────────────────────

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.content?.[0]?.text || null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Wrike API call ────────────────────────────────────────────────────────────

async function createWrikeTask(title, description, git) {
  const token = process.env.WRIKE_ACCESS_TOKEN;
  if (!token) return null;

  const taskData = {
    title: title.slice(0, 250),
    description: description,
    customStatus: BACKLOG_STATUS_ID,
    metadata: [
      { key: 'source', value: 'git-commit-hook' },
      { key: 'commit_hash', value: git.fullHash },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(
      'https://www.wrike.com/api/v4/folders/' + FOLDER_ID + '/tasks',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify(taskData),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const err = await response.text();
      log('\u26A0 Wrike API error: ' + response.status + ' ' + err.slice(0, 200));
      return null;
    }

    const data = await response.json();
    return data.data?.[0] || null;
  } catch (e) {
    log('\u26A0 Wrike request failed: ' + (e.message || String(e)));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Guard: require WRIKE_ACCESS_TOKEN
  if (!process.env.WRIKE_ACCESS_TOKEN) {
    log('\u26A0 WRIKE_ACCESS_TOKEN not set \u2014 skipping');
    return;
  }

  // Gather git context
  const git = getGitContext();
  if (!git.hash) {
    log('\u26A0 Could not read git state \u2014 skipping');
    return;
  }

  // Read (and immediately delete) session context file
  const sessionContext = readSessionContext();
  const contextSource = sessionContext ? 'ai-session' : 'diff-only';

  if (sessionContext) {
    log('\u2713 Found session context file');
    deleteSessionContext();
  } else {
    log('\u2139 No session context file \u2014 using diff-only mode');
  }

  // Build prompt and call Claude
  const prompt = sessionContext
    ? buildRichPrompt(sessionContext, git)
    : buildDiffPrompt(git);

  let description = await callClaude(prompt);

  if (!description) {
    description = git.message + '\n\nFiles changed:\n' + git.filesChanged;
    log('\u26A0 Claude API unavailable \u2014 using fallback description');
  }

  // Append metadata footer
  const footer = [
    '',
    '---',
    'Commit: ' + git.hash + ' | Branch: ' + git.branch,
    'Context: ' + contextSource + ' | ' + new Date().toISOString().split('T')[0],
  ].join('\n');

  description += footer;

  // Build task title: [branch] first line of commit message
  const title = '[' + git.branch + '] ' + git.message.split('\n')[0];

  // Create Wrike task
  const task = await createWrikeTask(title, description, git);

  if (task) {
    log('\u2713 Wrike task created: ' + title.slice(0, 80));
  } else {
    log('\u26A0 Could not create Wrike task (see above)');
  }
}

// Never crash — never block a commit
try {
  main().catch(function (e) {
    try { log('\u26A0 Unexpected error: ' + (e.message || String(e))); } catch (_) {}
  });
} catch (e) {
  // Sync guard — should never happen but just in case
}
