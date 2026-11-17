// Model radar-2 untuk token launch radar (token-radar-01).
//
// Satu snapshot masuk, satu board berperingkat keluar. Board mencakup seluruh
// watchlist (lantai, bukan langit-langit) ditambah semua protokol pre-token
// lain yang bisa diranking. Protokol bertoken dipisah ke tampilan Live dan
// tidak pernah masuk board berperingkat.
//
// Penilaian hanya memakai angka snapshot — tidak ada nama protokol yang
// diperlakukan khusus. Early set mengecualikan kategori yang produknya
// secara definisi adalah representasi wrapped/staked/bridged dari aset lain
// (lihat NON_LAUNCHABLE_CATEGORIES di bawah); anggota watchlist tidak
// terkena filter itu dan selalu tercakup. Kalibrasi datang dari pasar itu
// sendiri: untuk tiap kategori, refMultiple adalah median rasio mcap/TVL atas protokol bertoken
// di kategori itu (minimal 3 sampel), kalau tidak memakai median global.
// Lalu:
//
//   base           = tvl_usd x refMultiple x 0.6   (diskon pre-token)
//   growthPct      = clamp(change_7d ?? 0, -50, 150)
//   growthMult     = 1 + 0.6 x growthPct / 100
//   ageMult        = 0.7 + 0.3 x min(ageDays, 1095) / 1095   (ageDays null -> 365)
//   chainMult      = 1 + 0.04 x min(max(chains.length - 1, 0), 5)
//   implied        = max(1, round(base x growthMult x ageMult x chainMult))
//
// Farm plan tiap baris diturunkan dari kategori, chain utama, TVL, dan umur
// protokol itu sendiri — bukan dari daftar nama yang ditulis tangan.

/** Entri protokol di snapshot: tepat sepuluh field yang dibawa input tersegel. */
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

/** Seluruh dokumen snapshot. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Konstanta model radar-2, seperti yang dinyatakan dashboard. */
export interface ModelConstants {
  pre_token_discount: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max: number;
  ref_multiple_floor: number;
  ref_multiple_cap: number;
}

export const MODEL: ModelConstants = {
  pre_token_discount: 0.6,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_max: 5,
  ref_multiple_floor: 0.05,
  ref_multiple_cap: 2.5,
};

/** Label versi model: dashboard menyebutnya. */
export const MODEL_VERSION = 'radar-2';

/** Berapa protokol bertoken yang dibawa tampilan Live, berdasarkan market cap. */
export const LIVE_ROWS = 24;

/** Satu langkah farm: aksi, biaya, dan waktunya. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** Satu baris board.json: baris board berperingkat. */
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
  age_days: number;
  implied_value_usd: number;
  model: {
    ref_multiple: number;
    pre_token_discount: number;
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number;
  };
  farm_steps: string[];
}

/** Bentuk ringkas satu baris untuk data.js. `watchlist` menandai anggota
 * watchlist tersegel, supaya toggle watchlist-only di dashboard eksak
 * (bukan proksi TVL >= floor — ada baris early dengan TVL di atas floor). */
export interface RadarRow {
  rank: number;
  watchlist: boolean;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  ref_multiple: number;
  farm_steps: string[];
}

/** Protokol bertoken: sudah diperdagangkan, jadi board menampilkan nilai pasarnya, bukan nilai model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Semua yang dibutuhkan dashboard: board, set live, dan model yang menjalankannya. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants & { global_ref_multiple: number };
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  ref_multiples: Record<string, number>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Alasan snapshot bukan snapshot yang bisa dinilai model ini. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Median sebuah daftar angka; daftar kosong menghasilkan null. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Kalibrasi refMultiple dari snapshot: median mcap/TVL protokol bertoken per
 * kategori (minimal 3 sampel), kalau tidak median global. Keduanya di-clamp
 * ke [ref_multiple_floor, ref_multiple_cap]. Mengembalikan median global dan
 * peta kategori -> multiple (hanya kategori yang muncul di board).
 *
 * Kedua nilai dibulatkan ke 4 desimal DI SINI, sebelum dipakai menghitung
 * implied value — karena data.js membawa ref_multiple yang sama (4 desimal)
 * dan dashboard menghitung ulang implied value di halaman dari angka itu.
 * Tanpa pembulatan di sumber, hasil hitung-ulang halaman akan meleset beberapa
 * dolar dari board dan cek "matches the board value" gagal, padahal tampilannya
 * sama. Pembulatan 4 desimal mengubah implied value kurang dari 0,005%.
 */
