// ---------------------------------------------------------------------------
// ui.js — rendering and controls. All math lives in compute.js; all shape
// knowledge lives in normalize.js; this file only formats and wires inputs.
// ---------------------------------------------------------------------------

import { DEFAULT_INPUTS, STALE_AFTER_HOURS, UNIVERSE } from './config.js';
import { VENUES } from './venues.js';
import { getFundingData } from './dataSource.js';
import { normalizeBundle } from './normalize.js';
import { assessCarry, assessSpread, financingDoubleCount } from './compute.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  rows: [],
  bundle: null,
  inputs: { ...DEFAULT_INPUTS, perpFeePct: { ...DEFAULT_INPUTS.perpFeePct } },
};

// --- formatting ------------------------------------------------------------

const fmtPct = (x, dp = 2) => `${x < 0 ? '−' : ''}${(Math.abs(x) * 100).toFixed(dp)}%`;
const fmtSigned = (x, dp = 2) => `${x >= 0 ? '+' : '−'}${(Math.abs(x) * 100).toFixed(dp)}%`;
const fmtRate = (x) => `${x < 0 ? '−' : ''}${(Math.abs(x) * 100).toFixed(4)}%`;

function fmtUtc(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'unknown time';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function fmtAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'unknown age';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 48 ? `${h}h ${mins % 60}m ago` : `${Math.floor(h / 24)}d ago`;
}

