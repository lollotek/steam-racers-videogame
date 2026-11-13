import { beforeAll, describe, expect, it } from 'vitest';
import { TrackError, compileTrack, sampleAt } from '../../src/track/compile';
import { hazardClock, inRange, distanceTo, resolveHazard } from '../../src/track/hazards';
import { JUMP, MAX_GRADE, type Piece, type TrackFile } from '../../src/track/track-format';
import { RaceSim, initPhysics } from '../../src/sim/race-sim';
import { createDriver, driveRacer } from '../../src/ai/driver';
import { HOT_ROD, STEAM_TANK } from '../../src/vehicles/vehicle-physics';
import { emptyFrame } from '../../src/input/actions';
import { tunables } from '../../src/core/tunables';
import proving from '../../src/tracks/proving-ground.json';
import foundry from '../../src/tracks/foundry-01.json';

beforeAll(async () => {
  await initPhysics();
});

/** A 4-right-turn rectangle; the north and south legs take the given pieces (each 8 cells long). */
const loop = (north: Piece[], south: Piece[] = [{ type: 'straight', size: 8 }]): TrackFile => ({
  id: 't', name: 't', biome: 'foundry', cell: 20, width: 14, laps: 1, defaultSurface: 'plate', defaultBarricade: 'riveted',
  pieces: [
    ...north,
    { type: 'curve', size: 2, turn: 'R' },
    { type: 'straight', size: 2 },
    { type: 'curve', size: 2, turn: 'R' },
    ...south,
    { type: 'curve', size: 2, turn: 'R' },
    { type: 'straight', size: 2 },
    { type: 'curve', size: 2, turn: 'R' },
  ],
});
const copy = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

describe('track format v2: heights (doc 04 A5)', () => {
  it('v1 tracks stay flat and road-only', () => {
    const t = compileTrack(foundry as TrackFile);
    expect(t.bounds.minY).toBe(0);
    expect(t.bounds.maxY).toBe(0);
    expect(t.samples.every((s) => s.feature === 'road')).toBe(true);
    expect(t.jumps).toHaveLength(0);
  });

  it('a ramp climbs one level smoothly and the track must come back down', () => {
    const t = compileTrack(loop([{ type: 'start', size: 3 }, { type: 'straight', size: 2, rise: 1 }, { type: 'straight', size: 3 }], [{ type: 'straight', size: 3 }, { type: 'straight', size: 2, rise: -1 }, { type: 'straight', size: 3 }]));
    expect(t.bounds.maxY).toBeCloseTo(4, 5);
    for (const s of t.samples) expect(Math.abs(s.grade)).toBeLessThanOrEqual(MAX_GRADE + 1e-6);
    // Continuous heights.
    for (let i = 1; i < t.samples.length; i++) expect(Math.abs(t.samples[i]!.y - t.samples[i - 1]!.y)).toBeLessThan(0.3);
    expect(() => compileTrack(loop([{ type: 'start', size: 3 }, { type: 'straight', size: 5, rise: 1 }]))).toThrow(/height/);
  });

  it('rejects slopes that are too steep, crests on curves and fractional levels', () => {
    expect(() => compileTrack(loop([{ type: 'start', size: 3 }, { type: 'straight', size: 1, rise: 1 }, { type: 'straight', size: 4 }], [{ type: 'straight', size: 4 }, { type: 'straight', size: 4, rise: -1 }]))).toThrow(/steep/);
    const bad = loop([{ type: 'start', size: 8 }]);
    bad.pieces[1] = { type: 'curve', size: 2, turn: 'R', crest: 2 };
    expect(() => compileTrack(bad)).toThrow(TrackError);
    expect(() => compileTrack(loop([{ type: 'start', size: 3 }, { type: 'straight', size: 5, rise: 0.5 }]))).toThrow(/whole/);
  });

  it('a crest rises and falls back on the same level', () => {
    const t = compileTrack(loop([{ type: 'start', size: 3 }, { type: 'straight', size: 2, crest: 2.5 }, { type: 'straight', size: 3 }]));
    expect(t.bounds.maxY).toBeCloseTo(2.5, 1);
    expect(sampleAt(t, 3 * 20 + 1).y).toBeLessThan(0.1);
    expect(sampleAt(t, 5 * 20 - 1).y).toBeLessThan(0.1);
  });

  it('a jump has a kicker, a gap with no road, a landing, and a ballistic minimum speed', () => {
    const t = compileTrack(loop([{ type: 'start', size: 3 }, { type: 'jump', size: 2 }, { type: 'straight', size: 3 }]));
    expect(t.jumps).toHaveLength(1);
    const j = t.jumps[0]!;
    expect(j.gap1 - j.gap0).toBeCloseTo(40 - JUMP.kicker - JUMP.landing, 0);
    expect(sampleAt(t, j.gap0 - 0.5).feature).toBe('kicker');
    expect(sampleAt(t, (j.gap0 + j.gap1) / 2).feature).toBe('gap');
    expect(sampleAt(t, j.gap1 + 2).feature).toBe('landing');
    expect(sampleAt(t, j.gap0 - 0.01).y).toBeCloseTo(JUMP.lip, 0);
    expect(j.minSpeed).toBeGreaterThan(8);
    expect(j.minSpeed).toBeLessThan(25);
    expect(() => compileTrack(loop([{ type: 'start', size: 3 }, { type: 'jump', size: 1 }, { type: 'straight', size: 4 }]))).toThrow(/jump too short/);
  });

  it('spawn slots carry the road height', () => {
    const t = compileTrack(proving as TrackFile);
    for (const sp of t.spawn) expect(sp.y).toBeCloseTo(sampleAt(t, 0).y, 0);
  });
});

