/**
 * Gear-based drive logic (gameplay.md §5.1), pure and deterministic.
 * No throttle: the vehicle drives itself towards the speed of the current gear.
 *   steam push  → short extra acceleration + one gear up, paid with PV (placeholder boiler below, real one in M3)
 *   gear down   → tap: one gear down; hold: brake, then reverse when stopped
 */
import type { ActionFrame } from '../input/actions';
import { tunables } from '../core/tunables';

export const GEAR_RATIOS = [0.2, 0.35, 0.5, 0.65, 0.82, 1.0] as const;
export const MAX_GEAR = GEAR_RATIOS.length;

tunables.registerGroup('gearbox', [
  { key: 'gearbox.holdToBrake', type: 'number', default: 0.25, min: 0.05, max: 1, step: 0.05, unit: 's', label: 'Hold time → brake' },
  { key: 'gearbox.pushDuration', type: 'number', default: 0.8, min: 0.1, max: 3, step: 0.05, unit: 's', label: 'Steam push duration' },
  { key: 'gearbox.pushCooldown', type: 'number', default: 1.0, min: 0, max: 5, step: 0.05, unit: 's', label: 'Steam push cooldown' },
  { key: 'gearbox.steerResponse', type: 'number', default: 8, min: 1, max: 40, step: 0.5, unit: '1/s', label: 'Steer response' },
]);

/**
 * TEMPORARY placeholder boiler (gameplay.md §5.2), replaced by the real rules layer in M3:
 * PV regenerate passively up to CAL, each steam push costs PV, no push without steam.
 * No red zone, pressure or reliability test yet (PV above CAL only via the debug panel).
 */
tunables.registerGroup('boiler', [
  { key: 'boiler.cal', type: 'number', default: 5, min: 1, max: 10, step: 1, unit: 'PV', label: 'CAL (placeholder)' },
  { key: 'boiler.startPv', type: 'number', default: 3, min: 0, max: 20, step: 1, unit: 'PV', label: 'Start PV (placeholder)' },
  { key: 'boiler.regenTime', type: 'number', default: 1.5, min: 0.1, max: 10, step: 0.1, unit: 's/PV', label: 'Passive regen (placeholder)' },
  { key: 'boiler.pushCost', type: 'number', default: 1, min: 0, max: 5, step: 1, unit: 'PV', label: 'Push cost (placeholder)' },
]);

export interface GearboxState {
  /** 1..6 */
  gear: number;
  /** Smoothed steering, -1..1 (+ = right). */
  steer: number;
  pushTimer: number;
  pushCooldown: number;
  gearDownHeld: number;
  /** Placeholder boiler (M3 replaces it): steam points and progress (0..1) of the next passive PV. */
  pv: number;
  pvRegen: number;
}

export interface GearboxOutput {
  /** Fraction of the vehicle max speed the engine aims for (negative = reverse). */
  targetRatio: number;
  braking: boolean;
  reversing: boolean;
  pushing: boolean;
  gearChanged: boolean;
  pushed: boolean;
}

export function createGearbox(): GearboxState {
  return { gear: 1, steer: 0, pushTimer: 0, pushCooldown: 0, gearDownHeld: 0, pv: tunables.get<number>('boiler.startPv'), pvRegen: 0 };
}

/** True when a steam push would fire now (no cooldown, enough PV). */
export function canPush(g: GearboxState): boolean {
  return g.pushCooldown === 0 && g.pv >= tunables.get<number>('boiler.pushCost');
}

/**
 * @param forwardSpeed current speed along the vehicle forward axis (m/s)
 * @param maxSpeed vehicle top speed in 6th gear (m/s)
 * @param reverseRatio reverse speed as a fraction of maxSpeed
 */
export function stepGearbox(
  g: GearboxState,
  input: ActionFrame,
  dt: number,
  forwardSpeed: number,
  maxSpeed: number,
  reverseRatio = 0.18,
): GearboxOutput {
  const t = (k: string) => tunables.get(k);
  const out: GearboxOutput = { targetRatio: 0, braking: false, reversing: false, pushing: false, gearChanged: false, pushed: false };

  // Placeholder boiler: passive regen up to CAL.
  const cal = t('boiler.cal');
  if (g.pv < cal) {
    g.pvRegen += dt / t('boiler.regenTime');
    while (g.pvRegen >= 1 && g.pv < cal) {
      g.pvRegen -= 1;
      g.pv++;
    }
    if (g.pv >= cal) g.pvRegen = 0;
  } else {
    g.pvRegen = 0;
  }

  g.pushCooldown = Math.max(0, g.pushCooldown - dt);
  g.pushTimer = Math.max(0, g.pushTimer - dt);
  if (input.pressed.steamPush && canPush(g)) {
    g.pv -= t('boiler.pushCost');
    g.pushTimer = t('gearbox.pushDuration');
    g.pushCooldown = t('gearbox.pushCooldown');
    out.pushed = true;
    if (g.gear < MAX_GEAR) {
      g.gear++;
      out.gearChanged = true;
    }
  }
  if (input.pressed.gearDown && g.gear > 1) {
    g.gear--;
    out.gearChanged = true;
  }
  g.gearDownHeld = input.held.gearDown ? g.gearDownHeld + dt : 0;
  const holding = g.gearDownHeld >= t('gearbox.holdToBrake');

  if (holding) {
    if (forwardSpeed > 0.5) {
      out.braking = true;
      out.targetRatio = 0;
    } else {
      out.reversing = true;
      out.targetRatio = -reverseRatio;
    }
  } else {
    out.targetRatio = GEAR_RATIOS[g.gear - 1] ?? 1;
  }
  out.pushing = g.pushTimer > 0 && !holding;

  const resp = t('gearbox.steerResponse') * dt;
  g.steer += Math.max(-resp, Math.min(resp, input.steer - g.steer));
  void maxSpeed;
  return out;
}
