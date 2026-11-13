import { describe, expect, it } from 'vitest';
import { TrackError, compileTrack, sampleAt } from '../../src/track/compile';
import type { TrackFile } from '../../src/track/track-format';
import foundry from '../../src/tracks/foundry-01.json';

const base = (pieces: TrackFile['pieces']): TrackFile => ({
  id: 't', name: 't', biome: 'foundry', cell: 20, width: 14, laps: 3, defaultSurface: 'plate', defaultBarricade: 'riveted', pieces,
});
const square = base([
  { type: 'start', size: 2 },
  { type: 'curve', size: 2, turn: 'R' },
  { type: 'straight', size: 1 },
  { type: 'curve', size: 2, turn: 'R' },
  { type: 'straight', size: 2 },
  { type: 'curve', size: 2, turn: 'R' },
  { type: 'straight', size: 1 },
  { type: 'curve', size: 2, turn: 'R' },
]);

describe('track compiler', () => {
  it('compiles the foundry track: closed, continuous, sensible length', () => {
    const t = compileTrack(foundry as TrackFile);
    expect(t.length).toBeGreaterThan(400);
    expect(t.length).toBeLessThan(900);
    // Continuity: consecutive samples ~1 m apart, including the wrap-around.
    const n = t.samples.length;
    for (let i = 0; i < n; i++) {
      const a = t.samples[i]!;
      const b = t.samples[(i + 1) % n]!;
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(1.6);
    }
    expect(t.checkpoints).toHaveLength((foundry as TrackFile).pieces.length);
    expect(t.spawn).toHaveLength(8);
  });

  it('a 4-right-turn loop closes; tangents are unit length', () => {
    const t = compileTrack(square);
    for (const s of t.samples) expect(Math.hypot(s.tx, s.tz)).toBeCloseTo(1, 5);
  });

  it('right turns turn to the driver right (heading decreases)', () => {
    const t = compileTrack(square);
    const a = sampleAt(t, (2 * 20) + 1); // just inside the first curve
    const b = sampleAt(t, (2 * 20) + 30);
    const ha = Math.atan2(a.tx, a.tz);
    const hb = Math.atan2(b.tx, b.tz);
    expect(hb).toBeLessThan(ha);
  });

  it('rejects open tracks, overlaps and missing start', () => {
    expect(() => compileTrack(base([{ type: 'start', size: 2 }, { type: 'straight' }]))).toThrow(TrackError);
    expect(() => compileTrack(base([{ type: 'straight' }]))).toThrow(/start/);
    expect(() =>
      compileTrack(base([{ type: 'start' }, { type: 'curve', size: 1, turn: 'R' }, { type: 'curve', size: 1, turn: 'R' }, { type: 'curve', size: 1, turn: 'R' }, { type: 'curve', size: 1, turn: 'R' }, { type: 'straight' }])),
    ).toThrow(TrackError);
  });

  it('spawn slots are on the track, behind the line, facing along it', () => {
    const t = compileTrack(foundry as TrackFile);
    for (const sp of t.spawn) {
      const near = t.samples.reduce((m, s) => Math.min(m, Math.hypot(s.x - sp.x, s.z - sp.z)), Infinity);
      expect(near).toBeLessThan(t.halfWidth);
      expect(sp.heading).toBeCloseTo(0, 5);
    }
  });

  it('sampleAt wraps around the lap', () => {
    const t = compileTrack(square);
    const a = sampleAt(t, 5);
    const b = sampleAt(t, 5 + t.length);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.z).toBeCloseTo(b.z, 6);
  });
});
