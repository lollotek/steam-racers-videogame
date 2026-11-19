/**
 * Front cannon and the dispersion cone (gameplay.md §7.1–7.2), pure and deterministic.
 * The cannon locks by itself on the rival ahead; the shot lands at a random angle in the cone.
 * Where the line crosses the target silhouette decides the zone:
 *   centre / vital → critical damage · body → damage · edge → sparks only · miss.
 * Damage minus the target RES; only a centre hit applies the special effect (−1 gear).
 */
import { tunables } from '../core/tunables';
import type { Rng } from '../core/rng';

tunables.registerGroup('weapons', [
  { key: 'weapons.unlockGear', type: 'number', default: 6, min: 1, max: 6, step: 1, label: 'Weapons unlock reaching gear (1 = from GO)' },
  { key: 'weapons.unlockLap', type: 'number', default: 1, min: 0, max: 5, step: 1, unit: 'laps', label: '…or after laps (0 = gear only)' },
  { key: 'weapons.cannon.ammo', type: 'number', default: 6, min: 0, max: 30, step: 1, label: 'Cannon: shells at the start' },
  { key: 'weapons.cannon.lapAmmo', type: 'number', default: 1, min: 0, max: 10, step: 1, label: 'Cannon: shells per lap (until ammo crates)' },
  { key: 'weapons.cannon.cooldown', type: 'number', default: 1.2, min: 0.1, max: 5, step: 0.05, unit: 's', label: 'Cannon: reload time' },
  { key: 'weapons.cannon.range', type: 'number', default: 70, min: 10, max: 200, step: 1, unit: 'm', label: 'Cannon: lock range' },
  { key: 'weapons.cannon.lockAngle', type: 'number', default: 22, min: 2, max: 60, step: 1, unit: '°', label: 'Cannon: lock half-angle' },
  { key: 'weapons.cannon.lockTime', type: 'number', default: 0.35, min: 0, max: 2, step: 0.05, unit: 's', label: 'Cannon: time to lock' },
  { key: 'weapons.cannon.damage', type: 'number', default: 2, min: 0, max: 20, step: 1, unit: 'PF', label: 'Cannon: base damage' },
  { key: 'weapons.cannon.vitalBonus', type: 'number', default: 1, min: 0, max: 10, step: 1, unit: 'PF', label: 'Cannon: vital extra' },
  { key: 'weapons.cannon.centreBonus', type: 'number', default: 2, min: 0, max: 10, step: 1, unit: 'PF', label: 'Cannon: centre extra' },
  { key: 'weapons.cannon.speed', type: 'number', default: 140, min: 20, max: 500, step: 5, unit: 'm/s', label: 'Cannon: shell speed (flight time)' },
  { key: 'weapons.cone.base', type: 'number', default: 5, min: 0, max: 15, step: 0.1, unit: '°', label: 'Cone: base half-angle' },
  { key: 'weapons.cone.highGear', type: 'number', default: 1.5, min: 0, max: 10, step: 0.1, unit: '°', label: 'Cone: per side in 5th/6th' },
  { key: 'weapons.cone.steer', type: 'number', default: 4, min: 0, max: 15, step: 0.1, unit: '°', label: 'Cone: full steering' },
  { key: 'weapons.cone.manoeuvre', type: 'number', default: 2, min: 0, max: 10, step: 0.1, unit: '°', label: 'Cone: recent manoeuvre' },
  { key: 'weapons.cone.cloud', type: 'number', default: 5, min: 0, max: 20, step: 0.1, unit: '°', label: 'Cone: through a vent cloud' },
  { key: 'weapons.cone.steady', type: 'number', default: 1, min: 0, max: 5, step: 0.1, unit: '°', label: 'Cone: holding the line (−)' },
  { key: 'weapons.cone.steadyTime', type: 'number', default: 1, min: 0, max: 5, step: 0.1, unit: 's', label: 'Cone: time to hold the line' },
  { key: 'weapons.cone.wobble', type: 'number', default: 1.3, min: 0, max: 4, step: 0.05, unit: 'm', label: 'Shell wobble (lateral, any range)' },
  { key: 'weapons.zone.centre', type: 'number', default: 0.1, min: 0, max: 1, step: 0.01, label: 'Zone: centre (× half width)' },
  { key: 'weapons.zone.vital', type: 'number', default: 0.3, min: 0, max: 1, step: 0.01, label: 'Zone: vital' },
  { key: 'weapons.zone.body', type: 'number', default: 0.85, min: 0, max: 1.5, step: 0.01, label: 'Zone: body' },
  { key: 'weapons.zone.edge', type: 'number', default: 1.15, min: 0, max: 2, step: 0.01, label: 'Zone: edge (sparks only)' },
]);

export type HitZone = 'centre' | 'vital' | 'body' | 'edge' | 'miss';

export interface CannonState {
  ammo: number;
  cooldown: number;
  /** Locked racer index, or -1. */
  target: number;
  /** Seconds the current target has been in the lock cone. */
  lockTime: number;
  /** Seconds holding a straight line (narrows the cone). */
  steady: number;
  /** Seconds since the last gear change / push (widens the cone). */
  sinceManoeuvre: number;
}