export function calibrateRefMultiples(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { global: number; byCategory: Map<string, number> } {
  const tokened = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const globalRaw = median(tokened.map((p) => p.mcap_usd! / p.tvl_usd));
  const global = round4(clamp(globalRaw ?? 1, model.ref_multiple_floor, model.ref_multiple_cap));
  const byCategory = new Map<string, number>();
  const perCategory = new Map<string, number[]>();
  for (const p of tokened) {
    if (p.category === null) continue;
    const list = perCategory.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    perCategory.set(p.category, list);
  }
  const boardCategories = new Set(
    snapshot.protocols.filter(isRankable).map((p) => p.category).filter((c): c is string => c !== null),
  );
  for (const category of [...boardCategories].sort()) {
    const samples = perCategory.get(category) ?? [];
    const raw = samples.length >= 3 ? median(samples) : null;
    byCategory.set(category, round4(clamp(raw ?? global, model.ref_multiple_floor, model.ref_multiple_cap)));
  }
  return { global, byCategory };
}

/** Jumlah hari dari `listedAt` ke `asOf`, dibatasi di nol; null bila tanggal tidak ada atau rusak. */
export function rawAgeDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Umur efektif untuk model: umur mentah, atau unknown_age_days bila tidak diketahui. */
export function ageDays(asOf: string, listedAt: string | null, model: ModelConstants = MODEL): number {
  return rawAgeDays(asOf, listedAt) ?? model.unknown_age_days;
}

/** Pengali dan nilai implied satu protokol di bawah model radar-2. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  refMultiple: number,
  model: ModelConstants = MODEL,
): {
  implied: number;
  refMultiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number;
} {
  const age = ageDays(asOf, protocol.listed_at, model);
  const growthPct = clamp(protocol.change_7d ?? 0, model.growth_floor, model.growth_cap);
  const growthMult = 1 + model.growth_weight * (growthPct / 100);
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max);
  const base = protocol.tvl_usd * refMultiple * model.pre_token_discount;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return { implied, refMultiple, growthPct, growthMult, maturityMult, chainMult, age };
}

/** Aturan penanda versi DefiLlama: nama yang berakhiran rilis adalah pool dari protokol lain. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Kategori yang produknya SECARA DEFINISI adalah representasi wrapped/staked/
 * bridged dari aset lain, bukan protokol independen: sebuah bridge, token
 * liquid-staking, atau BTC yang di-anchor tidak akan meluncurkan token
 * independennya sendiri, jadi implied value model tidak berlaku untuknya.
 * Aturan yang sama sudah diterapkan oleh watchlist tersegel di brief
 * kompetisi — watchlist mengecualikan produk wrapped/staked/bridged — jadi
 * filter ini menyamakan early set dengan definisi watchlist itu.
 *
 * Filter ini HANYA berlaku untuk early set (lihat buildBoard): anggota
 * watchlist selalu tercakup apa pun kategorinya, karena gate menuntut
 * cakupan watchlist 40/40. Kategori yang sengaja TIDAK dikecualikan di sini:
 * "Staking Pool", "Stablecoin Wrapper", dan "Restaking" — watchlist tersegel
 * sendiri berisi masing-masing satu anggota kategori itu, jadi kategori
 * tersebut tetap layak diranking.
 */
const NON_LAUNCHABLE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Anchor BTC',
  'Decentralized BTC',
]);

