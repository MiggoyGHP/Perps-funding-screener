// Run: node --test tests/
// Golden values come from live API captures taken 2026-07-05 during the
// convention-verification research pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { annualize, annualizedCosts, assessCarry, assessSpread, financingDoubleCount } from '../js/compute.js';
import { normalizeBundle } from '../js/normalize.js';
import { SAMPLE_BUNDLE } from '../js/sampleData.js';

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
  assert.equal(rows.length, 4 * 3);
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
  assert.equal(rows2.length, 12);
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
