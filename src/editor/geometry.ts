/**
 * Top-view geometry of a tile for the editor grid (cell units, world X/Z).
 * Screen mapping used by the grid: sx = −X, sy = −Z (north up, the driver's right on the right).
 */
import { type Piece, type Barricade, type Surface, JUMP, asArray } from '../track/track-format';
import { FWD, type Socket, pieceSize } from './layout';

export interface PathPoint {
  x: number;
  z: number;
  /** Unit tangent. */
  tx: number;
  tz: number;
}

/** Centre line of the piece, `n` + 1 points from entry to exit. */
export function centreline(t: Socket & { piece: Piece }, n = 24): PathPoint[] {
  const f = FWD[t.dir]!;
  const ex = t.x + 0.5 - f.x * 0.5;
  const ez = t.z + 0.5 - f.z * 0.5;
  const size = pieceSize(t.piece);
  const pts: PathPoint[] = [];
  if (t.piece.type === 'curve') {
    const s = FWD[t.piece.turn === 'L' ? (t.dir + 1) % 4 : (t.dir + 3) % 4]!;
    const r = size - 0.5;
    const cx = ex + s.x * r;
    const cz = ez + s.z * r;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * (Math.PI / 2);
      const c = Math.cos(a);
      const sn = Math.sin(a);
      pts.push({ x: cx - s.x * r * c + f.x * r * sn, z: cz - s.z * r * c + f.z * r * sn, tx: f.x * c + s.x * sn, tz: f.z * c + s.z * sn });
    }
  } else {
    const k = t.piece.type === 'start' || t.piece.type === 'jump' ? n : Math.max(2, size * 2);
    for (let i = 0; i <= k; i++) pts.push({ x: ex + f.x * size * (i / k), z: ez + f.z * size * (i / k), tx: f.x, tz: f.z });
  }
  return pts;
}

/** Point at fraction u (0..1) of a polyline, offset sideways by `lat` cells (+ = driver's right). */
export function pointAt(pts: PathPoint[], u: number, lat = 0): { x: number; z: number; tx: number; tz: number } {
  const f = Math.min(1, Math.max(0, u)) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const k = f - i;
  const a = pts[i]!;
  const b = pts[i + 1]!;
  const tx = a.tx + (b.tx - a.tx) * k;
  const tz = a.tz + (b.tz - a.tz) * k;
  const l = Math.hypot(tx, tz) || 1;
  // Driver's right of tangent t is (−tz, tx).
  return { x: a.x + (b.x - a.x) * k + (-tz / l) * lat, z: a.z + (b.z - a.z) * k + (tx / l) * lat, tx: tx / l, tz: tz / l };
}

/** SVG path data of the polyline (between fractions u0..u1), offset sideways. */
export function pathD(pts: PathPoint[], lat = 0, u0 = 0, u1 = 1): string {
  const out: string[] = [];
  const n = pts.length - 1;
  const steps = Math.max(1, Math.ceil((u1 - u0) * n));
  for (let i = 0; i <= steps; i++) {
    const p = pointAt(pts, u0 + ((u1 - u0) * i) / steps, lat);
    out.push(`${i ? 'L' : 'M'}${(-p.x).toFixed(3)} ${(-p.z).toFixed(3)}`);
  }
  return out.join('');
}

/** Jump: fractions of the piece where the gap starts and ends. */
export function jumpGap(piece: Piece, cell: number): [number, number] {
  const len = pieceSize(piece) * cell;
  return [JUMP.kicker / len, (len - JUMP.landing) / len];
}

export const SURFACE_COLOR: Record<Surface, string> = {
  plate: '#8d867e',
  grate: '#5f656b',
  dirt: '#8b6a45',
  sand: '#c9a66b',
  oil: '#2c2522',
  water: '#3f6f8f',
  flagstone: '#a49b8b',
  rails: '#6e5a4a',
  cobble: '#8f8273',
  scrap: '#7a5a40',
  mud: '#5a4630',
  heartwood: '#9a6a42',
  moss: '#5f7a45',
};

export const BARRICADE_COLOR: Record<Barricade, string> = {
  earth: '#7a5a3a',
  riveted: '#b8bec4',
  hedgehog: '#d0453a',
  corrugated: '#9fb0b8',
  sandbags: '#d8c08a',
  barbed: '#e86a6a',
  stone: '#c8c0b0',
  runepylon: '#5fd0ff',
  ironrail: '#7d8a96',
  wreckwall: '#c07a3a',
  tyres: '#303030',
  roots: '#6a8a3a',
  crystal: '#b88cff',
};

export const HAZARD_LETTER = { vent: 'V', crossing: 'X', crane: 'C', stream: 'S' } as const;

export { asArray };
