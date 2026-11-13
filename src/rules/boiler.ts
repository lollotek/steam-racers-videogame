/**
 * Boiler and steam points (gameplay.md §5.2), pure and deterministic.
 *
 *   PV come from ignition, passive generation (slower above CAL), downshifts from 4th up.
 *   PV go to steam pushes (gear changes) and, later, weapons and cards.
 *   Above CAL the boiler builds pressure (slower with AFF); a full gauge, or PV at 2 × CAL, starts
 *   the reliability test: a needle sweeps the gauge and VENT must be pressed on the green notch.
 *
 *   | situation | notch hit                       | notch missed                                         |
 *   | red zone  | pressure contained              | emergency valves: PV 0, −3 gears, 1 PF               |
 *   | 2 × CAL   | valves give: PV 0, hard brake, 2 PF | explosion: stall, CAL −2, no regen, 1st, ½ PF lost |
 *
 * Outside the test VENT dumps steam: one PV and some pressure, leaving a cloud behind.
 */
import { tunables } from '../core/tunables';
import type { Rng } from '../core/rng';

tunables.registerGroup('boiler', [
  { key: 'boiler.startPv', type: 'number', default: 2, min: 0, max: 20, step: 1, unit: 'PV', label: 'Ignition PV on the grid' },
  { key: 'boiler.regenTime', type: 'number', default: 1.5, min: 0.1, max: 10, step: 0.1, unit: 's/PV', label: 'Passive generation (below CAL)' },
  { key: 'boiler.redRegenFactor', type: 'number', default: 0.3, min: 0, max: 1, step: 0.05, label: 'Passive generation above CAL (×)' },
  { key: 'boiler.pushCost', type: 'number', default: 1, min: 0, max: 5, step: 1, unit: 'PV', label: 'Push cost' },
  { key: 'boiler.downshiftRefund', type: 'number', default: 1, min: 0, max: 3, step: 1, unit: 'PV', label: 'Downshift from 4th+: PV back' },
  { key: 'boiler.redPushBonus', type: 'number', default: 1.4, min: 1, max: 3, step: 0.05, label: 'Push strength in the red zone (×)' },
  { key: 'boiler.pressureTime', type: 'number', default: 6, min: 0.5, max: 30, step: 0.5, unit: 's', label: 'Red zone: time to full pressure (1 PV over, AFF 0)' },
  { key: 'boiler.affPressure', type: 'number', default: 0.15, min: 0, max: 0.5, step: 0.01, label: 'Pressure slowdown per AFF' },
  { key: 'boiler.testTime', type: 'number', default: 1.4, min: 0.3, max: 5, step: 0.05, unit: 's', label: 'Reliability test: needle sweep' },
  { key: 'boiler.notchWidth', type: 'number', default: 0.16, min: 0.02, max: 0.6, step: 0.01, label: 'Reliability test: notch width' },
  { key: 'boiler.affNotch', type: 'number', default: 0.025, min: 0, max: 0.2, step: 0.005, label: 'Notch width per AFF' },
  { key: 'boiler.ventPressure', type: 'number', default: 0.35, min: 0, max: 1, step: 0.05, label: 'Vent: pressure released' },
  { key: 'boiler.ventCloud', type: 'number', default: 2.5, min: 0, max: 10, step: 0.1, unit: 's', label: 'Vent cloud lifetime' },
  { key: 'boiler.ventCooldown', type: 'number', default: 0.4, min: 0, max: 3, step: 0.05, unit: 's', label: 'Vent cooldown' },
  { key: 'boiler.emergencyGears', type: 'number', default: 3, min: 0, max: 5, step: 1, label: 'Emergency valves: gears lost' },
  { key: 'boiler.emergencyDamage', type: 'number', default: 1, min: 0, max: 10, step: 1, unit: 'PF', label: 'Emergency valves: damage' },
  { key: 'boiler.burstDamage', type: 'number', default: 2, min: 0, max: 10, step: 1, unit: 'PF', label: 'Valves give (2×CAL): damage' },
  { key: 'boiler.explosionStall', type: 'number', default: 2.5, min: 0, max: 10, step: 0.1, unit: 's', label: 'Explosion: STALL time' },
  { key: 'boiler.explosionCal', type: 'number', default: 2, min: 0, max: 5, step: 1, unit: 'PV', label: 'Explosion: CAL lost' },
  { key: 'boiler.explosionNoRegen', type: 'number', default: 8, min: 0, max: 60, step: 1, unit: 's', label: 'Explosion: no passive generation' },
  { key: 'boiler.shockRadius', type: 'number', default: 9, min: 0, max: 30, step: 0.5, unit: 'm', label: 'Explosion: shock wave radius' },
  { key: 'boiler.shockImpulse', type: 'number', default: 9, min: 0, max: 40, step: 0.5, unit: 'm/s', label: 'Explosion: shock wave push' },
]);

export type BoilerTestKind = 'red' | 'burst';