describe('track format v2: pickups, hazards, landmarks (doc 04 A2–A4)', () => {
  it('places pickups and hazards on their pieces, landmarks beside the road', () => {
    const t = compileTrack(proving as TrackFile);
    expect(t.pickups.length).toBe(5);
    for (const p of t.pickups) expect(Math.abs(p.lateral)).toBeLessThanOrEqual(t.halfWidth);
    expect(t.hazards.map((h) => h.kind).sort()).toEqual(['crane', 'crossing', 'stream', 'vent']);
    for (const h of t.hazards) {
      const piece = sampleAt(t, (h.s0 + h.s1) / 2);
      expect(piece.feature).toBe('road');
    }
    const lm = t.landmarks[0]!;
    expect(lm.id).toBe('rune-engine');
    const nearest = Math.min(...t.samples.map((s) => Math.hypot(s.x - lm.x, s.z - lm.z)));
    expect(nearest).toBeGreaterThan(t.halfWidth + 10);
  });

  it('rejects unknown pickups, hazards and lanes', () => {
    const f = loop([{ type: 'start', size: 3 }, { type: 'straight', size: 5 }]);
    f.pieces[1]!.pickups = [{ kind: 'gold' as never }];
    expect(() => compileTrack(f)).toThrow(/pickup/);
    const g = loop([{ type: 'start', size: 3 }, { type: 'straight', size: 5, hazard: { kind: 'vent', lanes: [0.5, -0.5] } }]);
    expect(() => compileTrack(g)).toThrow(/lanes/);
  });

  it('hazard clock: idle → warning → active, periodic and offset by phase', () => {
    const h = { ...resolveHazard({ kind: 'crossing' }), phase: 0 };
    const idle = h.period - h.warning - h.active;
    expect(hazardClock(h, 0).phase).toBe('idle');
    expect(hazardClock(h, idle + 0.1).phase).toBe('warning');
    expect(hazardClock(h, idle + h.warning + 0.1).phase).toBe('active');
    expect(hazardClock(h, h.period + idle + h.warning + 0.1).phase).toBe('active');
    expect(hazardClock({ ...h, phase: h.warning + h.active }, idle - 0.1).phase).toBe('active');
    expect(hazardClock(h, -1).phase).toBe('active'); // before GO the cycle runs backwards in time
    expect(hazardClock(h, idle - 1).untilActive).toBeCloseTo(1 + h.warning, 5);
  });

  it('zone ranges wrap around the lap', () => {
    const h = { s0: 95, s1: 105 };
    expect(inRange(h, 50, 100)).toBe(false);
    expect(inRange(h, 2, 100)).toBe(true);
    expect(inRange(h, 98, 100)).toBe(true);
    expect(distanceTo({ s0: 50, s1: 60 }, 40, 100)).toBe(10);
    expect(distanceTo({ s0: 50, s1: 60 }, 70, 100)).toBe(80);
  });
});

