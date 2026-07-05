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

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fetchBundle } from '../js/fetchBundle.js';
import { appendHistory, keepExistingSnapshot } from '../js/history.js';
import { STALE_AFTER_HOURS } from '../js/config.js';

const OUT = new URL('../data/snapshot.json', import.meta.url);
const HIST = new URL('../data/history.json', import.meta.url);

async function readJsonOrNull(url) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    return null;
  }
}

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

// Quality gate: from US-region CI, Binance/Bybit geo-block and this capture
// carries them only via the Hyperliquid echo — never overwrite a complete,
// still-fresh snapshot with a more-degraded one. Stale (>24h) loses to fresh.
const existingSnapshot = await readJsonOrNull(OUT);
if (keepExistingSnapshot(existingSnapshot, bundle, STALE_AFTER_HOURS, Date.now())) {
  console.log(
    `Snapshot kept: existing capture (${existingSnapshot.generatedAt}) reaches more venues ` +
    'than this run and is still fresh — not overwriting.',
  );
} else {
  await writeFile(OUT, JSON.stringify(bundle, null, 2) + '\n');
  console.log(`Snapshot written: data/snapshot.json (generatedAt ${bundle.generatedAt})`);
}

// History accrues on EVERY run (28-day cap), snapshot kept or not — the
// future trend column wants the densest series available. No UI reads it yet.
const history = appendHistory(await readJsonOrNull(HIST), bundle);
await writeFile(HIST, JSON.stringify(history) + '\n');
console.log(`History appended: data/history.json (${history.points.length} points, 28-day cap)`);

if (failed.length > 0) {
  console.warn(`Partial snapshot: ${failed.join(', ')} unavailable — the UI will show "data unavailable" for those cells (never "not listed").`);
}
