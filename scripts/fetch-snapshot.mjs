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
import { HL_INTEREST_FLOOR_HOURLY } from '../js/venues.js';

const OUT = new URL('../data/snapshot.json', import.meta.url);
const HIST = new URL('../data/history.json', import.meta.url);

// Cross-verify the Hyperliquid leg against a SECOND, independent endpoint:
// metaAndAssetCtxs' assetCtx.funding vs predictedFundings' HlPerp rate.
// Majors routinely pin at the 0.0000125/1h interest floor, which makes every
// HL row identical and looks like a placeholder to a sharp eye — recording the
// cross-check inside the snapshot makes the raw JSON self-documenting proof
// that the pinned values were independently confirmed at capture time.
//
// Semantics matter here: for a coin AT the floor both endpoints return the
// exact constant, so any disagreement about a pinned row is a real integrity
// problem (`floorSuspects`). For a coin OFF the floor the two endpoints
// estimate the upcoming settlement over different windows and update on
// different cadences, so intra-hour divergence is normal — recorded verbatim
// in `divergences` (live-observed 2026-07-05: SOL 21% apart one minute after
// leaving the floor), never alarmed on. Nothing here is fatal.
async function crossCheckHyperliquid(bundle) {
  const pf = bundle.hyperliquid?.predictedFundings;
  if (!Array.isArray(pf)) return null;
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const [meta, ctxs] = await res.json();
    const ctxByCoin = new Map(meta.universe.map((u, i) => [u?.name, ctxs[i]]));
    let checked = 0;
    let confirmed = 0;
    const divergences = [];
    const floorSuspects = [];
    for (const [coin, venues] of pf) {
      const hl = venues.find(([k]) => k === 'HlPerp')?.[1];
      const ctx = ctxByCoin.get(coin);
      if (!hl || !ctx) continue;
      checked += 1;
      const a = parseFloat(hl.fundingRate);
      const b = parseFloat(ctx.funding);
      if (a === b) {
        confirmed += 1;
        continue;
      }
      divergences.push({ coin, predictedFundings: hl.fundingRate, metaAndAssetCtxs: ctx.funding });
      if (a === HL_INTEREST_FLOOR_HOURLY) floorSuspects.push(coin);
    }
    return { endpoint: 'metaAndAssetCtxs', checked, confirmed, divergences, floorSuspects };
  } catch (e) {
    return { endpoint: 'metaAndAssetCtxs', error: String(e?.message || e) };
  }
}

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

const hlCrossCheck = await crossCheckHyperliquid(bundle);
if (hlCrossCheck) {
  bundle.hlCrossCheck = hlCrossCheck;
  if (hlCrossCheck.error) {
    console.warn(`  HL cross-check skipped: ${hlCrossCheck.error}`);
  } else {
    const { checked, confirmed, divergences, floorSuspects } = hlCrossCheck;
    console.log(
      `  HL cross-check vs metaAndAssetCtxs: ${confirmed}/${checked} exact` +
      (divergences.length
        ? `; off-floor divergence (normal intra-hour): ${divergences.map((x) => x.coin).join(', ')}`
        : ''),
    );
    if (floorSuspects.length) {
      console.warn(`  FLOOR SUSPECT (pinned in predictedFundings, disputed by metaAndAssetCtxs): ${floorSuspects.join(', ')}`);
    }
  }
}

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
