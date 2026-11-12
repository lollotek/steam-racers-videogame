import { describe, expect, it } from 'vitest';
import { emptyFrame, type ActionFrame } from '../../src/input/actions';
import { GEAR_RATIOS, type VehicleState, createVehicleState, stepVehicle } from '../../src/game/test-vehicle';
import { tunables } from '../../src/core/tunables';

const DT = 1 / 60;
const frame = (mut: (f: ActionFrame) => void = () => {}) => {
  const f = emptyFrame();
  mut(f);
  return f;
};
const runFor = (s: VehicleState, seconds: number, f = frame()) => {
  for (let i = 0; i < seconds * 60; i++) stepVehicle(s, f, DT);
};

describe('M0 gear-based placeholder vehicle', () => {
  it('drives itself to the 1st gear speed without any throttle', () => {
    const s = createVehicleState();
    runFor(s, 10);
    expect(s.speed).toBeCloseTo(tunables.get('vehicle.maxSpeed') * GEAR_RATIOS[0], 3);
  });

  it('steam push shifts up and respects the cooldown', () => {
    const s = createVehicleState();
    const push = frame((f) => {
      f.pressed.steamPush = true;
      f.held.steamPush = true;
    });
    expect(stepVehicle(s, push, DT).gearChanged).toBe(true);
    expect(s.gear).toBe(2);
    expect(stepVehicle(s, push, DT).pushed).toBe(false); // cooldown
    runFor(s, 2);
    stepVehicle(s, push, DT);
    expect(s.gear).toBe(3);
  });

  it('never goes above 6th gear', () => {
    const s = createVehicleState();
    const push = frame((f) => (f.pressed.steamPush = true));
    for (let i = 0; i < 10; i++) {
      stepVehicle(s, push, DT);
      runFor(s, 2);
    }
    expect(s.gear).toBe(6);
  });

  it('tapping gear down shifts down', () => {
    const s = createVehicleState();
    s.gear = 4;
    stepVehicle(s, frame((f) => ((f.pressed.gearDown = true), (f.held.gearDown = true))), DT);
    expect(s.gear).toBe(3);
  });

  it('holding gear down brakes to a stop, then reverses', () => {
    const s = createVehicleState();
    s.gear = 3;
    runFor(s, 6);
    runFor(s, 3, frame((f) => (f.held.gearDown = true)));
    expect(s.speed).toBeLessThan(0);
    expect(s.speed).toBeGreaterThanOrEqual(-tunables.get('vehicle.reverseSpeed'));
  });

  it('steering right turns to the right (heading decreases while moving forward)', () => {
    const s = createVehicleState();
    runFor(s, 3);
    const h0 = s.heading;
    runFor(s, 0.5, frame((f) => (f.steer = 1)));
    expect(s.heading).toBeLessThan(h0);
  });

  it('is deterministic', () => {
    const a = createVehicleState();
    const b = createVehicleState();
    const inputs = Array.from({ length: 600 }, (_, i) =>
      frame((f) => {
        f.steer = Math.sin(i / 30);
        f.pressed.steamPush = i % 120 === 0;
      }),
    );
    for (const f of inputs) stepVehicle(a, f, DT);
    for (const f of inputs) stepVehicle(b, f, DT);
    expect(a).toEqual(b);
  });
});
