import { describe, expect, it } from 'vitest';
import { Rng, RngStreams } from '../../src/core/rng';

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('differs for different seeds and accepts string seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
    expect(new Rng('foundry').next()).toBe(new Rng('foundry').next());
  });

  it('stays in range and is roughly uniform', () => {
    const r = new Rng(7);
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 100000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)]!++;
    }
    for (const b of buckets) expect(b).toBeGreaterThan(9000);
  });

  it('die() covers 1..sides inclusive', () => {
    const r = new Rng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(r.die(10));
    expect([...seen].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('streams are independent: using fx does not change gameplay', () => {
    const s1 = new RngStreams(99);
    const s2 = new RngStreams(99);
    for (let i = 0; i < 50; i++) s2.get('fx').next();
    expect(s1.get('gameplay').next()).toBe(s2.get('gameplay').next());
  });
});
