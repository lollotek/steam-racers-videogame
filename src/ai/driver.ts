/**
 * AI racer (doc 03 §8): the autopilot (racing line + gear policy) plus race behaviour with the same
 * rules as the player: start test, boiler management (vent on the reliability test), avoidance of
 * the car ahead, front cannon. Writes an ActionFrame like a player; own RNG stream (deterministic).
 */
import { emptyFrame, type ActionFrame } from '../input/actions';
import { Rng, hashString } from '../core/rng';
import { tunables } from '../core/tunables';
import type { RaceSim } from '../sim/race-sim';
import { createAutopilot, drive, type AutopilotState } from './autopilot';
import { boilerCal } from '../rules/boiler';
import { isLocked } from '../rules/cannon';

tunables.registerGroup('ai', [
  { key: 'ai.skill', type: 'number', default: 0.7, min: 0, max: 1, step: 0.05, label: 'Skill (start, vent timing, aim patience)' },
  { key: 'ai.fireRate', type: 'number', default: 1.2, min: 0, max: 10, step: 0.1, unit: '/s', label: 'Fire willingness when locked' },
  { key: 'ai.avoidDistance', type: 'number', default: 16, min: 0, max: 40, step: 1, unit: 'm', label: 'Avoidance: look ahead' },
  { key: 'ai.avoidGap', type: 'number', default: 3.2, min: 0.5, max: 8, step: 0.1, unit: 'm', label: 'Avoidance: lateral gap' },
  { key: 'ai.ventPressure', type: 'number', default: 0.6, min: 0, max: 1, step: 0.05, label: 'Vents voluntarily above pressure' },
]);

export interface DriverState {
  index: number;
  ap: AutopilotState;
  baseOffset: number;
  rng: Rng;
  /** Start test: needle level this driver aims for (error included). */
  startAim: number;
  /** Needle position at which the driver presses VENT during the current boiler test. */
  ventAt: number | null;
}

export function createDriver(index: number, seed: number, baseOffset: number): DriverState {
  const rng = new Rng(hashString(`${seed}:ai:${index}`));
  return { index, ap: createAutopilot(baseOffset), baseOffset, rng, startAim: 0, ventAt: null };
}

const IDLE = emptyFrame();

export function driveRacer(d: DriverState, sim: RaceSim): ActionFrame {
  const r = sim.racers[d.index]!;
  if (r.vehicle.wrecked) return IDLE;
  const skill = tunables.get<number>('ai.skill');
  const maxSpeed = tunables.get<number>('handling.maxSpeed');
  const g = r.vehicle.gearbox;

  if (sim.phase === 'countdown') {
    const f = d.ap.frame;
    clear(f);
    const st = r.rules.start;
    if (d.startAim === 0) d.startAim = (st.lo + st.hi) / 2 + d.rng.range(-1, 1) * (1 - skill) * 0.4;
    f.held.steamPush = st.needle < d.startAim;
    return f;
  }

  avoid(d, sim);
  const f = drive(d.ap, sim.track, sim.pose(d.index), g, maxSpeed);

  // Boiler: on a reliability test, press VENT near the notch (error shrinks with skill).
  const b = r.rules.boiler;
  if (b.test) {
    d.ventAt ??= b.test.notch + d.rng.range(-1, 1) * b.test.half * (0.3 + 2.2 * (1 - skill));
    if (b.test.needle >= d.ventAt) {
      f.pressed.vent = true;
      d.ventAt = null;
    }
    f.pressed.steamPush = false;
  } else {
    d.ventAt = null;
    if (b.pv > boilerCal(b) && b.pressure > tunables.get<number>('ai.ventPressure') && b.ventCooldown === 0) f.pressed.vent = true;
  }

  // Cannon: fire when locked, with some patience.
  const c = r.rules.cannon;
  if (isLocked(c) && c.ammo > 0 && c.cooldown === 0 && d.rng.next() < tunables.get<number>('ai.fireRate') * (1 / 60)) f.pressed.fireFront = true;
  return f;
}

/** Shift the racing line away from a slower car just ahead, then ease back. */
function avoid(d: DriverState, sim: RaceSim): void {
  const me = sim.racers[d.index]!;
  const look = tunables.get<number>('ai.avoidDistance');
  const gap = tunables.get<number>('ai.avoidGap');
  const lim = sim.track.halfWidth - 2.5;
  let goal = d.baseOffset;
  for (const o of sim.racers) {
    if (o === me) continue;
    const ahead = o.progress.distance - me.progress.distance;
    if (ahead <= 0 || ahead > look) continue;
    const dl = me.progress.lateral - o.progress.lateral;
    if (Math.abs(dl) >= gap) continue;
    // Pass on the side with more room.
    const side = o.progress.lateral > 0 ? -1 : 1;
    goal = Math.max(-lim, Math.min(lim, o.progress.lateral + side * gap * 1.1));
    break;
  }
  const step = 4 / 60;
  d.ap.lineOffset += Math.max(-step, Math.min(step, goal - d.ap.lineOffset));
}

function clear(f: ActionFrame): void {
  for (const k in f.pressed) (f.pressed as Record<string, boolean>)[k] = false;
  for (const k in f.held) (f.held as Record<string, boolean>)[k] = false;
  f.steer = 0;
}
