import { describe, expect, it } from 'vitest';
import { compileTrack } from '../../src/track/compile';
import { type Corner, classifyCorners, cornerCue, gearForRadius } from '../../src/track/corners';
import type { Piece, TrackFile } from '../../src/track/track-format';
import foundry from '../../src/tracks/foundry-01.json';
import cinderholme from '../../src/tracks/cinderholme-station.json';

const CELL = 20;
/** A fake track from piece lengths only (classification needs no geometry). */
function fake(pieces: Piece[]) {
  const len = (p: Piece) => (p.type === 'curve' ? (Math.PI / 2) * ((p.size ?? 1) - 0.5) * CELL : (p.size ?? 1) * CELL);
  const checkpoints: number[] = [];
  let s = 0;
  for (const p of pieces) {
    checkpoints.push(s);
    s += len(p);
  }
  return { file: { pieces, cell: CELL }, checkpoints, length: s };
}
const kinds = (cs: Corner[]) => cs.map((c) => `${c.kind}:${c.bends.map((b) => b.turn + b.angle).join('/')}`);
const opts = { sGap: 20 };
const start: Piece = { type: 'start', size: 3 };
const st = (size = 1): Piece => ({ type: 'straight', size });
const cv = (turn: 'L' | 'R', size = 1): Piece => ({ type: 'curve', turn, size });

describe('corner classification', () => {
  it('reads wide, tight and hairpin bends off the curve sizes', () => {
    const t = fake([start, cv('R', 2), st(3), cv('L'), st(3), cv('R'), cv('R'), st(3), cv('R', 3), cv('R', 3)]);
    expect(kinds(classifyCorners(t, opts))).toEqual(['wide:R90', 'tight:L90', 'hairpin:R180', 'wide:R180']);
    expect(classifyCorners(t, opts).map((c) => c.severity)).toEqual([1, 2, 3, 1]);
  });

  it('joins opposite bends with a short straight (or none) into an S, not same-direction ones', () => {
    const t = fake([start, cv('L'), cv('R'), st(1), cv('R', 2), st(1), cv('L'), cv('R'), st(2), cv('L')]);
    expect(kinds(classifyCorners(t, opts))).toEqual(['s:L90/R90', 's:R90/L90/R90', 'tight:L90']);
  });

  it('a jump between two bends breaks the S', () => {
    const t = fake([start, cv('L'), { type: 'jump', size: 1 }, cv('R')]);
    expect(kinds(classifyCorners(t, opts))).toEqual(['tight:L90', 'tight:R90']);
  });

  it('an S takes the severity and radius of its worst bend', () => {
    const [c] = classifyCorners(fake([start, cv('L', 3), cv('R')]), opts);
    expect(c!.kind).toBe('s');
    expect(c!.severity).toBe(2);
    expect(c!.minRadius).toBe(10);
  });

  it('classifies the real tracks', () => {
    const f = compileTrack(foundry as TrackFile);
    expect(kinds(classifyCorners(f, opts))).toEqual(['s:L90/R90', 'wide:R90', 's:R90/L90/R90', 'wide:R90', 'wide:R90']);
    const c = compileTrack(cinderholme as TrackFile);
    expect(classifyCorners(c, opts).map((k) => k.kind)).toEqual(['tight', 'tight', 'tight', 'wide', 's', 'wide']);
    // Corners lie on the lap, in order.
    for (const k of classifyCorners(c, opts)) expect(k.s0).toBeLessThan(k.s1);
  });
});

describe('advised gear', () => {
  it('is the highest gear whose top speed is safe on the radius', () => {
    // Top speed 32 m/s, gears 6.4 / 11.2 / 16 / 20.8 / 26.2 / 32; v = √(14·r).
    expect(gearForRadius(10, 32, 14)).toBe(2);
    expect(gearForRadius(50, 32, 14)).toBe(5);
    expect(gearForRadius(1000, 32, 14)).toBe(6);
    expect(gearForRadius(0.1, 32, 14)).toBe(1);
  });
});

describe('corner cue', () => {
  const t = fake([start, st(5), cv('R'), st(5), cv('L', 2), cv('R', 2), st(5)]);
  const corners = classifyCorners(t, opts);
  const cue = { leadTime: 2.5, minLead: 25, maxLead: 90 };
  const [tight, s] = corners as [Corner, Corner];

  it('announces the next corner only within the lead distance (speed × time, clamped)', () => {
    expect(cornerCue(corners, t.length, tight.s0 - 60, 20, cue)).toBeNull(); // lead 50 m
    const c = cornerCue(corners, t.length, tight.s0 - 40, 20, cue)!;
    expect(c.corner).toBe(tight);
    expect(c.dist).toBeCloseTo(40);
    expect(c.near).toBeCloseTo(0.2);
    expect(cornerCue(corners, t.length, tight.s0 - 20, 4, cue)!.corner).toBe(tight); // min lead 25 m
  });

  it('is silent when stopped or reversing', () => {
    expect(cornerCue(corners, t.length, tight.s0 - 10, 0, cue)).toBeNull();
    expect(cornerCue(corners, t.length, tight.s0 - 10, -5, cue)).toBeNull();
  });

  it('inside an S shows the bend still to come, then hides', () => {
    const first = s.bends[0]!;
    const c = cornerCue(corners, t.length, first.s0 + 5, 20, cue)!;
    expect(c.inside).toBe(true);
    expect(c.bend).toBe(1);
    expect(c.dist).toBeCloseTo(first.s1 - first.s0 - 5);
    expect(cornerCue(corners, t.length, s.bends[1]!.s0 + 5, 20, cue)).toBeNull();
  });

  it('inside a single corner it looks ahead to the next one', () => {
    const near = cornerCue(corners, t.length, tight.s1 - 1, 40, cue)!; // lead 90 m, S starts 101 m later
    expect(near).toBeNull();
    const t2 = fake([start, cv('R'), st(1), cv('R', 2), st(5)]);
    const cs = classifyCorners(t2, opts);
    expect(cornerCue(cs, t2.length, cs[0]!.s0 + 2, 20, cue)!.corner).toBe(cs[1]);
  });

  it('wraps round the lap', () => {
    const t3 = fake([{ type: 'start', size: 1 }, cv('R'), cv('R'), st(2), cv('R'), cv('R')]);
    const cs = classifyCorners(t3, opts);
    // In the last corner, 5 m before the line: the first corner is 25 m ahead.
    const c = cornerCue(cs, t3.length, t3.length - 5, 20, cue)!;
    expect(c.corner).toBe(cs[0]);
    expect(c.dist).toBeCloseTo(25);
  });
});
