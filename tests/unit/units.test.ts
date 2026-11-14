import { describe, expect, it } from 'vitest';
import { CELL, LANE_REACH, ROAD_SQUARES, SQUARE, WIDTH, boundOfLine, columnOfLane, laneOfColumn, lineOfBound } from '../../src/track/units';
import { compileTrack } from '../../src/track/compile';
import { tabletopProblems } from '../../src/track/rules';
import { HAZARD_PRESETS } from '../../src/track/hazards';
import { TRACKS } from '../../src/tracks';
import type { TrackFile } from '../../src/track/track-format';

/** Tabletop grid (doc 05 §2). */
describe('tabletop grid', () => {
  it('a cell is 8 × 8 squares of 2.5 m, the road 6 squares', () => {
    expect(CELL).toBe(20);
    expect(WIDTH).toBe(15);
    expect(CELL - WIDTH).toBe(2 * SQUARE);
  });

  it('crate lanes land on column centres', () => {
    const hw = WIDTH / 2;
    for (let c = 0; c < ROAD_SQUARES; c++) {
      expect(columnOfLane(laneOfColumn(c))).toBe(c);
      const lateral = laneOfColumn(c) * hw * LANE_REACH;
      expect(lateral).toBeCloseTo(-hw + (c + 0.5) * SQUARE, 9);
    }
    expect(columnOfLane(0)).toBe(3);
  });

  it('hazard bounds land on column lines', () => {
    for (let b = 0; b <= ROAD_SQUARES; b++) {
      expect(lineOfBound(boundOfLine(b))).toBe(b);
      expect(boundOfLine(b) * (WIDTH / 2)).toBeCloseTo(-WIDTH / 2 + b * SQUARE, 9);
    }
    for (const p of Object.values(HAZARD_PRESETS)) {
      expect(p.length / SQUARE).toBeCloseTo(Math.round(p.length / SQUARE), 9);
      for (const v of p.lanes) expect(boundOfLine(lineOfBound(v))).toBeCloseTo(v, 9);
    }
  });

  it('every standard track follows the grid', () => {
    for (const t of Object.values(TRACKS) as TrackFile[]) expect(tabletopProblems(t), t.id).toEqual([]);
  });

  it('reports tracks off the grid', () => {
    const t = structuredClone(Object.values(TRACKS)[0]) as TrackFile;
    t.width = 14;
    t.pieces[0]!.pickups = [{ kind: 'coal', lane: 0 }];
    const p = tabletopProblems(compileTrack(t).file);
    expect(p.some((m) => m.includes('width 14'))).toBe(true);
    expect(p.some((m) => m.includes('not on a column'))).toBe(true);
  });

  it('the start grid sits on columns 2 and 5', () => {
    const t = compileTrack(Object.values(TRACKS)[0] as TrackFile);
    const lat = (i: number) => {
      const s = t.spawn[i]!;
      // Lateral offset from the closest sample.
      const near = t.samples.reduce((b, p) => (Math.hypot(p.x - s.x, p.z - s.z) < Math.hypot(b.x - s.x, b.z - s.z) ? p : b));
      return (s.x - near.x) * -near.tz + (s.z - near.z) * near.tx;
    };
    expect(Math.abs(lat(0))).toBeCloseTo(1.5 * SQUARE, 1);
    expect(Math.abs(lat(1))).toBeCloseTo(1.5 * SQUARE, 1);
  });
});
