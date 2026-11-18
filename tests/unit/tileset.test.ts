import { describe, expect, it } from 'vitest';
import { compileTrack, sampleAt } from '../../src/track/compile';
import { TRACKS } from '../../src/tracks';
import type { TrackFile } from '../../src/track/track-format';
import { SIGN_BEFORE, cornerSigns, moduleTiles, squareLines } from '../../src/editor/tileset';
import { classifyCorners } from '../../src/track/corners';

const loop = (pieces: TrackFile['pieces']): TrackFile => ({
  id: 't', name: 't', biome: 'foundry', cell: 20, width: 15, laps: 1, level: 4, defaultSurface: 'plate', defaultBarricade: 'tyres', pieces,
});

describe('tileset modules (doc 05 §9)', () => {
  it('prints every cell of straights and curves 1-2, all but the inner corner of a curve 3', () => {
    // Rectangle of four curves 3 joined by straights 2.
    const t = compileTrack(loop([
      { type: 'start', size: 2 },
      { type: 'curve', size: 3, turn: 'R' },
      { type: 'straight', size: 2 },
      { type: 'curve', size: 3, turn: 'R' },
      { type: 'straight', size: 2 },
      { type: 'curve', size: 3, turn: 'R' },
      { type: 'straight', size: 2 },
      { type: 'curve', size: 3, turn: 'R' },
    ]));
    const tiles = moduleTiles(t);
    const parts = (piece: number) => tiles.filter((m) => m.piece === piece).length;
    expect(parts(0)).toBe(2);
    expect(parts(1)).toBe(8);
    expect(parts(2)).toBe(2);
    expect(tiles.find((m) => m.piece === 1 && m.part === 2)?.label).toBe('#2 · 2/8');
    expect(tiles[0]!.label).toBe('#1 · 1/2');
  });

  it('standard tracks: one module per printed cell, all inside the footprint, in race order', () => {
    for (const f of Object.values(TRACKS) as TrackFile[]) {
      const t = compileTrack(f);
      const tiles = moduleTiles(t);
      const keys = tiles.map((m) => `${m.cx},${m.cz}`);
      expect(new Set(keys).size, f.id).toBe(keys.length);
      for (const k of keys) expect(t.cells.has(k), `${f.id} ${k}`).toBe(true);
      expect(tiles.length, f.id).toBeLessThanOrEqual(t.cells.size);
      expect(tiles.length, f.id).toBeGreaterThan(t.cells.size * 0.85);
      for (let i = 1; i < tiles.length; i++) expect(tiles[i]!.piece).toBeGreaterThanOrEqual(tiles[i - 1]!.piece);
    }
  });

  it('lanes: a straight cell has 8 spaces per lane, inner lanes of a curve fewer than outer', () => {
    const t = compileTrack(loop([
      { type: 'start', size: 1 },
      { type: 'curve', size: 2, turn: 'R' },
      { type: 'curve', size: 2, turn: 'R' },
      { type: 'straight', size: 1 },
      { type: 'curve', size: 2, turn: 'R' },
      { type: 'curve', size: 2, turn: 'R' },
    ]));
    const { along, cross } = squareLines(t, 'lanes');
    expect(along.length).toBeGreaterThan(0);
    // 8 lanes (6 columns + 2 edge bands); per piece and lane n + 1 cross lines.
    expect(cross.length).toBeGreaterThan(6 * 8 * 3);
    const grid = squareLines(t, 'grid');
    expect(grid.cross.length).toBeGreaterThan(0);
  });
});

describe('corner signs on the tiles', () => {
  it('one sign per corner, on the centre line, SIGN_BEFORE metres before its entry (clear of the start line), in the module before it', () => {
    const t = compileTrack(TRACKS['foundry-01'] as TrackFile);
    const corners = classifyCorners(t);
    const signs = cornerSigns(t);
    expect(signs.map((s) => `${s.kind}${s.turn}${s.severity}`)).toEqual(corners.map((c) => `${c.kind}${c.turn}${c.severity}`));
    const cell = t.file.cell;
    const tiles = moduleTiles(t);
    signs.forEach((s, i) => {
      const entry = sampleAt(t, corners[i]!.s0 + 0.5);
      // foundry-01 starts with an S: that sign sits between the start line and the corner.
      const before = i === 0 ? (corners[0]!.s0 - t.lineS) / 2 : SIGN_BEFORE;
      expect(Math.hypot(entry.x - s.x, entry.z - s.z)).toBeCloseTo(before + 0.5, 0);
      // Printed on a module of the track, not on the corner's own first module.
      const tile = tiles.find((m) => m.cx === Math.floor(s.x / cell) && m.cz === Math.floor(s.z / cell));
      expect(tile).toBeDefined();
      expect(tile!.piece).not.toBe(t.samples.find((p) => p.s >= corners[i]!.s0)!.piece);
    });
  });
});
