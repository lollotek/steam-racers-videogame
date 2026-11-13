/**
 * Hull points, edge damage and ramming (gameplay.md §6), pure and deterministic.
 * Under 50 % the engine smokes, under 25 % it burns; at 0 the vehicle is a wreck (retired).
 */
import { tunables } from '../core/tunables';
import type { Rng } from '../core/rng';
import type { Barricade } from '../track/track-format';
import { BARRICADES } from '../race/barricades';

/** PF per edge event (gameplay.md §6.3 table). Scrape = PF every `scrapeEvery` s of contact (0 = never). */
const EDGE_DAMAGE: Record<Barricade, { hit: number; crash: number; scrapeEvery: number }> = {
  earth: { hit: 0, crash: 1, scrapeEvery: 0 },
  riveted: { hit: 1, crash: 2, scrapeEvery: 0 },
  hedgehog: { hit: 2, crash: 3, scrapeEvery: 1.5 },
  corrugated: { hit: 1, crash: 1, scrapeEvery: 0 },
  sandbags: { hit: 0, crash: 1, scrapeEvery: 0 },
  barbed: { hit: 0, crash: 0, scrapeEvery: 0 },
};

tunables.registerGroup('hull', [
  { key: 'hull.smokeAt', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05, label: 'Engine smokes below (× PF)' },
  { key: 'hull.fireAt', type: 'number', default: 0.25, min: 0, max: 1, step: 0.05, label: 'Engine burns below (× PF)' },
  { key: 'hull.wreckToResults', type: 'number', default: 3, min: 0, max: 15, step: 0.5, unit: 's', label: 'Player wrecked → results after' },
  { key: 'hull.pushedBonus', type: 'number', default: 1, min: 0, max: 5, step: 1, unit: 'PF', label: 'Edge hit while rammed: extra PF' },
  { key: 'hull.ramMinSpeed', type: 'number', default: 5, min: 0.5, max: 30, step: 0.5, unit: 'm/s', label: 'Ram: min closing speed' },
  { key: 'hull.ramNoseCos', type: 'number', default: 0.7, min: 0, max: 1, step: 0.05, label: 'Ram: nose cone (cos)' },
  { key: 'hull.ramPerpBonus', type: 'number', default: 2, min: 0, max: 6, step: 1, label: 'Ram: perpendicular bonus' },
  { key: 'hull.ramDie', type: 'number', default: 4, min: 1, max: 12, step: 1, label: 'Ram: die sides' },
  { key: 'hull.ramShove', type: 'number', default: 4, min: 0, max: 20, step: 0.5, unit: 'm/s', label: 'Ram: shove on a strong win' },
  { key: 'hull.ramCooldown', type: 'number', default: 0.8, min: 0, max: 5, step: 0.1, unit: 's', label: 'Ram: same pair cooldown' },
  { key: 'hull.sideSpeed', type: 'number', default: 7, min: 0.5, max: 30, step: 0.5, unit: 'm/s', label: 'Side contact: min speed for 1 PF' },
  ...BARRICADES.flatMap((b) => {
    const d = EDGE_DAMAGE[b];
    return [
      { key: `hull.${b}.hit`, type: 'number' as const, default: d.hit, min: 0, max: 10, step: 1, unit: 'PF', label: `${b}: hit damage` },
      { key: `hull.${b}.crash`, type: 'number' as const, default: d.crash, min: 0, max: 10, step: 1, unit: 'PF', label: `${b}: crash damage` },
      { key: `hull.${b}.scrapeEvery`, type: 'number' as const, default: d.scrapeEvery, min: 0, max: 10, step: 0.25, unit: 's', label: `${b}: 1 PF every (scrape, 0 = never)` },
    ];
  }),
]);

export interface HullState {
  pf: number;
  max: number;
  res: number;
  wrecked: boolean;
  wreckedAt: number | null;
  /** Seconds of continuous scraping counted towards the next scrape PF. */
  scrapeAcc: number;
  /** Seconds since this vehicle lost a ram (edge hits count extra while > 0). */
  rammedFor: number;
}

