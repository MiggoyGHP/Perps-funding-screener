// ---------------------------------------------------------------------------
// normalize.js — turns one canonical raw bundle (sample, snapshot, or
// live-assembled: identical shapes) into normalized rows for compute/ui.
//
// This is the ONLY place numeric strings become floats (venues return numbers
// as JSON strings), and the only place venue response shapes are understood.
//
// Source-of-truth policy per column:
//   Hyperliquid — predictedFundings HlPerp (hourly); HIP-3 assets from
//                 metaAndAssetCtxs(dex) since predictedFundings covers only
//                 the core dex (doc: "only supported for the first perp dex").
//   Binance     — its own premiumIndex.lastFundingRate; interval from its own
//                 fundingInfo (authoritative). Hyperliquid's BinPerp echo is a
//                 cross-check and a last-resort fallback, always flagged.
//   Bybit       — its own tickers; interval from instruments-info (minutes),
//                 ticker's fundingIntervalHour as cross-check. BybitPerp echo
//                 same policy as Binance.
//
// Cell states (never conflated):
//   'ok'          — data present and parsed
//   'notListed'   — the config listing matrix says this market does not exist
//   'unavailable' — config says listed, but data is absent/failed (reason kept)
//   'delisted'    — market exists in the API but carries isDelisted
// ---------------------------------------------------------------------------

import { UNIVERSE, VENUE_IDS } from './config.js';
import { annualize } from './compute.js';

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** Intervals must be strictly positive to be usable — a 0/negative interval
 *  from bad venue data must fall to a flagged default, never reach annualize. */
function posOr(h, fallback) {
  return Number.isFinite(h) && h > 0 ? h : fallback;
}

function row(asset, venue, patch) {
  return {
    asset: asset.id,
    spotAvailable: asset.spot.available,
    venue,
    state: 'ok',
    ratePerInterval: null,
    intervalHours: null,
    nextFundingTime: null,
    aprGross: null,
    flags: [],
    reason: null,
    ...patch,
  };
}

function unavailable(asset, venue, reason) {
  return row(asset, venue, { state: 'unavailable', reason });
}

/** Find [coin, [[venueKey, {...}], ...]] in the predictedFundings array. */
function predictedEntry(bundle, coin, venueKey) {
  const pf = bundle?.hyperliquid?.predictedFundings;
  if (!Array.isArray(pf)) return null;
  const entry = pf.find((e) => Array.isArray(e) && e[0] === coin);
  if (!entry || !Array.isArray(entry[1])) return null;
  const hit = entry[1].find((v) => Array.isArray(v) && v[0] === venueKey);
  return hit ? hit[1] : null;
}

function venueError(bundle, keys, fallback) {
  for (const k of keys) {
    if (bundle?.errors?.[k]) return bundle.errors[k];
  }
  return fallback;
}

// --- Hyperliquid ------------------------------------------------------------

