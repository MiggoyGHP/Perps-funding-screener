// ---------------------------------------------------------------------------
// history.js — append-only funding history, written by the snapshot script on
// every refresh. No UI consumes it yet: the data needs lead time, so it starts
// accruing now and the trend column arrives later. Pure and node-tested; the
// caller feeds it the previous file's parse (or garbage — it recovers).
// ---------------------------------------------------------------------------

import { normalizeBundle } from './normalize.js';

/**
 * Append one capture to the history: { t, rows: [{ a, v, rate, ih }] } per
 * point, ok-state rows only. Idempotent per generatedAt; caps retention to
 * capDays behind the newest point; tolerates a missing/corrupt existing file
 * by starting fresh.
 */
export function appendHistory(existing, bundle, capDays = 28) {
  const points = Array.isArray(existing?.points) ? existing.points.slice() : [];

  const t = Date.parse(bundle?.generatedAt);
  if (!Number.isFinite(t)) return { version: 1, points };
  if (points.some((p) => p?.t === bundle.generatedAt)) return { version: 1, points };

  const rows = normalizeBundle(bundle)
    .filter((r) => r.state === 'ok')
    .map((r) => ({ a: r.asset, v: r.venue, rate: r.ratePerInterval, ih: r.intervalHours }));
  points.push({ t: bundle.generatedAt, rows });

  const cutoff = t - capDays * 86400000;
  const kept = points.filter((p) => {
    const pt = Date.parse(p?.t);
    return Number.isFinite(pt) && pt >= cutoff;
  });
  kept.sort((x, y) => Date.parse(x.t) - Date.parse(y.t));
  return { version: 1, points: kept };
}
