// ---------------------------------------------------------------------------
// compute.js — pure math. No fetching, no DOM, no venue knowledge beyond what
// arrives on each row. Everything here works in DECIMAL FRACTIONS
// (0.1095 = 10.95%); the UI converts its percent inputs before calling in.
// ---------------------------------------------------------------------------

import { HOURS_PER_YEAR } from './venues.js';

/**
 * Simple (non-compounded) annualization of a per-interval funding rate.
 * The interval is REQUIRED on every call — funding intervals are per-symbol
 * data (Binance HYPEUSDT settles 4-hourly while BTCUSDT settles 8-hourly),
 * so there is deliberately no default here.
 */
export function annualize(ratePerInterval, intervalHours) {
  if (!Number.isFinite(ratePerInterval)) {
    throw new Error(`annualize: ratePerInterval must be a finite number, got ${ratePerInterval}`);
  }
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
    throw new Error(`annualize: intervalHours must be > 0, got ${intervalHours}`);
  }
  return ratePerInterval * (HOURS_PER_YEAR / intervalHours);
}

/**
 * Annualized drag of one-off round-trip fees over the expected holding
 * period, plus spot financing. Fees are one-time costs; deducting them from
 * an annual rate is only dimensionally valid after amortizing across the
 * horizon: drag = roundTrip × (365 / holdingDays).
 *
 * feeEvents: array of per-fill fees (decimals). A classic carry round trip is
 * 4 fills: open+close spot, open+close perp.
 */
export function annualizedCosts({ feeEvents, holdingDays, financingApr = 0 }) {
  if (!Number.isFinite(holdingDays) || holdingDays <= 0) {
    throw new Error(`annualizedCosts: holdingDays must be > 0, got ${holdingDays}`);
  }
  const roundTrip = feeEvents.reduce((a, f) => a + f, 0);
  return roundTrip * (365 / holdingDays) + financingApr;
}

export function hurdleRate({ riskFree, riskPremium }) {
  return riskFree + riskPremium;
}

/**
 * Delta-neutral carry assessment for one (asset, venue) row.
 *
 * Sign convention (universal across venues): positive funding → longs pay
 * shorts. So the classic carry (long spot / short perp) RECEIVES positive
 * funding, and our cost model (spot fees + spot financing) matches that
 * direction. Negative funding reverses the trade to long perp / short spot,
 * which needs a spot BORROW we deliberately do not model — those rows get a
 * direction label instead of a fabricated verdict.
 *
 * inputs: { riskFree, riskPremium, perpFee (this venue), spotFee,
 *           spotFinancing, holdingDays } — all decimals.
 */
export function assessCarry(row, inputs) {
  const base = { asset: row.asset, venue: row.venue, grossApr: row.aprGross };

  if (!row.spotAvailable) {
    return { ...base, direction: 'no-spot', netApr: null, hurdle: null, margin: null, clears: null };
  }
  if (row.aprGross < 0) {
    return { ...base, direction: 'reverse', netApr: null, hurdle: null, margin: null, clears: null };
  }

  const costs = annualizedCosts({
    feeEvents: [inputs.spotFee, inputs.spotFee, inputs.perpFee, inputs.perpFee],
    holdingDays: inputs.holdingDays,
    financingApr: inputs.spotFinancing,
  });
  const netApr = row.aprGross - costs;
  const hurdle = hurdleRate(inputs);
  const margin = netApr - hurdle;
  return { ...base, direction: 'carry', costs, netApr, hurdle, margin, clears: margin >= 0 };
}

/**
 * When the spot leg is financed (financing > 0) while the hurdle still
 * charges rf on the same capital, the cost of capital is being counted
 * twice. We surface a warning rather than silently "fixing" the inputs.
 */
export function financingDoubleCount(inputs) {
  return inputs.spotFinancing > 0 && inputs.riskFree > 0;
}

/**
 * Cross-venue funding spread: short the perp on the highest-funding venue,
 * long the perp on the lowest. Both legs' APRs must arrive already
 * individually annualized by each leg's OWN interval. Costs are 4 perp fills
 * (open+close on each venue) at each venue's own fee. No spot leg, so no
 * spot financing and no rf-double-count concern on the legs.
 */
export function assessSpread(asset, okRows, inputs) {
  if (okRows.length < 2) return null;
  const sorted = [...okRows].sort((a, b) => b.aprGross - a.aprGross);
  const short = sorted[0];
  const long = sorted[sorted.length - 1];
  const spreadApr = short.aprGross - long.aprGross;
  const costs = annualizedCosts({
    feeEvents: [
      inputs.perpFeeByVenue[short.venue], inputs.perpFeeByVenue[short.venue],
      inputs.perpFeeByVenue[long.venue], inputs.perpFeeByVenue[long.venue],
    ],
    holdingDays: inputs.holdingDays,
  });
  const netApr = spreadApr - costs;
  const hurdle = hurdleRate(inputs);
  const margin = netApr - hurdle;
  return {
    asset,
    shortVenue: short.venue,
    longVenue: long.venue,
    shortApr: short.aprGross,
    longApr: long.aprGross,
    spreadApr,
    costs,
    netApr,
    hurdle,
    margin,
    clears: margin >= 0,
  };
}
