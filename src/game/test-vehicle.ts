/**
 * M0 placeholder vehicle: kinematic, gear-based (gameplay.md §5.1), no physics.
 * Exists to validate the loop, input and camera on every device; replaced by the
 * Rapier vehicle in M2. Pure logic (no Three.js), unit tested.
 */
import type { ActionFrame } from '../input/actions';
import { tunables } from '../core/tunables';

export const GEAR_RATIOS = [0.2, 0.35, 0.5, 0.65, 0.82, 1.0] as const;
export const MAX_GEAR = GEAR_RATIOS.length;

tunables.registerGroup('vehicle', [
  { key: 'vehicle.maxSpeed', type: 'number', default: 34, min: 5, max: 80, step: 0.5, unit: 'm/s', label: 'Max speed (6th)' },
  { key: 'vehicle.accel', type: 'number', default: 9, min: 1, max: 40, step: 0.5, unit: 'm/s²', label: 'Acceleration' },
  { key: 'vehicle.engineBrake', type: 'number', default: 6, min: 0, max: 40, step: 0.5, unit: 'm/s²', label: 'Gear-down slow-down' },
  { key: 'vehicle.brake', type: 'number', default: 22, min: 1, max: 60, step: 0.5, unit: 'm/s²', label: 'Brake (hold)' },
  { key: 'vehicle.reverseSpeed', type: 'number', default: 6, min: 0, max: 20, step: 0.5, unit: 'm/s', label: 'Reverse speed' },
  { key: 'vehicle.holdToBrake', type: 'number', default: 0.25, min: 0.05, max: 1, step: 0.05, unit: 's', label: 'Hold time → brake' },
  { key: 'vehicle.pushAccel', type: 'number', default: 10, min: 0, max: 40, step: 0.5, unit: 'm/s²', label: 'Steam push accel' },
  { key: 'vehicle.pushDuration', type: 'number', default: 0.8, min: 0.1, max: 3, step: 0.05, unit: 's', label: 'Steam push duration' },
  { key: 'vehicle.pushCooldown', type: 'number', default: 1.0, min: 0, max: 5, step: 0.05, unit: 's', label: 'Steam push cooldown' },
  { key: 'vehicle.steerRateLow', type: 'number', default: 2.4, min: 0.2, max: 6, step: 0.05, unit: 'rad/s', label: 'Steer rate (slow)' },
  { key: 'vehicle.steerRateHigh', type: 'number', default: 1.1, min: 0.1, max: 6, step: 0.05, unit: 'rad/s', label: 'Steer rate (fast)' },
  { key: 'vehicle.steerResponse', type: 'number', default: 10, min: 1, max: 40, step: 0.5, unit: '1/s', label: 'Steer response' },
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

export interface VehicleState {
  x: number;
  z: number;
  /** Radians; 0 = facing +Z. */
  heading: number;
  /** m/s along heading, negative = reverse. */
  speed: number;
  /** 1..6 */
  gear: number;
  steer: number;
  pushTimer: number;
  pushCooldown: number;
  gearDownHeld: number;
  /** Placeholder boiler (M3 replaces it): steam points and progress (0..1) of the next passive PV. */
  pv: number;
  pvRegen: number;
}

export function createVehicleState(x = 0, z = 0, heading = 0): VehicleState {
  const pv = tunables.get<number>('boiler.startPv');
  return { x, z, heading, speed: 0, gear: 1, steer: 0, pushTimer: 0, pushCooldown: 0, gearDownHeld: 0, pv, pvRegen: 0 };
}

/** True when a steam push would fire now (no cooldown, enough PV). */
export function canPush(s: VehicleState): boolean {
  return s.pushCooldown === 0 && s.pv >= tunables.get<number>('boiler.pushCost');
}

export interface StepResult {
  gearChanged: boolean;
  pushed: boolean;
}

const t = (k: string) => tunables.get(k);

export function stepVehicle(s: VehicleState, input: ActionFrame, dt: number, arenaRadius = Infinity): StepResult {
  const res: StepResult = { gearChanged: false, pushed: false };
  const maxSpeed = t('vehicle.maxSpeed');

  // Placeholder boiler: passive regen up to CAL (M3 replaces it).
  const cal = t('boiler.cal');
  if (s.pv < cal) {
    s.pvRegen += dt / t('boiler.regenTime');
    while (s.pvRegen >= 1 && s.pv < cal) {
      s.pvRegen -= 1;
      s.pv++;
    }
    if (s.pv >= cal) s.pvRegen = 0;
  } else {
    s.pvRegen = 0;
  }

  // Steam push: extra acceleration + one gear up, paid with PV (gameplay.md §5.1).
  s.pushCooldown = Math.max(0, s.pushCooldown - dt);
  s.pushTimer = Math.max(0, s.pushTimer - dt);
  if (input.pressed.steamPush && canPush(s)) {
    s.pv -= t('boiler.pushCost');
    s.pushTimer = t('vehicle.pushDuration');
    s.pushCooldown = t('vehicle.pushCooldown');
    res.pushed = true;
    if (s.gear < MAX_GEAR) {
      s.gear++;
      res.gearChanged = true;
    }
  }

  // Gear down: tap = one gear down; hold = brake, then reverse when stopped.
  if (input.pressed.gearDown && s.gear > 1) {
    s.gear--;
    res.gearChanged = true;
  }
  s.gearDownHeld = input.held.gearDown ? s.gearDownHeld + dt : 0;
  const braking = s.gearDownHeld >= t('vehicle.holdToBrake');

  const ratio = GEAR_RATIOS[s.gear - 1] ?? 1;
  let target = maxSpeed * ratio;
  if (braking) target = s.speed > 0.5 ? 0 : -t('vehicle.reverseSpeed');

  const accel = braking ? t('vehicle.brake') : s.speed > target ? t('vehicle.engineBrake') : t('vehicle.accel');
  s.speed = approach(s.speed, target, accel * dt);
  if (s.pushTimer > 0 && !braking) s.speed = Math.min(s.speed + t('vehicle.pushAccel') * dt, maxSpeed * 1.15);

  // Steering: smoothed input, rate fades with speed, needs motion to turn.
  s.steer = approach(s.steer, input.steer, t('vehicle.steerResponse') * dt);
  const speedFrac = Math.min(1, Math.abs(s.speed) / maxSpeed);
  const rate = lerp(t('vehicle.steerRateLow'), t('vehicle.steerRateHigh'), speedFrac);
  const motion = Math.min(1, Math.abs(s.speed) / 3) * Math.sign(s.speed);
  s.heading -= s.steer * rate * motion * dt;

  s.x += Math.sin(s.heading) * s.speed * dt;
  s.z += Math.cos(s.heading) * s.speed * dt;

  const r = Math.hypot(s.x, s.z);
  if (r > arenaRadius) {
    s.x *= arenaRadius / r;
    s.z *= arenaRadius / r;
    s.speed *= 0.3;
  }
  return res;
}

const approach = (v: number, target: number, delta: number) =>
  v < target ? Math.min(target, v + delta) : Math.max(target, v - delta);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
