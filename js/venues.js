// ---------------------------------------------------------------------------
// venues.js — per-venue funding conventions, with citations.
//
// THE CORRECTNESS CORE OF THIS PROJECT. Every claim below was verified on
// 2026-07-05 against the venue's official documentation AND live API
// responses. Funding INTERVALS are per-symbol data, not per-venue constants —
// the values here are defaults/documentation; normalize.js always carries the
// actual interval on each row and compute.js refuses to annualize without one.
// ---------------------------------------------------------------------------

export const HOURS_PER_YEAR = 24 * 365; // 8760 — simple (non-compounded) annualization

// Hyperliquid's fixed interest component, quoted per hour: 0.01% per 8h paid
// ⅛ hourly. Whenever a core perp's premium sits inside the ±0.05% clamp band
// — the resting state for liquid majors in a calm market — funding pins at
// EXACTLY this value, so many/all majors showing an identical 0.00125%/1h is
// real data, not a placeholder. Rows pinned here get a "floor" chip in the UI.
export const HL_INTEREST_FLOOR_HOURLY = 0.0000125;

export const VENUES = {
  // -------------------------------------------------------------------------
  // HYPERLIQUID — funding is paid EVERY HOUR on every perp (incl. HIP-3).
  //
  // The docs quote the funding FORMULA on an 8-hour basis, paid at 1/8 each
  // hour:
  //   "The funding rate formula applies to 8 hour funding rate. However,
  //    funding is paid every hour at one eighth of the computed rate for
  //    each hour."      — https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding
  //
  // CRITICAL: that 8-hour language describes only the internal computation.
  // Every rate the API actually returns (fundingHistory.fundingRate,
  // metaAndAssetCtxs assetCtx.funding, predictedFundings HlPerp) is the
  // ALREADY-DIVIDED HOURLY rate as charged. Verified empirically 2026-07-05:
  // ETH fundingHistory = predictedFundings HlPerp = 0.0000125 (ratio 1.00,
  // not ~8x), and 0.0000125 = exactly 1/8 of the 0.01%-per-8h interest
  // component. So:
  //   APR = rate x 8760.
  // Annualizing as if 8h-basis (x1095) would UNDERSTATE 8x; multiplying by 8
  // first and then x8760 would OVERSTATE 8x. Do neither.
  //
  // Other doc-verified facts:
  //  - Formula: F = avg premium + clamp(interest - premium, -0.05%, +0.05%),
  //    interest fixed at 0.01% per 8h (0.00125%/h) for core perps.
  //  - Cap: "Funding on Hyperliquid is capped at 4%/hour." (asset-independent)
  //  - Notional: "position_size * oracle_price * funding_rate ... the spot
  //    oracle price is used to convert the position size to notional value,
  //    not the mark price."
  //  - HIP-3 builder markets (e.g. xyz:CL): same hourly cadence; the returned
  //    rate ALREADY includes the deployer's funding multiplier (xyz uses 0.5)
  //    — never rescale it. Deployer also sets the oracle.
  // -------------------------------------------------------------------------
  hyperliquid: {
    id: 'hyperliquid',
    name: 'Hyperliquid',
    defaultIntervalHours: 1,
    cap: '4% per hour',
    notional: 'position × spot oracle price (not mark)',
    docsUrl: 'https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding',
  },

  // -------------------------------------------------------------------------
  // BINANCE USDⓈ-M — funding settles per SYMBOL interval: 8h default at
  // 00:00/08:00/16:00 UTC, but 4h is now the MAJORITY (438 of 711 fundingInfo
  // entries on 2026-07-05; HYPEUSDT is 4h while BTC/ETH are 8h; four symbols
  // are 1h).
  //   "The default funding interval is every 8 hours ... Binance reserves the
  //    right to update the funding interval"
  //      — https://www.binance.com/en/support/faq/detail/360033525031
  //
  // The API rate (premiumIndex.lastFundingRate) is quoted PER THAT SYMBOL'S
  // OWN INTERVAL and is the real-time ESTIMATE for the upcoming settlement
  // (verified ≠ last settled value). Formula divisor /(8/N) already scales it:
  //   "Funding Rate (F) = [Average Premium Index (P) + clamp(interest rate -
  //    Premium Index (P), 0.05%, -0.05%)] / (8 / N)"
  //   APR = rate x (24 / intervalHours) x 365.
  // Interval source of truth: GET /fapi/v1/fundingInfo .fundingIntervalHours
  // (symbol absent from that endpoint ⇒ 8h per the doc contract). NEVER infer
  // the interval from premiumIndex.interestRate (always 0.0001, 8h-basis even
  // on 4h symbols) or from nextFundingTime landing on 00/08/16 UTC (4h and 8h
  // grids coincide there). Notional: mark price ("Funding Amount = Nominal
  // Value of Positions * Funding Rate", nominal = mark x size). Per-symbol
  // caps in fundingInfo (BTC/ETH ±0.30%, default ±2%).
  // -------------------------------------------------------------------------
  binance: {
    id: 'binance',
    name: 'Binance USDⓈ-M',
    defaultIntervalHours: 8,
    cap: 'per symbol (fundingInfo): BTC/ETH ±0.30%, default ±2%',
    notional: 'position × mark price',
    docsUrl: 'https://www.binance.com/en/support/faq/detail/360033525031',
  },

  // -------------------------------------------------------------------------
  // BYBIT linear — funding settles per SYMBOL interval. BTC/ETH/HYPE were 8h
  // on 2026-07-05, but 411 of 713 linear instruments were on 4h and five on
  // 1h, and Bybit can flip a symbol to hourly when the rate pins at its cap:
  //   "the system will automatically switch the settlement frequency to once
  //    per hour" — https://www.bybitglobal.com/en/help-center/article/Introduction-to-Funding-Rate
  //
  // tickers.fundingRate is the rate for the upcoming settlement, quoted per
  // interval. Interval source of truth: instruments-info .fundingInterval —
  // in MINUTES ("fundingInterval integer Funding interval (minute)" —
  // https://bybit-exchange.github.io/docs/v5/market/instrument); the ticker's
  // fundingIntervalHour (whole hours) is a cross-check. Dated futures rows in
  // category=linear have contractType "LinearFutures" and fundingInterval 0 —
  // they pay no funding and MUST be filtered before annualizing.
  //   APR = rate x (8760 / intervalHours).
  // Notional: mark price ("Funding fee = Position value × Funding rate",
  // position value = qty × mark). Per-symbol caps (upper/lowerFundingRate;
  // BTC/ETH ±0.5%, HYPE ±0.63%). Host note: api.bybit.com is geo/ISP-blocked
  // on some networks (verified: Philippine ISP DNS-poisons it) —
  // api.bytick.com is the officially documented equivalent mainnet host.
  // -------------------------------------------------------------------------
  bybit: {
    id: 'bybit',
    name: 'Bybit linear',
    defaultIntervalHours: 8,
    cap: 'per symbol (instruments-info): BTC/ETH ±0.5%, HYPE ±0.63%',
    notional: 'position × mark price',
    docsUrl: 'https://bybit-exchange.github.io/docs/v5/market/instrument',
  },
};