export interface BoilerTest {
  kind: BoilerTestKind;
  /** Needle position 0..1. */
  needle: number;
  /** Green notch centre and half width (0..1). */
  notch: number;
  half: number;
}

export type BoilerOutcome = 'contained' | 'emergency' | 'valves' | 'explosion';

export interface BoilerState {
  pv: number;
  /** 0..1 progress of the next passive PV. */
  regen: number;
  /** Red zone pressure, 0..1 (1 starts the test). */
  pressure: number;
  /** Base capacity and penalties (explosion) for this race. */
  baseCal: number;
  calLoss: number;
  aff: number;
  test: BoilerTest | null;
  /** Seconds without passive generation (after an explosion). */
  noRegen: number;
  ventCooldown: number;
}

export function createBoiler(cal: number, aff: number): BoilerState {
  return { pv: tunables.get<number>('boiler.startPv'), regen: 0, pressure: 0, baseCal: cal, calLoss: 0, aff, test: null, noRegen: 0, ventCooldown: 0 };
}

export function boilerCal(b: BoilerState): number {
  return Math.max(1, b.baseCal - b.calLoss);
}

export function inRedZone(b: BoilerState): boolean {
  return b.pv > boilerCal(b);
}

export function canSpend(b: BoilerState, pv: number): boolean {
  return b.test === null && b.pv >= pv;
}

export function addPv(b: BoilerState, pv: number): void {
  b.pv = Math.min(boilerCal(b) * 2, b.pv + pv);
}

export interface BoilerStepResult {
  /** Set on the step a reliability test resolves. */
  outcome: BoilerOutcome | null;
  /** A test started this step. */
  testStarted: BoilerTestKind | null;
  /** VENT dumped steam outside a test (leave a cloud). */
  vented: boolean;
}

/**
 * One fixed step of the boiler.
 * @param vent VENT pressed this step (edge)
 * @param rng gameplay stream (notch position)
 */
export function stepBoiler(b: BoilerState, dt: number, vent: boolean, rng: Rng): BoilerStepResult {
  const t = (k: string) => tunables.get<number>(k);
  const res: BoilerStepResult = { outcome: null, testStarted: null, vented: false };
  const cal = boilerCal(b);
  b.ventCooldown = Math.max(0, b.ventCooldown - dt);
  b.noRegen = Math.max(0, b.noRegen - dt);

  if (b.test) {
    const test = b.test;
    test.needle += dt / t('boiler.testTime');
    const onNotch = Math.abs(test.needle - test.notch) <= test.half;
    if (vent || test.needle >= 1) {
      res.outcome = resolveTest(b, test.kind, vent && onNotch);
      b.test = null;
      b.ventCooldown = t('boiler.ventCooldown');
    }
    return res;
  }

  // Passive generation, always (slower above CAL, none after an explosion).
  if (b.noRegen === 0 && b.pv < cal * 2) {
    const rate = (b.pv >= cal ? t('boiler.redRegenFactor') : 1) / t('boiler.regenTime');
    b.regen += dt * rate;
    while (b.regen >= 1) {
      b.regen -= 1;
      addPv(b, 1);
    }
  } else {
    b.regen = 0;
  }

  if (vent && b.ventCooldown === 0 && b.pv > 0) {
    b.pv = Math.max(0, b.pv - 1);
    b.pressure = Math.max(0, b.pressure - t('boiler.ventPressure'));
    b.ventCooldown = t('boiler.ventCooldown');
    res.vented = true;
  }

  // Red zone: pressure builds with the PV above CAL, slower with AFF.
  if (b.pv > cal) {
    const over = b.pv - cal;
    const slow = 1 + b.aff * t('boiler.affPressure');
    b.pressure = Math.min(1, b.pressure + (dt * over) / (t('boiler.pressureTime') * slow));
  } else {
    b.pressure = Math.max(0, b.pressure - dt * 0.5);
  }

  const burst = b.pv >= cal * 2;
  if (burst || b.pressure >= 1) {
    const half = (t('boiler.notchWidth') + b.aff * t('boiler.affNotch')) / 2;
    // Notch somewhere in the second half of the sweep: there is always time to react.
    b.test = { kind: burst ? 'burst' : 'red', needle: 0, notch: rng.range(0.45 + half, 0.95 - half), half };
    res.testStarted = b.test.kind;
  }
  return res;
}

/** Apply the outcome table; the caller applies gears, damage, stall and the shock wave. */
function resolveTest(b: BoilerState, kind: BoilerTestKind, hit: boolean): BoilerOutcome {
  b.pressure = 0;
  b.regen = 0;
  if (kind === 'red') {
    if (hit) return 'contained';
    b.pv = 0;
    return 'emergency';
  }
  b.pv = 0;
  if (hit) return 'valves';
  b.calLoss += tunables.get<number>('boiler.explosionCal');
  b.noRegen = tunables.get<number>('boiler.explosionNoRegen');
  return 'explosion';
}
