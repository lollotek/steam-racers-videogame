/**
 * Track compiler: block chain → runtime track data (doc 03 §7.1).
 * Coordinates: X/Z ground plane, heading 0 = +Z, the driver's right of heading h is (-cos h, sin h)
 * (consistent with the camera: steering right turns the view right).
 */
import type { Barricade, Piece, Surface, TrackFile } from './track-format';
import { tunables } from '../core/tunables';

tunables.registerGroup('race', [
  { key: 'race.gridFirst', type: 'number', default: 6, min: 2, max: 30, step: 0.5, unit: 'm', label: 'Grid: pole behind the line' },
  { key: 'race.gridRowGap', type: 'number', default: 14, min: 6, max: 30, step: 0.5, unit: 'm', label: 'Grid: distance between rows' },
  { key: 'race.gridStagger', type: 'number', default: 7, min: 0, max: 15, step: 0.5, unit: 'm', label: 'Grid: left column offset back' },
  { key: 'race.gridLateral', type: 'number', default: 0.5, min: 0.2, max: 0.7, step: 0.01, label: 'Grid: columns from centre (× half width)' },
]);

export interface TrackSample {
  x: number;
  z: number;
  /** Unit tangent. */
  tx: number;
  tz: number;
  /** Distance from the start line along the centre line. */
  s: number;
  surface: Surface;
  left: Barricade;
  right: Barricade;
  /** Signed curvature (1/m), + = turning right. */
  curvature: number;
  piece: number;
}

export interface SpawnSlot {
  x: number;
  z: number;
  heading: number;
}

export interface CompiledTrack {
  file: TrackFile;
  samples: TrackSample[];
  /** Sample spacing in metres. */
  spacing: number;
  length: number;
  halfWidth: number;
  /** Distances (s) of checkpoints (piece boundaries); used to validate laps. */
  checkpoints: number[];
  /** Distance of the start/finish line (near the end of the start piece, the grid is behind it). */
  lineS: number;
  spawn: SpawnSlot[];
  /** Occupied grid cells "cx,cz" (for validation and the future editor). */
  cells: Set<string>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export class TrackError extends Error {}

interface Cursor {
  x: number;
  z: number;
  h: number; // heading radians, multiple of π/2
}

const fwd = (h: number) => ({ x: Math.sin(h), z: Math.cos(h) });
const right = (h: number) => ({ x: -Math.cos(h), z: Math.sin(h) });
const snap = (v: number) => Math.round(v * 1e6) / 1e6;
const normAngle = (a: number) => {
  let r = a % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r;
};

/** Cells covered by a piece starting at cursor c (cell units, entry at edge midpoint). */
function pieceCells(c: Cursor, p: Piece, cell: number): string[] {
  const out: string[] = [];
  const f = fwd(c.h);
  const r = right(c.h);
  const n = p.size ?? 1;
  // Centre of the first cell = entry + half a cell forward.
  const base = { x: c.x + f.x * cell * 0.5, z: c.z + f.z * cell * 0.5 };
  const key = (x: number, z: number) => `${Math.round(x / cell - 0.5)},${Math.round(z / cell - 0.5)}`;
  if (p.type === 'curve') {
    const sgn = p.turn === 'L' ? -1 : 1;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) out.push(key(base.x + f.x * cell * i + r.x * cell * j * sgn, base.z + f.z * cell * i + r.z * cell * j * sgn));
  } else {
    for (let i = 0; i < n; i++) out.push(key(base.x + f.x * cell * i, base.z + f.z * cell * i));
  }
  return out;
}

