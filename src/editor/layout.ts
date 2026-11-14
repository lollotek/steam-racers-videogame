/**
 * Tile layout model of the track editor (doc 05 §4). Pure data + grid math: no DOM, runs in Node.
 *
 * Tiles are placed freely on the grid; the track is the chain found by walking from the start tile
 * through the connected sockets. Cells and directions are the compiler's (compile.ts `pieceCells`):
 * cell (x, z) spans [x·cell, (x+1)·cell) on X and Z; dir 0..3 = heading d·π/2 (0 = +Z, 1 = +X);
 * the driver's right of dir d is d − 1.
 */
import { type Piece, type TrackFile, asArray } from '../track/track-format';
import { compileTrack, TrackError, type CompiledTrack } from '../track/compile';
import { checkTrack, type TrackReport } from '../track/rules';
import { CELL, WIDTH } from '../track/units';

export type Dir = 0 | 1 | 2 | 3;
export interface Cell {
  x: number;
  z: number;
}
/** Enter cell (x, z) heading `dir`. */
export interface Socket extends Cell {
  dir: Dir;
}
export interface Tile extends Socket {
  id: number;
  piece: Piece;
}
export type TrackMeta = Omit<TrackFile, 'pieces' | 'editor'>;
export interface EditorDoc {
  meta: TrackMeta;
  tiles: Tile[];
}

/** Forward unit vector of each direction, in cells. */
export const FWD: readonly Cell[] = [
  { x: 0, z: 1 },
  { x: 1, z: 0 },
  { x: 0, z: -1 },
  { x: -1, z: 0 },
];
export const rightOf = (d: Dir): Dir => ((d + 3) % 4) as Dir;
export const leftOf = (d: Dir): Dir => ((d + 1) % 4) as Dir;
export const backOf = (d: Dir): Dir => ((d + 2) % 4) as Dir;
const step = (a: Cell, d: Dir, k = 1): Cell => ({ x: a.x + FWD[d]!.x * k, z: a.z + FWD[d]!.z * k });
export const cellKey = (c: Cell) => `${c.x},${c.z}`;
const sameSocket = (a: Socket, b: Socket) => a.x === b.x && a.z === b.z && a.dir === b.dir;

export const pieceSize = (p: Piece) => Math.max(1, Math.round(p.size ?? 1));
/** Side a curve turns towards (as a direction). */
const turnDir = (d: Dir, p: Piece): Dir => (p.turn === 'L' ? leftOf(d) : rightOf(d));

/** Cells covered by a piece entering cell `at` heading `dir` (same cells as compile.ts). */
export function footprint(at: Socket, p: Piece): Cell[] {
  const n = pieceSize(p);
  const out: Cell[] = [];
  if (p.type === 'curve') {
    const side = turnDir(at.dir, p);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push(step(step(at, at.dir, i), side, j));
  } else {
    for (let i = 0; i < n; i++) out.push(step(at, at.dir, i));
  }
  return out;
}

/** Where the track goes after the tile (the next cell and heading). */
export function exitSocket(t: Socket & { piece: Piece }): Socket {
  const n = pieceSize(t.piece);
  if (t.piece.type === 'curve') {
    const side = turnDir(t.dir, t.piece);
    return { ...step(step(t, t.dir, n - 1), side, n), dir: side };
  }
  return { ...step(t, t.dir, n), dir: t.dir };
}

/** Socket at which the tile is entered when driven backwards. */
export function reverseEntry(t: Socket & { piece: Piece }): Socket {
  const ex = exitSocket(t);
  return { ...step(ex, backOf(ex.dir)), dir: backOf(ex.dir) };
}

/** Position along the piece seen from the other end (the default 0.5 stays implicit). */
const mirrorAt = <T extends { at?: number }>(o: T): T => (o.at === undefined ? o : { ...o, at: Math.round((1 - o.at) * 1e6) / 1e6 });

/** The piece as seen driving it the other way. */
export function mirrorPiece(p: Piece): Piece {
  const q: Piece = structuredClone(p);
  if (q.type === 'curve') q.turn = q.turn === 'L' ? 'R' : 'L';
  if (q.rise) q.rise = -q.rise;
  const { left, right } = q;
  delete q.left;
  delete q.right;
  if (right !== undefined) q.left = right;
  if (left !== undefined) q.right = left;
  if (q.pickups) q.pickups = q.pickups.map((s) => mirrorAt(s.lane !== undefined ? { ...s, lane: -s.lane } : s));
  if (q.hazard) {
    const many = Array.isArray(q.hazard);
    const hz = asArray(q.hazard).map((h) => mirrorAt(h.lanes ? { ...h, lanes: [-h.lanes[1], -h.lanes[0]] as [number, number] } : h));
    q.hazard = many ? hz : hz[0]!;
  }
  if (q.landmark) {
    const many = Array.isArray(q.landmark);
    const lm = asArray(q.landmark).map((l) => mirrorAt({ ...l, side: l.side === 'L' ? ('R' as const) : ('L' as const) }));
    q.landmark = many ? lm : lm[0]!;
  }
  return q;
}

