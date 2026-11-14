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
import { distanceTo, hazardClock, isThreat } from '../track/hazards';
import { isLocked } from '../rules/cannon';

tunables.registerGroup('ai', [
  { key: 'ai.skill', type: 'number', default: 0.7, min: 0, max: 1, step: 0.05, label: 'Skill (start, vent timing, aim patience)' },
  { key: 'ai.fireRate', type: 'number', default: 1.2, min: 0, max: 10, step: 0.1, unit: '/s', label: 'Fire willingness when locked' },
  { key: 'ai.avoidDistance', type: 'number', default: 16, min: 0, max: 40, step: 1, unit: 'm', label: 'Avoidance: look ahead' },
  { key: 'ai.avoidGap', type: 'number', default: 3.2, min: 0.5, max: 8, step: 0.1, unit: 'm', label: 'Avoidance: lateral gap' },
  { key: 'ai.ventPressure', type: 'number', default: 0.6, min: 0, max: 1, step: 0.05, label: 'Vents voluntarily above pressure' },
  { key: 'ai.hazardLook', type: 'number', default: 80, min: 0, max: 200, step: 5, unit: 'm', label: 'Hazards: look ahead' },
  { key: 'ai.catchUpGap', type: 'number', default: 60, min: 0, max: 400, step: 5, unit: 'm', label: 'Catch-up: gap to the car ahead' },
  { key: 'ai.pickupReach', type: 'number', default: 4, min: 0, max: 14, step: 0.5, unit: 'm', label: 'Crates: max detour from the line' },
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
  /** Hazard cycle keys (id × 1000 + cycle) this driver decided to respect / ignore. */
  heeded: number;
  ignored: number;
  /** Own skill (difficulty, doc 04 B4); null = the `ai.skill` tunable. */
  skill: number | null;
  /** Top speed factor at the back of the pack (doc 04 B4); 1 = no catch-up. */
  catchUp: number;
}

export interface DriverOptions {
  skill?: number | null;
  catchUp?: number;
}

export function createDriver(index: number, seed: number, baseOffset: number, o: DriverOptions = {}): DriverState {
  const rng = new Rng(hashString(`${seed}:ai:${index}`));
  return { index, ap: createAutopilot(baseOffset), baseOffset, rng, startAim: 0, ventAt: null, heeded: -1, ignored: -1, skill: o.skill ?? null, catchUp: o.catchUp ?? 1 };
}

const skillOf = (d: DriverState) => d.skill ?? tunables.get<number>('ai.skill');

/**
 * Light catch-up (doc 04 B4): only an AI in the back half of the order, more than
 * `ai.catchUpGap` metres behind the car ahead of it, gets a small top speed factor.
 */
function catchUpFor(d: DriverState, sim: RaceSim): number {
  if (d.catchUp <= 1 || sim.phase !== 'running') return 1;
  const order = sim.standings();
  const pos = order.indexOf(d.index);
  if (pos < Math.ceil(order.length / 2) || pos <= 0) return 1;
  const me = sim.racers[d.index]!.progress.distance;
  const ahead = sim.racers[order[pos - 1]!]!;
  if (ahead.vehicle.wrecked && !ahead.finished) return 1;
  return ahead.progress.distance - me > tunables.get<number>('ai.catchUpGap') ? d.catchUp : 1;
}

const IDLE = emptyFrame();

export function driveRacer(d: DriverState, sim: RaceSim): ActionFrame {
  const r = sim.racers[d.index]!;
  if (r.vehicle.wrecked) return IDLE;
  const skill = skillOf(d);
  r.vehicle.catchUp = catchUpFor(d, sim);
  const maxSpeed = r.vehicle.maxSpeed();
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

/**
 * Lateral goal and gear cap from the track features ahead (doc 04 A3/A4): steer around a hazard
 * that covers part of the road, wait for one that covers all of it, follow sap streams, pick up
 * crates near the line. Reaction to hazards depends on `ai.skill` (some drivers just go for it).
 */
function featureGoal(d: DriverState, sim: RaceSim, base: number): number {
  const me = sim.racers[d.index]!;
  const track = sim.track;
  const lim = track.halfWidth - 2.5;
  const speed = Math.max(6, Math.abs(me.vehicle.telemetry.forwardSpeed));
  const skill = skillOf(d);
  let goal = base;
  for (const h of track.hazards) {
    const dist = distanceTo(h, me.progress.s, track.length);
    if (dist > tunables.get<number>('ai.hazardLook')) continue;
    const reward = !!(h.effects.active?.steamRate || h.effects.active?.steam) && !isThreat(h.effects.active);
    if (reward) {
      if (me.rules.boiler.pv < boilerCal(me.rules.boiler)) goal = Math.max(-lim, Math.min(lim, h.latC));
      continue;
    }
    // Is any threat phase on while I would be inside the zone?
    const t0 = sim.clock + dist / speed;
    const t1 = t0 + (h.s1 - h.s0 + 8) / speed;
    let threat = false;
    for (let t = t0; t <= t1 && !threat; t += 0.2) threat = isThreat(h.effects[hazardClock(h, t).phase]);
    if (!threat) continue;
    // Skill check, once per hazard cycle: a careless driver ignores it.
    const cycle = Math.floor((sim.clock + h.phase) / h.period);
    const key = h.id * 1000 + cycle;
    if (d.ignored !== key && d.heeded !== key) {
      if (d.rng.next() < 0.25 + 0.75 * skill) d.heeded = key;
      else d.ignored = key;
    }
    if (d.ignored === key) continue;
    const full = h.lat0 <= -track.halfWidth + 1.5 && h.lat1 >= track.halfWidth - 1.5;
    if (!full) {
      // Steer to the free side with more room.
      const leftRoom = h.lat0 + track.halfWidth;
      const rightRoom = track.halfWidth - h.lat1;
      goal = rightRoom > leftRoom ? Math.min(lim, (h.lat1 + track.halfWidth) / 2) : Math.max(-lim, (h.lat0 - track.halfWidth) / 2);
    } else if (dist > 6) d.ap.gearCap = Math.min(d.ap.gearCap, 1);
  }
  // Crates near the line: coal when the boiler has room, money always.
  let best = Infinity;
  track.pickups.forEach((p, i) => {
    if (!sim.features.pickups[i]!.active) return;
    if (p.kind === 'coal' && me.rules.boiler.pv >= boilerCal(me.rules.boiler)) return;
    const ahead = (((p.s - me.progress.s) % track.length) + track.length) % track.length;
    if (ahead < 8 || ahead > 60 || ahead > best) return;
    if (Math.abs(p.lateral - goal) > tunables.get<number>('ai.pickupReach')) return;
    best = ahead;
    goal = Math.max(-lim, Math.min(lim, p.lateral));
  });
  return goal;
}

/** Shift the racing line away from a slower car just ahead, then ease back. */
function avoid(d: DriverState, sim: RaceSim): void {
  const me = sim.racers[d.index]!;
  const look = tunables.get<number>('ai.avoidDistance');
  const gap = tunables.get<number>('ai.avoidGap');
  const lim = sim.track.halfWidth - 2.5;
  d.ap.gearCap = 6;
  const goal0 = featureGoal(d, sim, d.baseOffset);
  // Everything slower just ahead on this lap position (a lapped wreck is still in the way): pick
  // the lateral line with the most clearance, close to the wanted one. Several obstacles side by
  // side (two wrecks at a level crossing) leave the gap between them, or the edge.
  const L = sim.track.length;
  const mySpeed = me.vehicle.telemetry.forwardSpeed;
  const obstacles: { lat: number; w: number }[] = [];
  for (const o of sim.racers) {
    if (o === me) continue;
    const ahead = (((o.progress.s - me.progress.s) % L) + L) % L;
    if (ahead <= 0 || ahead > look) continue;
    if (!o.vehicle.wrecked && o.vehicle.telemetry.forwardSpeed > mySpeed + 1) continue;
    obstacles.push({ lat: o.progress.lateral, w: 1 - 0.5 * (ahead / look) });
  }
  let goal = goal0;
  if (obstacles.some((o) => Math.abs(o.lat - me.progress.lateral) < gap || Math.abs(o.lat - goal0) < gap)) {
    let best = Infinity;
    for (let c = -lim; c <= lim + 1e-6; c += 0.5) {
      let cost = Math.abs(c - goal0) * 0.3 + Math.abs(c - me.progress.lateral) * 0.15;
      for (const o of obstacles) cost += Math.max(0, gap * 1.1 - Math.abs(c - o.lat)) * 10 * o.w;
      if (cost < best) {
        best = cost;
        goal = c;
      }
    }
  }
  const step = 4 / 60;
  d.ap.lineOffset += Math.max(-step, Math.min(step, goal - d.ap.lineOffset));
}

function clear(f: ActionFrame): void {
  for (const k in f.pressed) (f.pressed as Record<string, boolean>)[k] = false;
  for (const k in f.held) (f.held as Record<string, boolean>)[k] = false;
  f.steer = 0;
}
