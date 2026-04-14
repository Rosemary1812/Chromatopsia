#!/usr/bin/env node
/**
 * Chromatopsia CLI Shell Entry Point
 * This script is used for npm bin and global installs
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve dist path using pathToFileURL for proper ESM handling
const distPath = join(__dirname, '..', 'dist', 'index.js');
const distUrl = pathToFileURL(distPath).href;

try {
  await import(distUrl);
} catch (err) {
  console.error('Failed to load CLI:', err.message);
  console.error('Hint: run "pnpm build" first to compile TypeScript sources.');
  process.exit(1);
}
