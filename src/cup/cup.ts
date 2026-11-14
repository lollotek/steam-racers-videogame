/**
 * Steam Racers Cup (doc 04 §3 B2–B4, gameplay.md §2.1). Pure data + logic: no DOM, no Three.js,
 * runs in Node (unit tests, headless season runner).
 *
 * A season is four races, one per world. Each race pays prize money by position plus the money
 * bags collected on the track; a wreck pays the repair. Between races the Workshop sells four
 * upgrade lines that last for the season. The Cup goes to whoever earned the most.
 * The AI earn and spend with the same rules, and grow from race to race by difficulty.
 */
import { Rng } from '../core/rng';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
export type VehicleId = 'hotrod' | 'tank';
export const VEHICLE_IDS: readonly VehicleId[] = ['hotrod', 'tank'];
export const VEHICLE_NAMES: Record<VehicleId, string> = { hotrod: 'Hot Rod', tank: 'Steam Tank' };

/** One leg of the Cup: one world, one track (doc 04 §7). */
export interface CupRound {
  world: string;
  track: string;
  trackId: string;
  hazard: string;
  blurb: string;
}

export const CUP_NAME = 'Steam Racers Cup';

/** Cup order (G1): Dwarven → Victorian → Orc → Elven. */
export const CUP_ROUNDS: readonly CupRound[] = [
  {
    world: 'Dwarven deep-hall',
    track: 'Runegate Deep',
    trackId: 'runegate-deep',
    hazard: 'Forge vents: a grate glows, then a fire column. 1 PF, +1 PV.',
    blurb: 'The Descent: carved pillars, brass pipes and the Rune Engine. Technical, medium speed.',
  },
  {
    world: 'Victorian industrial city',
    track: 'Cinderholme Grand Station',
    trackId: 'cinderholme-station',
    hazard: 'Level crossing: bells, barriers, then a freight train. Crash and 3 PF.',
    blurb: 'A street circuit of brick, cast iron and gas light. Wet cobbles, 90° corners.',
  },
  {
    world: 'Orc scrapyard',
    track: 'Rustmaw Pit',
    trackId: 'rustmaw-pit',
    hazard: 'Magnet crane: the shadow grows, a scrap block drops. 4 PF, then a wall.',
    blurb: 'Wide and rough through the scrap mountains, under the Warlord idol. Hard edges.',
  },
  {
    world: 'Elven village',
    track: 'Lirael Canopy',
    trackId: 'lirael-canopy',
    hazard: 'Sap streams: ride the lit lanes for steam; between pulses they are slippery.',
    blurb: 'The finale on the canopy level: long flowing curves in the rain.',
  },
];

// --- Difficulty (B4) ----------------------------------------------------------------------------

export interface DifficultyDef {
  label: string;
  /** AI driving skill (start test, vent timing, hazards, aim patience), 0..1. */
  aiSkill: number;
  /** AI top speed and acceleration factor in the first race. */
  aiPace: number;
  /** AI pace gained per race (on top of the upgrades they buy). */
  growth: number;
  /** Prize money and repair cost factor. */
  prizeScale: number;
  /** Top speed factor for an AI at the back of the pack, far from the car ahead (no boost for the leader). */
  catchUp: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy: { label: 'Easy', aiSkill: 0.4, aiPace: 0.93, growth: 0.006, prizeScale: 0.75, catchUp: 1.03 },
  normal: { label: 'Normal', aiSkill: 0.7, aiPace: 0.98, growth: 0.01, prizeScale: 1, catchUp: 1.03 },
  hard: { label: 'Hard', aiSkill: 0.92, aiPace: 1.01, growth: 0.014, prizeScale: 1.25, catchUp: 1.02 },
};

// --- Prizes (B2) --------------------------------------------------------------------------------

/** gameplay.md §2.1 for 4 racers; a longer table when the grid is bigger (G7, to tune with D1). */
const PRIZES_4 = [100_000, 60_000, 30_000, 10_000];
const PRIZES_8 = [100_000, 70_000, 50_000, 35_000, 25_000, 15_000, 10_000, 5_000];
export const REPAIR_COST = 20_000;
export const MONEY_BAG = 5_000;

const round1000 = (v: number) => Math.round(v / 1000) * 1000;

