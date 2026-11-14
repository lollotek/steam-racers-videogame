import { describe, expect, it } from 'vitest';
import {
  CUP_ROUNDS,
  MAX_LEVEL,
  UPGRADE_PRICES,
  applyRace,
  buyUpgrade,
  gridFor,
  loadSeason,
  newSeason,
  noLevels,
  parseSeason,
  prizeFor,
  racerTune,
  randomGrid,
  repairCost,
  saveSeason,
  standings,
  toBriefing,
  tuneFor,
  type RaceOutcome,
  type Season,
} from '../../src/cup/cup';

const finishOrder = (order: number[], extra: Partial<Record<number, Partial<RaceOutcome>>> = {}): RaceOutcome[] => {
  const out: RaceOutcome[] = [];
  order.forEach((racer, k) => (out[racer] = { position: k + 1, retired: false, wrecked: false, bags: 0, ...extra[racer] }));
  return out;
};

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe('prizes', () => {
  it('pays 100k/60k/30k/10k for 4 racers and scales by difficulty', () => {
    expect([1, 2, 3, 4].map((p) => prizeFor(p, 4, 'normal'))).toEqual([100_000, 60_000, 30_000, 10_000]);
    expect(prizeFor(1, 4, 'easy')).toBe(75_000);
    expect(prizeFor(1, 4, 'hard')).toBe(125_000);
    expect(prizeFor(8, 8, 'normal')).toBe(5_000);
    expect(prizeFor(5, 4, 'normal')).toBe(0);
    expect(repairCost('normal')).toBe(20_000);
  });
});

describe('season', () => {
  it('creates humans first, AI after', () => {
    const s = newSeason({ difficulty: 'normal', vehicles: ['tank'], racers: 4, seed: 3 });
    expect(s.racers.map((r) => r.player)).toEqual([0, null, null, null]);
    expect(s.racers[0]!.vehicle).toBe('tank');
    expect(s.round).toBe(0);
    expect(s.stage).toBe('briefing');
  });

  it('first grid is a seeded draw, later grids follow the standings (leader on pole)', () => {
    const s = newSeason({ difficulty: 'normal', vehicles: ['hotrod'], racers: 4, seed: 9 });
    const g0 = gridFor(s);
    expect([...g0].sort()).toEqual([0, 1, 2, 3]);
    expect(gridFor(s)).toEqual(g0);
    applyRace(s, finishOrder([2, 0, 3, 1]));
    toBriefing(s);
    const g1 = gridFor(s);
    expect(g1[2]).toBe(0);
    expect(g1[0]).toBe(1);
    expect(g1[1]).toBe(3);
  });

  it('pays prizes and bags, charges repairs without going negative, records finishes', () => {
    const s = newSeason({ difficulty: 'normal', vehicles: ['hotrod'], racers: 4, seed: 1 });
    applyRace(s, finishOrder([0, 1, 2, 3], { 0: { bags: 10_000 }, 3: { retired: true, wrecked: true } }));
    const [me, , , last] = s.racers;
    expect(me!.earned).toBe(110_000);
    expect(me!.finishes).toEqual([1]);
    expect(last!.earned).toBe(0);
    expect(last!.cash).toBe(0); // repair capped at what it had
    expect(last!.finishes).toEqual([null]);
    expect(s.last![3]!.repair).toBe(0);
    expect(s.round).toBe(1);
    expect(s.stage).toBe('workshop');
  });

  it('a menu retirement (not wrecked) pays no prize and no repair', () => {
    const s = newSeason({ difficulty: 'normal', vehicles: ['hotrod'], racers: 4, seed: 1 });
    applyRace(s, finishOrder([1, 2, 3, 0], { 0: { retired: true, wrecked: false, bags: 5_000 } }));
    expect(s.racers[0]!.earned).toBe(5_000);
    expect(s.last![0]!.repair).toBe(0);
  });

  it('workshop: buying spends cash, raises the level, stops at max and when broke', () => {
    const s = newSeason({ difficulty: 'normal', vehicles: ['hotrod'], racers: 4, seed: 1 });
    s.racers[0]!.cash = 1_000_000;
    for (let k = 0; k < MAX_LEVEL; k++) expect(buyUpgrade(s, 0, 'topSpeed')).toBe(true);
    expect(buyUpgrade(s, 0, 'topSpeed')).toBe(false);
    expect(s.racers[0]!.cash).toBe(1_000_000 - UPGRADE_PRICES.reduce((a, b) => a + b, 0));
    s.racers[0]!.cash = 0;
    expect(buyUpgrade(s, 0, 'accel')).toBe(false);
  });

  it('upgrades and difficulty become driving multipliers; AI grow per race', () => {
    expect(tuneFor(noLevels())).toEqual({ accel: 1, topSpeed: 1, grip: 1, rough: 0 });
    const t = tuneFor({ accel: 2, topSpeed: 4, tyres: 1, suspension: 3 });
    expect(t.accel).toBeCloseTo(1.12);
    expect(t.topSpeed).toBeCloseTo(1.1);
    expect(t.grip).toBeCloseTo(1.05);
    expect(t.rough).toBeCloseTo(0.36);
    const s = newSeason({ difficulty: 'hard', vehicles: ['hotrod'], racers: 4, seed: 1 });
    expect(racerTune(s, 0).topSpeed).toBe(1);
    const ai0 = racerTune(s, 1).topSpeed;
    s.round = 2;
    expect(racerTune(s, 1).topSpeed).toBeGreaterThan(ai0);
  });

  it('a full Cup: 4 races, AI shop with their prizes, the most money wins', () => {
    const s = newSeason({ difficulty: 'normal', vehicles: ['hotrod', 'tank'], racers: 6, seed: 5 });
    for (let k = 0; k < CUP_ROUNDS.length; k++) {
      applyRace(s, finishOrder([3, 0, 1, 2, 4, 5]));
      if (s.stage === 'workshop') toBriefing(s);
    }
    expect(s.stage).toBe('done');
    expect(s.round).toBe(4);
    expect(standings(s)[0]).toBe(3);
    // AI 3 won every race: it spent on upgrades, humans did not (they shop themselves).
    expect(Object.values(s.racers[3]!.levels).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(Object.values(s.racers[0]!.levels).reduce((a, b) => a + b, 0)).toBe(0);
    expect(() => applyRace(s, finishOrder([0, 1, 2, 3, 4, 5]))).toThrow();
  });

  it('random grid is a permutation, stable per seed', () => {
    const g = randomGrid(8, 42);
    expect([...g].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(randomGrid(8, 42)).toEqual(g);
  });
});

describe('save', () => {
  it('round-trips through a store and rejects broken saves', () => {
    const store = memStore();
    const s = newSeason({ difficulty: 'easy', vehicles: ['hotrod'], racers: 4, seed: 7 });
    applyRace(s, finishOrder([0, 1, 2, 3]));
    saveSeason(store, s);
    expect(loadSeason(store)).toEqual(s);
    saveSeason(store, null);
    expect(loadSeason(store)).toBeNull();
    store.setItem('steamRacers.cup.v1', '{not json');
    expect(loadSeason(store)).toBeNull();
    expect(parseSeason({ ...s, v: 2 })).toBeNull();
    const bad = structuredClone(s) as Season;
    bad.racers[0]!.levels.accel = 9;
    expect(parseSeason(bad)).toBeNull();
    expect(loadSeason(null)).toBeNull();
  });
});
