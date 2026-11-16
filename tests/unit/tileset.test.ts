import { describe, expect, it } from 'vitest';
import { compileTrack } from '../../src/track/compile';
import { TRACKS } from '../../src/tracks';
import type { TrackFile } from '../../src/track/track-format';
import { moduleTiles, squareLines } from '../../src/editor/tileset';

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
