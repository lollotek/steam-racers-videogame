import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { tunables } from '../../src/core/tunables';
import { boilerCal, createBoiler, stepBoiler } from '../../src/rules/boiler';
import { createStartTest, resolveStart, startEffect, stepStartTest } from '../../src/rules/start-test';
import { createHull, damage, edgeDamage, hullCondition, ram, scrapeDamage } from '../../src/rules/hull';
import { coneHalfAngle, pickTarget, zoneDamage, zoneOf } from '../../src/rules/cannon';
import { blockedAt } from '../../src/rules/sight';
import { compileTrack, sampleAt } from '../../src/track/compile';
import type { TrackFile } from '../../src/track/track-format';
import foundry from '../../src/tracks/foundry-01.json';

const DT = 1 / 60;
const t = (k: string) => tunables.get<number>(k);
const NONE = { vent: false, valve: false };
const VALVE = { vent: false, valve: true };
const VENT = { vent: true, valve: false };

describe('boiler (gameplay.md §5.2)', () => {
  it('generates passively, slower above CAL', () => {
    const b = createBoiler(5, 0);
    b.pv = 0;
    const rng = new Rng(1);
    for (let i = 0; i < 60 * t('boiler.regenTime') * 5 + 2; i++) stepBoiler(b, DT, NONE, rng);
    expect(b.pv).toBe(5);
    for (let i = 0; i < 60 * t('boiler.regenTime'); i++) stepBoiler(b, DT, NONE, rng);
    expect(b.pv).toBe(5); // above CAL needs 1 / redRegenFactor times longer
  });

  it('red zone builds pressure and starts the reliability test; hitting the notch contains it', () => {
    const b = createBoiler(5, 0);
    const rng = new Rng(2);
    b.pv = 7;
    let started = null;
    for (let i = 0; i < 60 * 20 && !started; i++) started = stepBoiler(b, DT, NONE, rng).testStarted;
    expect(started).toBe('red');
    const test = b.test!;
    expect(b.stalled).toBe(true);
    // Wait for the needle to reach the notch, then open the valve (gear key).
    let out = null;
    for (let i = 0; i < 600 && !out; i++) {
      const on = Math.abs(test.needle + DT / t('boiler.testTime') - test.notch) < test.half * 0.5;
      out = stepBoiler(b, DT, on ? VALVE : NONE, rng).outcome;
    }
    expect(out).toBe('contained');
    expect(b.stalled).toBe(true); // still stalled on the step it resolves: the gear press is spent
    expect(b.pressure).toBe(0);
    expect(b.test).toBeNull();
    stepBoiler(b, DT, NONE, rng);
    expect(b.stalled).toBe(false);
  });

  it('missing the notch: emergency valves (red) or explosion (2 × CAL)', () => {
    const rng = new Rng(3);
    const b = createBoiler(5, 0);
    b.pv = 6;
    b.pressure = 1;
    stepBoiler(b, DT, NONE, rng);
    expect(b.test?.kind).toBe('red');
    let out = null;
    while (!out) out = stepBoiler(b, DT, NONE, rng).outcome; // never vents
    expect(out).toBe('emergency');
    expect(b.pv).toBe(0);

    const c = createBoiler(5, 0);
    c.pv = 10;
    stepBoiler(c, DT, NONE, rng);
    expect(c.test?.kind).toBe('burst');
    // Past the grace, well before the notch: off the notch.
    for (let i = 0; i < Math.ceil((t('boiler.testGrace') + 0.05) * 60); i++) stepBoiler(c, DT, NONE, rng);
    expect(stepBoiler(c, DT, VALVE, rng).outcome).toBe('explosion');
    expect(boilerCal(c)).toBe(5 - t('boiler.explosionCal'));
    expect(c.noRegen).toBeGreaterThan(0);
  });

  it('gear presses in the grace window are ignored; VENT does nothing during the test', () => {
    const rng = new Rng(5);
    const b = createBoiler(5, 0);
    b.pv = 6;
    b.pressure = 1;
    stepBoiler(b, DT, NONE, rng);
    expect(b.test).not.toBeNull();
    expect(stepBoiler(b, DT, VALVE, rng).outcome).toBeNull(); // grace
    expect(stepBoiler(b, DT, VENT, rng).outcome).toBeNull();
    expect(b.pv).toBe(6);
    expect(b.test).not.toBeNull();
  });

  it('VENT outside a test dumps one PV and some pressure', () => {
    const b = createBoiler(5, 0);
    b.pv = 6;
    b.pressure = 0.5;
    const r = stepBoiler(b, DT, VENT, new Rng(4));
    expect(r.vented).toBe(true);
    expect(b.pv).toBe(5);
    expect(b.pressure).toBeLessThan(0.5);
  });
});

describe('start test (gameplay.md §4)', () => {
  const runStart = (hold: (needle: number) => boolean) => {
    const s = createStartTest(2, 2, false);
    const total = 3;
    for (let time = 0; time < total; time += DT) stepStartTest(s, hold(s.needle), DT, total - time);
    return resolveStart(s);
  };

  it('keeping the needle in the band is a perfect start (3rd gear + long push)', () => {
    const s = createStartTest(2, 2, false);
    const mid = (s.lo + s.hi) / 2;
    expect(runStart((n) => n < mid)).toBe('perfect');
    expect(startEffect('perfect').gear).toBe(3);
    expect(startEffect('perfect').push).toBeGreaterThan(startEffect('good').push);
  });

  it('not touching STEAM stalls; holding it all the way is the red zone (stall)', () => {
    expect(runStart(() => false)).toBe('stall');
    expect(runStart(() => true)).toBe('stall');
  });

  it('MAN and pole position widen the band', () => {
    const a = createStartTest(0, 0, false);
    const b = createStartTest(4, 0, true);
    expect(b.hi - b.lo).toBeGreaterThan(a.hi - a.lo);
  });
});

