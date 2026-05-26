#!/usr/bin/env node
/**
 * Swap REGION / PUBLIC_REGION in the repo-root .env.
 *
 * Usage: node scripts/set-region.mjs <dc|boise>
 *
 * Idempotently rewrites (or appends) the two lines without touching any
 * other env vars. After running, restart `npm run dev` to pick it up
 * (both the backend and Vite read env once at process start).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SUPPORTED = new Set(['dc', 'boise']);

const region = (process.argv[2] || '').trim().toLowerCase();
if (!SUPPORTED.has(region)) {
  console.error(`Usage: node scripts/set-region.mjs <${[...SUPPORTED].join('|')}>`);
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '..', '.env');
const examplePath = resolve(here, '..', '.env.example');

let content = '';
if (existsSync(envPath)) {
  content = readFileSync(envPath, 'utf8');
} else if (existsSync(examplePath)) {
  console.log('.env not found — seeding from .env.example');
  content = readFileSync(examplePath, 'utf8');
} else {
  content = '';
}

function upsert(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, `${key}=${value}`);
  // No existing line — append, ensuring trailing newline before our insert.
  const sep = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  return `${text}${sep}${key}=${value}\n`;
}

let updated = upsert(content, 'REGION', region);
updated = upsert(updated, 'PUBLIC_REGION', region);

writeFileSync(envPath, updated);

console.log(`✓ .env set to region=${region}`);
console.log('  Restart `npm run dev` (and hard-refresh the browser) to apply.');
