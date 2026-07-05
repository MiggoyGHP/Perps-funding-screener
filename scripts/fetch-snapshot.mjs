#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fetch-snapshot.mjs — build-time pre-fetch. Snapshots real funding data from
// all three venues into data/snapshot.json so the published GitHub Pages site
// serves real numbers with a visible "as of" timestamp, with zero runtime
// dependence on cross-origin fetches.
//
// Usage:  node scripts/fetch-snapshot.mjs
// Needs:  Node >= 18 (global fetch). Zero npm dependencies.
//
// Uses the exact same fetchBundle() as the browser's live mode — one code
// path, one bundle shape, so sample / snapshot / live can never drift apart.
// ---------------------------------------------------------------------------

import { writeFile, mkdir } from 'node:fs/promises';
import { fetchBundle } from '../js/fetchBundle.js';

const OUT = new URL('../data/snapshot.json', import.meta.url);

console.log('Fetching funding data (Hyperliquid, Binance USDS-M, Bybit linear)…');
const bundle = await fetchBundle();
bundle.source = 'snapshot';

const status = (v, name) =>
  bundle[v] ? `  ${name.padEnd(12)} OK` : `  ${name.padEnd(12)} FAILED: ${bundle.errors[v]}`;
console.log(status('hyperliquid', 'Hyperliquid'));
console.log(status('binance', 'Binance'));
console.log(status('bybit', 'Bybit') + (bundle.errors.bybitNote ? `  (${bundle.errors.bybitNote})` : ''));

// Validate BEFORE writing: an all-failed run must never clobber the previous
// good snapshot on disk.
const failed = ['hyperliquid', 'binance', 'bybit'].filter((v) => !bundle[v]);
if (failed.length === 3) {
  console.error('All venues failed — refusing to overwrite the existing snapshot. Exiting 1.');
  process.exit(1);
}

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify(bundle, null, 2) + '\n');
console.log(`Snapshot written: data/snapshot.json (generatedAt ${bundle.generatedAt})`);

if (failed.length > 0) {
  console.warn(`Partial snapshot: ${failed.join(', ')} unavailable — the UI will show "data unavailable" for those cells (never "not listed").`);
}
