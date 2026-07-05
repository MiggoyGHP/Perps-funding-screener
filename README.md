# Perp Funding Screener

A **read-only, fully static** dashboard that monitors perpetual-futures funding rates for
BTC, ETH, HYPE and tokenized WTI (**xyz:CL**, a Hyperliquid HIP-3 market) across
**Hyperliquid**, **Binance USDⓈ-M** and **Bybit linear**, ranks them by annualized funding
yield, and shows whether the delta-neutral carry (long spot / short perp) clears an
adjustable hurdle after modeled costs — plus cross-venue funding spreads as their own
opportunities.

Built as a demonstration piece: **per-venue, per-symbol annualization correctness is the
whole point.** No execution, no accounts, no API keys. Nothing here is investment advice.

## The correctness core

Every funding number is annualized by the market's *own* convention, verified against
official venue docs and live API responses (2026-07-05):

| Venue | Cadence | What the API returns | Annualization |
|---|---|---|---|
| Hyperliquid | hourly (all perps, incl. HIP-3) | the **hourly rate as charged** — the docs' "8-hour" language is the internal formula only | × 8,760 |
| Binance USDⓈ-M | per symbol: 8h default, **HYPEUSDT = 4h** (4h is now the majority) | estimate for the upcoming settlement, per that symbol's own interval | × (24 ÷ interval h) × 365 |
| Bybit linear | per symbol (can switch to 1h when pinned at cap) | rate per interval; interval quoted in **minutes** in instruments-info | × (8,760 ÷ interval h) |

The classic mistakes this project refuses to make: annualizing Hyperliquid's hourly rate as
if it were an 8h rate (8× understatement), applying ×8,760 to an 8h rate (8× overstatement),
or hardcoding 8h per venue (2× error on Binance HYPEUSDT). Funding intervals are **per-row
data read from each venue**, never per-venue constants — locked in by unit tests
(`tests/compute.test.mjs`).

## Data modes

One config line in [`js/config.js`](js/config.js) switches the source (`DATA_MODE`):

| Mode | Source | Use |
|---|---|---|
| `snapshot` *(default)* | `data/snapshot.json`, written at build time by `scripts/fetch-snapshot.mjs`; page shows **"as of ‹timestamp›"** + staleness warning | the published GitHub Pages site |
| `sample` | baked-in illustrative bundle shaped byte-for-byte like the real API responses | offline / first clone |
| `live` | browser fetches the venue APIs directly (all three allow CORS; Bybit falls back to `api.bytick.com` where `api.bybit.com` is ISP-blocked) | local development |

All three modes produce one canonical bundle consumed by a single `normalize()` — sample,
snapshot and live can never drift apart. If the snapshot is missing or unreadable the page
**falls back to sample data and says so** in the badge. Cells distinguish *not listed*
(verified against venue symbol lists) from *data unavailable* (fetch failed — with the cause)
so a network failure never fabricates a "not listed".

## Run locally

Requires Node ≥ 18 (for the snapshot script/tests) and any static file server
(ES modules don't load over `file://`).

```bash
# serve the page
npx serve            # or: python -m http.server 8000
# open http://localhost:3000 (or :8000)

# refresh the data snapshot (public endpoints, no keys)
node scripts/fetch-snapshot.mjs

# run the unit tests (annualization golden values + convention traps)
node --test tests/compute.test.mjs
```

## Publish to GitHub Pages

1. Create a GitHub repository and push this project as-is (all paths are relative, so it
   works at `https://<user>.github.io/<repo>/`).
2. Repo → **Settings → Pages → Source: "Deploy from a branch"** → `main` / `(root)`.
   No build step — that's it.
3. Refreshing the published data:
   - manually — run each command and check it succeeded before the next (chaining with
     `&&` is a parse error in Windows PowerShell 5.1):

     ```bash
     node scripts/fetch-snapshot.mjs
     git commit -am "snapshot"
     git push
     ```

   - automatically: the included [`.github/workflows/refresh-snapshot.yml`](.github/workflows/refresh-snapshot.yml)
     re-snapshots hourly and commits when changed (GitHub runners are not
     exchange-geo-blocked, so this also sidesteps local ISP blocks). Delete that file if you
     don't want the automation. Note: GitHub suspends scheduled workflows after 60 days
     without repository activity — any push (including the bot's own snapshot commits)
     resets the clock, so this only matters if the data stops changing entirely.

## Project layout

```
index.html                     page shell
css/styles.css                 dark desk-terminal styling
js/config.js                   DATA_MODE, universe + verified listing matrix, cost defaults
js/venues.js                   per-venue conventions with official-doc citations
js/fetchBundle.js              live fetch of the canonical bundle (browser + Node)
js/dataSource.js               getFundingData(mode) — the single swap point
js/sampleData.js               labeled sample bundle (real API shapes, strings preserved)
js/normalize.js                bundle → rows; the only string→float boundary; cell states
js/compute.js                  pure math: annualize, carry, hurdle, spreads
js/ui.js                       rendering + controls
data/snapshot.json             committed build-time snapshot
scripts/fetch-snapshot.mjs     zero-dependency snapshot writer
tests/compute.test.mjs         golden values + convention-trap regressions
```

## Modeling notes

- **Net carry** = gross APR − (2 spot fills + 2 perp fills, amortized over the holding
  period) − spot financing. **Hurdle** = risk-free + risk premium (both controls; the
  premium is deliberately a judgment input).
- Spot financing defaults to 0: unlevered cash's opportunity cost already lives in the
  hurdle via the risk-free rate. Setting financing > 0 triggers a double-count warning.
- **Negative funding** flips the harvest trade to long perp / short spot, which needs a spot
  borrow this model does not include — those cells are labeled instead of given a verdict.
- **OIL (xyz:CL)** has no investable spot leg (oracle-priced synthetic), so it gets funding
  rank and spread eligibility but no carry verdict. Its quoted rate already embeds the
  deployer's 0.5 funding multiplier.
- Displayed rates are **predicted for the next settlement** on every venue (consistent
  basis); realized funding will differ.
