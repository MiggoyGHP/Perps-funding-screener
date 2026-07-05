// ---------------------------------------------------------------------------
// ui.js — rendering and controls. All math lives in compute.js; all shape
// knowledge lives in normalize.js; this file only formats and wires inputs.
// ---------------------------------------------------------------------------

import { DEFAULT_INPUTS, STALE_AFTER_HOURS, UNIVERSE } from './config.js';
import { VENUES } from './venues.js';
import { getFundingData } from './dataSource.js';
import { normalizeBundle } from './normalize.js';
import { financingDoubleCount, rankAssets, rankRows, bestOpportunity } from './compute.js';
import { loadInputs, saveInputs } from './persist.js';
import { toCsv, csvFilename } from './csv.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  rows: [],
  bundle: null,
  mode: null,
  fallbackReason: null,
  staleAnnounced: false,
  clearsOnly: false,
  inputs: { ...DEFAULT_INPUTS, perpFeePct: { ...DEFAULT_INPUTS.perpFeePct } },
};

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
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
  if (mins <= 0) {
    const late = -mins;
    const ago = late < 60 ? `${late}m` : `${Math.floor(late / 60)}h ${late % 60}m`;
    return `settled ${ago} ago · awaiting refresh`;
  }
  if (mins < 60) return `settles in ${mins}m`;
  return `settles in ${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- provenance badge --------------------------------------------------------

const SNAPSHOT_PROVENANCE =
  'Real venue data captured by scripts/fetch-snapshot.mjs. Auto-refreshes hourly via the ' +
  'refresh-snapshot GitHub Action. Bybit is reached via its documented mirror api.bytick.com ' +
  'when the primary host is blocked.';

function staleMessage(ageH) {
  return `Snapshot refresh overdue — captured ${Math.round(ageH)}h ago; auto-refresh runs hourly. Check the refresh-snapshot workflow run.`;
}

function appendAlert(msg) {
  const p = document.createElement('p');
  p.textContent = msg;
  $('#badge-alerts').appendChild(p);
}

function renderBadge() {
  const { mode, bundle, fallbackReason } = state;
  const el = $('#badge');
  const alerts = [];
  let html = '';

  if (mode === 'sample') {
    html =
      `<span class="badge sample" title="Illustrative values shaped exactly like the real API responses."><span class="dot"></span>SAMPLE DATA</span>` +
      `<span class="badge-asof">illustrative — not market data</span>`;
    if (fallbackReason) alerts.push(`${fallbackReason} — fell back to sample data.`);
  } else if (mode === 'snapshot') {
    const ageH = (Date.now() - new Date(bundle.generatedAt).getTime()) / 3600000;
    html =
      `<span class="badge snapshot" title="${esc(SNAPSHOT_PROVENANCE)}"><span class="dot"></span>SNAPSHOT</span>` +
      `<span class="badge-asof">as of ${esc(fmtUtc(bundle.generatedAt))} · <span data-age data-iso="${esc(bundle.generatedAt)}">${esc(fmtAgo(bundle.generatedAt))}</span></span>`;
    if (ageH > STALE_AFTER_HOURS) {
      state.staleAnnounced = true;
      alerts.push(staleMessage(ageH));
    }
  } else {
    html =
      `<span class="badge live"><span class="dot"></span>LIVE</span>` +
      `<span class="badge-asof">fetched in-browser · <span data-age data-iso="${esc(bundle.generatedAt)}">${esc(fmtAgo(bundle.generatedAt))}</span></span>`;
  }

  // Real venue failures are never buried in a tooltip.
  for (const [venue, msg] of Object.entries(bundle.errors || {}).filter(([k]) => k !== 'bybitNote')) {
    alerts.push(`${venue}: ${msg}`);
  }

  el.innerHTML = html;
  $('#badge-alerts').innerHTML = '';
  alerts.forEach(appendAlert);
}

/**
 * The Bybit-mirror disclosure is data provenance, not a header warning: it
 * lives with the other caveats, and only when the capture actually used the
 * mirror. Idempotent — live refreshes may re-run it.
 */
function appendMirrorFootnote() {
  if (!state.bundle?.errors?.bybitNote || $('#fn-bybit-mirror')) return;
  const li = document.createElement('li');
  li.id = 'fn-bybit-mirror';
  li.innerHTML =
    '<strong>Bybit host.</strong> Bybit data in this capture came via api.bytick.com, Bybit’s documented alternate host — the primary api.bybit.com is blocked on some networks.';
  $('#footnotes').appendChild(li);
}

// --- convention strip + plaques ----------------------------------------------

const CONV_STRIP =
  'CONVENTIONS · HL <b>×8,760</b> (1h) · Binance <b>×(24÷int)×365</b> · ' +
  'Bybit <b>×(8,760÷int h)</b> — basis, caps, sources <span class="caret">▸</span>';

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
  $('#conv-strip').innerHTML = CONV_STRIP;
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

  // Remember whether the operator prefers the conventions open.
  const conv = $('#conventions');
  try {
    if (storage()?.getItem('pfs.conv.v1') === 'open') conv.open = true;
  } catch { /* non-fatal */ }
  conv.addEventListener('toggle', () => {
    try {
      storage()?.setItem('pfs.conv.v1', conv.open ? 'open' : 'closed');
    } catch { /* non-fatal */ }
  });
}

// --- controls ----------------------------------------------------------------------

const CONTROL_DEFS = [
  { group: 'Hurdle', items: [
    { key: 'riskFreePct', label: 'Risk-free', unit: '%/yr', step: 0.1, tip: 'US risk-free, e.g. T-bill yield.' },
    { key: 'riskPremiumPct', label: 'Premium', unit: '%/yr', step: 0.5, tip: 'Risk premium: your compensation for venue, liquidation, oracle and depeg risk — a judgment call, deliberately not hardcoded.' },
  ]},
  { group: 'Costs', items: [
    { key: 'spotFeePct', label: 'Spot fee', unit: '%', step: 0.01, tip: 'Taker fee per fill on the spot leg.' },
    { key: 'perpFeePct.hyperliquid', label: 'HL perp', unit: '%', step: 0.005, tip: 'Hyperliquid taker fee per perp fill — set to your tier.' },
    { key: 'perpFeePct.binance', label: 'Binance perp', unit: '%', step: 0.005, tip: 'Binance taker fee per perp fill — set to your tier.' },
    { key: 'perpFeePct.bybit', label: 'Bybit perp', unit: '%', step: 0.005, tip: 'Bybit taker fee per perp fill — set to your tier.' },
    { key: 'spotFinancingPct', label: 'Financing', unit: '%/yr', step: 0.25, tip: 'Spot financing: 0 = unlevered cash; its opportunity cost is already in the hurdle via the risk-free rate.' },
    { key: 'holdingDays', label: 'Hold', unit: 'days', step: 1, min: 1, tip: 'Holding period: amortizes the one-off round-trip fees into an annualized drag. Must be at least 1 day.' },
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
      ${g.group === 'Hurdle' ? '<span class="ctl-readout" id="hurdle-readout" title="Risk-free + risk premium — the bar every net number is judged against."></span>' : ''}
    </div>`,
  ).join('')
    + '<button type="button" class="ctl-reset" id="ctl-reset" title="Restore the default assumptions">reset defaults</button>';

  $('#controls').addEventListener('input', (e) => {
    const key = e.target?.dataset?.key;
    if (!key) return;
    const val = parseFloat(e.target.value);
    const min = parseFloat(e.target.min || '0');
    if (Number.isFinite(val) && val >= min) {
      e.target.removeAttribute('aria-invalid');
      setPath(state.inputs, key, val);
      saveInputs(storage(), state.inputs);
      renderTables();
    } else {
      // Rejected input: mark it visibly so the tables' state is never silently
      // out of sync with what the field displays.
      e.target.setAttribute('aria-invalid', 'true');
    }
  });

  // Reset restores defaults WITHOUT re-rendering #controls (the delegated
  // listener above must never be bound twice, and focus must survive).
  $('#ctl-reset').addEventListener('click', () => {
    state.inputs = { ...DEFAULT_INPUTS, perpFeePct: { ...DEFAULT_INPUTS.perpFeePct } };
    saveInputs(storage(), state.inputs);
    for (const input of $('#controls').querySelectorAll('input[data-key]')) {
      input.value = getPath(state.inputs, input.dataset.key);
      input.removeAttribute('aria-invalid');
    }
    renderTables();
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

const FLOOR_TIP =
  "Pinned at Hyperliquid's interest-rate floor: premium ≈ 0, so funding = the fixed interest " +
  'component — exactly 0.01% per 8h, paid as 0.00125%/1h. The normal state for liquid majors ' +
  'in a calm tape; most HL assets sit here until a premium opens up. Real API data, ' +
  'cross-verified against a second endpoint (metaAndAssetCtxs) at capture time.';

function floorChip(row) {
  // Identical HL rates across majors look like a placeholder to a sharp eye —
  // label the mechanic instead of leaving the question open.
  return row.atFloor ? `<span class="chip floor" title="${esc(FLOOR_TIP)}">floor</span>` : '';
}

function flagsLine(row) {
  // Provenance flags are material disclosures (secondhand rates, defaulted
  // intervals) — rendered as visible text, not a hover-only title, so touch,
  // keyboard and screen-reader users all get them.
  const shown = (row.flags || []).filter((f) => f !== 'hip3');
  if (!shown.length) return '';
  return `<span class="settles flagline">⚑ ${esc(shown.join(' · '))}</span>`;
}

function settleText(row) {
  // Non-hourly rows wrap the text in a span carrying the target time so the
  // 30s tick can update it (and flip the overdue style) without re-rendering.
  if (row.nextFundingTime == null || row.intervalHours === 1) {
    return esc(fmtSettles(row.nextFundingTime, row.intervalHours));
  }
  const overdue = row.nextFundingTime - Date.now() <= 0 ? ' class="overdue"' : '';
  return `<span${overdue} data-next="${row.nextFundingTime}" data-int="${row.intervalHours}">${esc(fmtSettles(row.nextFundingTime, row.intervalHours))}</span>`;
}

function fundingCell(row) {
  if (row.state !== 'ok') {
    return STATE_LABEL[row.state] ?? `<span class="cell-warn" title="${esc(row.reason || '')}">data unavailable — ${esc(row.reason || 'no data')}</span>`;
  }
  const cls = row.ratePerInterval >= 0 ? 'rate-pos' : 'rate-neg';
  return `
    <span class="${cls}">${fmtRate(row.ratePerInterval)}</span>${intervalChip(row)}${floorChip(row)}
    <span class="settles">${settleText(row)}</span>${flagsLine(row)}`;
}

function verdictCell(v, spotNote) {
  if (v.clears === null) {
    if (v.direction === 'no-spot') return `<span class="cell-muted" title="${esc(spotNote || 'No investable spot instrument exists for this market.')}">— no spot leg</span>`;
    if (v.direction === 'reverse') return '<span class="cell-muted" title="Negative funding: the harvest trade is long perp / short spot, which needs a spot borrow this model does not include.">reverse carry — borrow not modeled</span>';
    return '<span class="cell-muted">—</span>';
  }
  const w = Math.min(56, Math.max(3, Math.abs(v.margin) * 100 * 9));
  const cls = v.clears ? 'clears' : 'misses';
  const word = v.clears ? 'clears' : 'misses';
  return `<span class="verdict ${cls}" title="net ${fmtPct(v.netApr)} vs hurdle ${fmtPct(v.hurdle)}"><span class="meter" style="width:${w}px"></span>${word} ${fmtSigned(v.margin)}</span>`;
}

function renderBestLine(ranked) {
  const el = $('#best-line');
  const best = bestOpportunity(ranked);
  if (!best) {
    el.innerHTML = '<span class="best-label">BEST NET</span><span class="best-dim">no assessable market in current data</span>';
    return;
  }
  const what =
    best.kind === 'carry'
      ? `${esc(best.asset.label)} carry on ${esc(VENUES[best.venue].name)}`
      : `${esc(best.asset.label)} cross-venue (short ${esc(VENUES[best.shortVenue].name)} / long ${esc(VENUES[best.longVenue].name)})`;
  const cls = best.clears ? 'clears' : 'misses';
  const verdict = best.clears
    ? `clears hurdle by ${fmtSigned(best.margin)}`
    : `misses hurdle by ${fmtSigned(best.margin)} · nothing clears`;
  el.innerHTML = `<span class="best-label">BEST NET</span>${what} <span class="${cls}">${fmtSigned(best.netApr)}</span> <span class="best-dim">·</span> <span class="${cls}">${verdict}</span>`;
}

function renderTables() {
  const inp = decimals();
  $('#financing-warning').hidden = !financingDoubleCount(inp);
  const readout = $('#hurdle-readout');
  if (readout) readout.textContent = `= ${fmtPct(inp.riskFree + inp.riskPremium)}/yr`;

  const ranked = rankAssets(UNIVERSE, state.rows, inp);

  // "Only clears" stays honest about emptiness: when nothing clears, an empty
  // table helps nobody — show every market plus a notice instead.
  const anythingClears = ranked.some(
    (g) => [...g.carry.values()].some((v) => v.clears) || g.spread?.clears,
  );
  const filterOn = state.clearsOnly && anythingClears;

  // --- carry table ---
  const bodyRows = [];
  if (state.clearsOnly && !anythingClears) {
    bodyRows.push('<tr><td colspan="6" class="cell-muted" style="padding:12px 14px">Nothing clears the hurdle right now — showing every market.</td></tr>');
  }
  for (const g of ranked) {
    const ordered = rankRows(g.rows, g.carry);
    let listed = ordered.filter((r) => r.state !== 'notListed');
    if (filterOn) listed = listed.filter((r) => g.carry.get(r.venue)?.clears === true);
    const notListed = filterOn ? [] : ordered.filter((r) => r.state === 'notListed');
    if (!listed.length && !notListed.length) continue;

    const pushRow = (row, i) => {
      const ok = row.state === 'ok';
      const v = ok ? g.carry.get(row.venue) : null;
      bodyRows.push(`
        <tr class="${i === 0 ? 'asset-first' : 'asset-cont'}">
          <td class="asset-cell" ${i === 0 ? `title="${esc(g.asset.name)}"` : ''}>${esc(g.asset.label)}</td>
          <td class="venue-cell">${esc(VENUES[row.venue].name)}</td>
          <td class="num">${fundingCell(row)}</td>
          <td class="num col-gross">${ok ? fmtPct(row.aprGross) : '<span class="cell-muted">—</span>'}</td>
          <td class="num">${ok && v.direction === 'carry' ? fmtPct(v.netApr) : '<span class="cell-muted">—</span>'}</td>
          <td class="num">${ok ? verdictCell(v, g.asset.spot?.note) : '<span class="cell-muted">—</span>'}</td>
        </tr>`);
    };

    listed.forEach(pushRow);

    // Absence is stated once, not once per venue: two or more "not listed"
    // venues merge into a single muted line (any asset, not OIL-specific).
    if (notListed.length >= 2) {
      const first = listed.length === 0;
      bodyRows.push(`
        <tr class="${first ? 'asset-first' : 'asset-cont'}">
          <td class="asset-cell" ${first ? `title="${esc(g.asset.name)}"` : ''}>${esc(g.asset.label)}</td>
          <td class="venue-cell">${esc(notListed.map((r) => VENUES[r.venue].name).join(' · '))}</td>
          <td class="cell-muted" colspan="4">not listed</td>
        </tr>`);
    } else {
      notListed.forEach((row, j) => pushRow(row, listed.length + j));
    }
  }
  $('#carry-body').innerHTML =
    bodyRows.join('') ||
    '<tr><td colspan="6" class="cell-muted" style="padding:12px 14px">No carry trade clears the hurdle — the spreads below may; untick “only clears” to see every market.</td></tr>';

  // --- spread table (its own margin order: best trade on top) ---
  const spreadRows = ranked
    .filter((g) => g.spread && (!filterOn || g.spread.clears))
    .sort((a, b) => b.spread.margin - a.spread.margin)
    .map(({ asset, spread: s, rows: assetRows }) => {
      const shortRow = assetRows.find((r) => r.venue === s.shortVenue);
      const longRow = assetRows.find((r) => r.venue === s.longVenue);
      const legName = (v) => esc(VENUES[v].name.split(' ')[0]);
      return `
      <tr>
        <td class="asset-cell">${esc(asset.label)}</td>
        <td>short <strong>${esc(VENUES[s.shortVenue].name)}</strong> @ ${fmtPct(s.shortApr)}${intervalChip(shortRow)} · long <strong>${esc(VENUES[s.longVenue].name)}</strong> @ ${fmtPct(s.longApr)}${intervalChip(longRow)}
          <span class="settles">legs — ${legName(s.shortVenue)}: ${settleText(shortRow)} · ${legName(s.longVenue)}: ${settleText(longRow)}</span></td>
        <td class="num col-spread">${fmtPct(s.spreadApr)}</td>
        <td class="num">${fmtPct(s.netApr)}</td>
        <td class="num">${verdictCell({ clears: s.clears, margin: s.margin, netApr: s.netApr, hurdle: s.hurdle, direction: 'carry' })}</td>
      </tr>`;
    });
  $('#spread-body').innerHTML =
    spreadRows.join('') ||
    `<tr><td colspan="5" class="cell-muted" style="padding:14px">${
      filterOn
        ? 'No spread clears the hurdle — untick “only clears” to see every pairing.'
        : 'No asset is live on two or more venues in the current data.'
    }</td></tr>`;

  renderBestLine(ranked);
}

// --- liveness ---------------------------------------------------------------------

/**
 * 30s clock tick: text nodes only. Never re-renders tables (that would replay
 * the entrance animation and re-sort under the user) and never touches
 * #controls (focus). Screen readers hear nothing — the ticking spans sit
 * outside any live region by design.
 */
function tick() {
  if (document.hidden) return;
  for (const el of document.querySelectorAll('[data-next]')) {
    const next = +el.dataset.next;
    el.textContent = fmtSettles(next, +el.dataset.int);
    el.classList.toggle('overdue', next - Date.now() <= 0);
  }
  for (const el of document.querySelectorAll('[data-age]')) {
    el.textContent = fmtAgo(el.dataset.iso);
  }
  if (state.mode === 'snapshot' && !state.staleAnnounced && state.bundle?.generatedAt) {
    const ageH = (Date.now() - new Date(state.bundle.generatedAt).getTime()) / 3600000;
    if (ageH > STALE_AFTER_HOURS) {
      state.staleAnnounced = true;
      appendAlert(staleMessage(ageH));
    }
  }
}

// --- init ---------------------------------------------------------------------------

export async function init() {
  state.inputs = loadInputs(storage(), DEFAULT_INPUTS);
  try {
    state.clearsOnly = storage()?.getItem('pfs.clears.v1') === '1';
  } catch { /* non-fatal */ }
  renderPlaques();
  renderControls();

  const clearsBox = $('#clears-only');
  clearsBox.checked = state.clearsOnly;
  clearsBox.addEventListener('change', () => {
    state.clearsOnly = clearsBox.checked;
    try {
      storage()?.setItem('pfs.clears.v1', state.clearsOnly ? '1' : '0');
    } catch { /* non-fatal */ }
    renderTables();
  });

  const { bundle, mode, fallbackReason } = await getFundingData();
  state.bundle = bundle;
  state.mode = mode;
  state.fallbackReason = fallbackReason;
  state.rows = normalizeBundle(bundle);

  renderBadge();
  appendMirrorFootnote();
  renderTables();

  $('#csv-btn').addEventListener('click', () => {
    const ranked = rankAssets(UNIVERSE, state.rows, decimals());
    const blob = new Blob([toCsv(ranked, { asOfUtc: state.bundle?.generatedAt ?? '' })], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = csvFilename();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  $('#live-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'fetching…';
    try {
      const res = await getFundingData('live');
      if (res.mode === 'live') {
        state.bundle = res.bundle;
        state.mode = 'live';
        state.fallbackReason = null;
        state.staleAnnounced = false;
        state.rows = normalizeBundle(res.bundle);
        renderBadge();
        appendMirrorFootnote();
        renderTables();
      } else {
        // Every venue failed: keep what we have and say so — never swap real
        // data for sample under the operator's feet.
        appendAlert(`Live fetch failed (${res.fallbackReason || 'all venues unreachable'}) — keeping the ${state.mode} data.`);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  // Entrance animation is first-paint-only; .loaded flips it off after the
  // rise has played (0.4s + stagger headroom).
  setTimeout(() => document.body.classList.add('loaded'), 600);
  setInterval(tick, 30000);
}
