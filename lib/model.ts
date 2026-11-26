// The token radar's model, version radar-2: one snapshot of the protocol universe in, one ranked
// board out. It improves on the house starter model in three ways, each derived only from the
// snapshot's own figures:
//
//   1. The base multiple is not one flat number. For every category, the model reads the snapshot's
//      live-token protocols in that category and takes the median of their market-cap / TVL ratios:
//      what the market itself pays per dollar of TVL for that kind of protocol. A category with few
//      live members is shrunk toward the global median (weight SHRINK_K), and every multiple is
//      clamped to [MULTIPLE_FLOOR, MULTIPLE_CAP]. A pre-token protocol is then valued the way the
//      market values its already-trading peers.
//   2. A reach factor rewards distribution: a protocol live on more chains has more surfaces where
//      a launch can be farmed and claimed, so each extra chain (up to REACH_CAP_CHAINS) adds
//      REACH_PER_CHAIN to the value.
//   3. The board is the whole pre-token universe the snapshot records, not a capped sample: every
//      rankable pre-token protocol is scored and ranked, the watchlist included as the floor.
//
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = MATURITY_FLOOR + min(age_days, MATURITY_DAYS) / MATURITY_DAYS x MATURITY_RANGE
//                (age_days unknown: UNKNOWN_AGE_DAYS)
//   reachMult  = 1 + REACH_PER_CHAIN x min(chains - 1, REACH_CAP_CHAINS)
//   implied    = max(1, round(tvl_usd x categoryMultiple x growthMult x maturity x reachMult))
//
// No protocol name is ever special-cased: the same function scores every row, and the run is a pure
// function of the snapshot's bytes, so two runs write the same board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  reach_per_chain: number;
  reach_cap_chains: number;
  shrink_k: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  reach_per_chain: 0.04,
  reach_cap_chains: 5,
  shrink_k: 4,
  multiple_floor: 0.05,
  multiple_cap: 2.5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row's figures plus its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's market multiple, as the dashboard's model panel states it. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  live_count: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  category_multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The market's own multiples, read off the snapshot's live-token protocols: for each category, the
 * median market-cap / TVL of its trading members, shrunk toward the global median by SHRINK_K
 * phantom members and clamped. Categories with no trading member use the global median.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, { multiple: number; liveCount: number }> } {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const globalMedian = live.length > 0 ? median(live.map((p) => p.mcap_usd! / p.tvl_usd)) : 0.25;
  const ratios = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const list = ratios.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    ratios.set(p.category, list);
  }
  const clamp = (n: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, n));
  const byCategory = new Map<string, { multiple: number; liveCount: number }>();
  for (const [category, list] of ratios) {
    const shrunk = (list.length * median(list) + model.shrink_k * globalMedian) / (list.length + model.shrink_k);
    byCategory.set(category, { multiple: round4(clamp(shrunk)), liveCount: list.length });
  }
  return { global: round4(clamp(globalMedian)), byCategory };
}

