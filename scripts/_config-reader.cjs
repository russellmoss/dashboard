/**
 * Shared config reader for agent-guard scripts.
 * CommonJS — compatible with .cjs inventory scripts and .js hook scripts.
 *
 * Reads agent-docs.config.json from the project root and provides
 * resolved paths for all configurable values.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(PROJECT_ROOT, 'agent-docs.config.json');

let _cachedConfig = null;

function loadConfig() {
  if (_cachedConfig) return _cachedConfig;

  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('✗ agent-docs.config.json not found at project root.');
    console.error('  Run "npx agent-guard init" to create it.');
    process.exit(1);
  }

  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    _cachedConfig = raw;
    return raw;
  } catch (err) {
    console.error(`✗ Invalid JSON in agent-docs.config.json: ${err.message}`);
    process.exit(1);
  }
}

/** Resolve a config path relative to project root */
function resolvePath(configPath) {
  if (!configPath) return null;
  return path.resolve(PROJECT_ROOT, configPath);
}

module.exports = { loadConfig, resolvePath, PROJECT_ROOT };
