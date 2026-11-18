/**
 * Tabletop tileset (doc 05 §9, phase E4): which module tiles a track prints and the squares drawn
 * on them. Pure (no DOM, no GPU): the renderer (`tileset-render.ts`) draws what this computes.
 *
 * - One module tile (16 × 16 cm, 8 × 8 squares) per grid cell of each piece, numbered in race
 *   order: `#7` for a one-cell piece, `#7 · 2/3` for the cells of a longer one (in travel order).
 * - Cells of a piece that the road and its edge bands do not touch are not printed (the inner
 *   corner of a big curve).
 */
import { type CompiledTrack, type TrackSample, sampleAt } from '../track/compile';
import { type CornerKind, classifyCorners } from '../track/corners';
import type { Turn } from '../track/track-format';
import { EDGE_SQUARES, ROAD_SQUARES, SQUARE } from '../track/units';

export interface ModuleTile {
  /** Piece index in the chain (0-based). */
  piece: number;
  /** 1-based position of this cell in the piece (travel order) and the piece's printed cell count. */
  part: number;
  parts: number;
  /** Grid cell (compiler cells: floor(X / cell)). */
  cx: number;
  cz: number;
  /** Level of the piece (from the editor chain; 0 without one). */
  level: number;
  label: string;
}

/** How squares are printed on curves (playtest option, doc 05 §9). */
export type SquareMode = 'grid' | 'lanes';

/** A line segment on the ground (world metres). */
export type Seg = [x0: number, z0: number, x1: number, z1: number];

const right = (p: TrackSample) => ({ x: -p.tz, z: p.tx });
const at = (p: TrackSample, lat: number) => {
  const r = right(p);
  return { x: p.x + r.x * lat, z: p.z + r.z * lat };
};

/** Lateral reach of the printed road: road + edge bands (a hair inside, so a straight stays in its cell). */
export const BAND = ROAD_SQUARES * SQUARE / 2 + EDGE_SQUARES * SQUARE;

/** Module tiles of a compiled track, in race order. `levels[i]` = level of piece i (optional). */
export function moduleTiles(track: CompiledTrack, levels: readonly number[] = []): ModuleTile[] {
  const cell = track.file.cell;
  const reach = BAND - 0.25;
  // First sample index at which each (piece, cell) is touched: travel order of the cells.
  const first = new Map<string, { piece: number; cx: number; cz: number; i: number }>();
  track.samples.forEach((p, i) => {
    for (let lat = -reach; lat <= reach + 1e-9; lat += reach / 8) {
      const q = at(p, lat);
      const cx = Math.floor(q.x / cell);
      const cz = Math.floor(q.z / cell);
      const key = `${p.piece}:${cx},${cz}`;
      if (!first.has(key)) first.set(key, { piece: p.piece, cx, cz, i });
    }
  });
  const byPiece = new Map<number, { cx: number; cz: number; i: number }[]>();
  for (const v of first.values()) {
    // Only cells of the piece's own footprint: at a joint the edge band reaches into the next piece.
    if (track.cellPiece.get(`${v.cx},${v.cz}`) !== v.piece) continue;
    const list = byPiece.get(v.piece) ?? [];
    list.push(v);
    byPiece.set(v.piece, list);
  }
  const out: ModuleTile[] = [];
  const pieces = [...byPiece.keys()].sort((a, b) => a - b);
  for (const piece of pieces) {
    const cells = byPiece.get(piece)!.sort((a, b) => a.i - b.i);
    cells.forEach((c, k) => {
      const n = piece + 1;
      out.push({
        piece,
        part: k + 1,
        parts: cells.length,
        cx: c.cx,
        cz: c.cz,
        level: levels[piece] ?? 0,
        label: cells.length > 1 ? `#${n} · ${k + 1}/${cells.length}` : `#${n}`,
      });
    });
  }
  return out;
}

/** Lateral bounds of the printed lanes: edge band, 6 columns, edge band (m, + = right). */
export function laneBounds(halfWidth: number): number[] {
  const edge = EDGE_SQUARES * SQUARE;
  return [-halfWidth - edge, ...Array.from({ length: ROAD_SQUARES + 1 }, (_, k) => -halfWidth + k * SQUARE), halfWidth + edge];
}

/**
 * Squares as line segments (world metres).
 * - Lines along the road at every lane bound (both modes: the column and edge-band borders).
 * - `lanes`: each lane of each piece split into spaces about one square long along its own arc
 *   (inner lanes of a curve get fewer spaces); on straights this is the module grid.
 * - `grid`: the cross lines are the module's square grid (every 2.5 m on X and Z), to be clipped
 *   to the road band by the caller (`roadOutline`).
 */
