import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RaceSim, initPhysics, type ImpactInfo } from '../../src/sim/race-sim';
import { HOT_ROD, STEAM_TANK } from '../../src/vehicles/vehicle-physics';
import { emptyFrame, type ActionFrame } from '../../src/input/actions';
import { BARRICADES, barricadeParams, classifyImpact, speedAfterHit } from '../../src/race/barricades';
import { tunables } from '../../src/core/tunables';
import type { Barricade, TrackFile } from '../../src/track/track-format';
import foundry from '../../src/tracks/foundry-01.json';

// Edge handling only (M2): no start stall, no calm time after GO, hulls that never wreck.
const M2_ONLY = { 'start.stall': 0, 'start.calmTime': 0, 'stats.hotrod.pf': 60, 'stats.tank.pf': 60 };
beforeAll(() => {
  tunables.applyPreset(M2_ONLY);
});
afterAll(() => {
  for (const k of Object.keys(M2_ONLY)) tunables.reset(k);
});

beforeAll(async () => {
  await initPhysics();
});

/** Same layout, one barricade type everywhere. */
const trackWith = (b: Barricade): TrackFile => {
  const f = JSON.parse(JSON.stringify(foundry)) as TrackFile;
  f.defaultBarricade = b;
  for (const p of f.pieces) {
    delete p.left;
    delete p.right;
  }
  return f;
};

interface Run {
  sim: RaceSim;
  impacts: ImpactInfo[];
  repositions: number;
  /** Longest time (s) spent almost stopped while the engine wanted to go. */
  maxStall: number;
}

/** Drive one car with a scripted input for `seconds` after GO. */
function drive(file: TrackFile, seconds: number, input: (n: number, f: ActionFrame) => void, spec = HOT_ROD): Run {
  const sim = new RaceSim(file, [{ spec, name: 'a' }]);
  const out: Run = { sim, impacts: [], repositions: 0, maxStall: 0 };
  const f = emptyFrame();
  let stall = 0;
  for (let n = 0; sim.clock < seconds; n++) {
    f.steer = 0;
    f.pressed.steamPush = f.held.steamPush = false;
    if (sim.phase !== 'countdown') input(n, f);
    sim.step([f]);
    for (const e of sim.drainEvents()) {
      if (e.type === 'impact' && e.impact) out.impacts.push(e.impact);
      if (e.type === 'reposition') out.repositions++;
    }
    const v = sim.racers[0]!.vehicle;
    stall = sim.phase === 'running' && v.speed() < 0.5 ? stall + 1 / 60 : 0;
    out.maxStall = Math.max(out.maxStall, stall);
  }
  return out;
}

const shiftUp = (n: number, f: ActionFrame) => {
  f.pressed.steamPush = f.held.steamPush = n % 70 === 0;
};

describe('barricade rules', () => {
  it('classifies contacts: scrape, glancing hit, frontal crash', () => {
    const p = barricadeParams('riveted');
    expect(classifyImpact(0.5, 20, p)).toBe('scrape');
    expect(classifyImpact(5, 20, p)).toBe('hit');
    expect(classifyImpact(12, 30, p)).toBe('hit'); // fast but shallow: deflected
    expect(classifyImpact(14, 6, p)).toBe('crash');
    // Sandbags absorb a hit that would be a crash on plates.
    expect(classifyImpact(12, 4, barricadeParams('riveted'))).toBe('crash');
    expect(classifyImpact(12, 4, barricadeParams('sandbags'))).toBe('hit');
  });

  it('a hit always costs speed, more on harsher edges', () => {
    for (const b of BARRICADES) expect(speedAfterHit(6, 20, barricadeParams(b))).toBeLessThan(20);
    expect(speedAfterHit(6, 20, barricadeParams('hedgehog'))).toBeLessThan(speedAfterHit(6, 20, barricadeParams('riveted')));
  });
});

