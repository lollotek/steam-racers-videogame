/**
 * Autopilot (doc 03 §8, first version): pure-pursuit steering on the centre line and a gear policy
 * from the curvature ahead. Produces the same ActionFrame a player would, so AI and players share
 * the vehicle rules. Used by the headless runner and as the base for M3 AI drivers.
 */
import { type ActionFrame, emptyFrame } from '../input/actions';
import { sampleAt, type CompiledTrack } from '../track/compile';
import { GEAR_RATIOS, type GearboxState, canPush } from '../vehicles/gearbox';
import { tunables } from '../core/tunables';
import { gearForRadius } from '../track/corners';

tunables.registerGroup('ai', [
  { key: 'ai.lookAhead', type: 'number', default: 7, min: 2, max: 30, step: 0.5, unit: 'm', label: 'Look-ahead base' },
  { key: 'ai.lookAheadPerSpeed', type: 'number', default: 0.45, min: 0, max: 2, step: 0.05, unit: 's', label: 'Look-ahead per m/s' },
  { key: 'ai.steerGain', type: 'number', default: 2.2, min: 0.2, max: 8, step: 0.1, label: 'Steer gain' },
  { key: 'ai.lateralAccel', type: 'number', default: 14, min: 2, max: 30, step: 0.5, unit: 'm/s²', label: 'Cornering accel limit' },
  { key: 'ai.jumpSpeedMax', type: 'number', default: 1.45, min: 1, max: 3, step: 0.05, label: 'Jumps: max approach speed (× needed)' },
  { key: 'ai.brakeLookAhead', type: 'number', default: 45, min: 5, max: 120, step: 1, unit: 'm', label: 'Corner scan distance' },
]);

export interface AutopilotState {
  frame: ActionFrame;
  /** Lateral offset of the racing line (m, + = right); M3 AI varies it. */
  lineOffset: number;
  /** Highest gear allowed this step (hazard ahead: wait for it, doc 04 A4). */
  gearCap: number;
}

export function createAutopilot(lineOffset = 0): AutopilotState {
  return { frame: emptyFrame(), lineOffset, gearCap: 6 };
}

/** Lowest gear whose speed reaches `v`. */
function gearFor(v: number, maxSpeed: number): number {
  for (let g = 1; g <= GEAR_RATIOS.length; g++) if (GEAR_RATIOS[g - 1]! * maxSpeed >= v) return g;
  return GEAR_RATIOS.length;
}

export interface Pose {
  x: number;
  z: number;
  heading: number;
  forwardSpeed: number;
  /** Progress distance along the lap (s). */
  s: number;
}

export function drive(ap: AutopilotState, track: CompiledTrack, pose: Pose, gb: GearboxState, maxSpeed: number): ActionFrame {
  const t = (k: string) => tunables.get(k);
  const f = ap.frame;
  for (const k in f.pressed) (f.pressed as Record<string, boolean>)[k] = false;
  for (const k in f.held) (f.held as Record<string, boolean>)[k] = false;

  // Steering: aim at a point ahead on the (offset) line.
  const look = t('ai.lookAhead') + Math.max(0, pose.forwardSpeed) * t('ai.lookAheadPerSpeed');
  const target = sampleAt(track, pose.s + look);
  const tx = target.x + -target.tz * ap.lineOffset;
  const tz = target.z + target.tx * ap.lineOffset;
  const desired = Math.atan2(tx - pose.x, tz - pose.z);
  let err = desired - pose.heading;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  // Heading decreases when steering right (+): steer = -err.
  f.steer = Math.max(-1, Math.min(1, -err * t('ai.steerGain')));

  // Gear policy: highest gear whose speed is safe for the tightest curve ahead.
  let maxK = 0;
  const scan = t('ai.brakeLookAhead');
  for (let d = 0; d <= scan; d += 4) maxK = Math.max(maxK, Math.abs(sampleAt(track, pose.s + d).curvature));
  const safe = maxK > 0 ? Math.sqrt(t('ai.lateralAccel') / maxK) : Infinity;
  let wanted = maxK > 0 ? gearForRadius(1 / maxK, maxSpeed, t('ai.lateralAccel')) : GEAR_RATIOS.length;
  // Jumps (doc 04 A5): carry enough speed over the lip, no braking on the approach or in the air.
  // Not much more than needed either: a long flight overshoots the landing into the next piece.
  let jumping = false;
  let tooFast = false;
  for (const j of track.jumps) {
    const ahead = (((j.s0 - pose.s) % track.length) + track.length) % track.length;
    const inside = (((pose.s - j.s0) % track.length) + track.length) % track.length < j.gap1 - j.s0 + 4;
    if (ahead < 70 || inside) {
      wanted = Math.max(gearFor(j.minSpeed, maxSpeed), Math.min(wanted, gearFor(j.minSpeed * tunables.get<number>('ai.jumpSpeedMax'), maxSpeed)));
      jumping = true;
      if (!inside && ahead > 15 && pose.forwardSpeed > j.minSpeed * tunables.get<number>('ai.jumpSpeedMax') * 1.15) tooFast = true;
    }
  }
  if (!jumping) wanted = Math.min(wanted, ap.gearCap);
  if (gb.gear < wanted && canPush(gb)) {
    f.pressed.steamPush = true;
    f.held.steamPush = true;
  } else if (gb.gear > wanted) {
    f.pressed.gearDown = true;
  }
  // Brake hard if far above the safe speed (e.g. after a push into a corner).
  if (tooFast) f.held.gearDown = true;
  if (!jumping && (pose.forwardSpeed > safe * 1.25 || pose.forwardSpeed > GEAR_RATIOS[Math.max(0, ap.gearCap - 1)]! * maxSpeed * 1.3)) f.held.gearDown = true;
  return f;
}