export function compileTrack(file: TrackFile, spacing = 1): CompiledTrack {
  if (!file.pieces.length) throw new TrackError('Track has no pieces');
  if (file.pieces[0]!.type !== 'start') throw new TrackError('First piece must be "start"');
  if (file.pieces.filter((p) => p.type === 'start').length !== 1) throw new TrackError('Exactly one "start" piece is required');

  const cell = file.cell;
  // Grid origin: start entry at (cell/2, 0) so cells are aligned to multiples of `cell`.
  const c: Cursor = { x: cell / 2, z: 0, h: 0 };
  const raw: Omit<TrackSample, 's'>[] = [];
  const cells = new Set<string>();
  const checkpoints: number[] = [];
  let length = 0;

  file.pieces.forEach((p, idx) => {
    for (const k of pieceCells(c, p, cell)) {
      if (cells.has(k)) throw new TrackError(`Piece ${idx} (${p.type}) overlaps cell ${k}`);
      cells.add(k);
    }
    const surface = p.surface ?? file.defaultSurface;
    const left = p.left ?? file.defaultBarricade;
    const rightB = p.right ?? file.defaultBarricade;
    const base = { surface, left, right: rightB, piece: idx };
    checkpoints.push(length);

    if (p.type === 'curve') {
      if (p.turn !== 'L' && p.turn !== 'R') throw new TrackError(`Piece ${idx}: curve needs turn "L" or "R"`);
      const n = p.size ?? 1;
      const radius = (n - 0.5) * cell;
      const sgn = p.turn === 'R' ? 1 : -1;
      const r = right(c.h);
      // Arc centre on the inside of the turn.
      const cx = c.x + r.x * radius * sgn;
      const cz = c.z + r.z * radius * sgn;
      const arc = (Math.PI / 2) * radius;
      const steps = Math.max(2, Math.round(arc / spacing));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * (Math.PI / 2);
        const h = c.h - sgn * a; // right turn decreases heading
        // Position: rotate the start offset (start - centre) around the centre by -sgn·a about Y.
        const ox = c.x - cx;
        const oz = c.z - cz;
        const ang = -sgn * a;
        // Rotation by angle θ around Y in our convention: heading h → h+θ maps fwd(h) to fwd(h+θ).
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        const x = cx + ox * cos + oz * sin;
        const z = cz - ox * sin + oz * cos;
        const t = fwd(h);
        raw.push({ x, z, tx: t.x, tz: t.z, curvature: sgn / radius, ...base });
      }
      length += arc;
      const exitH = c.h - sgn * (Math.PI / 2);
      const f = fwd(c.h);
      c.x = snap(c.x + f.x * radius + r.x * radius * sgn);
      c.z = snap(c.z + f.z * radius + r.z * radius * sgn);
      c.h = normAngle(exitH);
    } else {
      const n = p.size ?? 1;
      const len = n * cell;
      const f = fwd(c.h);
      const steps = Math.max(1, Math.round(len / spacing));
      for (let i = 0; i < steps; i++) {
        const d = (i / steps) * len;
        raw.push({ x: c.x + f.x * d, z: c.z + f.z * d, tx: f.x, tz: f.z, curvature: 0, ...base });
      }
      length += len;
      c.x = snap(c.x + f.x * len);
      c.z = snap(c.z + f.z * len);
    }
  });

  // Closure: back at the start entry, heading north.
  if (Math.abs(c.x - cell / 2) > 1e-3 || Math.abs(c.z) > 1e-3 || Math.abs(normAngle(c.h)) > 1e-3 && Math.abs(normAngle(c.h) - Math.PI * 2) > 1e-3) {
    throw new TrackError(`Track is not closed: ends at (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) heading ${((c.h * 180) / Math.PI).toFixed(0)}°`);
  }

  // Distances along the line (re-measured from the samples for accuracy).
  const samples: TrackSample[] = [];
  let s = 0;
  raw.forEach((r, i) => {
    if (i > 0) s += Math.hypot(r.x - raw[i - 1]!.x, r.z - raw[i - 1]!.z);
    samples.push({ ...r, s });
  });
  const realLength = s + Math.hypot(raw[0]!.x - raw[raw.length - 1]!.x, raw[0]!.z - raw[raw.length - 1]!.z);
  // Rescale checkpoint distances to the measured length.
  const scale = realLength / length;
  const cps = checkpoints.map((d) => d * scale);

  const halfWidth = file.width / 2;
  const startLen = (file.pieces[0]!.size ?? 1) * cell * scale;
  const lineS = Math.max(4, startLen - 4);
  const track0 = { samples, length: realLength } as CompiledTrack;
  // Spawn grid: 2 columns, staggered rows behind the line (spaced so the start is not a pile-up;
  // back rows follow the centre line into the previous pieces).
  const spawn: SpawnSlot[] = [];
  const g = (k: string) => tunables.get<number>(k);
  for (let i = 0; i < 8; i++) {
    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? 1 : -1; // pole on the right (driver's view)
    const sp = sampleAt(track0, lineS - g('race.gridFirst') - row * g('race.gridRowGap') - (side < 0 ? g('race.gridStagger') : 0));
    // Driver's right of the tangent heading.
    const h = Math.atan2(sp.tx, sp.tz);
    const r = right(h);
    const lat = halfWidth * g('race.gridLateral') * side;
    spawn.push({ x: sp.x + r.x * lat, z: sp.z + r.z * lat, heading: h });
  }

  const xs = samples.map((p) => p.x);
  const zs = samples.map((p) => p.z);
  return {
    file,
    samples,
    spacing,
    length: realLength,
    halfWidth,
    checkpoints: cps,
    lineS,
    spawn,
    cells,
    bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) },
  };
}

/** Sample at distance s (wraps), linear interpolation. */
export function sampleAt(track: CompiledTrack, s: number): { x: number; z: number; tx: number; tz: number; curvature: number; surface: Surface } {
  const L = track.length;
  const d = ((s % L) + L) % L;
  const n = track.samples.length;
  // Binary search on s.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.samples[mid]!.s <= d) lo = mid;
    else hi = mid - 1;
  }
  const a = track.samples[lo]!;
  const b = track.samples[(lo + 1) % n]!;
  const segLen = (lo + 1 < n ? b.s : L) - a.s;
  const k = segLen > 0 ? (d - a.s) / segLen : 0;
  const tx = a.tx + (b.tx - a.tx) * k;
  const tz = a.tz + (b.tz - a.tz) * k;
  const tl = Math.hypot(tx, tz) || 1;
  return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, tx: tx / tl, tz: tz / tl, curvature: a.curvature, surface: a.surface };
}