describe('track edge (invisible rail)', () => {
  it.each(BARRICADES)('%s: flat out with no steering never gets stuck and never leaves the track', (b) => {
    const r = drive(trackWith(b), 45, shiftUp);
    expect(r.repositions).toBe(0);
    // Only a crash may stop the car, and only for the stun time plus the restart.
    expect(r.maxStall).toBeLessThan(tunables.get('barricades.crashStun') + 1);
    const p = r.sim.racers[0]!.progress;
    expect(Math.abs(p.lateral)).toBeLessThan(r.sim.track.halfWidth);
    expect(p.distance).toBeGreaterThan(250); // it kept going around the circuit along the edges
    r.sim.dispose();
  });

  it('the tank is contained and keeps going too', () => {
    const r = drive(trackWith('riveted'), 45, shiftUp, STEAM_TANK);
    expect(r.repositions).toBe(0);
    expect(r.sim.racers[0]!.progress.distance).toBeGreaterThan(250);
    r.sim.dispose();
  });

  it('a frontal impact is a crash: full stop, then away again in 1st gear', () => {
    // Top gear down the start straight, then full lock into the edge.
    const sim = new RaceSim(trackWith('riveted'), [{ spec: HOT_ROD, name: 'a' }]);
    const f = emptyFrame();
    const v = sim.racers[0]!.vehicle;
    let crashed = false;
    let stoppedInFirst = false;
    for (let n = 0; n < 60 * 12 && !stoppedInFirst; n++) {
      f.pressed.steamPush = f.held.steamPush = sim.phase === 'running' && !crashed && n % 70 === 0;
      // From the right-hand grid slot, full lock left: across the whole track into the far edge.
      f.steer = sim.clock > 2.5 && !crashed ? -1 : 0;
      sim.step([f]);
      for (const e of sim.drainEvents()) if (e.impact?.kind === 'crash') crashed = true;
      if (crashed && v.speed() < 2.5 && v.gearbox.gear === 1) stoppedInFirst = true;
    }
    expect(crashed).toBe(true);
    expect(stoppedInFirst).toBe(true);
    // …and it drives away on its own, along the track.
    f.steer = 0;
    f.pressed.steamPush = f.held.steamPush = false;
    const d0 = sim.racers[0]!.progress.distance;
    for (let n = 0; n < 60 * 4; n++) sim.step([f]);
    expect(v.telemetry.forwardSpeed).toBeGreaterThan(3);
    expect(sim.racers[0]!.progress.distance).toBeGreaterThan(d0 + 8);
    expect(sim.drainEvents().filter((e) => e.type === 'reposition')).toHaveLength(0);
    sim.dispose();
  });

  it('scraping is always slower than the clean line, and spikes slow more than plates', () => {
    // Hold a light steer into the right edge on the start straight and measure the speed there.
    const scrapeSpeed = (b: Barricade) => {
      const sim = new RaceSim(trackWith(b), [{ spec: HOT_ROD, name: 'a' }]);
      const f = emptyFrame();
      const v = sim.racers[0]!.vehicle;
      let sum = 0;
      let count = 0;
      let ticks = 0;
      for (let n = 0; sim.clock < 5; n++) {
        f.steer = sim.phase === 'running' ? 0.35 : 0;
        f.pressed.steamPush = f.held.steamPush = sim.phase === 'running' && n % 70 === 0 && v.gearbox.gear < 3;
        sim.step([f]);
        ticks += sim.drainEvents().filter((e) => e.impact?.kind === 'scrape').length;
        if (sim.racers[0]!.edge.contact && sim.racers[0]!.edge.time > 0.5) {
          // Relative to the speed the current gear would reach on the clean line.
          sum += v.speed() / (v.lastOutput!.targetRatio * tunables.get('handling.maxSpeed'));
          count++;
        }
      }
      sim.dispose();
      expect(count).toBeGreaterThan(30);
      expect(ticks).toBeGreaterThan(0); // periodic scrape events: the damage tick of M3
      return sum / count;
    };
    const plates = scrapeSpeed('riveted');
    const spikes = scrapeSpeed('hedgehog');
    expect(plates).toBeLessThan(0.95);
    // Half-size vehicles (VEHICLE_SCALE 0.5): plates 0.54, spikes 0.42 of the clean-line speed.
    expect(spikes).toBeLessThan(plates - 0.1);
  });

  it('barbed wire costs a gear on a hit', () => {
    const gearAfterHit = (b: Barricade) => {
      const sim = new RaceSim(trackWith(b), [{ spec: HOT_ROD, name: 'a' }]);
      const f = emptyFrame();
      const v = sim.racers[0]!.vehicle;
      let gear = -1;
      for (let n = 0; sim.clock < 6 && gear < 0; n++) {
        // Reach 3rd gear first, then steer into the edge without touching the gears.
        f.steer = sim.clock > 2.4 ? 0.5 : 0;
        f.pressed.steamPush = f.held.steamPush = sim.phase === 'running' && sim.clock < 2.2 && n % 70 === 0 && v.gearbox.gear < 3;
        const before = v.gearbox.gear;
        sim.step([f]);
        if (sim.drainEvents().some((e) => e.impact?.kind === 'hit')) gear = v.gearbox.gear - before;
      }
      sim.dispose();
      return gear;
    };
    expect(gearAfterHit('riveted')).toBe(0);
    expect(gearAfterHit('barbed')).toBe(-1);
  });
});
