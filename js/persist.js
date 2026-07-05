// ---------------------------------------------------------------------------
// persist.js — operator inputs surviving a reload. Sanitization is pure and
// node-testable; the storage object is injected so tests need no browser and
// a blocked/absent localStorage (private mode) degrades to defaults silently.
// ---------------------------------------------------------------------------

export const INPUTS_KEY = 'pfs.inputs.v1';

/**
 * Merge a stored (possibly hostile) inputs object over known-good defaults.
 * Unknown keys are dropped; values must be finite numbers within the same
 * bounds the UI enforces (>= 0, holdingDays >= 1). Never throws.
 */
export function sanitizeInputs(raw, defaults) {
  const out = { ...defaults, perpFeePct: { ...defaults.perpFeePct } };
  if (!raw || typeof raw !== 'object') return out;

  const num = (v, min) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : null);

  for (const key of ['riskFreePct', 'riskPremiumPct', 'spotFeePct', 'spotFinancingPct']) {
    const v = num(raw[key], 0);
    if (v !== null) out[key] = v;
  }
  const days = num(raw.holdingDays, 1);
  if (days !== null) out.holdingDays = days;

  if (raw.perpFeePct && typeof raw.perpFeePct === 'object') {
    for (const venue of Object.keys(defaults.perpFeePct)) {
      const v = num(raw.perpFeePct[venue], 0);
      if (v !== null) out.perpFeePct[venue] = v;
    }
  }
  return out;
}

export function loadInputs(storage, defaults) {
  try {
    return sanitizeInputs(JSON.parse(storage.getItem(INPUTS_KEY)), defaults);
  } catch {
    return sanitizeInputs(null, defaults);
  }
}

export function saveInputs(storage, inputs) {
  try {
    storage.setItem(INPUTS_KEY, JSON.stringify(inputs));
  } catch {
    /* private mode / quota — persistence is a convenience, never fatal */
  }
}