export function createCannon(): CannonState {
  return { ammo: tunables.get<number>('weapons.cannon.ammo'), cooldown: 0, target: -1, lockTime: 0, steady: 0, sinceManoeuvre: 99 };
}

/**
 * Boiler warm-up (gameplay.md §7.1): weapons start cold and arm, for good, the first time the
 * racer reaches `weapons.unlockGear` or completes `weapons.unlockLap` laps, whichever comes first.
 */
export function armedAtStart(): boolean {
  return tunables.get<number>('weapons.unlockGear') <= 1;
}

export function armsNow(gear: number, lapsDone: number): boolean {
  const lap = tunables.get<number>('weapons.unlockLap');
  return gear >= tunables.get<number>('weapons.unlockGear') || (lap > 0 && lapsDone >= lap);
}

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];

/** Short unlock condition for the HUD and help, e.g. "6th gear or lap 2". */
export function armingHint(): string {
  const gear = tunables.get<number>('weapons.unlockGear');
  const lap = tunables.get<number>('weapons.unlockLap');
  const g = `${ORDINAL[gear] ?? `${gear}th`} gear`;
  return lap > 0 ? `${g} or lap ${lap + 1}` : g;
}

/** Compact form for the HUD cannon box, e.g. "gear 6 / lap 2". */
export function armingShort(): string {
  const gear = tunables.get<number>('weapons.unlockGear');
  const lap = tunables.get<number>('weapons.unlockLap');
  return lap > 0 ? `gear ${gear} / lap ${lap + 1}` : `gear ${gear}`;
}

export function isLocked(c: CannonState): boolean {
  return c.target >= 0 && c.lockTime >= tunables.get<number>('weapons.cannon.lockTime');
}

export interface Candidate {
  index: number;
  x: number;
  z: number;
}

/**
 * Pick the target: the nearest candidate inside range and the lock half-angle around the nose.
 * Returns -1 when nothing qualifies.
 */
export function pickTarget(x: number, z: number, heading: number, cands: readonly Candidate[]): number {
  const range = tunables.get<number>('weapons.cannon.range');
  const cosLock = Math.cos((tunables.get<number>('weapons.cannon.lockAngle') * Math.PI) / 180);
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  let best = -1;
  let bestD = Infinity;
  for (const c of cands) {
    const dx = c.x - x;
    const dz = c.z - z;
    const d = Math.hypot(dx, dz);
    if (d < 1 || d > range) continue;
    if ((dx * fx + dz * fz) / d < cosLock) continue;
    if (d < bestD) {
      bestD = d;
      best = c.index;
    }
  }
  return best;
}

export interface ConeInputs {
  shooterGear: number;
  targetGear: number;
  /** |steer| 0..1 of the shooter. */
  steer: number;
  steady: number;
  sinceManoeuvre: number;
  throughCloud: boolean;
}

/** Cone half-angle in degrees. */
export function coneHalfAngle(i: ConeInputs): number {
  const t = (k: string) => tunables.get<number>(k);
  let a = t('weapons.cone.base');
  if (i.shooterGear >= 5) a += t('weapons.cone.highGear');
  if (i.targetGear >= 5) a += t('weapons.cone.highGear');
  a += Math.min(1, i.steer) * t('weapons.cone.steer');
  if (i.sinceManoeuvre < 0.8) a += t('weapons.cone.manoeuvre');
  if (i.throughCloud) a += t('weapons.cone.cloud');
  if (i.steady >= t('weapons.cone.steadyTime')) a -= t('weapons.cone.steady');
  return Math.max(0.2, a);
}

/**
 * Zone from the lateral miss distance at the target.
 * @param offset lateral distance of the shot line from the target centre (m)
 * @param halfWidth target half width (m)
 */
export function zoneOf(offset: number, halfWidth: number): HitZone {
  const t = (k: string) => tunables.get<number>(k);
  const f = Math.abs(offset) / halfWidth;
  if (f <= t('weapons.zone.centre')) return 'centre';
  if (f <= t('weapons.zone.vital')) return 'vital';
  if (f <= t('weapons.zone.body')) return 'body';
  if (f <= t('weapons.zone.edge')) return 'edge';
  return 'miss';
}

/** Random shot: angle offset (rad) in the cone, triangular distribution (more shots near the axis). */
export function shotAngle(halfDeg: number, rng: Rng): number {
  const u = (rng.next() + rng.next()) / 2 - 0.5; // -0.5..0.5, peaked
  return u * 2 * ((halfDeg * Math.PI) / 180);
}

/** Lateral wobble of the shell (m), independent of range: point blank is not a sure centre hit. */
export function shotWobble(rng: Rng): number {
  return ((rng.next() + rng.next()) / 2 - 0.5) * 2 * tunables.get<number>('weapons.cone.wobble');
}

/** Damage before RES for a zone. */
export function zoneDamage(zone: HitZone): number {
  const t = (k: string) => tunables.get<number>(k);
  switch (zone) {
    case 'centre':
      return t('weapons.cannon.damage') + t('weapons.cannon.centreBonus');
    case 'vital':
      return t('weapons.cannon.damage') + t('weapons.cannon.vitalBonus');
    case 'body':
      return t('weapons.cannon.damage');
    default:
      return 0;
  }
}
