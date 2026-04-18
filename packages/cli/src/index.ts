import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { load_config, resolveConfigPath } from '@chromatopsia/agent';
import { runTui } from '@chromatopsia/tui';
import { runOnboarding } from './onboarding.js';

interface ParsedArgs {
  command: string[];
  workDir: string;
  configPath?: string;
  debug: boolean;
}

function getDefaultWorkDir(): string {
  return process.env.INIT_CWD || process.cwd();
}

function parseArgValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv.filter((value, index) => {
    if (value.startsWith('--')) return false;
    const prev = argv[index - 1];
    return prev !== '--cwd' && prev !== '--config';
  });

  return {
    command,
    workDir: parseArgValue(argv, '--cwd') ?? getDefaultWorkDir(),
    configPath: parseArgValue(argv, '--config'),
    debug: argv.includes('--debug'),
  };
}

function loadDotenv(workDir: string): void {
  const candidates = [
    path.resolve(workDir, '.env'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath });
      return;
    }
  }
}

function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Chromatopsia requires an interactive terminal. Re-run `chroma` in a TTY session.');
  }
}

async function runMain(args: ParsedArgs): Promise<void> {
  requireInteractiveTerminal();

  const resolved = resolveConfigPath({
    workingDir: args.workDir,
    explicitPath: args.configPath,
  });

  let configPath = resolved.path;
  if (!configPath) {
    const onboarding = await runOnboarding({ configPath: args.configPath });
    configPath = onboarding.configPath;
  }

  await runTui({
    workingDir: args.workDir,
    configPath,
    debug: args.debug,
  });
}

async function runConfigPath(args: ParsedArgs): Promise<void> {
  const resolved = resolveConfigPath({
    workingDir: args.workDir,
    explicitPath: args.configPath,
  });

  if (!resolved.path) {
    console.log('No config file found.');
    process.exitCode = 1;
    return;
  }

  console.log(resolved.path);
}

async function runDoctor(args: ParsedArgs): Promise<void> {
  const resolved = resolveConfigPath({
    workingDir: args.workDir,
    explicitPath: args.configPath,
  });

  console.log(`TTY: ${process.stdin.isTTY && process.stdout.isTTY ? 'ok' : 'missing'}`);
  console.log(`Config: ${resolved.path ?? 'missing'} (${resolved.source})`);

  if (!resolved.path) {
    process.exitCode = 1;
    return;
  }

  const config = await load_config(resolved.path);
  const providerConfig = config[config.provider];
  console.log(`Provider: ${config.provider}`);
  console.log(`Model: ${providerConfig?.model ?? 'missing'}`);
  console.log(`API key: ${providerConfig?.api_key ? 'configured' : 'missing'}`);
}

async function dispatch(args: ParsedArgs): Promise<void> {
  const [primary, secondary] = args.command;

  if (primary === 'config' && secondary === 'path') {
    await runConfigPath(args);
    return;
  }

  if (primary === 'doctor') {
    await runDoctor(args);
    return;
  }

  if (primary && primary !== 'init') {
    throw new Error(`Unknown command: ${args.command.join(' ')}`);
  }

  await runMain(args);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  loadDotenv(args.workDir);
  await dispatch(args);
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
