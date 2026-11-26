# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/iuypf001126uk-dotcom/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/iuypf001126uk-dotcom/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads one frozen DefiLlama snapshot and ranks **every protocol that records no token** — no market cap, no CoinGecko id, no ticker — by the value its launch would carry if its record stayed as it is: **289 protocols**, the 40-protocol house watchlist included as the floor, not the ceiling.

The model (version `radar-2`, in `lib/model.ts`) derives everything from the snapshot's own figures. There is no flat multiple: for each category, the base multiple is the **median market-cap / TVL of that category's already-trading protocols in the same snapshot**, shrunk toward the global median when a category has few trading members and clamped to 0.05–2.50×. On top of that sit a growth factor (7-day TVL change, clamped, half weight), a maturity factor (how long the protocol has run with no token) and a reach factor (4% per extra chain, up to five). Protocols whose token already trades are never ranked — they are the evidence the multiples are read from, and the dashboard shows them apart.

Every ranked row carries a **farm plan**: six concrete steps with a cost and a time each, generated from that protocol's own category, chains, TVL and age — position size, gas on its chains, a second-chain or deepen step, a weekly qualifying action, a hold window, and a safe claim-and-revoke finish.

The dashboard (`dashboard/`, plain HTML/CSS/JS, no network) is a sortable, filterable board — search, category, chain, minimum TVL, watchlist-only — with a per-protocol detail view that shows the model's arithmetic for that row next to its farm plan, plus the category-multiple table the values come from. Any view can be linked through the URL hash.

## Run it

```sh
MAKEFUN_INPUT_PATH=/input/snapshot.json MAKEFUN_OUTPUT_DIR=/output node main.ts
```

This writes `board.json` (the ranked board), `data.js` (the dashboard's dataset), `dashboard/`, `screenshots/` and `dossier.json` into the output directory. The run is a pure function of the snapshot's bytes: two runs write the same board.

---
<sub>Entered on [make.fun](https://make.fun/?ref=xt250d6e&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) — “Build the best token launch radar” bounty.</sub>
