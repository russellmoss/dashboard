'use strict';

/**
 * Get emoji for a file path based on content type.
 * @param {string} filePath
 * @returns {string}
 */
function getEmoji(filePath) {
  if (filePath.includes('api-routes') || filePath.includes('route.')) return '📡';
  if (filePath.includes('prisma') || filePath.includes('model')) return '🗄️';
  if (filePath.includes('env')) return '🔑';
  if (filePath.includes('ARCHITECTURE')) return '📄';
  if (filePath.includes('README')) return '📖';
  return '📝';
}

/**
 * Print the auto-fix summary (green checkmark mode).
 * @param {Array<{file: string, action: string, detail?: string}>} results
 */
function printAutoFixSummary(results) {
  const stderr = (msg) => process.stderr.write(msg);

  stderr('\n✅ agent-guard auto-updated docs:\n');
  for (const r of results) {
    const emoji = getEmoji(r.file);
    stderr(`  ${emoji} ${r.file} — ${r.action}${r.detail ? ` (${r.detail})` : ''}\n`);
  }
  stderr('\n');
}

/**
 * Print progress during Claude Code invocation.
 * @param {string} message
 */
function printProgress(message) {
  process.stderr.write(`  ${message}\n`);
}

/**
 * Print prompt-mode fallback (yellow warning mode).
 * @param {string|null} fallbackReason - Why auto-fix didn't run
 * @param {string} prompt - The manual prompt to display
 */
function printPromptFallback(fallbackReason, prompt) {
  const stderr = (msg) => process.stderr.write(msg);

  if (fallbackReason) {
    stderr(`\n⚠️  ${fallbackReason}\n`);
  }

  stderr('\n');
  stderr('┌' + '─'.repeat(45) + '┐\n');
  stderr('│  Claude Code Prompt (copy-paste this):       │\n');
  stderr('└' + '─'.repeat(45) + '┘\n');
  stderr('\n');
  stderr(prompt);
  stderr('\n\n');
}

module.exports = { getEmoji, printAutoFixSummary, printProgress, printPromptFallback };
