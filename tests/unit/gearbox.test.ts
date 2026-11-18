import { describe, expect, it } from 'vitest';
import { emptyFrame, type ActionFrame } from '../../src/input/actions';
import { GEAR_RATIOS, createGearbox, stepGearbox } from '../../src/vehicles/gearbox';
import { tunables } from '../../src/core/tunables';

const DT = 1 / 60;
const frame = (mut: (f: ActionFrame) => void = () => {}) => {
  const f = emptyFrame();
  mut(f);
  return f;
};

describe('gearbox (gameplay.md §5.1)', () => {
  it('boiler stall: gear taps do not shift or push, holding gear down still brakes', () => {
    const g = createGearbox();
    g.gear = 4;
    g.boiler.pv = 5;
    g.boiler.stalled = true;
    expect(stepGearbox(g, frame((f) => (f.pressed.steamPush = true)), DT, 10, 30).pushed).toBe(false);
    stepGearbox(g, frame((f) => (f.pressed.gearDown = true)), DT, 10, 30);
    expect(g.gear).toBe(4);
    expect(g.boiler.pv).toBe(5); // no downshift refund either
    let o = stepGearbox(g, frame(), DT, 10, 30);
    for (let k = 0; k < 30; k++) o = stepGearbox(g, frame((f) => (f.held.gearDown = true)), DT, 10, 30);
    expect(o.braking).toBe(true);
  });

  it('targets the current gear speed without any throttle', () => {
    const g = createGearbox();
    expect(stepGearbox(g, frame(), DT, 0, 30).targetRatio).toBe(GEAR_RATIOS[0]);
  });

  it('steam push shifts up and respects the cooldown; never above 6th', () => {
    const g = createGearbox();
    const push = frame((f) => {
      f.pressed.steamPush = true;
      f.held.steamPush = true;
    });
    expect(stepGearbox(g, push, DT, 0, 30).gearChanged).toBe(true);
    expect(g.gear).toBe(2);
    expect(stepGearbox(g, push, DT, 0, 30).pushed).toBe(false);
    for (let i = 0; i < 20; i++) {
      for (let k = 0; k < 90; k++) stepGearbox(g, frame(), DT, 0, 30);
      g.boiler.pv = 5; // the race rules refill the boiler; here only the gearbox runs
      stepGearbox(g, push, DT, 0, 30);
    }
    expect(g.gear).toBe(6);
  });

  it('boiler: push costs PV, no push without steam or during the calm time', () => {
    const g = createGearbox();
    g.boiler.pv = 1;
    const push = frame((f) => (f.pressed.steamPush = true));
    stepGearbox(g, push, DT, 0, 30);
    expect(g.gear).toBe(2);
    expect(g.boiler.pv).toBe(0);
    g.pushCooldown = 0;
    expect(stepGearbox(g, push, DT, 0, 30).pushed).toBe(false); // no steam
    expect(g.gear).toBe(2);
    g.boiler.pv = 3;
    g.noPush = 1;
    expect(stepGearbox(g, push, DT, 0, 30).pushed).toBe(false); // calm time after GO
  });

  it('downshifting from 4th up gives 1 PV back; red zone pushes are stronger', () => {
    const g = createGearbox();
    g.gear = 4;
    g.boiler.pv = 0;
    stepGearbox(g, frame((f) => (f.pressed.gearDown = true)), DT, 0, 30);
    expect(g.gear).toBe(3);
    expect(g.boiler.pv).toBe(tunables.get('boiler.downshiftRefund'));
    g.boiler.pv = g.boiler.baseCal + 2;
    stepGearbox(g, frame((f) => (f.pressed.steamPush = true)), DT, 0, 30);
    expect(g.pushBoost).toBe(tunables.get('boiler.redPushBonus'));
  });

  it('push gives extra acceleration for its duration only', () => {
    const g = createGearbox();
    const out = stepGearbox(g, frame((f) => (f.pressed.steamPush = true)), DT, 0, 30);
    expect(out.pushing).toBe(true);
    let o = out;
    for (let k = 0; k < 120; k++) o = stepGearbox(g, frame(), DT, 0, 30);
    expect(o.pushing).toBe(false);
  });

  it('tap shifts down; hold brakes while moving, reverses when stopped', () => {
    const g = createGearbox();
    g.gear = 4;
    stepGearbox(
      g,
      frame((f) => {
        f.pressed.gearDown = true;
        f.held.gearDown = true;
      }),
      DT,
      10,
      30,
    );
    expect(g.gear).toBe(3);
    const hold = frame((f) => (f.held.gearDown = true));
    let o = stepGearbox(g, hold, DT, 10, 30);
    for (let k = 0; k < 30; k++) o = stepGearbox(g, hold, DT, 10, 30);
    expect(o.braking).toBe(true);
    o = stepGearbox(g, hold, DT, 0, 30);
    expect(o.reversing).toBe(true);
    expect(o.targetRatio).toBeLessThan(0);
  });

  it('steering is smoothed toward the input', () => {
    const g = createGearbox();
    stepGearbox(g, frame((f) => (f.steer = 1)), DT, 0, 30);
    expect(g.steer).toBeGreaterThan(0);
    expect(g.steer).toBeLessThan(1);
  });
});