/** Apakah protokol tidak mencatat token sama sekali. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Apakah protokol boleh diranking di board sebagai anggota early set:
 * pre-token, bukan exchange, bukan pool berversi, dan bukan representasi
 * wrapped/staked/bridged dari aset lain. Filter kategori terakhir ini
 * TIDAK berlaku untuk anggota watchlist — buildBoard menambahkan watchlist
 * tanpa melewati isRankable, jadi cakupan watchlist 40/40 tetap terjamin
 * apa pun kategorinya.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    p.category !== 'CEX' &&
    !VERSIONED.test(p.name) &&
    !(p.category !== null && NON_LAUNCHABLE_CATEGORIES.has(p.category))
  );
}

/** Protokol snapshot berdasarkan slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Protokol yang diranking board, terkuat dulu, dengan rank 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { byCategory, global } = calibrateRefMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // Watchlist adalah lantai: tiap slug yang snapshot bawa ikut serta.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Radar awal: semua protokol pre-token lain yang bisa diranking, di bawah
  // lantai watchlist sekalipun. Protokol yang sudah dipilih tetap dipilih.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const refMultiple = p.category === null ? global : (byCategory.get(p.category) ?? global);
    const scoredValue = impliedValue(p, snapshot.as_of, refMultiple, model);
    return { p, refMultiple, ...scoredValue };
  });
  scored.sort(
    (a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
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
      ref_multiple: round4(s.refMultiple),
      pre_token_discount: model.pre_token_discount,
      base_multiple: round4(s.refMultiple * model.pre_token_discount),
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, rawAgeDays(snapshot.as_of, s.p.listed_at)).map(stepText),
  }));
}

/** Satu langkah sebagai satu string: aksi, lalu biaya dan waktunya, dalam batas gate 20..600 karakter. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** Chain pertama yang disebut protokol, atau frasa netral. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Besaran modal satu posisi farm, dari TVL protokol itu sendiri. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Berapa lama posisi ditahan, dari umur protokol: yang lebih muda mendapat jendela kualifikasi lebih panjang. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * Satu aksi kategori, dengan kata-kata yang bisa diikuti petani. Dicek dari
 * yang paling spesifik ke yang paling umum, agar "Cross Chain Bridge" tidak
 * tertukar dengan kategori "Chain" dan "Onchain Capital Allocator" tidak
 * tertukar dengan chain.
 */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Put $${capital} of USDC to work as a supply on ${name} on ${chain} and leave the supply in place.`;
  }
  if (c.includes('leveraged farm') || c.includes('dex') || c.includes('yield')) {
    return `Add $${capital} of liquidity to the main pool of ${name} on ${chain} and leave the liquidity in place.`;
  }
  if (c.includes('bridge') || c.includes('cross-chain') || c.includes('cross chain')) {
    return `Move $${capital} of USDC across to ${chain} using ${name}, then put the bridged funds to use inside its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and hold on to the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Place $${capital} of USDC as margin on ${name} and open a single small hedge against it.`;
  }
  if (c.includes('prediction')) {
    return `Fund your account with $${capital} on ${name} and take one position in a single market.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Put $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the yield-bearing asset from ${name} on ${chain} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('payment')) {
    return `Use ${name} on ${chain} to pay $${capital} for a real purchase and keep the receipt.`;
  }
  if (c.includes('launchpad')) {
    return `Join a launch on ${name} with $${capital} on ${chain} and follow its vesting terms.`;
  }
  if (c.includes('option')) {
    return `Buy one option worth $${capital} on ${name} on ${chain} and note its expiry.`;
  }
  if (c.includes('synthetic')) {
    return `Mint $${capital} of the synthetic asset on ${name} on ${chain} and hold it.`;
  }
  if (c === 'chain' || c.startsWith('chain ')) {
    return `Use ${name} on ${chain} directly with $${capital} across its own apps and keep the activity on that chain.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and leave the deposit in place.`;
}

/**
 * Rencana farm sebuah protokol: enam langkah, masing-masing aksi dengan biaya
 * dan waktu. Rencana diturunkan dari catatan protokol itu sendiri (kategori,
 * chain, TVL, umur), bukan dari daftar nama yang ditulis tangan.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Start with a fresh wallet that holds only the funds you mean to farm, and store its seed phrase offline where nobody else can reach it.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Do one qualifying action every week, like a deposit, a borrow, a swap or a vote, so the wallet stays visibly active.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only through the link it publishes there, and never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Record the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it later.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** Protokol bertoken, berdasarkan market cap, untuk tampilan Live token di dashboard. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
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

/** Bentuk ringkas satu baris board untuk data.js. `watchlist` diisi pemanggil
 * dari snapshot (anggota watchlist tersegel); default false bila tak diisi. */