/** Prize for a finishing position (1-based) in a race of `racers`; retired racers get nothing. */
export function prizeFor(position: number, racers: number, difficulty: Difficulty): number {
  const table = racers <= 4 ? PRIZES_4 : PRIZES_8;
  const base = table[position - 1] ?? 0;
  return round1000(base * DIFFICULTY[difficulty].prizeScale);
}

export function repairCost(difficulty: Difficulty): number {
  return round1000(REPAIR_COST * DIFFICULTY[difficulty].prizeScale);
}

// --- Workshop (B3) ------------------------------------------------------------------------------

export type UpgradeLine = 'accel' | 'topSpeed' | 'tyres' | 'suspension';
export const UPGRADE_LINES: readonly UpgradeLine[] = ['accel', 'topSpeed', 'tyres', 'suspension'];
export const UPGRADE_NAMES: Record<UpgradeLine, string> = { accel: 'Acceleration', topSpeed: 'Top speed', tyres: 'Tyres', suspension: 'Suspension' };
export const UPGRADE_HINTS: Record<UpgradeLine, string> = {
  accel: 'Engine punch out of corners and after a crash',
  topSpeed: 'Higher speed in every gear',
  tyres: 'More grip on every surface',
  suspension: 'Less drag and grip loss on rough surfaces',
};
export const MAX_LEVEL = 4;
/** Price of level k+1 (index k). */
export const UPGRADE_PRICES = [20_000, 35_000, 55_000, 80_000];
/** Effect per level. */
const PER_LEVEL: Record<UpgradeLine, number> = { accel: 0.06, topSpeed: 0.025, tyres: 0.05, suspension: 0.12 };

export type Levels = Record<UpgradeLine, number>;
export const noLevels = (): Levels => ({ accel: 0, topSpeed: 0, tyres: 0, suspension: 0 });

/** Per-vehicle driving multipliers (applied by PhysicsVehicle on top of `handling.*`). */
export interface VehicleTune {
  /** Engine acceleration factor. */
  accel: number;
  /** Top speed factor (every gear). */
  topSpeed: number;
  /** Tyre grip factor. */
  grip: number;
  /** Share (0..1) of the grip loss and drag of rough surfaces recovered by the suspension. */
  rough: number;
}

export const NEUTRAL_TUNE: VehicleTune = { accel: 1, topSpeed: 1, grip: 1, rough: 0 };

/** Workshop levels → tune, times an optional pace factor (AI difficulty). */
export function tuneFor(levels: Levels, pace = 1): VehicleTune {
  return {
    accel: (1 + PER_LEVEL.accel * levels.accel) * pace,
    topSpeed: (1 + PER_LEVEL.topSpeed * levels.topSpeed) * pace,
    grip: 1 + PER_LEVEL.tyres * levels.tyres,
    rough: PER_LEVEL.suspension * levels.suspension,
  };
}

export function upgradePrice(level: number): number | null {
  return level >= MAX_LEVEL ? null : UPGRADE_PRICES[level]!;
}

// --- Season (B2) --------------------------------------------------------------------------------

export interface SeasonRacer {
  name: string;
  color: string;
  vehicle: VehicleId;
  /** Player slot (0/1) for humans, null for the AI. */
  player: number | null;
  /** Total earned (prizes + money bags): the Cup standings. */
  earned: number;
  /** Money left to spend in the Workshop. */
  cash: number;
  levels: Levels;
  /** Finishing position per race, null when retired. */
  finishes: (number | null)[];
}

export interface RoundReport {
  racer: number;
  position: number;
  retired: boolean;
  prize: number;
  bags: number;
  repair: number;
}

export type SeasonStage = 'briefing' | 'workshop' | 'done';

export interface Season {
  v: 1;
  difficulty: Difficulty;
  seed: number;
  /** Next race (0..3); 4 when the Cup is over. */
  round: number;
  stage: SeasonStage;
  /** Racer order: humans first (racer index in the race = index here). */
  racers: SeasonRacer[];
  /** Report of the last race (results + standings screens). */
  last: RoundReport[] | null;
}

