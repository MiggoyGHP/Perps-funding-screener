// Run: node --test tests/
// Golden values come from live API captures taken 2026-07-05 during the
// convention-verification research pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  annualize, annualizedCosts, assessCarry, assessSpread, financingDoubleCount,
  rankAssets, rankRows, bestOpportunity,
} from '../js/compute.js';
import { normalizeBundle } from '../js/normalize.js';
import { SAMPLE_BUNDLE } from '../js/sampleData.js';
import { sanitizeInputs, loadInputs } from '../js/persist.js';
import { DEFAULT_INPUTS, UNIVERSE } from '../js/config.js';
import { toCsv, CSV_HEADER } from '../js/csv.js';
import { appendHistory } from '../js/history.js';

const close = (actual, expected, eps = 1e-12) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} ≈ ${expected}`);

// --- Annualization golden values --------------------------------------------

test('Hyperliquid hourly rate annualizes ×8760 (the neutral-funding anchor)', () => {
  // 0.00125%/h is HL's fixed interest component = 1/8 of 0.01%/8h.
  close(annualize(0.0000125, 1), 0.1095); // 10.95% APR
});

test('Binance 8h rate annualizes ×1095', () => {
  close(annualize(0.00004884, 8), 0.00004884 * 1095); // ≈ 5.35% APR
});

test('Binance 4h rate annualizes ×2190 — the HYPE-Binance 2× trap', () => {
  // 0.005% per 4h ≡ 0.03%/day ≡ 10.95% APR. Treating it as 8h gives 5.475%.
  close(annualize(0.00005, 4), 0.1095);
  assert.notEqual(annualize(0.00005, 4), annualize(0.00005, 8));
});

test('Negative Bybit 8h rate annualizes with sign preserved', () => {
  close(annualize(-0.00001681, 8), -0.00001681 * 1095); // ≈ −1.84% APR
});

test('convention trap: hourly vs 8h basis differ by exactly 8×', () => {
  // The classic mistake this project exists to prevent, in both directions:
  // an HL hourly rate ×1095 understates 8×; an 8h rate ×8760 overstates 8×.
  const hourly = annualize(0.0000125, 1);
  const asIf8h = annualize(0.0000125, 8);
  close(hourly / asIf8h, 8);
});

test('annualize refuses missing/zero intervals (no silent defaults)', () => {
  assert.throws(() => annualize(0.0001, 0));       // Bybit dated-futures rows
  assert.throws(() => annualize(0.0001, undefined));
  assert.throws(() => annualize(NaN, 8));
});

// --- Normalization of the sample bundle -------------------------------------

const rows = normalizeBundle(SAMPLE_BUNDLE);
const get = (asset, venue) => rows.find((r) => r.asset === asset && r.venue === venue);

test('sample bundle yields one row per (asset, venue) cell', () => {
  assert.equal(rows.length, UNIVERSE.length * 3);
});

test('every universe asset is ok on at least one venue in sample mode (sample must never look broken)', () => {
  for (const a of UNIVERSE) {
    assert.ok(
      rows.some((r) => r.asset === a.id && r.state === 'ok'),
      `${a.id} has no ok row in the sample bundle`,
    );
  }
});

test('SOL sample mirrors its live-verified intervals: HL 1h, Binance 8h, Bybit 480min (2026-07-05)', () => {
  assert.equal(get('SOL', 'hyperliquid').intervalHours, 1);
  assert.equal(get('SOL', 'binance').intervalHours, 8);
  assert.equal(get('SOL', 'bybit').intervalHours, 8);
  close(get('SOL', 'binance').aprGross, 0.00008 * 1095); // 8.76% APR, ×1095 not ×2190
});

test('Hyperliquid rows are hourly (intervalHours 1) with ×8760 APR', () => {
  const eth = get('ETH', 'hyperliquid');
  assert.equal(eth.state, 'ok');
  assert.equal(eth.intervalHours, 1);
  close(eth.aprGross, 0.1095);
});

test('HYPE on Binance uses the 4h interval from fundingInfo, not the 8h default', () => {
  const r = get('HYPE', 'binance');
  assert.equal(r.state, 'ok');
  assert.equal(r.intervalHours, 4);
  close(r.aprGross, 0.1095); // 0.00005 × 2190 — NOT 0.05475
  // The secondhand Hyperliquid echo disagrees (says 8h) → flagged, not absorbed.
  assert.ok(r.flags.some((f) => f.includes('mismatch')));
});

test('Bybit interval comes from instruments-info minutes ÷ 60', () => {
  const r = get('BTC', 'bybit');
  assert.equal(r.state, 'ok');
  assert.equal(r.intervalHours, 8); // 480 minutes
});

test('OIL: listed only on Hyperliquid (xyz:CL); other venues are notListed, never numbers', () => {
  const hl = get('OIL', 'hyperliquid');
  assert.equal(hl.state, 'ok');
  assert.ok(hl.flags.includes('hip3'));
  close(hl.aprGross, 0.00000625 * 8760); // ≈ 5.48%, deployer 0.5 multiplier already inside
  assert.equal(get('OIL', 'binance').state, 'notListed');
  assert.equal(get('OIL', 'bybit').state, 'notListed');
});

test('numeric strings are parsed only in normalize (inputs stay strings in the bundle)', () => {
  assert.equal(typeof SAMPLE_BUNDLE.bybit.tickers.list[0].fundingRate, 'string');
  assert.equal(typeof get('BTC', 'bybit').ratePerInterval, 'number');
});

// --- Cell-state honesty ------------------------------------------------------

function cloneBundle() {
  return JSON.parse(JSON.stringify(SAMPLE_BUNDLE));
}

test('listed market with failed fetch is "unavailable" (with cause), never "notListed"', () => {
  const b = cloneBundle();
  b.bybit = null;
  b.errors = { bybit: 'TLS failure: host blocked by ISP' };
  // Also strip the Hyperliquid echo so no fallback exists.
  b.hyperliquid.predictedFundings = b.hyperliquid.predictedFundings.map(
    ([coin, venues]) => [coin, venues.filter(([k]) => k !== 'BybitPerp')],
  );
  const r = normalizeBundle(b).find((x) => x.asset === 'ETH' && x.venue === 'bybit');
  assert.equal(r.state, 'unavailable');
  assert.match(r.reason, /blocked by ISP/);
});

test('when the venue API is down but the Hyperliquid echo exists, rows fall back WITH a provenance flag', () => {
  const b = cloneBundle();
  b.bybit = null;
  const r = normalizeBundle(b).find((x) => x.asset === 'ETH' && x.venue === 'bybit');
  assert.equal(r.state, 'ok');
  assert.ok(r.flags.some((f) => f.includes('echo')));
});

test('delisted HIP-3 market renders as delisted, not as a live rate', () => {
  const b = cloneBundle();
  b.hyperliquid.xyzMetaAndAssetCtxs[0].universe[0].isDelisted = true;
  const r = normalizeBundle(b).find((x) => x.asset === 'OIL' && x.venue === 'hyperliquid');
  assert.equal(r.state, 'delisted');
});

test('a poisoned interval (0h) in venue data degrades that cell, never blanks the page', () => {
  const b = cloneBundle();
  // Poison two independent paths: Binance fundingInfo and a Hyperliquid echo.
  b.binance.fundingInfo.find((e) => e.symbol === 'ETHUSDT').fundingIntervalHours = 0;
  b.bybit = null; // forces the Bybit echo fallback...
  b.hyperliquid.predictedFundings
    .find(([c]) => c === 'ETH')[1]
    .find(([k]) => k === 'BybitPerp')[1].fundingIntervalHours = 0; // ...with a poisoned interval
  const rows2 = normalizeBundle(b); // must not throw
  assert.equal(rows2.length, UNIVERSE.length * 3);
  const ethBin = rows2.find((r) => r.asset === 'ETH' && r.venue === 'binance');
  assert.equal(ethBin.intervalHours, 8); // flagged default, not 0
  assert.ok(ethBin.flags.some((f) => f.includes('defaulted')));
  const ethByb = rows2.find((r) => r.asset === 'ETH' && r.venue === 'bybit');
  assert.equal(ethByb.intervalHours, 8);
});

test('partial Hyperliquid data degrades only the affected cells', () => {
  // HIP-3 call failed, core predictedFundings succeeded:
  const a = cloneBundle();
  a.hyperliquid.xyzMetaAndAssetCtxs = null;
  a.errors = { hyperliquidHip3: 'timeout after 15000ms' };
  const rowsA = normalizeBundle(a);
  assert.equal(rowsA.find((r) => r.asset === 'ETH' && r.venue === 'hyperliquid').state, 'ok');
  const oil = rowsA.find((r) => r.asset === 'OIL' && r.venue === 'hyperliquid');
  assert.equal(oil.state, 'unavailable');
  assert.match(oil.reason, /timeout/);

  // Core failed, HIP-3 succeeded:
  const b = cloneBundle();
  b.hyperliquid.predictedFundings = null;
  b.errors = { hyperliquidCore: '429 rate limited' };
  const rowsB = normalizeBundle(b);
  assert.equal(rowsB.find((r) => r.asset === 'OIL' && r.venue === 'hyperliquid').state, 'ok');
  const eth = rowsB.find((r) => r.asset === 'ETH' && r.venue === 'hyperliquid');
  assert.equal(eth.state, 'unavailable');
  assert.match(eth.reason, /rate limited/);
});

test('Binance fundingInfo missing → interval from Hyperliquid echo, flagged (not a blind 8h)', () => {
  const b = cloneBundle();
  b.binance.fundingInfo = null;
  // The sample HYPE BinPerp echo says 8h; give it the live-accurate 4h to
  // prove the echo interval is used when fundingInfo is unreachable.
  b.hyperliquid.predictedFundings
    .find(([c]) => c === 'HYPE')[1]
    .find(([k]) => k === 'BinPerp')[1].fundingIntervalHours = 4;
  const r = normalizeBundle(b).find((x) => x.asset === 'HYPE' && x.venue === 'binance');
  assert.equal(r.state, 'ok');
  assert.equal(r.intervalHours, 4);
  assert.ok(r.flags.some((f) => f.includes('echo') && f.includes('fundingInfo unavailable')));
});

test('Bybit dated-futures rows (fundingInterval 0) never reach annualize', () => {
  const b = cloneBundle();
  b.bybit.instrumentsInfo.list = [
    { symbol: 'BTCUSDT', contractType: 'LinearFutures', fundingInterval: 0, upperFundingRate: '0' },
  ];
  const r = normalizeBundle(b).find((x) => x.asset === 'BTC' && x.venue === 'bybit');
  assert.equal(r.state, 'ok'); // falls back to the ticker's fundingIntervalHour
  assert.equal(r.intervalHours, 8);
  assert.ok(r.flags.some((f) => f.includes('ticker')));
});

// --- Carry / hurdle ----------------------------------------------------------

const INPUTS = {
  riskFree: 0.045,
  riskPremium: 0.05,
  perpFee: 0.00045,   // Hyperliquid taker
  spotFee: 0.0007,
  spotFinancing: 0,
  holdingDays: 30,
};

test('carry: fees amortize over the holding period; verdict = net − hurdle', () => {
  const v = assessCarry(get('ETH', 'hyperliquid'), INPUTS);
  assert.equal(v.direction, 'carry');
  close(v.costs, (2 * 0.0007 + 2 * 0.00045) * (365 / 30), 1e-12);
  close(v.netApr, 0.1095 - 0.0023 * (365 / 30), 1e-12);
  close(v.hurdle, 0.095);
  assert.equal(v.clears, false); // 8.15% net vs 9.5% hurdle at defaults
});

test('negative funding → reverse-carry state, never |rate| through the long-spot cost model', () => {
  const v = assessCarry(get('ETH', 'bybit'), INPUTS);
  assert.equal(v.direction, 'reverse');
  assert.equal(v.netApr, null);
  assert.equal(v.clears, null);
});

test('no spot leg → no verdict (OIL)', () => {
  const v = assessCarry(get('OIL', 'hyperliquid'), INPUTS);
  assert.equal(v.direction, 'no-spot');
  assert.equal(v.clears, null);
});

test('financing + rf double-count is detected', () => {
  assert.equal(financingDoubleCount(INPUTS), false);
  assert.equal(financingDoubleCount({ ...INPUTS, spotFinancing: 0.02 }), true);
});

// --- Cross-venue spread --------------------------------------------------------

test('spread: short highest APR, long lowest; 4 perp fills at per-venue fees', () => {
  const ethRows = rows.filter((r) => r.asset === 'ETH' && r.state === 'ok');
  const s = assessSpread('ETH', ethRows, {
    riskFree: 0.045,
    riskPremium: 0.05,
    holdingDays: 30,
    perpFeeByVenue: { hyperliquid: 0.00045, binance: 0.0005, bybit: 0.00055 },
  });
  assert.equal(s.shortVenue, 'hyperliquid'); // 10.95% APR
  assert.equal(s.longVenue, 'bybit');        // −1.84% APR
  close(s.spreadApr, 0.1095 - -0.00001681 * 1095, 1e-9);
  close(s.costs, (2 * 0.00045 + 2 * 0.00055) * (365 / 30), 1e-12);
  assert.equal(s.clears, true); // ≈10.4% net vs 9.5% hurdle
});

test('spread needs at least two live venues', () => {
  const oil = rows.filter((r) => r.asset === 'OIL' && r.state === 'ok');
  assert.equal(assessSpread('OIL', oil, { riskFree: 0.045, riskPremium: 0.05, holdingDays: 30, perpFeeByVenue: {} }), null);
});

// --- Cost amortization sanity ---------------------------------------------------

test('annualizedCosts is dimensionally annual (365/holdingDays scaling)', () => {
  const c30 = annualizedCosts({ feeEvents: [0.001], holdingDays: 30 });
  const c365 = annualizedCosts({ feeEvents: [0.001], holdingDays: 365 });
  close(c30 / c365, 365 / 30);
  assert.throws(() => annualizedCosts({ feeEvents: [0.001], holdingDays: 0 }));
});

// --- Display ranking (the decision metric is NET margin, never gross) -----------

const FULL_INPUTS = {
  riskFree: 0.045,
  riskPremium: 0.05,
  spotFee: 0.0007,
  spotFinancing: 0,
  holdingDays: 30,
  perpFeeByVenue: { hyperliquid: 0.00045, binance: 0.0005, bybit: 0.00055 },
};

const RANK_UNIVERSE = [
  { id: 'A', label: 'A', name: 'Asset A' },
  { id: 'B', label: 'B', name: 'Asset B' },
  { id: 'C', label: 'C', name: 'Asset C' },
];

const mkRow = (asset, venue, aprGross, { state = 'ok', spotAvailable = true } = {}) =>
  ({ asset, venue, state, aprGross, spotAvailable, intervalHours: 8, flags: [] });

// A: one clean carry (+2.70% margin). B: every carry is reverse (negative
// funding) but the cross-venue spread is fat (+16.2% margin). C: not listed
// anywhere. The right order is B, A, C — a carry-only ranking would bury B.
const RANK_ROWS = [
  mkRow('A', 'hyperliquid', 0.15),
  mkRow('B', 'hyperliquid', -0.02),
  mkRow('B', 'binance', -0.30),
  mkRow('C', 'hyperliquid', null, { state: 'notListed' }),
  mkRow('C', 'binance', null, { state: 'notListed' }),
];

test('rankAssets orders by best net margin across BOTH carry and spread', () => {
  const ranked = rankAssets(RANK_UNIVERSE, RANK_ROWS, FULL_INPUTS);
  assert.deepEqual(ranked.map((g) => g.asset.id), ['B', 'A', 'C']);
  close(ranked[0].bestMargin, 0.28 - 0.0019 * (365 / 30) - 0.095, 1e-9); // B's spread
  close(ranked[1].bestMargin, 0.15 - 0.0023 * (365 / 30) - 0.095, 1e-9); // A's carry
  assert.equal(ranked[2].bestMargin, -Infinity); // C sinks
});

test('rankAssets: assets with no numeric verdict tie stably in universe order', () => {
  const uni = [
    { id: 'X', label: 'X', name: 'X' },
    { id: 'Y', label: 'Y', name: 'Y' },
  ];
  const ranked = rankAssets(uni, [
    mkRow('X', 'hyperliquid', null, { state: 'notListed' }),
    mkRow('Y', 'hyperliquid', null, { state: 'notListed' }),
  ], FULL_INPUTS);
  assert.deepEqual(ranked.map((g) => g.asset.id), ['X', 'Y']);
});

test('rankRows: states first, then margin desc, then verdictless, then gross', () => {
  const group = [
    mkRow('A', 'bybit', 0.08),                            // carry, small margin
    mkRow('A', 'hyperliquid', 0.15),                      // carry, big margin
    mkRow('A', 'binance', -0.10),                         // reverse — no verdict
    mkRow('A', 'okx', null, { state: 'unavailable' }),    // degraded state
  ];
  const carry = new Map([
    ['bybit', { margin: -0.02 }],
    ['hyperliquid', { margin: 0.03 }],
    ['binance', { margin: null }],
  ]);
  const ordered = rankRows(group, carry).map((r) => r.venue);
  assert.deepEqual(ordered, ['hyperliquid', 'bybit', 'binance', 'okx']);
});

test('bestOpportunity picks the max-margin trade across both tables', () => {
  const best = bestOpportunity(rankAssets(RANK_UNIVERSE, RANK_ROWS, FULL_INPUTS));
  assert.equal(best.kind, 'spread');
  assert.equal(best.asset.id, 'B');
  assert.equal(best.shortVenue, 'hyperliquid'); // −2% funding is the RICH leg here
  assert.equal(best.longVenue, 'binance');
  assert.equal(best.clears, true);
});

test('bestOpportunity: when nothing clears it still names the closest miss', () => {
  const highHurdle = { ...FULL_INPUTS, riskPremium: 0.50 };
  const best = bestOpportunity(rankAssets(RANK_UNIVERSE, RANK_ROWS, highHurdle));
  assert.equal(best.asset.id, 'B'); // still the best margin, just negative
  assert.equal(best.clears, false);
});

test('bestOpportunity: null when no row yields a numeric verdict', () => {
  assert.equal(bestOpportunity(rankAssets(RANK_UNIVERSE, [], FULL_INPUTS)), null);
});

// --- Input persistence (sanitize is the trust boundary) --------------------------

test('sanitizeInputs: garbage in, defaults out (never throws, never aliases)', () => {
  const out = sanitizeInputs('nonsense', DEFAULT_INPUTS);
  assert.deepEqual(out, DEFAULT_INPUTS);
  assert.notEqual(out, DEFAULT_INPUTS);
  assert.notEqual(out.perpFeePct, DEFAULT_INPUTS.perpFeePct);
  assert.deepEqual(sanitizeInputs(null, DEFAULT_INPUTS), DEFAULT_INPUTS);
  assert.deepEqual(sanitizeInputs([], DEFAULT_INPUTS), DEFAULT_INPUTS);
});

test('sanitizeInputs: partial stored objects merge over defaults', () => {
  const out = sanitizeInputs({ riskFreePct: 3.1, perpFeePct: { binance: 0.02 } }, DEFAULT_INPUTS);
  assert.equal(out.riskFreePct, 3.1);
  assert.equal(out.perpFeePct.binance, 0.02);
  assert.equal(out.perpFeePct.bybit, DEFAULT_INPUTS.perpFeePct.bybit);
  assert.equal(out.riskPremiumPct, DEFAULT_INPUTS.riskPremiumPct);
});

test('sanitizeInputs: rejects NaN, negatives, sub-minimum days, wrong types, unknown keys', () => {
  const out = sanitizeInputs(
    { riskFreePct: -1, riskPremiumPct: NaN, holdingDays: 0, spotFeePct: '0.5', perpFeePct: { bybit: 'x', okx: 1 }, hax: 1 },
    DEFAULT_INPUTS,
  );
  assert.deepEqual(out, DEFAULT_INPUTS);
  assert.equal('hax' in out, false);
  assert.equal('okx' in out.perpFeePct, false);
});

test('loadInputs survives corrupt JSON and a throwing storage', () => {
  assert.deepEqual(loadInputs({ getItem: () => '{not json' }, DEFAULT_INPUTS), DEFAULT_INPUTS);
  assert.deepEqual(loadInputs({ getItem: () => { throw new Error('denied'); } }, DEFAULT_INPUTS), DEFAULT_INPUTS);
  assert.deepEqual(loadInputs(null, DEFAULT_INPUTS), DEFAULT_INPUTS);
  const stored = JSON.stringify({ riskFreePct: 9 });
  assert.equal(loadInputs({ getItem: () => stored }, DEFAULT_INPUTS).riskFreePct, 9);
});

// --- CSV export -------------------------------------------------------------------

const AS_OF = '2026-07-05T09:56:26.953Z';

test('toCsv: BOM + header + one exact row for a verdictless cell (golden)', () => {
  const uni = [{ id: 'Z', label: 'Z', name: 'Z' }];
  const zRows = [{ asset: 'Z', venue: 'binance', state: 'notListed', aprGross: null, spotAvailable: true, flags: [] }];
  const csv = toCsv(rankAssets(uni, zRows, FULL_INPUTS), { asOfUtc: AS_OF });
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(
    csv.slice(1),
    `${CSV_HEADER}\r\ncarry,Z,binance,notListed,,,,,,,${AS_OF}\r\n`,
  );
});

test('toCsv: raw decimals for verdict rows, spread rows discriminated by table column', () => {
  const csv = toCsv(rankAssets(RANK_UNIVERSE, RANK_ROWS, FULL_INPUTS), { asOfUtc: AS_OF });
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines[0], CSV_HEADER);
  // Ranked order is B (2 carry rows + 1 spread), A (1 carry), C (2 notListed).
  const spread = lines.find((l) => l.startsWith('spread,'));
  const cols = spread.split(',');
  assert.equal(cols[1], 'B');
  assert.equal(cols[2], 'short hyperliquid / long binance');
  close(Number(cols[6]), 0.28, 1e-12);            // spread_apr as a raw decimal
  assert.equal(cols[9], 'true');                  // clears
  const aCarry = lines.find((l) => l.startsWith('carry,A,'));
  const aCols = aCarry.split(',');
  assert.equal(aCols[5], '8');                    // interval_h
  close(Number(aCols[6]), 0.15, 1e-12);           // apr_gross raw, not "15.00%"
  assert.equal(aCols[9], 'true');                 // 12.2% net clears the 9.5% hurdle
});

test('toCsv: fields containing commas or quotes are CSV-quoted', () => {
  const uni = [{ id: 'A,B', label: 'AB', name: 'AB' }];
  const qRows = [{ asset: 'A,B', venue: 'binance', state: 'notListed', aprGross: null, spotAvailable: true, flags: [] }];
  const csv = toCsv(rankAssets(uni, qRows, FULL_INPUTS), { asOfUtc: 'a"b' });
  assert.ok(csv.includes('"A,B"'));
  assert.ok(csv.includes('"a""b"'));
});

// --- History accumulation ------------------------------------------------------

test('appendHistory: appends ok-state rows only, idempotent per capture', () => {
  const bundle = cloneBundle();
  bundle.generatedAt = AS_OF;
  const one = appendHistory(null, bundle);
  assert.equal(one.version, 1);
  assert.equal(one.points.length, 1);
  assert.equal(one.points[0].t, AS_OF);
  assert.ok(one.points[0].rows.length > 0);
  assert.ok(one.points[0].rows.every((r) => 'a' in r && 'v' in r && 'rate' in r && 'ih' in r));
  assert.ok(!one.points[0].rows.some((r) => r.a === 'OIL' && r.v === 'binance')); // notListed excluded
  const two = appendHistory(one, bundle);
  assert.equal(two.points.length, 1); // same generatedAt → no duplicate
});

test('appendHistory: caps retention to capDays behind the newest capture', () => {
  const bundle = cloneBundle();
  bundle.generatedAt = AS_OF;
  const old = { version: 1, points: [
    { t: '2026-05-01T00:00:00.000Z', rows: [] },  // 65 days old → dropped
    { t: '2026-07-01T00:00:00.000Z', rows: [] },  // 4 days old → kept
  ] };
  const out = appendHistory(old, bundle, 28);
  assert.deepEqual(out.points.map((p) => p.t), ['2026-07-01T00:00:00.000Z', AS_OF]);
});

test('appendHistory: corrupt existing file or bundle degrades, never throws', () => {
  const bundle = cloneBundle();
  bundle.generatedAt = AS_OF;
  assert.equal(appendHistory('garbage', bundle).points.length, 1);
  assert.equal(appendHistory({ points: 'nope' }, bundle).points.length, 1);
  assert.deepEqual(appendHistory({ points: [] }, { generatedAt: 'not a date' }).points, []);
});
