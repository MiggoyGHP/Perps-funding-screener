// ---------------------------------------------------------------------------
// fetchBundle.js — assembles the canonical raw bundle from the venues' PUBLIC
// read-only market-data endpoints (no keys, no accounts, no order routes).
//
// Runs unchanged in the browser (live mode) and in Node ≥18 (the snapshot
// script) — both have global fetch. Failures are captured per venue into
// bundle.errors so the UI can render an honest "data unavailable" state
// instead of fabricating "not listed".
// ---------------------------------------------------------------------------

import { UNIVERSE } from './config.js';

const HL_API = 'https://api.hyperliquid.xyz/info';
// api.bybit.com is geo/ISP-blocked on some networks (verified: DNS-poisoned on
// a Philippine ISP). api.bytick.com is an officially documented equivalent
// mainnet host — we try the primary first, then fall back.
const BYBIT_HOSTS = ['https://api.bybit.com', 'https://api.bytick.com'];
const BINANCE_API = 'https://fapi.binance.com';

const TIMEOUT_MS = 15000;

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return res.json();
}

function hlInfo(body) {
  return getJson(HL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const coreCoins = UNIVERSE.filter((a) => a.hyperliquid && !a.hyperliquid.hip3).map((a) => a.hyperliquid.coin);
const hip3Assets = UNIVERSE.filter((a) => a.hyperliquid?.hip3);
const binanceSymbols = UNIVERSE.filter((a) => a.binance).map((a) => a.binance.symbol);
const bybitSymbols = UNIVERSE.filter((a) => a.bybit).map((a) => a.bybit.symbol);

async function fetchHip3() {
  if (hip3Assets.length === 0) return null;
  const dex = hip3Assets[0].hyperliquid.dex;
  const wanted = new Set(hip3Assets.map((a) => a.hyperliquid.coin));
  const [meta, ctxs] = await hlInfo({ type: 'metaAndAssetCtxs', dex });
  // Filter to configured coins while PRESERVING the [meta, ctxs] index join.
  const universe = [];
  const filteredCtxs = [];
  meta.universe.forEach((u, i) => {
    if (wanted.has(u?.name)) {
      universe.push(u);
      filteredCtxs.push(ctxs[i]);
    }
  });
  return [{ ...meta, universe, marginTables: undefined }, filteredCtxs];
}

async function fetchHyperliquid() {
  // predictedFundings covers HL + Binance + Bybit predicted rates for core-dex
  // assets, each tagged with its fundingIntervalHours. It does NOT cover HIP-3
  // builder dexs, so the oil market needs its own metaAndAssetCtxs call.
  // The two calls fail INDEPENDENTLY: a transient HIP-3 failure must not
  // discard good core data (and vice versa) — only the affected cells degrade.
  const [pf, hip3] = await Promise.allSettled([hlInfo({ type: 'predictedFundings' }), fetchHip3()]);

  if (pf.status === 'rejected' && hip3.status === 'rejected') {
    throw new Error(`core: ${pf.reason?.message || pf.reason}; HIP-3: ${hip3.reason?.message || hip3.reason}`);
  }
  const partialErrors = {};
  let predictedFundings = null;
  if (pf.status === 'fulfilled') {
    predictedFundings = pf.value.filter((e) => coreCoins.includes(e?.[0]));
  } else {
    partialErrors.hyperliquidCore = String(pf.reason?.message || pf.reason);
  }
  let xyzMetaAndAssetCtxs = null;
  if (hip3.status === 'fulfilled') {
    xyzMetaAndAssetCtxs = hip3.value;
  } else {
    partialErrors.hyperliquidHip3 = String(hip3.reason?.message || hip3.reason);
  }
  return { predictedFundings, xyzMetaAndAssetCtxs, partialErrors };
}

async function fetchBinance() {
  // Bulk premiumIndex (no symbol param → every listed symbol in one call,
  // filtered to the universe): at 12 assets the per-symbol pattern would be
  // ~12 requests; bulk is 1. fundingInfo stays authoritative for per-symbol
  // intervals (HYPEUSDT is 4h; absent symbol ⇒ 8h default). A fundingInfo
  // failure must not discard good premiumIndex data (normalize falls back to
  // the flagged echo interval / 8h default).
  const notes = [];
  const all = await getJson(`${BINANCE_API}/fapi/v1/premiumIndex`);
  const premiumIndex = all.filter((e) => binanceSymbols.includes(e?.symbol));
  if (premiumIndex.length === 0) {
    throw new Error('premiumIndex: no universe symbols present in the exchange response');
  }
  const missing = binanceSymbols.filter((s) => !premiumIndex.some((e) => e.symbol === s));
  if (missing.length) notes.push(`missing from premiumIndex: ${missing.join(', ')}`);

  let fundingInfo = null;
  try {
    const allInfo = await getJson(`${BINANCE_API}/fapi/v1/fundingInfo`);
    fundingInfo = allInfo.filter((e) => binanceSymbols.includes(e?.symbol));
  } catch (e) {
    notes.push(`fundingInfo failed: ${e.message}`);
  }
  return { premiumIndex, fundingInfo, partialErrors: notes.length ? { binanceNote: notes.join('; ') } : {} };
}

async function fetchBybit() {
  let lastErr;
  const wanted = new Set(bybitSymbols);
  for (const host of BYBIT_HOSTS) {
    try {
      // Bulk endpoints filtered to the universe (2 requests instead of 2 per
      // symbol). Dated futures carry distinct symbols (e.g. BTCUSDT-26SEP26)
      // so the filter alone excludes them; normalize additionally insists on
      // contractType LinearPerpetual.
      const tickersRes = await getJson(`${host}/v5/market/tickers?category=linear`);
      if (tickersRes.retCode !== 0) throw new Error(`Bybit retCode ${tickersRes.retCode}: ${tickersRes.retMsg}`);

      // instruments-info paginates (limit ≤ 1000; ~700 linear instruments
      // today) — follow the cursor defensively in case the list outgrows a page.
      const instruments = [];
      let cursor = '';
      for (let page = 0; page < 5; page++) {
        const url = `${host}/v5/market/instruments-info?category=linear&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const res = await getJson(url);
        if (res.retCode !== 0) throw new Error(`Bybit retCode ${res.retCode}: ${res.retMsg}`);
        instruments.push(...res.result.list);
        cursor = res.result.nextPageCursor;
        if (!cursor) break;
      }

      return {
        host,
        tickers: { category: 'linear', list: tickersRes.result.list.filter((e) => wanted.has(e?.symbol)) },
        instrumentsInfo: { category: 'linear', list: instruments.filter((e) => wanted.has(e?.symbol)) },
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * Fetch everything, tolerating per-venue failure. Always resolves; missing
 * venues are null with the cause recorded in errors[venueId].
 */
export async function fetchBundle() {
  const bundle = {
    generatedAt: new Date().toISOString(),
    source: 'live',
    errors: {},
    hyperliquid: null,
    binance: null,
    bybit: null,
  };

  const results = await Promise.allSettled([fetchHyperliquid(), fetchBinance(), fetchBybit()]);
  const [hl, bin, byb] = results;

  if (hl.status === 'fulfilled') {
    const { partialErrors, ...payload } = hl.value;
    bundle.hyperliquid = payload;
    Object.assign(bundle.errors, partialErrors);
  } else {
    bundle.errors.hyperliquid = String(hl.reason?.message || hl.reason);
  }

  if (bin.status === 'fulfilled') {
    const { partialErrors, ...payload } = bin.value;
    bundle.binance = payload;
    Object.assign(bundle.errors, partialErrors);
  } else {
    bundle.errors.binance = String(bin.reason?.message || bin.reason);
  }

  if (byb.status === 'fulfilled') {
    const { host, ...payload } = byb.value;
    bundle.bybit = payload;
    if (host !== BYBIT_HOSTS[0]) bundle.errors.bybitNote = `primary host blocked; used ${host}`;
  } else {
    bundle.errors.bybit = String(byb.reason?.message || byb.reason);
  }

  return bundle;
}