/** The multiple one protocol is valued at: its category's market multiple, or the global median. */
function multipleFor(p: SnapshotProtocol, table: ReturnType<typeof categoryMultiples>): number {
  if (p.category !== null) {
    const entry = table.byCategory.get(p.category);
    if (entry !== undefined) return entry.multiple;
  }
  return table.global;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  baseMultiple: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; reachMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const reachMult = 1 + model.reach_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.reach_cap_chains);
  const base = protocol.tvl_usd * baseMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * reachMult));
  return { implied, growthPct, growthMult, maturityMult, reachMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Every rankable pre-token protocol in the snapshot, scored and ranked, strongest first. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const table = categoryMultiples(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is on the board even if a rule below would skip it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The radar proper: every other rankable pre-token protocol, at any TVL. The floor is never the
  // whole board, and a capped sample would hide exactly the early rows the radar exists to find.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const baseMultiple = multipleFor(p, table);
    const { implied, growthPct, growthMult, maturityMult, reachMult, age } = impliedValue(p, snapshot.as_of, model, baseMultiple);
    return { p, implied, growthPct, growthMult, maturityMult, reachMult, age, baseMultiple };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: s.baseMultiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      reach_multiplier: round4(s.reachMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A whole-dollar figure with thousands separators, for plan text. */
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** One transaction's gas on the protocol's first chain: mainnet is dear, L2s and Solana are not. */
function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 12;
  if (chain === 'Solana') return 1;
  if (chain === 'Bitcoin' || chain === 'BSC') return 3;
  return 2;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply ${usd(capital)} of USDC to ${name} on ${chain} and keep the position open; if it offers borrowing, draw no more than 30% against it once.`;
  if (c.includes('dex') || c.includes('aggregator')) return `Provide ${usd(capital)} of liquidity to ${name}'s deepest pool on ${chain}, split evenly on both sides, and keep the position open.`;
  if (c.includes('yield')) return `Deposit ${usd(capital)} into ${name}'s main vault on ${chain} and keep the vault shares in the same wallet.`;
  if (c.includes('bridge')) return `Bridge ${usd(capital)} of USDC from Ethereum to ${chain === 'Ethereum' ? 'a chain it serves' : chain} through ${name}, then use the bridged funds in one app on the far side.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake ${usd(capital)} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return `Deposit ${usd(capital)} of USDC as margin on ${name} and open one small hedged position, then close it after a day.`;
  if (c.includes('prediction')) return `Fund ${usd(capital)} on ${name} and hold one position in its most liquid market until it settles.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit ${usd(capital)} into a ${name} vault on ${chain} and keep the shares; vault deposits are the activity curators are scored on.`;
  if (c.includes('stable')) return `Mint or deposit ${usd(capital)} of the stable asset through ${name} on ${chain} and hold it in the same wallet.`;
  if (c.includes('rwa')) return `Mint ${usd(capital)} of ${name}'s yield asset on ${chain} and hold it past the next monthly snapshot.`;
  if (c.includes('insurance')) return `Buy ${usd(capital)} of cover from ${name} on ${chain} and keep the policy until it expires.`;
  if (c.includes('nft') || c.includes('gaming') || c.includes('game')) return `Fund ${usd(capital)} on ${name} and complete its core in-product action once, keeping the resulting asset in the same wallet.`;
  return `Deposit ${usd(capital)} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly qualifying action, matched to the category. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex') || c.includes('aggregator')) return `Make one swap of about $25 through ${name} each week, alternating direction, so the wallet shows regular volume.`;
  if (c.includes('bridge')) return `Bridge about $25 through ${name} each week, alternating direction between the two chains it connects.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Open and close one small trade on ${name} each week, keeping total weekly volume near $100.`;
  if (c.includes('lend') || c.includes('cdp')) return `Add about $10 to the ${name} position each week and repay any borrow in full once a month.`;
  return `Make one qualifying action on ${name} each week, such as a deposit, a claim of rewards or a governance vote.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age, growth), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const growthNote = p.change_7d !== null && p.change_7d >= 20
    ? ` Its TVL grew ${p.change_7d.toFixed(1)}% in the last 7 days, so qualifying early matters more than size.`
    : '';
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline.${growthNote}`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `${usd(capital)} of capital and about $${gas} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
  ];
  if (secondChain !== null) {
    steps.push({
      text: `Repeat a smaller version of the same position on ${secondChain}, about ${usd(Math.max(25, Math.floor(capital / 2)))}, so the wallet is active on two of ${p.name}'s ${p.chains.length} chains.`,
      cost: `about ${usd(Math.max(25, Math.floor(capital / 2)))} of capital and $${gasFor(secondChain)} of gas`,
      time: '10 minutes',
    });
  } else {
    steps.push({
      text: `Deepen the same position once after a week, adding about ${usd(Math.floor(capital / 2))}, so the wallet's history is more than a single deposit.`,
      cost: `about ${usd(Math.floor(capital / 2))} of capital and $${gas} of gas`,
      time: '10 minutes',
    });
  }
  steps.push(
    {
      text: weeklyFor(p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot${age !== null && age < 365 ? `; ${p.name} has only been tracked for ${age} days, so early wallets carry more weight` : ''}.`,
      cost: `the ${usd(capital)} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes; then revoke the wallet's token approvals.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  );
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's form for data.js: the same figures and the same farm plan the board carries. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    reach_multiplier: row.model.reach_multiplier,
    on_watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const table = categoryMultiples(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const cats: CategoryMultiple[] = [...table.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: v.multiple, live_count: v.liveCount }))
    .sort((a, b) => b.live_count - a.live_count || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: table.global,
    category_multiples: cats,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
