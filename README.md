# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/aboylabs/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/aboylabs/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar (model radar-2): ranks 198 pre-token protocols from a sealed
DefiLlama snapshot by implied token value — TVL × category ref multiple ×
pre-token discount × growth × maturity × chain — with a sortable, filterable
dashboard, a per-protocol model breakdown that recomputes the value in the page,
and a concrete six-step farm plan (cost and time) for every ranked protocol.

## Run it

```sh
node main.ts --input input/snapshot.json --output out
```

The grader runs `node main.ts` with the sealed snapshot mounted at `/input`
and writes the board to `/output` (`board.json`, `data.js`, `dashboard/`,
`screenshots/`, `dossier.json`). Node 22, standard library only, no network,
deterministic: two runs produce byte-identical output.

## How the model works

- **Ref multiple** — the median market-cap / TVL of protocols that already
  trade, per category (global median fallback), clamped to 0.05–2.5.
- **Pre-token discount 0.6** — a token that does not exist yet is worth 60% of
  the listed-comparable value.
- **Growth** — 1 + clamp(7-day TVL change, −50%, +150%) / 100 × 0.6.
- **Maturity** — 0.7 + min(age in days, 1095) / 1095 × 0.3 (unknown age: 365d).
- **Chain** — 1 + 0.04 × min(extra chains beyond the first, 5).
- **Eligibility** — the board only ranks protocols that could launch a token.
  Products that are by definition a wrapped, staked or bridged representation
  of another asset (bridges, liquid staking, wrapped BTC) are not ranked — the
  same exclusion the sealed watchlist applies. The 40 watchlist protocols are
  always ranked.

Calibration uses only the snapshot's own figures: TVL, 7-day change, listing
age and the listed market's multiples. No protocol name is special-cased.

## Layout

- `main.ts` — entrypoint: reads the snapshot, builds the board, writes
  `board.json` + `data.js`, copies `dashboard/` and `screenshots/`, writes
  `dossier.json` via the vendored make.fun library.
- `lib/model.ts` — the radar-2 model, farm-plan generator and snapshot parser.
- `vendor/makefun-board.ts` — make.fun board library, vendored from the kit.
- `dashboard/` — static dashboard (no network): `index.html` + `app.css` +
  `app.js`, 28,267 bytes total.
- `screenshots/` — board, detail and filtered views of the dashboard.
- `.makefun/owner.json` — proves the repository belongs to the entrant's
  wallet.

## Result (sealed snapshot, 2026-11-14)

198 rows, watchlist 40/40, top implied values: Steakhouse Financial
$355,088,059 · Sentora Curator $326,079,234 · Gauntlet $213,115,532 ·
Veda $199,685,625 · USDD $98,426,626. Implied values are this entry's own
claim from one snapshot — they do not predict whether or when a token is
issued.

---

Entered on [make.fun](https://make.fun/?ref=artjzq1w&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
