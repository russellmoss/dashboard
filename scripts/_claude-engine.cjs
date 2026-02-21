'use strict';

const { execSync } = require('child_process');

/**
 * Detect if Claude Code CLI is available on PATH.
 * @returns {'claude-code'|null}
 */
function detectEngine() {
  try {
    // Use 'where' on Windows, 'which' on Unix
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    execSync(cmd, { stdio: 'pipe' });
    return 'claude-code';
  } catch {
    return null;
  }
}

/**
 * Sanitize a prompt string for safe shell/stdin usage.
 * @param {string} prompt
 * @returns {string}
 */
function sanitizePrompt(prompt) {
  // Remove null bytes, normalize newlines
  return prompt.replace(/\0/g, '').replace(/\r\n/g, '\n');
}

/**
 * Classify an error from Claude Code invocation.
 * @param {string} stderr - stderr output from the failed command
 * @returns {'auth'|'offline'|'unknown'}
 */
function classifyError(stderr) {
  if (!stderr) return 'unknown';
  const lower = stderr.toLowerCase();
  if (lower.includes('not authenticated') || lower.includes('login') || lower.includes('unauthorized')) {
    return 'auth';
  }
  if (lower.includes('enotfound') || lower.includes('network') || lower.includes('offline')) {
    return 'offline';
  }
  return 'unknown';
}

/**
 * Invoke Claude Code with a prompt passed via stdin (not CLI args).
 * Uses stdin to avoid shell argument length limits (Windows: 32KB, macOS: 1MB).
 *
 * @param {string} prompt - The full prompt to send
 * @param {string} cwd - Working directory (project root)
 * @param {function} onProgress - Callback for progress updates
 * @returns {{ success: boolean, output: string, error: string|null }}
 */
function invokeClaudeCode(prompt, cwd, onProgress) {
  if (onProgress) onProgress('Calling Claude Code for narrative doc updates...');

  const sanitized = sanitizePrompt(prompt);

  try {
    const output = execSync('claude -p -', {
      cwd,
      input: sanitized,           // Pass via stdin — avoids shell arg limits
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000,            // 2 minute safety valve
    });

    if (onProgress) onProgress('Claude Code finished updating docs');
    return { success: true, output: output.trim(), error: null };
  } catch (err) {
    const errType = classifyError(err.stderr || '');

    let message;
    if (errType === 'auth') {
      message = 'Log in to Claude Code for automatic doc updates: claude login';
    } else if (errType === 'offline') {
      message = 'Claude Code unavailable (offline). Falling back to prompt mode.';
    } else {
      message = `Claude Code failed: ${(err.message || '').slice(0, 200)}. Falling back to prompt mode.`;
    }

    return { success: false, output: '', error: message };
  }
}

module.exports = { detectEngine, sanitizePrompt, classifyError, invokeClaudeCode };
