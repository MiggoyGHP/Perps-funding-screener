// ---------------------------------------------------------------------------
// dataSource.js — THE single swap point between sample, snapshot, and live
// data. Everything downstream (normalize → compute → ui) is identical across
// modes because all three return the same canonical bundle shape.
// ---------------------------------------------------------------------------

import { DATA_MODE } from './config.js';
import { SAMPLE_BUNDLE } from './sampleData.js';
import { fetchBundle } from './fetchBundle.js';

/**
 * Returns { bundle, mode, fallbackReason }. `mode` is what was actually
 * served (a failed snapshot/live fetch degrades to sample and says why —
 * the page must always load, and must never pretend).
 */
export async function getFundingData(mode = DATA_MODE) {
  if (mode === 'sample') {
    return { bundle: SAMPLE_BUNDLE, mode: 'sample', fallbackReason: null };
  }

  if (mode === 'live') {
    try {
      const bundle = await fetchBundle();
      // If literally every venue failed, that's not "live data".
      if (!bundle.hyperliquid && !bundle.binance && !bundle.bybit) {
        throw new Error(Object.values(bundle.errors).join('; ') || 'all venues unreachable');
      }
      return { bundle, mode: 'live', fallbackReason: null };
    } catch (e) {
      return { bundle: SAMPLE_BUNDLE, mode: 'sample', fallbackReason: `live fetch failed: ${e.message}` };
    }
  }

  // snapshot (default): same-origin static JSON written at build time.
  // no-store + cache-buster so a refreshed snapshot is never masked by the
  // browser or GitHub Pages' 10-minute cache.
  try {
    const res = await fetch(`./data/snapshot.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bundle = await res.json();
    if (!bundle || typeof bundle !== 'object' || !Number.isFinite(new Date(bundle.generatedAt).getTime())) {
      throw new Error('malformed snapshot (missing or unparseable generatedAt)');
    }
    return { bundle, mode: 'snapshot', fallbackReason: null };
  } catch (e) {
    return { bundle: SAMPLE_BUNDLE, mode: 'sample', fallbackReason: `snapshot unavailable: ${e.message}` };
  }
}