function normalizeHyperliquid(bundle, asset) {
  const cfg = asset.hyperliquid;

  if (cfg.hip3) {
    const pair = bundle?.hyperliquid?.xyzMetaAndAssetCtxs;
    if (!Array.isArray(pair) || !pair[0]?.universe || !Array.isArray(pair[1])) {
      return unavailable(asset, 'hyperliquid', venueError(bundle, ['hyperliquidHip3', 'hyperliquid'], 'HIP-3 dex data missing from bundle'));
    }
    const [meta, ctxs] = pair;
    const idx = meta.universe.findIndex((u) => u?.name === cfg.coin);
    if (idx === -1) {
      return unavailable(asset, 'hyperliquid', `${cfg.coin} not found in dex "${cfg.dex}" universe`);
    }
    if (meta.universe[idx].isDelisted) {
      return row(asset, 'hyperliquid', { state: 'delisted', reason: `${cfg.coin} is delisted on dex "${cfg.dex}"` });
    }
    const rate = num(ctxs[idx]?.funding);
    if (rate === null) {
      return unavailable(asset, 'hyperliquid', `unparseable funding for ${cfg.coin}`);
    }
    // HIP-3 funding is hourly like all Hyperliquid perps; the deployer's
    // funding multiplier (0.5 on the xyz dex) is ALREADY inside this value.
    const intervalHours = 1;
    return row(asset, 'hyperliquid', {
      ratePerInterval: rate,
      intervalHours,
      nextFundingTime: null, // hourly — settles at the top of every hour
      aprGross: annualize(rate, intervalHours),
      flags: ['hip3'],
    });
  }

  const hl = predictedEntry(bundle, cfg.coin, 'HlPerp');
  if (!hl) {
    return unavailable(asset, 'hyperliquid', venueError(bundle, ['hyperliquidCore', 'hyperliquid'], `${cfg.coin} missing from predictedFundings`));
  }
  const rate = num(hl.fundingRate);
  if (rate === null) return unavailable(asset, 'hyperliquid', `unparseable rate for ${cfg.coin}`);
  const intervalHours = posOr(num(hl.fundingIntervalHours), 1); // doc+live verified: 1
  return row(asset, 'hyperliquid', {
    ratePerInterval: rate,
    intervalHours,
    nextFundingTime: num(hl.nextFundingTime),
    aprGross: annualize(rate, intervalHours),
  });
}

// --- Binance ----------------------------------------------------------------

function binanceInterval(bundle, symbol, echo, flags) {
  const info = bundle?.binance?.fundingInfo;
  if (Array.isArray(info)) {
    const hit = info.find((e) => e?.symbol === symbol);
    if (hit && posOr(hit.fundingIntervalHours, null)) return hit.fundingIntervalHours;
    // Doc contract: symbols absent from fundingInfo use the 8h default.
    flags.push('interval defaulted to 8h (no valid interval in fundingInfo)');
    return 8;
  }
  // fundingInfo unreachable: Hyperliquid's echo carries the interval secondhand
  // (live-verified accurate) — better than a blind 8h default, and flagged.
  const echoH = posOr(num(echo?.fundingIntervalHours), null);
  if (echoH) {
    flags.push(`interval ${echoH}h from Hyperliquid echo (Binance fundingInfo unavailable)`);
    return echoH;
  }
  flags.push('interval defaulted to 8h (fundingInfo missing from bundle)');
  return 8;
}

function normalizeBinance(bundle, asset) {
  const symbol = asset.binance.symbol;
  const flags = [];
  const px = bundle?.binance?.premiumIndex;
  const hit = Array.isArray(px) ? px.find((e) => e?.symbol === symbol) : null;
  const echo = asset.hyperliquid ? predictedEntry(bundle, asset.hyperliquid.coin, 'BinPerp') : null;

  if (hit) {
    const rate = num(hit.lastFundingRate);
    if (rate === null) return unavailable(asset, 'binance', `unparseable lastFundingRate for ${symbol}`);
    const intervalHours = binanceInterval(bundle, symbol, echo, flags);
    // Cross-check against Hyperliquid's secondhand echo — flag, never absorb.
    if (echo && Number.isFinite(echo.fundingIntervalHours) && echo.fundingIntervalHours !== intervalHours) {
      flags.push(`interval mismatch: Binance fundingInfo says ${intervalHours}h, Hyperliquid echo says ${echo.fundingIntervalHours}h (fundingInfo wins)`);
    }
    return row(asset, 'binance', {
      ratePerInterval: rate,
      intervalHours,
      nextFundingTime: num(hit.nextFundingTime),
      aprGross: annualize(rate, intervalHours),
      flags,
    });
  }

  // Last resort: Hyperliquid's predicted echo (labeled, so the provenance is honest).
  if (echo) {
    const rate = num(echo.fundingRate);
    const intervalHours = posOr(num(echo.fundingIntervalHours), 8);
    if (rate !== null) {
      return row(asset, 'binance', {
        ratePerInterval: rate,
        intervalHours,
        nextFundingTime: num(echo.nextFundingTime),
        aprGross: annualize(rate, intervalHours),
        flags: ['via Hyperliquid predictedFundings echo (Binance API unreachable)'],
      });
    }
  }
  return unavailable(asset, 'binance', venueError(bundle, ['binance'], `${symbol} missing from premiumIndex`));
}