/** The same tile described in the other direction of travel (same footprint). */
export function reverseTile(t: Tile): Tile {
  const e = reverseEntry(t);
  return { id: t.id, x: e.x, z: e.z, dir: e.dir, piece: mirrorPiece(t.piece) };
}

/** Rotate a tile by 90° steps around its entry cell. */
export function rotateTile<T extends Socket>(t: T, quarter = 1): T {
  return { ...t, dir: (((t.dir + quarter) % 4) + 4) % 4 as Dir };
}

// --- Chain ↔ tiles --------------------------------------------------------------------------------

/** Lay a piece chain out on the grid: start at cell (0, 0) heading north, as the compiler does. */
export function tilesFromChain(pieces: Piece[]): Tile[] {
  let c: Socket = { x: 0, z: 0, dir: 0 };
  return pieces.map((piece, i) => {
    const t: Tile = { id: i + 1, ...c, piece: structuredClone(piece) };
    c = exitSocket(t);
    return t;
  });
}

export interface ChainStep {
  tileId: number;
  reversed: boolean;
  /** Level at the entry of the piece. */
  level: number;
}
export interface Problem {
  tileId?: number;
  message: string;
}
export interface ChainResult {
  pieces: Piece[];
  steps: ChainStep[];
  closed: boolean;
  /** Where the next tile goes when the track is open (null when closed or broken before a start). */
  openEnd: Socket | null;
  problems: Problem[];
  /** Tiles the walk never reached. */
  unconnected: number[];
}

/** Map cell → tile id; overlapping tiles are reported. */
export function occupancy(tiles: readonly Tile[]): { map: Map<string, number>; overlaps: Problem[] } {
  const map = new Map<string, number>();
  const overlaps: Problem[] = [];
  for (const t of tiles)
    for (const c of footprint(t, t.piece)) {
      const k = cellKey(c);
      const other = map.get(k);
      if (other !== undefined && other !== t.id) overlaps.push({ tileId: t.id, message: `Overlaps another tile at cell ${k}` });
      else map.set(k, t.id);
    }
  return { map, overlaps };
}

export function walkChain(tiles: readonly Tile[]): ChainResult {
  const res: ChainResult = { pieces: [], steps: [], closed: false, openEnd: null, problems: [], unconnected: [] };
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const { map, overlaps } = occupancy(tiles);
  res.problems.push(...overlaps);
  const starts = tiles.filter((t) => t.piece.type === 'start');
  if (starts.length === 0) res.problems.push({ message: 'Place a start tile' });
  if (starts.length > 1) for (const s of starts.slice(1)) res.problems.push({ tileId: s.id, message: 'Only one start tile is allowed' });
  const start = starts[0];
  if (start) {
    const visited = new Set<number>([start.id]);
    res.pieces.push(structuredClone(start.piece));
    res.steps.push({ tileId: start.id, reversed: false, level: 0 });
    let level = start.piece.rise ?? 0;
    let sock = exitSocket(start);
    for (let guard = 0; guard <= tiles.length; guard++) {
      if (sameSocket(sock, start)) {
        res.closed = true;
        break;
      }
      const id = map.get(cellKey(sock));
      if (id === undefined) {
        res.openEnd = sock;
        break;
      }
      const t = byId.get(id)!;
      if (t.id === start.id) {
        res.problems.push({ tileId: t.id, message: 'The track reaches the start from the side or from the front' });
        break;
      }
      if (visited.has(t.id)) {
        res.problems.push({ tileId: t.id, message: 'The track runs into a tile it already used' });
        break;
      }
      let piece: Piece;
      let reversed = false;
      if (sameSocket(sock, t)) piece = structuredClone(t.piece);
      else if (sameSocket(sock, reverseEntry(t))) {
        if (t.piece.type === 'jump') {
          res.problems.push({ tileId: t.id, message: 'This jump is driven backwards: reverse it (V)' });
          break;
        }
        piece = mirrorPiece(t.piece);
        reversed = true;
      } else {
        res.problems.push({ tileId: t.id, message: 'This tile does not connect to the previous one: rotate it (R)' });
        break;
      }
      visited.add(t.id);
      res.pieces.push(piece);
      res.steps.push({ tileId: t.id, reversed, level });
      level += piece.rise ?? 0;
      sock = exitSocket(reversed ? reverseTile(t) : t);
    }
    res.unconnected = tiles.filter((t) => !visited.has(t.id)).map((t) => t.id);
  } else res.unconnected = tiles.map((t) => t.id);
  return res;
}

