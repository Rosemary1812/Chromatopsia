/**
 * Chromatopsia CLI Entry Point
 * This is the main executable that bootstraps the CLI
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { ChromatopsiaCLI } from './cli.js';

function getDefaultWorkDir(): string {
  return process.env.INIT_CWD || process.cwd();
}

function loadDotenv(): void {
  const candidates = [
    path.resolve(getDefaultWorkDir(), '.env'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath });
      return;
    }
  }
}

function parseWorkDir(argv: string[]): string {
  const cwdFlagIndex = argv.indexOf('--cwd');
  if (cwdFlagIndex >= 0) {
    const flagValue = argv[cwdFlagIndex + 1];
    if (flagValue && !flagValue.startsWith('--')) {
      return flagValue;
    }
  }
  return getDefaultWorkDir();
}

async function main(): Promise<void> {
  loadDotenv();

  // Parse CLI arguments
  const debug = process.argv.includes('--debug');
  const workDir = parseWorkDir(process.argv);

  // Initialize CLI
  const cli = new ChromatopsiaCLI({
    workingDirectory: workDir,
    debug,
  });

  // Handle lifecycle events
  cli.on('exit', (code: number) => {
    console.log(`[info] Chromatopsia CLI exited with code ${code}`);
    process.exit(code);
  });

  cli.on('error', (err: Error) => {
    console.error(`[error] ${err.message}`);
    process.exit(1);
  });

  cli.on('signal', (signal: string) => {
    console.log(`\n[info] Received ${signal}, exiting...`);
    process.exit(0);
  });

  // Start the CLI
  await cli.start();
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