/** Placeholder identity colors until S5 is decided (doc 02 §13.1). */
export const IDENTITY_COLORS = ['#E8E2D0', '#D94848', '#3F7FE0', '#E0C040', '#4FBF6A', '#B060D0', '#40C8C0', '#E07A9A'];
export const RIVAL_NAMES = ['Player One', 'Rosso', 'Blu', 'Giallo', 'Verde', 'Viola', 'Ciano', 'Rosa'];

export interface SeasonOptions {
  difficulty: Difficulty;
  /** Vehicle per human player (1 or 2). */
  vehicles: VehicleId[];
  racers: number;
  seed: number;
}

export function playerName(player: number, players: number): string {
  return players === 2 ? `Player ${player + 1}` : 'Player One';
}

/** Default AI vehicle for racer `i` (alternating, as in M3). */
export function aiVehicle(i: number): VehicleId {
  return i % 2 === 0 ? 'hotrod' : 'tank';
}

export function newSeason(o: SeasonOptions): Season {
  const humans = o.vehicles.length;
  const n = Math.max(humans, Math.min(8, o.racers));
  const racers: SeasonRacer[] = [];
  for (let i = 0; i < n; i++) {
    const human = i < humans;
    racers.push({
      name: human ? playerName(i, humans) : RIVAL_NAMES[i]!,
      color: IDENTITY_COLORS[i] ?? '#ffffff',
      vehicle: human ? o.vehicles[i]! : aiVehicle(i),
      player: human ? i : null,
      earned: 0,
      cash: 0,
      levels: noLevels(),
      finishes: [],
    });
  }
  return { v: 1, difficulty: o.difficulty, seed: o.seed >>> 0, round: 0, stage: 'briefing', racers, last: null };
}

/** Racer indices in Cup order: most earned first, then best single finish, then fewer retirements. */
export function standings(s: Season): number[] {
  const best = (r: SeasonRacer) => Math.min(99, ...r.finishes.map((f) => f ?? 99));
  const dnf = (r: SeasonRacer) => r.finishes.filter((f) => f === null).length;
  return s.racers
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = s.racers[a]!;
      const rb = s.racers[b]!;
      return rb.earned - ra.earned || best(ra) - best(rb) || dnf(ra) - dnf(rb) || a - b;
    });
}

/**
 * Grid slot per racer (G5): standings order, leader on pole. The first race has no standings:
 * a seeded draw (as a single race, gameplay.md §2.2).
 */
export function gridFor(s: Season): number[] {
  const order = s.round === 0 ? shuffled(s.racers.length, s.seed) : standings(s);
  const grid = new Array<number>(s.racers.length);
  order.forEach((racer, slot) => (grid[racer] = slot));
  return grid;
}

/** Seeded random grid: slot per racer (single race). */
export function randomGrid(n: number, seed: number): number[] {
  const order = shuffled(n, seed);
  const grid = new Array<number>(n);
  order.forEach((racer, slot) => (grid[racer] = slot));
  return grid;
}