export function squareLines(track: CompiledTrack, mode: SquareMode): { along: Seg[]; cross: Seg[] } {
  const S = track.samples;
  const bounds = laneBounds(track.halfWidth);
  const along: Seg[] = [];
  for (let i = 0; i < S.length; i++) {
    const a = S[i]!;
    const b = S[(i + 1) % S.length]!;
    if (a.feature === 'gap' || b.feature === 'gap') continue;
    for (const o of bounds) {
      const p = at(a, o);
      const q = at(b, o);
      along.push([p.x, p.z, q.x, q.z]);
    }
  }
  const cross: Seg[] = [];
  if (mode === 'grid') {
    const cell = track.file.cell;
    const b = track.bounds;
    const x0 = Math.floor((b.minX - cell) / SQUARE) * SQUARE;
    const x1 = Math.ceil((b.maxX + cell) / SQUARE) * SQUARE;
    const z0 = Math.floor((b.minZ - cell) / SQUARE) * SQUARE;
    const z1 = Math.ceil((b.maxZ + cell) / SQUARE) * SQUARE;
    for (let x = x0; x <= x1 + 1e-9; x += SQUARE) cross.push([x, z0, x, z1]);
    for (let z = z0; z <= z1 + 1e-9; z += SQUARE) cross.push([x0, z, x1, z]);
    return { along, cross };
  }
  // Lanes: per piece and per lane, equal spaces along the lane's arc.
  const ranges = pieceRanges(S);
  for (const [i0, i1] of ranges) {
    for (let k = 0; k + 1 < bounds.length; k++) {
      const lo = bounds[k]!;
      const hi = bounds[k + 1]!;
      const mid = (lo + hi) / 2;
      // Cumulative arc length of the lane centre along the piece samples.
      const cum = [0];
      for (let i = i0; i < i1; i++) {
        const p = at(S[i]!, mid);
        const q = at(S[i + 1]!, mid);
        cum.push(cum[cum.length - 1]! + Math.hypot(q.x - p.x, q.z - p.z));
      }
      const L = cum[cum.length - 1]!;
      const n = Math.max(1, Math.round(L / SQUARE));
      for (let j = 0; j <= n; j++) {
        const d = (j / n) * L;
        let m = 1;
        while (m < cum.length - 1 && cum[m]! < d) m++;
        const u = cum[m]! > cum[m - 1]! ? (d - cum[m - 1]!) / (cum[m]! - cum[m - 1]!) : 0;
        const pa = S[i0 + m - 1]!;
        const pb = S[i0 + m]!;
        if (pa.feature === 'gap' && pb.feature === 'gap') continue;
        const lerp = (lat: number) => {
          const p = at(pa, lat);
          const q = at(pb, lat);
          return { x: p.x + (q.x - p.x) * u, z: p.z + (q.z - p.z) * u };
        };
        const p = lerp(lo);
        const q = lerp(hi);
        cross.push([p.x, p.z, q.x, q.z]);
      }
    }
  }
  return { along, cross };
}

/** Sample index ranges [first, last] of each piece (the last one includes the next piece's first sample). */
function pieceRanges(S: readonly TrackSample[]): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  for (let i = 1; i <= S.length; i++) {
    if (i === S.length || S[i]!.piece !== S[start]!.piece) {
      out.push([start, Math.min(i, S.length - 1)]);
      start = i;
    }
  }
  return out;
}

/**
 * Outline of the printed road band (road + edge bands) as two rings (left and right borders): a
 * closed track gives an annulus, to be filled / clipped with the even-odd rule.
 */
export function roadOutline(track: CompiledTrack): { left: [number, number][]; right: [number, number][] } {
  const left: [number, number][] = [];
  const rightRing: [number, number][] = [];
  for (const p of track.samples) {
    const a = at(p, -BAND);
    const b = at(p, BAND);
    left.push([a.x, a.z]);
    rightRing.push([b.x, b.z]);
  }
  return { left, right: rightRing };
}

/** Corner warning printed on the road before each corner (the tabletop twin of the corner tag). */
export interface CornerSign {
  /** Centre on the centre line (world metres) and travel direction there. */
  x: number;
  z: number;
  tx: number;
  tz: number;
  kind: CornerKind;
  turn: Turn;
  severity: 1 | 2 | 3;
}

/** Distance of a sign before the corner entry (m): the end of the module before it, clear of its travel arrow. */
export const SIGN_BEFORE = 5;

/**
 * One sign per corner, `SIGN_BEFORE` metres before its entry (none over a jump gap). On the start
 * line it moves between the line and the corner.
 */
export function cornerSigns(track: CompiledTrack): CornerSign[] {
  const out: CornerSign[] = [];
  for (const c of classifyCorners(track)) {
    let s = c.s0 - SIGN_BEFORE;
    if (Math.abs(s - track.lineS) < 2) s = (track.lineS + c.s0) / 2;
    const p = sampleAt(track, s);
    if (p.feature === 'gap') continue;
    out.push({ x: p.x, z: p.z, tx: p.tx, tz: p.tz, kind: c.kind, turn: c.turn, severity: c.severity });
  }
  return out;
}
