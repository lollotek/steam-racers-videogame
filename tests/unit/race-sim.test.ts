import { beforeAll, describe, expect, it } from 'vitest';
import { RaceSim, initPhysics } from '../../src/sim/race-sim';
import { createAutopilot, drive } from '../../src/ai/autopilot';
import { HOT_ROD, STEAM_TANK } from '../../src/vehicles/vehicle-physics';
import { emptyFrame, type ActionFrame } from '../../src/input/actions';
import { GEAR_RATIOS } from '../../src/vehicles/gearbox';
import { tunables } from '../../src/core/tunables';
import type { TrackFile } from '../../src/track/track-format';
import foundry from '../../src/tracks/foundry-01.json';

beforeAll(async () => {
  await initPhysics();
});

const file = () => JSON.parse(JSON.stringify(foundry)) as TrackFile;
const idle = (mut: (f: ActionFrame) => void = () => {}) => {
  const f = emptyFrame();
  mut(f);
  return f;
};
const run = (sim: RaceSim, steps: number, cmd: () => (ActionFrame | null)[]) => {
  for (let i = 0; i < steps; i++) sim.step(cmd());
};
const autopilotRace = (sim: RaceSim, pilots: ReturnType<typeof createAutopilot>[]) =>
  sim.racers.map((r, i) => drive(pilots[i]!, sim.track, sim.pose(i), r.vehicle.gearbox, tunables.get('handling.maxSpeed')));

describe('race sim (Rapier, headless)', () => {
  it('holds cars on the grid during the countdown, then drives off in 1st gear', () => {
    const sim = new RaceSim(file(), [{ spec: HOT_ROD, name: 'a' }]);
    run(sim, 60 * 2, () => [idle()]);
    expect(sim.phase).toBe('countdown');
    expect(sim.racers[0]!.vehicle.speed()).toBeLessThan(0.5);
    run(sim, 60 * 4, () => [idle()]);
    expect(sim.phase).toBe('running');
    const v = sim.racers[0]!.vehicle.telemetry.forwardSpeed;
    expect(v).toBeGreaterThan(GEAR_RATIOS[0] * tunables.get('handling.maxSpeed') * 0.8);
    sim.dispose();
  });

  it('steering right turns the car to the right (heading decreases)', () => {
    const sim = new RaceSim(file(), [{ spec: HOT_ROD, name: 'a' }]);
    run(sim, 60 * 4, () => [idle()]);
    const h0 = sim.racers[0]!.vehicle.heading();
    run(sim, 40, () => [idle((f) => (f.steer = 1))]);
    expect(sim.racers[0]!.vehicle.heading()).toBeLessThan(h0 - 0.05);
    sim.dispose();
  });

  it('autopilot: 4 cars finish 2 laps without leaving the track', () => {
    const f = file();
    f.laps = 2;
    const sim = new RaceSim(f, [0, 1, 2, 3].map((i) => ({ spec: i % 2 ? STEAM_TANK : HOT_ROD, name: `ai${i}` })));
    const pilots = sim.racers.map((_, i) => createAutopilot(((i % 3) - 1) * 1.5));
    let reps = 0;
    let off = 0;
    while (sim.phase !== 'finished' && sim.clock < 200) {
      sim.step(autopilotRace(sim, pilots));
      reps += sim.drainEvents().filter((e) => e.type === 'reposition').length;
      off += sim.racers.filter((r) => r.progress.offTrack).length;
    }
    expect(sim.phase).toBe('finished');
    expect(reps).toBeLessThanOrEqual(2);
    expect(off / (sim.steps * 4)).toBeLessThan(0.02);
    for (const r of sim.racers) expect(r.progress.bestLap!).toBeLessThan(45);
    sim.dispose();
  }, 60_000);

  // Driving must never glitch (strategy first): no tumbling, no flying, no spinning like a top,
  // whatever the player does to the barriers and whatever mass the tuning panel sets.
  it.each([
    ['hot rod', HOT_ROD, 1400],
    ['hot rod, heavy', HOT_ROD, 5500],
    ['hot rod, light', HOT_ROD, 400],
    ['tank', STEAM_TANK, 1400],
    ['tank, heavy', STEAM_TANK, 5500],
  ] as const)('stays on its wheels while bouncing between the barriers (%s)', (_name, spec, mass) => {
    tunables.set('handling.mass', mass);
    try {
      const sim = new RaceSim(file(), [{ spec, name: 'a' }]);
      const body = sim.racers[0]!.vehicle.body;
      run(sim, 60 * 3 + 30, () => [idle()]);
      const restY = body.translation().y;
      let maxTilt = 0;
      let maxRise = 0;
      let maxYaw = 0;
      let air = 0;
      for (let n = 0; n < 60 * 40; n++) {
        // Long diagonals into each barrier at speed, then violent zig-zag.
        const period = n < 60 * 20 ? 150 : 45;
        sim.step([
          idle((f) => {
            f.steer = Math.floor(n / period) % 2 ? 1 : -1;
            f.pressed.steamPush = f.held.steamPush = n % 70 === 0;
          }),
        ]);
        const q = body.rotation();
        maxTilt = Math.max(maxTilt, Math.acos(Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z))));
        maxRise = Math.max(maxRise, body.translation().y - restY);
        maxYaw = Math.max(maxYaw, Math.abs(body.angvel().y));
        if (sim.racers[0]!.vehicle.telemetry.wheelsOnGround === 0) air++;
      }
      expect((maxTilt * 180) / Math.PI).toBeLessThan(12);
      expect(maxRise).toBeLessThan(0.25);
      expect(maxYaw).toBeLessThanOrEqual(tunables.get('handling.maxYawRate') + 1e-3);
      expect(air).toBe(0);
      sim.dispose();
    } finally {
      tunables.reset('handling.mass');
    }
  });

  it('follows a live mass change without a respawn', () => {
    const sim = new RaceSim(file(), [{ spec: HOT_ROD, name: 'a' }]);
    try {
      run(sim, 60 * 4, () => [idle()]);
      const y0 = sim.racers[0]!.vehicle.body.translation().y;
      tunables.set('handling.mass', 5000);
      run(sim, 60 * 2, () => [idle()]);
      const v = sim.racers[0]!.vehicle;
      expect(v.body.mass()).toBeCloseTo(5000, 0);
      expect(v.telemetry.forwardSpeed).toBeGreaterThan(GEAR_RATIOS[0] * tunables.get('handling.maxSpeed') * 0.8);
      expect(v.telemetry.forwardSpeed).toBeLessThan(GEAR_RATIOS[0] * tunables.get('handling.maxSpeed') * 1.2);
      expect(Math.abs(v.body.translation().y - y0)).toBeLessThan(0.01);
    } finally {
      tunables.reset('handling.mass');
      sim.dispose();
    }
  });

  it('is deterministic: same inputs → same positions', () => {
    const go = () => {
      const sim = new RaceSim(file(), [
        { spec: HOT_ROD, name: 'a' },
        { spec: STEAM_TANK, name: 'b' },
      ]);
      const pilots = sim.racers.map(() => createAutopilot());
      run(sim, 60 * 15, () => autopilotRace(sim, pilots));
      const out = sim.racers.map((r) => [r.vehicle.curr.x, r.vehicle.curr.z, r.progress.distance]);
      sim.dispose();
      return out;
    };
    expect(go()).toEqual(go());
  }, 30_000);
});
