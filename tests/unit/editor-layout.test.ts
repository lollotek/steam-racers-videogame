import { describe, expect, it } from 'vitest';
import { TRACKS } from '../../src/tracks';
import { compileTrack } from '../../src/track/compile';
import {
  type Tile,
  canPlace,
  docFromFile,
  exitSocket,
  footprint,
  mirrorPiece,
  newDoc,
  normalize,
  reverseTile,
  rotateTile,
  tilesFromChain,
  toTrackFile,
  validateDoc,
  walkChain,
} from '../../src/editor/layout';

const cellsOf = (tiles: Tile[]) =>
  new Set(tiles.flatMap((t) => footprint(t, t.piece).map((c) => `${c.x},${c.z}`)));

describe('editor layout', () => {
  for (const [id, file] of Object.entries(TRACKS)) {
    it(`round-trips ${id} (chain → tiles → chain)`, () => {
      const tiles = tilesFromChain(file.pieces);
      const chain = walkChain(tiles);
      expect(chain.problems).toEqual([]);
      expect(chain.closed).toBe(true);
      expect(chain.unconnected).toEqual([]);
      expect(chain.pieces).toEqual(file.pieces);
      // Same cells as the compiler.
      expect(cellsOf(tiles)).toEqual(compileTrack(file).cells);
      const v = validateDoc(docFromFile(file));
      expect(v.errors).toEqual([]);
      expect(v.compiled?.length).toBeCloseTo(compileTrack(file).length, 3);
    });
  }

  it('still closes when every tile is described backwards', () => {
    const file = TRACKS['rustmaw-pit']!;
    const tiles = tilesFromChain(file.pieces).map((t) => (t.piece.type === 'start' || t.piece.type === 'jump' ? t : reverseTile(t)));
    const chain = walkChain(tiles);
    expect(chain.problems).toEqual([]);
    expect(chain.closed).toBe(true);
    expect(chain.pieces).toEqual(file.pieces);
    // Normalising brings the original tiles back.
    const doc = normalize({ meta: docFromFile(file).meta, tiles });
    expect(doc.tiles.map((t) => t.piece)).toEqual(tilesFromChain(file.pieces).map((t) => t.piece));
    expect(compileTrack({ ...file, pieces: chain.pieces }).length).toBeCloseTo(compileTrack(file).length, 3);
  });

  it('mirrors pieces consistently', () => {
    const p = { type: 'curve' as const, size: 2, turn: 'L' as const, rise: 1, left: 'tyres' as const, pickups: [{ kind: 'coal' as const, at: 0.2, lane: 0.5 }], landmark: { id: 'x', side: 'L' as const, at: 0.3 } };
    const m = mirrorPiece(p);
    expect(m).toMatchObject({ turn: 'R', rise: -1, right: 'tyres', pickups: [{ at: 0.8, lane: -0.5 }], landmark: { side: 'R', at: 0.7 } });
    expect(m.left).toBeUndefined();
    expect(mirrorPiece(m)).toEqual(p);
  });

  it('reports open ends, bad rotations and unconnected tiles', () => {
    const doc = newDoc();
    const start = doc.tiles[0]!;
    let v = validateDoc(doc);
    expect(v.chain.openEnd).toEqual(exitSocket(start));
    expect(v.errors[0]!.message).toMatch(/not closed/);

    const end = exitSocket(start);
    const wrong: Tile = { id: 2, ...rotateTile(end, 1), piece: { type: 'straight', size: 1 } };
    v = validateDoc({ ...doc, tiles: [...doc.tiles, wrong] });
    expect(v.errors[0]).toMatchObject({ tileId: 2, message: expect.stringMatching(/rotate/) });

    const far: Tile = { id: 3, x: 10, z: 10, dir: 0, piece: { type: 'straight' } };
    v = validateDoc({ ...doc, tiles: [...doc.tiles, far] });
    expect(v.chain.unconnected).toEqual([3]);
    expect(canPlace(doc.tiles, { x: 0, z: 1, dir: 1, piece: { type: 'straight' } })).toBe(false);
    expect(canPlace(doc.tiles, { x: 1, z: 1, dir: 1, piece: { type: 'straight' } })).toBe(true);
  });

  it('maps compiler errors back to the tile', () => {
    const file = structuredClone(TRACKS['proving-ground']!);
    const doc = docFromFile(file);
    const victim = doc.tiles.filter((t) => t.piece.type === 'straight')[1]!;
    victim.piece.pickups = [{ kind: 'bogus' as 'coal' }];
    const v = validateDoc(doc);
    expect(v.errors).toEqual([{ tileId: victim.id, message: 'unknown pickup "bogus"' }]);
    expect(v.compiled).toBeNull();
  });

  it('saves the layout and restores it', () => {
    const doc = newDoc();
    doc.tiles.push({ id: 7, x: 5, z: -3, dir: 2, piece: { type: 'curve', size: 2, turn: 'R' } });
    const file = JSON.parse(JSON.stringify(toTrackFile(doc)));
    const back = docFromFile(file);
    expect(back.tiles.map(({ x, z, dir, piece }) => ({ x, z, dir, piece }))).toEqual(doc.tiles.map(({ x, z, dir, piece }) => ({ x, z, dir, piece })));
    expect(back.meta).toEqual(doc.meta);
  });
});