describe('hull and ramming (gameplay.md §6)', () => {
  it('damage, RES on weapon hits, condition and wreck', () => {
    const h = createHull(20, 1);
    expect(damage(h, 4, 0, true)).toBe(3);
    expect(hullCondition(h)).toBe('ok');
    damage(h, 8, 0);
    expect(hullCondition(h)).toBe('smoke');
    damage(h, 5, 0);
    expect(hullCondition(h)).toBe('fire');
    damage(h, 10, 7);
    expect(h.wrecked).toBe(true);
    expect(h.wreckedAt).toBe(7);
    expect(damage(h, 5, 8)).toBe(0);
  });

  it('edge table: barbed wire never hurts, hedgehogs hurt more and on scrapes', () => {
    expect(edgeDamage('barbed', 'crash', true)).toBe(0);
    expect(edgeDamage('hedgehog', 'hit', false)).toBeGreaterThan(edgeDamage('riveted', 'hit', false));
    expect(edgeDamage('riveted', 'hit', true)).toBe(edgeDamage('riveted', 'hit', false) + t('hull.pushedBonus'));
    const h = createHull(20, 0);
    let pf = 0;
    for (let i = 0; i < 60 * 4; i++) pf += scrapeDamage(h, 'hedgehog', true, DT);
    expect(pf).toBe(Math.floor(4 / t('hull.hedgehog.scrapeEvery')));
    expect(scrapeDamage(h, 'riveted', true, 10)).toBe(0);
  });

  it('ramming: the heavier, faster attacker usually wins; side contacts cost 1 PF each', () => {
    const rng = new Rng(9);
    let wins = 0;
    for (let i = 0; i < 100; i++) {
      const r = ram({ mass: 1.5, gear: 5, nose: true }, { mass: 1, gear: 2, nose: false }, true, 10, rng);
      if (r.winner > 0) {
        wins++;
        expect(r.b).toBeGreaterThan(r.a);
      }
    }
    expect(wins).toBeGreaterThan(90);
    expect(ram({ mass: 1, gear: 3, nose: false }, { mass: 1, gear: 3, nose: false }, false, 20, rng)).toMatchObject({ a: 1, b: 1, winner: 0 });
    expect(ram({ mass: 1, gear: 3, nose: false }, { mass: 1, gear: 3, nose: false }, false, 1, rng)).toMatchObject({ a: 0, b: 0 });
  });
});

describe('front cannon (gameplay.md §7)', () => {
  it('locks the nearest rival inside the cone ahead only', () => {
    const c = [
      { index: 1, x: 0, z: 30 },
      { index: 2, x: 0, z: 12 },
      { index: 3, x: 0, z: -5 },
      { index: 4, x: 30, z: 5 },
    ];
    expect(pickTarget(0, 0, 0, c)).toBe(2);
    expect(pickTarget(0, 0, Math.PI, c)).toBe(3);
    expect(pickTarget(0, 0, 0, [c[3]!])).toBe(-1);
  });

  it('cone widens with high gears, steering and clouds; narrows holding the line', () => {
    const base = { shooterGear: 3, targetGear: 3, steer: 0, steady: 0, sinceManoeuvre: 9, throughCloud: false };
    const a = coneHalfAngle(base);
    expect(coneHalfAngle({ ...base, shooterGear: 6, targetGear: 5 })).toBeGreaterThan(a);
    expect(coneHalfAngle({ ...base, steer: 1 })).toBeGreaterThan(a);
    expect(coneHalfAngle({ ...base, throughCloud: true })).toBeGreaterThan(a);
    expect(coneHalfAngle({ ...base, steady: 5 })).toBeLessThan(a);
  });

  it('zones from the lateral offset; centre hits the hardest, edge does no damage', () => {
    expect(zoneOf(0, 1)).toBe('centre');
    expect(zoneOf(0.25, 1)).toBe('vital');
    expect(zoneOf(0.6, 1)).toBe('body');
    expect(zoneOf(1.05, 1)).toBe('edge');
    expect(zoneOf(3, 1)).toBe('miss');
    expect(zoneDamage('centre')).toBeGreaterThan(zoneDamage('vital'));
    expect(zoneDamage('vital')).toBeGreaterThan(zoneDamage('body'));
    expect(zoneDamage('edge')).toBe(0);
  });
});

describe('line of sight (barricades stop shells)', () => {
  const track = compileTrack(foundry as TrackFile);
  const near = (x: number, z: number) => track.samples.reduce((b, p, i) => ((p.x - x) ** 2 + (p.z - z) ** 2 < (track.samples[b]!.x - x) ** 2 + (track.samples[b]!.z - z) ** 2 ? i : b), 0);

  it('is clear along the centre line of a straight', () => {
    const a = sampleAt(track, track.lineS - 40);
    const b = sampleAt(track, track.lineS - 10);
    expect(blockedAt(track, a.x, a.z, b.x, b.z, near(a.x, a.z))).toBeNull();
  });

  it('is blocked across the inside of a curve', () => {
    // Find two centre-line points ~40 m apart along the track whose chord leaves the corridor.
    let found = false;
    for (let s = 0; s < track.length && !found; s += 5) {
      const a = sampleAt(track, s);
      const b = sampleAt(track, s + 45);
      const f = blockedAt(track, a.x, a.z, b.x, b.z, near(a.x, a.z));
      if (f !== null) {
        expect(f).toBeGreaterThan(0);
        expect(f).toBeLessThan(1);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});