function fmtSettles(nextMs, intervalHours) {
  // Hourly markets settle at every top of hour; a countdown adds no signal
  // (and a snapshot's captured next-settle time is stale within the hour).
  if (nextMs == null || intervalHours === 1) return 'settles hourly';
  const mins = Math.round((nextMs - Date.now()) / 60000);
  if (mins <= 0) return 'past captured settle time';
  if (mins < 60) return `settles in ${mins}m`;
  return `settles in ${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- provenance badge ---------------------------------------------------------

function renderBadge(mode, bundle, fallbackReason) {
  const el = $('#badge');
  const parts = [];

  if (mode === 'sample') {
    parts.push(`<span class="badge sample"><span class="dot"></span>SAMPLE DATA</span>`);
    parts.push(`<p class="badge-detail">Illustrative values, shaped exactly like the real API responses. Not market data.</p>`);
    if (fallbackReason) parts.push(`<p class="badge-detail warn">${esc(fallbackReason)} — fell back to sample.</p>`);
  } else if (mode === 'snapshot') {
    const ageH = (Date.now() - new Date(bundle.generatedAt).getTime()) / 3600000;
    parts.push(`<span class="badge snapshot"><span class="dot"></span>SNAPSHOT</span>`);
    parts.push(`<p class="badge-detail">Real venue data, captured at build time.<br>as of ${fmtUtc(bundle.generatedAt)} · ${fmtAgo(bundle.generatedAt)}</p>`);
    if (ageH > STALE_AFTER_HOURS) {
      parts.push(`<p class="badge-detail warn">Stale: older than ${STALE_AFTER_HOURS}h. Re-run scripts/fetch-snapshot.mjs.</p>`);
    }
  } else {
    parts.push(`<span class="badge live"><span class="dot"></span>LIVE</span>`);
    parts.push(`<p class="badge-detail">Fetched from venue APIs in this browser at ${fmtUtc(bundle.generatedAt)}.</p>`);
  }

  const errs = Object.entries(bundle.errors || {}).filter(([k]) => k !== 'bybitNote');
  for (const [venue, msg] of errs) {
    parts.push(`<p class="badge-detail warn">${esc(venue)}: ${esc(msg)}</p>`);
  }
  if (bundle.errors?.bybitNote) {
    parts.push(`<p class="badge-detail">Bybit: ${esc(bundle.errors.bybitNote)}</p>`);
  }
  el.innerHTML = parts.join('');
}

// --- convention plaques ----------------------------------------------------------

const PLAQUE_RULES = {
  hyperliquid: 'APR = rate × <b>8,760</b> (hourly rate, as charged)',
  binance: 'APR = rate × <b>24 ÷ interval</b> × 365 (per-symbol interval)',
  bybit: 'APR = rate × <b>8,760 ÷ interval h</b> (per-symbol interval)',
};

const PLAQUE_CADENCE = {
  hyperliquid: 'Pays every hour. Docs quote the formula on an 8h basis, paid ⅛ each hour — the API returns the hourly slice, so no ÷8 or ×8 is ever applied here.',
  binance: 'Settles per symbol: 8h default, but 4h is now the majority — HYPEUSDT settles every 4h. Interval read from /fapi/v1/fundingInfo.',
  bybit: 'Settles per symbol (8h for BTC/ETH/HYPE today; can switch to 1h when pinned at cap). Interval read from instruments-info, quoted in minutes.',
};

function renderPlaques() {
  $('#plaques').innerHTML = Object.values(VENUES)
    .map(
      (v) => `
      <article class="plaque">
        <h3>${esc(v.name)}</h3>
        <p class="cadence">${esc(PLAQUE_CADENCE[v.id])}</p>
        <p class="rule">${PLAQUE_RULES[v.id]}</p>
        <p class="fine">Cap: ${esc(v.cap)} · Funding notional: ${esc(v.notional)} · <a href="${esc(v.docsUrl)}" target="_blank" rel="noopener">docs</a></p>
      </article>`,
    )
    .join('');
}

// --- controls ----------------------------------------------------------------------

const CONTROL_DEFS = [
  { group: 'Hurdle', items: [
    { key: 'riskFreePct', label: 'Risk-free rate', unit: '%/yr', step: 0.1, tip: 'US risk-free, e.g. T-bill yield.' },
    { key: 'riskPremiumPct', label: 'Risk premium', unit: '%/yr', step: 0.5, tip: 'Your compensation for venue, liquidation, oracle and depeg risk — a judgment call, deliberately not hardcoded.' },
  ]},
  { group: 'Costs', items: [
    { key: 'spotFeePct', label: 'Spot fee / fill', unit: '%', step: 0.01 },
    { key: 'perpFeePct.hyperliquid', label: 'HL perp fee / fill', unit: '%', step: 0.005 },
    { key: 'perpFeePct.binance', label: 'Binance perp fee / fill', unit: '%', step: 0.005 },
    { key: 'perpFeePct.bybit', label: 'Bybit perp fee / fill', unit: '%', step: 0.005 },
    { key: 'spotFinancingPct', label: 'Spot financing', unit: '%/yr', step: 0.25, tip: '0 = unlevered cash; its opportunity cost is already in the hurdle via the risk-free rate.' },
    { key: 'holdingDays', label: 'Holding period', unit: 'days', step: 1, min: 1, tip: 'Amortizes the one-off round-trip fees into an annualized drag. Must be at least 1 day.' },
  ]},
];

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o[k], obj);
}
function setPath(obj, path, val) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = val;
}

function renderControls() {
  $('#controls').innerHTML = CONTROL_DEFS.map(
    (g) => `
    <div class="ctl-group">
      <span class="ctl-legend">${esc(g.group)}</span>
      ${g.items.map((c) => `
        <div class="ctl">
          <label for="ctl-${c.key}" ${c.tip ? `title="${esc(c.tip)}"` : ''}>${esc(c.label)}${c.tip ? ' ⓘ' : ''}</label>
          <span class="field">
            <input id="ctl-${c.key}" data-key="${c.key}" type="number" step="${c.step}" min="${c.min ?? 0}"
                   value="${getPath(state.inputs, c.key)}" inputmode="decimal" />
            <span class="unit">${esc(c.unit)}</span>
          </span>
        </div>`).join('')}
    </div>`,
  ).join('');

  $('#controls').addEventListener('input', (e) => {
    const key = e.target?.dataset?.key;
    if (!key) return;
    const val = parseFloat(e.target.value);
    const min = parseFloat(e.target.min || '0');
    if (Number.isFinite(val) && val >= min) {
      e.target.removeAttribute('aria-invalid');
      setPath(state.inputs, key, val);
      renderTables();
    } else {
      // Rejected input: mark it visibly so the tables' state is never silently
      // out of sync with what the field displays.
      e.target.setAttribute('aria-invalid', 'true');
    }
  });
}

/** UI inputs (percent) → compute-layer decimals. */
function decimals() {
  const i = state.inputs;
  return {
    riskFree: i.riskFreePct / 100,
    riskPremium: i.riskPremiumPct / 100,
    spotFee: i.spotFeePct / 100,
    spotFinancing: i.spotFinancingPct / 100,
    holdingDays: i.holdingDays,
    perpFeeByVenue: {
      hyperliquid: i.perpFeePct.hyperliquid / 100,
      binance: i.perpFeePct.binance / 100,
      bybit: i.perpFeePct.bybit / 100,
    },
  };
}

// --- tables ------------------------------------------------------------------------

const STATE_LABEL = {
  notListed: '<span class="cell-muted">not listed</span>',
  unavailable: null, // rendered with reason
  delisted: '<span class="cell-warn">market delisted</span>',
};

function intervalChip(row) {
  const std = VENUES[row.venue].defaultIntervalHours;
  const cls = row.intervalHours !== std ? 'chip nonstandard' : 'chip';
  const tip = `Funding interval for this market: ${row.intervalHours}h (read per symbol from the venue). APR multiplier = 8,760 ÷ ${row.intervalHours} = ${Math.round(8760 / row.intervalHours).toLocaleString('en-US')}×.`;
  return `<span class="${cls}" title="${esc(tip)}">/${row.intervalHours}h</span>`;
}

function flagsLine(row) {
  // Provenance flags are material disclosures (secondhand rates, defaulted
  // intervals) — rendered as visible text, not a hover-only title, so touch,
  // keyboard and screen-reader users all get them.
  const shown = (row.flags || []).filter((f) => f !== 'hip3');
  if (!shown.length) return '';
  return `<span class="settles flagline">⚑ ${esc(shown.join(' · '))}</span>`;
}

function fundingCell(row) {
  if (row.state !== 'ok') {
    return STATE_LABEL[row.state] ?? `<span class="cell-warn" title="${esc(row.reason || '')}">data unavailable — ${esc(row.reason || 'no data')}</span>`;
  }
  const cls = row.ratePerInterval >= 0 ? 'rate-pos' : 'rate-neg';
  return `
    <span class="${cls}">${fmtRate(row.ratePerInterval)}</span>${intervalChip(row)}
    <span class="settles">${esc(fmtSettles(row.nextFundingTime, row.intervalHours))}</span>${flagsLine(row)}`;
}

function verdictCell(v) {
  if (v.clears === null) {
    if (v.direction === 'no-spot') return '<span class="cell-muted" title="No investable spot instrument exists for this market.">— no spot leg</span>';
    if (v.direction === 'reverse') return '<span class="cell-muted" title="Negative funding: the harvest trade is long perp / short spot, which needs a spot borrow this model does not include.">reverse carry — borrow not modeled</span>';
    return '<span class="cell-muted">—</span>';
  }
  const w = Math.min(56, Math.max(3, Math.abs(v.margin) * 100 * 9));
  const cls = v.clears ? 'clears' : 'misses';
  const word = v.clears ? 'clears' : 'misses';
  return `<span class="verdict ${cls}" title="net ${fmtPct(v.netApr)} vs hurdle ${fmtPct(v.hurdle)}"><span class="meter" style="width:${w}px"></span>${word} ${fmtSigned(v.margin)}</span>`;
}

function sortedAssetGroups() {
  const best = (assetId) => {
    const ok = state.rows.filter((r) => r.asset === assetId && r.state === 'ok');
    return ok.length ? Math.max(...ok.map((r) => r.aprGross)) : -Infinity;
  };
  return [...UNIVERSE].sort((a, b) => best(b.id) - best(a.id));
}

const STATE_ORDER = { ok: 0, unavailable: 1, delisted: 2, notListed: 3 };

function renderTables() {
  const inp = decimals();
  $('#financing-warning').hidden = !financingDoubleCount(inp);

  // --- carry table ---
  const bodyRows = [];
  for (const asset of sortedAssetGroups()) {
    const group = state.rows
      .filter((r) => r.asset === asset.id)
      .sort((a, b) => (STATE_ORDER[a.state] - STATE_ORDER[b.state]) || ((b.aprGross ?? -9) - (a.aprGross ?? -9)));

    group.forEach((row, i) => {
      const ok = row.state === 'ok';
      const v = ok ? assessCarry(row, { ...inp, perpFee: inp.perpFeeByVenue[row.venue] }) : null;
      bodyRows.push(`
        <tr class="${i === 0 ? 'asset-first' : 'asset-cont'}">
          <td class="asset-cell" ${i === 0 ? `title="${esc(asset.name)}"` : ''}>${esc(asset.label)}</td>
          <td class="venue-cell">${esc(VENUES[row.venue].name)}</td>
          <td class="num">${fundingCell(row)}</td>
          <td class="num">${ok ? fmtPct(row.aprGross) : '<span class="cell-muted">—</span>'}</td>
          <td class="num">${ok && v.direction === 'carry' ? fmtPct(v.netApr) : '<span class="cell-muted">—</span>'}</td>
          <td class="num">${ok ? verdictCell(v) : '<span class="cell-muted">—</span>'}</td>
        </tr>`);
    });
  }
  $('#carry-body').innerHTML = bodyRows.join('');

  // --- spread table ---
  const spreadRows = [];
  for (const asset of sortedAssetGroups()) {
    const ok = state.rows.filter((r) => r.asset === asset.id && r.state === 'ok');
    const s = assessSpread(asset.id, ok, inp);
    if (!s) continue;
    spreadRows.push(`
      <tr>
        <td class="asset-cell">${esc(asset.label)}</td>
        <td>short <strong>${esc(VENUES[s.shortVenue].name)}</strong> @ ${fmtPct(s.shortApr)} · long <strong>${esc(VENUES[s.longVenue].name)}</strong> @ ${fmtPct(s.longApr)}</td>
        <td class="num">${fmtPct(s.spreadApr)}</td>
        <td class="num">${fmtPct(s.netApr)}</td>
        <td class="num">${verdictCell({ clears: s.clears, margin: s.margin, netApr: s.netApr, hurdle: s.hurdle, direction: 'carry' })}</td>
      </tr>`);
  }
  $('#spread-body').innerHTML =
    spreadRows.join('') ||
    '<tr><td colspan="5" class="cell-muted" style="padding:14px">No asset is live on two or more venues in the current data.</td></tr>';
}

// --- init ---------------------------------------------------------------------------

export async function init() {
  renderPlaques();
  renderControls();

  const { bundle, mode, fallbackReason } = await getFundingData();
  state.bundle = bundle;
  state.rows = normalizeBundle(bundle);

  renderBadge(mode, bundle, fallbackReason);
  renderTables();
}