export function radarRow(row: BoardRow, watchlist = false): RadarRow {
  return {
    rank: row.rank,
    watchlist,
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
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    ref_multiple: row.model.ref_multiple,
    farm_steps: row.farm_steps,
  };
}

/** Semua yang dirender dashboard, dari snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { global, byCategory } = calibrateRefMultiples(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const refMultiples: Record<string, number> = {};
  for (const category of [...byCategory.keys()].sort()) refMultiples[category] = round4(byCategory.get(category)!);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: { ...model, global_ref_multiple: round4(global) },
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    ref_multiples: refMultiples,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
  };
  return { board, radar };
}

/** Snapshot dari teks file, ditolak kecuali bentuknya adalah bentuk yang dinilai model. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date (YYYY-MM-DD)');
  }
  if (typeof o.source !== 'string' || o.source.length === 0) {
    throw new SnapshotError('snapshot.json has no source');
  }
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string' || s.length === 0)) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const seen = new Set<string>();
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || p.slug.length === 0) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug`);
    }
    if (seen.has(p.slug)) throw new SnapshotError(`snapshot.json repeats slug ${p.slug}`);
    seen.add(p.slug);
    if (typeof p.name !== 'string' || p.name.length === 0) {
      throw new SnapshotError(`snapshot.json's protocol ${i} (${p.slug}) lacks a name`);
    }
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) {
      throw new SnapshotError(`snapshot.json's protocol ${i} (${p.slug}) lacks a TVL`);
    }
    if (p.category !== null && typeof p.category !== 'string') {
      throw new SnapshotError(`snapshot.json's protocol ${i} (${p.slug}) has a bad category`);
    }
    if (!Array.isArray(p.chains) || p.chains.some((c) => typeof c !== 'string')) {
      throw new SnapshotError(`snapshot.json's protocol ${i} (${p.slug}) has bad chains`);
    }
    if (p.change_7d !== null && (typeof p.change_7d !== 'number' || !Number.isFinite(p.change_7d))) {
      throw new SnapshotError(`snapshot.json's protocol ${i} (${p.slug}) has a bad change_7d`);
    }
    if (p.mcap_usd !== null && (typeof p.mcap_usd !== 'number' || !Number.isFinite(p.mcap_usd))) {
      throw new SnapshotError(`snapshot.json's protocol ${i} (${p.slug}) has a bad mcap_usd`);
    }
    // Catatan: snapshot membawa mcap_usd -1 sebagai sentinel DefiLlama untuk
    // market cap yang tidak diketahui (token tercatat, nilai tidak); nilai
    // <= 0 tidak pernah dipakai sebagai market cap — kalibrasi dan Live
    // hanya memakai mcap_usd > 0.
    if (p.listed_at !== null && (typeof p.listed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.listed_at))) {
      throw new SnapshotError(`snapshot.json's protocol ${i} (${p.slug}) has a bad listed_at`);
    }
    if (p.gecko_id !== null && typeof p.gecko_id !== 'string') {
      throw new SnapshotError(`snapshot.json's protocol ${i} (${p.slug}) has a bad gecko_id`);
    }
    if (p.symbol !== null && typeof p.symbol !== 'string') {
      throw new SnapshotError(`snapshot.json's protocol ${i} (${p.slug}) has a bad symbol`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: p.category as string | null,
      chains: p.chains as string[],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d as number | null,
      mcap_usd: p.mcap_usd as number | null,
      listed_at: p.listed_at as string | null,
      gecko_id: p.gecko_id as string | null,
      symbol: p.symbol as string | null,
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

/**
 * Alasan board bukan board yang diterima gate, atau null: cakupan watchlist,
 * rank, urutan, nilai implied, dan langkah farm.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `the board has ${board.length} rows, outside the gate's 100..4000`;
  }
  const snapshotSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (!snapshotSlugs.has(r.slug)) return `${r.slug} is not a slug in the snapshot`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice on the board`;
    slugs.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has an empty name`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `${r.slug} has a farm step of ${trimmed.length} characters`;
      }
    }
  }
  return null;
}

/** data.js yang ringkas: seluruh dataset dashboard sebagai satu skrip, tanpa fetch dan tanpa network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
