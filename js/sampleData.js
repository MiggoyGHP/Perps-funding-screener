// ---------------------------------------------------------------------------
// sampleData.js — SAMPLE bundle, clearly labeled as such in the UI.
//
// Shapes are byte-faithful to the real APIs (field names and structures were
// live-captured from each venue on 2026-07-05; several VALUES below are those
// actual captures). Numerics stay JSON strings exactly as the venues send
// them, so sample mode exercises the same parse path as snapshot/live.
//
// Deliberate illustrative properties:
//  - ETH/Bybit funding is negative  → demonstrates the reverse-carry state.
//  - HYPE/Binance settles 4-hourly  → demonstrates per-symbol intervals
//    (its fundingInfo entry says 4h while Hyperliquid's secondhand echo says
//    8h — demonstrating the flagged cross-check).
//  - OIL exists only as xyz:CL on Hyperliquid's HIP-3 "xyz" dex.
//  - The 8 majors added 2026-07-05 (SOL…BNB) mirror their live listing state:
//    all three venues, HL hourly, Binance/Bybit 8h; DOGE runs hot and AVAX/XRP
//    carry a negative leg so spreads and verdicts stay varied in sample mode.
// ---------------------------------------------------------------------------

export const SAMPLE_BUNDLE = {
  generatedAt: null, // sample data has no meaningful timestamp
  source: 'sample',
  errors: {},

  hyperliquid: {
    // POST /info {"type":"predictedFundings"} — filtered to the universe.
    predictedFundings: [
      ['BTC', [
        ['BinPerp', { fundingRate: '0.00009671', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
        ['HlPerp', { fundingRate: '0.0000125', nextFundingTime: 1783242000000, fundingIntervalHours: 1 }],
        ['BybitPerp', { fundingRate: '0.00004476', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
      ]],
      ['ETH', [
        ['BinPerp', { fundingRate: '0.00004884', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
        ['HlPerp', { fundingRate: '0.0000125', nextFundingTime: 1783242000000, fundingIntervalHours: 1 }],
        ['BybitPerp', { fundingRate: '-0.00001538', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
      ]],
      ['HYPE', [
        ['BinPerp', { fundingRate: '0.00005000', nextFundingTime: 1783252800000, fundingIntervalHours: 8 }],
        ['HlPerp', { fundingRate: '0.0000162', nextFundingTime: 1783242000000, fundingIntervalHours: 1 }],
        ['BybitPerp', { fundingRate: '-0.00003761', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
      ]],
      ['SOL', [
        ['BinPerp', { fundingRate: '0.00008000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
        ['HlPerp', { fundingRate: '0.0000125', nextFundingTime: 1783242000000, fundingIntervalHours: 1 }],
        ['BybitPerp', { fundingRate: '0.00003000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
      ]],
      ['XRP', [
        ['BinPerp', { fundingRate: '0.00002000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
        ['HlPerp', { fundingRate: '0.0000125', nextFundingTime: 1783242000000, fundingIntervalHours: 1 }],
        ['BybitPerp', { fundingRate: '-0.00002000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
      ]],
      ['DOGE', [
        ['BinPerp', { fundingRate: '0.00012000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
        ['HlPerp', { fundingRate: '0.0000200', nextFundingTime: 1783242000000, fundingIntervalHours: 1 }],
        ['BybitPerp', { fundingRate: '0.00009000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
      ]],
      ['LINK', [
        ['BinPerp', { fundingRate: '0.00005000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
        ['HlPerp', { fundingRate: '0.0000125', nextFundingTime: 1783242000000, fundingIntervalHours: 1 }],
        ['BybitPerp', { fundingRate: '0.00004000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
      ]],
      ['AVAX', [
        ['BinPerp', { fundingRate: '-0.00003000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
        ['HlPerp', { fundingRate: '0.0000100', nextFundingTime: 1783242000000, fundingIntervalHours: 1 }],
        ['BybitPerp', { fundingRate: '0.00001000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
      ]],
      ['SUI', [
        ['BinPerp', { fundingRate: '0.00007000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
        ['HlPerp', { fundingRate: '0.0000160', nextFundingTime: 1783242000000, fundingIntervalHours: 1 }],
        ['BybitPerp', { fundingRate: '0.00006000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
      ]],
      ['LTC', [
        ['BinPerp', { fundingRate: '0.00001000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
        ['HlPerp', { fundingRate: '0.0000125', nextFundingTime: 1783242000000, fundingIntervalHours: 1 }],
        ['BybitPerp', { fundingRate: '0.00001000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
      ]],
      ['BNB', [
        ['BinPerp', { fundingRate: '0.00003000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
        ['HlPerp', { fundingRate: '0.0000125', nextFundingTime: 1783242000000, fundingIntervalHours: 1 }],
        ['BybitPerp', { fundingRate: '0.00002000', nextFundingTime: 1783267200000, fundingIntervalHours: 8 }],
      ]],
    ],

    // POST /info {"type":"metaAndAssetCtxs","dex":"xyz"} — [meta, assetCtxs]
    // parallel arrays joined by index; filtered to the oil market.
    xyzMetaAndAssetCtxs: [
      { universe: [{ name: 'xyz:CL', maxLeverage: 20, marginTableId: 20 }] },
      [{
        funding: '0.00000625',
        openInterest: '182406.0',
        premium: '0.0001942421',
        oraclePx: '64.51',
        markPx: '64.54',
        midPx: '64.535',
        impactPxs: ['64.52', '64.55'],
      }],
    ],
  },

  binance: {
    // GET /fapi/v1/premiumIndex?symbol=... (one object per configured symbol)
    premiumIndex: [
      { symbol: 'BTCUSDT', markPrice: '62860.40000000', indexPrice: '62880.91152174', estimatedSettlePrice: '62926.21927488', lastFundingRate: '0.00009671', interestRate: '0.00010000', nextFundingTime: 1783267200000, time: 1783242537000 },
      { symbol: 'ETHUSDT', markPrice: '1766.45558140', indexPrice: '1767.13651163', estimatedSettlePrice: '1767.81373243', lastFundingRate: '0.00004884', interestRate: '0.00010000', nextFundingTime: 1783267200000, time: 1783242540000 },
      { symbol: 'HYPEUSDT', markPrice: '68.93419286', indexPrice: '68.95850000', estimatedSettlePrice: '68.85561698', lastFundingRate: '0.00005000', interestRate: '0.00010000', nextFundingTime: 1783252800000, time: 1783242543000 },
      { symbol: 'SOLUSDT', markPrice: '181.24000000', indexPrice: '181.31000000', estimatedSettlePrice: '181.20000000', lastFundingRate: '0.00008000', interestRate: '0.00010000', nextFundingTime: 1783267200000, time: 1783242543000 },
      { symbol: 'XRPUSDT', markPrice: '2.81400000', indexPrice: '2.81550000', estimatedSettlePrice: '2.81300000', lastFundingRate: '0.00002000', interestRate: '0.00010000', nextFundingTime: 1783267200000, time: 1783242543000 },
      { symbol: 'DOGEUSDT', markPrice: '0.31820000', indexPrice: '0.31840000', estimatedSettlePrice: '0.31800000', lastFundingRate: '0.00012000', interestRate: '0.00010000', nextFundingTime: 1783267200000, time: 1783242543000 },
      { symbol: 'LINKUSDT', markPrice: '22.06000000', indexPrice: '22.08000000', estimatedSettlePrice: '22.05000000', lastFundingRate: '0.00005000', interestRate: '0.00010000', nextFundingTime: 1783267200000, time: 1783242543000 },
      { symbol: 'AVAXUSDT', markPrice: '38.42000000', indexPrice: '38.45000000', estimatedSettlePrice: '38.40000000', lastFundingRate: '-0.00003000', interestRate: '0.00010000', nextFundingTime: 1783267200000, time: 1783242543000 },
      { symbol: 'SUIUSDT', markPrice: '4.21500000', indexPrice: '4.21800000', estimatedSettlePrice: '4.21400000', lastFundingRate: '0.00007000', interestRate: '0.00010000', nextFundingTime: 1783267200000, time: 1783242543000 },
      { symbol: 'LTCUSDT', markPrice: '94.80000000', indexPrice: '94.86000000', estimatedSettlePrice: '94.78000000', lastFundingRate: '0.00001000', interestRate: '0.00010000', nextFundingTime: 1783267200000, time: 1783242543000 },
      { symbol: 'BNBUSDT', markPrice: '642.10000000', indexPrice: '642.40000000', estimatedSettlePrice: '642.00000000', lastFundingRate: '0.00003000', interestRate: '0.00010000', nextFundingTime: 1783267200000, time: 1783242543000 },
    ],
    // GET /fapi/v1/fundingInfo — authoritative per-symbol funding intervals.
    // Note HYPEUSDT: 4 hours, not the 8h default.
    fundingInfo: [
      { symbol: 'BTCUSDT', adjustedFundingRateCap: '0.00300', adjustedFundingRateFloor: '-0.00300', fundingIntervalHours: 8, disclaimer: true, updateTime: null },
      { symbol: 'ETHUSDT', adjustedFundingRateCap: '0.00300', adjustedFundingRateFloor: '-0.00300', fundingIntervalHours: 8, disclaimer: true, updateTime: null },
      { symbol: 'HYPEUSDT', adjustedFundingRateCap: '0.02000000', adjustedFundingRateFloor: '-0.02000000', fundingIntervalHours: 4, disclaimer: false, updateTime: 1748601134819 },
      { symbol: 'SOLUSDT', adjustedFundingRateCap: '0.02000000', adjustedFundingRateFloor: '-0.02000000', fundingIntervalHours: 8, disclaimer: false, updateTime: 1748601134819 },
      { symbol: 'XRPUSDT', adjustedFundingRateCap: '0.02000000', adjustedFundingRateFloor: '-0.02000000', fundingIntervalHours: 8, disclaimer: false, updateTime: 1748601134819 },
      { symbol: 'DOGEUSDT', adjustedFundingRateCap: '0.02000000', adjustedFundingRateFloor: '-0.02000000', fundingIntervalHours: 8, disclaimer: false, updateTime: 1748601134819 },
      { symbol: 'LINKUSDT', adjustedFundingRateCap: '0.02000000', adjustedFundingRateFloor: '-0.02000000', fundingIntervalHours: 8, disclaimer: false, updateTime: 1748601134819 },
      { symbol: 'AVAXUSDT', adjustedFundingRateCap: '0.02000000', adjustedFundingRateFloor: '-0.02000000', fundingIntervalHours: 8, disclaimer: false, updateTime: 1748601134819 },
      { symbol: 'SUIUSDT', adjustedFundingRateCap: '0.02000000', adjustedFundingRateFloor: '-0.02000000', fundingIntervalHours: 8, disclaimer: false, updateTime: 1748601134819 },
      { symbol: 'LTCUSDT', adjustedFundingRateCap: '0.02000000', adjustedFundingRateFloor: '-0.02000000', fundingIntervalHours: 8, disclaimer: false, updateTime: 1748601134819 },
      { symbol: 'BNBUSDT', adjustedFundingRateCap: '0.02000000', adjustedFundingRateFloor: '-0.02000000', fundingIntervalHours: 8, disclaimer: false, updateTime: 1748601134819 },
    ],
  },

  bybit: {
    // GET /v5/market/tickers?category=linear&symbol=... → result
    tickers: {
      category: 'linear',
      list: [
        { symbol: 'BTCUSDT', markPrice: '62861.88', indexPrice: '62889.62', fundingRate: '0.00004476', nextFundingTime: '1783267200000', fundingIntervalHour: '8', fundingCap: '0.005' },
        { symbol: 'ETHUSDT', markPrice: '1766.23', indexPrice: '1767.36', fundingRate: '-0.00001681', nextFundingTime: '1783267200000', fundingIntervalHour: '8', fundingCap: '0.005' },
        { symbol: 'HYPEUSDT', markPrice: '68.800', indexPrice: '68.958', fundingRate: '-0.00003761', nextFundingTime: '1783267200000', fundingIntervalHour: '8', fundingCap: '0.0063' },
        { symbol: 'SOLUSDT', markPrice: '181.20', indexPrice: '181.33', fundingRate: '0.00003000', nextFundingTime: '1783267200000', fundingIntervalHour: '8', fundingCap: '0.02' },
        { symbol: 'XRPUSDT', markPrice: '2.8135', indexPrice: '2.8158', fundingRate: '-0.00002000', nextFundingTime: '1783267200000', fundingIntervalHour: '8', fundingCap: '0.02' },
        { symbol: 'DOGEUSDT', markPrice: '0.31815', indexPrice: '0.31842', fundingRate: '0.00009000', nextFundingTime: '1783267200000', fundingIntervalHour: '8', fundingCap: '0.02' },
        { symbol: 'LINKUSDT', markPrice: '22.055', indexPrice: '22.079', fundingRate: '0.00004000', nextFundingTime: '1783267200000', fundingIntervalHour: '8', fundingCap: '0.02' },
        { symbol: 'AVAXUSDT', markPrice: '38.415', indexPrice: '38.448', fundingRate: '0.00001000', nextFundingTime: '1783267200000', fundingIntervalHour: '8', fundingCap: '0.02' },
        { symbol: 'SUIUSDT', markPrice: '4.2148', indexPrice: '4.2181', fundingRate: '0.00006000', nextFundingTime: '1783267200000', fundingIntervalHour: '8', fundingCap: '0.02' },
        { symbol: 'LTCUSDT', markPrice: '94.78', indexPrice: '94.87', fundingRate: '0.00001000', nextFundingTime: '1783267200000', fundingIntervalHour: '8', fundingCap: '0.02' },
        { symbol: 'BNBUSDT', markPrice: '641.90', indexPrice: '642.35', fundingRate: '0.00002000', nextFundingTime: '1783267200000', fundingIntervalHour: '8', fundingCap: '0.02' },
      ],
    },
    // GET /v5/market/instruments-info?category=linear&symbol=... → result
    // fundingInterval is in MINUTES.
    instrumentsInfo: {
      category: 'linear',
      list: [
        { symbol: 'BTCUSDT', contractType: 'LinearPerpetual', status: 'Trading', fundingInterval: 480, settleCoin: 'USDT', upperFundingRate: '0.005', lowerFundingRate: '-0.005' },
        { symbol: 'ETHUSDT', contractType: 'LinearPerpetual', status: 'Trading', fundingInterval: 480, settleCoin: 'USDT', upperFundingRate: '0.005', lowerFundingRate: '-0.005' },
        { symbol: 'HYPEUSDT', contractType: 'LinearPerpetual', status: 'Trading', fundingInterval: 480, settleCoin: 'USDT', upperFundingRate: '0.0063', lowerFundingRate: '-0.0063' },
        { symbol: 'SOLUSDT', contractType: 'LinearPerpetual', status: 'Trading', fundingInterval: 480, settleCoin: 'USDT', upperFundingRate: '0.02', lowerFundingRate: '-0.02' },
        { symbol: 'XRPUSDT', contractType: 'LinearPerpetual', status: 'Trading', fundingInterval: 480, settleCoin: 'USDT', upperFundingRate: '0.02', lowerFundingRate: '-0.02' },
        { symbol: 'DOGEUSDT', contractType: 'LinearPerpetual', status: 'Trading', fundingInterval: 480, settleCoin: 'USDT', upperFundingRate: '0.02', lowerFundingRate: '-0.02' },
        { symbol: 'LINKUSDT', contractType: 'LinearPerpetual', status: 'Trading', fundingInterval: 480, settleCoin: 'USDT', upperFundingRate: '0.02', lowerFundingRate: '-0.02' },
        { symbol: 'AVAXUSDT', contractType: 'LinearPerpetual', status: 'Trading', fundingInterval: 480, settleCoin: 'USDT', upperFundingRate: '0.02', lowerFundingRate: '-0.02' },
        { symbol: 'SUIUSDT', contractType: 'LinearPerpetual', status: 'Trading', fundingInterval: 480, settleCoin: 'USDT', upperFundingRate: '0.02', lowerFundingRate: '-0.02' },
        { symbol: 'LTCUSDT', contractType: 'LinearPerpetual', status: 'Trading', fundingInterval: 480, settleCoin: 'USDT', upperFundingRate: '0.02', lowerFundingRate: '-0.02' },
        { symbol: 'BNBUSDT', contractType: 'LinearPerpetual', status: 'Trading', fundingInterval: 480, settleCoin: 'USDT', upperFundingRate: '0.02', lowerFundingRate: '-0.02' },
      ],
    },
  },
};