/** Rewrite tiles driven backwards in their forward form (arrows and left/right follow the track). */
export function normalize(doc: EditorDoc): EditorDoc {
  const chain = walkChain(doc.tiles);
  const rev = new Set(chain.steps.filter((s) => s.reversed).map((s) => s.tileId));
  if (!rev.size) return doc;
  return { ...doc, tiles: doc.tiles.map((t) => (rev.has(t.id) ? reverseTile(t) : t)) };
}

/** Can the tile go there (inside the grid limits, no overlap with other tiles)? */
export function canPlace(tiles: readonly Tile[], t: Socket & { piece: Piece }, ignoreId?: number): boolean {
  const { map } = occupancy(tiles.filter((o) => o.id !== ignoreId));
  return footprint(t, t.piece).every((c) => !map.has(cellKey(c)));
}

export const nextId = (tiles: readonly Tile[]) => tiles.reduce((m, t) => Math.max(m, t.id), 0) + 1;

// --- Validation ------------------------------------------------------------------------------------

export interface Validation {
  chain: ChainResult;
  /** Errors that stop the track from being raced (structure, compiler). */
  errors: Problem[];
  compiled: CompiledTrack | null;
  report: TrackReport | null;
}

export function toTrackFile(doc: EditorDoc, chain = walkChain(doc.tiles), withLayout = true): TrackFile {
  const file: TrackFile = { ...structuredClone(doc.meta), pieces: chain.pieces };
  if (withLayout) file.editor = { version: 1, tiles: doc.tiles.map(({ x, z, dir, piece }) => ({ x, z, dir, piece: structuredClone(piece) })) };
  return file;
}

export function validateDoc(doc: EditorDoc): Validation {
  const chain = walkChain(doc.tiles);
  const errors = [...chain.problems];
  if (!errors.length && !chain.closed && chain.openEnd) errors.push({ message: 'The track is not closed: continue from the open end' });
  let compiled: CompiledTrack | null = null;
  let report: TrackReport | null = null;
  if (!errors.length) {
    try {
      compiled = compileTrack(toTrackFile(doc, chain, false));
      report = checkTrack(compiled);
    } catch (e) {
      const msg = (e as Error).message;
      if (!(e instanceof TrackError)) console.error(e);
      const m = /Piece (\d+)/.exec(msg);
      const step = m ? chain.steps[Number(m[1])] : undefined;
      errors.push({ tileId: step?.tileId, message: msg.replace(/Piece \d+(?: \(\w+\))?:? ?/, '') || msg });
    }
  }
  return { chain, errors, compiled, report };
}

// --- Documents -------------------------------------------------------------------------------------

export function defaultMeta(): TrackMeta {
  return {
    id: 'new-track',
    name: 'New Track',
    biome: 'foundry',
    cell: CELL,
    width: WIDTH,
    laps: 3,
    level: 4,
    defaultSurface: 'plate',
    defaultBarricade: 'riveted',
  };
}

export function newDoc(): EditorDoc {
  return { meta: defaultMeta(), tiles: [{ id: 1, x: 0, z: 0, dir: 0, piece: { type: 'start', size: 3 } }] };
}

const isDir = (v: unknown): v is Dir => v === 0 || v === 1 || v === 2 || v === 3;

/** Read a track file (with or without the editor layout). Throws on files that are not tracks. */
export function docFromFile(raw: unknown): EditorDoc {
  if (!raw || typeof raw !== 'object') throw new Error('Not a track file');
  const f = raw as Partial<TrackFile>;
  if (!Array.isArray(f.pieces)) throw new Error('Not a track file: "pieces" is missing');
  const d = defaultMeta();
  const meta: TrackMeta = {
    id: typeof f.id === 'string' && f.id ? f.id : d.id,
    name: typeof f.name === 'string' && f.name ? f.name : d.name,
    biome: typeof f.biome === 'string' ? f.biome : d.biome,
    cell: typeof f.cell === 'number' ? f.cell : d.cell,
    width: typeof f.width === 'number' ? f.width : d.width,
    laps: typeof f.laps === 'number' ? f.laps : d.laps,
    level: typeof f.level === 'number' ? f.level : d.level,
    defaultSurface: f.defaultSurface ?? d.defaultSurface,
    defaultBarricade: f.defaultBarricade ?? d.defaultBarricade,
  };
  const layout = f.editor?.tiles;
  if (Array.isArray(layout) && layout.every((t) => t && Number.isInteger(t.x) && Number.isInteger(t.z) && isDir(t.dir) && t.piece?.type)) {
    return { meta, tiles: layout.map((t, i) => ({ id: i + 1, x: t.x, z: t.z, dir: t.dir as Dir, piece: structuredClone(t.piece) })) };
  }
  return { meta, tiles: tilesFromChain(f.pieces) };
}

/** A file name / id from a track name. */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'track';