export function createHull(max: number, res: number): HullState {
  return { pf: max, max, res, wrecked: false, wreckedAt: null, scrapeAcc: 0, rammedFor: 0 };
}

export type HullCondition = 'ok' | 'smoke' | 'fire' | 'wreck';

export function hullCondition(h: HullState): HullCondition {
  if (h.wrecked) return 'wreck';
  const f = h.pf / h.max;
  if (f < tunables.get<number>('hull.fireAt')) return 'fire';
  if (f < tunables.get<number>('hull.smokeAt')) return 'smoke';
  return 'ok';
}

/**
 * Apply damage. `armour`: RES applies (weapon hits); edge, boiler and ramming tables are already net.
 * Returns PF actually lost.
 */
export function damage(h: HullState, pf: number, clock: number, armour = false): number {
  if (h.wrecked || pf <= 0) return 0;
  const net = Math.max(0, Math.round(armour ? pf - h.res : pf));
  h.pf = Math.max(0, h.pf - net);
  if (h.pf === 0) {
    h.wrecked = true;
    h.wreckedAt = clock;
  }
  return net;
}

/** PF for an edge event of the given kind (gameplay.md §6.3). */
export function edgeDamage(type: Barricade, kind: 'hit' | 'crash', rammed: boolean): number {
  const base = tunables.get<number>(`hull.${type}.${kind}`);
  return base + (rammed && type !== 'barbed' ? tunables.get<number>('hull.pushedBonus') : 0);
}

/** Scrape contact: returns PF to apply this step (0 or 1). */
export function scrapeDamage(h: HullState, type: Barricade, contact: boolean, dt: number): number {
  const every = tunables.get<number>(`hull.${type}.scrapeEvery`);
  if (!contact || every <= 0) {
    h.scrapeAcc = 0;
    return 0;
  }
  h.scrapeAcc += dt;
  if (h.scrapeAcc >= every) {
    h.scrapeAcc -= every;
    return 1;
  }
  return 0;
}

export interface RamSide {
  /** Ramming mass factor (VehicleStats.mass). */
  mass: number;
  gear: number;
  /** This vehicle hits with its nose. */
  nose: boolean;
}

export interface RamResult {
  /** PF lost by a and b. */
  a: number;
  b: number;
  /** Who won the test (+1 = a, -1 = b, 0 = side contact / draw). */
  winner: number;
  margin: number;
}

/**
 * Ramming test (gameplay.md §6.2): inertia (mass × gear), perpendicular bonus for the attacker,
 * a small die each. The loser loses more; a strong margin also shoves the loser (caller).
 * No nose involved → side contact: 1 PF each if fast enough.
 */
export function ram(a: RamSide, b: RamSide, perpendicular: boolean, closing: number, rng: Rng): RamResult {
  const t = (k: string) => tunables.get<number>(k);
  if (!a.nose && !b.nose) {
    const pf = closing >= t('hull.sideSpeed') ? 1 : 0;
    return { a: pf, b: pf, winner: 0, margin: 0 };
  }
  const die = t('hull.ramDie');
  const perp = perpendicular ? t('hull.ramPerpBonus') : 0;
  const score = (s: RamSide) => s.mass * s.gear + (s.nose ? perp : 0) + rng.die(die);
  const sa = score(a);
  const sb = score(b);
  const margin = Math.abs(sa - sb);
  const winner = sa === sb ? 0 : sa > sb ? 1 : -1;
  // Usually both pay; the winner pays less (nothing on a clear win).
  const loserPf = 1 + Math.floor(margin / 3);
  const winnerPf = margin >= 3 ? 0 : 1;
  if (winner === 0) return { a: 1, b: 1, winner, margin };
  return winner > 0 ? { a: winnerPf, b: loserPf, winner, margin } : { a: loserPf, b: winnerPf, winner, margin };
}
