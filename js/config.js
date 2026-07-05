// ---------------------------------------------------------------------------
// config.js — the single place to change what the screener watches and where
// its data comes from.
// ---------------------------------------------------------------------------

// THE one-line swap: 'sample' | 'snapshot' | 'live'
//   sample   — baked-in illustrative data (shaped exactly like real responses)
//   snapshot — ./data/snapshot.json written by scripts/fetch-snapshot.mjs
//              (falls back to sample if missing/unreadable)
//   live     — fetch venue APIs directly from the browser (local dev; on some
//              networks api.bybit.com is ISP-blocked — bytick fallback built in)
export const DATA_MODE = 'snapshot';

// Snapshot older than this shows a staleness warning in the badge.
export const STALE_AFTER_HOURS = 24;

export const VENUE_IDS = ['hyperliquid', 'binance', 'bybit'];

// Expected-listings matrix, verified against live venue symbol lists on
// 2026-07-05. A venue key present = listed there (with the exact API symbol);
// venue key absent = "not listed". This matrix is what separates a true
// "not listed" cell from a "data unavailable" cell: absence of data for a
// listed market must NEVER render as "not listed".
export const UNIVERSE = [
  {
    id: 'BTC',
    label: 'BTC',
    name: 'Bitcoin',
    hyperliquid: { coin: 'BTC' },
    binance: { symbol: 'BTCUSDT' },
    bybit: { symbol: 'BTCUSDT' },
    spot: { available: true, note: 'Deep spot on every major venue.' },
  },
  {
    id: 'ETH',
    label: 'ETH',
    name: 'Ether',
    hyperliquid: { coin: 'ETH' },
    binance: { symbol: 'ETHUSDT' },
    bybit: { symbol: 'ETHUSDT' },
    spot: { available: true, note: 'Deep spot on every major venue.' },
  },
  {
    id: 'HYPE',
    label: 'HYPE',
    name: 'Hyperliquid',
    hyperliquid: { coin: 'HYPE' },
    binance: { symbol: 'HYPEUSDT' }, // perp only — Binance lists no HYPE spot
    bybit: { symbol: 'HYPEUSDT' },
    spot: {
      available: true,
      note: 'Spot on Hyperliquid (HYPE/USDC, native) and Bybit spot. No Binance spot as of 2026-07-05.',
    },
  },
  // The 8 below were verified 2026-07-05 against live symbol lists (HL
  // predictedFundings; Binance premiumIndex + fundingInfo; Bybit
  // instruments-info, contractType LinearPerpetual): each is listed on all
  // three venues. Intervals at verification time: HL 1h; Binance 8h
  // (authoritative fundingInfo entries present); Bybit 480 min.
  {
    id: 'SOL',
    label: 'SOL',
    name: 'Solana',
    hyperliquid: { coin: 'SOL' },
    binance: { symbol: 'SOLUSDT' },
    bybit: { symbol: 'SOLUSDT' },
    spot: { available: true, note: 'Deep spot on every major venue.' },
  },
  {
    id: 'XRP',
    label: 'XRP',
    name: 'XRP',
    hyperliquid: { coin: 'XRP' },
    binance: { symbol: 'XRPUSDT' },
    bybit: { symbol: 'XRPUSDT' },
    spot: { available: true, note: 'Deep spot on every major venue.' },
  },
  {
    id: 'DOGE',
    label: 'DOGE',
    name: 'Dogecoin',
    hyperliquid: { coin: 'DOGE' },
    binance: { symbol: 'DOGEUSDT' },
    bybit: { symbol: 'DOGEUSDT' },
    spot: { available: true, note: 'Deep spot on every major venue.' },
  },
  {
    id: 'LINK',
    label: 'LINK',
    name: 'Chainlink',
    hyperliquid: { coin: 'LINK' },
    binance: { symbol: 'LINKUSDT' },
    bybit: { symbol: 'LINKUSDT' },
    spot: { available: true, note: 'Deep spot on every major venue.' },
  },
  {
    id: 'AVAX',
    label: 'AVAX',
    name: 'Avalanche',
    hyperliquid: { coin: 'AVAX' },
    binance: { symbol: 'AVAXUSDT' },
    bybit: { symbol: 'AVAXUSDT' },
    spot: { available: true, note: 'Deep spot on every major venue.' },
  },
  {
    id: 'SUI',
    label: 'SUI',
    name: 'Sui',
    hyperliquid: { coin: 'SUI' },
    binance: { symbol: 'SUIUSDT' },
    bybit: { symbol: 'SUIUSDT' },
    spot: { available: true, note: 'Deep spot on Binance and Bybit.' },
  },
  {
    id: 'LTC',
    label: 'LTC',
    name: 'Litecoin',
    hyperliquid: { coin: 'LTC' },
    binance: { symbol: 'LTCUSDT' },
    bybit: { symbol: 'LTCUSDT' },
    spot: { available: true, note: 'Deep spot on every major venue.' },
  },
  {
    id: 'BNB',
    label: 'BNB',
    name: 'BNB',
    hyperliquid: { coin: 'BNB' },
    binance: { symbol: 'BNBUSDT' },
    bybit: { symbol: 'BNBUSDT' },
    spot: { available: true, note: 'Deep spot on Binance (native token) and Bybit.' },
  },
  {
    id: 'OIL',
    label: 'OIL (WTI)',
    name: 'WTI crude — synthetic',
    // HIP-3 builder-deployed market on the "xyz" dex (trade.xyz). Coin strings
    // are dex-prefixed. Pinned deliberately: km:USOIL, flx:OIL and cash:WTI
    // exist in the API but are DELISTED dead markets (verified 2026-07-05).
    hyperliquid: { coin: 'xyz:CL', dex: 'xyz', hip3: true },
    spot: {
      available: false,
      note: 'No spot leg exists: xyz:CL is an oracle-priced synthetic; there is no investable on-chain spot oil instrument, so classic cash-and-carry is infeasible.',
    },
  },
];

// Cost-model defaults. All adjustable in the UI; percentages are per fill
// (taker) except financing, which is an annual rate.
export const DEFAULT_INPUTS = {
  riskFreePct: 4.5,      // US risk-free, annual %
  riskPremiumPct: 5.0,   // judgment call — deliberately a control, not a constant
  perpFeePct: {          // taker fee per fill, per venue ("set to your tier")
    hyperliquid: 0.045,
    binance: 0.05,
    bybit: 0.055,
  },
  spotFeePct: 0.07,      // taker fee per fill on the spot leg
  spotFinancingPct: 0.0, // annual; 0 = unlevered cash (opportunity cost already in the hurdle's rf)
  holdingDays: 30,       // horizon that amortizes the one-off round-trip fees
};