describe('track features in the race sim', () => {
  const straightTrack = (piece: Partial<Piece>): TrackFile => loop([{ type: 'start', size: 3 }, { type: 'straight', size: 5, ...piece } as Piece]);

  it('drives over the proving ground: road follows heights, jumps cleared, no repositions', () => {
    const sim = new RaceSim(copy(proving) as TrackFile, [{ spec: HOT_ROD, name: 'a' }, { spec: STEAM_TANK, name: 'b' }], 2);
    const pilots = sim.racers.map((_, i) => createDriver(i, 2, 0));
    let repos = 0;
    let landings = 0;
    for (let n = 0; n < 60 * 90 && sim.racers.some((r) => r.progress.lap < 1); n++) {
      sim.step(pilots.map((p) => driveRacer(p, sim)));
      repos += sim.drainEvents().filter((e) => e.type === 'reposition').length;
      landings += sim.drainRuleEvents().filter((e) => e.type === 'landing').length;
      for (const r of sim.racers) {
        // Never below the road (except over a gap, in flight).
        const smp = sim.track.samples[r.progress.index]!;
        if (smp.feature === 'road') expect(r.vehicle.curr.y).toBeGreaterThan(smp.y - 0.5);
      }
    }
    expect(sim.racers.every((r) => r.progress.lap >= 1)).toBe(true);
    expect(repos).toBe(0);
    expect(landings).toBeGreaterThanOrEqual(4); // 2 jumps × 2 racers
    sim.dispose();
  });

  it('a car that falls into a jump pit is repositioned after the landing', () => {
    const sim = new RaceSim(loop([{ type: 'start', size: 3 }, { type: 'jump', size: 3 }, { type: 'straight', size: 2 }]), [{ spec: HOT_ROD, name: 'a' }]);
    const f = emptyFrame();
    let repos = 0;
    // Crawl in 1st gear: far too slow to clear a 36 m gap.
    for (let n = 0; n < 60 * 30 && repos === 0; n++) {
      sim.step([f]);
      repos += sim.drainEvents().filter((e) => e.type === 'reposition').length;
    }
    expect(repos).toBe(1);
    sim.step([f]); // progress follows the new position on the next step
    const smp = sim.track.samples[sim.racers[0]!.progress.index]!;
    expect(smp.feature).toBe('road');
    expect(smp.s).toBeGreaterThan(sim.track.jumps[0]!.gap1);
    sim.dispose();
  });

  it('coal crates give PV, money bags give $, crates respawn', () => {
    const sim = new RaceSim(straightTrack({ pickups: [{ kind: 'coal', at: 0.2, lane: 0.625 }, { kind: 'money', at: 0.6, lane: 0.625 }] }), [{ spec: HOT_ROD, name: 'a' }]);
    const r = sim.racers[0]!;
    const f = emptyFrame();
    const got: string[] = [];
    let pvAtCoal = 0;
    for (let n = 0; n < 60 * 25 && got.length < 2; n++) {
      const before = r.rules.boiler.pv;
      sim.step([f]);
      for (const e of sim.drainRuleEvents())
        if (e.type === 'pickup') {
          got.push(e.kind);
          if (e.kind === 'coal') pvAtCoal = r.rules.boiler.pv - before;
        }
    }
    expect(got).toEqual(['coal', 'money']);
    expect(pvAtCoal).toBeGreaterThanOrEqual(1);
    expect(r.rules.money).toBe(tunables.get<number>('pickups.moneyValue'));
    expect(sim.features.pickups[0]!.active).toBe(false);
    const until = sim.features.pickups[0]!.respawnAt;
    while (sim.clock < until + 0.1) sim.step([f]);
    expect(sim.features.pickups[0]!.active).toBe(true);
    sim.dispose();
  });

  it('an active full-width hazard damages once per cycle; a solid one blocks the road', () => {
    // Vent always active: damage once on entry, not every step.
    const sim = new RaceSim(straightTrack({ hazard: { kind: 'vent', at: 0.2, period: 100, warning: 0, active: 100 } }), [{ spec: HOT_ROD, name: 'a' }]);
    const f = emptyFrame();
    let dmg = 0;
    for (let n = 0; n < 60 * 20; n++) {
      sim.step([f]);
      for (const e of sim.drainRuleEvents()) if (e.type === 'damage' && e.source === 'hazard') dmg += e.pf;
    }
    expect(dmg).toBe(1);
    sim.dispose();

    // Crane block always down across the whole road: the car cannot get past it.
    const sim2 = new RaceSim(straightTrack({ hazard: { kind: 'crane', at: 0.3, lanes: [-1, 1], period: 100, warning: 0, active: 100 } }), [{ spec: HOT_ROD, name: 'a' }]);
    const h = sim2.track.hazards[0]!;
    for (let n = 0; n < 60 * 20; n++) sim2.step([f]);
    expect(sim2.racers[0]!.progress.s).toBeLessThan(h.s0 + 1);
    sim2.dispose();
  });

  it('sap streams give steam on the pulse and cut grip between pulses', () => {
    const sim = new RaceSim(straightTrack({ hazard: { kind: 'stream', at: 0.5, length: 90, lanes: [-1, 1], period: 6, warning: 0, active: 3 } }), [{ spec: HOT_ROD, name: 'a' }]);
    const f = emptyFrame();
    let steam = 0;
    let lowGrip = false;
    for (let n = 0; n < 60 * 40; n++) {
      sim.step([f]);
      if (sim.racers[0]!.vehicle.gripMul < 1) lowGrip = true;
      for (const e of sim.drainRuleEvents()) if (e.type === 'hazard' && e.effect === 'steam') steam += e.amount;
    }
    expect(steam).toBeGreaterThan(0);
    expect(lowGrip).toBe(true);
    sim.dispose();
  });
});
