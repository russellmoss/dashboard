// packages/analyst-bot/src/index.ts
// ============================================================================
// Entry point — mode switch via --mode cli | --mode slack
// ============================================================================

import dotenv from 'dotenv';
import path from 'path';

// Load .env from the bot package directory
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// Validate required env vars at startup
const REQUIRED_VARS = [
  'ANTHROPIC_API_KEY',
  'MCP_SERVER_URL',
  'DATABASE_URL',
];

const SLACK_VARS = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'ALLOWED_CHANNELS',
  'ISSUES_CHANNEL',
  'MAINTAINER_SLACK_ID',
  'CLEANUP_SECRET',
];

function validateEnv(vars: string[]): void {
  const missing = vars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf('--mode');
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : 'slack';

  if (mode === 'cli') {
    validateEnv(REQUIRED_VARS);
    const { runCLI } = require('./cli');
    await runCLI();
  } else if (mode === 'slack') {
    validateEnv([...REQUIRED_VARS, ...SLACK_VARS]);
    const { startSlackApp } = require('./slack');
    await startSlackApp();
  } else {
    console.error(`Unknown mode: ${mode}. Use --mode cli or --mode slack`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