// --- Bybit ------------------------------------------------------------------

function bybitInterval(bundle, symbol, ticker, flags) {
  const list = bundle?.bybit?.instrumentsInfo?.list;
  const inst = Array.isArray(list)
    ? list.find((e) => e?.symbol === symbol && e?.contractType === 'LinearPerpetual')
    : null;
  const tickerHours = num(ticker?.fundingIntervalHour);

  if (inst) {
    const minutes = num(inst.fundingInterval);
    if (minutes && minutes > 0) {
      const hours = minutes / 60; // instruments-info quotes MINUTES
      if (tickerHours !== null && tickerHours !== hours) {
        flags.push(`interval mismatch: instruments-info says ${hours}h, ticker says ${tickerHours}h (instruments-info wins)`);
      }
      return hours;
    }
  }
  if (tickerHours && tickerHours > 0) {
    flags.push('interval from ticker fundingIntervalHour (instruments-info missing)');
    return tickerHours;
  }
  flags.push('interval defaulted to 8h (no per-symbol interval data)');
  return 8;
}

function normalizeBybit(bundle, asset) {
  const symbol = asset.bybit.symbol;
  const flags = [];
  const list = bundle?.bybit?.tickers?.list;
  const ticker = Array.isArray(list) ? list.find((e) => e?.symbol === symbol) : null;

  if (ticker) {
    const rate = num(ticker.fundingRate);
    if (rate === null) return unavailable(asset, 'bybit', `unparseable fundingRate for ${symbol}`);
    const intervalHours = bybitInterval(bundle, symbol, ticker, flags);
    return row(asset, 'bybit', {
      ratePerInterval: rate,
      intervalHours,
      nextFundingTime: num(ticker.nextFundingTime),
      aprGross: annualize(rate, intervalHours),
      flags,
    });
  }

  const echo = asset.hyperliquid ? predictedEntry(bundle, asset.hyperliquid.coin, 'BybitPerp') : null;
  if (echo) {
    const rate = num(echo.fundingRate);
    const intervalHours = posOr(num(echo.fundingIntervalHours), 8);
    if (rate !== null) {
      return row(asset, 'bybit', {
        ratePerInterval: rate,
        intervalHours,
        nextFundingTime: num(echo.nextFundingTime),
        aprGross: annualize(rate, intervalHours),
        flags: ['via Hyperliquid predictedFundings echo (Bybit API unreachable)'],
      });
    }
  }
  return unavailable(asset, 'bybit', venueError(bundle, ['bybit'], `${symbol} missing from tickers`));
}

// --- Entry point ------------------------------------------------------------

const NORMALIZERS = {
  hyperliquid: normalizeHyperliquid,
  binance: normalizeBinance,
  bybit: normalizeBybit,
};

/** bundle → flat list of rows, one per (asset, venue) in the config matrix. */
export function normalizeBundle(bundle) {
  const rows = [];
  for (const asset of UNIVERSE) {
    for (const venueId of VENUE_IDS) {
      if (!asset[venueId]) {
        rows.push(row(asset, venueId, { state: 'notListed' }));
      } else {
        // Backstop: one poisoned cell must degrade to 'unavailable', never
        // blank the whole screener.
        try {
          rows.push(NORMALIZERS[venueId](bundle, asset));
        } catch (e) {
          rows.push(unavailable(asset, venueId, `normalization error: ${e.message}`));
        }
      }
    }
  }
  return rows;
}
