// ---------------------------------------------------------------------------
// csv.js — pure CSV assembly for the export link. Values are raw decimals,
// not display strings: the file is meant for pandas/Excel, so formatting is
// the reader's job. BOM-prefixed so Excel opens UTF-8 without mangling.
// ---------------------------------------------------------------------------

export const CSV_HEADER =
  'table,asset,venue,state,rate_per_interval,interval_h,apr_gross,net_apr,margin_vs_hurdle,clears,as_of_utc';

const quote = (s) => {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
const num = (v) => (Number.isFinite(v) ? String(v) : '');

/**
 * Both tables in one file, discriminated by the `table` column. `ranked` is
 * the rankAssets() output so the CSV always matches what the page shows.
 */
export function toCsv(ranked, meta) {
  const lines = [CSV_HEADER];
  for (const g of ranked) {
    for (const row of g.rows) {
      const v = g.carry.get(row.venue);
      lines.push([
        'carry',
        quote(g.asset.id),
        quote(row.venue),
        quote(row.state),
        num(row.ratePerInterval),
        num(row.intervalHours),
        num(row.aprGross),
        num(v?.netApr),
        num(v?.margin),
        v && v.clears !== null ? String(v.clears) : '',
        quote(meta.asOfUtc),
      ].join(','));
    }
    if (g.spread) {
      const s = g.spread;
      lines.push([
        'spread',
        quote(g.asset.id),
        quote(`short ${s.shortVenue} / long ${s.longVenue}`),
        'ok',
        '',
        '',
        num(s.spreadApr),
        num(s.netApr),
        num(s.margin),
        String(s.clears),
        quote(meta.asOfUtc),
      ].join(','));
    }
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function csvFilename(now = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `perp-funding_${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}_utc.csv`;
}
