// packages/analyst-bot/src/cli.ts
// ============================================================================
// CLI conversation loop — Phase 1 prototype
// ============================================================================

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { processMessage } from './conversation';

const CLI_THREAD_ID = 'cli:local';
const CLI_CHANNEL_ID = 'cli';
const CLI_USER_ID = 'cli@local';

export async function runCLI(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\nYou: ',
  });

  console.log('=== Savvy Analyst Bot — CLI Mode ===');
  console.log('Type your questions. "exit" to quit.\n');

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log('Goodbye!');
      rl.close();
      process.exit(0);
    }

    console.log('\nThinking...\n');

    try {
      const result = await processMessage(input, CLI_THREAD_ID, CLI_CHANNEL_ID, CLI_USER_ID);

      console.log('Bot:', result.text);

      if (result.chartBuffer) {
        const chartPath = path.join(process.cwd(), `chart_${Date.now()}.png`);
        fs.writeFileSync(chartPath, result.chartBuffer);
        console.log(`\n[Chart saved to ${chartPath}]`);
      }

      if (result.xlsxBuffer && result.xlsxFilename) {
        const xlsxPath = path.join(process.cwd(), result.xlsxFilename);
        fs.writeFileSync(xlsxPath, result.xlsxBuffer);
        console.log(`\n[XLSX saved to ${xlsxPath}]`);
      }

      if (result.error) {
        console.error(`\n[Error: ${result.error}]`);
      }
    } catch (err) {
      console.error('Error:', (err as Error).message);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}