function shuffled(n: number, seed: number): number[] {
  const rng = new Rng(seed ^ 0x5eed);
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Driving setup of a season racer for the next race. */
export function racerTune(s: Season, i: number): VehicleTune {
  const r = s.racers[i]!;
  if (r.player !== null) return tuneFor(r.levels);
  const d = DIFFICULTY[s.difficulty];
  return tuneFor(r.levels, d.aiPace + d.growth * s.round);
}

/** What the race reports per racer (index = season racer index). */
export interface RaceOutcome {
  /** Final order position, 1-based (the sim standings when the results are confirmed). */
  position: number;
  /** Did not finish (wrecked or retired). */
  retired: boolean;
  /** Wrecked (0 PF): pays the repair. */
  wrecked: boolean;
  /** Money bags collected ($). */
  bags: number;
}

/** Money of one racer for one race (used live on the results screen too). */
export function reportFor(s: Season, racer: number, o: RaceOutcome, racers: number): RoundReport {
  const prize = o.retired ? 0 : prizeFor(o.position, racers, s.difficulty);
  return { racer, position: o.position, retired: o.retired, prize, bags: o.bags, repair: o.wrecked ? repairCost(s.difficulty) : 0 };
}

/**
 * Close a race: pay prizes and bags, charge repairs (never below zero), record finishes, let the
 * AI shop, move to the Workshop (or the end of the Cup). Mutates and returns the season.
 */
export function applyRace(s: Season, outcomes: RaceOutcome[]): Season {
  if (s.stage !== 'briefing' || s.round >= CUP_ROUNDS.length) throw new Error('applyRace: no race pending');
  if (outcomes.length !== s.racers.length) throw new Error('applyRace: one outcome per racer');
  const report = outcomes.map((o, i) => reportFor(s, i, o, s.racers.length));
  report.forEach((rep, i) => {
    const r = s.racers[i]!;
    const income = rep.prize + rep.bags;
    r.earned += income;
    rep.repair = Math.min(rep.repair, r.cash + income);
    r.cash += income - rep.repair;
    r.finishes.push(rep.retired ? null : rep.position);
  });
  s.last = report;
  s.round++;
  s.stage = s.round >= CUP_ROUNDS.length ? 'done' : 'workshop';
  if (s.stage === 'workshop') aiShopping(s);
  return s;
}

/** Buy the next level of a line. Returns false when maxed or too expensive. */
export function buyUpgrade(s: Season, racer: number, line: UpgradeLine): boolean {
  const r = s.racers[racer]!;
  const price = upgradePrice(r.levels[line]);
  if (price === null || price > r.cash) return false;
  r.cash -= price;
  r.levels[line]++;
  return true;
}

/**
 * AI Workshop (B4): same prices as the players. Each AI has a preferred order of lines (by racer
 * index) and keeps buying the lowest level it can afford, keeping one repair in reserve on Hard.
 */
export function aiShopping(s: Season): void {
  const reserve = s.difficulty === 'hard' ? repairCost(s.difficulty) : 0;
  s.racers.forEach((r, i) => {
    if (r.player !== null) return;
    const pref = UPGRADE_LINES.map((_, k) => UPGRADE_LINES[(k + i) % UPGRADE_LINES.length]!);
    for (;;) {
      let pick: UpgradeLine | null = null;
      for (const line of pref) {
        const price = upgradePrice(r.levels[line]);
        if (price === null || price > r.cash - reserve) continue;
        if (pick === null || r.levels[line] < r.levels[pick]) pick = line;
      }
      if (pick === null || !buyUpgrade(s, i, pick)) break;
    }
  });
}

/** Leave the Workshop: next race briefing. */
export function toBriefing(s: Season): Season {
  if (s.stage === 'workshop') s.stage = 'briefing';
  return s;
}

/** Sum of the Workshop levels (standings column). */
export const levelSum = (r: SeasonRacer) => UPGRADE_LINES.reduce((a, l) => a + r.levels[l], 0);

export function formatMoney(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

// --- Persistence --------------------------------------------------------------------------------

/** Validate a parsed save (anything else → null, the title then offers no Continue). */
export function parseSeason(raw: unknown): Season | null {
  const s = raw as Season;
  if (!s || typeof s !== 'object' || s.v !== 1) return null;
  if (!DIFFICULTIES.includes(s.difficulty) || !Array.isArray(s.racers) || s.racers.length < 1 || s.racers.length > 8) return null;
  if (!Number.isInteger(s.round) || s.round < 0 || s.round > CUP_ROUNDS.length) return null;
  if (!['briefing', 'workshop', 'done'].includes(s.stage)) return null;
  for (const r of s.racers) {
    if (!r || typeof r.name !== 'string' || !VEHICLE_IDS.includes(r.vehicle) || !Number.isFinite(r.earned) || !Number.isFinite(r.cash)) return null;
    if (!r.levels || UPGRADE_LINES.some((l) => !Number.isInteger(r.levels[l]) || r.levels[l] < 0 || r.levels[l] > MAX_LEVEL)) return null;
    if (!Array.isArray(r.finishes)) return null;
  }
  return s;
}

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const SAVE_KEY = 'steamRacers.cup.v1';

export function loadSeason(store: KeyValueStore | null): Season | null {
  try {
    const txt = store?.getItem(SAVE_KEY);
    return txt ? parseSeason(JSON.parse(txt)) : null;
  } catch {
    return null;
  }
}

export function saveSeason(store: KeyValueStore | null, s: Season | null): void {
  try {
    if (!store) return;
    if (s) store.setItem(SAVE_KEY, JSON.stringify(s));
    else store.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable (private mode): the Cup still runs, it just is not saved */
  }
}
